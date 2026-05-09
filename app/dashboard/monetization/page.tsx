"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAnalytics, formatChartTime, type HourlyMonetizationPoint } from "@/hooks/use-analytics";
import { CHART_COLORS, chartAxisStyle, chartGridStyle } from "@/components/dashboard/chart-card";
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

// Chart color palette - bright and visible
const COLORS = {
  totalRevenue: "#3b82f6",    // Bright blue
  devProduct: "#22c55e",       // Green
  gamepass: "#ec4899",         // Pink/Magenta
  purchases: "#f59e0b",        // Amber
  grid: "#374151",
  axis: "#9ca3af",
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

// Custom tooltip for the hero chart
function HeroChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name: string; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  
  const date = new Date(label || "");
  const formattedTime = date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="bg-neutral-900/95 border border-neutral-700 rounded-lg shadow-xl p-3 min-w-[180px]">
      <p className="text-xs text-neutral-400 mb-2 font-medium">{formattedTime}</p>
      <div className="space-y-1.5">
        {payload.map((entry, index) => (
          <div key={index} className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
              <span className="text-xs text-neutral-300">{entry.name}</span>
            </div>
            <span className="text-xs font-semibold text-white">
              {entry.name === "Purchases" ? entry.value : `R$${entry.value.toLocaleString()}`}
            </span>
          </div>
        ))}
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
          <span className="text-xs text-neutral-400">{item.name}</span>
          {item.value !== undefined && (
            <span className="text-xs font-medium text-neutral-200">R${item.value.toLocaleString()}</span>
          )}
        </div>
      ))}
    </div>
  );
}

type ChartRange = "24h" | "72h" | "7d" | "28d";
type ChartInterval = "hourly" | "daily";
type ChartBreakdown = "total" | "split";

export default function MonetizationPage() {
  const [chartRange, setChartRange] = useState<ChartRange>("72h");
  const [chartInterval, setChartInterval] = useState<ChartInterval>("hourly");
  const [chartBreakdown, setChartBreakdown] = useState<ChartBreakdown>("split");

  const {
    isLoading,
    isRefreshing,
    error,
    revenueStats,
    monetizationCharts,
    hasTrackerData,
    needsTrackingScript,
    refresh,
  } = useAnalytics({ enabled: true, range: "7d" });

  // Safe defaults
  const safeRevenueStats = {
    totalRevenue: revenueStats?.totalRevenue ?? 0,
    revenue72h: revenueStats?.revenue72h ?? 0,
    totalPurchases: revenueStats?.totalPurchases ?? 0,
    payingUsers: revenueStats?.payingUsers ?? 0,
    arppu: revenueStats?.arppu ?? 0,
    arpdau: revenueStats?.arpdau ?? 0,
  };

  // Process hourly data based on selected range and interval
  const processedChartData = useMemo(() => {
    if (!monetizationCharts?.hourlyMonetization?.length) return [];
    
    const hourlyData = monetizationCharts.hourlyMonetization;
    const now = new Date();
    
    // Filter by range
    let hoursToShow = 72;
    if (chartRange === "24h") hoursToShow = 24;
    else if (chartRange === "72h") hoursToShow = 72;
    else if (chartRange === "7d") hoursToShow = 168;
    else if (chartRange === "28d") hoursToShow = 672;

    const cutoffTime = new Date(now.getTime() - hoursToShow * 60 * 60 * 1000);
    let filteredData = hourlyData.filter(d => new Date(d.time) >= cutoffTime);

    // If daily interval, aggregate by day
    if (chartInterval === "daily") {
      const dailyBuckets = new Map<string, { total: number; devproduct: number; gamepass: number; purchases: number }>();
      
      filteredData.forEach((d) => {
        const dayKey = d.time.slice(0, 10);
        const existing = dailyBuckets.get(dayKey) || { total: 0, devproduct: 0, gamepass: 0, purchases: 0 };
        existing.total += d.totalRevenue;
        existing.devproduct += d.devproductRevenue;
        existing.gamepass += d.gamepassRevenue;
        existing.purchases += d.purchases;
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

    return filteredData;
  }, [monetizationCharts?.hourlyMonetization, chartRange, chartInterval]);

  // Calculate totals for current view
  const chartTotals = useMemo(() => {
    return processedChartData.reduce(
      (acc, d) => ({
        total: acc.total + d.totalRevenue,
        devproduct: acc.devproduct + d.devproductRevenue,
        gamepass: acc.gamepass + d.gamepassRevenue,
        purchases: acc.purchases + d.purchases,
      }),
      { total: 0, devproduct: 0, gamepass: 0, purchases: 0 }
    );
  }, [processedChartData]);

  const handleRefresh = async () => {
    if (refresh) await refresh();
  };

  // Loading state
  if (isLoading) {
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

  const hasChartData = processedChartData.length > 0 && chartTotals.total > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Monetization</h1>
          <p className="text-muted-foreground">Track revenue and purchase metrics from your tracking script</p>
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

      {/* Data source badge */}
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[10px]">
          RoMonetize Tracker
        </Badge>
        {hasTrackerData && (
          <span className="text-xs text-muted-foreground">
            Revenue data from purchase_success events
          </span>
        )}
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
                  Monetization data requires the RoMonetize tracking script. The script captures purchase events 
                  including the robux amount, product details, and player information.
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

      {/* Revenue Stats Cards - 6 column grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card className="border-neutral-700/60 bg-neutral-900/40">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-4 h-4 text-emerald-400" />
              <span className="text-xs text-neutral-400">Total Revenue</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {!hasTrackerData ? (
                <span className="text-sm text-neutral-500 font-normal">Requires tracking</span>
              ) : (
                formatRobux(safeRevenueStats.totalRevenue)
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-neutral-700/60 bg-neutral-900/40">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-blue-400" />
              <span className="text-xs text-neutral-400">72h Revenue</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {!hasTrackerData ? (
                <span className="text-sm text-neutral-500 font-normal">Requires tracking</span>
              ) : (
                formatRobux(safeRevenueStats.revenue72h)
              )}
            </div>
            <p className="text-[10px] text-neutral-500 mt-1">Last 72 hours</p>
          </CardContent>
        </Card>

        <Card className="border-neutral-700/60 bg-neutral-900/40">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <ShoppingCart className="w-4 h-4 text-amber-400" />
              <span className="text-xs text-neutral-400">Purchases</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {!hasTrackerData ? (
                <span className="text-sm text-neutral-500 font-normal">Requires tracking</span>
              ) : (
                formatNumber(safeRevenueStats.totalPurchases)
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-neutral-700/60 bg-neutral-900/40">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-4 h-4 text-violet-400" />
              <span className="text-xs text-neutral-400">Paying Users</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {!hasTrackerData ? (
                <span className="text-sm text-neutral-500 font-normal">Requires tracking</span>
              ) : (
                formatNumber(safeRevenueStats.payingUsers)
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-neutral-700/60 bg-neutral-900/40">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <Coins className="w-4 h-4 text-amber-400" />
              <span className="text-xs text-neutral-400">ARPPU</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {!hasTrackerData || !safeRevenueStats.arppu ? (
                <span className="text-lg font-medium text-neutral-500">—</span>
              ) : (
                formatRobux(safeRevenueStats.arppu)
              )}
            </div>
            <p className="text-[10px] text-neutral-500 mt-1">Per paying user</p>
          </CardContent>
        </Card>

        <Card className="border-neutral-700/60 bg-neutral-900/40">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-cyan-400" />
              <span className="text-xs text-neutral-400">ARPDAU</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {!hasTrackerData || !safeRevenueStats.arpdau ? (
                <span className="text-lg font-medium text-neutral-500">—</span>
              ) : (
                formatRobux(safeRevenueStats.arpdau)
              )}
            </div>
            <p className="text-[10px] text-neutral-500 mt-1">Per daily active user</p>
          </CardContent>
        </Card>
      </div>

      {/* Hero Chart: Hourly Revenue / Sales */}
      <Card className="border-neutral-700/60 bg-neutral-900/40">
        <CardHeader className="pb-2">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <CardTitle className="text-lg font-semibold text-foreground">
                Revenue & Sales
              </CardTitle>
              <p className="text-sm text-neutral-400 mt-0.5">
                {chartRange === "24h" ? "Last 24 hours" : chartRange === "72h" ? "Last 72 hours" : chartRange === "7d" ? "Last 7 days" : "Last 28 days"}
                {chartInterval === "hourly" ? " (hourly)" : " (daily)"}
              </p>
            </div>
            {/* Chart Controls */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Range selector */}
              <div className="flex items-center bg-neutral-800/50 rounded-lg p-0.5">
                {(["24h", "72h", "7d", "28d"] as ChartRange[]).map((r) => (
                  <button
                    key={r}
                    onClick={() => setChartRange(r)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      chartRange === r
                        ? "bg-neutral-700 text-white"
                        : "text-neutral-400 hover:text-neutral-200"
                    }`}
                  >
                    {r.toUpperCase()}
                  </button>
                ))}
              </div>
              {/* Interval selector */}
              <div className="flex items-center bg-neutral-800/50 rounded-lg p-0.5">
                {(["hourly", "daily"] as ChartInterval[]).map((i) => (
                  <button
                    key={i}
                    onClick={() => setChartInterval(i)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize ${
                      chartInterval === i
                        ? "bg-neutral-700 text-white"
                        : "text-neutral-400 hover:text-neutral-200"
                    }`}
                  >
                    {i}
                  </button>
                ))}
              </div>
              {/* Breakdown toggle */}
              <div className="flex items-center bg-neutral-800/50 rounded-lg p-0.5">
                <button
                  onClick={() => setChartBreakdown("total")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    chartBreakdown === "total"
                      ? "bg-neutral-700 text-white"
                      : "text-neutral-400 hover:text-neutral-200"
                  }`}
                >
                  Total
                </button>
                <button
                  onClick={() => setChartBreakdown("split")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    chartBreakdown === "split"
                      ? "bg-neutral-700 text-white"
                      : "text-neutral-400 hover:text-neutral-200"
                  }`}
                >
                  By Type
                </button>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-2">
          {!hasTrackerData ? (
            <div className="h-[350px] flex flex-col items-center justify-center text-center">
              <Activity className="w-12 h-12 text-neutral-600 mb-4" />
              <p className="text-base font-medium text-neutral-300 mb-1">Not enough purchase data yet</p>
              <p className="text-sm text-neutral-500 max-w-md">
                Make a few purchases in your game to populate the revenue chart. Revenue tracking requires the tracking script.
              </p>
            </div>
          ) : !hasChartData ? (
            <div className="h-[350px] flex flex-col items-center justify-center text-center">
              <Activity className="w-12 h-12 text-neutral-600 mb-4" />
              <p className="text-base font-medium text-neutral-300 mb-1">No revenue in selected period</p>
              <p className="text-sm text-neutral-500 max-w-md">
                No purchases have been tracked in the {chartRange === "24h" ? "last 24 hours" : chartRange === "72h" ? "last 72 hours" : chartRange === "7d" ? "last 7 days" : "last 28 days"}. Try selecting a different time range.
              </p>
            </div>
          ) : (
            <>
              {/* Summary stats above chart */}
              <div className="flex items-center justify-center gap-8 mb-4 text-center">
                <div>
                  <p className="text-2xl font-bold text-white">R${chartTotals.total.toLocaleString()}</p>
                  <p className="text-xs text-neutral-400">Total Revenue</p>
                </div>
                <div className="w-px h-10 bg-neutral-700" />
                <div>
                  <p className="text-2xl font-bold text-white">{chartTotals.purchases.toLocaleString()}</p>
                  <p className="text-xs text-neutral-400">Purchases</p>
                </div>
              </div>
              
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={processedChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="totalRevenueGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={COLORS.totalRevenue} stopOpacity={0.3}/>
                        <stop offset="95%" stopColor={COLORS.totalRevenue} stopOpacity={0.02}/>
                      </linearGradient>
                      <linearGradient id="devProductGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={COLORS.devProduct} stopOpacity={0.3}/>
                        <stop offset="95%" stopColor={COLORS.devProduct} stopOpacity={0.02}/>
                      </linearGradient>
                      <linearGradient id="gamepassGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={COLORS.gamepass} stopOpacity={0.3}/>
                        <stop offset="95%" stopColor={COLORS.gamepass} stopOpacity={0.02}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} strokeOpacity={0.5} vertical={false} />
                    <XAxis 
                      dataKey="time" 
                      tickFormatter={(v) => {
                        const date = new Date(v);
                        if (chartInterval === "hourly") {
                          return date.toLocaleString(undefined, { hour: "numeric", hour12: true });
                        }
                        return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
                      }}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: COLORS.axis, fontSize: 11 }}
                      tickMargin={8}
                    />
                    <YAxis 
                      tickFormatter={(v) => v === 0 ? "0" : `R$${v >= 1000 ? `${(v/1000).toFixed(1)}k` : v}`}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: COLORS.axis, fontSize: 11 }}
                      tickMargin={8}
                      width={60}
                    />
                    <Tooltip content={<HeroChartTooltip />} />
                    
                    {chartBreakdown === "total" ? (
                      <Area
                        type="monotone"
                        dataKey="totalRevenue"
                        name="Total Revenue"
                        stroke={COLORS.totalRevenue}
                        strokeWidth={3}
                        fill="url(#totalRevenueGradient)"
                        dot={false}
                        activeDot={{ r: 6, fill: COLORS.totalRevenue, strokeWidth: 2, stroke: "#0a0a0a" }}
                      />
                    ) : (
                      <>
                        <Area
                          type="monotone"
                          dataKey="devproductRevenue"
                          name="Dev Products"
                          stroke={COLORS.devProduct}
                          strokeWidth={2.5}
                          fill="url(#devProductGradient)"
                          dot={false}
                          activeDot={{ r: 5, fill: COLORS.devProduct, strokeWidth: 2, stroke: "#0a0a0a" }}
                        />
                        <Area
                          type="monotone"
                          dataKey="gamepassRevenue"
                          name="Game Passes"
                          stroke={COLORS.gamepass}
                          strokeWidth={2.5}
                          fill="url(#gamepassGradient)"
                          dot={false}
                          activeDot={{ r: 5, fill: COLORS.gamepass, strokeWidth: 2, stroke: "#0a0a0a" }}
                        />
                      </>
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              
              {/* Legend */}
              <ChartLegend 
                items={chartBreakdown === "total" 
                  ? [{ name: "Total Revenue", color: COLORS.totalRevenue, value: chartTotals.total }]
                  : [
                      { name: "Dev Products", color: COLORS.devProduct, value: chartTotals.devproduct },
                      { name: "Game Passes", color: COLORS.gamepass, value: chartTotals.gamepass },
                    ]
                }
              />
            </>
          )}
        </CardContent>
      </Card>

      {/* Supporting Charts Grid */}
      {hasTrackerData && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Daily Revenue Chart */}
          <Card className="border-neutral-700/60 bg-neutral-900/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-foreground">Daily Revenue</CardTitle>
              <p className="text-xs text-neutral-400">Revenue grouped by day</p>
            </CardHeader>
            <CardContent className="pt-2">
              {monetizationCharts?.revenueOverTime?.length ? (
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monetizationCharts.revenueOverTime} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} strokeOpacity={0.5} vertical={false} />
                      <XAxis 
                        dataKey="date" 
                        tickFormatter={(v) => formatChartTime(v, "7d")}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: COLORS.axis, fontSize: 10 }}
                        tickMargin={8}
                      />
                      <YAxis 
                        tickFormatter={(v) => `R$${v}`}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: COLORS.axis, fontSize: 10 }}
                        width={50}
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#171717", border: "1px solid #404040", borderRadius: "8px" }}
                        labelStyle={{ color: "#e5e5e5", fontWeight: 600 }}
                        formatter={(value: number) => [`R$${value.toLocaleString()}`, "Revenue"]}
                      />
                      <Bar 
                        dataKey="revenue" 
                        fill={COLORS.totalRevenue}
                        radius={[4, 4, 0, 0]}
                        maxBarSize={40}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-[220px] flex items-center justify-center">
                  <p className="text-sm text-neutral-500">No daily revenue data</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Purchases Over Time Chart */}
          <Card className="border-neutral-700/60 bg-neutral-900/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-foreground">Purchases Over Time</CardTitle>
              <p className="text-xs text-neutral-400">Number of transactions</p>
            </CardHeader>
            <CardContent className="pt-2">
              {monetizationCharts?.purchasesOverTime?.length ? (
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={monetizationCharts.purchasesOverTime} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="purchasesGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={COLORS.purchases} stopOpacity={0.3}/>
                          <stop offset="95%" stopColor={COLORS.purchases} stopOpacity={0.02}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} strokeOpacity={0.5} vertical={false} />
                      <XAxis 
                        dataKey="date" 
                        tickFormatter={(v) => formatChartTime(v, "7d")}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: COLORS.axis, fontSize: 10 }}
                        tickMargin={8}
                      />
                      <YAxis 
                        allowDecimals={false}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: COLORS.axis, fontSize: 10 }}
                        width={30}
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#171717", border: "1px solid #404040", borderRadius: "8px" }}
                        labelStyle={{ color: "#e5e5e5", fontWeight: 600 }}
                        formatter={(value: number) => [value.toLocaleString(), "Purchases"]}
                      />
                      <Area 
                        type="monotone"
                        dataKey="purchases" 
                        stroke={COLORS.purchases}
                        strokeWidth={2}
                        fill="url(#purchasesGradient)"
                        dot={false}
                        activeDot={{ r: 5, fill: COLORS.purchases, strokeWidth: 2, stroke: "#0a0a0a" }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-[220px] flex items-center justify-center">
                  <p className="text-sm text-neutral-500">No purchase data</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Revenue by Product Type - Donut Chart */}
          <Card className="border-neutral-700/60 bg-neutral-900/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-foreground">Revenue by Product Type</CardTitle>
              <p className="text-xs text-neutral-400">Gamepasses vs Developer Products</p>
            </CardHeader>
            <CardContent className="pt-2">
              {monetizationCharts?.revenueByProductType?.length ? (
                <div className="h-[220px] flex items-center justify-center gap-6">
                  <ResponsiveContainer width={180} height={180}>
                    <PieChart>
                      <Pie
                        data={monetizationCharts.revenueByProductType}
                        dataKey="revenue"
                        nameKey="productType"
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        paddingAngle={3}
                        strokeWidth={0}
                      >
                        {monetizationCharts.revenueByProductType.map((entry) => (
                          <Cell 
                            key={entry.productType} 
                            fill={entry.productType === "gamepass" ? COLORS.gamepass : COLORS.devProduct}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ backgroundColor: "#171717", border: "1px solid #404040", borderRadius: "8px" }}
                        formatter={(value: number, name: string) => [
                          `R$${value.toLocaleString()}`,
                          name === "gamepass" ? "Game Passes" : "Dev Products"
                        ]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-3">
                    {monetizationCharts.revenueByProductType.map((item) => {
                      const total = monetizationCharts.revenueByProductType.reduce((s, i) => s + i.revenue, 0);
                      const percentage = total > 0 ? ((item.revenue / total) * 100).toFixed(1) : "0";
                      return (
                        <div key={item.productType} className="flex items-center gap-3">
                          <div 
                            className="w-4 h-4 rounded-md" 
                            style={{ backgroundColor: item.productType === "gamepass" ? COLORS.gamepass : COLORS.devProduct }}
                          />
                          <div>
                            <p className="text-sm font-medium text-neutral-300">
                              {item.productType === "gamepass" ? "Game Passes" : "Dev Products"}
                            </p>
                            <p className="text-lg font-bold text-white">
                              R${item.revenue.toLocaleString()}
                              <span className="text-xs text-neutral-500 ml-1">({percentage}%)</span>
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="h-[220px] flex items-center justify-center">
                  <p className="text-sm text-neutral-500">No revenue breakdown</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Top Products - Horizontal Bar Chart */}
          <Card className="border-neutral-700/60 bg-neutral-900/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-foreground">Top Products by Revenue</CardTitle>
              <p className="text-xs text-neutral-400">Best performing products</p>
            </CardHeader>
            <CardContent className="pt-2">
              {monetizationCharts?.topProducts?.length ? (
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart 
                      data={monetizationCharts.topProducts.slice(0, 5)} 
                      layout="vertical"
                      margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} strokeOpacity={0.3} horizontal={true} vertical={false} />
                      <XAxis 
                        type="number"
                        tickFormatter={(v) => `R$${v >= 1000 ? `${(v/1000).toFixed(1)}k` : v}`}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: COLORS.axis, fontSize: 10 }}
                      />
                      <YAxis 
                        type="category"
                        dataKey="productName"
                        width={100}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: COLORS.axis, fontSize: 10 }}
                        tickFormatter={(v) => v.length > 14 ? v.slice(0, 14) + "..." : v}
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#171717", border: "1px solid #404040", borderRadius: "8px" }}
                        labelStyle={{ color: "#e5e5e5", fontWeight: 600 }}
                        formatter={(value: number, name: string, props: { payload?: { productType?: string; purchases?: number } }) => {
                          const payload = props.payload;
                          return [
                            <span key="value">
                              R${value.toLocaleString()} 
                              <span className="text-neutral-400 ml-2">({payload?.purchases || 0} sales)</span>
                            </span>,
                            payload?.productType === "gamepass" ? "Game Pass" : "Dev Product"
                          ];
                        }}
                      />
                      <Bar 
                        dataKey="revenue" 
                        fill={CHART_COLORS.emerald}
                        radius={[0, 4, 4, 0]}
                        maxBarSize={28}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-[220px] flex items-center justify-center">
                  <p className="text-sm text-neutral-500">No product data</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Data explanation */}
      <Card className="border-neutral-700/50 bg-neutral-900/30">
        <CardHeader>
          <CardTitle className="text-base">How Monetization Data Works</CardTitle>
          <CardDescription>
            Understanding the data sources for your revenue metrics
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="p-4 rounded-lg bg-neutral-800/30 border border-neutral-700/50">
              <h4 className="font-medium text-foreground mb-2 flex items-center gap-2">
                <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[10px]">
                  RoMonetize Tracker
                </Badge>
              </h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Revenue (from purchase_success robux field)</li>
                <li>• Purchases (count of purchase_success events)</li>
                <li>• Paying Users (distinct player_id from purchases)</li>
                <li>• ARPPU (revenue / paying users)</li>
                <li>• ARPDAU (revenue / unique active players)</li>
              </ul>
            </div>

            <div className="p-4 rounded-lg bg-neutral-800/30 border border-neutral-700/50">
              <h4 className="font-medium text-foreground mb-2">Required Event: purchase_success</h4>
              <p className="text-sm text-muted-foreground mb-2">
                Fire this event when a player completes a purchase:
              </p>
              <pre className="text-xs bg-neutral-900/50 p-2 rounded border border-neutral-700/30 overflow-x-auto">
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
              Revenue tracking requires the RoMonetize tracking script to capture purchase events directly from your game.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
