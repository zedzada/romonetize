/**
 * Shared Purchase Metrics Helper
 * 
 * Single source of truth for Products and Monetization pages.
 * Both pages MUST use this helper to ensure consistent numbers.
 * 
 * Data source: events table with purchase event types
 * Does NOT call external Roblox APIs to avoid timeouts.
 */

import { createClient } from "@/lib/supabase/server";

// Roblox takes 30%, creators get 70%
export const CREATOR_REVENUE_RATE = 0.7;

// Purchase event types
export const PURCHASE_EVENT_TYPES = [
  "purchase_success",
  "devproduct_purchase",
  "gamepass_purchase",
];

// Active user event types (for PCR calculation)
export const ACTIVE_USER_EVENT_TYPES = [
  "player_join",
  "session_start",
  "session_end",
  "purchase_success",
  "devproduct_purchase",
  "gamepass_purchase",
];

// Range configurations
export type PurchaseMetricsRange = "1h" | "6h" | "24h" | "72h" | "7d" | "28d" | "90d";

interface RangeConfig {
  hours: number;
  bucketMs: number;
  bucketType: "minute" | "hour" | "day";
}

export function getRangeConfig(range: PurchaseMetricsRange): RangeConfig {
  switch (range) {
    case "1h":
      return { hours: 1, bucketMs: 60 * 1000, bucketType: "minute" };
    case "6h":
      return { hours: 6, bucketMs: 60 * 1000, bucketType: "minute" };
    case "24h":
      return { hours: 24, bucketMs: 60 * 60 * 1000, bucketType: "hour" };
    case "72h":
      return { hours: 72, bucketMs: 60 * 60 * 1000, bucketType: "hour" };
    case "7d":
      return { hours: 168, bucketMs: 24 * 60 * 60 * 1000, bucketType: "day" };
    case "28d":
      return { hours: 672, bucketMs: 24 * 60 * 60 * 1000, bucketType: "day" };
    case "90d":
      return { hours: 2160, bucketMs: 24 * 60 * 60 * 1000, bucketType: "day" };
    default:
      return { hours: 672, bucketMs: 24 * 60 * 60 * 1000, bucketType: "day" };
  }
}

// Product info extracted from event
export interface ProductInfo {
  productId: string;
  productName: string;
  productType: "gamepass" | "devproduct" | "unknown";
  price: number;
}

// Aggregated product metrics
export interface ProductMetrics {
  productId: string;
  productName: string;
  productType: "gamepass" | "devproduct" | "unknown";
  purchases: number;
  buyers: number;
  grossRevenue: number;
  estimatedRevenue: number;
  revPerBuyer: number;
}

// Time series point for charts
export interface TimeSeriesPoint {
  time: string;
  totalRevenue: number;
  gamepassesRevenue: number;
  devProductsRevenue: number;
  purchases: number;
  gamepassPurchases: number;
  devproductPurchases: number;
}

// Full result from getPurchaseMetrics
export interface PurchaseMetricsResult {
  // Summary stats
  purchases: number;
  payingUsers: number;
  activeUsers: number;
  grossRevenue: number;
  estimatedRevenue: number;
  arppu: number | null;
  payerConversionRate: number | null;
  
  // Products list
  products: ProductMetrics[];
  
  // Time series for charts
  timeSeries: TimeSeriesPoint[];
  
  // Debug info
  debug: {
    selectedGameId: string;
    range: string;
    purchaseEventsFound: number;
    productCount: number;
    firstPurchaseAt: string | null;
    latestPurchaseAt: string | null;
    samplePurchaseMetadata: Array<Record<string, unknown>>;
    activeUsersCount: number;
    rangeStartIso: string;
    rangeEndIso: string;
  };
}

/**
 * Extract product info from event metadata
 */
function extractProductInfo(event: {
  event_type: string;
  metadata: Record<string, unknown> | null;
  product_id?: string | null;
  product_name?: string | null;
  product_type?: string | null;
  robux?: number | null;
}): ProductInfo {
  const meta = event.metadata ?? {};
  
  const productId = String(
    event.product_id ??
    meta.product_id ??
    meta.productId ??
    meta.asset_id ??
    meta.assetId ??
    meta.gamepass_id ??
    meta.gamePassId ??
    meta.pass_id ??
    meta.passId ??
    meta.id ??
    "unknown"
  );
  
  const productName = String(
    event.product_name ??
    meta.product_name ??
    meta.productName ??
    meta.name ??
    meta.item_name ??
    meta.itemName ??
    `Product ${productId}`
  );
  
  // Determine product type from event_type or metadata
  let productType: "gamepass" | "devproduct" | "unknown" = "unknown";
  if (event.event_type === "gamepass_purchase") {
    productType = "gamepass";
  } else if (event.event_type === "devproduct_purchase") {
    productType = "devproduct";
  } else if (event.product_type) {
    const pt = event.product_type.toLowerCase();
    if (pt.includes("gamepass") || pt.includes("pass")) {
      productType = "gamepass";
    } else if (pt.includes("devproduct") || pt.includes("dev")) {
      productType = "devproduct";
    }
  } else if (meta.product_type) {
    const pt = String(meta.product_type).toLowerCase();
    if (pt.includes("gamepass") || pt.includes("pass")) {
      productType = "gamepass";
    } else if (pt.includes("devproduct") || pt.includes("dev")) {
      productType = "devproduct";
    }
  }
  
  const price = Number(
    event.robux ??
    meta.price ??
    meta.robux ??
    meta.amount ??
    meta.revenue ??
    meta.priceInRobux ??
    0
  );
  
  return { productId, productName, productType, price };
}

/**
 * Get bucket key for a timestamp
 */
function getBucketKey(timestamp: string, bucketType: "minute" | "hour" | "day"): string {
  const date = new Date(timestamp);
  
  if (bucketType === "minute") {
    return new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      date.getHours(),
      date.getMinutes(),
      0,
      0
    ).toISOString();
  } else if (bucketType === "hour") {
    return new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      date.getHours(),
      0,
      0,
      0
    ).toISOString();
  } else {
    // day
    return new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      0,
      0,
      0,
      0
    ).toISOString();
  }
}

/**
 * Generate all bucket keys in a range
 */
function generateBucketKeys(
  rangeStart: Date,
  rangeEnd: Date,
  bucketMs: number,
  bucketType: "minute" | "hour" | "day"
): string[] {
  const keys: string[] = [];
  let current = new Date(getBucketKey(rangeStart.toISOString(), bucketType));
  const end = rangeEnd.getTime();
  
  while (current.getTime() <= end) {
    keys.push(current.toISOString());
    current = new Date(current.getTime() + bucketMs);
  }
  
  return keys;
}

/**
 * Main function: Get purchase metrics for a game
 * 
 * This is fast because it:
 * - Only queries the events table (no external APIs)
 * - Uses targeted queries for purchase events only
 * - Limits pagination to reasonable amounts
 */
export async function getPurchaseMetrics(opts: {
  gameId: string;
  range: PurchaseMetricsRange;
  supabase?: Awaited<ReturnType<typeof createClient>>;
}): Promise<PurchaseMetricsResult> {
  const { gameId, range } = opts;
  const supabase = opts.supabase ?? await createClient();
  
  const rangeConfig = getRangeConfig(range);
  const now = new Date();
  const rangeStart = new Date(now.getTime() - rangeConfig.hours * 60 * 60 * 1000);
  
  // Fetch purchase events with pagination
  const purchaseEvents: Array<{
    id: string;
    event_type: string;
    player_id: string | null;
    product_id: string | null;
    product_name: string | null;
    product_type: string | null;
    robux: number | null;
    created_at: string;
    metadata: Record<string, unknown> | null;
  }> = [];
  
  const PAGE_SIZE = 1000;
  const MAX_PAGES = 10; // Safety limit: 10,000 events max
  let from = 0;
  let hasMore = true;
  let pagesFetched = 0;
  
  while (hasMore && pagesFetched < MAX_PAGES) {
    const { data, error } = await supabase
      .from("events")
      .select("id, event_type, player_id, product_id, product_name, product_type, robux, created_at, metadata")
      .eq("game_id", gameId)
      .in("event_type", PURCHASE_EVENT_TYPES)
      .gte("created_at", rangeStart.toISOString())
      .lte("created_at", now.toISOString())
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    
    if (error) {
      console.error("[purchase-metrics] Error fetching purchase events:", error);
      hasMore = false;
    } else if (data && data.length > 0) {
      purchaseEvents.push(...data);
      pagesFetched++;
      from += PAGE_SIZE;
      hasMore = data.length === PAGE_SIZE;
    } else {
      hasMore = false;
    }
  }
  
  // Fetch active users count (distinct player_id from active user events)
  let activeUsers = 0;
  try {
    // Use SQL aggregation for efficiency
    const { data: activeData, error: activeError } = await supabase
      .from("events")
      .select("player_id")
      .eq("game_id", gameId)
      .in("event_type", ACTIVE_USER_EVENT_TYPES)
      .gte("created_at", rangeStart.toISOString())
      .lte("created_at", now.toISOString())
      .not("player_id", "is", null)
      .neq("player_id", "server")
      .limit(10000);
    
    if (!activeError && activeData) {
      const uniquePlayerIds = new Set(activeData.map(e => e.player_id));
      activeUsers = uniquePlayerIds.size;
    }
  } catch (err) {
    console.error("[purchase-metrics] Error fetching active users:", err);
  }
  
  // Aggregate by product
  const productMap = new Map<string, {
    productId: string;
    productName: string;
    productType: "gamepass" | "devproduct" | "unknown";
    purchases: number;
    buyerIds: Set<string>;
    grossRevenue: number;
  }>();
  
  // Track unique paying users and total revenue
  const payingUserIds = new Set<string>();
  let totalGrossRevenue = 0;
  let gamepassRevenue = 0;
  let devproductRevenue = 0;
  
  // Time series buckets
  const bucketMap = new Map<string, {
    totalRevenue: number;
    gamepassesRevenue: number;
    devProductsRevenue: number;
    purchases: number;
    gamepassPurchases: number;
    devproductPurchases: number;
  }>();
  
  // Initialize all buckets with zeros
  const allBucketKeys = generateBucketKeys(rangeStart, now, rangeConfig.bucketMs, rangeConfig.bucketType);
  for (const key of allBucketKeys) {
    bucketMap.set(key, {
      totalRevenue: 0,
      gamepassesRevenue: 0,
      devProductsRevenue: 0,
      purchases: 0,
      gamepassPurchases: 0,
      devproductPurchases: 0,
    });
  }
  
  // Sample metadata for debug
  const sampleMetadata: Array<Record<string, unknown>> = [];
  
  // Process purchase events
  for (const event of purchaseEvents) {
    const productInfo = extractProductInfo(event);
    const { productId, productName, productType, price } = productInfo;
    
    // Collect sample metadata (first 5)
    if (sampleMetadata.length < 5 && event.metadata) {
      sampleMetadata.push(event.metadata);
    }
    
    // Track paying user
    if (event.player_id && event.player_id !== "server") {
      payingUserIds.add(event.player_id);
    }
    
    // Track revenue
    totalGrossRevenue += price;
    if (productType === "gamepass") {
      gamepassRevenue += price;
    } else if (productType === "devproduct") {
      devproductRevenue += price;
    }
    
    // Aggregate by product
    const existing = productMap.get(productId);
    if (existing) {
      existing.purchases += 1;
      existing.grossRevenue += price;
      if (event.player_id && event.player_id !== "server") {
        existing.buyerIds.add(event.player_id);
      }
      // Update name if we find a better one
      if (productName && !productName.startsWith("Product ") && existing.productName.startsWith("Product ")) {
        existing.productName = productName;
      }
    } else {
      const buyerIds = new Set<string>();
      if (event.player_id && event.player_id !== "server") {
        buyerIds.add(event.player_id);
      }
      productMap.set(productId, {
        productId,
        productName,
        productType,
        purchases: 1,
        buyerIds,
        grossRevenue: price,
      });
    }
    
    // Add to time series bucket
    const bucketKey = getBucketKey(event.created_at, rangeConfig.bucketType);
    const bucket = bucketMap.get(bucketKey);
    if (bucket) {
      bucket.totalRevenue += price;
      bucket.purchases += 1;
      if (productType === "gamepass") {
        bucket.gamepassesRevenue += price;
        bucket.gamepassPurchases += 1;
      } else if (productType === "devproduct") {
        bucket.devProductsRevenue += price;
        bucket.devproductPurchases += 1;
      }
    }
  }
  
  // Build products array sorted by revenue
  const products: ProductMetrics[] = Array.from(productMap.values())
    .map(p => {
      const estimatedRevenue = Math.round(p.grossRevenue * CREATOR_REVENUE_RATE);
      const buyers = p.buyerIds.size;
      const revPerBuyer = buyers > 0 ? Math.round(estimatedRevenue / buyers) : 0;
      
      return {
        productId: p.productId,
        productName: p.productName,
        productType: p.productType,
        purchases: p.purchases,
        buyers,
        grossRevenue: p.grossRevenue,
        estimatedRevenue,
        revPerBuyer,
      };
    })
    .sort((a, b) => b.grossRevenue - a.grossRevenue);
  
  // Build time series array
  const timeSeries: TimeSeriesPoint[] = Array.from(bucketMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([time, data]) => ({
      time,
      totalRevenue: data.totalRevenue,
      gamepassesRevenue: data.gamepassesRevenue,
      devProductsRevenue: data.devProductsRevenue,
      purchases: data.purchases,
      gamepassPurchases: data.gamepassPurchases,
      devproductPurchases: data.devproductPurchases,
    }));
  
  // Calculate summary stats
  const payingUsers = payingUserIds.size;
  const estimatedRevenue = Math.round(totalGrossRevenue * CREATOR_REVENUE_RATE);
  const arppu = payingUsers > 0 ? Math.round(estimatedRevenue / payingUsers) : null;
  const payerConversionRate = activeUsers > 0 ? (payingUsers / activeUsers) : null;
  
  // First and last purchase timestamps
  const firstPurchaseAt = purchaseEvents.length > 0 ? purchaseEvents[0].created_at : null;
  const latestPurchaseAt = purchaseEvents.length > 0 ? purchaseEvents[purchaseEvents.length - 1].created_at : null;
  
  return {
    purchases: purchaseEvents.length,
    payingUsers,
    activeUsers,
    grossRevenue: totalGrossRevenue,
    estimatedRevenue,
    arppu,
    payerConversionRate,
    products,
    timeSeries,
    debug: {
      selectedGameId: gameId,
      range,
      purchaseEventsFound: purchaseEvents.length,
      productCount: products.length,
      firstPurchaseAt,
      latestPurchaseAt,
      samplePurchaseMetadata: sampleMetadata,
      activeUsersCount: activeUsers,
      rangeStartIso: rangeStart.toISOString(),
      rangeEndIso: now.toISOString(),
    },
  };
}
