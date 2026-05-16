"use server";

import { createClient } from "@/lib/supabase/server";
import { getSelectedGameId } from "./analytics";

export interface MonetizationStats {
  totalRevenue: number;
  passesRevenue: number;
  devProductsRevenue: number;
  totalPurchases: number;
  payingUsers: number;
  uniquePlayers: number;
  payerConversionRate: number;
  arppu: number;
  arpdau: number;
}

export interface HourlyRevenue {
  time: string;
  hour: number;
  total: number;
  passes: number;
  devProducts: number;
}

export interface DailyRevenue {
  date: string;
  revenue: number;
}

export interface RevenueSource {
  name: string;
  value: number;
  color: string;
}

export interface DailyMetric {
  date: string;
  value: number;
}

export interface TopProduct {
  id: string;
  name: string;
  type: string;
  revenue: number;
  purchases: number;
  conversion: number;
}

export async function getMonetizationStats(gameId?: string): Promise<{
  stats: MonetizationStats | null;
  hourlyRevenue: HourlyRevenue[];
  dailyRevenue: DailyRevenue[];
  revenueSources: RevenueSource[];
  payingUsersOverTime: DailyMetric[];
  conversionOverTime: DailyMetric[];
  arppuOverTime: DailyMetric[];
  arpdauOverTime: DailyMetric[];
  topProducts: TopProduct[];
  error: string | null;
}> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return {
      stats: null,
      hourlyRevenue: [],
      dailyRevenue: [],
      revenueSources: [],
      payingUsersOverTime: [],
      conversionOverTime: [],
      arppuOverTime: [],
      arpdauOverTime: [],
      topProducts: [],
      error: "Not authenticated",
    };
  }

  // Check plan access - monetization is Pro+ only
  const { data: profile } = await supabase
    .from("profiles")
    .select("plan")
    .eq("id", user.id)
    .single();

  const userPlan = profile?.plan || "free";
  if (userPlan === "free") {
    return {
      stats: null,
      hourlyRevenue: [],
      dailyRevenue: [],
      revenueSources: [],
      payingUsersOverTime: [],
      conversionOverTime: [],
      arppuOverTime: [],
      arpdauOverTime: [],
      topProducts: [],
      error: "Monetization analytics requires Pro or Studio plan",
    };
  }

  // Get the selected game (use passed gameId or get from DB)
  let targetGameId = gameId;
  if (!targetGameId) {
    const { gameId: selectedId } = await getSelectedGameId();
    targetGameId = selectedId || undefined;
  }

  // If no game selected, return empty stats
  const gameIds = targetGameId ? [targetGameId] : [];

  if (gameIds.length === 0) {
    return {
      stats: {
        totalRevenue: 0,
        passesRevenue: 0,
        devProductsRevenue: 0,
        totalPurchases: 0,
        payingUsers: 0,
        uniquePlayers: 0,
        payerConversionRate: 0,
        arppu: 0,
        arpdau: 0,
      },
      hourlyRevenue: [],
      dailyRevenue: [],
      revenueSources: [],
      payingUsersOverTime: [],
      conversionOverTime: [],
      arppuOverTime: [],
      arpdauOverTime: [],
      topProducts: [],
      error: null,
    };
  }

  // Purchase event types (legacy + new Roblox events)
  const purchaseTypes = ["purchase_success", "gamepass_purchase", "devproduct_purchase"];

  // Use server-side count for total purchases (no 1000 row limit)
  const { count: totalPurchasesCount } = await supabase
    .from("events")
    .select("*", { count: "exact", head: true })
    .in("game_id", gameIds)
    .in("event_type", purchaseTypes);

  // Get all purchase events for revenue calculation and breakdown
  const { data: purchaseEvents } = await supabase
    .from("events")
    .select("*")
    .in("game_id", gameIds)
    .in("event_type", purchaseTypes);

  // Get all other events for player tracking
  const { data: allEvents } = await supabase
    .from("events")
    .select("player_id, created_at, event_type")
    .in("game_id", gameIds)
    .order("created_at", { ascending: false });

  const events = allEvents || [];
  const purchases = purchaseEvents || [];

  // Calculate revenue from purchase events
  const totalRevenue = purchases.reduce((sum, e) => sum + (e.robux || 0), 0);
  // Gamepass revenue: explicit gamepass type OR gamepass_purchase event type
  const passesRevenue = purchases
    .filter((e) => e.product_type === "gamepass" || e.event_type === "gamepass_purchase")
    .reduce((sum, e) => sum + (e.robux || 0), 0);
  // Dev product revenue: explicit devproduct type OR devproduct_purchase event type  
  const devProductsRevenue = purchases
    .filter((e) => e.product_type === "devproduct" || e.event_type === "devproduct_purchase")
    .reduce((sum, e) => sum + (e.robux || 0), 0);
  // Use server-side count for total purchases
  const totalPurchases = totalPurchasesCount || 0;

  // Unique paying users
  const payingUserIds = new Set(purchases.map((e) => e.player_id).filter(Boolean));
  const payingUsers = payingUserIds.size;

  // Unique players (all events)
  const allPlayerIds = new Set(events.map((e) => e.player_id).filter(Boolean));
  const uniquePlayers = allPlayerIds.size;

  // Payer conversion rate
  const payerConversionRate = uniquePlayers > 0 ? (payingUsers / uniquePlayers) * 100 : 0;

  // ARPPU (Average Revenue Per Paying User) = Revenue / Distinct Paying Users
  const arppu = payingUsers > 0 ? totalRevenue / payingUsers : 0;

  // Calculate Average DAU for ARPDAU
  // Group all events by day and count distinct players per day
  const dailyActivePlayers = new Map<string, Set<string>>();
  events.forEach((e) => {
    if (!e.player_id || !e.created_at) return;
    const day = new Date(e.created_at).toISOString().slice(0, 10); // YYYY-MM-DD
    if (!dailyActivePlayers.has(day)) {
      dailyActivePlayers.set(day, new Set());
    }
    dailyActivePlayers.get(day)!.add(e.player_id);
  });
  
  // Calculate average daily active users
  const daysWithData = dailyActivePlayers.size;
  let averageDau = 0;
  if (daysWithData > 0) {
    const totalDailyPlayers = Array.from(dailyActivePlayers.values())
      .reduce((sum, players) => sum + players.size, 0);
    averageDau = totalDailyPlayers / daysWithData;
  }

  // ARPDAU (Average Revenue Per Daily Active User) = Revenue / Average DAU
  // For ranges < 24h, use total unique players in the period as DAU proxy
  const arpdau = averageDau > 0 ? totalRevenue / averageDau : 0;

  // Hourly revenue (last 72 hours)
  const now = new Date();
  const hourlyRevenue: HourlyRevenue[] = [];
  for (let i = 71; i >= 0; i--) {
    const hourStart = new Date(now.getTime() - i * 60 * 60 * 1000);
    const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000);
    const hourStr = hourStart.getHours();
    const dayStr = hourStart.toLocaleDateString("en-US", { weekday: "short" });

    const hourEvents = purchases.filter((e) => {
      const eventTime = new Date(e.created_at);
      return eventTime >= hourStart && eventTime < hourEnd;
    });

    const total = hourEvents.reduce((sum, e) => sum + (e.robux || 0), 0);
    const passes = hourEvents
      .filter((e) => e.product_type === "gamepass")
      .reduce((sum, e) => sum + (e.robux || 0), 0);
    const devProducts = hourEvents
      .filter((e) => e.product_type === "devproduct")
      .reduce((sum, e) => sum + (e.robux || 0), 0);

    hourlyRevenue.push({
      time: `${dayStr} ${hourStr}:00`,
      hour: hourStr,
      total,
      passes,
      devProducts,
    });
  }

  // Daily revenue (last 28 days)
  const dailyRevenue: DailyRevenue[] = [];
  for (let i = 27; i >= 0; i--) {
    const dayStart = new Date(now);
    dayStart.setDate(dayStart.getDate() - i);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const dayPurchaseEvents = purchases.filter((e) => {
      const eventTime = new Date(e.created_at);
      return eventTime >= dayStart && eventTime < dayEnd;
    });

    const revenue = dayPurchaseEvents.reduce((sum, e) => sum + (e.robux || 0), 0);

    dailyRevenue.push({
      date: dayStart.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      revenue,
    });
  }

  // Revenue sources
  const revenueSources: RevenueSource[] = [
    { name: "Gamepasses", value: passesRevenue, color: "var(--primary)" },
    { name: "Dev Products", value: devProductsRevenue, color: "#22c55e" },
  ];

  // Daily metrics for charts
  const payingUsersOverTime: DailyMetric[] = [];
  const conversionOverTime: DailyMetric[] = [];
  const arppuOverTime: DailyMetric[] = [];
  const arpdauOverTime: DailyMetric[] = [];

  for (let i = 27; i >= 0; i--) {
    const dayStart = new Date(now);
    dayStart.setDate(dayStart.getDate() - i);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const dateStr = dayStart.toLocaleDateString("en-US", { month: "short", day: "numeric" });

    const dayAllEvents = events.filter((e) => {
      const eventTime = new Date(e.created_at);
      return eventTime >= dayStart && eventTime < dayEnd;
    });

    const dayPurchasesForMetrics = purchases.filter((e) => {
      const eventTime = new Date(e.created_at);
      return eventTime >= dayStart && eventTime < dayEnd;
    });
    const dayPayingUsers = new Set(dayPurchasesForMetrics.map((e) => e.player_id).filter(Boolean)).size;
    const dayUniquePlayers = new Set(dayAllEvents.map((e) => e.player_id).filter(Boolean)).size;
    const dayRevenue = dayPurchasesForMetrics.reduce((sum, e) => sum + (e.robux || 0), 0);

    payingUsersOverTime.push({ date: dateStr, value: dayPayingUsers });
    conversionOverTime.push({
      date: dateStr,
      value: dayUniquePlayers > 0 ? (dayPayingUsers / dayUniquePlayers) * 100 : 0,
    });
    arppuOverTime.push({
      date: dateStr,
      value: dayPayingUsers > 0 ? dayRevenue / dayPayingUsers : 0,
    });
    arpdauOverTime.push({
      date: dateStr,
      value: dayUniquePlayers > 0 ? dayRevenue / dayUniquePlayers : 0,
    });
  }

  // Top products from events
  const productMap = new Map<string, { name: string; type: string; revenue: number; purchases: number; clicks: number }>();
  
  purchases.forEach((e) => {
    const key = e.product_id || e.product_name || "unknown";
    const existing = productMap.get(key);
    if (existing) {
      existing.revenue += e.robux || 0;
      existing.purchases += 1;
    } else {
      productMap.set(key, {
        name: e.product_name || "Unknown Product",
        type: e.product_type || "gamepass",
        revenue: e.robux || 0,
        purchases: 1,
        clicks: 0,
      });
    }
  });

  // Count clicks
  events
    .filter((e) => e.event_type === "gamepass_click" || e.event_type === "devproduct_click")
    .forEach((e) => {
      const key = e.product_id || e.product_name || "unknown";
      const existing = productMap.get(key);
      if (existing) {
        existing.clicks += 1;
      }
    });

  const topProducts: TopProduct[] = Array.from(productMap.entries())
    .map(([id, data]) => ({
      id,
      name: data.name,
      type: data.type === "gamepass" ? "Gamepass" : "Dev Product",
      revenue: data.revenue,
      purchases: data.purchases,
      conversion: data.clicks > 0 ? (data.purchases / data.clicks) * 100 : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  return {
    stats: {
      totalRevenue,
      passesRevenue,
      devProductsRevenue,
      totalPurchases,
      payingUsers,
      uniquePlayers,
      payerConversionRate,
      arppu,
      arpdau,
    },
    hourlyRevenue,
    dailyRevenue,
    revenueSources,
    payingUsersOverTime,
    conversionOverTime,
    arppuOverTime,
    arpdauOverTime,
    topProducts,
    error: null,
  };
}
