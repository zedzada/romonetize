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
  clicks: number;
  // Metrics
  conversionRate: number | null;
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
 * Aggregate product stats from purchase and click events
 * 
 * @param purchaseEvents - All purchase events (already paginated/complete)
 * @param clickEvents - All click events (already paginated/complete)
 * @param robloxProductsMap - Map of product_id to Roblox product info for name resolution
 */
export function aggregateProducts(
  purchaseEvents: ProductPurchaseEvent[],
  clickEvents: ProductClickEvent[],
  robloxProductsMap: Map<string, RobloxProductInfo>
): ProductAggregationResult {
  // Collect all events by product_id for name/type resolution
  const productEventMap = new Map<string, Array<ProductPurchaseEvent | ProductClickEvent>>();
  [...purchaseEvents, ...clickEvents].forEach((e) => {
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
        clicks: 1,
        uniqueBuyers: new Set(),
      });
    }
  });
  
  // Convert to final array with calculated fields
  const products: AggregatedProduct[] = Array.from(productMap.values())
    .map((p) => {
      const grossRevPerBuyer = p.uniqueBuyers.size > 0 ? p.grossRevenue / p.uniqueBuyers.size : 0;
      
      return {
        productId: p.id,
        productName: p.name,
        productType: p.type,
        // Gross values
        grossRevenue: p.grossRevenue,
        grossRevenuePerBuyer: Math.round(grossRevPerBuyer),
        // Estimated values (70% of gross)
        estimatedRevenue: Math.round(p.grossRevenue * CREATOR_REVENUE_RATE),
        estimatedRevenuePerBuyer: Math.round(grossRevPerBuyer * CREATOR_REVENUE_RATE),
        // Counts
        purchases: p.purchases,
        buyers: p.uniqueBuyers.size,
        clicks: p.clicks,
        // Metrics
        conversionRate: p.clicks > 0 ? p.purchases / p.clicks : null,
        conversionNeedsTracking: p.clicks === 0 && p.purchases > 0,
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
    totalEventsUsed: purchaseEvents.length + clickEvents.length,
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
