"use client";

import { useState, useMemo, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
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
import { getProductPurchaseMetrics, CREATOR_REVENUE_RATE } from "@/lib/utils/product-aggregation";
import { getRangeWindow, getBucketKey, generateBucketKeys, type RangeKey } from "@/lib/utils/range-window";
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
// CREATOR_REVENUE_RATE imported from @/lib/utils/product-aggregation

// Custom tooltip for the hero chart - shows mode-specific data with estimated revenue
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
      devproductRevenue?: number;
      gamepassRevenue?: number;
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
  // For minute mode, show HH:mm format prominently
  const formattedTime = date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  // Get the underlying data point (already transformed by display mode)
  const dataPoint = payload[0]?.payload;
  const totalRevenue = dataPoint?.totalRevenue ?? 0;
  const devproductRevenue = dataPoint?.devproductRevenue ?? 0;
  const gamepassRevenue = dataPoint?.gamepassRevenue ?? 0;
  const purchases = dataPoint?.purchases ?? 0;
  // Use actual purchase counts from API (not estimated from revenue ratio)
  const gamepassPurchases = dataPoint?.gamepassPurchases ?? 0;
  const devproductPurchases = dataPoint?.devproductPurchases ?? 0;
  
  // Revenue labels based on mode
  const revenueLabel = revenueMode === "gross" ? "Gross" : "Est.";
  
  return (
    <div className="bg-popover border border-border rounded-lg shadow-xl p-3 min-w-[200px]">
      <p className="text-xs text-muted-foreground mb-3 font-medium border-b border-border pb-2">{formattedTime}</p>
      <div className="space-y-2">
        {/* Total mode: show all revenue types with purchase breakdown */}
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
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs text-muted-foreground pl-2">Gamepass Purchases</span>
              <span className="text-xs text-foreground">{gamepassPurchases.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs text-muted-foreground pl-2">Dev Product Purchases</span>
              <span className="text-xs text-foreground">{devproductPurchases.toLocaleString()}</span>
            </div>
          </>
        )}
        
        {/* Gamepasses mode: show only gamepasses */}
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
              <span className="text-xs text-muted-foreground">Gamepass Purchases</span>
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
                <span className="text-xs text-muted-foreground">{revenueLabel} Dev Products</span>
              </div>
              <span className="text-xs font-semibold text-foreground">R${devproductRevenue.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-border pt-2 mt-2">
              <span className="text-xs text-muted-foreground">Dev Product Purchases</span>
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-[400px]" />
    </div>
  );
}

function MonetizationContent() {
  const searchParams = useSearchParams();
  const debugMode = searchParams.get("debug") === "true";
  const [debugData, setDebugData] = useState<Record<string, unknown> | null>(null);
  
  const [chartRange, setChartRange] = useState<ChartRange>("28d"); // Default to 28d to match Products page
  const [chartInterval, setChartInterval] = useState<ChartInterval>("hourly");
  const [chartMode, setChartMode] = useState<ChartMode>("total");
  
  // Use shared revenue display mode (persisted to localStorage)
  const { mode: revenueDisplayMode, setMode: setRevenueDisplayMode } = useRevenueDisplayMode();
  
  // Check plan access - use canAccessMonetization for proper gating
  const { canAccessMonetization, loading: planLoading, planInfo } = usePlanAccess();
  
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

  // Map chart range to API range
  // For monetization metrics (PCR, ARPPU, ARPDAU), we pass a broader range
  // to ensure we have enough data for charts, but also pass monetizationRange
  // for the exact metric calculations.
  function toAnalyticsRange(range: ChartRange): "1d" | "7d" | "30d" | "90d" {
    switch (range) {
      case "1h":
      case "6h":
      case "24h":
        return "1d";
      case "72h":
      case "7d":
        return "7d";
      case "28d":
        return "30d";
      case "90d":
        return "90d";
      default:
        return "7d";
    }
  }

  // Map chart range to hours for monetization metric calculations
  function getChartRangeHours(range: ChartRange): number {
    switch (range) {
      case "1h": return 1;
      case "6h": return 6;
      case "24h": return 24;
      case "72h": return 72;
      case "7d": return 168;
      case "28d": return 672;
      case "90d": return 2160;
      default: return 168;
    }
  }

  const {
    isLoading,
    isRefreshing,
    error,
    revenueStats,
    monetizationCharts,
    productAnalytics, // Use SAME data source as Products page
    trackerStats,
    hasTrackerData,
    needsTrackingScript,
    selectedGameName,
    refresh,
  } = useAnalytics({ 
    enabled: true, 
    range: toAnalyticsRange(chartRange),
    // Pass the actual chart range hours so the API calculates tracker metrics
    // (PCR, ARPPU, ARPDAU) for the exact selected range
    monetizationRangeHours: getChartRangeHours(chartRange),
  });

  // Fetch debug data when debug mode is enabled
  useEffect(() => {
    if (!debugMode) {
      setDebugData(null);
      return;
    }
    
    async function fetchDebugData() {
      try {
        const response = await fetch("/api/dashboard/analytics?range=7d&debug=true");
        const data = await response.json();
        setDebugData(data.debug || { error: "No debug data in response", fullResponse: data });
      } catch (err) {
        setDebugData({ error: err instanceof Error ? err.message : "Failed to fetch debug data" });
      }
    }
    
    fetchDebugData();
  }, [debugMode]);

  // === SINGLE SOURCE OF TRUTH: Use productAnalytics for API-range totals ===
  // But for DISPLAY, cards will use chartTotals (same range as chart) below.
  // sharedMetrics is kept for payingUsers/uniqueActivePlayers (not available in hourly buckets)
  const sharedMetrics = getProductPurchaseMetrics({
    productAnalytics: productAnalytics as Record<string, unknown> | null | undefined,
    revenueMode: revenueDisplayMode === "gross" ? "gross" : "estimated",
  });
  
  // Effective bucket type for chart axis formatting (derived from range)
  const effectiveBucketType = useMemo(() => {
    return getRangeWindow(chartRange as RangeKey).bucketType;
  }, [chartRange]);

  // Process chart data based on selected range, interval, and display mode
  const processedChartData = useMemo(() => {
    const now = new Date();
    const revenueMultiplier = revenueDisplayMode === "gross" ? 1 : CREATOR_REVENUE_RATE;
    
    // Use shared range helper for consistent range/bucket config
    const rangeConfig = getRangeWindow(chartRange as RangeKey, now);
    const cutoffTime = new Date(rangeConfig.rangeStartUtc);
    const { bucketMs, bucketType } = rangeConfig;
    
    // Helper to get bucket key for a timestamp
    const toBucketKey = (time: string): string => {
      return getBucketKey(time, bucketType, bucketMs);
    };
    
    // Helper to normalize values and apply revenue multiplier
    const normalizePoint = (point: { 
      time: string; 
      totalRevenue: number; 
      devproductRevenue: number; 
      gamepassRevenue: number; 
      purchases: number;
      gamepassPurchases?: number;
      devproductPurchases?: number;
    }) => ({
      time: point.time,
      totalRevenue: Math.round(Number(point.totalRevenue ?? 0) * revenueMultiplier),
      devproductRevenue: Math.round(Number(point.devproductRevenue ?? 0) * revenueMultiplier),
      gamepassRevenue: Math.round(Number(point.gamepassRevenue ?? 0) * revenueMultiplier),
      purchases: Number(point.purchases ?? 0),
      gamepassPurchases: Number(point.gamepassPurchases ?? 0),
      devproductPurchases: Number(point.devproductPurchases ?? 0),
    });

    // Choose data source based on bucket type:
    // minute buckets => use minuteMonetization (1-min granularity from API)
    // hour/day buckets => use hourlyMonetization
    const isMinuteRange = bucketType === "minute";
    const rawData = isMinuteRange 
      ? (monetizationCharts?.minuteMonetization ?? [])
      : (monetizationCharts?.hourlyMonetization ?? []);

    // Filter to range
    const filteredData = rawData.filter(d => new Date(d.time) >= cutoffTime);

    // Generate all empty bucket keys in the range
    const allBucketKeys = generateBucketKeys(
      rangeConfig.rangeStartUtc,
      rangeConfig.rangeEndUtc,
      bucketMs,
      bucketType,
    );

    // Build bucket map with zeros
    type BucketData = {
      totalRevenue: number; devproductRevenue: number; gamepassRevenue: number;
      purchases: number; gamepassPurchases: number; devproductPurchases: number;
    };
    const buckets = new Map<string, BucketData>();
    for (const key of allBucketKeys) {
      buckets.set(key, {
        totalRevenue: 0, devproductRevenue: 0, gamepassRevenue: 0,
        purchases: 0, gamepassPurchases: 0, devproductPurchases: 0,
      });
    }

    // Accumulate actual data into buckets
    filteredData.forEach((d) => {
      const key = toBucketKey(d.time);
      const bucket = buckets.get(key);
      if (!bucket) return; // Outside range

      bucket.totalRevenue += Math.round(Number(d.totalRevenue ?? 0) * revenueMultiplier);
      bucket.devproductRevenue += Math.round(Number(d.devproductRevenue ?? 0) * revenueMultiplier);
      bucket.gamepassRevenue += Math.round(Number(d.gamepassRevenue ?? 0) * revenueMultiplier);
      bucket.purchases += Number(d.purchases ?? 0);
      bucket.gamepassPurchases += Number(d.gamepassPurchases ?? 0);
      bucket.devproductPurchases += Number(d.devproductPurchases ?? 0);
    });

    // Convert to sorted array
    return Array.from(buckets.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([time, data]) => ({
        time,
        ...data,
      }));
  }, [monetizationCharts?.hourlyMonetization, monetizationCharts?.minuteMonetization, chartRange, revenueDisplayMode]);

  // Calculate totals for current view - use actual purchase counts from API
  const chartTotals = useMemo(() => {
    let activeBuckets = 0;
    
    const totals = processedChartData.reduce(
      (acc, d) => {
        // Count active buckets based on current mode
        if (chartMode === "total" && d.totalRevenue > 0) activeBuckets++;
        else if (chartMode === "gamepasses" && d.gamepassRevenue > 0) activeBuckets++;
        else if (chartMode === "devproducts" && d.devproductRevenue > 0) activeBuckets++;
        
        return {
          total: acc.total + d.totalRevenue,
          devproduct: acc.devproduct + d.devproductRevenue,
          gamepass: acc.gamepass + d.gamepassRevenue,
          purchases: acc.purchases + d.purchases,
          // Use actual purchase counts from API (not estimated from revenue ratio)
          gamepassPurchases: acc.gamepassPurchases + (d.gamepassPurchases ?? 0),
          devproductPurchases: acc.devproductPurchases + (d.devproductPurchases ?? 0),
        };
      },
      { total: 0, devproduct: 0, gamepass: 0, purchases: 0, gamepassPurchases: 0, devproductPurchases: 0 }
    );
    return { ...totals, activeBuckets };
  }, [processedChartData, chartMode]);

  // === CARD VALUES: Derived from chartTotals (same range as chart) ===
  // This ensures cards and chart ALWAYS show the same numbers for the selected range.
  // payingUsers and activeUsers come from API's tracker-based calculation.
  const summaryStats = useMemo(() => {
    // chartTotals.total already has revenue mode (gross or estimated) applied
    const displayRevenue = chartTotals.total;
    const totalPurchases = chartTotals.purchases;
    
    // Calculate gross revenue for ARPDAU calculation
    // If display mode is estimated, we need to reverse the multiplier to get gross
    const grossRevenue = revenueDisplayMode === "gross" 
      ? displayRevenue 
      : Math.round(displayRevenue / CREATOR_REVENUE_RATE);
    
    // Use tracker-based active users from API (ACTIVE_USER_EVENT_TYPES)
    // These are the canonical values for PCR and ARPDAU
    const payingUsers = revenueStats?.trackerPayingUsers ?? sharedMetrics.totalBuyers;
    const activeUsers = revenueStats?.trackerActiveUsers ?? 0;

    return {
      grossRevenue,
      displayRevenue,
      totalPurchases,
      payingUsers,
      activeUsers,
    };
  }, [chartTotals, sharedMetrics, revenueStats, revenueDisplayMode]);

  // PCR = payingUsers / activeUsers * 100 (from tracker ACTIVE_USER_EVENT_TYPES)
  const pcr = summaryStats.activeUsers > 0
    ? (summaryStats.payingUsers / summaryStats.activeUsers) * 100
    : null;
  
  // ARPPU = revenue / payingUsers (uses chart range revenue)
  const displayArppu = summaryStats.payingUsers > 0 
    ? summaryStats.displayRevenue / summaryStats.payingUsers 
    : null;
  
  // ARPDAU calculation using chart range revenue and tracker metrics
  // For short ranges (1H, 6H, 24H): ARPDAU = revenue / activeUsersInRange
  // For long ranges (7D+): ARPDAU = revenue / averageDAU
  const chartRangeHours = getChartRangeHours(chartRange);
  const trackerAverageDau = revenueStats?.trackerAverageDau ?? 0;
  const trackerActiveUsers = summaryStats.activeUsers;
  
  const grossArpdau = (() => {
    // Use grossRevenue (chartTotals.total) for ARPDAU calculation
    const grossRevenue = summaryStats.grossRevenue;
    if (chartRangeHours <= 24) {
      // Short range: use activeUsersInRange as DAU proxy
      return trackerActiveUsers > 0 ? grossRevenue / trackerActiveUsers : null;
    }
    // Long range: use average DAU
    return trackerAverageDau > 0 ? grossRevenue / trackerAverageDau : null;
  })();
  
  const displayArpdau = grossArpdau != null && grossArpdau > 0
    ? (revenueDisplayMode === "gross" ? grossArpdau : Math.round(grossArpdau * CREATOR_REVENUE_RATE))
    : null;
  const displayRevenue = summaryStats.displayRevenue;

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

  // === DERIVED SECONDARY CHART DATA (from hero chart's processedChartData) ===
  // This ensures all charts use the SAME purchase data source

  // Est. Daily Revenue: aggregate hourly buckets into daily bars
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
        revenue, // Already has revenueDisplayMode applied from processedChartData
      }));
  }, [processedChartData, revenueDisplayMode]);

  // Purchases Over Time: bucket by time matching the hero chart interval
  const purchasesOverTimeData = useMemo(() => {
    if (!processedChartData.length) return [];
    // For short ranges (1h/6h/24h), use hourly; for longer ranges, use daily
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
    // Hourly buckets for shorter ranges
    return processedChartData.map((p) => ({ date: p.time, purchases: p.purchases }));
  }, [processedChartData, chartRange]);

  // Revenue by Type: derived from chartTotals (same hero chart source, already has revenue mode)
  const revenueByTypeData = useMemo(() => {
    const data: Array<{ productType: string; revenue: number }> = [];
    if (chartTotals.gamepass > 0) {
      data.push({ productType: "gamepass", revenue: chartTotals.gamepass });
    }
    if (chartTotals.devproduct > 0) {
      data.push({ productType: "devproduct", revenue: chartTotals.devproduct });
    }
    // If we have revenue but no type breakdown, show as "Unknown"
    if (data.length === 0 && chartTotals.total > 0) {
      data.push({ productType: "unknown", revenue: chartTotals.total });
    }
    return data;
  }, [chartTotals]);
  
  const modeConfig = useMemo(() => {
    const prefix = revenueDisplayMode === "gross" ? "" : "Est. ";
    if (chartMode === "total") {
      // Use chartTotals.purchases for consistency with card data source
      // This ensures chart totals match the selected range, not 72h
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

  // Use shared aggregation to determine if we have purchase data
  // This ensures chart empty state matches card data (same source of truth)
  const hasPurchaseData = summaryStats.totalPurchases > 0;
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

      {/* Monetization Stats Cards - 3x2 grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {/* 1. Revenue */}
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

        {/* 2. Purchases */}
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
                formatNumber(summaryStats.totalPurchases)
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Total transactions
            </p>
          </CardContent>
        </Card>

        {/* 3. Paying Users */}
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
                formatNumber(summaryStats.payingUsers)
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Unique buyers
            </p>
          </CardContent>
        </Card>

        {/* 4. PCR */}
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
              {summaryStats.activeUsers > 0
                ? `${summaryStats.payingUsers} / ${summaryStats.activeUsers} active users`
                : "Requires active player tracking"
              }
            </p>
          </CardContent>
        </Card>

        {/* 5. ARPPU */}
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
                formatRobux(Math.round(displayArppu))
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Revenue / Paying users
            </p>
          </CardContent>
        </Card>

        {/* 6. ARPDAU */}
        <Card className="border-border bg-card shadow-sm">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-4 h-4 text-cyan-400" />
              <span className="text-xs text-muted-foreground">
                {revenueDisplayMode === "gross" ? "Gross ARPDAU" : "Est. ARPDAU"}
              </span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {!hasTrackerData ? (
                <span className="text-sm text-muted-foreground font-normal">Requires tracking</span>
              ) : displayArpdau != null ? (
                formatRobux(Math.round(displayArpdau))
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              {displayArpdau != null
                ? `Revenue / ${chartRangeHours <= 24 ? `${summaryStats.activeUsers} active` : `${Math.round(trackerAverageDau)} avg DAU`}`
                : summaryStats.activeUsers > 0
                  ? "No revenue in range"
                  : "Requires active player events"}
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
                {effectiveBucketType === "minute" ? " (per minute)" : effectiveBucketType === "hour" ? " (hourly)" : " (daily)"}
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
                        (i === "1m" && effectiveBucketType === "minute") || (i === "hourly" && effectiveBucketType === "hour") || (i === "daily" && effectiveBucketType === "day")
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
  <p className="text-sm text-muted-foreground max-w-md">
  {summaryStats.totalPurchases} purchases tracked. Chart data is loading.
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
                  <p className="text-xs text-muted-foreground">Active {effectiveBucketType === "minute" ? "Minutes" : effectiveBucketType === "hour" ? "Hours" : "Days"}</p>
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
                {/* Empty state when cards show purchases but chart has no data */}
                {hasPurchaseData && !hasChartData && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-background/90 rounded-lg">
                    <p className="text-muted-foreground text-sm font-medium">Chart data loading...</p>
                    <p className="text-muted-foreground text-xs mt-1">
                      {summaryStats.totalPurchases} purchase{summaryStats.totalPurchases !== 1 ? "s" : ""} detected. Chart buckets may not be available yet for this range.
                    </p>
                  </div>
                )}
                {/* Empty state when no data for selected mode */}
                {hasChartData && !hasCurrentModeData && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-background/90 rounded-lg">
                    {effectiveBucketType === "minute" ? (
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
                        interval={effectiveBucketType === "minute" ? Math.max(1, Math.floor(processedChartData.length / 8)) : "preserveStartEnd"}
                      />
                      <YAxis 
                        domain={[0, yAxisMax]}
                        tickFormatter={(v) => v === 0 ? "0" : `R$${v >= 1000 ? `${(v/1000).toFixed(1)}k` : v}`}
                        {...axisProps}
                        tick={{ fill: chartTheme.axis, fontSize: 11 }}
                        width={60}
                      />
                      <Tooltip content={<HeroChartTooltip chartMode={chartMode} revenueMode={revenueDisplayMode} />} />
                      
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
                        interval={effectiveBucketType === "minute" ? Math.max(1, Math.floor(processedChartData.length / 8)) : "preserveStartEnd"}
                      />
                      <YAxis 
                        domain={[0, yAxisMax]}
                        tickFormatter={(v) => v === 0 ? "0" : `R$${v >= 1000 ? `${(v/1000).toFixed(1)}k` : v}`}
                        {...axisProps}
                        tick={{ fill: chartTheme.axis, fontSize: 11 }}
                        width={60}
                      />
                      <Tooltip content={<HeroChartTooltip chartMode={chartMode} revenueMode={revenueDisplayMode} />} />
                      
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
              {dailyRevenueData.length > 0 ? (() => {
                return (
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
                );
              })() : (
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

          {/* Revenue by Product Type - Donut Chart (estimated 70%) */}
          <Card className="border-border bg-card shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-foreground">Est. Revenue by Type</CardTitle>
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

          {/* Top Products - Horizontal Bar Chart (respects revenue display mode) */}
          <Card className="border-border bg-card shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-foreground">
                Top Products by {revenueDisplayMode === "gross" ? "Gross" : "Est."} Revenue
              </CardTitle>
              <p className="text-xs text-muted-foreground">Best performing products (same data as Products page)</p>
            </CardHeader>
            <CardContent className="pt-2">
              {monetizationCharts?.topProducts?.length ? (() => {
                // Use the revenue display mode to show correct values
                // topProducts now includes both grossRevenue and estimatedRevenue from shared aggregation
                const displayProducts = monetizationCharts.topProducts.slice(0, 5).map(p => ({
                  ...p,
                  displayRevenue: revenueDisplayMode === "gross" 
                    ? (p.grossRevenue ?? p.revenue) 
                    : (p.estimatedRevenue ?? Math.round(p.revenue * CREATOR_REVENUE_RATE))
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
                  <p className="text-sm text-muted-foreground">{hasPurchaseData ? "Loading chart..." : "No purchases tracked yet"}</p>
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
                <li>• Est. ARPPU (period revenue / distinct paying users in period)</li>
                <li>• Est. ARPDAU (period revenue / average daily active users in period)</li>
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

      {/* Debug Panel - only shown when ?debug=true */}
      {debugMode && (
        <Card className="border-orange-500/30 bg-orange-500/5">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-orange-500" />
              Monetization Debug Info
            </CardTitle>
            <CardDescription>
              Debug data from /api/dashboard/analytics?debug=true
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Client-side plan info */}
              <div className="p-3 rounded-lg bg-muted/50 border border-border">
                <h4 className="font-medium text-sm mb-2">Client-Side Plan Check</h4>
                <pre className="text-xs bg-muted/30 p-2 rounded border border-border/50 overflow-x-auto whitespace-pre-wrap">
{JSON.stringify({
  planInfo: planInfo,
  canAccessMonetization,
  planLoading,
}, null, 2)}
                </pre>
              </div>
              
              {/* Unified Metrics (per spec) */}
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                <h4 className="font-medium text-sm mb-2 text-emerald-700 dark:text-emerald-400">
                  Range &amp; Data Sync
                </h4>
                <pre className="text-xs bg-muted/30 p-2 rounded border border-border/50 overflow-x-auto whitespace-pre-wrap">
{JSON.stringify({
  selectedRange: chartRange,
  rangeStart: (() => {
    const h: Record<string, number> = { "1h": 1, "6h": 6, "24h": 24, "72h": 72, "7d": 168, "28d": 672, "90d": 2160 };
    return new Date(Date.now() - (h[chartRange] ?? 672) * 60 * 60 * 1000).toISOString();
  })(),
  rangeEnd: new Date().toISOString(),
  revenueMode: revenueDisplayMode,
  cardRevenue: displayRevenue,
  cardPurchases: summaryStats.totalPurchases,
  cardPayingUsers: summaryStats.payingUsers,
  chartRevenueTotal: chartTotals.total,
  chartPurchasesTotal: chartTotals.purchases,
  chartBucketCount: processedChartData.length,
  chartLoading: isLoading,
  chartError: error ?? null,
  sameRangeForCardsAndChart: true,
  samePurchaseSourceForCardsAndChart: true,
  cardsRevenue_equals_chartRevenue: displayRevenue === chartTotals.total,
  cardsPurchases_equals_chartPurchases: summaryStats.totalPurchases === chartTotals.purchases,
  firstBucket: processedChartData[0]?.time ?? null,
  lastBucket: processedChartData[processedChartData.length - 1]?.time ?? null,
  hourlyMonetizationLength: monetizationCharts?.hourlyMonetization?.length ?? 0,
  minuteMonetizationLength: monetizationCharts?.minuteMonetization?.length ?? 0,
  effectiveBucketType,
  // === PCR & ARPDAU debug (from spec) ===
  payingUsers: summaryStats.payingUsers,
  activeUsers: summaryStats.activeUsers,
  activeUserEventCounts: revenueStats?.trackerActiveUserEventCounts ?? {},
  pcr,
  arppu: displayArppu,
  revenue: displayRevenue,
  grossRevenue: summaryStats.grossRevenue,
  chartRangeHours,
  dailyActiveUsers: chartRangeHours > 24 ? (revenueStats?.trackerDaysWithData ?? 0) > 0 : null,
  averageDAU: trackerAverageDau,
  arpdau: displayArpdau,
  grossArpdau,
  trackerDaysWithData: revenueStats?.trackerDaysWithData ?? 0,
  sampleActiveUserEvents: revenueStats?.sampleActiveUserEvents ?? [],
}, null, 2)}
                </pre>
              </div>

              {/* Card Data Source */}
              <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/30">
                <h4 className="font-medium text-sm mb-2 text-blue-700 dark:text-blue-400">
                  productAnalytics (Card Data Source)
                </h4>
                <pre className="text-xs bg-muted/30 p-2 rounded border border-border/50 overflow-x-auto whitespace-pre-wrap">
{JSON.stringify((() => {
  const pa = productAnalytics as Record<string, unknown> | null;
  return {
    grossTotalRevenue: pa?.grossTotalRevenue ?? null,
    estimatedTotalRevenue: pa?.estimatedTotalRevenue ?? null,
    totalPurchases: pa?.totalPurchases ?? null,
    totalBuyers: pa?.totalBuyers ?? null,
    aggregationSource: pa?.aggregationSource ?? "unknown",
    productsCount: Array.isArray(pa?.products) ? (pa.products as unknown[]).length : 0,
    selectedRange: pa?.selectedRange ?? null,
  };
})(), null, 2)}
                </pre>
              </div>

              {/* Server-side debug data */}
              <div className="p-3 rounded-lg bg-muted/50 border border-border">
                <h4 className="font-medium text-sm mb-2">Server-Side Debug Data</h4>
                {debugData ? (
                  <pre className="text-xs bg-muted/30 p-2 rounded border border-border/50 overflow-x-auto whitespace-pre-wrap max-h-[400px] overflow-y-auto">
{JSON.stringify(debugData, null, 2)}
                  </pre>
                ) : (
                  <p className="text-sm text-muted-foreground">Loading debug data...</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
