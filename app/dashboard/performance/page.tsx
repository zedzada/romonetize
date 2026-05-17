"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatChartTime, type CCUHistoryRange } from "@/hooks/use-analytics";
import { ChartCard, RangeControls, CHART_COLORS, type ChartDateRange } from "@/components/dashboard/chart-card";
import { useChartTheme, getChartAxisProps, getChartGridProps, getChartTooltipStyle } from "@/hooks/use-chart-theme";
import { 
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  Tooltip,
  LabelList,
} from "recharts";
import { 
  Users, 
  Eye, 
  Heart, 
  ThumbsUp, 
  ThumbsDown, 
  RefreshCw,
  Activity,
  Clock,
  UserPlus,
  ShoppingCart,
  Gamepad2,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { GameIcon } from "@/components/dashboard/game-icon";
import { LockedStatCard } from "@/components/dashboard/locked-stat-card";
import { RevenueModeToggleCompact } from "@/components/dashboard/revenue-mode-toggle";

// Safe number formatter - never crashes
function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString();
}

// Safe duration formatter
function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

// Performance page range type - supports 24h to 90d
type PerformanceRange = "24h" | "72h" | "7d" | "28d" | "90d";

// Map to chart time format range
function toChartTimeRange(range: PerformanceRange): "1d" | "7d" | "30d" {
  switch (range) {
    case "24h": return "1d";
    case "72h": return "1d";
    case "7d": return "7d";
    case "28d": 
    case "90d": return "30d";
    default: return "7d";
  }
}

export default function PerformancePage() {
  const [chartRange, setChartRange] = useState<PerformanceRange>("7d");
  
  // Theme-aware chart colors
  const chartTheme = useChartTheme();
  const axisProps = getChartAxisProps(chartTheme);
  const gridProps = getChartGridProps(chartTheme);
  const tooltipStyle = getChartTooltipStyle(chartTheme);
  
  // CCU History chart controls (independent of other charts)
  const [ccuRange, setCcuRange] = useState<CCUHistoryRange>("24h");
  
  // Handle CCU range change
  const handleCcuRangeChange = useCallback((newRange: CCUHistoryRange) => {
    setCcuRange(newRange);
  }, []);
  
  // ==========================================================================
  // CLEAN DATA SOURCES - Only two endpoints
  // ==========================================================================
  
  // Performance Data from /api/dashboard/performance-data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [performanceData, setPerformanceData] = useState<any>(null);
  const [performanceDataError, setPerformanceDataError] = useState<string | null>(null);
  const [isLoadingPerformanceData, setIsLoadingPerformanceData] = useState(true);
  
  // CCU History from /api/dashboard/ccu-history
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [ccuHistoryData, setCcuHistoryData] = useState<any>(null);
  const [ccuHistoryError, setCcuHistoryError] = useState<string | null>(null);
  const [isLoadingCcuHistory, setIsLoadingCcuHistory] = useState(true);
  
  // Debug mode - show when ?debug=true in URL
  const [isDebugMode, setIsDebugMode] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setIsDebugMode(params.get("debug") === "true");
  }, []);
  
  // Fetch Performance Data
  const fetchPerformanceData = useCallback(async () => {
    setIsLoadingPerformanceData(true);
    setPerformanceDataError(null);
    
    try {
      const response = await fetch(`/api/dashboard/performance-data?range=${chartRange}&t=${Date.now()}`, {
        cache: "no-store",
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      setPerformanceData(data);
    } catch (err) {
      setPerformanceDataError(err instanceof Error ? err.message : "Failed to fetch performance data");
    } finally {
      setIsLoadingPerformanceData(false);
    }
  }, [chartRange]);
  
  // Fetch CCU History
  const fetchCcuHistory = useCallback(async () => {
    setIsLoadingCcuHistory(true);
    setCcuHistoryError(null);
    
    try {
      const response = await fetch(`/api/dashboard/ccu-history?range=${ccuRange}&t=${Date.now()}`, {
        cache: "no-store",
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      setCcuHistoryData(data);
    } catch (err) {
      setCcuHistoryError(err instanceof Error ? err.message : "Failed to fetch CCU history");
    } finally {
      setIsLoadingCcuHistory(false);
    }
  }, [ccuRange]);
  
  // Fetch on mount and when range changes
  useEffect(() => {
    fetchPerformanceData();
  }, [fetchPerformanceData]);
  
  useEffect(() => {
    fetchCcuHistory();
  }, [fetchCcuHistory]);
  
  // Refresh both endpoints
  const handleRefresh = useCallback(async () => {
    await Promise.all([fetchPerformanceData(), fetchCcuHistory()]);
  }, [fetchPerformanceData, fetchCcuHistory]);
  
  // ==========================================================================
  // DERIVED DATA - All from clean endpoints only
  // ==========================================================================
  
  // Game info from performance data
  const game = performanceData?.game ?? null;
  const selectedGameId = performanceData?.selectedGameId ?? null;
  const selectedGameName = performanceData?.selectedGameName ?? null;
  
  // Roblox stats from performance data
  const robloxStats = useMemo(() => ({
    ccu: performanceData?.robloxStats?.ccu ?? 0,
    visits: performanceData?.robloxStats?.visits ?? 0,
    favorites: performanceData?.robloxStats?.favorites ?? 0,
    likes: performanceData?.robloxStats?.likes ?? 0,
    dislikes: performanceData?.robloxStats?.dislikes ?? 0,
  }), [performanceData?.robloxStats]);
  
  // Tracker card stats from performance data metrics
  const cardStats = useMemo(() => ({
    totalEvents: performanceData?.metrics?.trackedActions ?? 0,
    uniquePlayers: performanceData?.metrics?.uniquePlayers ?? 0,
    totalSessions: performanceData?.metrics?.totalSessions ?? 0,
    avgSessionDuration: performanceData?.metrics?.avgSessionSeconds ?? null,
    newPlayers: performanceData?.metrics?.newPlayers ?? 0,
    totalPurchases: performanceData?.metrics?.purchases ?? 0,
  }), [performanceData?.metrics]);
  
  // Chart data from performance data charts
  const normalizedActivity = useMemo(() => {
    if (!performanceData?.charts?.activityOverTime) return [];
    return performanceData.charts.activityOverTime.map((b: { time: string; value: number }) => ({
      time: b.time,
      value: Number(b.value) || 0,
    }));
  }, [performanceData?.charts?.activityOverTime]);
  
  const normalizedSessions = useMemo(() => {
    if (!performanceData?.charts?.sessionsOverTime) return [];
    return performanceData.charts.sessionsOverTime.map((b: { time: string; value: number }) => ({
      time: b.time,
      value: Number(b.value) || 0,
    }));
  }, [performanceData?.charts?.sessionsOverTime]);
  
  const normalizedPurchases = useMemo(() => {
    if (!performanceData?.charts?.purchasesOverTime) return [];
    return performanceData.charts.purchasesOverTime.map((b: { time: string; value: number }) => ({
      time: b.time,
      value: Number(b.value) || 0,
    }));
  }, [performanceData?.charts?.purchasesOverTime]);
  
  // Visual totals (must match card values)
  const activityVisualTotal = normalizedActivity.reduce((s: number, p: { value: number }) => s + p.value, 0);
  const sessionsVisualTotal = normalizedSessions.reduce((s: number, p: { value: number }) => s + p.value, 0);
  const purchasesVisualTotal = normalizedPurchases.reduce((s: number, p: { value: number }) => s + p.value, 0);
  
  // CCU chart data from ccu-history endpoint
  const ccuChartData = useMemo(() => {
    if (!ccuHistoryData?.chartData) return [];
    return ccuHistoryData.chartData.map((p: { time: string; ccu: number; label?: string; source?: string }) => ({
      time: p.time,
      ccu: Number(p.ccu) || 0,
      label: p.label,
      source: p.source,
    }));
  }, [ccuHistoryData?.chartData]);
  
  // CCU stats
  const currentCcu = ccuHistoryData?.currentCcu ?? 0;
  const peakCcu = ccuHistoryData?.peakCcu ?? 0;
  const avgCcu = ccuHistoryData?.avgCcu ?? 0;
  
  // Data health check - check the correct conditions per the spec
  // Show "Requires tracking script" ONLY if ALL of these are zero
  const hasTrackerData = useMemo(() => {
    const metrics = performanceData?.metrics;
    if (!metrics) return false;
    return !(
      metrics.trackedActions === 0 &&
      metrics.totalSessions === 0 &&
      metrics.purchases === 0 &&
      metrics.uniquePlayers === 0
    );
  }, [performanceData?.metrics]);
  
  const needsTrackingScript = !hasTrackerData;
  const hasRobloxData = performanceData?.hasRobloxData ?? false;
  const monetizationLocked = performanceData?.monetizationLocked ?? false;
  
  // Safe data health for conditional rendering
  const safeDataHealth = {
    hasTrackerEvents: hasTrackerData,
    hasRobloxData: hasRobloxData,
  };
  
  // Loading state
  const isLoading = isLoadingPerformanceData;
  const isRefreshing = isLoadingPerformanceData || isLoadingCcuHistory;
  
  // Sync Roblox data and then refresh
  const [isSyncing, setIsSyncing] = useState(false);
  
  const handleSyncAndRefresh = useCallback(async () => {
    setIsSyncing(true);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      
      const syncResponse = await fetch("/api/roblox/sync-selected-game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeProducts: false }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId));
      
      if (!syncResponse.ok) {
        const errorData = await syncResponse.json().catch(() => ({}));
        console.error("[v0] Roblox sync failed:", errorData);
      }
      
      // Refresh both endpoints
      await handleRefresh();
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        console.error("Failed to sync and refresh", err);
      }
    } finally {
      setIsSyncing(false);
    }
  }, [handleRefresh]);
  
  // ==========================================================================
  // RENDER
  // ==========================================================================
  
  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Game Performance</h1>
          <p className="text-muted-foreground">Monitor your game&apos;s analytics and metrics</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[...Array(5)].map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <Skeleton className="h-4 w-20 mb-2" />
                <Skeleton className="h-8 w-24" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // Error state
  const error = performanceDataError || ccuHistoryError;
  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Game Performance</h1>
          <p className="text-muted-foreground">Monitor your game&apos;s analytics and metrics</p>
        </div>
        <Card className="border-destructive/50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="w-5 h-5" />
              <p>Failed to load performance data: {error}</p>
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Game Performance</h1>
          <p className="text-muted-foreground">Monitor your game&apos;s analytics and metrics</p>
        </div>
        <div className="flex items-center gap-3">
          <RevenueModeToggleCompact />
          <Button 
            onClick={handleSyncAndRefresh} 
            variant="outline" 
            disabled={isRefreshing || isSyncing}
            className="w-fit"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing || isSyncing ? "animate-spin" : ""}`} />
            {isSyncing ? "Syncing..." : "Refresh Data"}
          </Button>
        </div>
      </div>

      {/* Selected Game Card */}
      {game && (
        <Card className="border-border/50">
          <CardContent className="pt-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="flex items-center gap-3">
                <GameIcon 
                  name={game.name} 
                  thumbnailUrl={(game as Record<string, unknown>).icon_url as string | undefined}
                  robloxGameId={game.roblox_game_id}
                  size="md"
                />
                <div>
                  <h2 className="font-semibold text-foreground">{game.name}</h2>
                  <p className="text-sm text-muted-foreground">
                    Universe ID: {game.roblox_universe_id || "Not set"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Connected
                </Badge>
                <Link href={`https://www.roblox.com/games/${game.roblox_game_id}`} target="_blank">
                  <Button variant="ghost" size="sm">
                    <Gamepad2 className="w-4 h-4 mr-2" />
                    View on Roblox
                    <ExternalLink className="w-3 h-3 ml-2" />
                  </Button>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Roblox Stats */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground">Roblox Stats</h3>
          <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-[10px]">
            Roblox API
          </Badge>
        </div>
        {hasRobloxData ? (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Card className="border-border/50">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-2 mb-2">
                  <Users className="w-4 h-4 text-green-500" />
                  <span className="text-xs text-muted-foreground">Current CCU</span>
                </div>
                <div className="text-2xl font-bold text-foreground">
                  {formatNumber(robloxStats.ccu)}
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-2 mb-2">
                  <Eye className="w-4 h-4 text-blue-500" />
                  <span className="text-xs text-muted-foreground">Total Visits</span>
                </div>
                <div className="text-2xl font-bold text-foreground">
                  {formatNumber(robloxStats.visits)}
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-2 mb-2">
                  <Heart className="w-4 h-4 text-pink-500" />
                  <span className="text-xs text-muted-foreground">Favorites</span>
                </div>
                <div className="text-2xl font-bold text-foreground">
                  {formatNumber(robloxStats.favorites)}
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-2 mb-2">
                  <ThumbsUp className="w-4 h-4 text-green-500" />
                  <span className="text-xs text-muted-foreground">Likes</span>
                </div>
                <div className="text-2xl font-bold text-foreground">
                  {formatNumber(robloxStats.likes)}
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-2 mb-2">
                  <ThumbsDown className="w-4 h-4 text-red-500" />
                  <span className="text-xs text-muted-foreground">Dislikes</span>
                </div>
                <div className="text-2xl font-bold text-foreground">
                  {formatNumber(robloxStats.dislikes)}
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card className="border-border/50">
            <CardContent className="pt-6 pb-6 text-center">
              <p className="text-muted-foreground mb-4">No Roblox data available yet</p>
              <Button onClick={handleSyncAndRefresh} variant="outline">
                <RefreshCw className="w-4 h-4 mr-2" />
                Sync Roblox Data
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Tracker Stats */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground">Tracker Stats</h3>
          <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px]">
            RoMonetize Tracker
          </Badge>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <Card className="border-border/50">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-4 h-4 text-indigo-500" />
                <span className="text-xs text-muted-foreground">Tracked Actions</span>
              </div>
              {safeDataHealth.hasTrackerEvents ? (
                <div className="text-2xl font-bold text-foreground">
                  {formatNumber(cardStats.totalEvents)}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">Requires tracking script</div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-4 h-4 text-cyan-500" />
                <span className="text-xs text-muted-foreground">Unique Players</span>
              </div>
              {safeDataHealth.hasTrackerEvents ? (
                <div className="text-2xl font-bold text-foreground">
                  {formatNumber(cardStats.uniquePlayers)}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">Requires tracking script</div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-4 h-4 text-violet-500" />
                <span className="text-xs text-muted-foreground">Total Sessions</span>
              </div>
              {safeDataHealth.hasTrackerEvents ? (
                <div className="text-2xl font-bold text-foreground">
                  {formatNumber(cardStats.totalSessions)}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">Requires tracking script</div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-orange-500" />
                <span className="text-xs text-muted-foreground">Avg Session</span>
              </div>
              {safeDataHealth.hasTrackerEvents ? (
                cardStats.avgSessionDuration !== null ? (
                  <div className="text-2xl font-bold text-foreground">
                    {formatDuration(cardStats.avgSessionDuration)}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">Not enough data yet</div>
                )
              ) : (
                <div className="text-xs text-muted-foreground">Requires tracking script</div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2 mb-2">
                <UserPlus className="w-4 h-4 text-emerald-500" />
                <span className="text-xs text-muted-foreground">New Players</span>
              </div>
              {safeDataHealth.hasTrackerEvents ? (
                <div className="text-2xl font-bold text-foreground">
                  {formatNumber(cardStats.newPlayers)}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">Requires tracking script</div>
              )}
            </CardContent>
          </Card>

          {/* Purchases - Locked for free users */}
          {monetizationLocked ? (
            <LockedStatCard 
              label="Purchases"
              icon={<ShoppingCart className="w-4 h-4 text-rose-500" />}
              iconBgClassName="bg-rose-500/10"
              gradientClassName="from-card to-rose-500/5"
            />
          ) : (
            <Card className="border-border/50">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-2 mb-2">
                  <ShoppingCart className="w-4 h-4 text-rose-500" />
                  <span className="text-xs text-muted-foreground">Purchases</span>
                </div>
                {safeDataHealth.hasTrackerEvents ? (
                  <div className="text-2xl font-bold text-foreground">
                    {formatNumber(cardStats.totalPurchases)}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">Requires tracking script</div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Charts Section */}
      {(hasTrackerData || ccuChartData.length > 0) && (
        <div className="space-y-6">
          {/* Live CCU History - Large 2-column chart with its own controls */}
          <Card className="border-border bg-card shadow-sm lg:col-span-2">
            <CardHeader className="pb-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-sky-500" />
                    Live CCU History
                  </CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    Real-time concurrent users over time
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {/* CCU Stats */}
                  <div className="flex items-center gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Current:</span>
                      <span className="ml-1 font-semibold text-foreground">{formatNumber(currentCcu)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Peak:</span>
                      <span className="ml-1 font-semibold text-foreground">{formatNumber(peakCcu)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Avg:</span>
                      <span className="ml-1 font-semibold text-foreground">{formatNumber(avgCcu)}</span>
                    </div>
                  </div>
                  {/* Range Controls */}
                  <div className="flex items-center gap-1">
                    {(["1h", "24h", "7d", "28d", "90d"] as const).map((range) => (
                      <Button
                        key={range}
                        variant={ccuRange === range ? "default" : "ghost"}
                        size="sm"
                        onClick={() => handleCcuRangeChange(range)}
                        className="h-7 px-2 text-xs"
                      >
                        {range.toUpperCase()}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {isLoadingCcuHistory ? (
                <div className="h-[300px] flex items-center justify-center">
                  <Skeleton className="h-full w-full" />
                </div>
              ) : ccuChartData.length === 0 ? (
                <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                  No CCU data available for this time range
                </div>
              ) : (
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={ccuChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="liveCcuGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid {...gridProps} />
                      <XAxis
                        dataKey="time"
                        {...axisProps}
                        tickFormatter={(value) => formatChartTime(value, ccuRange === "1h" || ccuRange === "24h" ? "1d" : ccuRange === "7d" ? "7d" : "30d")}
                      />
                      <YAxis {...axisProps} />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const dataPoint = payload[0].payload;
                          const tooltipLabel = dataPoint.label || new Intl.DateTimeFormat("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          }).format(new Date(dataPoint.time));
                          
                          return (
                            <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-lg">
                              <p className="text-sm font-medium text-foreground mb-1">{tooltipLabel}</p>
                              <p className="text-sm text-foreground">CCU: {dataPoint.ccu?.toLocaleString() ?? "—"}</p>
                              {dataPoint.source && (
                                <p className="text-xs text-muted-foreground">
                                  Source: {dataPoint.source === "romonetize_tracker" ? "RoMonetize Tracker" : dataPoint.source}
                                </p>
                              )}
                            </div>
                          );
                        }}
                      />
                      <Area 
                        type="linear" 
                        dataKey="ccu" 
                        stroke="#0ea5e9"
                        strokeWidth={2}
                        fill="url(#liveCcuGradient)"
                        fillOpacity={0.18}
                        dot={false}
                        activeDot={{ r: 4, fill: "#0ea5e9", strokeWidth: 0 }}
                        connectNulls={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Activity, Sessions, Purchases Charts */}
          {hasTrackerData && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Activity Chart */}
              <ChartCard
                title="Activity"
                icon={<Activity className="w-4 h-4 text-indigo-500" />}
                description="Tracked events over time"
                dateRange={{
                  from: new Date(Date.now() - (chartRange === "24h" ? 24 : chartRange === "72h" ? 72 : chartRange === "7d" ? 168 : chartRange === "28d" ? 672 : 2160) * 60 * 60 * 1000),
                  to: new Date(),
                }}
                onRangeChange={(range) => setChartRange(range.preset as PerformanceRange)}
              >
                {normalizedActivity.length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={normalizedActivity}>
                      <defs>
                        <linearGradient id="activityGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={CHART_COLORS.violet} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={CHART_COLORS.violet} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid {...gridProps} />
                      <XAxis 
                        dataKey="time" 
                        {...axisProps}
                        tickFormatter={(value) => formatChartTime(value, toChartTimeRange(chartRange))}
                      />
                      <YAxis {...axisProps} />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const dataPoint = payload[0].payload;
                          return (
                            <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-lg">
                              <p className="text-sm font-medium text-foreground mb-1">
                                {formatChartTime(dataPoint.time, toChartTimeRange(chartRange))}
                              </p>
                              <p className="text-sm text-foreground">Events: {dataPoint.value?.toLocaleString() ?? "—"}</p>
                            </div>
                          );
                        }}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="value" 
                        stroke={CHART_COLORS.violet}
                        strokeWidth={2}
                        fill="url(#activityGradient)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
                    No activity data
                  </div>
                )}
              </ChartCard>

              {/* Sessions Chart */}
              <ChartCard
                title="Sessions"
                icon={<Activity className="w-4 h-4 text-violet-500" />}
                description="Player sessions over time"
                dateRange={{
                  from: new Date(Date.now() - (chartRange === "24h" ? 24 : chartRange === "72h" ? 72 : chartRange === "7d" ? 168 : chartRange === "28d" ? 672 : 2160) * 60 * 60 * 1000),
                  to: new Date(),
                }}
                onRangeChange={(range) => setChartRange(range.preset as PerformanceRange)}
              >
                {normalizedSessions.length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={normalizedSessions}>
                      <defs>
                        <linearGradient id="sessionsGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={CHART_COLORS.cyan} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={CHART_COLORS.cyan} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid {...gridProps} />
                      <XAxis 
                        dataKey="time" 
                        {...axisProps}
                        tickFormatter={(value) => formatChartTime(value, toChartTimeRange(chartRange))}
                      />
                      <YAxis {...axisProps} />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const dataPoint = payload[0].payload;
                          return (
                            <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-lg">
                              <p className="text-sm font-medium text-foreground mb-1">
                                {formatChartTime(dataPoint.time, toChartTimeRange(chartRange))}
                              </p>
                              <p className="text-sm text-foreground">Sessions: {dataPoint.value?.toLocaleString() ?? "—"}</p>
                            </div>
                          );
                        }}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="value" 
                        stroke={CHART_COLORS.cyan}
                        strokeWidth={2}
                        fill="url(#sessionsGradient)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
                    No sessions data
                  </div>
                )}
              </ChartCard>

              {/* Purchases Chart */}
              {!monetizationLocked && (
                <ChartCard
                  title="Purchases"
                  icon={<ShoppingCart className="w-4 h-4 text-rose-500" />}
                  description="Purchases over time"
                  dateRange={{
                    from: new Date(Date.now() - (chartRange === "24h" ? 24 : chartRange === "72h" ? 72 : chartRange === "7d" ? 168 : chartRange === "28d" ? 672 : 2160) * 60 * 60 * 1000),
                    to: new Date(),
                  }}
                  onRangeChange={(range) => setChartRange(range.preset as PerformanceRange)}
                >
                  {normalizedPurchases.length > 0 ? (
                    <ResponsiveContainer width="100%" height={200}>
                      <AreaChart data={normalizedPurchases}>
                        <defs>
                          <linearGradient id="purchasesGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={CHART_COLORS.green} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={CHART_COLORS.green} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid {...gridProps} />
                        <XAxis 
                          dataKey="time" 
                          {...axisProps}
                          tickFormatter={(value) => formatChartTime(value, toChartTimeRange(chartRange))}
                        />
                        <YAxis {...axisProps} />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const dataPoint = payload[0].payload;
                            return (
                              <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-lg">
                                <p className="text-sm font-medium text-foreground mb-1">
                                  {formatChartTime(dataPoint.time, toChartTimeRange(chartRange))}
                                </p>
                                <p className="text-sm text-foreground">Purchases: {dataPoint.value?.toLocaleString() ?? "—"}</p>
                              </div>
                            );
                          }}
                        />
                        <Area 
                          type="monotone" 
                          dataKey="value" 
                          stroke={CHART_COLORS.green}
                          strokeWidth={2}
                          fill="url(#purchasesGradient)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
                      No purchases data
                    </div>
                  )}
                </ChartCard>
              )}
            </div>
          )}
        </div>
      )}

      {/* Debug Panel */}
      {isDebugMode && (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardHeader>
            <CardTitle className="text-amber-600">Debug Panel</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm font-mono">
              <div>
                <strong>Selected Game:</strong>
                <pre className="mt-1 p-2 bg-black/20 rounded text-xs overflow-auto max-h-40">
                  {JSON.stringify({
                    selectedGameId,
                    selectedGameName,
                  }, null, 2)}
                </pre>
              </div>
              <div>
                <strong>Roblox Stats:</strong>
                <pre className="mt-1 p-2 bg-black/20 rounded text-xs overflow-auto max-h-40">
                  {JSON.stringify(robloxStats, null, 2)}
                </pre>
              </div>
              <div>
                <strong>Performance Data:</strong>
                <pre className="mt-1 p-2 bg-black/20 rounded text-xs overflow-auto max-h-40">
                  {JSON.stringify({
                    metrics: performanceData?.metrics,
                    totals: performanceData?.totals,
                    eventTypeCounts: performanceData?.debug?.eventTypeCounts,
                    eventsFound: performanceData?.eventsFound,
                    chartsActivity: normalizedActivity.length,
                    chartsSessions: normalizedSessions.length,
                    chartsPurchases: normalizedPurchases.length,
                  }, null, 2)}
                </pre>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm font-mono">
              <div>
                <strong>CCU Data:</strong>
                <pre className="mt-1 p-2 bg-black/20 rounded text-xs overflow-auto max-h-40">
                  {JSON.stringify({
                    range: ccuRange,
                    usedSource: ccuHistoryData?.usedSource,
                    usedSnapshots: ccuHistoryData?.usedSnapshots,
                    chartDataLength: ccuChartData.length,
                    currentCcu,
                    peakCcu,
                    avgCcu,
                    latestSnapshot: ccuHistoryData?.latestSnapshotAt,
                  }, null, 2)}
                </pre>
              </div>
              <div>
                <strong>Data Health:</strong>
                <pre className="mt-1 p-2 bg-black/20 rounded text-xs overflow-auto max-h-40">
                  {JSON.stringify({
                    hasTrackerData,
                    hasRobloxData,
                    monetizationLocked,
                    needsTrackingScript,
                  }, null, 2)}
                </pre>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tracking Script Installation Guide */}
      {needsTrackingScript && (
        <Card className="border-amber-500/50 bg-gradient-to-br from-amber-500/10 to-orange-500/5">
          <CardContent className="pt-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-amber-500/10 rounded-lg">
                  <AlertCircle className="w-5 h-5 text-amber-500" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Tracking Script Required</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Install the RoMonetize tracking script to unlock detailed analytics including player sessions, events, and purchases.
                  </p>
                </div>
              </div>
              <Button asChild variant="outline" className="border-amber-500/30 hover:bg-amber-500/10">
                <Link href="/dashboard/game/tracking-setup">
                  View Installation Guide
                  <ExternalLink className="w-3 h-3 ml-2" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
