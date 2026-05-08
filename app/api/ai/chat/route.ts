import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { AI_CREDIT_COSTS } from "@/lib/products";
import { generateText } from "ai";
import { gateway } from "@ai-sdk/gateway";

// Lazy init for service role client
function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
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

// Get analytics context for the AI
async function getAnalyticsContext(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  userId: string,
  gameId?: string
) {
  // Get user's selected game (is_selected = true)
  let targetGameId = gameId;

  if (!targetGameId) {
    // First try to get the selected game
    const { data: selectedGame } = await supabase
      .from("games")
      .select("id, name, current_players, total_visits, favorites, likes, dislikes, last_roblox_sync")
      .eq("user_id", userId)
      .eq("is_selected", true)
      .neq("status", "deleted")
      .single();

    if (selectedGame) {
      targetGameId = selectedGame.id;
    } else {
      // Fallback: auto-select the first active game
      const { data: games } = await supabase
        .from("games")
        .select("id, name, current_players, total_visits, favorites, likes, dislikes, last_roblox_sync")
        .eq("user_id", userId)
        .neq("status", "deleted")
        .order("created_at", { ascending: false })
        .limit(1);

      if (games && games.length > 0) {
        targetGameId = games[0].id;
      }
    }
  }

  if (!targetGameId) {
    return { hasData: false, gameName: null };
  }

  // Verify ownership and get Roblox stats
  const { data: game } = await supabase
    .from("games")
    .select("id, name, current_players, total_visits, favorites, likes, dislikes, last_roblox_sync")
    .eq("id", targetGameId)
    .eq("user_id", userId)
    .single();

  if (!game) {
    return { hasData: false, gameName: null };
  }

  // Fetch synced Roblox products
  const { data: robloxProducts } = await supabase
    .from("roblox_products")
    .select("name, product_type, price_robux, is_for_sale")
    .eq("game_id", targetGameId)
    .order("synced_at", { ascending: false });

  const syncedProducts = robloxProducts || [];

  // Get events (paginated to avoid caps)
  const allEvents: Array<{
    event_type: string;
    player_id: string;
    product_id: string | null;
    product_name: string | null;
    product_type: string | null;
    robux: number;
    created_at: string;
  }> = [];

  let offset = 0;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore && offset < 10000) { // Cap at 10k for performance
    const { data: events } = await supabase
      .from("events")
      .select(
        "event_type, player_id, product_id, product_name, product_type, robux, created_at"
      )
      .eq("game_id", targetGameId)
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (events && events.length > 0) {
      allEvents.push(...events);
      offset += events.length;
      hasMore = events.length === pageSize;
    } else {
      hasMore = false;
    }
  }

  if (allEvents.length === 0) {
    return { hasData: false, gameName: game.name };
  }

  // Calculate stats
  const purchaseEventTypes = [
    "purchase_success",
    "gamepass_purchase",
    "devproduct_purchase",
  ];

  const purchaseEvents = allEvents.filter((e) =>
    purchaseEventTypes.includes(e.event_type)
  );
  const totalRevenue = purchaseEvents.reduce(
    (sum, e) => sum + (e.robux || 0),
    0
  );
  const totalPurchases = purchaseEvents.length;
  const uniquePlayers = new Set(
    allEvents.map((e) => e.player_id).filter(Boolean)
  ).size;
  const uniqueBuyers = new Set(
    purchaseEvents.map((e) => e.player_id).filter(Boolean)
  ).size;

  // Revenue by type
  const gamepassRevenue = purchaseEvents
    .filter(
      (e) =>
        e.product_type === "gamepass" || e.event_type === "gamepass_purchase"
    )
    .reduce((sum, e) => sum + (e.robux || 0), 0);
  const devproductRevenue = purchaseEvents
    .filter(
      (e) =>
        e.product_type === "devproduct" || e.event_type === "devproduct_purchase"
    )
    .reduce((sum, e) => sum + (e.robux || 0), 0);

  // Top products
  const productMap = new Map<
    string,
    { name: string; revenue: number; purchases: number; productType: string }
  >();
  purchaseEvents.forEach((e) => {
    const key = e.product_id || e.product_name || "unknown";
    const existing = productMap.get(key);
    if (existing) {
      existing.revenue += e.robux || 0;
      existing.purchases += 1;
    } else {
      productMap.set(key, {
        name: e.product_name || "Unknown",
        revenue: e.robux || 0,
        purchases: 1,
        productType: e.product_type || "gamepass",
      });
    }
  });

  const topProducts = Array.from(productMap.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  // 7-day trends
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const currentWeekPurchases = allEvents.filter(
    (e) =>
      new Date(e.created_at) >= sevenDaysAgo &&
      purchaseEventTypes.includes(e.event_type)
  );
  const previousWeekPurchases = allEvents.filter((e) => {
    const date = new Date(e.created_at);
    return (
      date >= fourteenDaysAgo &&
      date < sevenDaysAgo &&
      purchaseEventTypes.includes(e.event_type)
    );
  });

  const currentWeekRevenue = currentWeekPurchases.reduce(
    (sum, e) => sum + (e.robux || 0),
    0
  );
  const previousWeekRevenue = previousWeekPurchases.reduce(
    (sum, e) => sum + (e.robux || 0),
    0
  );

  const revenueChange =
    previousWeekRevenue > 0
      ? ((currentWeekRevenue - previousWeekRevenue) / previousWeekRevenue) * 100
      : currentWeekRevenue > 0
        ? 100
        : 0;

  return {
    hasData: true,
    gameName: game.name,
    // Roblox synced stats
    robloxStats: {
      ccu: game.current_players,
      visits: game.total_visits,
      favorites: game.favorites,
      likes: game.likes,
      dislikes: game.dislikes,
      lastSynced: game.last_roblox_sync,
    },
    // Synced products from Roblox
    syncedProducts: syncedProducts.map(p => ({
      name: p.name,
      type: p.product_type,
      price: p.price_robux,
      isForSale: p.is_for_sale,
    })),
    syncedProductsCount: syncedProducts.length,
    // Tracker stats
    totalEvents: allEvents.length,
    totalRevenue,
    totalPurchases,
    uniquePlayers,
    uniqueBuyers,
    gamepassRevenue,
    devproductRevenue,
    topProducts,
    currentWeekRevenue,
    previousWeekRevenue,
    revenueChange,
    currentWeekPurchases: currentWeekPurchases.length,
    previousWeekPurchases: previousWeekPurchases.length,
  };
}

export async function POST(request: NextRequest) {
  const supabaseAdmin = getSupabaseAdmin();
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { success: false, error: "Not authenticated" },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const { message, gameId, image } = body as {
      message: string;
      gameId?: string;
      image?: string | null;
    };

    if (!message) {
      return NextResponse.json(
        { success: false, error: "Message is required" },
        { status: 400 }
      );
    }

    // Determine credit type based on image
    const creditType = image ? "image" : "text";

    // Consume credits before making AI call
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
        },
        { status: 402 }
      );
    }

    // Get analytics context
    const analyticsContext = await getAnalyticsContext(
      supabase,
      user.id,
      gameId
    );

    // Build system prompt with analytics context
    let systemPrompt = `You are RoMonetize AI, a specialized assistant for Roblox game developers focused on monetization, analytics, and revenue optimization.

Your expertise includes:
- Roblox monetization strategies (gamepasses, developer products, in-game shops)
- Conversion rate optimization
- Player retention and engagement
- Shop UI/UX best practices
- Pricing strategies for Robux

When analyzing images (UI screenshots, shop layouts, game screenshots):
- Identify what could be enlarged for better visibility
- Identify what could be shrunk to reduce clutter
- Suggest what to add (CTAs, visual hierarchy, value messaging)
- Suggest what to remove (distractions, confusing elements)
- Point out clarity issues
- Provide specific monetization improvement suggestions
- Recommend conversion improvements

Format responses with clear headings, bullet points, and readable spacing. Be concise but actionable.
`;

    if (analyticsContext.hasData) {
      // Include Roblox synced stats if available
      const robloxSection = analyticsContext.robloxStats?.lastSynced ? `
ROBLOX SYNCED STATS (from Roblox API):
- Current CCU (Players Online): ${analyticsContext.robloxStats?.ccu?.toLocaleString() || "N/A"}
- Total Visits: ${analyticsContext.robloxStats?.visits?.toLocaleString() || "N/A"}
- Favorites: ${analyticsContext.robloxStats?.favorites?.toLocaleString() || "N/A"}
- Likes: ${analyticsContext.robloxStats?.likes?.toLocaleString() || "N/A"}
- Dislikes: ${analyticsContext.robloxStats?.dislikes?.toLocaleString() || "N/A"}
- Last Synced: ${analyticsContext.robloxStats?.lastSynced || "Never"}
` : "";

      // Include synced products if available
      const productsSection = analyticsContext.syncedProductsCount > 0 ? `
ROBLOX PRODUCTS (synced from Roblox):
${analyticsContext.syncedProducts?.slice(0, 10).map((p: { name: string; type: string; price: number; isForSale: boolean }) => 
  `- ${p.name} (${p.type}) - ${p.price} Robux${p.isForSale ? "" : " [Not for sale]"}`
).join("\n") || "No products synced"}
${analyticsContext.syncedProductsCount > 10 ? `... and ${analyticsContext.syncedProductsCount - 10} more products` : ""}
` : "";

      systemPrompt += `
ANALYTICS CONTEXT FOR ${analyticsContext.gameName || "THIS GAME"}:
${robloxSection}
TRACKER ANALYTICS (from RoMonetize tracking script):
- Total Events Tracked: ${analyticsContext.totalEvents?.toLocaleString()}
- Total Revenue: ${analyticsContext.totalRevenue?.toLocaleString()} Robux
- Total Purchases: ${analyticsContext.totalPurchases?.toLocaleString()}
- Unique Players: ${analyticsContext.uniquePlayers?.toLocaleString()}
- Unique Buyers: ${analyticsContext.uniqueBuyers?.toLocaleString()}
- Gamepass Revenue: ${analyticsContext.gamepassRevenue?.toLocaleString()} Robux
- Dev Product Revenue: ${analyticsContext.devproductRevenue?.toLocaleString()} Robux

7-DAY TRENDS:
- Current Week Revenue: ${analyticsContext.currentWeekRevenue?.toLocaleString()} Robux
- Previous Week Revenue: ${analyticsContext.previousWeekRevenue?.toLocaleString()} Robux
- Revenue Change: ${analyticsContext.revenueChange?.toFixed(1)}%
- Current Week Purchases: ${analyticsContext.currentWeekPurchases}
- Previous Week Purchases: ${analyticsContext.previousWeekPurchases}

TOP PRODUCTS BY TRACKER REVENUE:
${
  analyticsContext.topProducts
    ?.map(
      (p: { name: string; revenue: number; purchases: number; productType: string }, i: number) =>
        `${i + 1}. ${p.name} - ${p.revenue.toLocaleString()} Robux (${p.purchases} purchases, ${p.productType})`
    )
    .join("\n") || "No product data"
}
${productsSection}
Use this real data when answering questions. Reference specific numbers and products. Roblox API stats show public game metrics, while tracker stats show deep monetization analytics.`;
    } else {
      systemPrompt += `
NOTE: This user ${analyticsContext.gameName ? `has a game called "${analyticsContext.gameName}" but ` : ""}doesn't have tracking data yet.
If they ask about their stats, guide them to:
1. Go to the "My Game" page
2. Copy the Lua tracking script
3. Install it in their Roblox game
4. Track events like player_join, gamepass_purchase, devproduct_purchase

You can still answer general Roblox monetization questions without the data.`;
    }

    // Build messages for the AI
    const messages: Array<{ role: "user" | "assistant"; content: string }> = [
      { role: "user", content: message },
    ];

    // Generate response (not streaming for simplicity)
    const result = await generateText({
      model: gateway("openai/gpt-4.1-mini"),
      system: systemPrompt,
      messages,
      maxTokens: 1000,
      temperature: 0.7,
    });

    // Return success response
    return NextResponse.json({
      success: true,
      message: result.text,
      credits: creditResult.remaining,
    });
  } catch (error) {
    console.error("[v0] AI chat error:", error);

    // Refund credits on error
    try {
      await refundCredits(
        supabaseAdmin,
        user.id,
        "text",
        "AI request failed"
      );
    } catch (refundError) {
      console.error("[v0] Failed to refund credits:", refundError);
    }

    return NextResponse.json(
      { success: false, error: "AI request failed. Credits have been refunded." },
      { status: 500 }
    );
  }
}
