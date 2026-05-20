import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { AI_CREDIT_COSTS } from "@/lib/products";
import { generateText } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { calculatePeriodMetrics, type EventWithMetrics } from "@/lib/metrics/arppu-arpdau";

// Safe formatting helpers to prevent "Cannot read properties of undefined" crashes
function safeNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatNum(value: unknown, fallback = "0"): string {
  const n = safeNumber(value);
  return n.toLocaleString();
}

function formatRobux(value: unknown): string {
  return `${formatNum(value)} Robux`;
}

function formatPercent(value: unknown, decimals = 1): string {
  const n = safeNumber(value);
  return n === 0 ? "N/A" : `${n.toFixed(decimals)}%`;
}

function formatMinutes(seconds: unknown): string {
  const n = safeNumber(seconds);
  return n > 0 ? `${Math.round(n / 60)} minutes` : "unknown";
}

// Lazy init for service role client
function getSupabaseAdmin() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_CUSTOM_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[v0] Missing Supabase env vars:", { 
      hasUrl: !!supabaseUrl, 
      hasKey: !!serviceRoleKey 
    });
    throw new Error("Missing Supabase configuration");
  }
  
  return createClient(supabaseUrl, serviceRoleKey, {
    db: { schema: "public" },
    auth: { persistSession: false },
  });
}

// Consume credits
async function consumeCredits(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  userId: string,
  type: "text" | "image" | "textImage"
): Promise<{ success: boolean; error?: string; remaining?: number }> {
  const creditsRequired = AI_CREDIT_COSTS[type];

  // Get current balance
  const { data: balance, error: balanceError } = await supabaseAdmin
    .from("ai_credit_balances")
    .select("monthly_credits, extra_credits")
    .eq("user_id", userId)
    .single();

  if (balanceError && balanceError.code !== "PGRST116") {
    return { success: false, error: "Failed to fetch balance" };
  }

  const monthlyCredits = balance?.monthly_credits || 0;
  const extraCredits = balance?.extra_credits || 0;
  const totalCredits = monthlyCredits + extraCredits;

  if (totalCredits < creditsRequired) {
    return { success: false, error: "Insufficient credits" };
  }

  // Consume credits: monthly first, then extra
  let newMonthlyCredits = monthlyCredits;
  let newExtraCredits = extraCredits;
  let creditsToConsume = creditsRequired;

  if (newMonthlyCredits >= creditsToConsume) {
    newMonthlyCredits -= creditsToConsume;
    creditsToConsume = 0;
  } else {
    creditsToConsume -= newMonthlyCredits;
    newMonthlyCredits = 0;
  }

  if (creditsToConsume > 0) {
    newExtraCredits -= creditsToConsume;
  }

  const newTotalCredits = newMonthlyCredits + newExtraCredits;

  // Update balance
  const { error: updateError } = await supabaseAdmin
    .from("ai_credit_balances")
    .upsert(
      {
        user_id: userId,
        monthly_credits: newMonthlyCredits,
        extra_credits: newExtraCredits,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

  if (updateError) {
    return { success: false, error: "Failed to consume credits" };
  }

  // Record transaction
  await supabaseAdmin.from("ai_credit_transactions").insert({
    user_id: userId,
    type: `ai_${type}`,
    amount: -creditsRequired,
    balance_after: newTotalCredits,
    metadata: { type, creditsConsumed: creditsRequired },
    created_at: new Date().toISOString(),
  });

  return { success: true, remaining: newTotalCredits };
}

// Refund credits
async function refundCredits(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  userId: string,
  type: "text" | "image" | "textImage",
  reason: string
): Promise<void> {
  const creditsToRefund = AI_CREDIT_COSTS[type];

  const { data: balance } = await supabaseAdmin
    .from("ai_credit_balances")
    .select("monthly_credits, extra_credits")
    .eq("user_id", userId)
    .single();

  const newExtraCredits = (balance?.extra_credits || 0) + creditsToRefund;
  const newTotalCredits = (balance?.monthly_credits || 0) + newExtraCredits;

  await supabaseAdmin
    .from("ai_credit_balances")
    .upsert(
      {
        user_id: userId,
        monthly_credits: balance?.monthly_credits || 0,
        extra_credits: newExtraCredits,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

  await supabaseAdmin.from("ai_credit_transactions").insert({
    user_id: userId,
    type: "refund",
    amount: creditsToRefund,
    balance_after: newTotalCredits,
    metadata: { type, reason },
    created_at: new Date().toISOString(),
  });
}

// Get analytics context for the AI using SIMPLIFIED dashboard metrics
// Do not rebuild product revenue manually - use dashboard data as-is
async function getAnalyticsContext(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  userId: string,
  gameId?: string
) {
  // Get user's game - either specified, or the most recently updated one
  let targetGameId = gameId;
  let game = null;

  if (!targetGameId) {
    const { data: games } = await supabaseAdmin
      .from("games")
      .select("id, name, roblox_game_id, current_players, total_visits, favorites, likes, dislikes, last_roblox_sync")
      .eq("user_id", userId)
      .neq("status", "deleted")
      .order("updated_at", { ascending: false })
      .limit(1);

    if (games && games.length > 0) {
      targetGameId = games[0].id;
      game = games[0];
    }
  } else {
    const { data: gameData } = await supabaseAdmin
      .from("games")
      .select("id, name, roblox_game_id, current_players, total_visits, favorites, likes, dislikes, last_roblox_sync")
      .eq("id", targetGameId)
      .eq("user_id", userId)
      .single();
    game = gameData;
  }

  if (!targetGameId || !game) {
    return { hasData: false, gameName: null, emptyReason: "no_game", gameId: null };
  }

  // Query dashboard stats directly - use 30 days to match Monetization tab default
  const hours = 720; // 30 days (matches Monetization tab default of 28d)
  const now = new Date();
  const rangeStart = new Date(now.getTime() - hours * 60 * 60 * 1000);
  
  // Query 1: Total events count
  const { count: totalEventsCount } = await supabaseAdmin
    .from("events")
    .select("*", { count: "exact", head: true })
    .eq("game_id", targetGameId)
    .gte("created_at", rangeStart.toISOString())
    .lte("created_at", now.toISOString());
  
  const trackedActions = totalEventsCount ?? 0;
  
  // Query 2: Unique players
  const PLAYER_ACTIVITY_TYPES = [
    "player_join", "session_start", "session_end", "player_leave",
    "purchase_success", "gamepass_purchase", "devproduct_purchase",
    "product_click", "gamepass_click", "devproduct_click",
    "gamepass_prompt", "devproduct_prompt", "product_view", "shop_open",
  ];
  
  const { data: playerData } = await supabaseAdmin
    .from("events")
    .select("player_id")
    .eq("game_id", targetGameId)
    .gte("created_at", rangeStart.toISOString())
    .lte("created_at", now.toISOString())
    .in("event_type", PLAYER_ACTIVITY_TYPES)
    .not("player_id", "is", null)
    .neq("player_id", "server")
    .neq("player_id", "");
  
  const uniquePlayerIds = new Set(playerData?.map(e => e.player_id) || []);
  const uniquePlayers = uniquePlayerIds.size;
  const activeUsers = uniquePlayers;
  
  // Query 3: Sessions
  const { count: sessionsCount } = await supabaseAdmin
    .from("events")
    .select("*", { count: "exact", head: true })
    .eq("game_id", targetGameId)
    .in("event_type", ["player_join", "session_start"])
    .gte("created_at", rangeStart.toISOString())
    .lte("created_at", now.toISOString());
  
  const totalSessions = sessionsCount ?? 0;
  
  // Query 4: New players
  const { data: newPlayerData } = await supabaseAdmin
    .from("events")
    .select("player_id, metadata")
    .eq("game_id", targetGameId)
    .in("event_type", ["player_join", "session_start"])
    .gte("created_at", rangeStart.toISOString())
    .lte("created_at", now.toISOString())
    .not("player_id", "is", null)
    .neq("player_id", "server");
  
  const newPlayers = newPlayerData?.filter(e => 
    (e.metadata as Record<string, unknown>)?.is_new_player === true
  ).length ?? 0;
  
  // Query 5: Purchase events
  const PURCHASE_TYPES = ["purchase_success", "gamepass_purchase", "devproduct_purchase"];
  const { data: purchaseData } = await supabaseAdmin
    .from("events")
    .select("id, event_type, player_id, product_id, product_name, robux, metadata, created_at")
    .eq("game_id", targetGameId)
    .in("event_type", PURCHASE_TYPES)
    .gte("created_at", rangeStart.toISOString())
    .lte("created_at", now.toISOString());
  
  // Query all events for ARPPU/ARPDAU calculation (same as dashboard)
  const { data: allEventsData } = await supabaseAdmin
    .from("events")
    .select("player_id, created_at, event_type, robux")
    .eq("game_id", targetGameId)
    .gte("created_at", rangeStart.toISOString())
    .lte("created_at", now.toISOString())
    .limit(10000);
  
  const purchases = purchaseData?.length ?? 0;
  let grossRevenue = 0;
  const payerIds = new Set<string>();
  
  purchaseData?.forEach(e => {
    const robux = e.robux ?? (e.metadata as Record<string, unknown>)?.robux ?? 0;
    grossRevenue += Number(robux) || 0;
    if (e.player_id && e.player_id !== "server" && e.player_id !== "") {
      payerIds.add(e.player_id);
    }
  });
  
  const payingUsers = payerIds.size;
  const CREATOR_REVENUE_RATE = 0.7;
  const estimatedRevenue = Math.round(grossRevenue * CREATOR_REVENUE_RATE);
  
  // Use shared calculatePeriodMetrics for ARPPU/ARPDAU (same as dashboard)
  const allEvents: EventWithMetrics[] = (allEventsData || []).map(e => ({
    player_id: e.player_id,
    created_at: e.created_at,
    event_type: e.event_type,
    robux: e.robux,
  }));
  
  const purchaseEventsForMetrics: EventWithMetrics[] = (purchaseData || []).map(e => ({
    player_id: e.player_id,
    created_at: e.created_at,
    event_type: e.event_type,
    robux: e.robux ?? (e.metadata as Record<string, unknown>)?.robux as number ?? 0,
  }));
  
  const periodMetrics = calculatePeriodMetrics(allEvents, purchaseEventsForMetrics);
  
  // Use calculated metrics (same formulas as dashboard)
  const pcr = activeUsers > 0 ? (payingUsers / activeUsers) * 100 : 0;
  const arppu = periodMetrics.periodArppu;
  const arpdau = periodMetrics.periodArpdau;
  
  // Query 6: Avg session duration
  const { data: sessionEndData } = await supabaseAdmin
    .from("events")
    .select("metadata")
    .eq("game_id", targetGameId)
    .in("event_type", ["session_end", "player_leave"])
    .gte("created_at", rangeStart.toISOString())
    .lte("created_at", now.toISOString())
    .limit(500);
  
  const durations: number[] = [];
  sessionEndData?.forEach(e => {
    const duration = (e.metadata as Record<string, unknown>)?.duration_seconds || 
                     (e.metadata as Record<string, unknown>)?.session_duration;
    if (typeof duration === "number" && duration > 0 && duration < 86400) {
      durations.push(duration);
    }
  });
  const avgSessionSeconds = durations.length > 0 
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;

  // Simple product lookup - just get product names for display
  const { data: robloxProducts } = await supabaseAdmin
    .from("roblox_products")
    .select("roblox_product_id, name, product_type, price_robux")
    .eq("game_id", targetGameId);
  
  const productNameMap = new Map<string, { name: string; type: string; price: number }>();
  robloxProducts?.forEach(p => {
    if (p.roblox_product_id) {
      productNameMap.set(String(p.roblox_product_id), {
        name: p.name || "",
        type: p.product_type || "",
        price: p.price_robux || 0,
      });
    }
  });

  // Helper to validate product IDs
  const isValidProductId = (value: unknown): boolean => {
    const id = String(value ?? "").trim();
    return id.length > 0 && id !== "undefined" && id !== "null" && id !== "0" && id !== "unknown";
  };

  // Simple top products by purchase count - filter invalid products
  const productPurchases = new Map<string, { id: string; name: string; purchases: number }>();
  purchaseData?.forEach(e => {
    const rawProductId = e.product_id || e.product_name;
    
    // Skip if no valid product ID
    if (!isValidProductId(rawProductId)) {
      return;
    }
    
    const productId = String(rawProductId).trim();
    const lookup = productNameMap.get(productId);
    const name = lookup?.name || e.product_name || "";
    
    const existing = productPurchases.get(productId);
    if (existing) {
      existing.purchases += 1;
    } else {
      productPurchases.set(productId, { id: productId, name, purchases: 1 });
    }
  });
  
  const topProducts = Array.from(productPurchases.values())
    .sort((a, b) => b.purchases - a.purchases)
    .slice(0, 5);
  
  // Determine if product mapping is complete (all products have names)
  const productMappingComplete = topProducts.length > 0 && topProducts.every(p => p.name && p.name.length > 0);

  // Determine if we have data
  const hasTrackerEvents = trackedActions > 0;
  const hasPurchaseEvents = purchases > 0;
  const hasRobloxStats = !!(game.total_visits || game.current_players || game.favorites);
  const hasProducts = robloxProducts && robloxProducts.length > 0;
  
  const hasData = hasTrackerEvents || hasPurchaseEvents || hasRobloxStats || hasProducts;

  if (!hasData) {
    return { 
      hasData: false, 
      gameName: game.name, 
      emptyReason: "no_tracker_data",
      robloxStats: hasRobloxStats ? {
        ccu: game.current_players,
        visits: game.total_visits,
        favorites: game.favorites,
        likes: game.likes,
        dislikes: game.dislikes,
      } : null,
    };
  }

  return {
    hasData: true,
    gameName: game.name,
    gameId: targetGameId,
    robloxStats: {
      ccu: game.current_players,
      visits: game.total_visits,
      favorites: game.favorites,
      likes: game.likes,
      dislikes: game.dislikes,
    },
    trackedActions,
    uniquePlayers,
    totalSessions,
    avgSessionSeconds,
    newPlayers,
    totalPurchases: purchases,
    grossRevenue,
    estimatedRevenue,
    payingUsers,
    activeUsers,
    pcr,
    arppu,
    arpdau,
    syncedProductsCount: robloxProducts?.length || 0,
    topProducts,
    productMappingComplete,
  };
}

export async function POST(request: NextRequest) {
  let step = "start";
  let creditsCharged = false;
  let creditsRefunded = false;
  let openaiCalled = false;
  let aiContextReceived = false;
  let saveError: string | null = null;
  
  const supabaseAdmin = getSupabaseAdmin();
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { success: false, error: "Not authenticated", step: "auth" },
      { status: 401 }
    );
  }

  // Variables we need in catch block
  let hasImage = false;
  let creditType: "text" | "image" = "text";
  let debug = false;

  try {
    step = "parse_body";
    const body = await request.json();
    const { message, gameId, imageDataUrl, imageName, imageMimeType, conversationId, debug: debugFlag, aiContext } = body as {
      message: string;
      gameId?: string;
      imageDataUrl?: string;
      imageName?: string;
      imageMimeType?: string;
      conversationId?: string;
      debug?: boolean;
      aiContext?: {
        selectedGame?: string;
        gameId?: string;
        robloxStats?: { visits?: number; ccu?: number; favorites?: number; likes?: number; dislikes?: number };
        trackerStats?: { trackedActions?: number; uniquePlayers?: number; totalSessions?: number; newPlayers?: number; avgSessionSeconds?: number; purchases?: number };
        monetizationStats?: { purchases?: number; grossRevenue?: number; estimatedRevenue?: number; payingUsers?: number; activeUsers?: number; pcr?: number; arppu?: number; arpdau?: number };
        productStats?: { totalProducts?: number; topProducts?: unknown[] };
        overview?: { hasTrackerData?: boolean; hasPurchaseData?: boolean; hasRobloxStats?: boolean };
        dataHealth?: { trackerConnected?: boolean; lastEventAt?: string | null };
      };
    };
    
    debug = Boolean(debugFlag);
    aiContextReceived = Boolean(aiContext);

    if (!message && !imageDataUrl) {
      return NextResponse.json(
        { success: false, error: "Message or image is required", step },
        { status: 400 }
      );
    }

    // Detect if we have an image
    hasImage = Boolean(imageDataUrl && imageDataUrl.startsWith("data:image"));
    
    // Determine credit type based on image
    creditType = hasImage ? "image" : "text";

    // Consume credits before making AI call
    step = "credits_charge";
    const creditResult = await consumeCredits(
      supabaseAdmin,
      user.id,
      creditType
    );
    if (!creditResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: creditResult.error,
          creditsRequired: AI_CREDIT_COSTS[creditType],
          step,
        },
        { status: 402 }
      );
    }
    creditsCharged = true;

    // PART 4: Trust aiContext from frontend if provided, otherwise query backend
    step = "analytics_context";
    let analyticsContext: Record<string, unknown>;
    let sourceUsed = "backend";
    
    // Accept aiContext if it exists (even if selectedGame is null - we can still have Roblox stats or other data)
    if (aiContext) {
      // Use frontend-provided context (from /api/dashboard/analytics)
      sourceUsed = "frontend_aiContext";
      
      // Check if we have ANY data
      const trackerStats = aiContext.trackerStats || {};
      const monetizationStats = aiContext.monetizationStats || {};
      const robloxStats = aiContext.robloxStats || {};
      const productStats = aiContext.productStats || {};
      
      const hasTrackerData = (trackerStats.trackedActions || 0) > 0 || 
                             (trackerStats.uniquePlayers || 0) > 0 || 
                             (trackerStats.totalSessions || 0) > 0;
      const hasPurchaseData = (monetizationStats.purchases || 0) > 0 ||
                              (monetizationStats.estimatedRevenue || 0) > 0;
      const hasRobloxStats = (robloxStats.visits || 0) > 0 || 
                             (robloxStats.ccu || 0) > 0;
      const hasProducts = (productStats.totalProducts || 0) > 0;
      
      // Get productsTable from aiContext (same data as Products tab)
      const productsTable = (aiContext.productsTable || []) as Array<{
        product_id: string;
        product_name: string;
        product_type: string;
        estimated_revenue: number;
        gross_revenue: number;
        purchases: number;
        buyers: number;
        revenue_per_buyer: number;
      }>;
      const productsSummary = aiContext.productsSummary as Record<string, unknown> | null;
      
      const hasData = hasTrackerData || hasPurchaseData || hasRobloxStats || hasProducts || productsTable.length > 0;
      
      analyticsContext = {
        hasData,
        gameName: aiContext.selectedGame || null,
        gameId: aiContext.gameId || gameId || null,
        robloxStats: robloxStats,
        trackedActions: trackerStats.trackedActions || 0,
        uniquePlayers: trackerStats.uniquePlayers || 0,
        totalSessions: trackerStats.totalSessions || 0,
        newPlayers: trackerStats.newPlayers || 0,
        avgSessionSeconds: trackerStats.avgSessionSeconds || 0,
        totalPurchases: monetizationStats.purchases || 0,
        grossRevenue: monetizationStats.grossRevenue || 0,
        estimatedRevenue: monetizationStats.estimatedRevenue || 0,
        payingUsers: monetizationStats.payingUsers || 0,
        activeUsers: monetizationStats.activeUsers || 0,
        pcr: monetizationStats.pcr || 0,
        arppu: monetizationStats.arppu || 0,
        arpdau: monetizationStats.arpdau || 0,
        syncedProductsCount: productStats.totalProducts || 0,
        topProducts: productStats.topProducts || [],
        // Products Table - SAME DATA AS PRODUCTS TAB
        productsTable: productsTable,
        productsSummary: productsSummary,
        allConnectedGames: aiContext.allConnectedGames || [],
        // Game switch tracking
        gameSwitchedMidConversation: aiContext.gameSwitchedMidConversation || false,
        previousGameName: aiContext.previousGameName || null,
        emptyReason: hasData ? null : "no_data_in_aiContext",
        _dataHealth: {
          hasTrackerData,
          hasPurchaseData,
          hasRobloxStats,
          hasProducts,
          hasProductsTable: productsTable.length > 0,
        },
      };
    } else {
      // Fallback: Try to get analytics context, but don't block chat if it fails
      try {
        analyticsContext = await getAnalyticsContext(
          supabaseAdmin,
          user.id,
          gameId
        );
      } catch (contextError) {
        console.error("[v0] Failed to get analytics context:", contextError);
        // Use empty context - chat can still work without stats
        analyticsContext = {
          hasData: false,
          gameName: null,
          gameId: null,
          emptyReason: "context_fetch_failed",
        };
      }
    }

    // Build system prompt - per spec section 7
    let systemPrompt = `You are RoMonetize AI, a helpful assistant for Roblox game developers.

You live inside the RoMonetize dashboard, which tracks game monetization, player analytics, and product performance for Roblox games.

YOU ARE A FULL ASSISTANT, NOT A LIMITED STATS BOT.

What you can do:
1. GENERAL ROBLOX ADVISOR - Answer any Roblox development question: game design, scripting patterns, UI/UX, player psychology, monetization strategies, best practices, trends, etc. You do NOT need connected game stats to answer general questions.

2. CONNECTED-GAME STATS ADVISOR - When the user has a connected game with stats, use those stats to give personalized advice about their specific game. Reference actual numbers.

3. MONETIZATION ADVISOR - Help with pricing strategies, gamepass design, developer product strategies, shop UI, conversion optimization, ARPPU/ARPDAU improvement, retention loops, etc.

4. PRODUCT ADVISOR - Help decide which products to create, how to price them, which ones to improve, bundle strategies, limited-time offers, etc.

5. SCREENSHOT/IMAGE REVIEWER - When the user uploads an image (shop UI, gamepass screen, thumbnail, game icon, in-game screenshot), analyze it and give specific feedback on design, monetization potential, and improvements.

BEHAVIOR RULES:
- For general Roblox questions: Answer directly. No stats needed.
- For questions about the user's specific game: Use the provided dashboard context if available.
- If stats exist, include a "Stats I'm using" section with the actual values you're referencing.
- Do not invent missing product names, prices, or exact revenue splits.
- Be practical, direct, and helpful. Write like a knowledgeable colleague, not a corporate FAQ.

PRODUCT QUESTIONS - CRITICAL:
When user asks about products, gamepasses, dev products, best sellers, revenue per product:
- If "Products Table" data exists below, USE IT. This is the SAME data shown in the Products tab.
- For "show me all my products" - list them from the Products Table with names, types, revenue, purchases.
- For "best seller by purchases" - find highest purchases in Products Table.
- For "best revenue" - find highest estimated_revenue in Products Table.
- For "which product should I improve" - analyze Products Table rows:
  * High purchases + low revenue per buyer = pricing opportunity
  * High revenue + high purchases = promote more
  * Low buyers + high revenue per buyer = niche product, add visibility
- DO NOT say "I don't have product list" if Products Table has rows.
- DO NOT say "product-level data unavailable" if Products Table has rows.

WHEN STATS ARE PROVIDED:
For advice questions about the user's game, structure your answer as:
- Short answer
- Stats I'm using (list actual values)
- What this means
- What I'd improve first
- Concrete next steps

IMAGE ANALYSIS:
When the user uploads an image:
- Describe what you see
- Identify monetization strengths and weaknesses
- Suggest what to enlarge, shrink, add, or remove
- Give specific actionable improvements

MULTI-GAME QUESTIONS:
If asked to compare games, use available stats. If only one game has data, explain what's needed.

Revenue numbers shown are estimates from RoMonetize tracker data and may differ from official Roblox reports.
`;

    if (analyticsContext.hasData) {
      const rStats = analyticsContext.robloxStats as Record<string, unknown> | undefined;
      const hasAnyRobloxStats = rStats && (
        safeNumber(rStats.ccu) > 0 || 
        safeNumber(rStats.visits) > 0 || 
        safeNumber(rStats.favorites) > 0
      );
      
      // Build clean context sections
      let contextText = `\nSelected Game: ${analyticsContext.gameName || "Unknown"}\n`;
      
      // Check if game was switched mid-conversation
      if (analyticsContext.gameSwitchedMidConversation && analyticsContext.previousGameName) {
        contextText += `\n**Note: You switched from "${analyticsContext.previousGameName}" to "${analyticsContext.gameName}". The stats below are for the current game (${analyticsContext.gameName}).**\n`;
      }
      
      // Roblox public stats
      if (hasAnyRobloxStats) {
        contextText += `
Roblox Public Stats (current/lifetime - from Roblox API):
- Current CCU: ${safeNumber(rStats?.ccu) > 0 ? formatNum(rStats?.ccu) : "Unknown"}
- Total Visits (lifetime): ${safeNumber(rStats?.visits) > 0 ? formatNum(rStats?.visits) : "Unknown"}
- Favorites: ${safeNumber(rStats?.favorites) > 0 ? formatNum(rStats?.favorites) : "Unknown"}
- Likes: ${safeNumber(rStats?.likes) > 0 ? formatNum(rStats?.likes) : "Unknown"}
- Dislikes: ${safeNumber(rStats?.dislikes) > 0 ? formatNum(rStats?.dislikes) : "Unknown"}
`;
      }
      
      // Tracker stats
      const hasTrackerData = safeNumber(analyticsContext.trackedActions) > 0 || 
                             safeNumber(analyticsContext.uniquePlayers) > 0;
      if (hasTrackerData) {
        contextText += `
Tracker Stats (last 28 days - from RoMonetize tracker):
- Tracked Actions: ${safeNumber(analyticsContext.trackedActions) > 0 ? formatNum(analyticsContext.trackedActions) : "Unknown"}
- Unique Players: ${safeNumber(analyticsContext.uniquePlayers) > 0 ? formatNum(analyticsContext.uniquePlayers) : "Unknown"}
- Total Sessions: ${safeNumber(analyticsContext.totalSessions) > 0 ? formatNum(analyticsContext.totalSessions) : "Unknown"}
- Avg Session: ${formatMinutes(analyticsContext.avgSessionSeconds)}
- New Players: ${safeNumber(analyticsContext.newPlayers) > 0 ? formatNum(analyticsContext.newPlayers) : "Unknown"}
`;
      }
      
      // Monetization - only show if we have purchase data
      const hasPurchaseData = safeNumber(analyticsContext.totalPurchases) > 0 || 
                              safeNumber(analyticsContext.estimatedRevenue) > 0;
      if (hasPurchaseData) {
        contextText += `
Monetization Stats (last 28 days - same range as Monetization tab):
- Purchases: ${safeNumber(analyticsContext.totalPurchases) > 0 ? formatNum(analyticsContext.totalPurchases) : "Unknown"}
- Estimated Revenue: ${safeNumber(analyticsContext.estimatedRevenue) > 0 ? formatRobux(analyticsContext.estimatedRevenue) : "Unknown"}
- Gross Revenue: ${safeNumber(analyticsContext.grossRevenue) > 0 ? formatRobux(analyticsContext.grossRevenue) : "Unknown"}
- Paying Users: ${safeNumber(analyticsContext.payingUsers) > 0 ? formatNum(analyticsContext.payingUsers) : "Unknown"}
- Active Users: ${safeNumber(analyticsContext.activeUsers) > 0 ? formatNum(analyticsContext.activeUsers) : "Unknown"}
- PCR: ${safeNumber(analyticsContext.pcr) > 0 ? formatPercent(analyticsContext.pcr, 2) : "Unknown"}
- ARPPU: ${safeNumber(analyticsContext.arppu) > 0 ? `${safeNumber(analyticsContext.arppu).toFixed(0)} Robux` : "Unknown"}
- ARPDAU: ${safeNumber(analyticsContext.arpdau) > 0 ? `${safeNumber(analyticsContext.arpdau).toFixed(2)} Robux` : "Unknown"}
`;
      }
      
      // Products - ALWAYS show if we have valid product IDs with purchases
      const topProducts = analyticsContext.topProducts as Array<{ id: string; name: string; purchases: number }> | undefined;
      
      // Filter to only show products with valid data (valid ID and purchases > 0)
      const validProducts = (topProducts || []).filter(p => {
        const hasValidId = p.id && p.id !== "undefined" && p.id !== "null" && p.id !== "0";
        const hasValidPurchases = typeof p.purchases === "number" && p.purchases > 0;
        return hasValidId && hasValidPurchases;
      });
      
      if (validProducts.length > 0) {
        // Check if all products have names
        const allHaveNames = validProducts.every(p => p.name && p.name.length > 0);
        const someHaveNames = validProducts.some(p => p.name && p.name.length > 0);
        
        contextText += `
Top Products by Purchases (ranked by purchase count):
${validProducts.map((p, i) => {
  // Show name if available, otherwise show Product ID
  const displayName = p.name && p.name.length > 0 
    ? p.name 
    : `Product ID ${p.id}`;
  return `${i + 1}. ${displayName} — ${p.purchases} purchases`;
}).join("\n")}
`;
        // Add note about incomplete mapping only if needed
        if (!allHaveNames) {
          if (someHaveNames) {
            contextText += `\n(Note: Some product names are not fully mapped yet. Products without names are shown by ID.)\n`;
          } else {
            contextText += `\n(Note: Product names are not mapped yet. Products are shown by ID. Revenue per product is not available, but purchase counts are accurate.)\n`;
          }
        }
      }
      
      // Product count
      const productCount = safeNumber(analyticsContext.syncedProductsCount);
      if (productCount > 0) {
        contextText += `\nProduct Catalog: ${productCount} products synced from Roblox\n`;
      }
      
      // Products Table - SAME DATA AS PRODUCTS TAB
      // This gives the AI the full product list with names, types, revenue, purchases
      const productsTable = analyticsContext.productsTable as Array<{
        product_id: string;
        product_name: string;
        product_type: string;
        estimated_revenue: number;
        gross_revenue: number;
        purchases: number;
        buyers: number;
        revenue_per_buyer: number;
      }> | undefined;
      
      if (productsTable && productsTable.length > 0) {
        // Sort by revenue for display
        const sortedByRevenue = [...productsTable].sort((a, b) => b.estimated_revenue - a.estimated_revenue);
        
        contextText += `
Products Table (last 28 days - same range as Products tab, ${productsTable.length} products):
${sortedByRevenue.slice(0, 15).map((p, i) => {
  const typeLabel = p.product_type === "gamepass" ? "Game Pass" : p.product_type === "devproduct" ? "Dev Product" : p.product_type;
  return `${i + 1}. ${p.product_name} — ${typeLabel} — R$${p.estimated_revenue.toLocaleString()} — ${p.purchases} purchases — ${p.buyers} buyers`;
}).join("\n")}
${productsTable.length > 15 ? `\n... and ${productsTable.length - 15} more products` : ""}
`;
      }
      
      // All connected games (for multi-game questions)
      const allGames = analyticsContext.allConnectedGames as Array<{ id: string; name: string }> | undefined;
      if (allGames && allGames.length > 1) {
        contextText += `
Connected Games (${allGames.length} total):
${allGames.map((g, i) => `${i + 1}. ${g.name}`).join("\n")}
(Currently viewing: ${analyticsContext.gameName || "Unknown"})
`;
      }
      
      systemPrompt += contextText;
    } else {
      // No data case
      const rStats = analyticsContext.robloxStats as Record<string, unknown> | undefined;
      const hasRobloxStats = rStats && safeNumber(rStats.visits) > 0;
      
      if (hasRobloxStats) {
        systemPrompt += `
NOTE: This user has a game called "${analyticsContext.gameName}" with Roblox public stats:
- Total Visits: ${formatNum(rStats?.visits)}
- Current Players: ${formatNum(rStats?.ccu)}
- Favorites: ${formatNum(rStats?.favorites)}

Deep monetization tracking data is not yet available. To get purchase analytics and revenue tracking, they need to install the RoMonetize tracking script.

You CAN answer questions using the Roblox public stats above.`;
      } else {
        systemPrompt += `
NOTE: This user ${analyticsContext.gameName ? `has a game called "${analyticsContext.gameName}" but ` : ""}hasn't connected their game data yet.
If they ask about their stats, let them know you don't have access to their specific game data, and guide them to connect their Roblox game in the "My Game" page.

You can still answer general Roblox monetization questions without the data.`;
      }
    }

    // Build messages for the AI with proper image handling
    // AI SDK uses ImagePart format: { type: 'image', image: dataUrl }
    const userMessageText = message || "Please analyze this screenshot.";
    
    type ContentPart = { type: 'text'; text: string } | { type: 'image'; image: string; mimeType?: string };
    let userContent: string | ContentPart[];
    
    if (hasImage && imageDataUrl) {
      // Vision request - content must be array of parts
      // AI SDK ImagePart uses 'image' not 'image_url'
      userContent = [
        {
          type: "text" as const,
          text: userMessageText,
        },
        {
          type: "image" as const,
          image: imageDataUrl,
          mimeType: imageMimeType || undefined,
        },
      ];
    } else {
      // Text-only request
      userContent = userMessageText;
    }

    // Choose model based on whether we have an image
    // Vision-capable models: gpt-4o, gpt-4o-mini, gpt-4-turbo
    const modelId = hasImage ? "openai/gpt-4o-mini" : "openai/gpt-4.1-mini";

    // Track OpenAI call metadata for debugging
    step = "openai_call";
    let fallbackUsed = false;
    let fallbackReason: string | null = null;
    let responseId: string | null = null;
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;

    // Check if we have the required API key for AI Gateway
    // Vercel AI Gateway uses AI_GATEWAY_API_KEY or falls back to provider-specific keys
    const aiGatewayKey = process.env.AI_GATEWAY_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    const hasApiKey = Boolean(aiGatewayKey || openaiKey);
    const apiKeyPrefix = aiGatewayKey 
      ? aiGatewayKey.slice(0, 12) + "..." 
      : openaiKey 
        ? openaiKey.slice(0, 12) + "..." 
        : null;

    let result: { text: string; usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }; response?: { id?: string } };

    if (!hasApiKey) {
      // No API key - cannot call OpenAI
      fallbackUsed = true;
      fallbackReason = "No API key found (AI_GATEWAY_API_KEY or OPENAI_API_KEY missing)";
      result = { 
        text: "I'm unable to process your request right now. The AI service is not properly configured. Please contact support if this issue persists.",
      };
    } else {
      try {
        // Generate response via Vercel AI Gateway
        const aiResult = await generateText({
          model: gateway(modelId),
          system: systemPrompt,
          messages: [
            { 
              role: "user" as const, 
              content: userContent,
            },
          ],
          maxTokens: 1500,
          temperature: 0.7,
        });
        
        openaiCalled = true;
        result = aiResult;
        
        // Extract usage info if available
        if (aiResult.usage) {
          inputTokens = aiResult.usage.promptTokens || 0;
          outputTokens = aiResult.usage.completionTokens || 0;
          totalTokens = aiResult.usage.totalTokens || (inputTokens + outputTokens);
        }
        
        // Try to get response ID from the result
        // The AI SDK may include this in different places depending on the provider
        responseId = (aiResult as unknown as { response?: { id?: string } }).response?.id || 
                     (aiResult as unknown as { responseId?: string }).responseId ||
                     `gen-${Date.now()}`;
                     
      } catch (aiError) {
        console.error("[v0] AI generation failed:", aiError);
        fallbackUsed = true;
        fallbackReason = `AI request failed: ${aiError instanceof Error ? aiError.message : "Unknown error"}`;
        
        // Return error instead of hardcoded fallback
        throw new Error(fallbackReason);
      }
    }

    // Save messages to conversation using Supabase client (NON-BLOCKING)
    // If saving fails, still return the AI response
    step = "save_messages";
    let savedConversationId = conversationId;
    try {
      if (!conversationId) {
        // Create a new conversation with first message as title
        step = "save_user_message";
        const title = userMessageText.substring(0, 50).trim() + (userMessageText.length > 50 ? "..." : "");
        const { data: newConv, error: convError } = await supabaseAdmin
          .from("ai_conversations")
          .insert({
            user_id: user.id,
            title,
            game_id: gameId || null,
          })
          .select("id")
          .single();
        
        if (!convError && newConv) {
          savedConversationId = newConv.id;
        } else if (convError) {
          saveError = `Create conversation failed: ${convError.message}`;
        }
      }
      
      if (savedConversationId) {
        // Save user message
        const { error: userMsgError } = await supabaseAdmin.from("ai_messages").insert({
          conversation_id: savedConversationId,
          user_id: user.id,
          role: "user",
          content: userMessageText,
          has_image: hasImage,
          image_url: null,
          metadata: hasImage ? { imageName, imageMimeType } : {},
        });
        
        if (userMsgError) {
          saveError = `Save user message failed: ${userMsgError.message}`;
        }
        
        // Build promptContextPreview for metadata
        step = "save_assistant_message";
        const promptContextPreview = analyticsContext.hasData 
          ? `Game: ${analyticsContext.gameName}, Tracked Actions: ${analyticsContext.trackedActions}, Unique Players: ${analyticsContext.uniquePlayers}, Purchases: ${analyticsContext.totalPurchases}, Est. Revenue: ${analyticsContext.estimatedRevenue}, Products: ${analyticsContext.syncedProductsCount}`
          : `No data available (reason: ${analyticsContext.emptyReason || "unknown"})`;
        
        // Save assistant message with aiContext metadata for verification
        const { error: assistantMsgError } = await supabaseAdmin.from("ai_messages").insert({
          conversation_id: savedConversationId,
          user_id: user.id,
          role: "assistant",
          content: result.text,
          has_image: false,
          metadata: {
            aiContextReceived: Boolean(aiContext),
            sourceUsed,
            selectedGameName: analyticsContext.gameName || null,
            selectedGameId: analyticsContext.gameId || null,
            hasData: analyticsContext.hasData || false,
            trackerStats: analyticsContext.hasData ? {
              trackedActions: analyticsContext.trackedActions,
              uniquePlayers: analyticsContext.uniquePlayers,
              totalSessions: analyticsContext.totalSessions,
            } : null,
            monetizationStats: analyticsContext.hasData ? {
              purchases: analyticsContext.totalPurchases,
              estimatedRevenue: analyticsContext.estimatedRevenue,
              grossRevenue: analyticsContext.grossRevenue,
              payingUsers: analyticsContext.payingUsers,
            } : null,
            productStats: analyticsContext.hasData ? {
              totalProducts: analyticsContext.syncedProductsCount,
            } : null,
            robloxStats: analyticsContext.robloxStats || null,
            promptContextPreview,
          },
        });
        
        if (assistantMsgError) {
          saveError = (saveError ? saveError + "; " : "") + `Save assistant message failed: ${assistantMsgError.message}`;
        }
        
        // Update conversation's updated_at
        await supabaseAdmin
          .from("ai_conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", savedConversationId);
      }
    } catch (msgError) {
      console.error("[v0] Failed to save messages:", msgError);
      saveError = msgError instanceof Error ? msgError.message : "Unknown save error";
      // Don't fail the request if message saving fails - AI response is still valid
    }

    // Return success response
    step = "return_success";
    const response: Record<string, unknown> = {
      success: true,
      message: result.text,
      credits: creditResult.remaining,
      conversationId: savedConversationId,
      step,
      creditsCharged,
      aiContextReceived,
      saveError,
      // Always include OpenAI debug info
      openai: {
        apiKeyPresent: hasApiKey,
        apiKeyPrefix,
        model: modelId,
        openaiCalled,
        responseId,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens,
        },
      },
      fallbackUsed,
      fallbackReason,
    };
    
    // Include debug context if requested
    if (debug) {
      response.debugContext = {
        selectedGameName: analyticsContext.gameName,
        selectedGameId: analyticsContext.gameId || gameId || null,
        contextLoaded: true,
        sourceUsed, // "frontend_aiContext" or "backend"
        hasData: analyticsContext.hasData,
        emptyStateReason: analyticsContext.emptyReason || null,
        trackerStats: analyticsContext.hasData ? {
          trackedActions: analyticsContext.trackedActions,
          uniquePlayers: analyticsContext.uniquePlayers,
          totalSessions: analyticsContext.totalSessions,
          avgSessionSeconds: analyticsContext.avgSessionSeconds,
          purchases: analyticsContext.totalPurchases,
        } : null,
        monetizationStats: analyticsContext.hasData ? {
          estimatedRevenue: analyticsContext.estimatedRevenue,
          grossRevenue: analyticsContext.grossRevenue,
          purchases: analyticsContext.totalPurchases,
          payingUsers: analyticsContext.payingUsers,
          activeUsers: analyticsContext.activeUsers,
          pcr: analyticsContext.pcr,
          arppu: analyticsContext.arppu,
          arpdau: analyticsContext.arpdau,
        } : null,
        productStats: analyticsContext.hasData ? {
          totalProducts: analyticsContext.syncedProductsCount,
          topProducts: (analyticsContext.topProducts as unknown[])?.slice(0, 3),
        } : null,
        robloxStats: analyticsContext.robloxStats || null,
        _dataHealth: analyticsContext._dataHealth || null,
        promptContextPreview: analyticsContext.hasData 
          ? `Game: ${analyticsContext.gameName}\nTracked Actions: ${analyticsContext.trackedActions}\nUnique Players: ${analyticsContext.uniquePlayers}\nPurchases: ${analyticsContext.totalPurchases}\nEstimated Revenue: ${analyticsContext.estimatedRevenue} Robux\nCCU: ${analyticsContext.robloxStats?.ccu || 0}\nVisits: ${analyticsContext.robloxStats?.visits || 0}`
          : "No data loaded - fallback message will be shown",
      };
    }
    
    return NextResponse.json(response);
  } catch (error) {
    console.error("[v0] AI chat error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    // Refund credits on error (only if they were charged)
    if (creditsCharged) {
      try {
        await refundCredits(
          supabaseAdmin,
          user.id,
          creditType,
          errorMessage
        );
        creditsRefunded = true;
      } catch (refundError) {
        console.error("[v0] Failed to refund credits:", refundError);
      }
    }

    return NextResponse.json(
      { 
        success: false, 
        error: errorMessage,
        step,
        openaiCalled,
        aiContextReceived,
        creditsCharged,
        creditsRefunded,
      },
      { status: 500 }
    );
  }
}
