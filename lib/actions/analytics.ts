"use server";

import { createClient } from "@/lib/supabase/server";

// Get user's game IDs for realtime subscriptions
export async function getUserGameIds(): Promise<{ gameIds: string[]; error: string | null }> {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    return { gameIds: [], error: "Not authenticated" };
  }

  const { data: games } = await supabase
    .from("games")
    .select("id")
    .eq("user_id", user.id)
    .neq("status", "deleted");

  return { 
    gameIds: games?.map(g => g.id) || [], 
    error: null 
  };
}

export interface DashboardStats {
  totalGames: number;
  totalEvents: number;
  totalRevenue: number;
  totalProducts: number;
  totalPurchases: number;
  recentEvents: RecentEvent[];
  topProducts: TopProduct[];
  dailyRevenue: DailyRevenue[];
}

export interface RecentEvent {
  id: string;
  event_type: string;
  player_id: string | null;
  product_name: string | null;
  robux: number;
  created_at: string;
  game_name: string;
}

export interface TopProduct {
  id: string;
  name: string;
  product_type: string;
  total_revenue: number;
  total_purchases: number;
  total_clicks: number;
  game_name: string;
}

export interface DailyRevenue {
  date: string;
  revenue: number;
  purchases: number;
}

// Get dashboard overview stats
export async function getDashboardStats(): Promise<{ stats: DashboardStats | null; error: string | null }> {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    return { stats: null, error: "Not authenticated" };
  }

  // Get all user's games
  const { data: games } = await supabase
    .from("games")
    .select("id, name")
    .eq("user_id", user.id)
    .neq("status", "deleted");

  const gameIds = games?.map(g => g.id) || [];
  const gameMap = new Map(games?.map(g => [g.id, g.name]) || []);

  if (gameIds.length === 0) {
    return {
      stats: {
        totalGames: 0,
        totalEvents: 0,
        totalRevenue: 0,
        totalProducts: 0,
        totalPurchases: 0,
        recentEvents: [],
        topProducts: [],
        dailyRevenue: [],
      },
      error: null,
    };
  }

  // Get total events
  const { count: totalEvents } = await supabase
    .from("events")
    .select("*", { count: "exact", head: true })
    .in("game_id", gameIds);

  // Get all purchase events for revenue, purchases count, and products
  // Support both legacy (purchase_success) and new Roblox events (gamepass_purchase, devproduct_purchase)
  const { data: purchaseEvents } = await supabase
    .from("events")
    .select("robux, product_id, product_name, product_type, game_id")
    .in("game_id", gameIds)
    .in("event_type", ["purchase_success", "gamepass_purchase", "devproduct_purchase"]);

  const totalRevenue = purchaseEvents?.reduce((sum, e) => sum + (e.robux || 0), 0) || 0;
  const totalPurchases = purchaseEvents?.length || 0;

  // Count unique products from events (by product_id)
  const uniqueProductIds = new Set(purchaseEvents?.map(e => e.product_id).filter(Boolean) || []);
  const totalProducts = uniqueProductIds.size;

  // Get recent events
  const { data: recentEventsData } = await supabase
    .from("events")
    .select("id, event_type, player_id, product_name, robux, created_at, game_id")
    .in("game_id", gameIds)
    .order("created_at", { ascending: false })
    .limit(10);

  const recentEvents: RecentEvent[] = (recentEventsData || []).map(e => ({
    id: e.id,
    event_type: e.event_type,
    player_id: e.player_id,
    product_name: e.product_name,
    robux: e.robux || 0,
    created_at: e.created_at,
    game_name: gameMap.get(e.game_id) || "Unknown",
  }));

  // Calculate top products from events (group by product_id/product_name)
  const productStatsMap = new Map<string, {
    id: string;
    name: string;
    product_type: string;
    total_revenue: number;
    total_purchases: number;
    game_id: string;
  }>();

  (purchaseEvents || []).forEach(e => {
    const productKey = e.product_id || e.product_name || "unknown";
    const existing = productStatsMap.get(productKey);
    if (existing) {
      existing.total_revenue += e.robux || 0;
      existing.total_purchases += 1;
    } else {
      productStatsMap.set(productKey, {
        id: e.product_id || productKey,
        name: e.product_name || "Unknown Product",
        product_type: e.product_type || "gamepass",
        total_revenue: e.robux || 0,
        total_purchases: 1,
        game_id: e.game_id,
      });
    }
  });

  // Sort by revenue and take top 5
  const topProducts: TopProduct[] = Array.from(productStatsMap.values())
    .sort((a, b) => b.total_revenue - a.total_revenue)
    .slice(0, 5)
    .map(p => ({
      id: p.id,
      name: p.name,
      product_type: p.product_type,
      total_revenue: p.total_revenue,
      total_purchases: p.total_purchases,
      total_clicks: 0,
      game_name: gameMap.get(p.game_id) || "Unknown",
    }));

  // Get daily revenue for last 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  
  const { data: dailyData } = await supabase
    .from("events")
    .select("robux, created_at")
    .in("game_id", gameIds)
    .in("event_type", ["purchase_success", "gamepass_purchase", "devproduct_purchase"])
    .gte("created_at", sevenDaysAgo.toISOString());

  // Aggregate by day
  const dailyMap = new Map<string, { revenue: number; purchases: number }>();
  
  for (let i = 6; i >= 0; i--) {
    const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const dateStr = date.toISOString().split("T")[0];
    dailyMap.set(dateStr, { revenue: 0, purchases: 0 });
  }

  (dailyData || []).forEach(e => {
    const dateStr = new Date(e.created_at).toISOString().split("T")[0];
    const existing = dailyMap.get(dateStr);
    if (existing) {
      existing.revenue += e.robux || 0;
      existing.purchases += 1;
    }
  });

  const dailyRevenue: DailyRevenue[] = Array.from(dailyMap.entries()).map(([date, data]) => ({
    date,
    revenue: data.revenue,
    purchases: data.purchases,
  }));

  return {
    stats: {
      totalGames: gameIds.length,
      totalEvents: totalEvents || 0,
      totalRevenue,
      totalProducts,
      totalPurchases,
      recentEvents,
      topProducts,
      dailyRevenue,
    },
    error: null,
  };
}

// Get basic stats for a specific game (used by performance page)
export async function getGameStats(
  gameId: string
): Promise<{ stats: { totalEvents: number; totalRevenue: number; totalPurchases: number; uniquePlayers: number } | null; error: string | null }> {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    return { stats: null, error: "Not authenticated" };
  }

  // Verify ownership
  const { data: game } = await supabase
    .from("games")
    .select("id")
    .eq("id", gameId)
    .eq("user_id", user.id)
    .single();

  if (!game) {
    return { stats: null, error: "Game not found" };
  }

  // Get total events
  const { count: totalEvents } = await supabase
    .from("events")
    .select("*", { count: "exact", head: true })
    .eq("game_id", gameId);

  // Get purchase events for revenue (support both legacy and new event types)
  const { data: purchaseEvents } = await supabase
    .from("events")
    .select("robux")
    .eq("game_id", gameId)
    .in("event_type", ["purchase_success", "gamepass_purchase", "devproduct_purchase"]);

  const totalRevenue = purchaseEvents?.reduce((sum, e) => sum + (e.robux || 0), 0) || 0;
  const totalPurchases = purchaseEvents?.length || 0;

  // Get unique players
  const { data: playerEvents } = await supabase
    .from("events")
    .select("player_id")
    .eq("game_id", gameId)
    .not("player_id", "is", null);

  const uniquePlayers = new Set(playerEvents?.map(e => e.player_id)).size;

  return {
    stats: {
      totalEvents: totalEvents || 0,
      totalRevenue,
      totalPurchases,
      uniquePlayers,
    },
    error: null,
  };
}

// Get analytics for a specific game
export async function getGameAnalytics(
  gameId: string,
  days: number = 7
): Promise<{ analytics: GameAnalytics | null; error: string | null }> {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    return { analytics: null, error: "Not authenticated" };
  }

  // Verify ownership
  const { data: game } = await supabase
    .from("games")
    .select("id, name")
    .eq("id", gameId)
    .eq("user_id", user.id)
    .single();

  if (!game) {
    return { analytics: null, error: "Game not found" };
  }

  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Get events in date range
  const { data: events } = await supabase
    .from("events")
    .select("*")
    .eq("game_id", gameId)
    .gte("created_at", startDate.toISOString())
    .order("created_at", { ascending: true });

  // Get products
  const { data: products } = await supabase
    .from("products")
    .select("*")
    .eq("game_id", gameId)
    .order("total_revenue", { ascending: false });

  // Purchase event types (legacy + new)
  const purchaseTypes = ["purchase_success", "gamepass_purchase", "devproduct_purchase"];
  const sessionStartTypes = ["player_join", "session_start"];
  
  // Aggregate stats
  const totalVisits = events?.filter(e => sessionStartTypes.includes(e.event_type)).length || 0;
  const totalRevenue = events
    ?.filter(e => purchaseTypes.includes(e.event_type))
    .reduce((sum, e) => sum + (e.robux || 0), 0) || 0;
  const totalPurchases = events?.filter(e => purchaseTypes.includes(e.event_type)).length || 0;
  const shopOpens = events?.filter(e => e.event_type === "shop_open" || e.event_type === "offer_view").length || 0;

  // Daily breakdown
  const dailyStats = new Map<string, {
    visits: number;
    revenue: number;
    purchases: number;
    shopOpens: number;
  }>();

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const dateStr = date.toISOString().split("T")[0];
    dailyStats.set(dateStr, { visits: 0, revenue: 0, purchases: 0, shopOpens: 0 });
  }

  (events || []).forEach(e => {
    const dateStr = new Date(e.created_at).toISOString().split("T")[0];
    const existing = dailyStats.get(dateStr);
    if (!existing) return;

    // Handle visits (legacy + new)
    if (sessionStartTypes.includes(e.event_type)) {
      existing.visits += 1;
    }
    // Handle purchases (legacy + new)
    if (purchaseTypes.includes(e.event_type)) {
      existing.revenue += e.robux || 0;
      existing.purchases += 1;
    }
    // Handle shop opens (legacy + new)
    if (e.event_type === "shop_open" || e.event_type === "offer_view") {
      existing.shopOpens += 1;
    }
  });

  return {
    analytics: {
      gameName: game.name,
      totalVisits,
      totalRevenue,
      totalPurchases,
      shopOpens,
      conversionRate: totalVisits > 0 ? (totalPurchases / totalVisits) * 100 : 0,
      products: products || [],
      dailyStats: Array.from(dailyStats.entries()).map(([date, stats]) => ({
        date,
        ...stats,
      })),
    },
    error: null,
  };
}

// Get analytics alerts based on real data
export async function getAnalyticsAlerts(): Promise<{ alerts: AnalyticsAlert[]; error: string | null }> {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    return { alerts: [], error: "Not authenticated" };
  }

  // Get user's games
  const { data: games } = await supabase
    .from("games")
    .select("id")
    .eq("user_id", user.id)
    .neq("status", "deleted");

  const gameIds = games?.map(g => g.id) || [];

  if (gameIds.length === 0) {
    return { alerts: [], error: null };
  }

  const alerts: AnalyticsAlert[] = [];
  const now = new Date();
  
  // Time periods
  const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  // Purchase event types
  const purchaseTypes = ["purchase_success", "gamepass_purchase", "devproduct_purchase"];
  const clickTypes = ["gamepass_click", "devproduct_click", "gamepass_prompt", "devproduct_prompt"];
  const sessionTypes = ["player_join", "session_start"];

  // Check 1: No events in last 6 hours
  const { data: recentEvents } = await supabase
    .from("events")
    .select("id")
    .in("game_id", gameIds)
    .gte("created_at", sixHoursAgo.toISOString())
    .limit(1);

  // Get total events to see if we ever had data
  const { count: totalEvents } = await supabase
    .from("events")
    .select("*", { count: "exact", head: true })
    .in("game_id", gameIds);

  if ((totalEvents || 0) > 0 && (!recentEvents || recentEvents.length === 0)) {
    alerts.push({
      id: "no_events_6h",
      type: "no_events",
      severity: "warning",
      title: "No events in 6 hours",
      message: "No tracking events received in the last 6 hours. Check your game integration.",
    });
  }

  // Get events for today and yesterday for comparison
  const { data: todayEvents } = await supabase
    .from("events")
    .select("event_type, robux")
    .in("game_id", gameIds)
    .gte("created_at", todayStart.toISOString());

  const { data: yesterdayEvents } = await supabase
    .from("events")
    .select("event_type, robux")
    .in("game_id", gameIds)
    .gte("created_at", yesterdayStart.toISOString())
    .lt("created_at", todayStart.toISOString());

  // Calculate today's stats
  const todayRevenue = (todayEvents || [])
    .filter(e => purchaseTypes.includes(e.event_type))
    .reduce((sum, e) => sum + (e.robux || 0), 0);
  const todayPurchases = (todayEvents || [])
    .filter(e => purchaseTypes.includes(e.event_type)).length;

  // Calculate yesterday's stats
  const yesterdayRevenue = (yesterdayEvents || [])
    .filter(e => purchaseTypes.includes(e.event_type))
    .reduce((sum, e) => sum + (e.robux || 0), 0);
  const yesterdayPurchases = (yesterdayEvents || [])
    .filter(e => purchaseTypes.includes(e.event_type)).length;

  // Check 2: Revenue drop today vs yesterday (if yesterday had revenue)
  if (yesterdayRevenue > 0) {
    const revenueChange = ((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100;
    if (revenueChange <= -10) {
      alerts.push({
        id: "revenue_drop_today",
        type: "revenue_drop",
        severity: revenueChange <= -30 ? "critical" : "warning",
        title: `Revenue down ${Math.abs(Math.round(revenueChange))}% today`,
        message: `Today: ${todayRevenue.toLocaleString()} Robux vs Yesterday: ${yesterdayRevenue.toLocaleString()} Robux`,
        value: todayRevenue,
        change: revenueChange,
      });
    }
  }

  // Check 3: Purchases drop today vs yesterday
  if (yesterdayPurchases >= 3) {
    const purchaseChange = ((todayPurchases - yesterdayPurchases) / yesterdayPurchases) * 100;
    if (purchaseChange <= -20) {
      alerts.push({
        id: "purchases_drop_today",
        type: "purchases_drop",
        severity: purchaseChange <= -50 ? "critical" : "warning",
        title: `Purchases down ${Math.abs(Math.round(purchaseChange))}% today`,
        message: `Today: ${todayPurchases} purchases vs Yesterday: ${yesterdayPurchases} purchases`,
        value: todayPurchases,
        change: purchaseChange,
      });
    }
  }

  // Check 4: Conversion rate drop (7-day comparison)
  const { data: currentWeekEvents } = await supabase
    .from("events")
    .select("event_type")
    .in("game_id", gameIds)
    .gte("created_at", sevenDaysAgo.toISOString());

  const { data: previousWeekEvents } = await supabase
    .from("events")
    .select("event_type")
    .in("game_id", gameIds)
    .gte("created_at", fourteenDaysAgo.toISOString())
    .lt("created_at", sevenDaysAgo.toISOString());

  const currentClicks = (currentWeekEvents || []).filter(e => clickTypes.includes(e.event_type)).length;
  const currentPurchases = (currentWeekEvents || []).filter(e => purchaseTypes.includes(e.event_type)).length;
  const currentConversion = currentClicks > 0 ? (currentPurchases / currentClicks) * 100 : 0;

  const prevClicks = (previousWeekEvents || []).filter(e => clickTypes.includes(e.event_type)).length;
  const prevPurchases = (previousWeekEvents || []).filter(e => purchaseTypes.includes(e.event_type)).length;
  const prevConversion = prevClicks > 0 ? (prevPurchases / prevClicks) * 100 : 0;

  if (prevConversion > 0 && prevClicks >= 10) {
    const conversionChange = ((currentConversion - prevConversion) / prevConversion) * 100;
    if (conversionChange <= -15) {
      alerts.push({
        id: "conversion_drop_week",
        type: "conversion_drop",
        severity: conversionChange <= -30 ? "critical" : "warning",
        title: `Conversion down ${Math.abs(Math.round(conversionChange))}% this week`,
        message: `This week: ${currentConversion.toFixed(1)}% vs Last week: ${prevConversion.toFixed(1)}%`,
        value: currentConversion,
        change: conversionChange,
      });
    }
  }

  return { alerts, error: null };
}

export interface AnalyticsAlert {
  id: string;
  type: "revenue_drop" | "purchases_drop" | "no_events" | "conversion_drop" | "info";
  severity: "warning" | "critical" | "info";
  title: string;
  message: string;
  value?: number;
  change?: number;
}

export interface GameAnalytics {
  gameName: string;
  totalVisits: number;
  totalRevenue: number;
  totalPurchases: number;
  shopOpens: number;
  conversionRate: number;
  products: Array<{
    id: string;
    name: string;
    product_type: string;
    total_revenue: number;
    total_purchases: number;
    total_clicks: number;
  }>;
  dailyStats: Array<{
    date: string;
    visits: number;
    revenue: number;
    purchases: number;
    shopOpens: number;
  }>;
}
