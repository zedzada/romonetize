import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { getPlanById, PRICING_PLANS } from "@/lib/products";

// Lazy init for service role client
function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Valid event types - Roblox-specific naming
const VALID_EVENT_TYPES = [
  // Script lifecycle events
  "script_started",     // Server script initialized (confirms tracking is working)
  
  // Player events
  "session_start",      // Player joins game
  "session_end",        // Player leaves game
  "checkpoint_reached", // Player reaches a checkpoint/milestone
  
  // Monetization events
  "gamepass_click",     // Player clicks on gamepass
  "gamepass_prompt",    // Gamepass purchase prompt shown
  "gamepass_purchase",  // Gamepass purchased successfully
  "devproduct_prompt",  // Dev product purchase prompt shown
  "devproduct_purchase",// Dev product purchased successfully
  "offer_view",         // Special offer viewed
  "offer_accept",       // Special offer accepted
  "offer_decline",      // Special offer declined
  
  // Progression events
  "reward_claim",       // Player claims a reward
  "rebirth",            // Player rebirths/prestiges
  "level_up",           // Player levels up
  "zone_unlock",        // Player unlocks a new zone/area
  
  // Legacy events (backward compatibility)
  "player_join",        // Alias for session_start
  "player_leave",       // Alias for session_end
  "shop_open",          // Shop opened
  "shop_close",         // Shop closed
  "purchase_prompt",    // Alias for gamepass_prompt/devproduct_prompt
  "purchase_success",   // Alias for gamepass_purchase/devproduct_purchase
  "purchase_failed",    // Purchase failed
] as const;

type EventType = (typeof VALID_EVENT_TYPES)[number];

interface TrackingEvent {
  event_type: EventType;
  player_id?: string;
  product_id?: string;
  product_name?: string;
  product_type?: "gamepass" | "devproduct" | "subscription";
  robux?: number;
  metadata?: Record<string, unknown>;
}

// Map legacy event types to new Roblox-specific names (for analytics normalization)
const LEGACY_EVENT_MAP: Record<string, string> = {
  "player_join": "session_start",
  "player_leave": "session_end",
  "purchase_success": "gamepass_purchase", // Default to gamepass, can be overridden by product_type
};

// Normalize camelCase to snake_case (Roblox sends camelCase, DB expects snake_case)
function normalizeEvent(raw: Record<string, unknown>): Record<string, unknown> {
  // Support both camelCase and snake_case for each field
  const eventType = String(raw.event_type ?? raw.eventType ?? "");
  const productType = raw.product_type ?? raw.productType;
  
  // Normalize legacy purchase_success based on product_type
  let normalizedEventType = eventType;
  if (eventType === "purchase_success" && productType === "devproduct") {
    normalizedEventType = "devproduct_purchase";
  } else if (eventType === "purchase_success" && productType === "gamepass") {
    normalizedEventType = "gamepass_purchase";
  }
  
  const normalized: Record<string, unknown> = {
    event_type: normalizedEventType,
    player_id: raw.player_id ?? raw.playerId,
    product_id: raw.product_id ?? raw.productId,
    product_name: raw.product_name ?? raw.productName,
    product_type: productType,
    robux: raw.robux,
    metadata: raw.metadata ?? {},
  };
  
  return normalized;
}

// POST /api/events - Receive tracking events from Roblox games
export async function POST(request: NextRequest) {
  const supabaseAdmin = getSupabaseAdmin();
  try {
    // Parse request body first (Roblox sends apiKey in body)
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, step: "parse", error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    // Get API key from header OR body (support multiple formats for compatibility)
    // Priority: x-api-key header > apiKey (camelCase) > api_key (snake_case)
    const headerKey = request.headers.get("x-api-key")?.trim();
    const bodyObj = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const bodyKeyCamel = bodyObj.apiKey ? String(bodyObj.apiKey).trim() : undefined;
    const bodyKeySnake = bodyObj.api_key ? String(bodyObj.api_key).trim() : undefined;
    
    const apiKey = headerKey || bodyKeyCamel || bodyKeySnake;
    
    if (!apiKey) {
      return NextResponse.json(
        { success: false, step: "auth", error: "Missing API key. Include x-api-key header or apiKey in body." },
        { status: 401 }
      );
    }

    // Validate API key and get associated game using service role
    const { data: game, error: gameError } = await supabaseAdmin
      .from("games")
      .select("id, name, api_key, user_id, status")
      .eq("api_key", apiKey)
      .maybeSingle();

    if (gameError) {
      console.error(`[api/events] Game lookup error: api_key=${apiKey.slice(0, 8)}..., error=${gameError.message}`);
      return NextResponse.json(
        { 
          success: false,
          step: "game_lookup",
          error: "Database error looking up game", 
          details: gameError.message,
        },
        { status: 500 }
      );
    }

    if (!game) {
      return NextResponse.json(
        { success: false, step: "game_lookup", error: "Game not found for this API key" },
        { status: 401 }
      );
    }

    if (game.status !== "active") {
      return NextResponse.json(
        { success: false, step: "game_status", error: "Game is not active. Enable tracking in dashboard.", details: { currentStatus: game.status } },
        { status: 403 }
      );
    }

    // Check usage limits
    const monthYear = new Date().toISOString().slice(0, 7); // e.g., "2024-01"
    
    // Get user's profile and plan
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("plan")
      .eq("id", game.user_id)
      .single();

    const userPlan = getPlanById(profile?.plan || "free") || PRICING_PLANS[0];

    // Get or create usage record
    const { data: usage } = await supabaseAdmin
      .from("usage_limits")
      .select("events_count, events_limit")
      .eq("user_id", game.user_id)
      .eq("month_year", monthYear)
      .single();

    const currentCount = usage?.events_count || 0;
    const eventsLimit = usage?.events_limit ?? userPlan.limits.eventsPerMonth;

    // Check if adding these events would exceed the limit
    // -1, null, or undefined means unlimited events
    const incomingEventCount = Array.isArray(body) ? body.length : 1;
    const isUnlimited = eventsLimit === -1 || eventsLimit === null || typeof eventsLimit === "undefined";
    
    if (!isUnlimited && typeof eventsLimit === "number" && eventsLimit > 0) {
      if (currentCount + incomingEventCount > eventsLimit) {
        return NextResponse.json(
          { 
            success: false,
            step: "rate_limit",
            error: "Monthly event limit reached", 
            details: {
              currentUsage: currentCount,
              limit: eventsLimit,
              plan: userPlan.name,
            },
          },
          { status: 429 }
        );
      }
    }

    // Support both single event and batch events
    // Normalize camelCase to snake_case
    let events: TrackingEvent[];
    
    if (Array.isArray(body)) {
      events = body.map((item) => normalizeEvent(item as Record<string, unknown>) as TrackingEvent);
    } else {
      events = [normalizeEvent(body as Record<string, unknown>) as TrackingEvent];
    }

    if (events.length === 0) {
      return NextResponse.json(
        { success: false, step: "validation", error: "No events provided." },
        { status: 400 }
      );
    }

    if (events.length > 100) {
      return NextResponse.json(
        { success: false, step: "validation", error: "Maximum 100 events per request." },
        { status: 400 }
      );
    }

    // Validate and prepare events for insertion
    const validatedEvents = [];
    const errors: string[] = [];

    for (let i = 0; i < events.length; i++) {
      const event = events[i];

      // Validate event_type is present
      if (!event.event_type) {
        errors.push(`Event ${i}: Missing required field 'event_type' (or 'eventType'). Must be one of: ${VALID_EVENT_TYPES.join(", ")}`);
        continue;
      }
      
      // Validate event_type is valid
      if (!VALID_EVENT_TYPES.includes(event.event_type)) {
        errors.push(`Event ${i}: Invalid event_type '${event.event_type}'. Must be one of: ${VALID_EVENT_TYPES.join(", ")}`);
        continue;
      }

      // Validate product_type if provided
      if (event.product_type && !["gamepass", "devproduct", "subscription"].includes(event.product_type)) {
        errors.push(`Event ${i}: Invalid product_type. Must be gamepass, devproduct, or subscription.`);
        continue;
      }

      // Validate robux is a positive integer if provided
      if (event.robux !== undefined && (typeof event.robux !== "number" || event.robux < 0)) {
        errors.push(`Event ${i}: robux must be a positive number.`);
        continue;
      }

      validatedEvents.push({
        game_id: game.id,
        event_type: event.event_type,
        player_id: event.player_id || null,
        product_id: event.product_id || null,
        product_name: event.product_name || null,
        product_type: event.product_type || null,
        robux: event.robux || 0,
        metadata: event.metadata || {},
      });
    }

    if (validatedEvents.length === 0) {
      return NextResponse.json(
        { 
          success: false,
          step: "validation",
          error: "No valid events", 
          details: errors,
        },
        { status: 400 }
      );
    }

    // Insert events and return inserted rows
    const { data: insertedEvents, error: insertError } = await supabaseAdmin
      .from("events")
      .insert(validatedEvents)
      .select();

    if (insertError) {
      console.error(`[api/events] Insert error: game_id=${game.id}, error=${insertError.message}`);
      return NextResponse.json(
        { 
          success: false,
          step: "insert",
          error: "Failed to store events", 
          details: insertError.message,
        },
        { status: 500 }
      );
    }

    if (!insertedEvents || insertedEvents.length === 0) {
      return NextResponse.json(
        { success: false, step: "insert", error: "Insert returned no rows. Events may not have been saved." },
        { status: 500 }
      );
    }

    // Update last_event_at on the game
    await supabaseAdmin
      .from("games")
      .update({ last_event_at: new Date().toISOString() })
      .eq("id", game.id);

    // Increment usage count
    await supabaseAdmin
      .from("usage_limits")
      .upsert({
        user_id: game.user_id,
        month_year: monthYear,
        events_count: currentCount + insertedEvents.length,
        events_limit: eventsLimit,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: "user_id,month_year",
      });

    // Handle product upserts for purchase events (new + legacy event types)
    const purchaseEventTypes = ["gamepass_purchase", "devproduct_purchase", "purchase_success"];
    const purchaseEvents = validatedEvents.filter(
      (e) => purchaseEventTypes.includes(e.event_type) && e.product_id
    );

    for (const event of purchaseEvents) {
      // Upsert product with updated stats
      const { data: existingProduct } = await supabaseAdmin
        .from("products")
        .select("id, total_revenue, total_purchases")
        .eq("game_id", game.id)
        .eq("roblox_product_id", event.product_id)
        .single();

      if (existingProduct) {
        // Update existing product
        await supabaseAdmin
          .from("products")
          .update({
            total_revenue: existingProduct.total_revenue + (event.robux || 0),
            total_purchases: existingProduct.total_purchases + 1,
            name: event.product_name || existingProduct.id,
          })
          .eq("id", existingProduct.id);
      } else if (event.product_name && event.product_type) {
        // Insert new product
        await supabaseAdmin.from("products").insert({
          game_id: game.id,
          roblox_product_id: event.product_id,
          name: event.product_name,
          product_type: event.product_type,
          price_robux: event.robux || 0,
          total_revenue: event.robux || 0,
          total_purchases: 1,
          total_clicks: 0,
        });
      }
    }

    // Handle click events for products
    const clickEvents = validatedEvents.filter(
      (e) => (e.event_type === "gamepass_click" || e.event_type === "devproduct_click") && e.product_id
    );

    for (const event of clickEvents) {
      const { data: existingProduct } = await supabaseAdmin
        .from("products")
        .select("id, total_clicks")
        .eq("game_id", game.id)
        .eq("roblox_product_id", event.product_id)
        .single();

      if (existingProduct) {
        await supabaseAdmin
          .from("products")
          .update({ total_clicks: existingProduct.total_clicks + 1 })
          .eq("id", existingProduct.id);
      } else if (event.product_name && event.product_type) {
        await supabaseAdmin.from("products").insert({
          game_id: game.id,
          roblox_product_id: event.product_id,
          name: event.product_name,
          product_type: event.product_type,
          price_robux: event.robux || 0,
          total_revenue: 0,
          total_purchases: 0,
          total_clicks: 1,
        });
      }
    }

    // Log server-side for debugging (only prefix of API key)
    console.log(`[api/events] Received: api_key=${apiKey.slice(0, 8)}..., event_types=${validatedEvents.map(e => e.event_type).join(",")}, game_id=${game.id}`);

    return NextResponse.json({
      success: true,
      inserted: true,
      event_type: validatedEvents.map(e => e.event_type),
      game_id: game.id,
      roblox_game_id: game.roblox_game_id || null,
      count: insertedEvents.length,
      rejected: errors.length > 0 ? errors.length : undefined,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("[api/events] Unhandled error:", error);
    return NextResponse.json(
      { 
        success: false,
        step: "unknown",
        error: "Internal server error", 
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

// GET /api/events - Health check
export async function GET() {
  return NextResponse.json({
    status: "ok",
    version: "1.0",
    endpoints: {
      POST: "Send tracking events (x-api-key header OR apiKey in body)",
    },
    authentication: {
      header: "x-api-key: your_api_key",
      body: '{ "apiKey": "your_api_key", "eventType": "..." }',
    },
    fields: {
      note: "Both camelCase and snake_case are accepted",
      event_type_or_eventType: "Required. One of the valid event types",
      player_id_or_playerId: "Optional. Roblox player ID",
      product_id_or_productId: "Optional. Product identifier",
      product_name_or_productName: "Optional. Product display name",
      product_type_or_productType: "Optional. gamepass, devproduct, or subscription",
      robux: "Optional. Price in Robux",
      metadata: "Optional. Additional data object",
    },
    event_types: VALID_EVENT_TYPES,
  });
}
