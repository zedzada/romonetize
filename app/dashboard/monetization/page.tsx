"use client";

import { useState, useMemo, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useChartTheme, getChartAxisProps, getChartGridProps, getChartTooltipStyle } from "@/hooks/use-chart-theme";
import { PlanLock, usePlanAccess } from "@/components/dashboard/plan-lock";
import { RevenueModeToggle } from "@/components/dashboard/revenue-mode-toggle";
import { useRevenueDisplayMode } from "@/hooks/use-revenue-display-mode";
import { CREATOR_REVENUE_RATE } from "@/lib/utils/product-aggregation";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  LineChart,
  Line,
} from "recharts";
import { 
  RefreshCw, 
  DollarSign, 
  ShoppingCart, 
  Users, 
  AlertCircle,
  ExternalLink,
  Activity,
} from "lucide-react";
import Link from "next/link";

// Chart color palette
const COLORS = {
  totalRevenue: "#3B82F6",
  devProduct: "#22C55E",
  gamepass: "#EC4899",
  purchases: "#F59E0B",
};

// Safe number formatter
function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString();
}

function formatRobux(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `R$${value.toLocaleString()}`;
}

type ChartRange = "1h" | "6h" | "24h" | "72h" | "7d" | "28d" | "90d";
type ChartMode = "total" | "gamepasses" | "devproducts";

// Time series point from API
interface TimeSeriesPoint {
  time: string;
  totalRevenue: number;
  gamepassesRevenue: number;
  devProductsRevenue: number;
  purchases: number;
  gamepassPurchases: number;
  devproductPurchases: number;
}

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
interface MonetizationApiData {
  hasGame: boolean;
  selectedGameId?: string;
  selectedGameName?: string;
  range?: string;
  summary: {
    purchases: number;
    payingUsers: number;
    activeUsersRaw: number;
    activeUsersFixed: number;
    grossRevenue: number;
    estimatedRevenue: number;
    arppu: number | null;
    pcr: number | null;
    arpdau: number | null;
    averageDau: number | null;
    averageDailyRevenue: number | null;
    numberOfDays: number;
  };
  timeSeries: TimeSeriesPoint[];
  products: ProductData[];
  hasTrackerEvents: boolean;
  debug?: Record<string, unknown>;
  lastUpdated?: string;
}

// Custom tooltip for the hero chart
function HeroChartTooltip({ 
  active, 
  payload, 
  label,
  chartMode = "total",
  revenueMode = "estimated",
}: { 
  active?: boolean; 
  payload?: Array<{ 
    value: number; 
    name: string; 
    color: string;
    payload?: { 
      totalRevenue?: number;
      gamepassesRevenue?: number;
      devProductsRevenue?: number;
      purchases?: number;
      gamepassPurchases?: number;
      devproductPurchases?: number;
    };
  }>; 
  label?: string;
  chartMode?: ChartMode;
  revenueMode?: "gross" | "estimated";
}) {
  if (!active || !payload?.length) return null;
  
  const date = new Date(label || "");
  const formattedTime = date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const dataPoint = payload[0]?.payload;
  const totalRevenue = dataPoint?.totalRevenue ?? 0;
  const gamepassRevenue = dataPoint?.gamepassesRevenue ?? 0;
  const devproductRevenue = dataPoint?.devProductsRevenue ?? 0;
  const purchases = dataPoint?.purchases ?? 0;
  const gamepassPurchases = dataPoint?.gamepassPurchases ?? 0;
  const devproductPurchases = dataPoint?.devproductPurchases ?? 0;
  
  const revenueLabel = revenueMode === "gross" ? "Gross" : "Est.";
  
  return (
    <div className="bg-popover border border-border rounded-lg shadow-xl p-3 min-w-[200px]">
      <p className="text-xs text-muted-foreground mb-3 font-medium border-b border-border pb-2">{formattedTime}</p>
      <div className="space-y-2">
        {chartMode === "total" && (
          <>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                <span className="text-xs text-muted-foreground">{revenueLabel} Revenue</span>
              </div>
              <span className="text-xs font-semibold text-foreground">R${totalRevenue.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-pink-500" />
                <span className="text-xs text-muted-foreground">Gamepasses</span>
              </div>
              <span className="text-xs font-semibold text-foreground">R${gamepassRevenue.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                <span className="text-xs text-muted-foreground">Dev Products</span>
              </div>
              <span className="text-xs font-semibold text-foreground">R${devproductRevenue.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-border pt-2 mt-2">
              <span className="text-xs text-muted-foreground">Purchases</span>
              <span className="text-xs font-semibold text-foreground">{purchases.toLocaleString()}</span>
            </div>
          </>
        )}
        
        {chartMode === "gamepasses" && (
          <>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-pink-500" />
                <span className="text-xs text-muted-foreground">{revenueLabel} Gamepasses</span>
              </div>
              <span className="text-xs font-semibold text-foreground">R${gamepassRevenue.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-border pt-2 mt-2">
              <span className="text-xs text-muted-foreground">Purchases</span>
              <span className="text-xs font-semibold text-foreground">{gamepassPurchases.toLocaleString()}</span>
            </div>
          </>
        )}
        
        {chartMode === "devproducts" && (
          <>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                <span className="text-xs text-muted-foreground">{revenueLabel} Dev Products</span>
              </div>
              <span className="text-xs font-semibold text-foreground">R${devproductRevenue.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-border pt-2 mt-2">
              <span className="text-xs text-muted-foreground">Purchases</span>
              <span className="text-xs font-semibold text-foreground">{devproductPurchases.toLocaleString()}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Custom legend
function ChartLegend({ items }: { items: Array<{ name: string; color: string; value?: number }> }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-4 mt-4">
      {items.map((item) => (
        <div key={item.name} className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
          <span className="text-xs text-muted-foreground">{item.name}</span>
          {item.value !== undefined && (
            <span className="text-xs font-medium text-foreground">R${item.value.toLocaleString()}</span>
          )}
        </div>
      ))}
    </div>
  );
}

export default function MonetizationPage() {
  return (
    <Suspense fallback={<MonetizationSkeleton />}>
      <MonetizationContent />
    </Suspense>
  );
}

function MonetizationSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-32" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {[...Array(6)].map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <Skeleton className="h-[400px]" />
    </div>
  );
}

function MonetizationContent() {
  const searchParams = useSearchParams();
  const debugMode = searchParams.get("debug") === "true";
  
  const [chartRange, setChartRange] = useState<ChartRange>("28d");
  const [chartMode, setChartMode] = useState<ChartMode>("total");
  
  // Use shared revenue display mode
  const { mode: revenueDisplayMode } = useRevenueDisplayMode();
  
  // Check plan access
  const { canAccessMonetization, loading: planLoading } = usePlanAccess();
  
  // Theme-aware chart colors
  const chartTheme = useChartTheme();
  const axisProps = getChartAxisProps(chartTheme);
  const gridProps = getChartGridProps(chartTheme);
  const tooltipStyle = getChartTooltipStyle(chartTheme);

  // Local state for data fetching
  const [data, setData] = useState<MonetizationApiData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Fetch monetization data from fast endpoint
  const fetchData = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);
    
    try {
      const debugParam = debugMode ? "&debug=true" : "";
      const response = await fetch(`/api/dashboard/monetization-data?range=${chartRange}${debugParam}`, {
        cache: "no-store",
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || "Failed to fetch monetization data");
      }
      
      setData(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch monetization data");
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
  const hasTrackerData = data?.hasTrackerEvents ?? false;
  const needsTrackingScript = !hasTrackerData;
  const selectedGameName = data?.selectedGameName ?? null;
  const summary = data?.summary ?? {
    purchases: 0,
    payingUsers: 0,
    activeUsersRaw: 0,
    activeUsersFixed: 0,
    grossRevenue: 0,
    estimatedRevenue: 0,
    arppu: null,
    pcr: null,
    arpdau: null,
    averageDau: null,
    averageDailyRevenue: null,
    numberOfDays: 1,
  };
  const timeSeries = data?.timeSeries ?? [];
  const products = data?.products ?? [];

  // Process chart data with revenue mode
  const processedChartData = useMemo(() => {
    const revenueMultiplier = revenueDisplayMode === "gross" ? 1 : CREATOR_REVENUE_RATE;
    
    return timeSeries.map(point => ({
      time: point.time,
      totalRevenue: Math.round(point.totalRevenue * revenueMultiplier),
      gamepassesRevenue: Math.round(point.gamepassesRevenue * revenueMultiplier),
      devProductsRevenue: Math.round(point.devProductsRevenue * revenueMultiplier),
      purchases: point.purchases,
      gamepassPurchases: point.gamepassPurchases,
      devproductPurchases: point.devproductPurchases,
    }));
  }, [timeSeries, revenueDisplayMode]);

  // Calculate chart totals
  const chartTotals = useMemo(() => {
    let activeBuckets = 0;
    
    const totals = processedChartData.reduce(
      (acc, d) => {
        if (chartMode === "total" && d.totalRevenue > 0) activeBuckets++;
        else if (chartMode === "gamepasses" && d.gamepassesRevenue > 0) activeBuckets++;
        else if (chartMode === "devproducts" && d.devProductsRevenue > 0) activeBuckets++;
        
        return {
          total: acc.total + d.totalRevenue,
          devproduct: acc.devproduct + d.devProductsRevenue,
          gamepass: acc.gamepass + d.gamepassesRevenue,
          purchases: acc.purchases + d.purchases,
          gamepassPurchases: acc.gamepassPurchases + d.gamepassPurchases,
          devproductPurchases: acc.devproductPurchases + d.devproductPurchases,
        };
      },
      { total: 0, devproduct: 0, gamepass: 0, purchases: 0, gamepassPurchases: 0, devproductPurchases: 0 }
    );
    return { ...totals, activeBuckets };
  }, [processedChartData, chartMode]);

  // Display values - use values from API (already calculated consistently)
  const displayRevenue = revenueDisplayMode === "gross" ? summary.grossRevenue : summary.estimatedRevenue;
  
  // PCR from API (already fixed to never exceed 100%)
  const pcr = summary.pcr;
  
  // ARPPU - calculated based on display mode
  const displayArppu = summary.payingUsers > 0 
    ? Math.round((revenueDisplayMode === "gross" ? summary.grossRevenue : summary.estimatedRevenue) / summary.payingUsers)
    : null;
  
  // ARPDAU - calculated based on display mode
  const displayArpdau = summary.averageDau && summary.averageDau > 0 && summary.numberOfDays > 0
    ? Math.round((revenueDisplayMode === "gross" ? summary.grossRevenue : summary.estimatedRevenue) / summary.numberOfDays / summary.averageDau)
    : null;

  // Y-axis max
  const yAxisMax = useMemo(() => {
    if (!processedChartData.length) return 10;
    
    const visibleKeys = chartMode === "total" 
      ? ["totalRevenue", "gamepassesRevenue", "devProductsRevenue"] as const
      : chartMode === "gamepasses" 
        ? ["gamepassesRevenue"] as const
        : ["devProductsRevenue"] as const;
    
    const rawMax = Math.max(
      ...processedChartData.flatMap((p) => 
        visibleKeys.map((key) => Number(p[key] ?? 0))
      ),
      0
    );
    
    return rawMax <= 0 ? 10 : Math.max(10, Math.ceil(rawMax * 1.25));
  }, [processedChartData, chartMode]);

  // Derived chart data
  const dailyRevenueData = useMemo(() => {
    if (!processedChartData.length) return [];
    const dailyBuckets = new Map<string, number>();
    processedChartData.forEach((p) => {
      const dayKey = new Date(p.time).toISOString().slice(0, 10);
      dailyBuckets.set(dayKey, (dailyBuckets.get(dayKey) || 0) + p.totalRevenue);
    });
    return Array.from(dailyBuckets.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, revenue]) => ({
        date: date + "T00:00:00.000Z",
        revenue,
      }));
  }, [processedChartData]);

  const purchasesOverTimeData = useMemo(() => {
    if (!processedChartData.length) return [];
    const useDailyBuckets = ["7d", "28d", "90d"].includes(chartRange);
    if (useDailyBuckets) {
      const dailyBuckets = new Map<string, number>();
      processedChartData.forEach((p) => {
        const dayKey = new Date(p.time).toISOString().slice(0, 10);
        dailyBuckets.set(dayKey, (dailyBuckets.get(dayKey) || 0) + p.purchases);
      });
      return Array.from(dailyBuckets.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, purchases]) => ({ date: date + "T00:00:00.000Z", purchases }));
    }
    return processedChartData.map((p) => ({ date: p.time, purchases: p.purchases }));
  }, [processedChartData, chartRange]);

  const revenueByTypeData = useMemo(() => {
    const data: Array<{ productType: string; revenue: number }> = [];
    if (chartTotals.gamepass > 0) {
      data.push({ productType: "gamepass", revenue: chartTotals.gamepass });
    }
    if (chartTotals.devproduct > 0) {
      data.push({ productType: "devproduct", revenue: chartTotals.devproduct });
    }
    if (data.length === 0 && chartTotals.total > 0) {
      data.push({ productType: "unknown", revenue: chartTotals.total });
    }
    return data;
  }, [chartTotals]);

  // Effective bucket type
  const effectiveBucketType = useMemo(() => {
    if (["1h", "6h"].includes(chartRange)) return "minute";
    if (["24h", "72h"].includes(chartRange)) return "hour";
    return "day";
  }, [chartRange]);

  const modeConfig = useMemo(() => {
    const prefix = revenueDisplayMode === "gross" ? "" : "Est. ";
    if (chartMode === "total") {
      return {
        label: `${prefix}Revenue`,
        color: COLORS.totalRevenue,
        dataKey: "totalRevenue" as const,
        revenue: chartTotals.total,
        purchases: chartTotals.purchases,
        purchaseLabel: "Purchases",
      };
    } else if (chartMode === "gamepasses") {
      return {
        label: `${prefix}Gamepasses`,
        color: COLORS.gamepass,
        dataKey: "gamepassesRevenue" as const,
        revenue: chartTotals.gamepass,
        purchases: chartTotals.gamepassPurchases,
        purchaseLabel: "Gamepass Purchases",
      };
    } else {
      return {
        label: `${prefix}Dev Products`,
        color: COLORS.devProduct,
        dataKey: "devProductsRevenue" as const,
        revenue: chartTotals.devproduct,
        purchases: chartTotals.devproductPurchases,
        purchaseLabel: "Dev Product Purchases",
      };
    }
  }, [chartMode, chartTotals, revenueDisplayMode]);

  // Plan gating
  if (!planLoading && !canAccessMonetization) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Monetization</h1>
          <p className="text-muted-foreground">Track revenue and purchase metrics</p>
        </div>
        <PlanLock 
          feature="Monetization Analytics" 
          description="Unlock detailed revenue breakdowns, purchase tracking, and monetization insights with a Pro or Studio plan."
        />
      </div>
    );
  }

  // Loading state
  if (isLoading || planLoading) {
    return <MonetizationSkeleton />;
  }

  // Error state - show error but don't block the page if we have some data
  if (error && !data) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Monetization</h1>
          <p className="text-muted-foreground">Track revenue and purchase metrics</p>
        </div>
        <Card className="border-destructive/50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3 text-destructive">
              <AlertCircle className="w-5 h-5" />
              <p>Failed to load monetization data: {error}</p>
            </div>
            <Button onClick={handleRefresh} variant="outline" className="mt-4">
              <RefreshCw className="w-4 h-4 mr-2" />
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const hasPurchaseData = summary.purchases > 0;
  const hasChartData = processedChartData.length > 0;
  const hasCurrentModeData = modeConfig.revenue > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Monetization</h1>
          <p className="text-muted-foreground">
            {selectedGameName
              ? `Showing data for: ${selectedGameName}`
              : "Track revenue and purchase metrics from your tracking script"}
          </p>
        </div>
        <Button 
          onClick={handleRefresh} 
          variant="outline" 
          disabled={isRefreshing}
          className="gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
          Refresh Data
        </Button>
      </div>

      {/* Data source badge and revenue toggle */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[10px]">
            RoMonetize Tracker
          </Badge>
          {hasTrackerData && (
            <span className="text-xs text-muted-foreground">
              Revenue data from tracked purchases
            </span>
          )}
        </div>
        
        <RevenueModeToggle showDescription={false} />
      </div>

      {/* Tracking script required banner */}
      {needsTrackingScript && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-500 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-foreground mb-1">Install tracking script to track revenue</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Monetization data requires the RoMonetize tracking script. The script captures purchases 
                  including the Robux amount, product details, and player information.
                </p>
                <Button variant="outline" size="sm" asChild>
                  <Link href="/dashboard/game/tracking-setup">
                    <ExternalLink className="w-4 h-4 mr-2" />
                    View Installation Guide
                  </Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Revenue disclaimer */}
      {hasTrackerData && (
        <p className="text-[10px] text-muted-foreground">
          Revenue is estimated from RoMonetize tracker events and may differ from official Roblox dashboard reports. Use Roblox Creator Dashboard as the final source of truth for payouts and official revenue.
        </p>
      )}

      {/* Monetization Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {/* Revenue */}
        <Card className="border-border bg-card shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-4 h-4 text-emerald-400" />
              <span className="text-xs text-muted-foreground">
                {revenueDisplayMode === "gross" ? "Gross Revenue" : "Est. Revenue"}
              </span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {!hasTrackerData ? (
                <span className="text-sm text-muted-foreground font-normal">Requires tracking</span>
              ) : (
                formatRobux(displayRevenue)
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              {chartRange.toUpperCase()} range
            </p>
          </CardContent>
        </Card>

        {/* Purchases */}
        <Card className="border-border bg-card shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <ShoppingCart className="w-4 h-4 text-amber-400" />
              <span className="text-xs text-muted-foreground">{chartRange.toUpperCase()} Purchases</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {!hasTrackerData ? (
                <span className="text-sm text-muted-foreground font-normal">Requires tracking</span>
              ) : (
                formatNumber(summary.purchases)
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Total transactions
            </p>
          </CardContent>
        </Card>

        {/* Paying Users */}
        <Card className="border-border bg-card shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-4 h-4 text-violet-400" />
              <span className="text-xs text-muted-foreground">Paying Users</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {!hasTrackerData ? (
                <span className="text-sm text-muted-foreground font-normal">Requires tracking</span>
              ) : (
                formatNumber(summary.payingUsers)
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Unique buyers
            </p>
          </CardContent>
        </Card>

        {/* PCR */}
        <Card className="border-border bg-card shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-4 h-4 text-blue-400" />
              <span className="text-xs text-muted-foreground">PCR</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {!hasTrackerData ? (
                <span className="text-sm text-muted-foreground font-normal">Requires tracking</span>
              ) : pcr != null ? (
                `${pcr.toFixed(2)}%`
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              {summary.activeUsersFixed > 0
                ? `${summary.payingUsers} / ${summary.activeUsersFixed} active users`
                : "Requires active player tracking"
              }
            </p>
          </CardContent>
        </Card>

        {/* ARPPU */}
        <Card className="border-border bg-card shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-4 h-4 text-emerald-400" />
              <span className="text-xs text-muted-foreground">
                {revenueDisplayMode === "gross" ? "Gross ARPPU" : "Est. ARPPU"}
              </span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {!hasTrackerData ? (
                <span className="text-sm text-muted-foreground font-normal">Requires tracking</span>
              ) : displayArppu != null ? (
                formatRobux(displayArppu)
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              {summary.payingUsers > 0
                ? `${formatRobux(displayRevenue)} / ${summary.payingUsers} payers`
                : "Revenue / Paying users"
              }
            </p>
          </CardContent>
        </Card>

        {/* ARPDAU */}
        <Card className="border-border bg-card shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-4 h-4 text-teal-400" />
              <span className="text-xs text-muted-foreground">
                {revenueDisplayMode === "gross" ? "Gross ARPDAU" : "Est. ARPDAU"}
              </span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {!hasTrackerData ? (
                <span className="text-sm text-muted-foreground font-normal">Requires tracking</span>
              ) : displayArpdau != null ? (
                formatRobux(displayArpdau)
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              {summary.averageDau && summary.averageDau > 0
                ? `avg daily rev / ${summary.averageDau} avg DAU`
                : "avg daily revenue / avg DAU"
              }
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Hero Chart */}
      <Card className="border-border bg-card shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <CardTitle className="text-lg font-semibold text-foreground">
                {revenueDisplayMode === "gross" ? "Gross Revenue & Sales" : "Estimated Revenue & Sales"}
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-0.5">
                {chartRange === "1h" ? "Last 1 hour" : chartRange === "6h" ? "Last 6 hours" : chartRange === "24h" ? "Last 24 hours" : chartRange === "72h" ? "Last 72 hours" : chartRange === "7d" ? "Last 7 days" : chartRange === "28d" ? "Last 28 days" : "Last 90 days"}
              </p>
            </div>
            {/* Chart Controls */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Range selector */}
              <div className="flex items-center bg-secondary/50 dark:bg-secondary/80 rounded-lg p-0.5">
                {(["1h", "6h", "24h", "72h", "7d", "28d", "90d"] as ChartRange[]).map((r) => (
                  <button
                    key={r}
                    onClick={() => setChartRange(r)}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      chartRange === r
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {r.toUpperCase()}
                  </button>
                ))}
              </div>
              {/* Mode selector */}
              <div className="flex items-center bg-secondary/50 dark:bg-secondary/80 rounded-lg p-0.5">
                <button
                  onClick={() => setChartMode("total")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    chartMode === "total"
                      ? "bg-blue-600 text-white"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Total
                </button>
                <button
                  onClick={() => setChartMode("gamepasses")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    chartMode === "gamepasses"
                      ? "bg-pink-600 text-white"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Gamepasses
                </button>
                <button
                  onClick={() => setChartMode("devproducts")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    chartMode === "devproducts"
                      ? "bg-green-600 text-white"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Dev Products
                </button>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-2">
          {!hasPurchaseData ? (
            <div className="h-[350px] flex flex-col items-center justify-center text-center">
              <Activity className="w-12 h-12 text-muted-foreground mb-4" />
              <p className="text-base font-medium text-foreground mb-1">No purchases tracked yet</p>
              <p className="text-sm text-muted-foreground max-w-md">
                Install the tracking script and make a purchase to see revenue data here.
              </p>
            </div>
          ) : !hasChartData ? (
            <div className="h-[350px] flex flex-col items-center justify-center text-center">
              <Activity className="w-12 h-12 text-muted-foreground mb-4" />
              <p className="text-base font-medium text-foreground mb-1">Loading chart data...</p>
            </div>
          ) : (
            <>
              {/* Summary stats */}
              <div className="flex items-center justify-center gap-6 mb-4 text-center">
                <div>
                  <p className="text-2xl font-bold text-foreground">R${modeConfig.revenue.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">{modeConfig.label}</p>
                </div>
                <div className="w-px h-10 bg-border" />
                <div>
                  <p className="text-2xl font-bold text-foreground">{modeConfig.purchases.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">{modeConfig.purchaseLabel}</p>
                </div>
                <div className="w-px h-10 bg-border" />
                <div>
                  <p className="text-2xl font-bold text-foreground">{chartTotals.activeBuckets}</p>
                  <p className="text-xs text-muted-foreground">Active {effectiveBucketType === "minute" ? "Minutes" : effectiveBucketType === "hour" ? "Hours" : "Days"}</p>
                </div>
              </div>

              {/* Legend */}
              <div className="flex items-center justify-center gap-4 mb-4">
                {chartMode === "total" ? (
                  <>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS.totalRevenue }} />
                      <span className="text-xs text-foreground">Total Revenue</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS.gamepass }} />
                      <span className="text-xs text-foreground">Gamepasses</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS.devProduct }} />
                      <span className="text-xs text-foreground">Dev Products</span>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: modeConfig.color }} />
                    <span className="text-xs text-foreground">{modeConfig.label}</span>
                  </div>
                )}
              </div>
              
              <div className="h-[360px] relative">
                {hasChartData && !hasCurrentModeData && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-background/90 rounded-lg">
                    <p className="text-muted-foreground text-sm font-medium">No revenue for this view</p>
                    <p className="text-muted-foreground text-xs mt-1">Try another product type or range.</p>
                  </div>
                )}
                
                <ResponsiveContainer width="100%" height="100%">
                  {chartMode === "total" ? (
                    <LineChart data={processedChartData} margin={{ top: 20, right: 20, left: 10, bottom: 10 }}>
                      <CartesianGrid {...gridProps} />
                      <XAxis 
                        dataKey="time" 
                        tickFormatter={(v) => {
                          const date = new Date(v);
                          if (effectiveBucketType === "minute") {
                            return date.toLocaleString(undefined, { hour: "numeric", minute: "2-digit", hour12: true });
                          }
                          if (effectiveBucketType === "hour") {
                            return date.toLocaleString(undefined, { hour: "numeric", hour12: true });
                          }
                          return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
                        }}
                        {...axisProps}
                        tick={{ fill: chartTheme.axis, fontSize: 10 }}
                        interval="preserveStartEnd"
                      />
                      <YAxis 
                        domain={[0, yAxisMax]}
                        tickFormatter={(v) => v === 0 ? "0" : `R$${v >= 1000 ? `${(v/1000).toFixed(1)}k` : v}`}
                        {...axisProps}
                        tick={{ fill: chartTheme.axis, fontSize: 11 }}
                        width={60}
                      />
                      <Tooltip content={<HeroChartTooltip chartMode={chartMode} revenueMode={revenueDisplayMode} />} />
                      
                      <Line
                        type="monotone"
                        dataKey="totalRevenue"
                        name="Total Revenue"
                        stroke={COLORS.totalRevenue}
                        strokeWidth={3}
                        dot={{ r: 3, fill: COLORS.totalRevenue }}
                        activeDot={{ r: 6 }}
                        connectNulls
                      />
                      <Line
                        type="monotone"
                        dataKey="gamepassesRevenue"
                        name="Gamepasses"
                        stroke={COLORS.gamepass}
                        strokeWidth={3}
                        dot={{ r: 3, fill: COLORS.gamepass }}
                        activeDot={{ r: 6 }}
                        connectNulls
                      />
                      <Line
                        type="monotone"
                        dataKey="devProductsRevenue"
                        name="Dev Products"
                        stroke={COLORS.devProduct}
                        strokeWidth={3}
                        dot={{ r: 3, fill: COLORS.devProduct }}
                        activeDot={{ r: 6 }}
                        connectNulls
                      />
                    </LineChart>
                  ) : (
                    <AreaChart data={processedChartData} margin={{ top: 20, right: 20, left: 10, bottom: 10 }}>
                      <defs>
                        <linearGradient id="gradientGamepass" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={COLORS.gamepass} stopOpacity={0.3}/>
                          <stop offset="100%" stopColor={COLORS.gamepass} stopOpacity={0.05}/>
                        </linearGradient>
                        <linearGradient id="gradientDevProduct" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={COLORS.devProduct} stopOpacity={0.3}/>
                          <stop offset="100%" stopColor={COLORS.devProduct} stopOpacity={0.05}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid {...gridProps} />
                      <XAxis 
                        dataKey="time" 
                        tickFormatter={(v) => {
                          const date = new Date(v);
                          if (effectiveBucketType === "minute") {
                            return date.toLocaleString(undefined, { hour: "numeric", minute: "2-digit", hour12: true });
                          }
                          if (effectiveBucketType === "hour") {
                            return date.toLocaleString(undefined, { hour: "numeric", hour12: true });
                          }
                          return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
                        }}
                        {...axisProps}
                        tick={{ fill: chartTheme.axis, fontSize: 10 }}
                        interval="preserveStartEnd"
                      />
                      <YAxis 
                        domain={[0, yAxisMax]}
                        tickFormatter={(v) => v === 0 ? "0" : `R$${v >= 1000 ? `${(v/1000).toFixed(1)}k` : v}`}
                        {...axisProps}
                        tick={{ fill: chartTheme.axis, fontSize: 11 }}
                        width={60}
                      />
                      <Tooltip content={<HeroChartTooltip chartMode={chartMode} revenueMode={revenueDisplayMode} />} />
                      
                      {chartMode === "gamepasses" && (
                        <Area
                          type="monotone"
                          dataKey="gamepassesRevenue"
                          name="Gamepasses"
                          stroke={COLORS.gamepass}
                          strokeWidth={3}
                          fill="url(#gradientGamepass)"
                          dot={{ r: 4, fill: COLORS.gamepass, strokeWidth: 0 }}
                          activeDot={{ r: 6, fill: COLORS.gamepass, strokeWidth: 2, stroke: "#0a0a0a" }}
                          connectNulls
                        />
                      )}
                      
                      {chartMode === "devproducts" && (
                        <Area
                          type="monotone"
                          dataKey="devProductsRevenue"
                          name="Dev Products"
                          stroke={COLORS.devProduct}
                          strokeWidth={3}
                          fill="url(#gradientDevProduct)"
                          dot={{ r: 4, fill: COLORS.devProduct, strokeWidth: 0 }}
                          activeDot={{ r: 6, fill: COLORS.devProduct, strokeWidth: 2, stroke: "#0a0a0a" }}
                          connectNulls
                        />
                      )}
                    </AreaChart>
                  )}
                </ResponsiveContainer>
              </div>
              
              <ChartLegend 
                items={chartMode === "total" 
                  ? [
                      { name: "Total Revenue", color: COLORS.totalRevenue, value: chartTotals.total },
                      { name: "Gamepasses", color: COLORS.gamepass, value: chartTotals.gamepass },
                      { name: "Dev Products", color: COLORS.devProduct, value: chartTotals.devproduct },
                    ]
                  : [{ name: modeConfig.label, color: modeConfig.color, value: modeConfig.revenue }]
                }
              />
            </>
          )}
        </CardContent>
      </Card>

      {/* Supporting Charts Grid */}
      {hasTrackerData && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Est. Daily Revenue Chart */}
          <Card className="border-border bg-card shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-foreground">
                {revenueDisplayMode === "gross" ? "Daily Gross Revenue" : "Est. Daily Revenue"}
              </CardTitle>
              <p className="text-xs text-muted-foreground">Revenue grouped by day</p>
            </CardHeader>
            <CardContent className="pt-2">
              {dailyRevenueData.length > 0 ? (
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dailyRevenueData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="dailyRevenueGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={COLORS.totalRevenue} stopOpacity={1}/>
                          <stop offset="100%" stopColor={COLORS.totalRevenue} stopOpacity={0.6}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid {...gridProps} />
                      <XAxis 
                        dataKey="date" 
                        tickFormatter={(v) => {
                          const d = new Date(v);
                          return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
                        }}
                        {...axisProps}
                        tick={{ fill: chartTheme.axis, fontSize: 10 }}
                        interval="preserveStartEnd"
                      />
                      <YAxis 
                        tickFormatter={(v) => `R$${v >= 1000 ? `${(v/1000).toFixed(1)}k` : v}`}
                        {...axisProps}
                        tick={{ fill: chartTheme.axis, fontSize: 10 }}
                        width={50}
                      />
                      <Tooltip
                        {...tooltipStyle}
                        labelFormatter={(v) => {
                          const d = new Date(v);
                          return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
                        }}
                        formatter={(value: number) => [`R$${value.toLocaleString()}`, revenueDisplayMode === "gross" ? "Gross Revenue" : "Est. Revenue"]}
                      />
                      <Bar 
                        dataKey="revenue" 
                        fill="url(#dailyRevenueGradient)"
                        radius={[6, 6, 0, 0]}
                        maxBarSize={45}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-[220px] flex items-center justify-center">
                  <p className="text-sm text-muted-foreground">{hasPurchaseData ? "No revenue in selected range" : "No purchases tracked yet"}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Purchases Over Time Chart */}
          <Card className="border-border bg-card shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-foreground">Purchases Over Time</CardTitle>
              <p className="text-xs text-muted-foreground">Number of transactions</p>
            </CardHeader>
            <CardContent className="pt-2">
              {purchasesOverTimeData.length > 0 ? (
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={purchasesOverTimeData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="purchasesGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={COLORS.purchases} stopOpacity={0.4}/>
                          <stop offset="100%" stopColor={COLORS.purchases} stopOpacity={0.05}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid {...gridProps} />
                      <XAxis 
                        dataKey="date" 
                        tickFormatter={(v) => {
                          const d = new Date(v);
                          if (["1h", "6h", "24h", "72h"].includes(chartRange)) {
                            return d.toLocaleString(undefined, { hour: "numeric", hour12: true });
                          }
                          return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
                        }}
                        {...axisProps}
                        tick={{ fill: chartTheme.axis, fontSize: 10 }}
                        interval="preserveStartEnd"
                      />
                      <YAxis 
                        allowDecimals={false}
                        {...axisProps}
                        tick={{ fill: chartTheme.axis, fontSize: 10 }}
                        width={30}
                      />
                      <Tooltip
                        {...tooltipStyle}
                        labelFormatter={(v) => {
                          const d = new Date(v);
                          if (["1h", "6h", "24h", "72h"].includes(chartRange)) {
                            return d.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit", hour12: true });
                          }
                          return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
                        }}
                        formatter={(value: number) => [value.toLocaleString(), "Purchases"]}
                      />
                      <Area 
                        type="monotone"
                        dataKey="purchases" 
                        stroke={COLORS.purchases}
                        strokeWidth={3}
                        fill="url(#purchasesGradient)"
                        dot={{ r: 2, fill: COLORS.purchases, strokeWidth: 0 }}
                        activeDot={{ r: 5, fill: COLORS.purchases, strokeWidth: 2, stroke: "#0a0a0a" }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-[220px] flex items-center justify-center">
                  <p className="text-sm text-muted-foreground">{hasPurchaseData ? "No purchases in selected range" : "No purchases tracked yet"}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Revenue by Type */}
          <Card className="border-border bg-card shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-foreground">
                {revenueDisplayMode === "gross" ? "Revenue by Type" : "Est. Revenue by Type"}
              </CardTitle>
              <p className="text-xs text-muted-foreground">Gamepasses vs Developer Products</p>
            </CardHeader>
            <CardContent className="pt-2">
              {revenueByTypeData.length > 0 ? (() => {
                const typeTotal = revenueByTypeData.reduce((s, i) => s + i.revenue, 0);
                const typeColorMap: Record<string, string> = {
                  gamepass: COLORS.gamepass,
                  devproduct: COLORS.devProduct,
                  unknown: "#9CA3AF",
                };
                const typeLabelMap: Record<string, string> = {
                  gamepass: "Game Passes",
                  devproduct: "Dev Products",
                  unknown: "Unknown",
                };
                return (
                  <div className="h-[220px] flex items-center justify-center gap-6">
                    <ResponsiveContainer width={180} height={180}>
                      <PieChart>
                        <Pie
                          data={revenueByTypeData}
                          dataKey="revenue"
                          nameKey="productType"
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={80}
                          paddingAngle={3}
                          strokeWidth={0}
                        >
                          {revenueByTypeData.map((entry) => (
                            <Cell 
                              key={entry.productType} 
                              fill={typeColorMap[entry.productType] || "#9CA3AF"}
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          {...tooltipStyle}
                          formatter={(value: number, name: string) => [
                            `R$${value.toLocaleString()}`,
                            typeLabelMap[name] || name
                          ]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="space-y-3">
                      {revenueByTypeData.map((item) => {
                        const percentage = typeTotal > 0 ? ((item.revenue / typeTotal) * 100).toFixed(1) : "0";
                        return (
                          <div key={item.productType} className="flex items-center gap-3">
                            <div 
                              className="w-4 h-4 rounded-md" 
                              style={{ backgroundColor: typeColorMap[item.productType] || "#9CA3AF" }}
                            />
                            <div>
                              <p className="text-sm font-medium text-foreground">
                                {typeLabelMap[item.productType] || item.productType}
                              </p>
                              <p className="text-lg font-bold text-foreground">
                                R${item.revenue.toLocaleString()}
                                <span className="text-xs text-muted-foreground ml-1">({percentage}%)</span>
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })() : (
                <div className="h-[220px] flex items-center justify-center">
                  <p className="text-sm text-muted-foreground">{hasPurchaseData ? "No revenue breakdown available" : "No purchases tracked yet"}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Top Products */}
          <Card className="border-border bg-card shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-foreground">
                Top Products by {revenueDisplayMode === "gross" ? "Gross" : "Est."} Revenue
              </CardTitle>
              <p className="text-xs text-muted-foreground">Best performing products</p>
            </CardHeader>
            <CardContent className="pt-2">
              {products.length > 0 ? (() => {
                const displayProducts = products.slice(0, 5).map(p => ({
                  ...p,
                  displayRevenue: revenueDisplayMode === "gross" ? p.grossRevenue : p.estimatedRevenue
                }));
                return (
                  <div className="h-[220px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart 
                        data={displayProducts} 
                        layout="vertical"
                        margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
                      >
                        <defs>
                          <linearGradient id="topProductsGradient" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor={COLORS.devProduct} stopOpacity={0.8}/>
                            <stop offset="100%" stopColor={COLORS.devProduct} stopOpacity={1}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} strokeOpacity={chartTheme.gridOpacity} horizontal={true} vertical={false} />
                        <XAxis 
                          type="number"
                          tickFormatter={(v) => `R$${v >= 1000 ? `${(v/1000).toFixed(1)}k` : v}`}
                          {...axisProps}
                          tick={{ fill: chartTheme.axis, fontSize: 10 }}
                        />
                        <YAxis 
                          type="category"
                          dataKey="productName"
                          width={100}
                          {...axisProps}
                          tick={{ fill: chartTheme.label, fontSize: 11 }}
                          tickFormatter={(v) => v.length > 14 ? v.slice(0, 14) + "..." : v}
                        />
                        <Tooltip
                          {...tooltipStyle}
                          formatter={(value: number, name: string, props: { payload?: { productType?: string; purchases?: number } }) => {
                            const payload = props.payload;
                            return [
                              <span key="value">
                                R${value.toLocaleString()} 
                                <span style={{ color: chartTheme.mutedLabel, marginLeft: "8px" }}>({payload?.purchases || 0} sales)</span>
                              </span>,
                              payload?.productType === "gamepass" ? "Game Pass" : "Dev Product"
                            ];
                          }}
                        />
                        <Bar 
                          dataKey="displayRevenue"
                          fill="url(#topProductsGradient)"
                          radius={[0, 6, 6, 0]}
                          maxBarSize={30}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                );
              })() : (
                <div className="h-[220px] flex items-center justify-center">
                  <p className="text-sm text-muted-foreground">{hasPurchaseData ? "No products tracked yet" : "No purchases tracked yet"}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Debug Panel */}
      {debugMode && data?.debug && (
        <Card className="border-amber-500/50 bg-amber-500/5 mt-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-amber-400">Monetization Debug</CardTitle>
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
