"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RangeControls, type ChartDateRange } from "@/components/dashboard/chart-card";
import { PlanLock, usePlanAccess } from "@/components/dashboard/plan-lock";
import { RevenueModeToggleCompact } from "@/components/dashboard/revenue-mode-toggle";
import { useRevenueDisplayMode } from "@/hooks/use-revenue-display-mode";
import { CREATOR_REVENUE_RATE } from "@/lib/utils/product-aggregation";
import {
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Package,
  DollarSign,
  ShoppingCart,
  Users,
  TrendingUp,
} from "lucide-react";

// formatNumber, formatRobux, formatPercent helpers
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

// Products page range type - supports 7d to 90d
type ProductsRange = "7d" | "28d" | "90d";

// Product from API
interface ProductData {
  productId: string;
  productName: string;
  productType: "gamepass" | "devproduct" | "unknown";
  purchases: number;
  buyers: number;
  grossRevenue: number;
  estimatedRevenue: number;
  revPerBuyer: number;
}

// API response data shape
interface ProductsApiData {
  hasGame: boolean;
  selectedGameId?: string;
  selectedGameName?: string;
  range?: string;
  products: ProductData[];
  summary: {
    totalProducts: number;
    grossRevenue: number;
    estimatedRevenue: number;
    totalPurchases: number;
    totalBuyers: number;
    payerConversionRate: number | null;
    activeUsers?: number;
    arppu?: number | null;
  };
  hasTrackerEvents: boolean;
  debug?: Record<string, unknown>;
  lastUpdated?: string;
}

function ProductsPageContent() {
  const [chartRange, setChartRange] = useState<ProductsRange>("28d");
  const searchParams = useSearchParams();
  const debugMode = searchParams.get("debug") === "true";
  
  // Check plan access - use canAccessProducts for proper gating
  const { canAccessProducts, loading: planLoading } = usePlanAccess();
  
  // Use shared revenue display mode (consistent across all pages)
  const { mode: revenueDisplayMode } = useRevenueDisplayMode();
  
  // Local state for data fetching
  const [data, setData] = useState<ProductsApiData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Fetch products data from fast endpoint
  const fetchData = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);
    
    try {
      const debugParam = debugMode ? "&debug=true" : "";
      const response = await fetch(`/api/dashboard/products-data?range=${chartRange}${debugParam}`, {
        cache: "no-store",
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || "Failed to fetch products data");
      }
      
      setData(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch products data");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [chartRange, debugMode]);
  
  // Fetch on mount and when range changes
  useEffect(() => {
    fetchData();
  }, [fetchData]);
  
  // Refresh handler
  const handleRefresh = useCallback(() => {
    fetchData(true);
  }, [fetchData]);

  // Safe defaults
  const hasTrackerEvents = data?.hasTrackerEvents ?? false;
  const products = data?.products ?? [];
  const summary = data?.summary ?? {
    totalProducts: 0,
    grossRevenue: 0,
    estimatedRevenue: 0,
    totalPurchases: 0,
    totalBuyers: 0,
    payerConversionRate: null,
  };
  const selectedGameName = data?.selectedGameName ?? null;
  const hasTrackerProducts = products.length > 0;

  // Plan gating - show upgrade screen for free users
  if (!planLoading && !canAccessProducts) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Products</h1>
          <p className="text-muted-foreground">Track Roblox products, gamepasses, and monetization performance</p>
        </div>
        <PlanLock 
          feature="Products Analytics" 
          description="Unlock product performance tracking, purchase analytics, and conversion insights with a Pro or Studio plan."
        />
      </div>
    );
  }

  // Loading state
  if (isLoading || planLoading) {
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

  // Error state - show error but don't block the page entirely
  if (error && !data) {
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
            <Button onClick={handleRefresh} variant="outline" size="sm" className="mt-4">
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
          <RevenueModeToggleCompact />
          <RangeControls
            value={chartRange as ChartDateRange}
            onChange={(r) => setChartRange(r as ProductsRange)}
            ranges={["7d", "28d", "90d"]}
          />
          <Button
            onClick={handleRefresh}
            variant="outline"
            size="sm"
            disabled={isRefreshing}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`} />
            Refresh Data
          </Button>
        </div>
      </div>

      {/* No tracker events banner */}
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
      ) : summary.totalPurchases === 0 && (
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
              {formatNumber(summary.totalProducts)}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-4 h-4 text-green-500" />
              <span className="text-xs text-muted-foreground">
                {revenueDisplayMode === "gross" ? "Gross Revenue" : "Est. Revenue"}
              </span>
            </div>
            {(() => {
              const grossRevenue = summary.grossRevenue;
              const estimatedRevenue = summary.estimatedRevenue;
              const displayRevenue = revenueDisplayMode === "gross" ? grossRevenue : estimatedRevenue;
              const altRevenue = revenueDisplayMode === "gross" ? estimatedRevenue : grossRevenue;
              const altLabel = revenueDisplayMode === "gross" ? "Est" : "Gross";
              
              return (
                <>
                  <div className="text-2xl font-bold text-foreground">
                    {hasTrackerEvents ? formatRobux(displayRevenue) : (
                      <span className="text-sm text-muted-foreground font-normal">Requires tracking</span>
                    )}
                  </div>
                  {hasTrackerEvents && displayRevenue > 0 && (
                    <p className="text-[10px] text-muted-foreground mt-1" title={`${altLabel}: R$${altRevenue.toLocaleString()}`}>
                      {revenueDisplayMode === "gross" ? `Est: R$${estimatedRevenue.toLocaleString()}` : `Gross: R$${grossRevenue.toLocaleString()}`}
                    </p>
                  )}
                </>
              );
            })()}
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <ShoppingCart className="w-4 h-4 text-purple-500" />
              <span className="text-xs text-muted-foreground">{chartRange.toUpperCase()} Purchases</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {hasTrackerEvents ? formatNumber(summary.totalPurchases) : (
                <span className="text-sm text-muted-foreground font-normal">Requires tracking</span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Last {chartRange === "7d" ? "7 days" : chartRange === "28d" ? "28 days" : "90 days"}</p>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-4 h-4 text-orange-500" />
              <span className="text-xs text-muted-foreground">Unique Buyers</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {hasTrackerEvents ? formatNumber(summary.totalBuyers) : (
                <span className="text-sm text-muted-foreground font-normal">Requires tracking</span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-cyan-500" />
              <span className="text-xs text-muted-foreground">Payer Conversion Rate</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {hasTrackerEvents && summary.payerConversionRate !== null
                ? formatPercent(summary.payerConversionRate)
                : <span className="text-lg text-muted-foreground font-normal">—</span>
              }
            </div>
            {hasTrackerEvents && summary.payerConversionRate !== null && (
              <p className="text-[10px] text-muted-foreground mt-1">
                Paying Users / Active Users
              </p>
            )}
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
              <p className="text-[10px] text-muted-foreground mt-1">
                Product revenue is estimated from tracked purchases and may differ from Roblox due to processing delays, refunds, fees, or reporting differences.
              </p>
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
                    <th className="text-right py-3.5 px-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
                      {revenueDisplayMode === "gross" ? "Gross Revenue" : "Est. Revenue"}
                    </th>
                    <th className="text-right py-3.5 px-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide">Purchases</th>
                    <th className="text-right py-3.5 px-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide">Buyers</th>
                    <th className="text-right py-3.5 px-6 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
                      {revenueDisplayMode === "gross" ? "Rev/Buyer" : "Est. Rev/Buyer"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => {
                    const productId = product.productId;
                    const productName = product.productName !== "Unknown Product" && !product.productName.startsWith("Unknown Product #")
                      ? product.productName
                      : productId !== "unknown" 
                        ? `Unknown Product #${productId}`
                        : "Unknown Product";
                    const productType = product.productType;
                    const grossRevenue = product.grossRevenue;
                    const estimatedRevenue = product.estimatedRevenue;
                    const displayRevenue = revenueDisplayMode === "gross" ? grossRevenue : estimatedRevenue;
                    const altRevenue = revenueDisplayMode === "gross" ? estimatedRevenue : grossRevenue;
                    const altLabel = revenueDisplayMode === "gross" ? "Est" : "Gross";
                    const purchases = product.purchases;
                    const buyers = product.buyers;
                    const displayRevPerBuyer = revenueDisplayMode === "gross" 
                      ? (buyers > 0 ? Math.round(grossRevenue / buyers) : 0)
                      : product.revPerBuyer;
                    
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
                        <td className="py-4 px-3 text-right font-mono font-semibold text-emerald-400" title={`${altLabel}: R$${altRevenue.toLocaleString()}`}>
                          {formatRobux(displayRevenue)}
                        </td>
                        <td className="py-4 px-3 text-right font-medium text-foreground">
                          {formatNumber(purchases)}
                        </td>
                        <td className="py-4 px-3 text-right font-medium text-foreground">
                          {formatNumber(buyers)}
                        </td>
                        <td className="py-4 px-6 text-right font-mono text-muted-foreground">
                          {formatRobux(displayRevPerBuyer)}
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
      {hasTrackerEvents && !hasTrackerProducts && (
        <Card className="border-border/50">
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <Package className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
              <p className="text-foreground font-medium mb-2">No products tracked yet</p>
              <p className="text-sm text-muted-foreground mb-4">
                Product data will appear when players make purchases in your game.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Debug Panel - visible when ?debug=true */}
      {debugMode && data?.debug && (
        <Card className="border-amber-500/50 bg-amber-500/5 mt-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-amber-400">Products Debug</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap overflow-x-auto">
{JSON.stringify({
  selectedRange: chartRange,
  revenueMode: revenueDisplayMode,
  ...data.debug,
}, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function ProductsPage() {
  return (
    <Suspense fallback={<div className="space-y-6"><div className="flex items-center justify-center py-20"><span className="text-muted-foreground">Loading...</span></div></div>}>
      <ProductsPageContent />
    </Suspense>
  );
}
