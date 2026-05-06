"use server";

import { createClient } from "@/lib/supabase/server";
import { getSelectedGameId } from "./analytics";

export interface ProductStats {
  product_id: string;
  name: string;
  product_type: string;
  revenue: number;
  purchases: number;
  clicks: number;
  conversion_rate: number;
  unique_buyers: number;
  revenue_per_player: number;
  avg_price: number;
  game_id: string;
  game_name: string;
  // Computed badges
  badges: ("best_seller" | "high_conversion" | "low_performer")[];
}

export async function getProductStats(): Promise<{
  products: ProductStats[] | null;
  error: string | null;
}> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { products: null, error: "Not authenticated" };
  }

  // Get the selected game
  const { gameId: selectedGameId } = await getSelectedGameId();
  
  if (!selectedGameId) {
    return { products: [], error: null };
  }

  // Get the selected game's name
  const { data: game } = await supabase
    .from("games")
    .select("id, name")
    .eq("id", selectedGameId)
    .single();

  if (!game) {
    return { products: [], error: null };
  }

  const gameIds = [selectedGameId];
  const gameMap = new Map([[game.id, game.name]]);

  // Purchase event types (legacy + new Roblox events)
  const purchaseEventTypes = ["purchase_success", "gamepass_purchase", "devproduct_purchase"];
  const clickEventTypes = ["gamepass_click", "devproduct_click", "gamepass_prompt", "devproduct_prompt"];

  // Get all purchase events for revenue calculation
  const { data: purchaseEvents } = await supabase
    .from("events")
    .select("product_id, product_name, product_type, robux, game_id, player_id")
    .in("game_id", gameIds)
    .in("event_type", purchaseEventTypes);

  // Get all click events for clicks calculation
  const { data: clickEvents } = await supabase
    .from("events")
    .select("product_id, product_name, product_type, game_id, player_id")
    .in("game_id", gameIds)
    .in("event_type", clickEventTypes);

  // Get unique players who visited the game (for revenue per player calculation)
  const { data: sessionEvents } = await supabase
    .from("events")
    .select("player_id, game_id")
    .in("game_id", gameIds)
    .in("event_type", ["player_join", "session_start"]);

  // Count unique players per game
  const uniquePlayersPerGame = new Map<string, Set<string>>();
  (sessionEvents || []).forEach((e) => {
    if (e.player_id) {
      if (!uniquePlayersPerGame.has(e.game_id)) {
        uniquePlayersPerGame.set(e.game_id, new Set());
      }
      uniquePlayersPerGame.get(e.game_id)!.add(e.player_id);
    }
  });

  // Build product stats map
  const productStatsMap = new Map<string, {
    product_id: string;
    name: string;
    product_type: string;
    revenue: number;
    purchases: number;
    clicks: number;
    unique_buyers: Set<string>;
    clickers: Set<string>;
    game_id: string;
  }>();

  // Process purchase events
  (purchaseEvents || []).forEach((e) => {
    const productKey = e.product_id || e.product_name || "unknown";
    const existing = productStatsMap.get(productKey);
    if (existing) {
      existing.revenue += e.robux || 0;
      existing.purchases += 1;
      if (e.player_id) existing.unique_buyers.add(e.player_id);
    } else {
      const buyers = new Set<string>();
      if (e.player_id) buyers.add(e.player_id);
      productStatsMap.set(productKey, {
        product_id: e.product_id || productKey,
        name: e.product_name || "Unknown Product",
        product_type: e.product_type || "gamepass",
        revenue: e.robux || 0,
        purchases: 1,
        clicks: 0,
        unique_buyers: buyers,
        clickers: new Set(),
        game_id: e.game_id,
      });
    }
  });

  // Process click events
  (clickEvents || []).forEach((e) => {
    const productKey = e.product_id || e.product_name || "unknown";
    const existing = productStatsMap.get(productKey);
    if (existing) {
      existing.clicks += 1;
      if (e.player_id) existing.clickers.add(e.player_id);
    } else {
      const clickers = new Set<string>();
      if (e.player_id) clickers.add(e.player_id);
      productStatsMap.set(productKey, {
        product_id: e.product_id || productKey,
        name: e.product_name || "Unknown Product",
        product_type: e.product_type || "gamepass",
        revenue: 0,
        purchases: 0,
        clicks: 1,
        unique_buyers: new Set(),
        clickers: clickers,
        game_id: e.game_id,
      });
    }
  });

  // Convert to array with calculated metrics
  const productsRaw = Array.from(productStatsMap.values()).map((p) => {
    const totalPlayers = uniquePlayersPerGame.get(p.game_id)?.size || 1;
    const conversionRate = p.clicks > 0 ? (p.purchases / p.clicks) * 100 : 0;
    const uniqueBuyers = p.unique_buyers.size;
    const revenuePerPlayer = totalPlayers > 0 ? p.revenue / totalPlayers : 0;
    const avgPrice = p.purchases > 0 ? p.revenue / p.purchases : 0;
    
    return {
      product_id: p.product_id,
      name: p.name,
      product_type: p.product_type,
      revenue: p.revenue,
      purchases: p.purchases,
      clicks: p.clicks,
      conversion_rate: conversionRate,
      unique_buyers: uniqueBuyers,
      revenue_per_player: revenuePerPlayer,
      avg_price: avgPrice,
      game_id: p.game_id,
      game_name: gameMap.get(p.game_id) || "Unknown",
      badges: [] as ("best_seller" | "high_conversion" | "low_performer")[],
    };
  });

  // Calculate badges based on percentiles
  if (productsRaw.length > 0) {
    const sortedByRevenue = [...productsRaw].sort((a, b) => b.revenue - a.revenue);
    const sortedByConversion = [...productsRaw].sort((a, b) => b.conversion_rate - a.conversion_rate);
    
    // Top 20% by revenue = Best Seller
    const topRevenueThreshold = Math.ceil(productsRaw.length * 0.2);
    sortedByRevenue.slice(0, topRevenueThreshold).forEach((p) => {
      if (p.revenue > 0) {
        const product = productsRaw.find((pr) => pr.product_id === p.product_id);
        if (product) product.badges.push("best_seller");
      }
    });
    
    // Top 20% by conversion (with min 5 clicks) = High Conversion
    const productsWithClicks = sortedByConversion.filter((p) => p.clicks >= 5);
    const topConversionThreshold = Math.ceil(productsWithClicks.length * 0.2);
    productsWithClicks.slice(0, topConversionThreshold).forEach((p) => {
      if (p.conversion_rate >= 15) { // At least 15% conversion
        const product = productsRaw.find((pr) => pr.product_id === p.product_id);
        if (product && !product.badges.includes("best_seller")) {
          product.badges.push("high_conversion");
        }
      }
    });
    
    // Bottom 20% by conversion (with min 10 clicks but <5% conversion) = Low Performer
    const lowPerformers = productsWithClicks.filter((p) => p.clicks >= 10 && p.conversion_rate < 5);
    lowPerformers.forEach((p) => {
      const product = productsRaw.find((pr) => pr.product_id === p.product_id);
      if (product && product.badges.length === 0) {
        product.badges.push("low_performer");
      }
    });
  }

  const products: ProductStats[] = productsRaw;

  return { products, error: null };
}
