"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAnalytics, type DateRange } from "@/hooks/use-analytics";
import { RangeControls, type ChartDateRange } from "@/components/dashboard/chart-card";
import { 
  RefreshCw, 
  Package, 
  DollarSign, 
  ShoppingCart, 
  Users,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
} from "lucide-react";

// Safe number formatter - never crashes
function formatNumber(value: unknown): string {
  if (typeof value === "number" && !isNaN(value)) {
    return value.toLocaleString();
  }
  return "—";
}

// Safe currency formatter
function formatRobux(value: unknown): string {
  if (typeof value === "number" && !isNaN(value)) {
    return `R$ ${value.toLocaleString()}`;
  }
  return "—";
}

// Safe percentage formatter - handles NaN, Infinity, null, undefined
function formatPercent(value: unknown): string {
  if (typeof value === "number" && !isNaN(value) && isFinite(value)) {
    return `${(value * 100).toFixed(1)}%`;
  }
  return "—";
}

// Roblox takes 30%, creators get 70%
const CREATOR_REVENUE_RATE = 0.7;

// Products page range type - supports 7d to All time
type ProductsRange = "7d" | "28d" | "90d";

// Map products range to analytics API range
function toAnalyticsRange(range: ProductsRange): DateRange {
  switch (range) {
    case "7d": return "7d";
    case "28d": return "30d";
    case "90d": return "90d";
    default: return "7d";
  }
}

export default function ProductsPage() {
  const [chartRange, setChartRange] = useState<ProductsRange>("28d");
  
  const {
    isLoading,
    isRefreshing,
    error,
    dataHealth,
    productStats,
    syncedProducts,
    productAnalytics,
    selectedGameName,
    refresh,
  } = useAnalytics({ enabled: true, range: toAnalyticsRange(chartRange) });

  // Safe defaults per spec
  const safeProductStats = productStats ?? {};
  const safeSyncedProducts = Array.isArray(syncedProducts?.products)
    ? syncedProducts.products
    : [];

  const hasTrackerEvents = dataHealth?.hasTrackerEvents ?? false;
  const hasSyncedProducts = safeSyncedProducts.length > 0;

  // Merged products: prioritize productAnalytics, fall back to productStats.products
  // This ensures products from purchase_success events appear even if Roblox sync is empty
  const trackerProducts = 
    (productAnalytics?.products && productAnalytics.products.length > 0)
      ? productAnalytics.products
      : Array.isArray(safeProductStats.products)
        ? safeProductStats.products
        : [];

  const hasTrackerProducts = trackerProducts.length > 0;
  
  // Total products count = unique products from tracker OR synced Roblox products
  const totalProductsCount = hasTrackerProducts 
    ? trackerProducts.length 
    : safeSyncedProducts.length;

  // Handle sync Roblox data
  const handleSyncRoblox = async () => {
    try {
      const response = await fetch("/api/roblox/sync-selected-game", {
        method: "POST",
      });
      if (response.ok) {
        refresh();
      }
    } catch (err) {
      console.error("Failed to sync Roblox data:", err);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Products</h1>
          <p className="text-muted-foreground">Track Roblox products, gamepasses, and monetization performance</p>
        </div>
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
          <span className="ml-3 text-muted-foreground">Loading products...</span>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Products</h1>
          <p className="text-muted-foreground">Track Roblox products, gamepasses, and monetization performance</p>
        </div>
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-destructive" />
              <div>
                <p className="font-medium text-destructive">Failed to load products</p>
                <p className="text-sm text-muted-foreground">{error}</p>
              </div>
            </div>
            <Button onClick={refresh} variant="outline" size="sm" className="mt-4">
              <RefreshCw className="w-4 h-4 mr-2" />
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Products</h1>
          <p className="text-muted-foreground">
            {selectedGameName
              ? `Showing data for: ${selectedGameName}`
              : "Track Roblox products, gamepasses, and monetization performance"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <RangeControls
            value={chartRange as ChartDateRange}
            onChange={(r) => setChartRange(r as ProductsRange)}
            ranges={["7d", "28d", "90d"]}
          />
          <Button
            onClick={refresh}
            variant="outline"
            size="sm"
            disabled={isRefreshing}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`} />
            Refresh Data
          </Button>
        </div>
      </div>

      {/* Data Status Banners */}
      {hasSyncedProducts && (
        <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span className="text-sm text-emerald-700">
            Roblox products synced ({safeSyncedProducts.length} products)
          </span>
        </div>
      )}

      {!hasTrackerEvents ? (
        <div className="flex items-center justify-between p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600" />
            <span className="text-sm text-amber-700">
              Install the RoMonetize tracking script to unlock purchases, revenue, and conversion.
            </span>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard/game/tracking-setup">
              View Installation Guide
              <ExternalLink className="w-3 h-3 ml-1" />
            </Link>
          </Button>
        </div>
      ) : (safeProductStats.totalPurchases ?? 0) === 0 && (
        <div className="flex items-center gap-2 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
          <AlertCircle className="w-4 h-4 text-blue-600" />
          <span className="text-sm text-blue-700">
            Tracking is active. No purchases tracked yet - revenue will appear when players make purchases.
          </span>
        </div>
      )}

      {/* Product Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card className="border-border/50">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <Package className="w-4 h-4 text-blue-500" />
              <span className="text-xs text-muted-foreground">Total Products</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {formatNumber(totalProductsCount)}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-4 h-4 text-green-500" />
              <span className="text-xs text-muted-foreground">Est. Revenue</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {hasTrackerEvents ? formatRobux(safeProductStats.estimatedTotalRevenue ?? Math.round((safeProductStats.totalRevenue ?? 0) * CREATOR_REVENUE_RATE)) : (
                <span className="text-sm text-muted-foreground font-normal">Requires tracking</span>
              )}
            </div>
            {hasTrackerEvents && safeProductStats.grossTotalRevenue > 0 && (
              <p className="text-[10px] text-muted-foreground mt-1" title={`Gross: R$${(safeProductStats.grossTotalRevenue ?? safeProductStats.totalRevenue ?? 0).toLocaleString()}`}>
                After 30% Roblox fee
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <ShoppingCart className="w-4 h-4 text-purple-500" />
              <span className="text-xs text-muted-foreground">Total Purchases</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {hasTrackerEvents ? formatNumber(safeProductStats.totalPurchases) : (
                <span className="text-sm text-muted-foreground font-normal">Requires tracking</span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-4 h-4 text-orange-500" />
              <span className="text-xs text-muted-foreground">Unique Buyers</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {hasTrackerEvents ? formatNumber(safeProductStats.uniqueBuyers) : (
                <span className="text-sm text-muted-foreground font-normal">Requires tracking</span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-cyan-500" />
              <span className="text-xs text-muted-foreground">Avg Conv. Rate</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {hasTrackerEvents && !safeProductStats.avgConversionNeedsTracking 
                ? formatPercent(safeProductStats.avgConversionRate) 
                : (
                  <span className="text-sm text-muted-foreground font-normal">Needs tracking</span>
                )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Products from Tracker (purchases) */}
      {hasTrackerEvents && hasTrackerProducts && (
        <Card className="border-border bg-card shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-4">
            <div>
              <CardTitle className="text-lg font-semibold text-foreground">Product Performance</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">Based on tracked purchases from your game</p>
            </div>
            <Badge variant="secondary" className="bg-emerald-500/20 text-emerald-400 border-emerald-500/40 text-[10px]">
              RoMonetize Tracker
            </Badge>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="overflow-x-auto -mx-6">
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="text-left py-3.5 px-6 font-semibold text-muted-foreground text-xs uppercase tracking-wide">Product</th>
                    <th className="text-left py-3.5 px-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide">Type</th>
                    <th className="text-right py-3.5 px-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide">Est. Revenue</th>
                    <th className="text-right py-3.5 px-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide">Purchases</th>
                    <th className="text-right py-3.5 px-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide">Buyers</th>
                    <th className="text-right py-3.5 px-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide">Conv.</th>
                    <th className="text-right py-3.5 px-6 font-semibold text-muted-foreground text-xs uppercase tracking-wide">Est. Rev/Buyer</th>
                  </tr>
                </thead>
                <tbody>
                  {trackerProducts.map((product) => {
                    // Normalize product shape for both productAnalytics and productStats formats
                    const productId = product.productId ?? product.id ?? "unknown";
                    const productName = product.productName ?? product.name ?? productId;
                    const productType = product.productType ?? product.type ?? "unknown";
                    // Use estimated values (70% of gross) if available, otherwise calculate from gross
                    const grossRevenue = product.grossRevenue ?? product.revenue ?? 0;
                    const estimatedRevenue = product.estimatedRevenue ?? Math.round(grossRevenue * CREATOR_REVENUE_RATE);
                    const purchases = product.purchases ?? 0;
                    const buyers = product.buyers ?? product.uniqueBuyers ?? 0;
                    const conversionRate = product.conversionRate ?? null;
                    const grossRevPerBuyer = product.grossRevenuePerBuyer ?? product.revenuePerBuyer ?? product.revPerBuyer ?? (buyers > 0 ? grossRevenue / buyers : 0);
                    const estimatedRevPerBuyer = product.estimatedRevenuePerBuyer ?? Math.round(grossRevPerBuyer * CREATOR_REVENUE_RATE);
                    
                    return (
                      <tr key={productId} className="border-b border-border hover:bg-muted/50 transition-colors">
                        <td className="py-4 px-6">
                          <div className="font-medium text-foreground">{productName}</div>
                          <div className="text-xs text-muted-foreground mt-0.5 font-mono">ID: {productId}</div>
                        </td>
                        <td className="py-4 px-3">
                          <Badge 
                            variant="secondary" 
                            className={productType === "gamepass" 
                              ? "bg-sky-500/20 text-sky-400 border-sky-500/40" 
                              : "bg-violet-500/20 text-violet-400 border-violet-500/40"
                            }
                          >
                            {productType === "gamepass" ? "Game Pass" : productType === "devproduct" ? "Dev Product" : productType}
                          </Badge>
                        </td>
                        <td className="py-4 px-3 text-right font-mono font-semibold text-emerald-400" title={`Gross: R$${grossRevenue.toLocaleString()}`}>
                          {formatRobux(estimatedRevenue)}
                        </td>
                        <td className="py-4 px-3 text-right font-medium text-foreground">
                          {formatNumber(purchases)}
                        </td>
                        <td className="py-4 px-3 text-right font-medium text-foreground">
                          {formatNumber(buyers)}
                        </td>
                        <td className="py-4 px-3 text-right">
                          {conversionRate !== null ? (
                            <span className="font-medium text-foreground">{formatPercent(conversionRate)}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-4 px-6 text-right font-mono text-muted-foreground">
                          {formatRobux(estimatedRevPerBuyer)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state when tracker is active but no products yet */}
      {hasTrackerEvents && !hasTrackerProducts && !hasSyncedProducts && (
        <Card className="border-border/50">
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <Package className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
              <p className="text-foreground font-medium mb-2">No products tracked yet</p>
              <p className="text-sm text-muted-foreground mb-4">
                Sync Roblox products or make a tracked purchase to populate this table.
              </p>
              <Button onClick={handleSyncRoblox} variant="outline">
                <RefreshCw className="w-4 h-4 mr-2" />
                Sync Roblox Data
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Synced Roblox Products List - only show if synced products exist AND no tracker products */}
      {hasSyncedProducts && !hasTrackerProducts && (
        <Card className="border-border bg-card shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-4">
            <div>
              <CardTitle className="text-lg font-semibold text-foreground">Synced Roblox Products</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">Products fetched from the Roblox API</p>
            </div>
            <Badge variant="secondary" className="bg-sky-500/20 text-sky-400 border-sky-500/40 text-[10px]">
              Roblox API
            </Badge>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="overflow-x-auto -mx-6">
              <table className="w-full text-sm min-w-[800px]">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="text-left py-3.5 px-6 font-semibold text-muted-foreground text-xs uppercase tracking-wide">Product</th>
                    <th className="text-left py-3.5 px-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide">Type</th>
                    <th className="text-right py-3.5 px-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide">Price</th>
                    <th className="text-right py-3.5 px-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide">Est. Revenue</th>
                    <th className="text-right py-3.5 px-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide">Purchases</th>
                    <th className="text-right py-3.5 px-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide">Buyers</th>
                    <th className="text-right py-3.5 px-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide">Conv.</th>
                    <th className="text-right py-3.5 px-6 font-semibold text-muted-foreground text-xs uppercase tracking-wide">Est. Rev/Buyer</th>
                  </tr>
                </thead>
                <tbody>
                  {safeSyncedProducts.map((product, index) => {
                    // Safe field access per spec
                    const name = product?.name ?? product?.productName ?? "Unnamed product";
                    const type = product?.productType ?? product?.type ?? "Product";
                    const price = product?.priceRobux ?? product?.price_robux ?? product?.price ?? null;
                    const id = product?.robloxProductId ?? product?.roblox_product_id ?? product?.id ?? index;

                    // Tracker-based metrics (from productStats.products if available)
                    const trackerProduct = Array.isArray(safeProductStats.products)
                      ? safeProductStats.products.find((p: { id?: string }) => p?.id === String(id))
                      : null;
                    
                    // Calculate estimated values for tracker product
                    const grossRevenue = trackerProduct?.revenue ?? 0;
                    const estimatedRevenue = Math.round(grossRevenue * CREATOR_REVENUE_RATE);
                    const buyers = trackerProduct?.uniqueBuyers ?? 0;
                    const estimatedRevPerBuyer = buyers > 0 ? Math.round((grossRevenue * CREATOR_REVENUE_RATE) / buyers) : 0;

                    return (
                      <tr key={id} className="border-b border-border/30 hover:bg-muted/40 transition-colors">
                        <td className="py-4 px-6">
                          <div className="font-medium text-foreground">{name}</div>
                          <div className="text-xs text-muted-foreground mt-0.5 font-mono">ID: {id}</div>
                        </td>
                        <td className="py-4 px-3">
                          <Badge 
                            variant="secondary" 
                            className={type === "gamepass" 
                              ? "bg-blue-500/15 text-blue-500 border-blue-500/30" 
                              : "bg-purple-500/15 text-purple-500 border-purple-500/30"
                            }
                          >
                            {type === "gamepass" ? "Game Pass" : type === "devproduct" ? "Dev Product" : type}
                          </Badge>
                        </td>
                        <td className="py-4 px-3 text-right font-mono font-medium">
                          {formatRobux(price)}
                        </td>
                        <td className="py-4 px-3 text-right" title={grossRevenue > 0 ? `Gross: R$${grossRevenue.toLocaleString()}` : undefined}>
                          {!hasTrackerEvents 
                            ? <span className="text-xs text-muted-foreground">Needs tracking</span>
                            : <span className="font-mono font-semibold text-emerald-500">{formatRobux(estimatedRevenue)}</span>
                          }
                        </td>
                        <td className="py-4 px-3 text-right">
                          {!hasTrackerEvents 
                            ? <span className="text-xs text-muted-foreground">Needs tracking</span>
                            : <span className="font-medium">{formatNumber(trackerProduct?.purchases ?? 0)}</span>
                          }
                        </td>
                        <td className="py-4 px-3 text-right">
                          {!hasTrackerEvents 
                            ? <span className="text-xs text-muted-foreground">Needs tracking</span>
                            : <span className="font-medium">{formatNumber(buyers)}</span>
                          }
                        </td>
                        <td className="py-4 px-3 text-right">
                          {!hasTrackerEvents 
                            ? <span className="text-xs text-muted-foreground">Needs tracking</span>
                            : trackerProduct && !trackerProduct.conversionNeedsTracking
                              ? <span className="font-medium">{formatPercent(trackerProduct?.conversionRate)}</span>
                              : <span className="text-xs text-muted-foreground">Needs views</span>
                          }
                        </td>
                        <td className="py-4 px-6 text-right">
                          {!hasTrackerEvents 
                            ? <span className="text-xs text-muted-foreground">Needs tracking</span>
                            : <span className="font-mono">{formatRobux(estimatedRevPerBuyer)}</span>
                          }
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
