"use server";

import { createClient } from "@/lib/supabase/server";

export interface AIContext {
  hasData: boolean;
  totalRevenue: number;
  totalEvents: number;
  totalPurchases: number;
  totalClicks: number;
  conversionRate: number;
  uniquePlayers: number;
  revenueByType: { gamepass: number; devproduct: number };
  topProducts: {
    name: string;
    revenue: number;
    purchases: number;
    clicks: number;
    conversionRate: number;
    productType: string;
  }[];
  // Worst converting product (with enough clicks)
  worstConvertingProduct: {
    name: string;
    clicks: number;
    purchases: number;
    conversionRate: number;
  } | null;
  // 7-day trends
  trends: {
    revenueChange: number; // percentage change
    purchaseChange: number;
    playerChange: number;
    currentWeekRevenue: number;
    previousWeekRevenue: number;
    currentWeekPurchases: number;
    previousWeekPurchases: number;
    currentWeekPlayers: number;
    previousWeekPlayers: number;
  };
  recentEvents: {
    eventType: string;
    productName: string | null;
    robux: number;
    createdAt: string;
  }[];
  gameName: string | null;
}

export async function getAIContext(): Promise<{ context: AIContext | null; error: string | null }> {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    return { context: null, error: "Not authenticated" };
  }

  // Get user's active games
  const { data: games } = await supabase
    .from("games")
    .select("id, name")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1);

  if (!games || games.length === 0) {
    return { 
      context: {
        hasData: false,
        totalRevenue: 0,
        totalEvents: 0,
        totalPurchases: 0,
        totalClicks: 0,
        conversionRate: 0,
        uniquePlayers: 0,
        revenueByType: { gamepass: 0, devproduct: 0 },
        topProducts: [],
        worstConvertingProduct: null,
        trends: {
          revenueChange: 0,
          purchaseChange: 0,
          playerChange: 0,
          currentWeekRevenue: 0,
          previousWeekRevenue: 0,
          currentWeekPurchases: 0,
          previousWeekPurchases: 0,
          currentWeekPlayers: 0,
          previousWeekPlayers: 0,
        },
        recentEvents: [],
        gameName: null,
      }, 
      error: null 
    };
  }

  const game = games[0];
  const gameId = game.id;

  // Get all events for this game
  const { data: allEvents } = await supabase
    .from("events")
    .select("event_type, player_id, product_id, product_name, product_type, robux, created_at")
    .eq("game_id", gameId)
    .order("created_at", { ascending: false });

  if (!allEvents || allEvents.length === 0) {
    return { 
      context: {
        hasData: false,
        totalRevenue: 0,
        totalEvents: 0,
        totalPurchases: 0,
        totalClicks: 0,
        conversionRate: 0,
        uniquePlayers: 0,
        revenueByType: { gamepass: 0, devproduct: 0 },
        topProducts: [],
        worstConvertingProduct: null,
        trends: {
          revenueChange: 0,
          purchaseChange: 0,
          playerChange: 0,
          currentWeekRevenue: 0,
          previousWeekRevenue: 0,
          currentWeekPurchases: 0,
          previousWeekPurchases: 0,
          currentWeekPlayers: 0,
          previousWeekPlayers: 0,
        },
        recentEvents: [],
        gameName: game.name,
      }, 
      error: null 
    };
  }

  // Event type groups (legacy + new Roblox events)
  const purchaseEventTypes = ["purchase_success", "gamepass_purchase", "devproduct_purchase"];
  const clickEventTypes = ["gamepass_click", "devproduct_click", "gamepass_prompt", "devproduct_prompt"];
  const sessionStartTypes = ["player_join", "session_start"];
  
  // Calculate stats
  const purchaseEvents = allEvents.filter(e => purchaseEventTypes.includes(e.event_type));
  const clickEvents = allEvents.filter(e => clickEventTypes.includes(e.event_type));
  const sessionEvents = allEvents.filter(e => sessionStartTypes.includes(e.event_type));
  
  const totalRevenue = purchaseEvents.reduce((sum, e) => sum + (e.robux || 0), 0);
  const totalPurchases = purchaseEvents.length;
  const totalClicks = clickEvents.length;
  const conversionRate = totalClicks > 0 ? (totalPurchases / totalClicks) * 100 : 0;
  
  // Unique players
  const uniquePlayers = new Set(allEvents.map(e => e.player_id).filter(Boolean)).size;
  
  // Revenue by type (check product_type or event_type)
  const gamepassRevenue = purchaseEvents
    .filter(e => e.product_type === "gamepass" || e.event_type === "gamepass_purchase")
    .reduce((sum, e) => sum + (e.robux || 0), 0);
  const devproductRevenue = purchaseEvents
    .filter(e => e.product_type === "devproduct" || e.event_type === "devproduct_purchase")
    .reduce((sum, e) => sum + (e.robux || 0), 0);

  // Calculate top products
  const productMap = new Map<string, {
    name: string;
    revenue: number;
    purchases: number;
    clicks: number;
    productType: string;
  }>();

  purchaseEvents.forEach(e => {
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
        clicks: 0,
        productType: e.product_type || "gamepass",
      });
    }
  });

  // Add clicks to products
  clickEvents.forEach(e => {
    const key = e.product_id || e.product_name || "unknown";
    const existing = productMap.get(key);
    if (existing) {
      existing.clicks += 1;
    } else {
      productMap.set(key, {
        name: e.product_name || "Unknown",
        revenue: 0,
        purchases: 0,
        clicks: 1,
        productType: e.product_type || "gamepass",
      });
    }
  });

  const allProductStats = Array.from(productMap.values())
    .map(p => ({
      ...p,
      conversionRate: p.clicks > 0 ? (p.purchases / p.clicks) * 100 : 0,
    }));
  
  const topProducts = [...allProductStats]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  // Find worst converting product (min 5 clicks to be meaningful)
  const productsWithClicks = allProductStats.filter(p => p.clicks >= 5);
  const worstConvertingProduct = productsWithClicks.length > 0
    ? [...productsWithClicks].sort((a, b) => a.conversionRate - b.conversionRate)[0]
    : null;

  // Calculate 7-day trends
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const currentWeekEvents = allEvents.filter(e => new Date(e.created_at) >= sevenDaysAgo);
  const previousWeekEvents = allEvents.filter(e => {
    const date = new Date(e.created_at);
    return date >= fourteenDaysAgo && date < sevenDaysAgo;
  });

  const currentWeekPurchases = currentWeekEvents.filter(e => purchaseEventTypes.includes(e.event_type));
  const previousWeekPurchases = previousWeekEvents.filter(e => purchaseEventTypes.includes(e.event_type));

  const currentWeekRevenue = currentWeekPurchases.reduce((sum, e) => sum + (e.robux || 0), 0);
  const previousWeekRevenue = previousWeekPurchases.reduce((sum, e) => sum + (e.robux || 0), 0);

  const currentWeekPlayers = new Set(
    currentWeekEvents.filter(e => sessionStartTypes.includes(e.event_type)).map(e => e.player_id).filter(Boolean)
  ).size;
  const previousWeekPlayers = new Set(
    previousWeekEvents.filter(e => sessionStartTypes.includes(e.event_type)).map(e => e.player_id).filter(Boolean)
  ).size;

  const revenueChange = previousWeekRevenue > 0 
    ? ((currentWeekRevenue - previousWeekRevenue) / previousWeekRevenue) * 100 
    : (currentWeekRevenue > 0 ? 100 : 0);
  const purchaseChange = previousWeekPurchases.length > 0 
    ? ((currentWeekPurchases.length - previousWeekPurchases.length) / previousWeekPurchases.length) * 100 
    : (currentWeekPurchases.length > 0 ? 100 : 0);
  const playerChange = previousWeekPlayers > 0 
    ? ((currentWeekPlayers - previousWeekPlayers) / previousWeekPlayers) * 100 
    : (currentWeekPlayers > 0 ? 100 : 0);

  // Recent events (last 10)
  const recentEvents = allEvents.slice(0, 10).map(e => ({
    eventType: e.event_type,
    productName: e.product_name,
    robux: e.robux || 0,
    createdAt: e.created_at,
  }));

  return {
    context: {
      hasData: true,
      totalRevenue,
      totalEvents: allEvents.length,
      totalPurchases,
      totalClicks,
      conversionRate,
      uniquePlayers,
      revenueByType: { gamepass: gamepassRevenue, devproduct: devproductRevenue },
      topProducts,
      worstConvertingProduct: worstConvertingProduct ? {
        name: worstConvertingProduct.name,
        clicks: worstConvertingProduct.clicks,
        purchases: worstConvertingProduct.purchases,
        conversionRate: worstConvertingProduct.conversionRate,
      } : null,
      trends: {
        revenueChange,
        purchaseChange,
        playerChange,
        currentWeekRevenue,
        previousWeekRevenue,
        currentWeekPurchases: currentWeekPurchases.length,
        previousWeekPurchases: previousWeekPurchases.length,
        currentWeekPlayers,
        previousWeekPlayers,
      },
      recentEvents,
      gameName: game.name,
    },
    error: null,
  };
}


