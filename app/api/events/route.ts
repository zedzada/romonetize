import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { getPlanById, PRICING_PLANS } from "@/lib/products";

// Lazy init for service role client
function getSupabaseAdmin() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_CUSTOM_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  return createClient(supabaseUrl!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// Valid event types - Roblox-specific naming
const VALID_EVENT_TYPES = [
  // Script lifecycle events
  "script_started",     // Server script initialized (confirms tracking is working)
  
  // CCU heartbeat (sent every 60 seconds from each server)
  "ccu_heartbeat",      // CCU heartbeat from tracker script
  
  // Player events
  "session_start",      // Player joins game
  "session_end",        // Player leaves game
  "session_duration",   // Session duration tracking
  "checkpoint_reached", // Player reaches a checkpoint/milestone
  
  // Product funnel events (for conversion tracking)
  "product_view",       // Player views a product in UI (optional - for funnel tracking)
  "product_click",      // Player clicks on a product (optional - for funnel tracking)
  
  // Monetization events
  "gamepass_click",     // Player clicks on gamepass (legacy - use product_click)
  "devproduct_click",   // Player clicks on devproduct (legacy - use product_click)
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
  
  // Custom events
  "custom_event",       // User-defined custom event
] as const;

type EventType = (typeof VALID_EVENT_TYPES)[number];

interface TrackingEvent {
  event_type: EventType;
  player_id?: string;
  session_id?: string;
  product_id?: string;
  product_name?: string;
  product_type?: "gamepass" | "devproduct" | "subscription";
  robux?: number;
  metadata?: Record<string, unknown>;
  // CCU heartbeat fields
  server_id?: string;
  place_id?: string;
  universe_id?: string;
  ccu?: number;
}

// Map legacy event types to new Roblox-specific names (for analytics normalization)
const LEGACY_EVENT_MAP: Record<string, string> = {
  "player_join": "session_start",
  "player_leave": "session_end",
  "purchase_success": "gamepass_purchase", // Default to gamepass, can be overridden by product_type
};

// Normalize camelCase to snake_case (Roblox sends camelCase, DB expects snake_case)
// Also extracts product fields from metadata as fallback for compatibility
function normalizeEvent(raw: Record<string, unknown>): Record<string, unknown> {
  // Support both camelCase and snake_case for each field
  const eventType = String(raw.event_type ?? raw.eventType ?? "");
  const metadata = (raw.metadata ?? {}) as Record<string, unknown>;
  
  // Extract product fields - top level first, then metadata fallback
  const productType = raw.product_type ?? raw.productType ?? metadata.product_type ?? metadata.productType;
  const productId = raw.product_id ?? raw.productId ?? metadata.product_id ?? metadata.productId;
  const productName = raw.product_name ?? raw.productName ?? metadata.product_name ?? metadata.productName;
  const robux = raw.robux ?? metadata.robux;
  const sessionId = raw.session_id ?? raw.sessionId ?? metadata.session_id ?? metadata.sessionId;
  
  // CCU heartbeat fields
  const serverId = raw.server_id ?? raw.serverId ?? metadata.server_id ?? metadata.serverId;
  const placeId = raw.place_id ?? raw.placeId ?? metadata.place_id ?? metadata.placeId;
  const universeId = raw.universe_id ?? raw.universeId ?? metadata.universe_id ?? metadata.universeId;
  const ccu = raw.ccu ?? metadata.ccu;
  
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
    session_id: sessionId,
    product_id: productId,
    product_name: productName,
    product_type: productType,
    robux: typeof robux === "number" ? robux : (typeof robux === "string" ? parseInt(robux, 10) : undefined),
    metadata: metadata,
    // CCU heartbeat fields
    server_id: serverId,
    place_id: placeId,
    universe_id: universeId,
    ccu: typeof ccu === "number" ? ccu : (typeof ccu === "string" ? parseInt(ccu, 10) : undefined),
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

      // Store session_id in metadata since the column may not exist yet
      const eventMetadata = {
        ...(event.metadata || {}),
        ...(event.session_id ? { session_id: event.session_id } : {}),
      };
      
      validatedEvents.push({
        game_id: game.id,
        event_type: event.event_type,
        player_id: event.player_id || null,
        product_id: event.product_id || null,
        product_name: event.product_name || null,
        product_type: event.product_type || null,
        robux: event.robux || 0,
        metadata: eventMetadata,
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

    // Handle click events for products (product_click and legacy gamepass_click/devproduct_click)
    const clickEvents = validatedEvents.filter(
      (e) => (e.event_type === "product_click" || e.event_type === "gamepass_click" || e.event_type === "devproduct_click") && e.product_id
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
          total_views: 0,
        });
      }
    }
    
    // Handle view events for products (product_view)
    const viewEvents = validatedEvents.filter(
      (e) => e.event_type === "product_view" && e.product_id
    );

    for (const event of viewEvents) {
      const { data: existingProduct } = await supabaseAdmin
        .from("products")
        .select("id, total_views")
        .eq("game_id", game.id)
        .eq("roblox_product_id", event.product_id)
        .single();

      if (existingProduct) {
        await supabaseAdmin
          .from("products")
          .update({ total_views: (existingProduct.total_views || 0) + 1 })
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
          total_clicks: 0,
          total_views: 1,
        });
      }
    }
  
  // Handle CCU heartbeat events - upsert to server_heartbeats and insert ccu_snapshots
  // IMPORTANT: Insert snapshot on EVERY heartbeat, do not skip for unchanged CCU or same minute
  const ccuHeartbeatEvents = events.filter(
    (e) => e.event_type === "ccu_heartbeat"
  );
  
  // DEBUG: Log CCU heartbeat event detection
  console.log(`[v0] CCU heartbeat events found: ${ccuHeartbeatEvents.length} out of ${events.length} total events`);
  if (ccuHeartbeatEvents.length > 0) {
    console.log(`[v0] First CCU heartbeat event:`, JSON.stringify(ccuHeartbeatEvents[0]).slice(0, 500));
  }

  // Track results for explicit response
  let ccuHeartbeatResult: { 
    success: boolean; 
    game_id?: string;
    server_id?: string;
    server_ccu?: number;
    total_active_ccu?: number;
    snapshot_inserted?: boolean;
    error?: string;
  } | null = null;

  for (const event of ccuHeartbeatEvents) {
    // Support both root level and metadata fields
    const rawEvent = event as Record<string, unknown>;
    const metadata = (rawEvent.metadata || {}) as Record<string, unknown>;
    
    const serverId = (rawEvent.server_id || metadata.server_id) as string | undefined;
    const placeId = (rawEvent.place_id || metadata.place_id) as string | undefined;
    const universeId = (rawEvent.universe_id || metadata.universe_id) as string | undefined;
    
    // Extract CCU from all supported payload shapes (per spec)
    const rawCcu = 
      rawEvent.ccu ??
      rawEvent.current_players ??
      rawEvent.player_count ??
      metadata.ccu ??
      metadata.current_players ??
      metadata.player_count ??
      metadata.players;
    const serverCcu = typeof rawCcu === "number" ? rawCcu : (typeof rawCcu === "string" ? parseInt(rawCcu, 10) : undefined);
    const ccuNumber = Number(serverCcu);
    
    // Only process if we have a valid CCU number
    if (!Number.isFinite(ccuNumber)) {
      console.warn(`[api/events] CCU heartbeat has invalid ccu value for game_id=${game.id}, raw=${rawCcu}`);
      // Don't fail - just skip snapshot but continue with event insert
      ccuHeartbeatResult = { success: false, error: `Invalid CCU value: ${rawCcu}` };
      continue;
    }

    // Upsert to server_heartbeats table (if server_id is provided)
    if (serverId) {
      const { error: heartbeatError } = await supabaseAdmin
        .from("server_heartbeats")
        .upsert({
          game_id: game.id,
          user_id: game.user_id,
          server_id: serverId,
          place_id: placeId?.toString() || null,
          universe_id: universeId?.toString() || null,
          ccu: ccuNumber,
          last_seen_at: new Date().toISOString(),
        }, {
          onConflict: "game_id,server_id",
        });

      if (heartbeatError) {
        console.error(`[api/events] Failed to upsert server heartbeat: ${heartbeatError.message}`);
        // Don't fail the whole request - continue to snapshot insert
      }
    }

    // Calculate total CCU from all active servers (last seen within 2 minutes)
    let totalCcu = ccuNumber; // Default to this heartbeat's CCU
    
    if (serverId) {
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      const { data: activeServers, error: serversError } = await supabaseAdmin
        .from("server_heartbeats")
        .select("ccu")
        .eq("game_id", game.id)
        .gte("last_seen_at", twoMinutesAgo);

      if (!serversError && activeServers && activeServers.length > 0) {
        totalCcu = activeServers.reduce((sum, s) => sum + (s.ccu || 0), 0);
      }
    }

    // Insert CCU snapshot - ALWAYS insert on every heartbeat
    // Use minimal columns: game_id, ccu, source, created_at (server_id is optional)
    try {
      const snapshotData: Record<string, unknown> = {
        game_id: game.id,
        ccu: totalCcu,
        source: "romonetize_tracker",
        created_at: new Date().toISOString(),
      };
      
      // Only include server_id if provided (column exists but is optional)
      if (serverId) {
        snapshotData.server_id = serverId;
      }
      
      // DEBUG: Log snapshot insert attempt
      console.log(`[v0] Attempting ccu_snapshot insert:`, JSON.stringify(snapshotData));
      
      const { error: snapshotError } = await supabaseAdmin
        .from("ccu_snapshots")
        .insert(snapshotData);

      if (snapshotError) {
        console.error(`[v0] ccu_snapshot INSERT FAILED: game_id=${game.id}, error=${snapshotError.message}, code=${snapshotError.code}`);
        ccuHeartbeatResult = { 
          success: false, 
          game_id: game.id,
          server_id: serverId,
          server_ccu: ccuNumber,
          total_active_ccu: totalCcu,
          snapshot_inserted: false,
          error: `ccu_snapshot insert: ${snapshotError.message}` 
        };
        // Don't fail the whole request - event was already inserted
        continue;
      }
      
      // DEBUG: Log successful insert
      console.log(`[v0] ccu_snapshot INSERT SUCCESS: game_id=${game.id}, ccu=${totalCcu}`);

      // Update current_players on the games table
      await supabaseAdmin
        .from("games")
        .update({
          current_players: totalCcu,
          last_roblox_sync: new Date().toISOString(),
        })
        .eq("id", game.id);

      ccuHeartbeatResult = {
        success: true,
        game_id: game.id,
        server_id: serverId,
        server_ccu: ccuNumber,
        total_active_ccu: totalCcu,
        snapshot_inserted: true,
      };

      console.log(`[api/events] CCU heartbeat OK: game_id=${game.id}, server_id=${serverId || "none"}, server_ccu=${ccuNumber}, total_ccu=${totalCcu}`);
    } catch (snapshotErr) {
      console.error(`[api/events] CCU snapshot exception: ${snapshotErr}`);
      ccuHeartbeatResult = { 
        success: false, 
        game_id: game.id,
        error: `snapshot exception: ${snapshotErr}` 
      };
    }
  }

  // If this was a CCU heartbeat request, return explicit heartbeat response
  if (ccuHeartbeatEvents.length > 0 && ccuHeartbeatResult) {
    return NextResponse.json({
      success: ccuHeartbeatResult.success,
      event_type: "ccu_heartbeat",
      ...ccuHeartbeatResult,
    });
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
  session_id_or_sessionId: "Optional. Session identifier for tracking player sessions",
  product_id_or_productId: "Optional. Product identifier",
  product_name_or_productName: "Optional. Product display name",
  product_type_or_productType: "Optional. gamepass, devproduct, or subscription",
  robux: "Optional. Price in Robux",
  metadata: "Optional. Additional data object",
  server_id_or_serverId: "For ccu_heartbeat. Roblox JobId",
  place_id_or_placeId: "For ccu_heartbeat. Roblox PlaceId",
  universe_id_or_universeId: "For ccu_heartbeat. Roblox GameId/UniverseId",
  ccu: "For ccu_heartbeat. Current player count in this server",
  },
    event_types: VALID_EVENT_TYPES,
  });
}
