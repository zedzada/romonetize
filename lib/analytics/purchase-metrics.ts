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
  activeUsersRaw: number;
  activeUsersFixed: number;
  grossRevenue: number;
  estimatedRevenue: number;
  arppu: number | null;
  pcr: number | null;
  
  // ARPDAU - different calculation based on range
  arpdauGross: number | null;
  arpdauEstimated: number | null;
  
  // For short ranges (1h, 6h, 24h, 72h): activeUsersInRange is the denominator
  // For long ranges (7d, 28d, 90d): sumDailyDau is the denominator
  activeUsersInRange: number;
  sumDailyDau: number;
  averageDau: number | null;
  averageDailyRevenueGross: number | null;
  averageDailyRevenueEstimated: number | null;
  numberOfDays: number;
  isLongRange: boolean;
  
  // Products list
  products: ProductMetrics[];
  
  // Time series for charts
  timeSeries: TimeSeriesPoint[];
  
  // Daily buckets for ARPDAU debug
  dailyBuckets: Array<{
    date: string;
    revenueGross: number;
    revenueEstimated: number;
    dau: number;
  }>;
  
  // Debug info
  debug: {
    selectedGameId: string;
    range: string;
    purchaseEventsFound: number;
    productCount: number;
    firstPurchaseAt: string | null;
    latestPurchaseAt: string | null;
    samplePurchaseMetadata: Array<Record<string, unknown>>;
    rangeStartIso: string;
    rangeEndIso: string;
    
    // PCR debug
    payingUsers: number;
    activeUsersRaw: number;
    activeUsersFixed: number;
    pcr: number | null;
    pcrWarning: string | null;
    
    // ARPDAU debug
    isLongRange: boolean;
    arpdauFormulaUsed: string;
    activeUsersInRange: number;
    sumDailyDau: number;
    averageDau: number | null;
    averageDailyRevenueGross: number | null;
    averageDailyRevenueEstimated: number | null;
    arpdauGross: number | null;
    arpdauEstimated: number | null;
    numberOfDays: number;
    
    // Event type breakdown
    eventTypeCounts: Record<string, number>;
    activeUserEventTypes: string[];
    purchaseEventTypes: string[];
    
    // Sample users
    samplePayingUsers: string[];
    sampleActiveUsers: string[];
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
  // Use pagination to get ALL active users, not just first 10000
  const activeUserIds = new Set<string>();
  const eventTypeCounts: Record<string, number> = {};
  
  try {
    let activeFrom = 0;
    let activeHasMore = true;
    let activePagesFetched = 0;
    const ACTIVE_MAX_PAGES = 20; // Up to 20,000 active user events
    
    while (activeHasMore && activePagesFetched < ACTIVE_MAX_PAGES) {
      const { data: activeData, error: activeError } = await supabase
        .from("events")
        .select("player_id, event_type")
        .eq("game_id", gameId)
        .in("event_type", ACTIVE_USER_EVENT_TYPES)
        .gte("created_at", rangeStart.toISOString())
        .lte("created_at", now.toISOString())
        .not("player_id", "is", null)
        .neq("player_id", "server")
        .range(activeFrom, activeFrom + PAGE_SIZE - 1);
      
      if (activeError) {
        console.error("[purchase-metrics] Error fetching active users:", activeError);
        activeHasMore = false;
      } else if (activeData && activeData.length > 0) {
        for (const e of activeData) {
          if (e.player_id) {
            activeUserIds.add(e.player_id);
          }
          // Count event types for debug
          eventTypeCounts[e.event_type] = (eventTypeCounts[e.event_type] || 0) + 1;
        }
        activePagesFetched++;
        activeFrom += PAGE_SIZE;
        activeHasMore = activeData.length === PAGE_SIZE;
      } else {
        activeHasMore = false;
      }
    }
  } catch (err) {
    console.error("[purchase-metrics] Error fetching active users:", err);
  }
  
  // Calculate daily active users (DAU) for ARPDAU
  // Query distinct players per day
  const dailyActiveUsers = new Map<string, Set<string>>();
  
  try {
    let dauFrom = 0;
    let dauHasMore = true;
    let dauPagesFetched = 0;
    const DAU_MAX_PAGES = 20;
    
    while (dauHasMore && dauPagesFetched < DAU_MAX_PAGES) {
      const { data: dauData, error: dauError } = await supabase
        .from("events")
        .select("player_id, created_at")
        .eq("game_id", gameId)
        .in("event_type", ACTIVE_USER_EVENT_TYPES)
        .gte("created_at", rangeStart.toISOString())
        .lte("created_at", now.toISOString())
        .not("player_id", "is", null)
        .neq("player_id", "server")
        .range(dauFrom, dauFrom + PAGE_SIZE - 1);
      
      if (dauError) {
        console.error("[purchase-metrics] Error fetching DAU:", dauError);
        dauHasMore = false;
      } else if (dauData && dauData.length > 0) {
        for (const e of dauData) {
          if (e.player_id) {
            const dayKey = getBucketKey(e.created_at, "day");
            if (!dailyActiveUsers.has(dayKey)) {
              dailyActiveUsers.set(dayKey, new Set());
            }
            dailyActiveUsers.get(dayKey)!.add(e.player_id);
          }
        }
        dauPagesFetched++;
        dauFrom += PAGE_SIZE;
        dauHasMore = dauData.length === PAGE_SIZE;
      } else {
        dauHasMore = false;
      }
    }
  } catch (err) {
    console.error("[purchase-metrics] Error fetching DAU:", err);
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
  
  // activeUsersRaw is what we counted from events
  const activeUsersRaw = activeUserIds.size;
  
  // activeUsersFixed: ensure paying users are included in active users
  // If activeUsersRaw < payingUsers, it means the active user query missed some payers
  const activeUsersFixed = Math.max(activeUsersRaw, payingUsers);
  
  // PCR warning
  const pcrWarning = activeUsersRaw < payingUsers 
    ? `activeUsers was ${activeUsersRaw} but payingUsers was ${payingUsers}; activeUsers was corrected to ${activeUsersFixed}`
    : null;
  
  // PCR = payingUsers / activeUsersFixed * 100
  const pcr = activeUsersFixed > 0 ? (payingUsers / activeUsersFixed) * 100 : null;
  
  // ARPPU = estimatedRevenue / payingUsers
  const arppu = payingUsers > 0 ? Math.round(estimatedRevenue / payingUsers) : null;
  
  // Determine if this is a long range (7d, 28d, 90d) that needs daily bucket ARPDAU
  const isLongRange = ["7d", "28d", "90d"].includes(range);
  
  // Calculate numberOfDays
  const msInDay = 24 * 60 * 60 * 1000;
  const numberOfDays = Math.max(1, Math.ceil((now.getTime() - rangeStart.getTime()) / msInDay));
  
  // activeUsersInRange = total distinct active users in the selected range (same as PCR denominator)
  const activeUsersInRange = activeUsersFixed;
  
  // Calculate ARPDAU based on range type
  let arpdauGross: number | null = null;
  let arpdauEstimated: number | null = null;
  let arpdauFormulaUsed: string;
  let sumDailyDau = 0;
  let averageDau: number | null = null;
  let averageDailyRevenueGross: number | null = null;
  let averageDailyRevenueEstimated: number | null = null;
  const dailyBuckets: Array<{ date: string; revenueGross: number; revenueEstimated: number; dau: number }> = [];
  
  if (isLongRange) {
    // For 7D/28D/90D: ARPDAU = totalRevenue / sumDailyDau
    arpdauFormulaUsed = "total_revenue / sum_daily_dau";
    
    // Calculate daily buckets for revenue and DAU
    const dailyRevenueMap = new Map<string, { gross: number; estimated: number }>();
    
    // Sum revenue per day from purchase events
    for (const event of purchaseEvents) {
      const dayKey = getBucketKey(event.created_at, "day").slice(0, 10); // YYYY-MM-DD
      const productInfo = extractProductInfo(event);
      const existing = dailyRevenueMap.get(dayKey);
      if (existing) {
        existing.gross += productInfo.price;
        existing.estimated += Math.round(productInfo.price * CREATOR_REVENUE_RATE);
      } else {
        dailyRevenueMap.set(dayKey, {
          gross: productInfo.price,
          estimated: Math.round(productInfo.price * CREATOR_REVENUE_RATE),
        });
      }
    }
    
    // Get all days in range
    const allDays = new Set<string>();
    for (const dayKey of dailyActiveUsers.keys()) {
      allDays.add(dayKey.slice(0, 10));
    }
    for (const dayKey of dailyRevenueMap.keys()) {
      allDays.add(dayKey);
    }
    
    for (const dayKey of Array.from(allDays).sort()) {
      const revenue = dailyRevenueMap.get(dayKey);
      // Find the matching DAU bucket
      let dauCount = 0;
      for (const [bucketKey, dauSet] of dailyActiveUsers.entries()) {
        if (bucketKey.startsWith(dayKey)) {
          dauCount = dauSet.size;
          break;
        }
      }
      dailyBuckets.push({
        date: dayKey,
        revenueGross: revenue?.gross ?? 0,
        revenueEstimated: revenue?.estimated ?? 0,
        dau: dauCount,
      });
    }
    
    // sumDailyDau = sum of DAU across all days
    sumDailyDau = dailyBuckets.reduce((sum, day) => sum + day.dau, 0);
    
    // averageDau
    const daysWithData = dailyBuckets.filter(d => d.dau > 0).length;
    averageDau = daysWithData > 0 ? Math.round(sumDailyDau / daysWithData) : null;
    
    // averageDailyRevenue
    averageDailyRevenueGross = numberOfDays > 0 ? Math.round(totalGrossRevenue / numberOfDays) : null;
    averageDailyRevenueEstimated = numberOfDays > 0 ? Math.round(estimatedRevenue / numberOfDays) : null;
    
    if (sumDailyDau > 0) {
      arpdauGross = Math.round((totalGrossRevenue / sumDailyDau) * 100) / 100;
      arpdauEstimated = Math.round((estimatedRevenue / sumDailyDau) * 100) / 100;
    }
  } else {
    // For 1H/6H/24H/72H: ARPDAU = revenueInRange / activeUsersInRange (same denominator as PCR)
    arpdauFormulaUsed = "range_revenue / range_active_users";
    if (activeUsersInRange > 0) {
      arpdauGross = Math.round((totalGrossRevenue / activeUsersInRange) * 100) / 100;
      arpdauEstimated = Math.round((estimatedRevenue / activeUsersInRange) * 100) / 100;
    }
  }
  
  // Sample users for debug
  const samplePayingUsers = Array.from(payingUserIds).slice(0, 5);
  const sampleActiveUsers = Array.from(activeUserIds).slice(0, 5);
  
  // First and last purchase timestamps
  const firstPurchaseAt = purchaseEvents.length > 0 ? purchaseEvents[0].created_at : null;
  const latestPurchaseAt = purchaseEvents.length > 0 ? purchaseEvents[purchaseEvents.length - 1].created_at : null;
  
  return {
    purchases: purchaseEvents.length,
    payingUsers,
    activeUsersRaw,
    activeUsersFixed,
    grossRevenue: totalGrossRevenue,
    estimatedRevenue,
    arppu,
    pcr,
    arpdauGross,
    arpdauEstimated,
    activeUsersInRange,
    sumDailyDau,
    averageDau,
    averageDailyRevenueGross,
    averageDailyRevenueEstimated,
    numberOfDays,
    isLongRange,
    products,
    timeSeries,
    dailyBuckets,
    debug: {
      selectedGameId: gameId,
      range,
      purchaseEventsFound: purchaseEvents.length,
      productCount: products.length,
      firstPurchaseAt,
      latestPurchaseAt,
      samplePurchaseMetadata: sampleMetadata,
      rangeStartIso: rangeStart.toISOString(),
      rangeEndIso: now.toISOString(),
      
      // PCR debug
      payingUsers,
      activeUsersRaw,
      activeUsersFixed,
      pcr,
      pcrWarning,
      
      // ARPDAU debug
      isLongRange,
      arpdauFormulaUsed,
      activeUsersInRange,
      sumDailyDau,
      averageDau,
      averageDailyRevenueGross,
      averageDailyRevenueEstimated,
      arpdauGross,
      arpdauEstimated,
      numberOfDays,
      
      // Event type breakdown
      eventTypeCounts,
      activeUserEventTypes: ACTIVE_USER_EVENT_TYPES,
      purchaseEventTypes: PURCHASE_EVENT_TYPES,
      
      // Sample users
      samplePayingUsers,
      sampleActiveUsers,
    },
  };
}
