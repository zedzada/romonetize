"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAnalytics, formatChartTime, type CCUHistoryRange } from "@/hooks/use-analytics";
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



export default function PerformancePage() {
  const [chartRange, setChartRange] = useState<PerformanceRange>("7d");
  
  // Theme-aware chart colors
  const chartTheme = useChartTheme();
  const axisProps = getChartAxisProps(chartTheme);
  const gridProps = getChartGridProps(chartTheme);
  const tooltipStyle = getChartTooltipStyle(chartTheme);
  
  // CCU History chart controls (independent of other charts)
  const [ccuRange, setCcuRange] = useState<CCUHistoryRange>("24h");
  
  // Manual cron trigger state (debug mode only)
  const [isRunningCron, setIsRunningCron] = useState(false);
  const [cronResult, setCronResult] = useState<{ ok: boolean; message: string } | null>(null);
  
  // Cron status from /api/cron/status (debug mode only)
  const [cronStatus, setCronStatus] = useState<{
    vercelCronRowsLast10Minutes: number;
    robloxApiRowsLast10Minutes: number;
    latestCronSnapshotAt: string | null;
    cronConfigured: boolean;
  } | null>(null);
  
  // Heartbeat debug info from /api/heartbeat/debug (debug mode only)
  const [heartbeatDebug, setHeartbeatDebug] = useState<{
    selectedGameId: string | null;
    selectedGameName: string | null;
    activeServerHeartbeats: number;
    latestHeartbeatAt: string | null;
    minutesSinceLatestHeartbeat: number | null;
    latest10Heartbeats: Array<{ server_id: string; ccu: number; last_seen_at: string }>;
    latest10CcuSnapshots: Array<{ ccu: number; created_at: string; source: string }>;
  } | null>(null);
  
  // Handle CCU range change - simple, no interval logic
  const handleCcuRangeChange = useCallback((newRange: CCUHistoryRange) => {
    setCcuRange(newRange);
  }, []);
  
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
    selectedGameId,
    selectedGameName,
    debugInfo: analyticsDebugInfo,
  } = useAnalytics({ 
    enabled: true, 
    range: toAnalyticsRange(chartRange),
  });
  
  // Debug mode - show when ?debug=true in URL (check via useEffect to avoid SSR issues)
  const [isDebugMode, setIsDebugMode] = useState(false);
  useEffect(() => {
    // Check URL params client-side only
    const params = new URLSearchParams(window.location.search);
    const debugEnabled = params.get("debug") === "true";
    setIsDebugMode(debugEnabled);
    
    // Fetch cron status when debug mode is enabled
    if (debugEnabled) {
      fetch("/api/cron/status")
        .then(res => res.json())
        .then(data => {
          setCronStatus({
            vercelCronRowsLast10Minutes: data.vercelCronRowsLast10Minutes ?? 0,
            robloxApiRowsLast10Minutes: data.robloxApiRowsLast10Minutes ?? 0,
            latestCronSnapshotAt: data.latestCronSnapshotAt ?? null,
            cronConfigured: data.cronConfigured ?? false,
          });
        })
        .catch(() => {
          // Silently fail - cron status is optional debug info
        });
        
      // Fetch heartbeat debug info
      fetch("/api/heartbeat/debug")
        .then(res => res.json())
        .then(data => {
          setHeartbeatDebug(data);
        })
        .catch(() => {
          // Silently fail - heartbeat debug is optional
        });
    }
  }, []);
  
  // Auto-polling for CCU snapshots (every 60 seconds while page is open)
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [lastPollTime, setLastPollTime] = useState<Date | null>(null);
  const [pollCount, setPollCount] = useState(0);
  
  // Sync Roblox data and then refresh analytics
  const [isSyncing, setIsSyncing] = useState(false);
  
const handleSyncAndRefresh = useCallback(async () => {
    setIsSyncing(true);
    try {
      // Call the full Roblox sync endpoint (stores CCU, visits, favorites, likes, dislikes)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s for full sync
      
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
      
      // Refresh analytics data to pick up the new sync
      await refresh();
      setLastPollTime(new Date());
      setPollCount((c) => c + 1);
    } catch (err) {
      // Ignore abort errors, log others
      if (err instanceof Error && err.name !== "AbortError") {
        console.error("Failed to sync and refresh", err);
      }
    } finally {
      setIsSyncing(false);
    }
  }, [refresh]);
  
  // Manual cron trigger for debug mode
  const handleRunCron = useCallback(async () => {
    setIsRunningCron(true);
    setCronResult(null);
    try {
      const response = await fetch("/api/cron/collect-ccu", {
        method: "GET",
        headers: {
          // In dev, the cron endpoint allows requests without auth
          // In prod, this will fail unless user has CRON_SECRET - that's expected
        },
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setCronResult({ 
          ok: true, 
          message: `Synced ${data.inserted}/${data.gamesProcessed} games (${data.usersProcessed} users)` 
        });
        // Refresh analytics to pick up new snapshots
        await refresh();
      } else {
        setCronResult({ 
          ok: false, 
          message: data.error || `HTTP ${response.status}` 
        });
      }
    } catch (err) {
      setCronResult({ 
        ok: false, 
        message: err instanceof Error ? err.message : "Network error" 
      });
    } finally {
      setIsRunningCron(false);
    }
  }, [refresh]);
  
  // Auto-polling: Every 60 seconds, sync CCU in background (non-blocking)
  // Key principles:
  // 1. NEVER await sync on page mount - render cached data immediately
  // 2. Background sync fires and forgets - doesn't block UI
  // 3. useAnalytics auto-refreshes every 60s to pick up new data
  // 4. Only poll when tab is visible
  useEffect(() => {
    let isMounted = true;
    
    // Non-blocking background sync - fire and forget
    const doBackgroundSync = () => {
      if (!isMounted) return;
      
      // Fire sync without awaiting - don't block anything
      fetch("/api/roblox/sync-all-ccu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }).then(() => {
        if (isMounted) {
          setLastPollTime(new Date());
          setPollCount((c) => c + 1);
        }
      }).catch(() => {
        // Silently ignore sync failures - useAnalytics will still refresh
      });
    };
    
    // Start polling interval - only when visible
    const startPolling = () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
      
      // Poll every 60 seconds (background sync, non-blocking)
      pollingIntervalRef.current = setInterval(() => {
        if (document.visibilityState === "visible") {
          doBackgroundSync();
        }
      }, 60 * 1000);
    };
    
    // Handle visibility change
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        // Tab visible - trigger background sync and restart interval
        doBackgroundSync();
        startPolling();
      } else {
        // Tab hidden - stop polling
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
      }
    };
    
    // Handle game change
    const handleGameChange = () => {
      setPollCount(0);
      setLastPollTime(null);
    };
    
    // Initial setup - DO NOT sync on mount, just start polling
    // The useAnalytics hook will fetch cached data immediately
    setPollCount(0);
    setLastPollTime(null);
    startPolling();
    
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("selected-game-changed", handleGameChange);
    
    return () => {
      isMounted = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("selected-game-changed", handleGameChange);
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [selectedGameId]);
  
  // Process CCU history with aggregation by interval:
  // 1H = group by minute (~60 points max)
  // 24H = group by hour (~24 points max)
  // 7D/28D/90D = group by day
  const processedCcuHistory = useMemo(() => {
    const now = new Date();
    
    // Calculate cutoff time and bucket size based on selected range
    const getRangeConfig = (range: CCUHistoryRange): { rangeMs: number; bucketMs: number; bucketType: "minute" | "hour" | "day" } => {
      switch (range) {
        case "1h": return { rangeMs: 60 * 60 * 1000, bucketMs: 60 * 1000, bucketType: "minute" };
        case "24h": return { rangeMs: 24 * 60 * 60 * 1000, bucketMs: 60 * 60 * 1000, bucketType: "hour" };
        case "7d": return { rangeMs: 7 * 24 * 60 * 60 * 1000, bucketMs: 24 * 60 * 60 * 1000, bucketType: "day" };
        case "28d": return { rangeMs: 28 * 24 * 60 * 60 * 1000, bucketMs: 24 * 60 * 60 * 1000, bucketType: "day" };
        case "90d": return { rangeMs: 90 * 24 * 60 * 60 * 1000, bucketMs: 24 * 60 * 60 * 1000, bucketType: "day" };
        default: return { rangeMs: 24 * 60 * 60 * 1000, bucketMs: 60 * 60 * 1000, bucketType: "hour" };
      }
    };
    
    const { rangeMs, bucketMs, bucketType } = getRangeConfig(ccuRange);
    const cutoffTime = new Date(now.getTime() - rangeMs);
    
  // Empty data case
    if (!rawCcuHistory?.rawSnapshots?.length) {
      return {
        data: [],
        currentCcu: rawCcuHistory?.currentCcu ?? null,
        peakCcu: null,
        avgCcu: null,
        snapshotCount: 0,
        dominantSource: rawCcuHistory?.source ?? "none",
      };
    }
    
    // Filter snapshots by range
    const filteredSnapshots = rawCcuHistory.rawSnapshots
      .filter(s => s.time && typeof s.ccu === "number")
      .filter(s => new Date(s.time).getTime() >= cutoffTime.getTime());
    
    // Get bucket start for a given timestamp
    const getBucketStart = (timestamp: number): number => {
      const date = new Date(timestamp);
      if (bucketType === "minute") {
        date.setSeconds(0, 0);
      } else if (bucketType === "hour") {
        date.setMinutes(0, 0, 0);
      } else { // day
        date.setHours(0, 0, 0, 0);
      }
      return date.getTime();
    };
    
    // Aggregate into buckets - keep latest snapshot per bucket
    const buckets = new Map<number, { ccu: number; snapshotsCount: number; latestTimestamp: number }>();
    
    filteredSnapshots.forEach(snap => {
      const snapTimestamp = new Date(snap.time).getTime();
      const bucketStart = getBucketStart(snapTimestamp);
      
      const existing = buckets.get(bucketStart);
      if (existing) {
        existing.snapshotsCount++;
        // Use latest snapshot in bucket
        if (snapTimestamp > existing.latestTimestamp) {
          existing.ccu = snap.ccu;
          existing.latestTimestamp = snapTimestamp;
        }
      } else {
        buckets.set(bucketStart, {
          ccu: snap.ccu,
          snapshotsCount: 1,
          latestTimestamp: snapTimestamp,
        });
      }
    });
    
    // Format tooltip label - always shows full date/time
    const formatTooltipLabel = (bucketStart: number): string => {
      const date = new Date(bucketStart);
      if (bucketType === "day") {
        return new Intl.DateTimeFormat(undefined, { 
          weekday: "short",
          day: "numeric",
          month: "short",
        }).format(date);
      }
      return new Intl.DateTimeFormat(undefined, { 
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
    };
    
    // Format X-axis label based on bucket type
    const formatLabel = (bucketStart: number): string => {
      const date = new Date(bucketStart);
      if (bucketType === "minute" || bucketType === "hour") {
        return new Intl.DateTimeFormat(undefined, { 
          hour: "2-digit", 
          minute: "2-digit",
        }).format(date);
      }
      // For day buckets, show date
      return new Intl.DateTimeFormat(undefined, { 
        day: "numeric",
        month: "short",
      }).format(date);
    };
    
    // Convert buckets to sorted array
    const sortedBuckets = Array.from(buckets.entries())
      .sort((a, b) => a[0] - b[0]);
    
    const data = sortedBuckets.map(([bucketStart, bucket]) => ({
      bucketStart,
      label: formatLabel(bucketStart),
      tooltipLabel: formatTooltipLabel(bucketStart),
      ccu: bucket.ccu,
      snapshotsCount: bucket.snapshotsCount,
    }));
    
    // Calculate stats
    const ccuValues = data.map(d => d.ccu);
    const currentCcu = ccuValues.length > 0 ? ccuValues[ccuValues.length - 1] : null;
    const peakCcu = ccuValues.length > 0 ? Math.max(...ccuValues) : null;
    const avgCcu = ccuValues.length > 0 
      ? Math.round(ccuValues.reduce((sum, c) => sum + c, 0) / ccuValues.length) 
      : null;
    
    // Determine dominant source from filtered snapshots
    // Priority: romonetize_tracker > vercel_cron/roblox_api > roblox_game_syncs
    const sourceCounts = new Map<string, number>();
    filteredSnapshots.forEach(snap => {
      const src = snap.source || "unknown";
      sourceCounts.set(src, (sourceCounts.get(src) || 0) + 1);
    });
    const hasTrackerSource = sourceCounts.has("romonetize_tracker");
    const dominantSource: string = hasTrackerSource
      ? "romonetize_tracker"
      : rawCcuHistory?.source === "roblox_game_syncs"
        ? "roblox_game_syncs"
        : sourceCounts.size > 0
          ? Array.from(sourceCounts.entries()).sort((a, b) => b[1] - a[1])[0][0]
          : "none";
    
    return { data, currentCcu, peakCcu, avgCcu, snapshotCount: data.length, dominantSource };
  }, [rawCcuHistory, ccuRange]);
  
  // Filter chart data based on selected range and fill missing buckets up to NOW
  const { performanceCharts, ccuStats, chartDebugInfo } = useMemo(() => {
    const now = new Date();
    const rangeEnd = now; // Always use current time as range end
    
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
    
    const rangeHours = getHoursAgo(chartRange);
    const rangeMs = rangeHours * 60 * 60 * 1000;
    const rangeStart = new Date(rangeEnd.getTime() - rangeMs);
    
    // Determine bucket interval based on range
    // 24h/72h = hourly, 7d+ = daily
    const isHourly = chartRange === "24h" || chartRange === "72h";
    const bucketMs = isHourly ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    
    // Generate all bucket timestamps from rangeStart to rangeEnd (now), including current hour
    const generateBuckets = (): number[] => {
      const buckets: number[] = [];
      // Round rangeStart down to bucket boundary
      let bucketTime: number;
      if (isHourly) {
        bucketTime = Math.floor(rangeStart.getTime() / bucketMs) * bucketMs;
      } else {
        // For daily, use local midnight
        const startDay = new Date(rangeStart);
        startDay.setHours(0, 0, 0, 0);
        bucketTime = startDay.getTime();
      }
      
      // Include the current bucket (bucket containing rangeEnd/now)
      const endBucketTime = isHourly 
        ? Math.floor(rangeEnd.getTime() / bucketMs) * bucketMs
        : (() => { const d = new Date(rangeEnd); d.setHours(0, 0, 0, 0); return d.getTime(); })();
      
      while (bucketTime <= endBucketTime) {
        buckets.push(bucketTime);
        bucketTime += bucketMs;
      }
      return buckets;
    };
    
    const allBuckets = generateBuckets();
    
    // Fill missing buckets for chart data - buckets with no data get value 0
    const fillBuckets = <T extends { date: string }>(
      data: T[] | undefined,
      valueKey: string,
      defaultValue: number = 0
    ): T[] => {
      if (!data) return [];
      
      // Create a map of existing data by bucket timestamp
      const dataMap = new Map<number, T>();
      data.forEach((d) => {
        // Parse the API bucket key - could be ISO string or partial ISO
        // API formats: "2024-01-15T12:00" (hourly), "2024-01-15" (daily)
        let dateMs: number;
        if (d.date.length === 10) {
          // Daily: "2024-01-15" - treat as local midnight
          const [year, month, day] = d.date.split("-").map(Number);
          const localDate = new Date(year, month - 1, day, 0, 0, 0, 0);
          dateMs = localDate.getTime();
        } else if (d.date.includes("T") && d.date.length <= 16) {
          // Hourly: "2024-01-15T12:00" - parse as UTC then round to hour
          dateMs = new Date(d.date + ":00.000Z").getTime();
        } else {
          // Full ISO string
          dateMs = new Date(d.date).getTime();
        }
        
        // Round to bucket boundary
        let bucketKey: number;
        if (isHourly) {
          bucketKey = Math.floor(dateMs / bucketMs) * bucketMs;
        } else {
          const day = new Date(dateMs);
          day.setHours(0, 0, 0, 0);
          bucketKey = day.getTime();
        }
        
        // Accumulate values for same bucket (sum, not replace)
        const existing = dataMap.get(bucketKey);
        if (existing) {
          const existingValue = (existing as Record<string, unknown>)[valueKey] as number || 0;
          const newValue = (d as Record<string, unknown>)[valueKey] as number || 0;
          (existing as Record<string, unknown>)[valueKey] = existingValue + newValue;
        } else {
          dataMap.set(bucketKey, { ...d });
        }
      });
      
      // Fill all buckets from rangeStart to now
      return allBuckets.map((bucketTimestamp) => {
        const existing = dataMap.get(bucketTimestamp);
        if (existing) return existing;
        
        // Create empty bucket with value 0
        return {
          date: new Date(bucketTimestamp).toISOString(),
          [valueKey]: defaultValue,
        } as T;
      });
    };
    
    // Filter CCU snapshots
    const filteredCcuSnapshots = rawCcuStats?.snapshots?.filter(
      (s) => new Date(s.time) >= rangeStart
    ) ?? [];
    
    // Build debug info for development
    const eventsData = rawPerformanceCharts?.eventsOverTime || [];
    const filledEvents = fillBuckets(eventsData, "events");
    
    const debugInfo = {
      chartName: "eventsOverTime",
      rangeStart: rangeStart.toISOString(),
      rangeEnd: rangeEnd.toISOString(),
      rawEventsCount: eventsData.length,
      firstEventAt: eventsData[0]?.date || null,
      lastEventAt: eventsData[eventsData.length - 1]?.date || null,
      bucketCount: allBuckets.length,
      firstBucket: allBuckets[0] ? new Date(allBuckets[0]).toISOString() : null,
      lastBucket: allBuckets[allBuckets.length - 1] ? new Date(allBuckets[allBuckets.length - 1]).toISOString() : null,
      lastThreeBuckets: allBuckets.slice(-3).map(b => ({
        timestamp: new Date(b).toISOString(),
        hasData: eventsData.some(e => {
          const eMs = new Date(e.date).getTime();
          return Math.floor(eMs / bucketMs) * bucketMs === b;
        }),
      })),
      filledBucketCount: filledEvents.length,
      lastThreeFilledBuckets: filledEvents.slice(-3),
    };
    
    return {
      performanceCharts: rawPerformanceCharts ? {
        ...rawPerformanceCharts,
        eventsOverTime: filledEvents,
        playersOverTime: fillBuckets(rawPerformanceCharts.playersOverTime, "players"),
        sessionsOverTime: fillBuckets(rawPerformanceCharts.sessionsOverTime, "sessions"),
        purchasesOverTime: fillBuckets(rawPerformanceCharts.purchasesOverTime, "purchases"),
      } : null,
      ccuStats: rawCcuStats ? {
        ...rawCcuStats,
        snapshots: filteredCcuSnapshots,
      } : null,
      chartDebugInfo: debugInfo,
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
    newPlayers: 0,
    firstSeenPlayers: 0, // Legacy alias
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
                  thumbnailUrl={(game as Record<string, unknown>).icon_url as string | undefined}
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
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
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
              <span className="text-xs text-muted-foreground">New Players</span>
            </div>
            {safeDataHealth.hasTrackerEvents ? (
              <div className="text-2xl font-bold text-foreground">
                {formatNumber(safeTrackerStats.newPlayers)}
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
                    <Badge variant="secondary" className={`${
                      processedCcuHistory.dominantSource === "romonetize_tracker"
                        ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                        : "bg-blue-500/10 text-blue-600 border-blue-500/20"
                    } text-[10px]`}>
                      {processedCcuHistory.dominantSource === "romonetize_tracker"
                        ? "RoMonetize Tracker"
                        : "Roblox API"}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {processedCcuHistory.dominantSource === "romonetize_tracker"
                      ? "Concurrent players tracked from in-game tracker heartbeats"
                      : "Concurrent players tracked from Roblox API snapshots"}
                  </p>
                  
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
                  
                  </div>
              </div>
            </CardHeader>
            
            {/* Dev Debug Block - only shown with ?debug=true */}
            {isDebugMode && (
              <div className="mx-6 mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs font-mono">
                <div className="font-semibold text-amber-500 mb-2">Game Switching &amp; Cache Debug</div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 text-muted-foreground">
                  {/* Game identity & cache validation */}
                  <div className="col-span-full text-amber-400">Game Identity (must match):</div>
                  <div>selectedGameId: <span className={`text-foreground ${selectedGameId !== analyticsDebugInfo?.responseSelectedGameId ? "text-red-400" : ""}`}>{selectedGameId?.slice(0, 8) || "none"}...</span></div>
                  <div>responseGameId: <span className={`text-foreground ${selectedGameId !== analyticsDebugInfo?.responseSelectedGameId ? "text-red-400" : ""}`}>{analyticsDebugInfo?.responseSelectedGameId?.slice(0, 8) || "none"}...</span></div>
                  <div>gameName: <span className="text-foreground">{analyticsDebugInfo?.selectedGameName?.slice(0, 20) || game?.name?.slice(0, 20) || "none"}</span></div>
                  <div>isStale: <span className={analyticsDebugInfo?.isResponseStale ? "text-red-400" : "text-green-400"}>{analyticsDebugInfo?.isResponseStale ? "YES" : "no"}</span></div>
                  
                  {/* SWR Cache state */}
                  <div className="col-span-full mt-2 pt-2 border-t border-amber-500/20">
                    <span className="text-amber-400">SWR Cache State:</span>
                  </div>
                  <div>swrKey: <span className="text-foreground text-[10px]">{analyticsDebugInfo?.swrKey?.slice(0, 40) || "null"}...</span></div>
                  <div>isLoading: <span className={isLoading ? "text-yellow-400" : "text-green-400"}>{isLoading ? "YES" : "no"}</span></div>
                  <div>isPending: <span className={analyticsDebugInfo?.isPendingGameChange ? "text-yellow-400" : "text-green-400"}>{analyticsDebugInfo?.isPendingGameChange ? "YES" : "no"}</span></div>
                  <div>lastFetchAt: <span className="text-foreground">{analyticsDebugInfo?.lastFetchAt ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(analyticsDebugInfo.lastFetchAt)) : "none"}</span></div>
                  
                  {/* CCU snapshots (from Roblox API / cron) */}
                  <div className="col-span-full mt-2 pt-2 border-t border-amber-500/20">
                    <span className="text-amber-400">CCU Snapshots:</span>
                  </div>
                  <div>currentCcuFromApi: <span className="text-foreground">{robloxStats?.ccu ?? "null"}</span></div>
                  <div>snapshotsCount: <span className="text-foreground">{rawCcuHistory?.rawSnapshots?.length ?? 0}</span></div>
                  <div>chartRange: <span className="text-foreground">{ccuRange}</span></div>
                  <div>chartDataLength: <span className="text-foreground">{processedCcuHistory.data.length}</span></div>
                  {rawCcuHistory?.rawSnapshots?.length ? (
                    <>
                      <div>oldestSnapshot: <span className="text-foreground">
                        {new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(rawCcuHistory.rawSnapshots[0].time))}
                      </span></div>
                      <div>latestSnapshot: <span className="text-foreground">
                        {new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(rawCcuHistory.rawSnapshots[rawCcuHistory.rawSnapshots.length - 1].time))}
                      </span></div>
                    </>
                  ) : null}
                  
                  {/* Tracker events - KEY DIAGNOSTIC for tracker detection regression */}
                  <div className="col-span-full mt-2 pt-2 border-t border-amber-500/20">
                    <span className="text-amber-400">Tracker Status (KEY):</span>
                  </div>
                  <div>hasTrackerEvents: <span className={analyticsDebugInfo?.hasTrackerEvents ? "text-green-400" : "text-red-400"}>{analyticsDebugInfo?.hasTrackerEvents ? "YES" : "NO"}</span></div>
                  <div>eventsCount: <span className="text-foreground">{analyticsDebugInfo?.trackerEventsCount ?? 0}</span></div>
                  <div>hasTrackerData: <span className={hasTrackerData ? "text-green-400" : "text-red-400"}>{hasTrackerData ? "YES" : "NO"}</span></div>
                  <div>needsTracking: <span className={needsTrackingScript ? "text-red-400" : "text-green-400"}>{needsTrackingScript ? "YES" : "no"}</span></div>
                  <div>missing: <span className="text-foreground text-[10px]">{JSON.stringify(analyticsDebugInfo?.missingFlags ?? [])}</span></div>
                  <div>uniquePlayers: <span className="text-foreground">{safeTrackerStats.uniquePlayers || 0}</span></div>
                  <div>latestEventAt: <span className="text-foreground">{analyticsDebugInfo?.lastTrackerEventAt ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(analyticsDebugInfo.lastTrackerEventAt)) : "none"}</span></div>
                  
                  {/* Snapshot Diagnostics - KEY for debugging gaps */}
                  <div className="col-span-full mt-2 pt-2 border-t border-amber-500/20">
                    <span className="text-amber-400">Snapshot Diagnostics (15 min window):</span>
                  </div>
                  <div>now: <span className="text-foreground">{rawCcuHistory?.cronStatus?.now ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(String(rawCcuHistory.cronStatus.now))) : "—"}</span></div>
                  <div>latestSnapshotAt: <span className="text-foreground">{rawCcuHistory?.cronStatus?.latestSnapshotAt ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(String(rawCcuHistory.cronStatus.latestSnapshotAt))) : "none"}</span></div>
                  <div>minutesSinceLatest: <span className={Number(rawCcuHistory?.cronStatus?.minutesSinceLatestSnapshot) > 2 ? "text-yellow-400" : "text-green-400"}>{rawCcuHistory?.cronStatus?.minutesSinceLatestSnapshot ?? "—"}</span></div>
                  <div>snapshotsLast15Min: <span className={Number(rawCcuHistory?.cronStatus?.snapshotsLast15Minutes) >= 10 ? "text-green-400" : "text-yellow-400"}>{rawCcuHistory?.cronStatus?.snapshotsLast15Minutes ?? 0} / {rawCcuHistory?.cronStatus?.expectedSnapshotsLast15Minutes ?? "—"}</span></div>
                  
                  {/* Cron Status */}
                  <div className="col-span-full mt-2 pt-2 border-t border-amber-500/20">
                    <span className="text-amber-400">Vercel Cron ({rawCcuHistory?.cronStatus?.cronInterval || "5m"}):</span>
                  </div>
                  <div>cronConfigured: <span className={rawCcuHistory?.cronStatus?.cronConfigured ? "text-green-400" : "text-red-400"}>{rawCcuHistory?.cronStatus?.cronConfigured ? "YES" : "NO"}</span></div>
                  <div>cronRunsLast15Min: <span className="text-foreground">{rawCcuHistory?.cronStatus?.cronRunsLast15Minutes ?? 0}</span></div>
                  <div>latestCronRun: <span className="text-foreground">{(() => {
                    const run = rawCcuHistory?.cronStatus?.latestCronRun as { started_at?: string; ok?: boolean; snapshots_inserted?: number } | null;
                    if (!run?.started_at) return "none";
                    return `${new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(run.started_at))} (${run.ok ? "ok" : "fail"}, ${run.snapshots_inserted ?? 0} inserted)`;
                  })()}</span></div>
                  <div>latestCronSnapshot: <span className="text-foreground">{rawCcuHistory?.cronStatus?.latestCronSnapshotAt ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(String(rawCcuHistory.cronStatus.latestCronSnapshotAt))) : "none"}</span></div>
                  
                  {/* Browser Polling status */}
                  <div className="col-span-full mt-2 pt-2 border-t border-amber-500/20">
                    <span className="text-amber-400">Browser Polling ({rawCcuHistory?.cronStatus?.browserPollInterval || "60s"}):</span>
                  </div>
                  <div>lastBrowserPollAt: <span className="text-foreground">{lastPollTime ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(lastPollTime) : "none"}</span></div>
                  <div>pollCount: <span className="text-foreground">{pollCount}</span></div>
                  <div>latestBrowserSnapshot: <span className="text-foreground">{rawCcuHistory?.cronStatus?.latestBrowserSnapshotAt ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(String(rawCcuHistory.cronStatus.latestBrowserSnapshotAt))) : "none"}</span></div>
                </div>
                
                {/* Manual Cron Trigger Button */}
                <div className="mt-3 pt-3 border-t border-amber-500/20 flex items-center gap-3">
                  <button
                    onClick={handleRunCron}
                    disabled={isRunningCron}
                    className="px-3 py-1.5 text-xs font-medium bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 rounded-md text-amber-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isRunningCron ? "Running..." : "Run CCU Cron Now"}
                  </button>
                  {cronResult && (
                    <span className={`text-xs ${cronResult.ok ? "text-green-400" : "text-red-400"}`}>
                      {cronResult.message}
                    </span>
                  )}
                </div>
              </div>
            )}
            
            <CardContent>
              {/* Cron Status Debug - only shown with ?debug=true */}
              {isDebugMode && cronStatus && (
                <div className="mb-3 p-3 bg-purple-500/10 border border-purple-500/30 rounded-lg text-xs font-mono">
                  <div className="font-semibold text-purple-500 mb-2">Cron Status (/api/cron/status)</div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-muted-foreground">
                    <div>vercelCronRowsLast10Min: <span className={cronStatus.vercelCronRowsLast10Minutes > 0 ? "text-green-400" : "text-red-400"}>{cronStatus.vercelCronRowsLast10Minutes}</span></div>
                    <div>robloxApiRowsLast10Min: <span className="text-foreground">{cronStatus.robloxApiRowsLast10Minutes}</span></div>
                    <div>latestCronSnapshot: <span className="text-foreground">{cronStatus.latestCronSnapshotAt ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(cronStatus.latestCronSnapshotAt)) : "none"}</span></div>
                    <div>cronConfigured: <span className={cronStatus.cronConfigured ? "text-green-400" : "text-yellow-400"}>{cronStatus.cronConfigured ? "yes" : "no"}</span></div>
                  </div>
                  {cronStatus.vercelCronRowsLast10Minutes === 0 && (
                    <div className="mt-2 p-2 bg-red-500/20 border border-red-500/30 rounded text-red-300">
                      Background cron is not inserting snapshots. CCU history only updates while the dashboard is open.
                    </div>
                  )}
                </div>
              )}
              
              {/* CCU Snapshot Debug Info - only shown with ?debug=true */}
              {isDebugMode && (
                <div className="mb-3 p-3 bg-cyan-500/10 border border-cyan-500/30 rounded-lg text-xs font-mono">
                  <div className="font-semibold text-cyan-500 mb-2">CCU Snapshot Debug</div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-muted-foreground">
                    <div>snapshotsInRange: <span className={processedCcuHistory.snapshotCount > 0 ? "text-green-400" : "text-red-400"}>{processedCcuHistory.snapshotCount}</span></div>
                    <div>currentCcu: <span className="text-foreground">{processedCcuHistory.currentCcu ?? "—"}</span></div>
                    <div>peakCcu: <span className="text-foreground">{processedCcuHistory.peakCcu ?? "—"}</span></div>
                  </div>
                </div>
              )}
              
              {/* Tracker Heartbeat Debug - only shown with ?debug=true */}
              {isDebugMode && heartbeatDebug && (
                <div className="mb-3 p-3 bg-purple-500/10 border border-purple-500/30 rounded-lg text-xs font-mono">
                  <div className="font-semibold text-purple-500 mb-2">Tracker Heartbeat Debug</div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-muted-foreground mb-3">
                    <div>gameId: <span className="text-foreground">{heartbeatDebug.selectedGameId?.slice(0, 8) || "—"}...</span></div>
                    <div>gameName: <span className="text-foreground">{heartbeatDebug.selectedGameName || "—"}</span></div>
                    <div>activeServers: <span className={heartbeatDebug.activeServerHeartbeats > 0 ? "text-green-400" : "text-red-400"}>{heartbeatDebug.activeServerHeartbeats}</span></div>
                    <div>lastHeartbeat: <span className={heartbeatDebug.minutesSinceLatestHeartbeat !== null && heartbeatDebug.minutesSinceLatestHeartbeat <= 2 ? "text-green-400" : "text-amber-400"}>
                      {heartbeatDebug.minutesSinceLatestHeartbeat !== null ? `${heartbeatDebug.minutesSinceLatestHeartbeat}m ago` : "never"}
                    </span></div>
                  </div>
                  
                  {heartbeatDebug.minutesSinceLatestHeartbeat !== null && heartbeatDebug.minutesSinceLatestHeartbeat > 2 && (
                    <div className="mb-3 p-2 bg-amber-500/20 border border-amber-500/40 rounded text-amber-400">
                      No heartbeat received for {heartbeatDebug.minutesSinceLatestHeartbeat} minutes
                    </div>
                  )}
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <div className="text-muted-foreground mb-1">Latest 10 Heartbeats:</div>
                      <div className="max-h-32 overflow-y-auto space-y-0.5">
                        {heartbeatDebug.latest10Heartbeats.length === 0 ? (
                          <div className="text-red-400">No heartbeats recorded</div>
                        ) : (
                          heartbeatDebug.latest10Heartbeats.map((h, i) => (
                            <div key={i} className="text-[10px]">
                              <span className="text-muted-foreground">{new Date(h.last_seen_at).toLocaleTimeString()}</span>
                              {" "}server={h.server_id.slice(0, 8)}... ccu=<span className="text-foreground">{h.ccu}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1">Latest 10 CCU Snapshots:</div>
                      <div className="max-h-32 overflow-y-auto space-y-0.5">
                        {heartbeatDebug.latest10CcuSnapshots.length === 0 ? (
                          <div className="text-red-400">No snapshots recorded</div>
                        ) : (
                          heartbeatDebug.latest10CcuSnapshots.map((s, i) => (
                            <div key={i} className="text-[10px]">
                              <span className="text-muted-foreground">{new Date(s.created_at).toLocaleTimeString()}</span>
                              {" "}ccu=<span className="text-foreground">{s.ccu}</span>
                              {" "}source=<span className={s.source === "romonetize_tracker" ? "text-purple-400" : "text-blue-400"}>{s.source}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              <div className="h-[380px]">
                {processedCcuHistory.data.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={processedCcuHistory.data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="liveCcuGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.3}/>
                          <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0.02}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid {...gridProps} />
                      <XAxis 
                        dataKey="label"
                        {...axisProps}
                        interval="preserveStartEnd"
                        minTickGap={50}
                      />
                      <YAxis 
                        domain={[0, (dataMax: number) => Math.max(Math.ceil(dataMax * 1.2), 10)]}
                        allowDecimals={false}
                        {...axisProps}
                      />
                      <Tooltip
                        {...tooltipStyle}
                        content={({ active, payload }) => {
                          if (!active || !payload || payload.length === 0) return null;
                          const dataPoint = payload[0]?.payload as {
                            tooltipLabel?: string;
                            ccu?: number;
                            snapshotsCount?: number;
                          };
                          if (!dataPoint) return null;
                          
                          return (
                            <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-lg">
                              <p className="text-sm font-medium text-foreground mb-1">{dataPoint.tooltipLabel}</p>
                              <p className="text-sm text-foreground">CCU: {dataPoint.ccu?.toLocaleString() ?? "—"}</p>
                              {dataPoint.snapshotsCount && dataPoint.snapshotsCount > 1 && (
                                <p className="text-xs text-muted-foreground">
                                  Snapshots in bucket: {dataPoint.snapshotsCount}
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
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center">
                    <Activity className="w-10 h-10 mb-3 text-muted-foreground" />
                    {rawCcuHistory?.rawSnapshots?.length ? (
                      <>
                        <h4 className="font-medium text-foreground mb-2">No data in selected range</h4>
                        <p className="text-sm text-muted-foreground max-w-md">
                          {rawCcuHistory.rawSnapshots.length} snapshot{rawCcuHistory.rawSnapshots.length === 1 ? "" : "s"} exist but none fall within the {ccuRange.toUpperCase()} window. Try a wider range.
                        </p>
                      </>
                    ) : (
                      <>
                        <h4 className="font-medium text-foreground mb-2">No CCU history yet</h4>
                        <p className="text-sm text-muted-foreground max-w-md">
                          Refresh Roblox data to start collecting CCU snapshots. History will build up over time as more snapshots are recorded.
                        </p>
                        <Button onClick={handleSyncAndRefresh} variant="outline" size="sm" className="mt-4">
                          <RefreshCw className="w-4 h-4 mr-2" />
                          Refresh Data
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>
              
              {/* Simple helper text */}
              {processedCcuHistory.data.length > 0 && (
                <p className="mt-2 text-xs text-center text-muted-foreground">
                  {processedCcuHistory.dominantSource === "romonetize_tracker"
                    ? "CCU history from in-game RoMonetize Tracker heartbeats."
                    : "CCU history builds over time as RoMonetize saves Roblox API snapshots."}
                </p>
              )}
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
          
          {/* Chart Aggregation Debug Block - only shown with ?debug=true */}
          {isDebugMode && chartDebugInfo && (
            <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg text-xs font-mono">
              <div className="font-semibold text-blue-500 mb-2">Chart Aggregation Debug (eventsOverTime)</div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 text-muted-foreground">
                <div>rangeStart: <span className="text-foreground">{chartDebugInfo.rangeStart?.slice(0, 16) || "null"}</span></div>
                <div>rangeEnd: <span className="text-foreground">{chartDebugInfo.rangeEnd?.slice(0, 16) || "null"}</span></div>
                <div>rawEventsCount: <span className="text-foreground">{chartDebugInfo.rawEventsCount}</span></div>
                <div>bucketCount: <span className="text-foreground">{chartDebugInfo.bucketCount}</span></div>
                <div>filledBucketCount: <span className="text-foreground">{chartDebugInfo.filledBucketCount}</span></div>
                <div>firstEventAt: <span className="text-foreground">{chartDebugInfo.firstEventAt?.slice(0, 16) || "none"}</span></div>
                <div>lastEventAt: <span className="text-foreground">{chartDebugInfo.lastEventAt?.slice(0, 16) || "none"}</span></div>
                <div>firstBucket: <span className="text-foreground">{chartDebugInfo.firstBucket?.slice(11, 16) || "none"}</span></div>
                <div>lastBucket: <span className="text-foreground">{chartDebugInfo.lastBucket?.slice(11, 16) || "none"}</span></div>
              </div>
              {chartDebugInfo.lastThreeBuckets && (
                <div className="mt-2 text-muted-foreground">
                  lastThreeBuckets: {chartDebugInfo.lastThreeBuckets.map((b: { timestamp: string; hasData: boolean }) => (
                    <span key={b.timestamp} className={`mr-2 ${b.hasData ? "text-green-500" : "text-red-400"}`}>
                      {b.timestamp.slice(11, 16)}({b.hasData ? "data" : "empty"})
                    </span>
                  ))}
                </div>
              )}
              {chartDebugInfo.lastThreeFilledBuckets && (
                <div className="mt-1 text-muted-foreground">
                  lastThreeFilledBuckets: {chartDebugInfo.lastThreeFilledBuckets.map((b: { date: string; events?: number }) => (
                    <span key={b.date} className="mr-2 text-foreground">
                      {new Date(b.date).toISOString().slice(11, 16)}:{b.events ?? 0}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
          
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
