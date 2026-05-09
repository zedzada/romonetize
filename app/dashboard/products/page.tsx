"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAnalytics } from "@/hooks/use-analytics";
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

// Safe percentage formatter
function formatPercent(value: unknown): string {
  if (typeof value === "number" && !isNaN(value)) {
    return `${(value * 100).toFixed(1)}%`;
  }
  return "—";
}

export default function ProductsPage() {
  const {
    isLoading,
    isRefreshing,
    error,
    dataHealth,
    productStats,
    syncedProducts,
    refresh,
  } = useAnalytics({ enabled: true });

  // Safe defaults per spec
  const safeProductStats = productStats ?? {};
  const safeSyncedProducts = Array.isArray(syncedProducts?.products)
    ? syncedProducts.products
    : Array.isArray(safeProductStats.products)
    ? safeProductStats.products
    : [];

  const hasTrackerEvents = dataHealth?.hasTrackerEvents ?? false;
  const hasSyncedProducts = safeSyncedProducts.length > 0;

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
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Products</h1>
          <p className="text-muted-foreground">Track Roblox products, gamepasses, and monetization performance</p>
        </div>
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

      {/* Data Status Banners */}
      {hasSyncedProducts && (
        <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span className="text-sm text-emerald-700">
            Roblox products synced ({safeSyncedProducts.length} products)
          </span>
        </div>
      )}

      {!hasTrackerEvents && (
        <div className="flex items-center justify-between p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600" />
            <span className="text-sm text-amber-700">
              Install the RoMonetize tracking script to unlock purchases, revenue, and conversion.
            </span>
          </div>
          <Button variant="outline" size="sm" asChild>
            <a href="/dashboard/settings/tracker" className="flex items-center gap-1">
              View Installation Guide
              <ExternalLink className="w-3 h-3" />
            </a>
          </Button>
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
              {formatNumber(safeSyncedProducts.length)}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-4 h-4 text-green-500" />
              <span className="text-xs text-muted-foreground">Total Revenue</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {hasTrackerEvents ? formatRobux(safeProductStats.totalRevenue) : (
                <span className="text-sm text-muted-foreground font-normal">Requires tracking</span>
              )}
            </div>
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

      {/* Products List */}
      <Card className="border-border/50">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Products</CardTitle>
          <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-[10px]">
            Roblox API
          </Badge>
        </CardHeader>
        <CardContent>
          {hasSyncedProducts ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-2 font-medium text-muted-foreground">Product</th>
                    <th className="text-left py-3 px-2 font-medium text-muted-foreground">Type</th>
                    <th className="text-right py-3 px-2 font-medium text-muted-foreground">Price</th>
                    <th className="text-right py-3 px-2 font-medium text-muted-foreground">Revenue</th>
                    <th className="text-right py-3 px-2 font-medium text-muted-foreground">Purchases</th>
                    <th className="text-right py-3 px-2 font-medium text-muted-foreground">Unique Buyers</th>
                    <th className="text-right py-3 px-2 font-medium text-muted-foreground">Conv. Rate</th>
                    <th className="text-right py-3 px-2 font-medium text-muted-foreground">Rev/Buyer</th>
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

                    return (
                      <tr key={id} className="border-b border-border/50 hover:bg-muted/30">
                        <td className="py-3 px-2">
                          <div className="font-medium text-foreground">{name}</div>
                        </td>
                        <td className="py-3 px-2">
                          <Badge variant="outline" className="text-xs">
                            {type === "gamepass" ? "Game Pass" : type === "devproduct" ? "Dev Product" : type}
                          </Badge>
                        </td>
                        <td className="py-3 px-2 text-right font-mono">
                          {formatRobux(price)}
                        </td>
                        <td className="py-3 px-2 text-right">
                          {hasTrackerEvents 
                            ? formatRobux(trackerProduct?.revenue) 
                            : <span className="text-xs text-muted-foreground">Requires tracking</span>
                          }
                        </td>
                        <td className="py-3 px-2 text-right">
                          {hasTrackerEvents 
                            ? formatNumber(trackerProduct?.purchases) 
                            : <span className="text-xs text-muted-foreground">Requires tracking</span>
                          }
                        </td>
                        <td className="py-3 px-2 text-right">
                          {hasTrackerEvents 
                            ? formatNumber(trackerProduct?.uniqueBuyers) 
                            : <span className="text-xs text-muted-foreground">Requires tracking</span>
                          }
                        </td>
                        <td className="py-3 px-2 text-right">
                          {hasTrackerEvents && trackerProduct && !trackerProduct.conversionNeedsTracking
                            ? formatPercent(trackerProduct?.conversionRate)
                            : <span className="text-xs text-muted-foreground">Needs tracking</span>
                          }
                        </td>
                        <td className="py-3 px-2 text-right">
                          {hasTrackerEvents 
                            ? formatRobux(trackerProduct?.revPerBuyer) 
                            : <span className="text-xs text-muted-foreground">Requires tracking</span>
                          }
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12">
              <Package className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground mb-4">No Roblox products synced yet</p>
              <Button onClick={handleSyncRoblox} variant="outline">
                <RefreshCw className="w-4 h-4 mr-2" />
                Sync Roblox Data
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
