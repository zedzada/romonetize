import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDashboardMetrics } from "@/lib/server/dashboard-metrics";

export const dynamic = "force-dynamic";

/**
 * AI Context API - Returns the same real dashboard data used by Overview, Monetization, Products, etc.
 * 
 * This is the SINGLE SOURCE OF TRUTH for AI Assistant context.
 * It uses getDashboardMetrics which powers all dashboard pages.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  }

  const url = new URL(request.url);
  const debug = url.searchParams.get("debug") === "true";
  const range = (url.searchParams.get("range") || "7d") as "1h" | "1d" | "7d" | "30d" | "90d";

  // Get user's selected game
  const { data: selectedGame, error: gameError } = await supabase
    .from("games")
    .select("id, name, roblox_game_id, is_selected, current_players, total_visits, favorites, likes, dislikes, last_roblox_sync")
    .eq("user_id", user.id)
    .eq("is_selected", true)
    .neq("status", "deleted")
    .single();

  // Fallback: get first active game if none selected
  let game = selectedGame;
  let gameSelectionMethod = "is_selected";
  
  if (!game && !gameError) {
    const { data: firstGame } = await supabase
      .from("games")
      .select("id, name, roblox_game_id, is_selected, current_players, total_visits, favorites, likes, dislikes, last_roblox_sync")
      .eq("user_id", user.id)
      .neq("status", "deleted")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    
    if (firstGame) {
      game = firstGame;
      gameSelectionMethod = "fallback_first";
    }
  }

  if (!game) {
    return NextResponse.json({
      success: true,
      hasGame: false,
      selectedGame: null,
      dataHealth: {
        hasTrackerEvents: false,
        hasPurchaseEvents: false,
        hasRobloxStats: false,
        lastEventAt: null,
        lastPurchaseAt: null,
      },
      emptyStateReason: "no_game",
      promptContextPreview: "User has no games added yet.",
      debug: debug ? { gameSelectionMethod, gameError: gameError?.message } : undefined,
    });
  }

  // Get dashboard metrics using the shared helper
  const metrics = await getDashboardMetrics(user.id, game.id, range);

  // Get product count from roblox_products
  const { count: productsCount } = await supabase
    .from("roblox_products")
    .select("*", { count: "exact", head: true })
    .eq("game_id", game.id);

  // Get top products by revenue
  const { data: topProductsData } = await supabase
    .from("events")
    .select("product_name, product_id, robux, metadata")
    .eq("game_id", game.id)
    .in("event_type", ["purchase_success", "gamepass_purchase", "devproduct_purchase"])
    .order("created_at", { ascending: false })
    .limit(500);

  const productRevenue = new Map<string, { name: string; revenue: number; count: number }>();
  topProductsData?.forEach(e => {
    const productId = e.product_id || e.product_name || "unknown";
    const name = e.product_name || productId;
    const robux = e.robux ?? (e.metadata as Record<string, unknown>)?.robux ?? 0;
    const existing = productRevenue.get(productId);
    if (existing) {
      existing.revenue += Number(robux) || 0;
      existing.count += 1;
    } else {
      productRevenue.set(productId, { name, revenue: Number(robux) || 0, count: 1 });
    }
  });
  
  const topProducts = Array.from(productRevenue.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  // Build data health
  const hasTrackerEvents = (metrics.trackedActions ?? 0) > 0;
  const hasPurchaseEvents = (metrics.purchases ?? 0) > 0;
  const hasRobloxStats = !!(game.total_visits || game.current_players || game.favorites);
  
  // Determine empty state reason (or null if data exists)
  let emptyStateReason: string | null = null;
  if (!hasTrackerEvents && !hasPurchaseEvents && !hasRobloxStats && (productsCount ?? 0) === 0) {
    emptyStateReason = "no_data";
  }

  // Build context
  const context = {
    selectedGame: {
      id: game.id,
      name: game.name,
      roblox_game_id: game.roblox_game_id,
      is_selected: game.is_selected,
    },
    
    trackerStats: {
      trackedActions: metrics.trackedActions ?? 0,
      uniquePlayers: metrics.uniquePlayers ?? 0,
      totalSessions: metrics.totalSessions ?? 0,
      averageSessionSeconds: metrics.avgSessionSeconds ?? 0,
      newPlayers: metrics.newPlayers ?? 0,
      purchases: metrics.purchases ?? 0,
    },
    
    monetizationStats: {
      estimatedRevenue: metrics.estimatedRevenue ?? 0,
      grossRevenue: metrics.grossRevenue ?? 0,
      purchases: metrics.purchases ?? 0,
      payingUsers: metrics.payingUsers ?? 0,
      activeUsers: metrics.activeUsers ?? 0,
      pcr: metrics.pcr ?? 0,
      arppu: metrics.arppu ?? 0,
      arpdau: metrics.arpdau ?? 0,
    },
    
    productStats: {
      totalProducts: productsCount ?? 0,
      topProducts,
    },
    
    robloxStats: {
      currentCcu: game.current_players ?? 0,
      visits: game.total_visits ?? 0,
      favorites: game.favorites ?? 0,
      likes: game.likes ?? 0,
      dislikes: game.dislikes ?? 0,
      lastSynced: game.last_roblox_sync,
    },
    
    dataHealth: {
      hasTrackerEvents,
      hasPurchaseEvents,
      hasRobloxStats,
      lastEventAt: null, // Could be added if needed
      lastPurchaseAt: null, // Could be added if needed
    },
  };

  // Build prompt context preview
  const promptLines: string[] = [];
  promptLines.push(`Selected game: ${game.name}`);
  
  if (hasTrackerEvents) {
    promptLines.push(`Tracked actions: ${metrics.trackedActions?.toLocaleString() ?? "unknown"}`);
    promptLines.push(`Unique players: ${metrics.uniquePlayers?.toLocaleString() ?? "unknown"}`);
    promptLines.push(`Total sessions: ${metrics.totalSessions?.toLocaleString() ?? "unknown"}`);
  }
  
  if (hasPurchaseEvents) {
    promptLines.push(`Purchases: ${metrics.purchases?.toLocaleString() ?? "unknown"}`);
    promptLines.push(`Estimated revenue: ${metrics.estimatedRevenue?.toLocaleString() ?? "unknown"} Robux`);
    promptLines.push(`Paying users: ${metrics.payingUsers?.toLocaleString() ?? "unknown"}`);
    if (metrics.pcr !== null && metrics.pcr > 0) {
      promptLines.push(`PCR: ${metrics.pcr.toFixed(2)}%`);
    }
    if (metrics.arppu !== null && metrics.arppu > 0) {
      promptLines.push(`ARPPU: ${metrics.arppu.toFixed(0)} Robux`);
    }
    if (metrics.arpdau !== null && metrics.arpdau > 0) {
      promptLines.push(`ARPDAU: ${metrics.arpdau.toFixed(2)} Robux`);
    }
  }
  
  if (topProducts.length > 0) {
    promptLines.push(`Top products: ${topProducts.map(p => `${p.name} (${p.revenue.toLocaleString()} Robux)`).join(", ")}`);
  }
  
  if (hasRobloxStats) {
    if (game.current_players) promptLines.push(`Current CCU: ${game.current_players.toLocaleString()}`);
    if (game.total_visits) promptLines.push(`Visits: ${game.total_visits.toLocaleString()}`);
  }
  
  if (!hasTrackerEvents && !hasPurchaseEvents) {
    promptLines.push("No tracker events or purchase data found for this game.");
  }

  return NextResponse.json({
    success: true,
    hasGame: true,
    ...context,
    emptyStateReason,
    promptContextPreview: promptLines.join("\n"),
    debug: debug ? {
      gameSelectionMethod,
      range,
      metricsErrors: metrics.errors,
      rawMetrics: metrics,
    } : undefined,
  });
}
