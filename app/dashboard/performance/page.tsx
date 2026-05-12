"use client";

import { useState, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAnalytics, formatChartTime, type CCUHistoryRange, type CCUHistoryInterval } from "@/hooks/use-analytics";
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
  UserCheck,
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

// Map performance range to analytics API range
function toAnalyticsRange(range: PerformanceRange): "1d" | "7d" | "30d" | "90d" {
  switch (range) {
    case "24h": return "1d";
    case "72h": 
    case "7d": return "7d";
    case "28d": return "30d";
    case "90d": return "90d";
    default: return "7d";
  }
}

// Map to chart time format range
function toChartTimeRange(range: PerformanceRange): "1d" | "7d" | "30d" {
  switch (range) {
    case "24h": return "1d";
    case "72h": return "1d"; // hourly format
    case "7d": return "7d";
    case "28d": 
    case "90d": return "30d"; // daily format
    default: return "7d";
  }
}

// CCU History interval/range compatibility rules
// 1m interval ONLY available for 1H
const CCU_MINUTE_COMPATIBLE_RANGES: CCUHistoryRange[] = ["1h"];
// 24H and 7D can use hourly, 28D and 90D must use daily
const CCU_HOURLY_COMPATIBLE_RANGES: CCUHistoryRange[] = ["1h", "24h", "7d"];
const CCU_DAILY_ONLY_RANGES: CCUHistoryRange[] = ["28d", "90d"];

function getDefaultCcuInterval(range: CCUHistoryRange): CCUHistoryInterval {
  if (range === "1h") return "1m";
  if (range === "24h") return "hourly";
  if (range === "7d") return "hourly";
  return "daily"; // 28d, 90d
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
  const [ccuInterval, setCcuInterval] = useState<CCUHistoryInterval>("hourly");
  
  // Handle CCU range change with auto-interval switching per requirements:
  // 1H default: 1m, 24H default: Hourly, 7D default: Hourly, 28D/90D default: Daily
  const handleCcuRangeChange = useCallback((newRange: CCUHistoryRange) => {
    setCcuRange(newRange);
    // Auto-switch to the correct default interval for the range
    setCcuInterval(getDefaultCcuInterval(newRange));
  }, []);
  
  // Handle CCU interval change with auto-range switching
  const handleCcuIntervalChange = useCallback((newInterval: CCUHistoryInterval) => {
    // If selecting 1m on incompatible range, switch to 1h first
    if (newInterval === "1m" && !CCU_MINUTE_COMPATIBLE_RANGES.includes(ccuRange)) {
      setCcuRange("1h");
    }
    setCcuInterval(newInterval);
  }, [ccuRange]);
  
  const {
    isLoading,
    isRefreshing,
    error,
    game,
    dataHealth,
    robloxStats,
    trackerStats,
    performanceCharts: rawPerformanceCharts,
    ccuStats: rawCcuStats,
    ccuHistory: rawCcuHistory,
    refresh,
    needsTrackingScript,
    hasTrackerData,
    hasRobloxData,
    monetizationLocked,
  } = useAnalytics({ 
    enabled: true, 
    range: toAnalyticsRange(chartRange),
  });
  
  // Sync Roblox data and then refresh analytics
  const [isSyncing, setIsSyncing] = useState(false);
  
  const handleSyncAndRefresh = useCallback(async () => {
    setIsSyncing(true);
    try {
      // Call sync endpoint to insert new CCU snapshot
      await fetch("/api/roblox/sync-selected-game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeProducts: false }),
      });
      
      // Refresh analytics data to pick up new snapshot
      await refresh();
    } catch (err) {
      console.error("Failed to sync and refresh", err);
    } finally {
      setIsSyncing(false);
    }
  }, [refresh]);
  
  // Process CCU history data client-side based on selected range and interval
  // This allows instant range/interval switching without API refetch
  const processedCcuHistory = useMemo(() => {
    if (!rawCcuHistory?.rawSnapshots?.length) {
      return { data: [], currentCcu: rawCcuHistory?.currentCcu ?? null, peakCcu: null, avgCcu: null };
    }
    
    const now = new Date();
    
    // Sort snapshots by timestamp ascending (oldest first) before processing
    const sortedSnapshots = [...rawCcuHistory.rawSnapshots].sort((a, b) => 
      new Date(a.time).getTime() - new Date(b.time).getTime()
    );
    
    // Calculate cutoff time based on selected range (in real UTC time)
    const getRangeMs = (range: CCUHistoryRange): number => {
      switch (range) {
        case "1h": return 60 * 60 * 1000;
        case "24h": return 24 * 60 * 60 * 1000;
        case "7d": return 7 * 24 * 60 * 60 * 1000;
        case "28d": return 28 * 24 * 60 * 60 * 1000;
        case "90d": return 90 * 24 * 60 * 60 * 1000;
        default: return 24 * 60 * 60 * 1000;
      }
    };
    
    const rangeMs = getRangeMs(ccuRange);
    const cutoffTime = new Date(now.getTime() - rangeMs);
    
    // Filter snapshots by selected range using UTC timestamps
    const filteredSnapshots = sortedSnapshots.filter((s) => new Date(s.time).getTime() >= cutoffTime.getTime());
    
    if (filteredSnapshots.length === 0) {
      return { data: [], currentCcu: rawCcuHistory.currentCcu, peakCcu: null, avgCcu: null };
    }
    
    // Bucket the data based on interval - use timestamp as bucket key for proper sorting
    const buckets = new Map<number, { ccu: number; timestamp: number; latestTime: string }>();
    
    filteredSnapshots.forEach((snap) => {
      const snapTime = new Date(snap.time);
      const snapMs = snapTime.getTime();
      let bucketStart: number;
      
      if (ccuInterval === "1m") {
        // Per-minute buckets: round down to start of minute
        bucketStart = Math.floor(snapMs / (60 * 1000)) * (60 * 1000);
      } else if (ccuInterval === "hourly") {
        // Hourly buckets: round down to start of hour
        bucketStart = Math.floor(snapMs / (60 * 60 * 1000)) * (60 * 60 * 1000);
      } else {
        // Daily buckets: round down to start of day in local timezone
        const localMidnight = new Date(snapTime);
        localMidnight.setHours(0, 0, 0, 0);
        bucketStart = localMidnight.getTime();
      }
      
      const existing = buckets.get(bucketStart);
      if (existing) {
        // Use latest CCU in the bucket
        if (snapMs > existing.timestamp) {
          existing.ccu = snap.ccu;
          existing.timestamp = snapMs;
          existing.latestTime = snap.time;
        }
      } else {
        buckets.set(bucketStart, { ccu: snap.ccu, timestamp: snapMs, latestTime: snap.time });
      }
    });
    
    // Convert to sorted array by bucket timestamp (ascending = oldest to newest)
    const sortedBuckets = Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]);
    
    // Format function for time labels in user's local timezone
    const formatTimeLabel = (bucketStart: number): string => {
      const date = new Date(bucketStart);
      
      if (ccuInterval === "1m") {
        // 1H + 1m: "2:05 PM" format in local time
        return new Intl.DateTimeFormat(undefined, { 
          hour: "numeric", 
          minute: "2-digit",
        }).format(date);
      } else if (ccuInterval === "hourly") {
        if (ccuRange === "24h") {
          // 24H + Hourly: "3 PM" format in local time
          return new Intl.DateTimeFormat(undefined, { 
            hour: "numeric",
          }).format(date);
        } else {
          // 7D + Hourly: "May 9 3 PM" format (with date context)
          return new Intl.DateTimeFormat(undefined, { 
            month: "short", 
            day: "numeric",
            hour: "numeric",
          }).format(date);
        }
      } else {
        // Daily (28D/90D): "May 9" format
        return new Intl.DateTimeFormat(undefined, { 
          month: "short", 
          day: "numeric" 
        }).format(date);
      }
    };
    
    const data = sortedBuckets.map(([bucketStart, bucket]) => ({
      time: new Date(bucketStart).toISOString(),
      timeLabel: formatTimeLabel(bucketStart),
      ccu: bucket.ccu,
      // Include original timestamp for tooltip
      capturedAt: bucket.latestTime,
    }));
    
    // Calculate stats
    const ccuValues = data.map((d) => d.ccu);
    const currentCcu = ccuValues.length > 0 ? ccuValues[ccuValues.length - 1] : null;
    const peakCcu = ccuValues.length > 0 ? Math.max(...ccuValues) : null;
    const avgCcu = ccuValues.length > 0 
      ? Math.round(ccuValues.reduce((sum, c) => sum + c, 0) / ccuValues.length) 
      : null;
    
    return { data, currentCcu, peakCcu, avgCcu };
  }, [rawCcuHistory, ccuRange, ccuInterval]);
  
  // Filter chart data based on selected range
  const { performanceCharts, ccuStats } = useMemo(() => {
    const now = new Date();
    const getHoursAgo = (range: PerformanceRange): number => {
      switch (range) {
        case "24h": return 24;
        case "72h": return 72;
        case "7d": return 168;
        case "28d": return 672;
        case "90d": return 2160;
        default: return 168;
      }
    };
    
    const cutoffTime = new Date(now.getTime() - getHoursAgo(chartRange) * 60 * 60 * 1000);
    
    // Filter CCU snapshots
    const filteredCcuSnapshots = rawCcuStats?.snapshots?.filter(
      (s) => new Date(s.time) >= cutoffTime
    ) ?? [];
    
    // Filter performance chart data
    const filterByDate = <T extends { date: string }>(data: T[] | undefined): T[] => {
      if (!data) return [];
      return data.filter((d) => new Date(d.date) >= cutoffTime);
    };
    
    return {
      performanceCharts: rawPerformanceCharts ? {
        ...rawPerformanceCharts,
        eventsOverTime: filterByDate(rawPerformanceCharts.eventsOverTime),
        playersOverTime: filterByDate(rawPerformanceCharts.playersOverTime),
        sessionsOverTime: filterByDate(rawPerformanceCharts.sessionsOverTime),
        purchasesOverTime: filterByDate(rawPerformanceCharts.purchasesOverTime),
      } : null,
      ccuStats: rawCcuStats ? {
        ...rawCcuStats,
        snapshots: filteredCcuSnapshots,
      } : null,
    };
  }, [rawPerformanceCharts, rawCcuStats, chartRange]);

  // Safe defaults
  const safeDataHealth = dataHealth ?? {
    hasTrackerEvents: false,
    trackerEventsCount: 0,
    hasRobloxApiData: false,
    missing: [],
  };

  const safeTrackerStats = trackerStats ?? {
    totalEvents: 0,
    uniquePlayers: 0,
    totalSessions: 0,
    avgSessionDuration: null,
    firstSeenPlayers: 0,
    returningPlayers: 0,
    hasHistoryBeforeRange: false,
    returningPlayersStatus: "needs_history" as const,
    rangeStart: new Date().toISOString(),
    rangeEnd: new Date().toISOString(),
    totalPurchases: 0,
  };

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
              <span>Failed to load analytics: {error}</span>
            </div>
            <Button onClick={handleSyncAndRefresh} variant="outline" className="mt-4">
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
          {/* Revenue mode toggle - affects monetization metrics across all pages */}
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
                  thumbnailUrl={game.icon_url}
                  robloxGameId={game.roblox_game_id}
                  size="md"
                />
                <div>
                  <h2 className="font-semibold text-foreground">{game.name}</h2>
                  <p className="text-sm text-muted-foreground">
                    {game.universe_id ? `Universe ID: ${game.universe_id}` : `Game ID: ${game.roblox_game_id}`}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {hasRobloxData && (
                  <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 border-blue-500/20">
                    Roblox API
                  </Badge>
                )}
                {hasTrackerData ? (
                  <Badge variant="secondary" className="bg-green-500/10 text-green-600 border-green-500/20">
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    Tracking active
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 border-amber-500/20">
                    <AlertCircle className="w-3 h-3 mr-1" />
                    Waiting for tracking script
                  </Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Data Status Banner */}
      {hasRobloxData && (
        <div className="flex items-center gap-2 text-sm text-green-600 bg-green-500/10 px-4 py-2 rounded-lg border border-green-500/20">
          <CheckCircle2 className="w-4 h-4" />
          Roblox data synced
        </div>
      )}

      {needsTrackingScript && (
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-amber-500/10 px-4 py-3 rounded-lg border border-amber-500/20">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5" />
            <p className="text-sm text-amber-700">
              Install the RoMonetize tracking script to unlock sessions, retention, purchases, and revenue.
            </p>
          </div>
          <Button variant="outline" size="sm" asChild className="w-fit">
            <Link href="/dashboard/game/tracking-setup">
              View Installation Guide
              <ExternalLink className="w-3 h-3 ml-2" />
            </Link>
          </Button>
        </div>
      )}

      {/* Roblox Game Stats */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground">Roblox Game Stats</h3>
          <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-[10px]">
            Roblox API
          </Badge>
        </div>
        {robloxStats ? (
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
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          <Card className="border-border/50">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-4 h-4 text-indigo-500" />
                <span className="text-xs text-muted-foreground">Tracked Actions</span>
              </div>
              {safeDataHealth.hasTrackerEvents ? (
                <div className="text-2xl font-bold text-foreground">
                  {formatNumber(safeDataHealth.trackerEventsCount || safeTrackerStats.totalEvents)}
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
                  {formatNumber(safeTrackerStats.uniquePlayers)}
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
                  {formatNumber(safeTrackerStats.totalSessions)}
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
                safeTrackerStats.avgSessionDuration !== null ? (
                  <div className="text-2xl font-bold text-foreground">
                    {formatDuration(safeTrackerStats.avgSessionDuration)}
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
                <span className="text-xs text-muted-foreground">First Seen</span>
              </div>
              {safeDataHealth.hasTrackerEvents ? (
                <div className="text-2xl font-bold text-foreground">
                  {formatNumber(safeTrackerStats.firstSeenPlayers)}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">Requires tracking script</div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2 mb-2">
                <UserCheck className="w-4 h-4 text-teal-500" />
                <span className="text-xs text-muted-foreground">Returning</span>
              </div>
              {!safeDataHealth.hasTrackerEvents ? (
                <div className="text-xs text-muted-foreground">Requires tracking script</div>
              ) : safeTrackerStats.returningPlayersStatus === "no_players" ? (
                <>
                  <div className="text-sm text-muted-foreground">No players yet</div>
                </>
              ) : safeTrackerStats.returningPlayersStatus === "no_returning_yet" ? (
                <>
                  <div className="text-2xl font-bold text-foreground">0</div>
                  <p className="text-[10px] text-muted-foreground mt-1">No returning players yet</p>
                </>
              ) : safeTrackerStats.returningPlayersStatus === "needs_history" ? (
                <>
                  <div className="text-sm text-muted-foreground">—</div>
                  <p className="text-[10px] text-muted-foreground mt-1">Needs more history</p>
                </>
              ) : (
                <div className="text-2xl font-bold text-foreground">
                  {formatNumber(safeTrackerStats.returningPlayers)}
                </div>
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
                    {formatNumber(safeTrackerStats.totalPurchases)}
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
      {(hasTrackerData || ccuStats?.snapshots?.length || processedCcuHistory.data.length > 0) && (
        <div className="space-y-6">
          {/* Live CCU History - Large 2-column chart with its own controls */}
          <Card className="border-border bg-card shadow-sm lg:col-span-2">
            <CardHeader className="pb-4">
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-lg font-semibold">Live CCU History</CardTitle>
                    <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-[10px]">
                      Roblox API
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">Concurrent players tracked from Roblox API snapshots</p>
                  
                  {/* CCU Summary Stats */}
                  {(processedCcuHistory.currentCcu !== null || processedCcuHistory.peakCcu !== null || processedCcuHistory.avgCcu !== null) && (
                    <div className="flex items-center gap-4 mt-3 text-sm">
                      {processedCcuHistory.currentCcu !== null && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-muted-foreground">Current:</span>
                          <span className="font-semibold text-sky-400">{processedCcuHistory.currentCcu.toLocaleString()}</span>
                        </div>
                      )}
                      {processedCcuHistory.peakCcu !== null && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-muted-foreground">Peak:</span>
                          <span className="font-semibold text-emerald-400">{processedCcuHistory.peakCcu.toLocaleString()}</span>
                        </div>
                      )}
                      {processedCcuHistory.avgCcu !== null && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-muted-foreground">Avg:</span>
                          <span className="font-semibold text-amber-400">{processedCcuHistory.avgCcu.toLocaleString()}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                
                {/* CCU Range and Interval Controls */}
                <div className="flex flex-wrap items-center gap-2">
                  {/* Range selector */}
                  <div className="flex items-center bg-secondary/50 dark:bg-secondary/80 rounded-lg p-0.5">
                    {(["1h", "24h", "7d", "28d", "90d"] as CCUHistoryRange[]).map((r) => (
                      <button
                        type="button"
                        key={r}
                        onClick={() => handleCcuRangeChange(r)}
                        className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                          ccuRange === r
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
                    {(["1m", "hourly", "daily"] as CCUHistoryInterval[]).map((i) => {
                      // 1m only for 1H, hourly for 1H/24H/7D, daily for all
                      const is1mDisabled = i === "1m" && !CCU_MINUTE_COMPATIBLE_RANGES.includes(ccuRange);
                      const isHourlyDisabled = i === "hourly" && !CCU_HOURLY_COMPATIBLE_RANGES.includes(ccuRange);
                      const isDisabled = is1mDisabled || isHourlyDisabled;
                      const label = i === "1m" ? "1m" : i === "hourly" ? "Hourly" : "Daily";
                      const disabledTitle = is1mDisabled 
                        ? "1m interval only available for 1H range" 
                        : isHourlyDisabled 
                          ? "Hourly interval not available for 28D/90D ranges"
                          : undefined;
                      return (
                        <button
                          type="button"
                          key={i}
                          onClick={() => !isDisabled && handleCcuIntervalChange(i)}
                          disabled={isDisabled}
                          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                            ccuInterval === i
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
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-[380px]">
                {processedCcuHistory.data.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={processedCcuHistory.data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="liveCcuGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#38BDF8" stopOpacity={0.4}/>
                          <stop offset="100%" stopColor="#38BDF8" stopOpacity={0.05}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid {...gridProps} />
                      <XAxis 
                        dataKey="timeLabel"
                        {...axisProps}
                        interval="preserveStartEnd"
                        minTickGap={40}
                      />
                      <YAxis 
                        domain={[0, (dataMax: number) => Math.max(Math.ceil(dataMax * 1.2), 10)]}
                        allowDecimals={false}
                        {...axisProps}
                      />
                      <Tooltip
                        {...tooltipStyle}
                        formatter={(value: number | null) => [value !== null ? value.toLocaleString() : "—", "CCU"]}
                        labelFormatter={(label, payload) => {
                          // Show exact captured time in user's local timezone
                          const dataPoint = payload?.[0]?.payload;
                          if (dataPoint?.capturedAt) {
                            return new Intl.DateTimeFormat(undefined, {
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            }).format(new Date(dataPoint.capturedAt));
                          }
                          return `${label}`;
                        }}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="ccu" 
                        stroke="#38BDF8"
                        strokeWidth={3}
                        fill="url(#liveCcuGradient)"
                        dot={processedCcuHistory.data.length <= 48 ? { r: 3, fill: "#38BDF8", strokeWidth: 0 } : false}
                        activeDot={{ r: 6, fill: "#38BDF8", strokeWidth: 2, stroke: "#0a0a0a" }}
                        connectNulls
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center">
                    <Activity className="w-10 h-10 mb-3 text-muted-foreground" />
                    <h4 className="font-medium text-foreground mb-2">No CCU history yet</h4>
                    <p className="text-sm text-muted-foreground max-w-md">
                      Refresh Roblox data to start collecting CCU snapshots. History will build up over time as more snapshots are recorded.
                    </p>
                    <Button onClick={handleSyncAndRefresh} variant="outline" size="sm" className="mt-4">
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Refresh Data
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
          
          {/* Other Performance Charts Header */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <h3 className="text-lg font-semibold text-foreground">Performance Charts</h3>
            <RangeControls
              value={chartRange as ChartDateRange}
              onChange={(r) => setChartRange(r as PerformanceRange)}
              ranges={["24h", "72h", "7d", "28d", "90d"]}
            />
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Activity Over Time */}
            <ChartCard
              title="Activity Over Time"
              subtitle="All tracked actions from your game"
              source="tracker"
              summary={performanceCharts?.eventsOverTime?.length ? `Total: ${performanceCharts.eventsOverTime.reduce((sum, d) => sum + (d.events ?? 0), 0).toLocaleString()}` : undefined}
              isEmpty={!performanceCharts?.eventsOverTime?.length}
              emptyTitle="No tracking data yet"
              emptyMessage="Activity will appear after players interact with your game."
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={performanceCharts?.eventsOverTime ?? []} margin={{ top: 20, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="eventsGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART_COLORS.violet} stopOpacity={1}/>
                      <stop offset="100%" stopColor={CHART_COLORS.violet} stopOpacity={0.7}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...gridProps} />
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={(v) => formatChartTime(v, toChartTimeRange(chartRange))}
                    {...axisProps}
                  />
                  <YAxis 
                    allowDecimals={false}
                    {...axisProps}
                  />
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(value: number) => [value.toLocaleString(), "Actions"]}
                    labelFormatter={(label) => formatChartTime(label, toChartTimeRange(chartRange))}
                  />
                  <Bar 
                    dataKey="events" 
                    fill="url(#eventsGradient)"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={50}
                  >
                    {(performanceCharts?.eventsOverTime?.length ?? 0) <= 3 && (
                      <LabelList dataKey="events" position="top" fill={chartTheme.label} fontSize={12} fontWeight={600} />
                    )}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* Players Over Time */}
            <ChartCard
              title="Player Joins Over Time"
              subtitle="Unique players who joined sessions"
              source="tracker"
              summary={performanceCharts?.playersOverTime?.length ? `Total: ${performanceCharts.playersOverTime.reduce((sum, d) => sum + (d.players ?? 0), 0).toLocaleString()}` : undefined}
              isEmpty={!performanceCharts?.playersOverTime?.length}
              emptyTitle="No player data yet"
              emptyMessage="Player joins will appear after players start sessions in your game."
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={performanceCharts?.playersOverTime ?? []} margin={{ top: 20, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="playersGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART_COLORS.cyan} stopOpacity={1}/>
                      <stop offset="100%" stopColor={CHART_COLORS.cyan} stopOpacity={0.7}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...gridProps} />
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={(v) => formatChartTime(v, toChartTimeRange(chartRange))}
                    {...axisProps}
                  />
                  <YAxis 
                    allowDecimals={false}
                    {...axisProps}
                  />
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(value: number) => [value.toLocaleString(), "Players"]}
                    labelFormatter={(label) => formatChartTime(label, toChartTimeRange(chartRange))}
                  />
                  <Bar 
                    dataKey="players" 
                    fill="url(#playersGradient)"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={50}
                  >
                    {(performanceCharts?.playersOverTime?.length ?? 0) <= 3 && (
                      <LabelList dataKey="players" position="top" fill={chartTheme.label} fontSize={12} fontWeight={600} />
                    )}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* Purchases Over Time - Locked for free users */}
            {monetizationLocked ? (
              <ChartCard
                title="Purchases Over Time"
                subtitle="Upgrade to Pro to unlock purchase analytics"
                source="tracker"
                isEmpty={true}
                emptyTitle="Locked"
                emptyMessage="Upgrade to Pro to unlock purchase analytics"
                isLocked={true}
              >
                <div />
              </ChartCard>
            ) : (
              <ChartCard
                title="Purchases Over Time"
                subtitle="Successful product purchases"
                source="tracker"
                summary={performanceCharts?.purchasesOverTime?.length ? `Total: ${performanceCharts.purchasesOverTime.reduce((sum, d) => sum + (d.purchases ?? 0), 0).toLocaleString()}` : undefined}
                isEmpty={!performanceCharts?.purchasesOverTime?.length}
                emptyTitle="No purchases yet"
                emptyMessage="Purchases will appear after players make purchases in your game."
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={performanceCharts?.purchasesOverTime ?? []} margin={{ top: 20, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="purchasesBarGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={CHART_COLORS.green} stopOpacity={1}/>
                        <stop offset="100%" stopColor={CHART_COLORS.green} stopOpacity={0.7}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid {...gridProps} />
                    <XAxis 
                      dataKey="date" 
                      tickFormatter={(v) => formatChartTime(v, toChartTimeRange(chartRange))}
                      {...axisProps}
                    />
                    <YAxis 
                      allowDecimals={false}
                      {...axisProps}
                    />
                    <Tooltip
                      {...tooltipStyle}
                      formatter={(value: number) => [value.toLocaleString(), "Purchases"]}
                      labelFormatter={(label) => formatChartTime(label, toChartTimeRange(chartRange))}
                    />
                    <Bar 
                      dataKey="purchases" 
                      fill="url(#purchasesBarGradient)"
                      radius={[6, 6, 0, 0]}
                      maxBarSize={50}
                    >
                      {(performanceCharts?.purchasesOverTime?.length ?? 0) <= 3 && (
                        <LabelList dataKey="purchases" position="top" fill={chartTheme.label} fontSize={12} fontWeight={600} />
                      )}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            )}
          </div>
        </div>
      )}

      {/* Empty state for charts when no tracker data and no CCU data */}
      {!hasTrackerData && !ccuStats?.snapshots?.length && processedCcuHistory.data.length === 0 && (
        <Card className="border-border bg-card shadow-sm">
          <CardContent className="pt-6 pb-6">
            <div className="text-center">
              <TrendingUp className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
              <h4 className="font-medium text-foreground mb-2">Charts require tracking data</h4>
              <p className="text-sm text-muted-foreground mb-4">
                Install the RoMonetize tracking script to see activity, players, and purchase charts.
              </p>
              <Button variant="outline" asChild>
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
