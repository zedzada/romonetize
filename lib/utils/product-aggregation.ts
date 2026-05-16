/**
 * Shared Product Aggregation Helper
 * 
 * Single source of truth for product stats across:
 * - Overview Top Products
 * - Products page table
 * - Monetization product breakdown
 * - AI Assistant context
 * 
 * Rules:
 * - Always filter by game_id (single selected game)
 * - Use consistent range and revenue mode
 * - Never rely on client-side row limits (use pagination or SQL aggregation)
 */

// Roblox takes 30%, creators get 70%
export const CREATOR_REVENUE_RATE = 0.7;

export interface ProductPurchaseEvent {
  id?: string;
  event_type: string;
  player_id: string | null;
  product_id: string | null;
  product_name: string | null;
  product_type: string | null;
  robux: number | null;
  created_at: string;
  game_id: string;
  metadata?: Record<string, unknown> | null;
}

export interface ProductClickEvent {
  id?: string;
  event_type: string;
  player_id: string | null;
  product_id: string | null;
  product_name: string | null;
  product_type: string | null;
  created_at: string;
  game_id: string;
  metadata?: Record<string, unknown> | null;
}

export interface ProductViewEvent {
  id?: string;
  event_type: string;
  player_id: string | null;
  product_id: string | null;
  product_name: string | null;
  product_type: string | null;
  created_at: string;
  game_id: string;
  metadata?: Record<string, unknown> | null;
}

export interface RobloxProductInfo {
  name: string;
  type: string;
  price: number;
}

export interface AggregatedProduct {
  productId: string;
  productName: string;
  productType: string;
  // Gross values (before 30% Roblox fee)
  grossRevenue: number;
  grossRevenuePerBuyer: number;
  // Estimated values (after 30% Roblox fee - creator payout)
  estimatedRevenue: number;
  estimatedRevenuePerBuyer: number;
  // Counts
  purchases: number;
  buyers: number;
  views: number;
  clicks: number;
  // Metrics - conversion rate calculated as: purchases / clicks (or purchases / views if no clicks)
  conversionRate: number | null;
  // If true, purchases exist but no views/clicks tracked yet
  conversionNeedsTracking: boolean;
}

export interface ProductAggregationResult {
  products: AggregatedProduct[];
  // Summary stats
  totalPurchases: number;
  totalBuyers: number;
  grossTotalRevenue: number;
  estimatedTotalRevenue: number;
  // Debug info
  hitSupabaseLimit: boolean;
  totalEventsUsed: number;
}

/**
 * Get robux value from event, handling different field names
 */
export function getEventRobux(event: ProductPurchaseEvent): number {
  // Try direct robux field
  if (typeof event.robux === "number" && event.robux > 0) {
    return event.robux;
  }
  // Try metadata.robux
  const meta = event.metadata as Record<string, unknown> | null;
  if (meta?.robux && typeof meta.robux === "number") {
    return meta.robux;
  }
  // Try metadata.price
  if (meta?.price && typeof meta.price === "number") {
    return meta.price;
  }
  return 0;
}

/**
 * Resolve product name with priority:
 * 1. event.product_name
 * 2. event.metadata.product_name
 * 3. robloxProductsMap lookup
 * 4. "Unknown Product #ID" or "Unknown Product"
 */
function resolveProductName(
  productId: string | null,
  events: Array<ProductPurchaseEvent | ProductClickEvent>,
  robloxProductsMap: Map<string, RobloxProductInfo>
): string {
  if (!productId) return "Unknown Product";
  
  // Check all events for this product_id for a name
  for (const e of events) {
    if (e.product_name && e.product_name !== "Unknown Product" && e.product_name !== "Unknown Gamepass") {
      return e.product_name;
    }
    // Check metadata
    const meta = e.metadata as Record<string, unknown> | null;
    if (meta?.product_name && typeof meta.product_name === "string") {
      return meta.product_name;
    }
  }
  
  // Check Roblox synced products
  const robloxProduct = robloxProductsMap.get(productId);
  if (robloxProduct?.name) {
    return robloxProduct.name;
  }
  
  // Fallback
  return `Unknown Product #${productId}`;
}

/**
 * Resolve product type with priority:
 * 1. event.product_type
 * 2. event.event_type inference
 * 3. robloxProductsMap lookup
 * 4. "gamepass" default
 */
function resolveProductType(
  productId: string | null,
  events: Array<ProductPurchaseEvent | ProductClickEvent>,
  robloxProductsMap: Map<string, RobloxProductInfo>
): string {
  // Check events
  for (const e of events) {
    if (e.product_type && e.product_type !== "unknown") {
      return e.product_type;
    }
    if (e.event_type === "gamepass_purchase" || e.event_type === "gamepass_click") {
      return "gamepass";
    }
    if (e.event_type === "devproduct_purchase" || e.event_type === "devproduct_click") {
      return "devproduct";
    }
  }
  
  // Check Roblox synced products
  if (productId) {
    const robloxProduct = robloxProductsMap.get(productId);
    if (robloxProduct?.type) {
      return robloxProduct.type;
    }
  }
  
  return "gamepass";
}

/**
 * Aggregate product stats from purchase, click, and view events
 * 
 * Conversion rate formula:
 * - If clicks > 0: conversionRate = purchases / clicks
 * - Else if views > 0: conversionRate = purchases / views
 * - Else: null (needs tracking)
 * 
 * Est. Rev / Buyer formula:
 * - estimatedRevenuePerBuyer = estimatedRevenue / uniqueBuyers
 * - If uniqueBuyers is 0, show "—"
 * 
 * @param purchaseEvents - All purchase events (already paginated/complete)
 * @param clickEvents - All click events (already paginated/complete)
 * @param viewEvents - All view events (already paginated/complete)
 * @param robloxProductsMap - Map of product_id to Roblox product info for name resolution
 */
export function aggregateProducts(
  purchaseEvents: ProductPurchaseEvent[],
  clickEvents: ProductClickEvent[],
  robloxProductsMap: Map<string, RobloxProductInfo>,
  viewEvents: ProductViewEvent[] = []
): ProductAggregationResult {
  // Collect all events by product_id for name/type resolution
  const productEventMap = new Map<string, Array<ProductPurchaseEvent | ProductClickEvent | ProductViewEvent>>();
  [...purchaseEvents, ...clickEvents, ...viewEvents].forEach((e) => {
    const productId = e.product_id;
    if (!productId) return;
    const existing = productEventMap.get(productId) || [];
    existing.push(e);
    productEventMap.set(productId, existing);
  });
  
  // Build product aggregation map
  const productMap = new Map<string, {
    id: string;
    name: string;
    type: string;
    grossRevenue: number;
    purchases: number;
    views: number;
    clicks: number;
    uniqueBuyers: Set<string>;
  }>();
  
  // Process purchase events
  purchaseEvents.forEach((e) => {
    const key = e.product_id || "unknown";
    const eventRobux = getEventRobux(e);
    const existing = productMap.get(key);
    
    if (existing) {
      existing.grossRevenue += eventRobux;
      existing.purchases += 1;
      if (e.player_id) existing.uniqueBuyers.add(e.player_id);
    } else {
      const buyers = new Set<string>();
      if (e.player_id) buyers.add(e.player_id);
      
      const allEventsForProduct = productEventMap.get(key) || [e];
      
      productMap.set(key, {
        id: e.product_id || key,
        name: resolveProductName(e.product_id, allEventsForProduct, robloxProductsMap),
        type: resolveProductType(e.product_id, allEventsForProduct, robloxProductsMap),
        grossRevenue: eventRobux,
        purchases: 1,
        views: 0,
        clicks: 0,
        uniqueBuyers: buyers,
      });
    }
  });
  
  // Process click events
  clickEvents.forEach((e) => {
    const key = e.product_id || "unknown";
    const existing = productMap.get(key);
    
    if (existing) {
      existing.clicks += 1;
    } else {
      const allEventsForProduct = productEventMap.get(key) || [e];
      
      productMap.set(key, {
        id: e.product_id || key,
        name: resolveProductName(e.product_id, allEventsForProduct, robloxProductsMap),
        type: resolveProductType(e.product_id, allEventsForProduct, robloxProductsMap),
        grossRevenue: 0,
        purchases: 0,
        views: 0,
        clicks: 1,
        uniqueBuyers: new Set(),
      });
    }
  });
  
  // Process view events
  viewEvents.forEach((e) => {
    const key = e.product_id || "unknown";
    const existing = productMap.get(key);
    
    if (existing) {
      existing.views += 1;
    } else {
      const allEventsForProduct = productEventMap.get(key) || [e];
      
      productMap.set(key, {
        id: e.product_id || key,
        name: resolveProductName(e.product_id, allEventsForProduct, robloxProductsMap),
        type: resolveProductType(e.product_id, allEventsForProduct, robloxProductsMap),
        grossRevenue: 0,
        purchases: 0,
        views: 1,
        clicks: 0,
        uniqueBuyers: new Set(),
      });
    }
  });
  
  // Convert to final array with calculated fields
  const products: AggregatedProduct[] = Array.from(productMap.values())
    .map((p) => {
      // Est. Rev / Buyer = estimatedRevenue / uniqueBuyers (NOT purchases)
      // Use full precision for calculation, then round
      const grossRevPerBuyer = p.uniqueBuyers.size > 0 ? p.grossRevenue / p.uniqueBuyers.size : 0;
      const estimatedRevenue = p.grossRevenue * CREATOR_REVENUE_RATE;
      const estimatedRevPerBuyer = p.uniqueBuyers.size > 0 ? estimatedRevenue / p.uniqueBuyers.size : 0;
      
      // Conversion rate formula:
      // - If clicks > 0: purchases / clicks
      // - Else if views > 0: purchases / views
      // - Else: null (needs tracking)
      let conversionRate: number | null = null;
      if (p.clicks > 0) {
        conversionRate = p.purchases / p.clicks;
      } else if (p.views > 0) {
        conversionRate = p.purchases / p.views;
      }
      
      // conversionNeedsTracking: purchases exist but no views/clicks tracked
      const conversionNeedsTracking = p.purchases > 0 && p.clicks === 0 && p.views === 0;
      
      return {
        productId: p.id,
        productName: p.name,
        productType: p.type,
        // Gross values
        grossRevenue: p.grossRevenue,
        grossRevenuePerBuyer: Math.round(grossRevPerBuyer),
        // Estimated values (70% of gross) - don't round revenue before dividing
        estimatedRevenue: Math.round(estimatedRevenue),
        estimatedRevenuePerBuyer: Math.round(estimatedRevPerBuyer),
        // Counts
        purchases: p.purchases,
        buyers: p.uniqueBuyers.size,
        views: p.views,
        clicks: p.clicks,
        // Metrics
        conversionRate,
        conversionNeedsTracking,
      };
    })
    .sort((a, b) => b.grossRevenue - a.grossRevenue);
  
  // Calculate totals
  const totalPurchases = products.reduce((sum, p) => sum + p.purchases, 0);
  const grossTotalRevenue = products.reduce((sum, p) => sum + p.grossRevenue, 0);
  const uniqueBuyerIds = new Set<string>();
  purchaseEvents.forEach((e) => {
    if (e.player_id) uniqueBuyerIds.add(e.player_id);
  });
  
  return {
    products,
    totalPurchases,
    totalBuyers: uniqueBuyerIds.size,
    grossTotalRevenue,
    estimatedTotalRevenue: Math.round(grossTotalRevenue * CREATOR_REVENUE_RATE),
    hitSupabaseLimit: false, // Caller should set this based on pagination
    totalEventsUsed: purchaseEvents.length + clickEvents.length + viewEvents.length,
  };
}

/**
 * Get top N products by revenue
 */
export function getTopProducts(
  result: ProductAggregationResult,
  count: number = 4
): AggregatedProduct[] {
  return result.products.slice(0, count);
}

// ========================================================================
// Shared Product Purchase Metrics Helper
// ========================================================================
// Single source of truth for product stats across:
// - Products page table & cards
// - Monetization cards & charts
// - Overview Top Products
// 
// Consumes the `productAnalytics` field from the API response.
// ========================================================================

export interface ProductMetric {
  productId: string;
  productName: string;
  productType: string;
  purchases: number;
  buyers: number;
  grossRevenue: number;
  estimatedRevenue: number;
  revenuePerBuyer: number; // based on selected mode
}

export interface ProductPurchaseMetricsResult {
  products: ProductMetric[];
  totalPurchases: number;
  totalBuyers: number;
  grossTotalRevenue: number;
  estimatedTotalRevenue: number;
  /** Revenue value based on selected mode */
  displayTotalRevenue: number;
  /** Payer conversion rate = totalBuyers / uniqueActivePlayers */
  payerConversionRate: number | null;
  uniqueActivePlayers: number;
  aggregationSource: string;
}

/**
 * Normalise the API `productAnalytics` blob into a stable shape that every
 * consumer (Products page, Monetization cards, Overview Top Products) can use
 * directly.  
 *
 * This is the ONLY function pages should call to get purchase/revenue numbers.
 */
export function getProductPurchaseMetrics(opts: {
  /** The `productAnalytics` object from the analytics API response */
  productAnalytics: Record<string, unknown> | null | undefined;
  /** "gross" or "estimated" */
  revenueMode: "gross" | "estimated";
}): ProductPurchaseMetricsResult {
  const { productAnalytics, revenueMode } = opts;

  const empty: ProductPurchaseMetricsResult = {
    products: [],
    totalPurchases: 0,
    totalBuyers: 0,
    grossTotalRevenue: 0,
    estimatedTotalRevenue: 0,
    displayTotalRevenue: 0,
    payerConversionRate: null,
    uniqueActivePlayers: 0,
    aggregationSource: "none",
  };

  if (!productAnalytics) return empty;

  const rawProducts = Array.isArray((productAnalytics as { products?: unknown[] }).products)
    ? (productAnalytics as { products: Record<string, unknown>[] }).products
    : [];

  const isGross = revenueMode === "gross";

  const products: ProductMetric[] = rawProducts.map((p) => {
    const grossRevenue = Number(p.grossRevenue ?? p.revenue ?? 0);
    const estimatedRevenue = Number(p.estimatedRevenue ?? Math.round(grossRevenue * CREATOR_REVENUE_RATE));
    const buyers = Number(p.buyers ?? p.uniqueBuyers ?? 0);
    const displayRevenue = isGross ? grossRevenue : estimatedRevenue;
    const revPerBuyer = buyers > 0 ? Math.round(displayRevenue / buyers) : 0;

    return {
      productId: String(p.productId ?? p.id ?? "unknown"),
      productName: String(p.productName ?? p.name ?? "Unknown Product"),
      productType: String(p.productType ?? p.type ?? "unknown"),
      purchases: Number(p.purchases ?? 0),
      buyers,
      grossRevenue,
      estimatedRevenue,
      revenuePerBuyer: revPerBuyer,
    };
  });

  const totalPurchases = Number((productAnalytics as { totalPurchases?: number }).totalPurchases ?? products.reduce((s, p) => s + p.purchases, 0));
  const totalBuyers = Number((productAnalytics as { totalBuyers?: number }).totalBuyers ?? products.reduce((s, p) => s + p.buyers, 0));
  const grossTotalRevenue = Number((productAnalytics as { grossTotalRevenue?: number }).grossTotalRevenue ?? products.reduce((s, p) => s + p.grossRevenue, 0));
  const estimatedTotalRevenue = Number((productAnalytics as { estimatedTotalRevenue?: number }).estimatedTotalRevenue ?? Math.round(grossTotalRevenue * CREATOR_REVENUE_RATE));
  const uniqueActivePlayers = Number((productAnalytics as { uniqueActiveUsers?: number }).uniqueActiveUsers ?? 0);
  const payerConversionRate = uniqueActivePlayers > 0 ? totalBuyers / uniqueActivePlayers : null;

  return {
    products,
    totalPurchases,
    totalBuyers,
    grossTotalRevenue,
    estimatedTotalRevenue,
    displayTotalRevenue: isGross ? grossTotalRevenue : estimatedTotalRevenue,
    payerConversionRate,
    uniqueActivePlayers,
    aggregationSource: String((productAnalytics as { aggregationSource?: string }).aggregationSource ?? "unknown"),
  };
}
