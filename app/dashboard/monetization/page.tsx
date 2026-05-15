"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAnalytics, formatChartTime, type HourlyMonetizationPoint } from "@/hooks/use-analytics";
import { CHART_COLORS } from "@/components/dashboard/chart-card";
import { useChartTheme, getChartAxisProps, getChartGridProps, getChartTooltipStyle } from "@/hooks/use-chart-theme";
import { PlanLock, usePlanAccess } from "@/components/dashboard/plan-lock";
import { RevenueModeToggle } from "@/components/dashboard/revenue-mode-toggle";
import { useRevenueDisplayMode, type RevenueDisplayMode } from "@/hooks/use-revenue-display-mode";
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
  Legend,
  LineChart,
  Line,
} from "recharts";
import { 
  RefreshCw, 
  DollarSign, 
  ShoppingCart, 
  Users, 
  TrendingUp,
  AlertCircle,
  ExternalLink,
  Coins,
  Activity,
} from "lucide-react";
import Link from "next/link";

// Chart color palette - series colors (theme-independent, always vibrant)
const COLORS = {
  totalRevenue: "#3B82F6",    // Bright blue
  devProduct: "#22C55E",      // Vivid green
  gamepass: "#EC4899",        // Hot pink
  purchases: "#F59E0B",       // Amber
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
type ChartInterval = "1m" | "hourly" | "daily";
type ChartMode = "total" | "gamepasses" | "devproducts";

// Ranges that support 1m interval (max 24h of minute data)
const MINUTE_COMPATIBLE_RANGES: ChartRange[] = ["1h", "6h", "24h"];

// Ranges that require daily interval (>28d)
const DAILY_ONLY_RANGES: ChartRange[] = ["90d"];

// Helper to check if range supports 1m interval
function supportsMinuteInterval(range: ChartRange): boolean {
  return MINUTE_COMPATIBLE_RANGES.includes(range);
}

// Helper to check if range requires daily interval
function requiresDailyInterval(range: ChartRange): boolean {
  return DAILY_ONLY_RANGES.includes(range);
}

// Roblox takes 30%, creators get 70%
const CREATOR_REVENUE_RATE = 0.7;

// Custom tooltip for the hero chart - shows mode-specific data with estimated revenue
function HeroChartTooltip({ 
  active, 
  payload, 
  label,
  chartMode = "total",
}: { 
  active?: boolean; 
  payload?: Array<{ 
    value: number; 
    name: string; 
    color: string;
    payload?: { 
      totalRevenue?: number;
      devproductRevenue?: number;
      gamepassRevenue?: number;
      purchases?: number;
    };
  }>; 
  label?: string;
  chartMode?: ChartMode;
}) {
  if (!active || !payload?.length) return null;
  
  const date = new Date(label || "");
  // For minute mode, show HH:mm format prominently
  const formattedTime = date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  // Get the underlying data point (gross values from API)
  const dataPoint = payload[0]?.payload;
  const grossTotal = dataPoint?.totalRevenue ?? 0;
  const grossDevproduct = dataPoint?.devproductRevenue ?? 0;
  const grossGamepass = dataPoint?.gamepassRevenue ?? 0;
  const purchases = dataPoint?.purchases ?? 0;
  
  // Calculate estimated (70%) values
  const estTotal = Math.round(grossTotal * CREATOR_REVENUE_RATE);
  const estDevproduct = Math.round(grossDevproduct * CREATOR_REVENUE_RATE);
  const estGamepass = Math.round(grossGamepass * CREATOR_REVENUE_RATE);
  
  // Estimate purchases by type based on revenue ratio
  const gamepassPurchases = grossTotal > 0 ? Math.round(purchases * (grossGamepass / grossTotal)) : 0;
  const devproductPurchases = grossTotal > 0 ? Math.round(purchases * (grossDevproduct / grossTotal)) : 0;
  
  return (
    <div className="bg-popover border border-border rounded-lg shadow-xl p-3 min-w-[180px]">
      <p className="text-xs text-muted-foreground mb-3 font-medium border-b border-border pb-2">{formattedTime}</p>
      <div className="space-y-2">
        {/* Total mode: show all 3 revenue types with estimated values */}
        {chartMode === "total" && (
          <>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                <span className="text-xs text-muted-foreground">Est. Revenue</span>
              </div>
              <span className="text-xs font-semibold text-foreground">R${estTotal.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-pink-500" />
                <span className="text-xs text-muted-foreground">Gamepasses</span>
              </div>
              <span className="text-xs font-semibold text-foreground">R${estGamepass.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                <span className="text-xs text-muted-foreground">Dev Products</span>
              </div>
              <span className="text-xs font-semibold text-foreground">R${estDevproduct.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-border pt-2 mt-2">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                <span className="text-xs text-muted-foreground">Purchases</span>
              </div>
              <span className="text-xs font-semibold text-foreground">{purchases.toLocaleString()}</span>
            </div>
          </>
        )}
        
        {/* Gamepasses mode: show only gamepasses */}
        {chartMode === "gamepasses" && (
          <>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-pink-500" />
                <span className="text-xs text-muted-foreground">Est. Gamepasses</span>
              </div>
              <span className="text-xs font-semibold text-foreground">R${estGamepass.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-border pt-2 mt-2">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                <span className="text-xs text-muted-foreground">Gamepass Purchases</span>
              </div>
              <span className="text-xs font-semibold text-foreground">{gamepassPurchases.toLocaleString()}</span>
            </div>
          </>
        )}
        
        {/* Dev Products mode: show only dev products */}
        {chartMode === "devproducts" && (
          <>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                <span className="text-xs text-muted-foreground">Est. Dev Products</span>
              </div>
              <span className="text-xs font-semibold text-foreground">R${estDevproduct.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-border pt-2 mt-2">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                <span className="text-xs text-muted-foreground">Dev Product Purchases</span>
              </div>
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
  const [chartRange, setChartRange] = useState<ChartRange>("72h");
  const [chartInterval, setChartInterval] = useState<ChartInterval>("hourly");
  const [chartMode, setChartMode] = useState<ChartMode>("total");
  
  // Use shared revenue display mode (persisted to localStorage)
  const { mode: revenueDisplayMode, setMode: setRevenueDisplayMode } = useRevenueDisplayMode();
  
  // Check plan access
  const { hasProAccess, loading: planLoading } = usePlanAccess();
  
  // Theme-aware chart colors
  const chartTheme = useChartTheme();
  const axisProps = getChartAxisProps(chartTheme);
  const gridProps = getChartGridProps(chartTheme);
  const tooltipStyle = getChartTooltipStyle(chartTheme);

  // Handle range change with auto-switch interval if incompatible
  const handleRangeChange = (newRange: ChartRange) => {
    setChartRange(newRange);
    // If switching to 90d, auto-switch to daily
    if (requiresDailyInterval(newRange)) {
      setChartInterval("daily");
    }
    // If switching to a range that doesn't support 1m, auto-switch to hourly
    else if (!supportsMinuteInterval(newRange) && chartInterval === "1m") {
      setChartInterval("hourly");
    }
  };

  // Handle interval change with auto-switch range if incompatible
  const handleIntervalChange = (newInterval: ChartInterval) => {
    setChartInterval(newInterval);
    // If switching to 1m but range is incompatible, switch to 1h
    if (newInterval === "1m" && !supportsMinuteInterval(chartRange)) {
      setChartRange("1h");
    }
  };

  const {
    isLoading,
    isRefreshing,
    error,
    revenueStats,
    monetizationCharts,
    hasTrackerData,
    needsTrackingScript,
    selectedGameName,
    refresh,
  } = useAnalytics({ enabled: true, range: "7d" });

  // Safe defaults - all values from API
  const safeRevenueStats = {
    // Gross values (raw tracked sales - matches Roblox dashboard)
    grossRevenue: revenueStats?.grossRevenue ?? 0,
    grossRevenue72h: revenueStats?.grossRevenue72h ?? 0,
    grossArppu: revenueStats?.grossArppu ?? 0,
    grossArpdau: revenueStats?.grossArpdau ?? 0,
    // Estimated values (after 30% Roblox fee)
    estimatedRevenue: revenueStats?.estimatedRevenue ?? 0,
    estimatedRevenue72h: revenueStats?.estimatedRevenue72h ?? 0,
    estimatedArppu: revenueStats?.estimatedArppu ?? 0,
    estimatedArpdau: revenueStats?.estimatedArpdau ?? 0,
    // Non-revenue metrics
    totalPurchases: revenueStats?.totalPurchases ?? 0,
    payingUsers: revenueStats?.payingUsers ?? 0,
  };
  
  // Display values based on toggle
  const displayRevenue = revenueDisplayMode === "gross" 
    ? safeRevenueStats.grossRevenue 
    : safeRevenueStats.estimatedRevenue;
  const displayRevenue72h = revenueDisplayMode === "gross" 
    ? safeRevenueStats.grossRevenue72h 
    : safeRevenueStats.estimatedRevenue72h;
  const displayArppu = revenueDisplayMode === "gross" 
    ? safeRevenueStats.grossArppu 
    : safeRevenueStats.estimatedArppu;
  const displayArpdau = revenueDisplayMode === "gross" 
    ? safeRevenueStats.grossArpdau 
    : safeRevenueStats.estimatedArpdau;

  // Process chart data based on selected range, interval, and display mode
  const processedChartData = useMemo(() => {
    const now = new Date();
    const revenueMultiplier = revenueDisplayMode === "gross" ? 1 : CREATOR_REVENUE_RATE;
    
    // Helper to normalize all values to numbers and apply revenue multiplier based on display mode
    const normalizePoint = (point: { time: string; totalRevenue: number; devproductRevenue: number; gamepassRevenue: number; purchases: number }) => ({
      time: point.time,
      // Apply revenue multiplier based on display mode (1 for gross, 0.7 for estimated)
      totalRevenue: Math.round(Number(point.totalRevenue ?? 0) * revenueMultiplier),
      devproductRevenue: Math.round(Number(point.devproductRevenue ?? 0) * revenueMultiplier),
      gamepassRevenue: Math.round(Number(point.gamepassRevenue ?? 0) * revenueMultiplier),
      purchases: Number(point.purchases ?? 0),
    });

    // Calculate minutes to show based on range
    const getMinutesToShow = (range: ChartRange): number => {
      switch (range) {
        case "1h": return 60;
        case "6h": return 360;
        case "24h": return 1440;
        default: return 1440; // Max 24h for minute data
      }
    };

    // Calculate hours to show based on range
    const getHoursToShow = (range: ChartRange): number => {
      switch (range) {
        case "1h": return 1;
        case "6h": return 6;
        case "24h": return 24;
        case "72h": return 72;
        case "7d": return 168;
        case "28d": return 672;
        case "90d": return 2160; // 90 days * 24 hours
        default: return 72;
      }
    };

    // === MINUTE INTERVAL ===
    if (chartInterval === "1m") {
      if (!monetizationCharts?.minuteMonetization?.length) return [];
      
      const minuteData = monetizationCharts.minuteMonetization;
      const minutesToShow = getMinutesToShow(chartRange);
      const cutoffTime = new Date(now.getTime() - minutesToShow * 60 * 1000);
      
      return minuteData
        .filter(d => new Date(d.time) >= cutoffTime)
        .map(normalizePoint);
    }

    // === HOURLY / DAILY INTERVAL ===
    if (!monetizationCharts?.hourlyMonetization?.length) return [];
    
    const hourlyData = monetizationCharts.hourlyMonetization;
    const hoursToShow = getHoursToShow(chartRange);
    const cutoffTime = new Date(now.getTime() - hoursToShow * 60 * 60 * 1000);
    let filteredData = hourlyData.filter(d => new Date(d.time) >= cutoffTime);

    // If daily interval, aggregate by day
    if (chartInterval === "daily") {
      const dailyBuckets = new Map<string, { total: number; devproduct: number; gamepass: number; purchases: number }>();
      
      filteredData.forEach((d) => {
        const dayKey = d.time.slice(0, 10);
        const existing = dailyBuckets.get(dayKey) || { total: 0, devproduct: 0, gamepass: 0, purchases: 0 };
        // Apply revenue multiplier based on display mode
        existing.total += Math.round(Number(d.totalRevenue ?? 0) * revenueMultiplier);
        existing.devproduct += Math.round(Number(d.devproductRevenue ?? 0) * revenueMultiplier);
        existing.gamepass += Math.round(Number(d.gamepassRevenue ?? 0) * revenueMultiplier);
        existing.purchases += Number(d.purchases ?? 0);
        dailyBuckets.set(dayKey, existing);
      });

      return Array.from(dailyBuckets.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([time, data]) => ({
          time: time + "T00:00:00.000Z",
          totalRevenue: data.total,
          devproductRevenue: data.devproduct,
          gamepassRevenue: data.gamepass,
          purchases: data.purchases,
        }));
    }

    // Normalize all data points to ensure numeric values
    return filteredData.map(normalizePoint);
  }, [monetizationCharts?.hourlyMonetization, monetizationCharts?.minuteMonetization, chartRange, chartInterval, revenueDisplayMode]);

  // Calculate totals for current view
  const chartTotals = useMemo(() => {
    let activeBuckets = 0;
    let gamepassPurchases = 0;
    let devproductPurchases = 0;
    
    const totals = processedChartData.reduce(
      (acc, d) => {
        // Count active buckets based on current mode
        if (chartMode === "total" && d.totalRevenue > 0) activeBuckets++;
        else if (chartMode === "gamepasses" && d.gamepassRevenue > 0) activeBuckets++;
        else if (chartMode === "devproducts" && d.devproductRevenue > 0) activeBuckets++;
        
        // Track purchases by type (approximation based on revenue ratio)
        if (d.totalRevenue > 0 && d.purchases > 0) {
          const gamepassRatio = d.gamepassRevenue / d.totalRevenue;
          const devproductRatio = d.devproductRevenue / d.totalRevenue;
          gamepassPurchases += Math.round(d.purchases * gamepassRatio);
          devproductPurchases += Math.round(d.purchases * devproductRatio);
        }
        
        return {
          total: acc.total + d.totalRevenue,
          devproduct: acc.devproduct + d.devproductRevenue,
          gamepass: acc.gamepass + d.gamepassRevenue,
          purchases: acc.purchases + d.purchases,
        };
      },
      { total: 0, devproduct: 0, gamepass: 0, purchases: 0 }
    );
    return { ...totals, activeBuckets, gamepassPurchases, devproductPurchases };
  }, [processedChartData, chartMode]);

  // Calculate Y-axis max based on VISIBLE series only
  const yAxisMax = useMemo(() => {
    if (!processedChartData.length) return 10;
    
    // For Total mode, find max across all 3 series
    const visibleKeys = chartMode === "total" 
      ? ["totalRevenue", "gamepassRevenue", "devproductRevenue"] as const
      : chartMode === "gamepasses" 
        ? ["gamepassRevenue"] as const
        : ["devproductRevenue"] as const;
    
    const rawMax = Math.max(
      ...processedChartData.flatMap((p) => 
        visibleKeys.map((key) => Number(p[key] ?? 0))
      ),
      0
    );
    
    // Minimum Y max of 10 for visibility, with 25% padding
    const yMax = rawMax <= 0 ? 10 : Math.max(10, Math.ceil(rawMax * 1.25));
    
    return yMax;
  }, [processedChartData, chartMode]);

  // Get current mode display info (labels depend on display mode)
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
        dataKey: "gamepassRevenue" as const,
        revenue: chartTotals.gamepass,
        purchases: chartTotals.gamepassPurchases,
        purchaseLabel: "Gamepass Purchases",
      };
    } else {
      return {
        label: `${prefix}Dev Products`,
        color: COLORS.devProduct,
        dataKey: "devproductRevenue" as const,
        revenue: chartTotals.devproduct,
        purchases: chartTotals.devproductPurchases,
        purchaseLabel: "Dev Product Purchases",
      };
    }
  }, [chartMode, chartTotals, revenueDisplayMode]);

  const handleRefresh = async () => {
    if (refresh) await refresh();
  };

  // Plan gating - show upgrade screen for free users
  if (!planLoading && !hasProAccess) {
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
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-8 w-48 mb-2" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-[400px]" />
      </div>
    );
  }

  // Error state
  if (error) {
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
        
        {/* Shared Gross/Estimated Revenue Toggle */}
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

      {/* Revenue Stats Cards - 6 column grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
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
            {hasTrackerData && displayRevenue > 0 && (
              <p className="text-[10px] text-muted-foreground mt-1">
                {revenueDisplayMode === "gross" 
                  ? `Est: R$${safeRevenueStats.estimatedRevenue?.toLocaleString()}`
                  : `Gross: R$${safeRevenueStats.grossRevenue?.toLocaleString()}`
                }
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="border-border bg-card shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-blue-400" />
              <span className="text-xs text-muted-foreground">
                {revenueDisplayMode === "gross" ? "Gross 72h" : "Est. 72h"}
              </span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {!hasTrackerData ? (
                <span className="text-sm text-muted-foreground font-normal">Requires tracking</span>
              ) : (
                formatRobux(displayRevenue72h)
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Last 72 hours</p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <ShoppingCart className="w-4 h-4 text-amber-400" />
              <span className="text-xs text-muted-foreground">Purchases</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {!hasTrackerData ? (
                <span className="text-sm text-muted-foreground font-normal">Requires tracking</span>
              ) : (
                formatNumber(safeRevenueStats.totalPurchases)
              )}
            </div>
          </CardContent>
        </Card>

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
                formatNumber(safeRevenueStats.payingUsers)
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <Coins className="w-4 h-4 text-amber-400" />
              <span className="text-xs text-muted-foreground">
                {revenueDisplayMode === "gross" ? "ARPPU" : "Est. ARPPU"}
              </span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {!hasTrackerData || !displayArppu ? (
                <span className="text-lg font-medium text-muted-foreground">—</span>
              ) : (
                formatRobux(displayArppu)
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Revenue / Paying Users
            </p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-cyan-400" />
              <span className="text-xs text-muted-foreground">
                {revenueDisplayMode === "gross" ? "ARPDAU" : "Est. ARPDAU"}
              </span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {!hasTrackerData || !displayArpdau ? (
                <span className="text-lg font-medium text-muted-foreground">—</span>
              ) : (
                formatRobux(displayArpdau)
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Revenue / Avg. DAU
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Hero Chart: Hourly Revenue / Sales */}
      <Card className="border-border bg-card shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <CardTitle className="text-lg font-semibold text-foreground">
                {revenueDisplayMode === "gross" ? "Gross Revenue & Sales" : "Estimated Revenue & Sales"}
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-0.5">
                {chartRange === "1h" ? "Last 1 hour" : chartRange === "6h" ? "Last 6 hours" : chartRange === "24h" ? "Last 24 hours" : chartRange === "72h" ? "Last 72 hours" : chartRange === "7d" ? "Last 7 days" : chartRange === "28d" ? "Last 28 days" : "Last 90 days"}
                {chartInterval === "1m" ? " (per minute)" : chartInterval === "hourly" ? " (hourly)" : " (daily)"}
              </p>
            </div>
            {/* Chart Controls */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Range selector */}
              <div className="flex items-center bg-secondary/50 dark:bg-secondary/80 rounded-lg p-0.5">
                {(["1h", "6h", "24h", "72h", "7d", "28d", "90d"] as ChartRange[]).map((r) => (
                  <button
                    key={r}
                    onClick={() => handleRangeChange(r)}
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
              {/* Interval selector */}
              <div className="flex items-center bg-secondary/50 dark:bg-secondary/80 rounded-lg p-0.5">
                {(["1m", "hourly", "daily"] as ChartInterval[]).map((i) => {
                  // Disable 1m for ranges > 24h, disable hourly for 90d
                  const is1mDisabled = i === "1m" && !supportsMinuteInterval(chartRange);
                  const isHourlyDisabled = i === "hourly" && requiresDailyInterval(chartRange);
                  const isDisabled = is1mDisabled || isHourlyDisabled;
                  const label = i === "1m" ? "1m" : i === "hourly" ? "Hourly" : "Daily";
                  const disabledTitle = is1mDisabled 
                    ? "1m interval only available for 1H, 6H, 24H ranges" 
                    : isHourlyDisabled 
                      ? "90D range only supports daily interval"
                      : undefined;
                  return (
                    <button
                      key={i}
                      onClick={() => !isDisabled && handleIntervalChange(i)}
                      disabled={isDisabled}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                        chartInterval === i
                          ? i === "1m" ? "bg-emerald-600 text-white" : "bg-background text-foreground shadow-sm"
                          : isDisabled
                            ? "text-muted-foreground/50 cursor-not-allowed"
                            : "text-muted-foreground hover:text-foreground"
                      }`}
                      title={disabledTitle}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              {/* Mode selector: Total / Gamepasses / Dev Products */}
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
          {!hasTrackerData ? (
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
              <p className="text-base font-medium text-foreground mb-1">No purchases tracked yet</p>
              <p className="text-sm text-muted-foreground max-w-md">
                No purchases in the selected period. Try a different time range or wait for new purchases.
              </p>
            </div>
          ) : (
            <>
              {/* Summary stats for selected mode */}
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
                  <p className="text-xs text-muted-foreground">Active {chartInterval === "1m" ? "Minutes" : chartInterval === "hourly" ? "Hours" : "Days"}</p>
                </div>
              </div>

              {/* Legend - all 3 in Total mode, single item otherwise */}
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
                {/* Empty state when no data for selected mode */}
                {!hasCurrentModeData && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-background/90 rounded-lg">
                    {chartInterval === "1m" ? (
                      <>
                        <p className="text-muted-foreground text-sm font-medium">No revenue in this minute-level range yet</p>
                        <p className="text-muted-foreground text-xs mt-1">New purchases will appear here in real time.</p>
                      </>
                    ) : (
                      <>
                        <p className="text-muted-foreground text-sm font-medium">No revenue for this view</p>
                        <p className="text-muted-foreground text-xs mt-1">Try another product type or range.</p>
                      </>
                    )}
                  </div>
                )}
                
                <ResponsiveContainer width="100%" height="100%">
                  {/* Use LineChart for Total mode (more reliable), AreaChart for single-series modes */}
                  {chartMode === "total" ? (
                    <LineChart data={processedChartData} margin={{ top: 20, right: 20, left: 10, bottom: 10 }}>
                      <CartesianGrid {...gridProps} />
                      <XAxis 
                        dataKey="time" 
                        tickFormatter={(v) => {
                          const date = new Date(v);
                          if (chartInterval === "1m") {
                            return date.toLocaleString(undefined, { hour: "numeric", minute: "2-digit", hour12: true });
                          }
                          if (chartInterval === "hourly") {
                            return date.toLocaleString(undefined, { hour: "numeric", hour12: true });
                          }
                          return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
                        }}
                        {...axisProps}
                        tick={{ fill: chartTheme.axis, fontSize: 10 }}
                        interval={chartInterval === "1m" ? Math.max(1, Math.floor(processedChartData.length / 8)) : "preserveStartEnd"}
                      />
                      <YAxis 
                        domain={[0, yAxisMax]}
                        tickFormatter={(v) => v === 0 ? "0" : `R$${v >= 1000 ? `${(v/1000).toFixed(1)}k` : v}`}
                        {...axisProps}
                        tick={{ fill: chartTheme.axis, fontSize: 11 }}
                        width={60}
                      />
                      <Tooltip content={<HeroChartTooltip chartMode={chartMode} />} />
                      
                      {/* Total mode: show all 3 lines unconditionally */}
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
                        dataKey="gamepassRevenue"
                        name="Gamepasses"
                        stroke={COLORS.gamepass}
                        strokeWidth={3}
                        dot={{ r: 3, fill: COLORS.gamepass }}
                        activeDot={{ r: 6 }}
                        connectNulls
                      />
                      <Line
                        type="monotone"
                        dataKey="devproductRevenue"
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
                          if (chartInterval === "1m") {
                            return date.toLocaleString(undefined, { hour: "numeric", minute: "2-digit", hour12: true });
                          }
                          if (chartInterval === "hourly") {
                            return date.toLocaleString(undefined, { hour: "numeric", hour12: true });
                          }
                          return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
                        }}
                        {...axisProps}
                        tick={{ fill: chartTheme.axis, fontSize: 10 }}
                        interval={chartInterval === "1m" ? Math.max(1, Math.floor(processedChartData.length / 8)) : "preserveStartEnd"}
                      />
                      <YAxis 
                        domain={[0, yAxisMax]}
                        tickFormatter={(v) => v === 0 ? "0" : `R$${v >= 1000 ? `${(v/1000).toFixed(1)}k` : v}`}
                        {...axisProps}
                        tick={{ fill: chartTheme.axis, fontSize: 11 }}
                        width={60}
                      />
                      <Tooltip content={<HeroChartTooltip chartMode={chartMode} />} />
                      
                      {/* Gamepasses mode: only pink curve */}
                      {chartMode === "gamepasses" && (
                        <Area
                          type="monotone"
                          dataKey="gamepassRevenue"
                          name="Gamepasses"
                          stroke={COLORS.gamepass}
                          strokeWidth={3}
                          fill="url(#gradientGamepass)"
                          dot={{ r: 4, fill: COLORS.gamepass, strokeWidth: 0 }}
                          activeDot={{ r: 6, fill: COLORS.gamepass, strokeWidth: 2, stroke: "#0a0a0a" }}
                          connectNulls
                        />
                      )}
                      
                      {/* Dev Products mode: only green curve */}
                      {chartMode === "devproducts" && (
                        <Area
                          type="monotone"
                          dataKey="devproductRevenue"
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
              
              {/* Legend - all 3 in Total mode, single item otherwise */}
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
              <CardTitle className="text-base font-semibold text-foreground">Est. Daily Revenue</CardTitle>
              <p className="text-xs text-muted-foreground">Estimated revenue grouped by day (after 30% fee)</p>
            </CardHeader>
            <CardContent className="pt-2">
              {monetizationCharts?.revenueOverTime?.length ? (() => {
                // Transform to estimated revenue (70%)
                const estimatedDailyData = monetizationCharts.revenueOverTime.map(item => ({
                  ...item,
                  revenue: Math.round(item.revenue * CREATOR_REVENUE_RATE)
                }));
                return (
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={estimatedDailyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="dailyRevenueGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={COLORS.totalRevenue} stopOpacity={1}/>
                          <stop offset="100%" stopColor={COLORS.totalRevenue} stopOpacity={0.6}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid {...gridProps} />
                      <XAxis 
                        dataKey="date" 
                        tickFormatter={(v) => formatChartTime(v, "7d")}
                        {...axisProps}
                        tick={{ fill: chartTheme.axis, fontSize: 10 }}
                      />
                      <YAxis 
                        tickFormatter={(v) => `R$${v}`}
                        {...axisProps}
                        tick={{ fill: chartTheme.axis, fontSize: 10 }}
                        width={50}
                      />
                      <Tooltip
                        {...tooltipStyle}
                        formatter={(value: number) => [`R$${value.toLocaleString()}`, "Est. Revenue"]}
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
                );
              })() : (
                <div className="h-[220px] flex items-center justify-center">
                  <p className="text-sm text-muted-foreground">No purchases tracked yet</p>
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
              {monetizationCharts?.purchasesOverTime?.length ? (
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={monetizationCharts.purchasesOverTime} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="purchasesGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={COLORS.purchases} stopOpacity={0.4}/>
                          <stop offset="100%" stopColor={COLORS.purchases} stopOpacity={0.05}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid {...gridProps} />
                      <XAxis 
                        dataKey="date" 
                        tickFormatter={(v) => formatChartTime(v, "7d")}
                        {...axisProps}
                        tick={{ fill: chartTheme.axis, fontSize: 10 }}
                      />
                      <YAxis 
                        allowDecimals={false}
                        {...axisProps}
                        tick={{ fill: chartTheme.axis, fontSize: 10 }}
                        width={30}
                      />
                      <Tooltip
                        {...tooltipStyle}
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
                  <p className="text-sm text-muted-foreground">No purchases tracked yet</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Revenue by Product Type - Donut Chart (estimated 70%) */}
          <Card className="border-border bg-card shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-foreground">Est. Revenue by Type</CardTitle>
              <p className="text-xs text-muted-foreground">Gamepasses vs Developer Products</p>
            </CardHeader>
            <CardContent className="pt-2">
              {monetizationCharts?.revenueByProductType?.length ? (() => {
                // Transform to estimated revenue (70%)
                const estimatedData = monetizationCharts.revenueByProductType.map(item => ({
                  ...item,
                  revenue: Math.round(item.revenue * CREATOR_REVENUE_RATE)
                }));
                const estimatedTotal = estimatedData.reduce((s, i) => s + i.revenue, 0);
                return (
                  <div className="h-[220px] flex items-center justify-center gap-6">
                    <ResponsiveContainer width={180} height={180}>
                      <PieChart>
                        <Pie
                          data={estimatedData}
                          dataKey="revenue"
                          nameKey="productType"
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={80}
                          paddingAngle={3}
                          strokeWidth={0}
                        >
                          {estimatedData.map((entry) => (
                            <Cell 
                              key={entry.productType} 
                              fill={entry.productType === "gamepass" ? COLORS.gamepass : COLORS.devProduct}
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          {...tooltipStyle}
                          formatter={(value: number, name: string) => [
                            `R$${value.toLocaleString()}`,
                            name === "gamepass" ? "Game Passes" : "Dev Products"
                          ]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="space-y-3">
                      {estimatedData.map((item) => {
                        const percentage = estimatedTotal > 0 ? ((item.revenue / estimatedTotal) * 100).toFixed(1) : "0";
                        return (
                          <div key={item.productType} className="flex items-center gap-3">
                            <div 
                              className="w-4 h-4 rounded-md" 
                              style={{ backgroundColor: item.productType === "gamepass" ? COLORS.gamepass : COLORS.devProduct }}
                            />
                            <div>
                              <p className="text-sm font-medium text-foreground">
                                {item.productType === "gamepass" ? "Game Passes" : "Dev Products"}
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
                  <p className="text-sm text-muted-foreground">No purchases tracked yet</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Top Products - Horizontal Bar Chart (estimated 70%) */}
          <Card className="border-border bg-card shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-foreground">Top Products by Est. Revenue</CardTitle>
              <p className="text-xs text-muted-foreground">Best performing products</p>
            </CardHeader>
            <CardContent className="pt-2">
              {monetizationCharts?.topProducts?.length ? (() => {
                // Transform to estimated revenue (70%)
                const estimatedProducts = monetizationCharts.topProducts.slice(0, 5).map(p => ({
                  ...p,
                  revenue: Math.round(p.revenue * CREATOR_REVENUE_RATE)
                }));
                return (
                  <div className="h-[220px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart 
                        data={estimatedProducts} 
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
                          dataKey="revenue" 
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
                  <p className="text-sm text-muted-foreground">No purchases tracked yet</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Data explanation */}
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">How Monetization Data Works</CardTitle>
          <CardDescription>
            Understanding the data sources for your revenue metrics
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="p-4 rounded-lg bg-muted/50 border border-border">
              <h4 className="font-medium text-foreground mb-2 flex items-center gap-2">
                <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[10px]">
                  RoMonetize Tracker
                </Badge>
              </h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Estimated Revenue (70% of gross, after Roblox fee)</li>
                <li>• Purchases (count of tracked purchases)</li>
                <li>• Paying Users (distinct player_id from purchases)</li>
                <li>• Est. ARPPU (estimated revenue / paying users)</li>
                <li>• Est. ARPDAU (estimated revenue / unique active players)</li>
              </ul>
            </div>

            <div className="p-4 rounded-lg bg-muted/50 border border-border">
              <h4 className="font-medium text-foreground mb-2">Required: Track Purchases</h4>
              <p className="text-sm text-muted-foreground mb-2">
                Call this when a player completes a purchase:
              </p>
              <pre className="text-xs bg-muted/30 p-2 rounded border border-border/50 overflow-x-auto">
{`RoMonetize:TrackPurchase({
  player_id = player.UserId,
  product_id = productId,
  product_name = "Sword",
  product_type = "gamepass",
  robux = 150
})`}
              </pre>
            </div>
          </div>

          <div className="p-4 rounded-lg bg-blue-500/5 border border-blue-500/20">
            <h4 className="font-medium text-foreground mb-1 text-sm">Note on Roblox Revenue API</h4>
            <p className="text-sm text-muted-foreground">
              Roblox does not provide public API access to Creator Analytics revenue data. 
              Revenue tracking requires the RoMonetize tracking script to capture purchases directly from your game.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
