"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAnalytics, formatChartTime, type CCUHistoryRange } from "@/hooks/use-analytics";
import { getRangeWindow, getBucketKey, type RangeKey } from "@/lib/utils/range-window";
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
  const [autoRangeApplied, setAutoRangeApplied] = useState(false);
  
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
  
  // Raw debug API response (debug mode only) - SOURCE OF TRUTH for cards
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [rawDebugResponse, setRawDebugResponse] = useState<any>(null);
  const [rawDebugError, setRawDebugError] = useState<string | null>(null);
  const [isLoadingRawDebug, setIsLoadingRawDebug] = useState(false);
  
  // NEW: CCU History state from dedicated endpoint
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [ccuHistoryData, setCcuHistoryData] = useState<any>(null);
  const [ccuHistoryError, setCcuHistoryError] = useState<string | null>(null);
  const [isLoadingCcuHistory, setIsLoadingCcuHistory] = useState(false);
  
  // NEW: Sessions Chart state from dedicated endpoint
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sessionsChartData, setSessionsChartData] = useState<any>(null);
  const [sessionsChartError, setSessionsChartError] = useState<string | null>(null);
  const [isLoadingSessionsChart, setIsLoadingSessionsChart] = useState(false);
  
  // NEW: Performance Data state from unified endpoint - SOURCE OF TRUTH for cards and charts
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [performanceData, setPerformanceData] = useState<any>(null);
  const [performanceDataError, setPerformanceDataError] = useState<string | null>(null);
  const [isLoadingPerformanceData, setIsLoadingPerformanceData] = useState(false);
  
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
  
  // Fetch raw debug API response when debug mode is enabled or chart range changes
  useEffect(() => {
    if (!isDebugMode) return;
    
    setIsLoadingRawDebug(true);
    setRawDebugError(null);
    
    // Map performance range to helper range
    const apiRange = chartRange === "24h" ? "1d" : chartRange === "72h" ? "3d" : chartRange;
    
    fetch(`/api/debug/game-performance?range=${apiRange}`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => {
        setRawDebugResponse(data);
      })
      .catch(err => {
        setRawDebugError(err.message);
      })
      .finally(() => {
        setIsLoadingRawDebug(false);
      });
  }, [isDebugMode, chartRange]);
  
  // Fetch CCU history from dedicated endpoint when range changes
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
  
  // Fetch CCU history on mount and when range changes
  useEffect(() => {
    fetchCcuHistory();
  }, [fetchCcuHistory]);
  
  // Fetch Sessions Chart from dedicated endpoint
  const fetchSessionsChart = useCallback(async () => {
    setIsLoadingSessionsChart(true);
    setSessionsChartError(null);
    
    try {
      const response = await fetch(`/api/dashboard/sessions-chart?range=${chartRange}&t=${Date.now()}`, {
        cache: "no-store",
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      setSessionsChartData(data);
    } catch (err) {
      setSessionsChartError(err instanceof Error ? err.message : "Failed to fetch sessions chart");
    } finally {
      setIsLoadingSessionsChart(false);
    }
  }, [chartRange]);
  
  // Fetch sessions chart on mount and when range changes
  useEffect(() => {
    fetchSessionsChart();
  }, [fetchSessionsChart]);
  
  // Fetch Performance Data from unified endpoint - SOURCE OF TRUTH
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
  
  // Fetch performance data on mount and when range changes
  useEffect(() => {
    fetchPerformanceData();
  }, [fetchPerformanceData]);
  
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
      
      // Refresh analytics data, CCU history, and performance data to pick up the new sync
      await refresh();
      await fetchCcuHistory();
      await fetchPerformanceData();
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
  }, [refresh, fetchCcuHistory]);
  
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
        // Refresh analytics and CCU history to pick up new snapshots
        await refresh();
        await fetchCcuHistory();
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
  // 5. Stop polling after consecutive failures to prevent spam
  useEffect(() => {
    let isMounted = true;
    let isSyncing = false; // Guard against concurrent calls
    let consecutiveFailures = 0;
    const MAX_CONSECUTIVE_FAILURES = 3; // Stop polling after 3 failures
    
    // Non-blocking background sync - fire and forget
    const doBackgroundSync = () => {
      if (!isMounted) return;
      if (isSyncing) return; // Prevent concurrent calls
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        // Stop spamming after too many failures
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
        return;
      }
      
      isSyncing = true;
      
      // Fire sync without awaiting - don't block anything
      fetch("/api/roblox/sync-all-ccu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }).then((res) => {
        isSyncing = false;
        if (isMounted) {
          if (res.ok) {
            consecutiveFailures = 0; // Reset on success
            setLastPollTime(new Date());
            setPollCount((c) => c + 1);
          } else {
            consecutiveFailures++;
            // Stop polling if too many failures
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && pollingIntervalRef.current) {
              clearInterval(pollingIntervalRef.current);
              pollingIntervalRef.current = null;
            }
          }
        }
      }).catch(() => {
        isSyncing = false;
        consecutiveFailures++;
        // Stop polling if too many failures
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
      });
    };
    
    // Start polling interval - only when visible
    const startPolling = () => {
      // Don't restart if we've had too many failures
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) return;
      
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
        // Tab visible - restart interval (but don't trigger immediate sync to avoid spam)
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
      consecutiveFailures = 0; // Reset failures on game change
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
  
  // Process CCU history from the dedicated /api/dashboard/ccu-history endpoint
  // This is now a simple passthrough - all processing is done server-side
  const processedCcuHistory = useMemo(() => {
    // Default empty state
    const emptyState = {
      data: [] as Array<{ time: string; label: string; ccu: number; source: string }>,
      currentCcu: null as number | null,
      peakCcu: null as number | null,
      avgCcu: null as number | null,
      snapshotCount: 0,
      totalSnapshots: 0,
      dominantSource: "none" as string,
      latestSnapshotTime: null as string | null,
      latestSnapshotAgeMinutes: null as number | null,
      rangeStartUtc: null as string | null,
      rangeEndUtc: null as string | null,
      sourceCounts: {} as Record<string, number>,
      debugInfo: {
        endpoint: "/api/dashboard/ccu-history",
        selectedGameId: ccuHistoryData?.selectedGameId ?? null,
        range: ccuHistoryData?.range ?? ccuRange,
        rangeStartIso: ccuHistoryData?.rangeStartIso ?? null,
        rangeEndIso: ccuHistoryData?.rangeEndIso ?? null,
        sourceCounts: ccuHistoryData?.sourceCounts ?? {},
        usedSource: ccuHistoryData?.usedSource ?? "none",
        snapshotsReturned: ccuHistoryData?.snapshotsReturned ?? 0,
        usedSnapshots: ccuHistoryData?.usedSnapshots ?? 0,
        chartDataLength: ccuHistoryData?.chartDataLength ?? 0,
        latestSnapshotAt: ccuHistoryData?.latestSnapshotAt ?? null,
        currentCcu: ccuHistoryData?.currentCcu ?? null,
        firstChartPoint: ccuHistoryData?.chartData?.[0] ?? null,
        lastChartPoint: ccuHistoryData?.chartData?.[ccuHistoryData?.chartData?.length - 1] ?? null,
        filteringIssue: null as string | null,
      },
    };
    
    if (!ccuHistoryData?.success || !ccuHistoryData?.chartData) {
      // Add error info if available
      if (ccuHistoryData?.error) {
        emptyState.debugInfo.filteringIssue = ccuHistoryData.error;
      } else if (ccuHistoryError) {
        emptyState.debugInfo.filteringIssue = ccuHistoryError;
      }
      return emptyState;
    }
    
    // Calculate latestSnapshotAgeMinutes
    let latestSnapshotAgeMinutes: number | null = null;
    if (ccuHistoryData.latestSnapshotAt) {
      const latestMs = new Date(ccuHistoryData.latestSnapshotAt).getTime();
      if (Number.isFinite(latestMs)) {
        latestSnapshotAgeMinutes = Math.round((Date.now() - latestMs) / 60000);
      }
    }
    
    // Check for chart generation failure (usedSnapshots > 0 but chartDataLength === 0)
    let filteringIssue: string | null = null;
    if (ccuHistoryData.usedSnapshots > 0 && ccuHistoryData.chartDataLength === 0) {
      filteringIssue = "chart_generation_failed";
    }
    
    return {
      data: ccuHistoryData.chartData,
      currentCcu: ccuHistoryData.currentCcu,
      peakCcu: ccuHistoryData.peakCcu,
      avgCcu: ccuHistoryData.avgCcu,
      snapshotCount: ccuHistoryData.chartDataLength,
      totalSnapshots: ccuHistoryData.snapshotsReturned,
      dominantSource: ccuHistoryData.usedSource,
      latestSnapshotTime: ccuHistoryData.latestSnapshotAt,
      latestSnapshotAgeMinutes,
      rangeStartUtc: ccuHistoryData.rangeStartIso,
      rangeEndUtc: ccuHistoryData.rangeEndIso,
      sourceCounts: ccuHistoryData.sourceCounts,
      debugInfo: {
        endpoint: "/api/dashboard/ccu-history",
        selectedGameId: ccuHistoryData.selectedGameId,
        range: ccuHistoryData.range,
        rangeStartIso: ccuHistoryData.rangeStartIso,
        rangeEndIso: ccuHistoryData.rangeEndIso,
        sourceCounts: ccuHistoryData.sourceCounts,
        usedSource: ccuHistoryData.usedSource,
        snapshotsReturned: ccuHistoryData.snapshotsReturned,
        usedSnapshots: ccuHistoryData.usedSnapshots,
        chartDataLength: ccuHistoryData.chartDataLength,
        latestSnapshotAt: ccuHistoryData.latestSnapshotAt,
        currentCcu: ccuHistoryData.currentCcu,
        firstChartPoint: ccuHistoryData.chartData[0] ?? null,
        lastChartPoint: ccuHistoryData.chartData[ccuHistoryData.chartData.length - 1] ?? null,
        filteringIssue,
      },
    };
  }, [ccuHistoryData, ccuHistoryError, ccuRange]);

  // Auto-select useful range on first load based on API response
  useEffect(() => {
    if (autoRangeApplied) return;
    
    // If current range returned data, we're good
    if (ccuHistoryData?.usedSnapshots > 0) {
      setAutoRangeApplied(true);
      return;
    }
    
    // If no data and not loading, could try a wider range
    // But for simplicity, just mark as applied after first load
    if (!isLoadingCcuHistory && ccuHistoryData !== null) {
      setAutoRangeApplied(true);
    }
  }, [ccuHistoryData, isLoadingCcuHistory, autoRangeApplied]);
  
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

  // ==========================================================================
  // CHART DATA NORMALIZATION
  // ==========================================================================
  // Normalize chart data to ensure consistent { time, value } format for Recharts
  // This handles any backend key variations
  
  type NormalizedChartPoint = { time: string; value: number };
  
  const normalizeChartPoint = (
    bucket: Record<string, unknown>,
    metric: "activity" | "sessions" | "purchases"
  ): NormalizedChartPoint => {
    const time = String(
      bucket.time ??
      bucket.label ??
      bucket.date ??
      bucket.bucket ??
      bucket.created_at ??
      ""
    );

    let rawValue = 0;

    if (metric === "activity") {
      rawValue = Number(
        bucket.value ??
        bucket.count ??
        bucket.total ??
        bucket.trackedActions ??
        bucket.tracked_actions ??
        bucket.actions ??
        bucket.events ??
        bucket.eventCount ??
        bucket.event_count ??
        0
      );
    }

    if (metric === "sessions") {
      rawValue = Number(
        bucket.value ??
        bucket.count ??
        bucket.total ??
        bucket.sessions ??
        bucket.totalSessions ??
        bucket.total_sessions ??
        bucket.joins ??
        bucket.playerJoins ??
        bucket.player_joins ??
        0
      );
    }

    if (metric === "purchases") {
      rawValue = Number(
        bucket.value ??
        bucket.count ??
        bucket.total ??
        bucket.purchases ??
        bucket.purchaseCount ??
        bucket.purchase_count ??
        0
      );
    }

    return {
      time,
      value: rawValue || 0,
    };
  };

  // NEW: All chart arrays come from /api/dashboard/performance-data - SOURCE OF TRUTH
  // These directly use performanceData.charts which are already in { time, value } format
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

  // Calculate visual totals from normalized data (MUST match card values from same endpoint)
  const activityVisualTotal = normalizedActivity.reduce((s, p) => s + p.value, 0);
  const sessionsVisualTotal = normalizedSessions.reduce((s, p) => s + p.value, 0);
  const purchasesVisualTotal = normalizedPurchases.reduce((s, p) => s + p.value, 0);

  // ==========================================================================
  // SAFE DEFAULTS
  // ==========================================================================
  
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
  
  // NEW: cardStats from /api/dashboard/performance-data - SOURCE OF TRUTH
  // This replaces all previous card stat sources
  const cardStats = performanceData?.metrics ? {
    totalEvents: performanceData.metrics.trackedActions ?? 0,
    uniquePlayers: performanceData.metrics.uniquePlayers ?? 0,
    totalSessions: performanceData.metrics.totalSessions ?? 0,
    avgSessionDuration: performanceData.metrics.avgSessionSeconds ?? null,
    newPlayers: performanceData.metrics.newPlayers ?? 0,
    totalPurchases: performanceData.metrics.purchases ?? 0,
  } : {
    totalEvents: 0,
    uniquePlayers: 0,
    totalSessions: 0,
    avgSessionDuration: null,
    newPlayers: 0,
    totalPurchases: 0,
  };

  // DEBUG: Log when trackerStats is null but we have tracker events
  // This helps identify if the API is returning data but the UI is not displaying it
  if (typeof window !== "undefined" && safeDataHealth.hasTrackerEvents && !trackerStats) {
    console.warn("[v0] WIRING BUG: hasTrackerEvents=true but trackerStats is null/undefined", {
      trackerStatsFromHook: trackerStats,
      dataHealthFromHook: dataHealth,
      hasTrackerData,
      isLoading,
      error,
    });
  }

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
                
                {/* PART F: RAW JSON DEBUG - ALWAYS VISIBLE */}
                <div className="mb-4 p-4 bg-black border-4 border-green-500 rounded-lg">
                  <div className="text-green-400 font-bold text-lg mb-2">DEBUG MODE - RAW ENDPOINT DATA</div>
                  <div className="text-green-300 text-sm mb-4">Source of Truth: /api/dashboard/performance-data and /api/dashboard/ccu-history</div>
                  
                  {/* Performance Data JSON */}
                  <div className="mb-4">
                    <div className="text-cyan-400 font-bold mb-1">performanceData (from /api/dashboard/performance-data?range={chartRange}):</div>
                    {isLoadingPerformanceData && <div className="text-yellow-400">Loading...</div>}
                    {performanceDataError && <div className="text-red-400">Error: {performanceDataError}</div>}
                    <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, color: "#00ff00", maxHeight: 400, overflow: "auto", background: "#111", padding: 8, borderRadius: 4 }}>
                      {performanceData ? JSON.stringify(performanceData, null, 2) : "No data"}
                    </pre>
                  </div>
                  
                  {/* CCU History JSON */}
                  <div>
                    <div className="text-purple-400 font-bold mb-1">ccuHistoryData (from /api/dashboard/ccu-history?range={ccuRange}):</div>
                    {isLoadingCcuHistory && <div className="text-yellow-400">Loading...</div>}
                    {ccuHistoryError && <div className="text-red-400">Error: {ccuHistoryError}</div>}
                    <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, color: "#ff00ff", maxHeight: 400, overflow: "auto", background: "#111", padding: 8, borderRadius: 4 }}>
                      {ccuHistoryData ? JSON.stringify(ccuHistoryData, null, 2) : "No data"}
                    </pre>
                  </div>
                </div>
                
                {/* Card vs Chart Verification */}
                <div className="mb-4 p-3 bg-green-900/50 border border-green-500 rounded-lg">
                  <div className="text-green-300 font-bold mb-2">CARD vs CHART TOTALS (must match):</div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <div className="text-muted-foreground">Tracked Actions</div>
                      <div>Card: <span className="text-foreground font-bold">{cardStats.totalEvents}</span></div>
                      <div>Chart: <span className={activityVisualTotal === cardStats.totalEvents ? "text-green-400 font-bold" : "text-red-400 font-bold"}>{activityVisualTotal}</span></div>
                      <div className={activityVisualTotal === cardStats.totalEvents ? "text-green-400" : "text-red-400"}>{activityVisualTotal === cardStats.totalEvents ? "MATCH" : "MISMATCH"}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Total Sessions</div>
                      <div>Card: <span className="text-foreground font-bold">{cardStats.totalSessions}</span></div>
                      <div>Chart: <span className={sessionsVisualTotal === cardStats.totalSessions ? "text-green-400 font-bold" : "text-red-400 font-bold"}>{sessionsVisualTotal}</span></div>
                      <div className={sessionsVisualTotal === cardStats.totalSessions ? "text-green-400" : "text-red-400"}>{sessionsVisualTotal === cardStats.totalSessions ? "MATCH" : "MISMATCH"}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Purchases</div>
                      <div>Card: <span className="text-foreground font-bold">{cardStats.totalPurchases}</span></div>
                      <div>Chart: <span className={purchasesVisualTotal === cardStats.totalPurchases ? "text-green-400 font-bold" : "text-red-400 font-bold"}>{purchasesVisualTotal}</span></div>
                      <div className={purchasesVisualTotal === cardStats.totalPurchases ? "text-green-400" : "text-red-400"}>{purchasesVisualTotal === cardStats.totalPurchases ? "MATCH" : "MISMATCH"}</div>
                    </div>
                  </div>
                </div>
                
                {/* CCU DEBUG PANEL - Live CCU History diagnosis */}
                <div className="mb-4 p-3 bg-cyan-900/30 border border-cyan-500 rounded-lg">
                  <div className="font-bold text-cyan-400 mb-2">CCU HISTORY DEBUG (Live CCU Chart)</div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                    <div>selectedGameId: <span className="text-white">{ccuHistoryData?.selectedGameId ?? "none"}</span></div>
                    <div>selectedRange: <span className="text-white">{ccuRange}</span></div>
                    <div>rowsFoundBeforeSourceFilter: <span className={(ccuHistoryData?.rowsFoundBeforeSourceFilter ?? 0) > 0 ? "text-green-400 font-bold" : "text-red-400 font-bold"}>{ccuHistoryData?.rowsFoundBeforeSourceFilter ?? 0}</span></div>
                    <div>usedSnapshots: <span className={(ccuHistoryData?.usedSnapshots ?? 0) > 0 ? "text-green-400 font-bold" : "text-red-400 font-bold"}>{ccuHistoryData?.usedSnapshots ?? 0}</span></div>
                    <div>chartDataLength: <span className={(ccuHistoryData?.chartDataLength ?? 0) > 0 ? "text-green-400 font-bold" : "text-red-400 font-bold"}>{ccuHistoryData?.chartDataLength ?? 0}</span></div>
                    <div>usedSource: <span className={ccuHistoryData?.usedSource === "romonetize_tracker" ? "text-purple-400 font-bold" : "text-blue-400"}>{ccuHistoryData?.usedSource ?? "none"}</span></div>
                    <div>latestSnapshotAt: <span className="text-white">{ccuHistoryData?.latestSnapshotAt ?? "none"}</span></div>
                    <div>currentCcu: <span className="text-white">{ccuHistoryData?.currentCcu ?? "—"}</span></div>
                    <div>peakCcu: <span className="text-white">{ccuHistoryData?.peakCcu ?? "—"}</span></div>
                    <div className="col-span-full">sourceCounts: <span className="text-foreground">{JSON.stringify(ccuHistoryData?.sourceCounts ?? {})}</span></div>
                  </div>
                </div>
                
                {/* RAW API DEBUG PANEL - SOURCE OF TRUTH */}
                <div className="mb-4 p-3 bg-red-900/30 border border-red-500 rounded-lg">
                  <div className="font-bold text-red-400 mb-2">
                    RAW DEBUG API RESPONSE (SOURCE OF TRUTH)
                    <span className="ml-2 text-xs font-normal text-red-300">
                      /api/debug/game-performance?range={chartRange === "24h" ? "1d" : chartRange === "72h" ? "3d" : chartRange}
                    </span>
                  </div>
                  
                  {isLoadingRawDebug && (
                    <div className="text-yellow-400">Loading debug API...</div>
                  )}
                  
                  {rawDebugError && (
                    <div className="text-red-400">Error: {rawDebugError}</div>
                  )}
                  
                  {rawDebugResponse && (
                    <div className="space-y-2">
                      {/* Key card values - THESE SHOULD MATCH THE UI CARDS */}
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 p-2 bg-green-900/30 border border-green-500/50 rounded">
                        <div className="font-bold text-green-400 col-span-full">CARD VALUES (UI must match these):</div>
                        <div>trackedActions: <span className="text-white font-bold">{rawDebugResponse.trackedActions}</span></div>
                        <div>uniquePlayers: <span className="text-white font-bold">{rawDebugResponse.uniquePlayers}</span></div>
                        <div>totalSessions: <span className="text-white font-bold">{rawDebugResponse.totalSessions}</span></div>
                        <div>newPlayers: <span className="text-white font-bold">{rawDebugResponse.newPlayers}</span></div>
                        <div>purchases: <span className="text-white font-bold">{rawDebugResponse.purchases}</span></div>
                        <div>avgSessionSeconds: <span className="text-white font-bold">{rawDebugResponse.avgSessionSeconds ?? "null"}</span></div>
                      </div>
                      
                      {/* Player ID debug */}
                      {rawDebugResponse.playerIdDebug && (
                        <div className="p-2 bg-blue-900/30 border border-blue-500/50 rounded">
                          <div className="font-bold text-blue-400">PLAYER ID DEBUG:</div>
                          <div>rootPlayerIdCount: <span className="text-white">{rawDebugResponse.playerIdDebug.rootPlayerIdCount}</span></div>
                          <div>distinctRootPlayers: <span className="text-white">{rawDebugResponse.playerIdDebug.distinctRootPlayers}</span></div>
                          <div>validPlayerIdCount: <span className="text-white">{rawDebugResponse.playerIdDebug.validPlayerIdCount}</span></div>
                          <div>sampleRootPlayerIds: <span className="text-white text-[10px]">{JSON.stringify(rawDebugResponse.playerIdDebug.sampleRootPlayerIds)}</span></div>
                        </div>
                      )}
                      
                      {/* Chart debug */}
                      {rawDebugResponse.chartDebug && (
                        <div className="p-2 bg-purple-900/30 border border-purple-500/50 rounded">
                          <div className="font-bold text-purple-400">CHART DEBUG:</div>
                          <div>activityBucketsLength: {rawDebugResponse.chartDebug.activityBucketsLength}, total: {rawDebugResponse.chartDebug.activityVisualTotal}</div>
                          <div>sessionsBucketsLength: {rawDebugResponse.chartDebug.sessionsBucketsLength}, total: {rawDebugResponse.chartDebug.sessionsVisualTotal}</div>
                          <div>purchasesBucketsLength: {rawDebugResponse.chartDebug.purchasesBucketsLength}, total: {rawDebugResponse.chartDebug.purchasesVisualTotal}</div>
                        </div>
                      )}
                      
                      {/* Summary */}
                      {rawDebugResponse.summary && (
                        <div className="p-2 bg-yellow-900/30 border border-yellow-500/50 rounded">
                          <div className="font-bold text-yellow-400">SUMMARY:</div>
                          <div>allChartsMatchCards: <span className={rawDebugResponse.summary.allChartsMatchCards ? "text-green-400" : "text-red-400"}>{String(rawDebugResponse.summary.allChartsMatchCards)}</span></div>
                          <div>newPlayersValid: <span className={rawDebugResponse.summary.newPlayersValid ? "text-green-400" : "text-red-400"}>{String(rawDebugResponse.summary.newPlayersValid)}</span></div>
                          <div>noPaginationIssues: <span className={rawDebugResponse.summary.noPaginationIssues ? "text-green-400" : "text-red-400"}>{String(rawDebugResponse.summary.noPaginationIssues)}</span></div>
                        </div>
                      )}
                      
                      {/* Full raw JSON - EXPANDED by default */}
                      <div className="mt-2">
                        <div className="text-gray-400 mb-1">Full raw JSON response:</div>
                        <pre className="p-2 bg-black/50 rounded overflow-auto max-h-96 text-[10px]" style={{ whiteSpace: "pre-wrap" }}>
                          {JSON.stringify(rawDebugResponse, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
                
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
                    <span className="text-amber-400">CCU Snapshots &amp; Range Debug:</span>
                  </div>
                  <div>selectedGameId: <span className="text-foreground text-[10px]">{selectedGameId?.slice(0, 12) || "none"}</span></div>
                  <div>selectedGameName: <span className="text-foreground">{game?.name?.slice(0, 25) || "none"}</span></div>
                  <div>selectedRange: <span className="text-foreground">{ccuRange}</span></div>
                  <div>ccuTotalSnapshots: <span className="text-foreground">{processedCcuHistory.totalSnapshots}</span></div>
                  <div>ccuSnapshotsInRange: <span className={processedCcuHistory.snapshotCount > 0 ? "text-green-400" : "text-red-400"}>{processedCcuHistory.snapshotCount}</span></div>
                  <div>rangeStartUtc: <span className="text-foreground text-[10px]">{processedCcuHistory.rangeStartUtc?.slice(0, 19) || "null"}</span></div>
                  <div>rangeEndUtc: <span className="text-foreground text-[10px]">{processedCcuHistory.rangeEndUtc?.slice(0, 19) || "null"}</span></div>
                  <div>dbNow: <span className="text-foreground text-[10px]">{new Date().toISOString().slice(0, 19)}</span></div>
                  {rawCcuHistory?.rawSnapshots?.length ? (
                    <>
                      <div>oldestSnapshotAt: <span className="text-foreground">
                        {new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(rawCcuHistory.rawSnapshots[0].time))}
                      </span></div>
                      <div>latestSnapshotAt: <span className="text-foreground">
                        {new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(rawCcuHistory.rawSnapshots[rawCcuHistory.rawSnapshots.length - 1].time))}
                      </span></div>
                      <div>latestSnapshotAgeMinutes: <span className={processedCcuHistory.latestSnapshotAgeMinutes !== null && processedCcuHistory.latestSnapshotAgeMinutes <= 60 ? "text-green-400" : "text-yellow-400"}>{processedCcuHistory.latestSnapshotAgeMinutes ?? "null"}</span></div>
                    </>
                  ) : null}
                  <div>timestampColumnUsed: <span className="text-foreground">captured_at || created_at</span></div>
                  <div>sourceCounts: <span className="text-foreground text-[10px]">{JSON.stringify(processedCcuHistory.sourceCounts)}</span></div>
                  <div>dominantSource: <span className={processedCcuHistory.dominantSource === "romonetize_tracker" ? "text-purple-400" : "text-blue-400"}>{processedCcuHistory.dominantSource}</span></div>
                  <div>chartDataLength: <span className="text-foreground">{processedCcuHistory.data.length}</span></div>
                  <div>autoRangeApplied: <span className={autoRangeApplied ? "text-green-400" : "text-yellow-400"}>{autoRangeApplied ? "YES" : "pending"}</span></div>
                  <div>lastPollTime: <span className="text-foreground">{lastPollTime ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(lastPollTime) : "none"}</span></div>
                  <div>pollCount: <span className="text-foreground">{pollCount}</span></div>
                  
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
                  
                  {/* Card vs Chart Alignment - KEY for verifying stats consistency */}
                  <div className="col-span-full mt-2 pt-2 border-t border-amber-500/20">
                    <span className="text-amber-400">Card vs Chart Alignment (from API debug):</span>
                  </div>
                  
                  {/* BUILD VERIFICATION MARKER - Remove after confirming deployment freshness */}
                  <div className="col-span-full mb-2 p-2 bg-purple-900/50 border border-purple-500 rounded text-purple-200 font-mono text-[10px]">
                    <div>Performance Debug Build: <span className="text-purple-100 font-bold">v-gp-step1-rawapi</span></div>
                    <div>Rendered file: <span className="text-purple-100">/app/dashboard/performance/page.tsx</span></div>
                    <div>Backend helper: <span className="text-purple-100">/lib/helpers/game-performance.ts</span></div>
                    <div>Debug API: <span className="text-purple-100">/api/debug/game-performance (NEW format with playerIdDebug)</span></div>
                    <div>Cards: <span className="text-purple-100">In debug mode, wired DIRECTLY to raw API response</span></div>
                  </div>
                  
                  {/* NORMALIZED CHART DATA VERIFICATION */}
                  <div className="col-span-full mb-2 p-2 bg-green-900/50 border border-green-500 rounded text-green-200 font-mono text-[10px]">
                    <div className="text-green-300 font-bold mb-1">Normalized Chart Verification (VISUAL TOTALS):</div>
                    <div>activityBadge: <span className="text-green-100">{safeTrackerStats.totalEvents}</span></div>
                    <div>activityVisualTotal: <span className={activityVisualTotal === safeTrackerStats.totalEvents ? "text-green-400" : "text-red-400"}>{activityVisualTotal}</span></div>
                    <div>activityMatch: <span className={activityVisualTotal === safeTrackerStats.totalEvents ? "text-green-400" : "text-red-400"}>{activityVisualTotal === safeTrackerStats.totalEvents ? "EXACT" : "MISMATCH!"}</span></div>
                    <div>sessionsBadge: <span className="text-green-100">{cardStats.totalSessions}</span></div>
                    <div>sessionsVisualTotal: <span className={sessionsVisualTotal === cardStats.totalSessions ? "text-green-400" : "text-red-400"}>{sessionsVisualTotal}</span></div>
                    <div>sessionsMatch: <span className={sessionsVisualTotal === cardStats.totalSessions ? "text-green-400" : "text-red-400"}>{sessionsVisualTotal === cardStats.totalSessions ? "EXACT" : "MISMATCH!"}</span></div>
                    <div>purchasesBadge: <span className="text-green-100">{safeTrackerStats.totalPurchases ?? 0}</span></div>
                    <div>purchasesVisualTotal: <span className={purchasesVisualTotal === (safeTrackerStats.totalPurchases ?? 0) ? "text-green-400" : "text-red-400"}>{purchasesVisualTotal}</span></div>
                    <div>purchasesMatch: <span className={purchasesVisualTotal === (safeTrackerStats.totalPurchases ?? 0) ? "text-green-400" : "text-red-400"}>{purchasesVisualTotal === (safeTrackerStats.totalPurchases ?? 0) ? "EXACT" : "MISMATCH!"}</span></div>
                    <div>normalizedActivityLength: <span className={normalizedActivity.length > 0 ? "text-green-400" : "text-red-400"}>{normalizedActivity.length}</span></div>
                    <div>normalizedSessionsLength: <span className={normalizedSessions.length > 0 ? "text-green-400" : "text-red-400"}>{normalizedSessions.length}</span></div>
                    <div>normalizedPurchasesLength: <span className={normalizedPurchases.length > 0 ? "text-green-400" : "text-red-400"}>{normalizedPurchases.length}</span></div>
                    {normalizedActivity.length > 0 && activityVisualTotal === 0 && (
                      <div className="text-red-400 font-bold mt-1">ERROR: Activity buckets exist but sum to 0 - wrong data key!</div>
                    )}
                    {normalizedSessions.length > 0 && sessionsVisualTotal === 0 && (
                      <div className="text-red-400 font-bold mt-1">ERROR: Sessions buckets exist but sum to 0 - wrong data key!</div>
                    )}
                    {normalizedPurchases.length > 0 && purchasesVisualTotal === 0 && safeTrackerStats.totalPurchases && safeTrackerStats.totalPurchases > 0 && (
                      <div className="text-red-400 font-bold mt-1">ERROR: Purchases buckets exist but sum to 0 - wrong data key!</div>
                    )}
                    <div className="mt-1 text-[9px] break-all">
                      activitySample: {JSON.stringify(normalizedActivity.slice(0, 3))}
                    </div>
                    <div className="text-[9px] break-all">
                      sessionsSample: {JSON.stringify(normalizedSessions.slice(0, 3))}
                    </div>
                    <div className="text-[9px] break-all">
                      purchasesSample: {JSON.stringify(normalizedPurchases.slice(0, 3))}
                    </div>
                  </div>
                  
                  {/* SESSIONS CHART DEBUG - from dedicated /api/dashboard/sessions-chart endpoint */}
                  <div className="col-span-full mb-2 p-2 bg-cyan-900/50 border border-cyan-500 rounded text-cyan-200 font-mono text-[10px]">
                    <div className="text-cyan-300 font-bold mb-1">Sessions Chart Debug (/api/dashboard/sessions-chart):</div>
                    {isLoadingSessionsChart ? (
                      <div>Loading...</div>
                    ) : sessionsChartError ? (
                      <div className="text-red-400">Error: {sessionsChartError}</div>
                    ) : sessionsChartData ? (
                      <>
                        <div>selectedGameId: <span className="text-foreground">{sessionsChartData.selectedGameId?.slice(0, 8) ?? "none"}...</span></div>
                        <div>selectedRange: <span className="text-foreground">{sessionsChartData.range}</span></div>
                        <div>rangeStartIso: <span className="text-foreground text-[9px]">{sessionsChartData.rangeStartIso}</span></div>
                        <div>rangeEndIso: <span className="text-foreground text-[9px]">{sessionsChartData.rangeEndIso}</span></div>
                        <div>totalSessionsCard: <span className={cardStats.totalSessions > 0 ? "text-green-400 font-bold" : "text-red-400"}>{cardStats.totalSessions}</span></div>
                        <div>totalSessionsVisualTotal: <span className={sessionsVisualTotal === cardStats.totalSessions ? "text-green-400 font-bold" : "text-red-400 font-bold"}>{sessionsVisualTotal}</span></div>
                        <div>bucketCount: <span className={sessionsChartData.bucketCount > 0 ? "text-green-400" : "text-red-400"}>{sessionsChartData.bucketCount}</span></div>
                        <div>bucketType: <span className="text-foreground">{sessionsChartData.bucketType}</span></div>
                        <div>method: <span className="text-foreground">{sessionsChartData.method}</span></div>
                        <div>eventTypesUsed: <span className="text-foreground">{JSON.stringify(sessionsChartData.eventTypesUsed)}</span></div>
                        <div>firstBucket: <span className="text-foreground text-[9px]">{JSON.stringify(sessionsChartData.firstBucket)}</span></div>
                        <div>lastBucket: <span className="text-foreground text-[9px]">{JSON.stringify(sessionsChartData.lastBucket)}</span></div>
                        <div className="text-[9px] break-all">bucketSample: {JSON.stringify(sessionsChartData.chartData?.slice(0, 3))}</div>
                      </>
                    ) : (
                      <div className="text-muted-foreground">No data</div>
                    )}
                  </div>
                  
                  {/* CHART WIRING DEBUG - shows if chart arrays have data */}
                  <div className="col-span-full mb-2 p-2 bg-blue-900/50 border border-blue-500 rounded text-blue-200 font-mono text-[10px]">
                    <div className="text-blue-300 font-bold mb-1">Raw Chart Buckets (from API):</div>
                    <div>rawActivityLength: <span className={performanceCharts?.eventsOverTime?.length ? "text-green-400" : "text-red-400"}>{performanceCharts?.eventsOverTime?.length ?? 0}</span></div>
                    <div>rawSessionsLength: <span className={performanceCharts?.sessionsOverTime?.length ? "text-green-400" : "text-red-400"}>{performanceCharts?.sessionsOverTime?.length ?? 0}</span></div>
                    <div>rawPurchasesLength: <span className={performanceCharts?.purchasesOverTime?.length ? "text-green-400" : "text-red-400"}>{performanceCharts?.purchasesOverTime?.length ?? 0}</span></div>
                    <div className="mt-1 text-[9px] break-all">
                      rawActivitySample: {JSON.stringify((performanceCharts?.eventsOverTime ?? []).slice(0, 3))}
                    </div>
                    <div className="text-[9px] break-all">
                      rawSessionsSample: {JSON.stringify((performanceCharts?.sessionsOverTime ?? []).slice(0, 3))}
                    </div>
                    <div className="text-[9px] break-all">
                      rawPurchasesSample: {JSON.stringify((performanceCharts?.purchasesOverTime ?? []).slice(0, 3))}
                    </div>
                  </div>
                  
                  <div>selectedRange: <span className="text-foreground">{performanceCharts?.debug?.selectedRange || chartRange}</span></div>
                  <div>bucketType: <span className="text-foreground">{performanceCharts?.debug?.bucketType || "unknown"}</span></div>
                  <div>bucketCount: <span className="text-foreground">{performanceCharts?.debug?.bucketCount || 0}</span></div>
                  <div>trackedActionsCard: <span className="text-foreground">{performanceCharts?.debug?.trackedActionsCard ?? safeTrackerStats.totalEvents ?? 0}</span></div>
                  <div>activityChartTotal: <span className={
                    performanceCharts?.debug?.activityMatch ? "text-green-400" : "text-yellow-400"
                  }>{performanceCharts?.debug?.activityChartTotal ?? 0}</span></div>
                  <div>activityMatch: <span className={performanceCharts?.debug?.activityMatch ? "text-green-400" : "text-red-400"}>{performanceCharts?.debug?.activityMatch ? "PASS" : "FAIL"}</span></div>
                  <div>totalSessionsCard: <span className="text-foreground">{performanceCharts?.debug?.totalSessionsCard ?? safeTrackerStats.totalSessions ?? 0}</span></div>
                  <div>playerJoinsChartTotal: <span className={
                    performanceCharts?.debug?.sessionsMatch ? "text-green-400" : "text-yellow-400"
                  }>{performanceCharts?.debug?.playerJoinsChartTotal ?? 0}</span></div>
                  <div>sessionsMatch: <span className={performanceCharts?.debug?.sessionsMatch ? "text-green-400" : "text-red-400"}>{performanceCharts?.debug?.sessionsMatch ? "PASS" : "FAIL"}</span></div>
                  <div>purchasesCard: <span className="text-foreground">{performanceCharts?.debug?.purchasesCard ?? safeTrackerStats.totalPurchases ?? 0}</span></div>
                  <div>purchasesChartTotal: <span className={
                    performanceCharts?.debug?.purchasesMatch ? "text-green-400" : "text-yellow-400"
                  }>{performanceCharts?.debug?.purchasesChartTotal ?? 0}</span></div>
                  <div>purchasesMatch: <span className={performanceCharts?.debug?.purchasesMatch ? "text-green-400" : "text-red-400"}>{performanceCharts?.debug?.purchasesMatch ? "PASS" : "FAIL"}</span></div>
                  <div>uniquePlayersCard: <span className="text-foreground">{safeTrackerStats.uniquePlayers || 0}</span></div>
                  <div>newPlayersCard: <span className={
                    (safeTrackerStats.newPlayers || 0) <= (safeTrackerStats.uniquePlayers || 0)
                      ? "text-green-400" : "text-red-400"
                  }>{safeTrackerStats.newPlayers || 0}</span></div>
                  <div>newPlayers_lte_unique: <span className={
                    (safeTrackerStats.newPlayers || 0) <= (safeTrackerStats.uniquePlayers || 0)
                      ? "text-green-400" : "text-red-400"
                  }>{(safeTrackerStats.newPlayers || 0) <= (safeTrackerStats.uniquePlayers || 0) ? "PASS" : "FAIL"}</span></div>
                  {performanceCharts?.debug?.mismatches?.length ? (
                    <div className="col-span-full">mismatches: <span className="text-red-400 text-[10px]">{JSON.stringify(performanceCharts.debug.mismatches)}</span></div>
                  ) : null}
                  
                  {/* RAW trackerStats from hook - KEY for debugging UI wiring */}
                  <div className="col-span-full mt-2 pt-2 border-t border-amber-500/20">
                    <span className="text-amber-400">RAW trackerStats from hook (WIRING DEBUG):</span>
                  </div>
                  <div>isResponseStale: <span className={analyticsDebugInfo?.isResponseStale ? "text-red-400" : "text-green-400"}>{analyticsDebugInfo?.isResponseStale ? "YES (BAD!)" : "NO"}</span></div>
                  <div>currentSelectedGameId: <span className="text-foreground text-[9px]">{analyticsDebugInfo?.currentSelectedGameId ?? "null"}</span></div>
                  <div>responseSelectedGameId: <span className="text-foreground text-[9px]">{analyticsDebugInfo?.responseSelectedGameId ?? "null"}</span></div>
                  <div>gameIdMatch: <span className={analyticsDebugInfo?.currentSelectedGameId === analyticsDebugInfo?.responseSelectedGameId ? "text-green-400" : "text-red-400"}>{analyticsDebugInfo?.currentSelectedGameId === analyticsDebugInfo?.responseSelectedGameId ? "YES" : "NO (MISMATCH!)"}</span></div>
                  <div>trackerStats_is_null: <span className={trackerStats ? "text-green-400" : "text-red-400"}>{trackerStats ? "NO (has data)" : "YES (null)"}</span></div>
                  <div>raw_totalEvents: <span className="text-foreground">{trackerStats?.totalEvents ?? "null"}</span></div>
                  <div>raw_uniquePlayers: <span className={trackerStats?.uniquePlayers && trackerStats.uniquePlayers > 0 ? "text-green-400" : "text-yellow-400"}>{trackerStats?.uniquePlayers ?? "null"}</span></div>
                  <div>raw_totalSessions: <span className={trackerStats?.totalSessions && trackerStats.totalSessions > 0 ? "text-green-400" : "text-yellow-400"}>{trackerStats?.totalSessions ?? "null"}</span></div>
                  <div>raw_newPlayers: <span className={trackerStats?.newPlayers && trackerStats.newPlayers > 0 ? "text-green-400" : "text-yellow-400"}>{trackerStats?.newPlayers ?? "null"}</span></div>
                  <div>raw_totalPurchases: <span className="text-foreground">{trackerStats?.totalPurchases ?? "null"}</span></div>
                  <div>safe_uniquePlayers: <span className={safeTrackerStats.uniquePlayers > 0 ? "text-green-400" : "text-yellow-400"}>{safeTrackerStats.uniquePlayers}</span></div>
                  <div>safe_totalSessions: <span className={safeTrackerStats.totalSessions > 0 ? "text-green-400" : "text-yellow-400"}>{safeTrackerStats.totalSessions}</span></div>
                  <div>safe_newPlayers: <span className={safeTrackerStats.newPlayers > 0 ? "text-green-400" : "text-yellow-400"}>{safeTrackerStats.newPlayers}</span></div>
                  
                  {/* _debug parsed fields - CRITICAL for diagnosing zeros */}
                  {trackerStats?._debug && (
                    <div className="col-span-full mt-2 p-2 bg-red-900/30 border border-red-500/50 rounded">
                      <div className="text-red-300 font-bold mb-1">Backend _debug (Value Sources):</div>
                      <div>sharedHelperUsed: <span className={trackerStats._debug.sharedHelperUsed ? "text-green-400" : "text-red-400"}>{trackerStats._debug.sharedHelperUsed ? "YES" : "NO (using fallback!)"}</span></div>
                      <div>helperUniquePlayers: <span className="text-foreground">{trackerStats._debug.helperUniquePlayers ?? "null"}</span></div>
                      <div>fallbackUniquePlayers: <span className="text-foreground">{trackerStats._debug.fallbackUniquePlayers ?? "null"}</span></div>
                      <div>usedUniquePlayers: <span className={trackerStats._debug.usedUniquePlayers > 0 ? "text-green-400" : "text-red-400"}>{trackerStats._debug.usedUniquePlayers}</span></div>
                      <div>helperNewPlayers: <span className="text-foreground">{trackerStats._debug.helperNewPlayers ?? "null"}</span></div>
                      <div>fallbackNewPlayers: <span className="text-foreground">{trackerStats._debug.fallbackNewPlayers ?? "null"}</span></div>
                      <div>usedNewPlayers: <span className={trackerStats._debug.usedNewPlayers > 0 ? "text-green-400" : "text-red-400"}>{trackerStats._debug.usedNewPlayers}</span></div>
                      <div>helperTotalSessions: <span className="text-foreground">{trackerStats._debug.helperTotalSessions ?? "null"}</span></div>
                      <div>fallbackTotalSessions: <span className="text-foreground">{trackerStats._debug.fallbackTotalSessions ?? "null"}</span></div>
                      <div>usedTotalSessions: <span className={trackerStats._debug.usedTotalSessions > 0 ? "text-green-400" : "text-red-400"}>{trackerStats._debug.usedTotalSessions}</span></div>
                      {trackerStats._debug.sharedHelperMismatches?.length > 0 && (
                        <div className="text-red-400 mt-1">Mismatches: {JSON.stringify(trackerStats._debug.sharedHelperMismatches)}</div>
                      )}
                    </div>
                  )}
                  
                  <div className="col-span-full">_debug (raw): <span className="text-foreground text-[9px] break-all">{JSON.stringify(trackerStats?._debug ?? "null")}</span></div>
                  
                  {/* Snapshot Diagnostics - KEY for debugging gaps */}
                  <div className="col-span-full mt-2 pt-2 border-t border-amber-500/20">
                    <span className="text-amber-400">Snapshot Diagnostics (15 min window):</span>
                  </div>
                  <div>now: <span className="text-foreground">{rawCcuHistory?.cronStatus?.now ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(String(rawCcuHistory.cronStatus.now))) : "—"}</span></div>
                  <div>latestSnapshotAt: <span className="text-foreground">{rawCcuHistory?.cronStatus?.latestSnapshotAt ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(String(rawCcuHistory.cronStatus.latestSnapshotAt))) : "none"}</span></div>
                  <div>minutesSinceLatest: <span className={Number(rawCcuHistory?.cronStatus?.minutesSinceLatestSnapshot) > 2 ? "text-yellow-400" : "text-green-400"}>{String(rawCcuHistory?.cronStatus?.minutesSinceLatestSnapshot ?? "—")}</span></div>
                  <div>snapshotsLast15Min: <span className={Number(rawCcuHistory?.cronStatus?.snapshotsLast15Minutes) >= 10 ? "text-green-400" : "text-yellow-400"}>{String(rawCcuHistory?.cronStatus?.snapshotsLast15Minutes ?? 0)} / {String(rawCcuHistory?.cronStatus?.expectedSnapshotsLast15Minutes ?? "—")}</span></div>
                  
                  {/* Cron Status */}
                  <div className="col-span-full mt-2 pt-2 border-t border-amber-500/20">
                    <span className="text-amber-400">Vercel Cron ({String(rawCcuHistory?.cronStatus?.cronInterval || "5m")}):</span>
                  </div>
                  <div>cronConfigured: <span className={rawCcuHistory?.cronStatus?.cronConfigured ? "text-green-400" : "text-red-400"}>{rawCcuHistory?.cronStatus?.cronConfigured ? "YES" : "NO"}</span></div>
                  <div>cronRunsLast15Min: <span className="text-foreground">{String(rawCcuHistory?.cronStatus?.cronRunsLast15Minutes ?? 0)}</span></div>
                  <div>latestCronRun: <span className="text-foreground">{(() => {
                    const run = rawCcuHistory?.cronStatus?.latestCronRun as { started_at?: string; ok?: boolean; snapshots_inserted?: number } | null;
                    if (!run?.started_at) return "none";
                    return `${new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(run.started_at))} (${run.ok ? "ok" : "fail"}, ${run.snapshots_inserted ?? 0} inserted)`;
                  })()}</span></div>
                  <div>latestCronSnapshot: <span className="text-foreground">{rawCcuHistory?.cronStatus?.latestCronSnapshotAt ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(String(rawCcuHistory.cronStatus.latestCronSnapshotAt))) : "none"}</span></div>
                  
                  {/* Browser Polling status */}
                  <div className="col-span-full mt-2 pt-2 border-t border-amber-500/20">
                    <span className="text-amber-400">Browser Polling ({String(rawCcuHistory?.cronStatus?.browserPollInterval || "60s")}):</span>
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
                  <div className="font-semibold text-cyan-500 mb-2">CCU History Debug (/api/dashboard/ccu-history)</div>
                  {isLoadingCcuHistory ? (
                    <div className="text-muted-foreground">Loading...</div>
                  ) : ccuHistoryError ? (
                    <div className="text-red-400">Error: {ccuHistoryError}</div>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 text-muted-foreground">
                      <div>endpoint: <span className="text-foreground">/api/dashboard/ccu-history</span></div>
                      <div>selectedGameId: <span className="text-foreground">{ccuHistoryData?.selectedGameId?.slice(0, 8) ?? "none"}...</span></div>
                      <div>selectedGameName: <span className="text-foreground">{ccuHistoryData?.selectedGameName ?? "—"}</span></div>
                      <div>range: <span className="text-foreground">{ccuHistoryData?.range ?? ccuRange}</span></div>
                      <div>rangeStartIso: <span className="text-foreground text-[10px]">{ccuHistoryData?.rangeStartIso?.slice(0, 19) ?? "—"}</span></div>
                      <div>rangeEndIso: <span className="text-foreground text-[10px]">{ccuHistoryData?.rangeEndIso?.slice(0, 19) ?? "—"}</span></div>
                      <div>rowsFoundBeforeSourceFilter: <span className={(ccuHistoryData?.rowsFoundBeforeSourceFilter ?? 0) > 0 ? "text-green-400 font-bold" : "text-red-400 font-bold"}>{ccuHistoryData?.rowsFoundBeforeSourceFilter ?? 0}</span></div>
                      <div>usedSnapshots: <span className={(ccuHistoryData?.usedSnapshots ?? 0) > 0 ? "text-green-400 font-bold" : "text-red-400 font-bold"}>{ccuHistoryData?.usedSnapshots ?? 0}</span></div>
                      <div>chartDataLength: <span className={(ccuHistoryData?.chartDataLength ?? 0) > 1 ? "text-green-400 font-bold" : "text-red-400 font-bold"}>{ccuHistoryData?.chartDataLength ?? 0}</span></div>
                      <div>usedSource: <span className={ccuHistoryData?.usedSource === "romonetize_tracker" ? "text-green-400 font-bold" : "text-foreground"}>{ccuHistoryData?.usedSource ?? "none"}</span></div>
                      <div>latestSnapshotAt: <span className="text-foreground text-[10px]">{ccuHistoryData?.latestSnapshotAt?.slice(0, 19) ?? "none"}</span></div>
                      <div>currentCcu: <span className="text-foreground">{ccuHistoryData?.currentCcu ?? "—"}</span></div>
                      <div className="col-span-full">sourceCounts: <span className="text-foreground">{JSON.stringify(ccuHistoryData?.sourceCounts ?? {})}</span></div>
                      {ccuHistoryData?.chartData?.[0] && (
                        <div className="col-span-full">firstChartPoint: <span className="text-foreground text-[10px]">{JSON.stringify(ccuHistoryData.chartData[0])}</span></div>
                      )}
                      {ccuHistoryData?.chartData?.length > 0 && (
                        <div className="col-span-full">lastChartPoint: <span className="text-foreground text-[10px]">{JSON.stringify(ccuHistoryData.chartData[ccuHistoryData.chartData.length - 1])}</span></div>
                      )}
                      {ccuHistoryData?.rowsFoundBeforeSourceFilter === 0 && ccuHistoryData?.debugRecentSnapshotsAnyGame && (
                        <div className="col-span-full text-amber-400">
                          debugRecentSnapshotsAnyGame (20 most recent for ANY game): 
                          <span className="text-foreground text-[10px] block mt-1">{JSON.stringify(ccuHistoryData.debugRecentSnapshotsAnyGame.slice(0, 5))}</span>
                        </div>
                      )}
                      {ccuHistoryData?.rowsFoundBeforeSourceFilter > 0 && ccuHistoryData?.usedSnapshots === 0 && (
                        <div className="col-span-full text-red-400 font-bold">ISSUE: Rows exist but no preferred source matched</div>
                      )}
                    </div>
                  )}
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
                            time?: string;
                            label?: string;
                            ccu?: number;
                            source?: string;
                          };
                          if (!dataPoint) return null;
                          
                          // Format time for tooltip
                          const tooltipLabel = dataPoint.time 
                            ? new Intl.DateTimeFormat(undefined, { 
                                day: "numeric",
                                month: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                              }).format(new Date(dataPoint.time))
                            : dataPoint.label ?? "";
                          
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
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center">
                    {isLoadingCcuHistory ? (
                      <>
                        <RefreshCw className="w-10 h-10 mb-3 text-muted-foreground animate-spin" />
                        <h4 className="font-medium text-foreground mb-2">Loading CCU History...</h4>
                      </>
                    ) : ccuHistoryError ? (
                      <>
                        <AlertCircle className="w-10 h-10 mb-3 text-red-400" />
                        <h4 className="font-medium text-red-400 mb-2">Failed to load CCU History</h4>
                        <p className="text-sm text-muted-foreground max-w-md">{ccuHistoryError}</p>
                        <Button onClick={fetchCcuHistory} variant="outline" size="sm" className="mt-4">
                          <RefreshCw className="w-4 h-4 mr-2" />
                          Retry
                        </Button>
                      </>
                    ) : ccuHistoryData?.usedSnapshots > 0 && ccuHistoryData?.chartDataLength === 0 ? (
                      // usedSnapshots > 0 but chartDataLength === 0 = chart generation failed
                      <>
                        <AlertCircle className="w-10 h-10 mb-3 text-amber-400" />
                        <h4 className="font-medium text-amber-400 mb-2">CCU chart generation failed</h4>
                        <p className="text-sm text-muted-foreground max-w-md">
                          {ccuHistoryData.usedSnapshots} snapshots exist but chart could not be generated.
                        </p>
                      </>
                    ) : ccuHistoryData?.rowsFoundBeforeSourceFilter === 0 ? (
                      // No snapshots at all for this game
                      <>
                        <Activity className="w-10 h-10 mb-3 text-muted-foreground" />
                        <h4 className="font-medium text-foreground mb-2">No CCU data for this range</h4>
                        <p className="text-sm text-muted-foreground max-w-md">
                          No CCU snapshots found for this game in the selected time range.
                          Refresh Roblox data to start collecting snapshots.
                        </p>
                        <Button onClick={handleSyncAndRefresh} variant="outline" size="sm" className="mt-4">
                          <RefreshCw className="w-4 h-4 mr-2" />
                          Refresh Data
                        </Button>
                      </>
                    ) : ccuHistoryData?.rowsFoundBeforeSourceFilter > 0 && ccuHistoryData?.usedSnapshots === 0 ? (
                      // Rows exist but no preferred source matched
                      <>
                        <Activity className="w-10 h-10 mb-3 text-amber-400" />
                        <h4 className="font-medium text-amber-400 mb-2">Snapshots exist but no preferred source matched</h4>
                        <p className="text-sm text-muted-foreground max-w-md">
                          {ccuHistoryData.rowsFoundBeforeSourceFilter} snapshots found, but none from romonetize_tracker or roblox_api.
                        </p>
                      </>
                    ) : (
                      // Fallback empty state
                      <>
                        <Activity className="w-10 h-10 mb-3 text-muted-foreground" />
                        <h4 className="font-medium text-foreground mb-2">No CCU data available</h4>
                        <p className="text-sm text-muted-foreground max-w-md">
                          CCU snapshots will appear after your game starts sending data.
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
              summary={cardStats.totalEvents > 0 ? `Total: ${cardStats.totalEvents.toLocaleString()}` : undefined}
              isEmpty={normalizedActivity.length === 0 && cardStats.totalEvents === 0}
              emptyTitle="No tracking data yet"
              emptyMessage="Activity will appear after players interact with your game."
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={normalizedActivity} margin={{ top: 20, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="eventsGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART_COLORS.violet} stopOpacity={1}/>
                      <stop offset="100%" stopColor={CHART_COLORS.violet} stopOpacity={0.7}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...gridProps} />
                  <XAxis 
                    dataKey="time" 
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
                    dataKey="value" 
                    fill="url(#eventsGradient)"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={50}
                  >
                    {normalizedActivity.length <= 3 && (
                      <LabelList dataKey="value" position="top" fill={chartTheme.label} fontSize={12} fontWeight={600} />
                    )}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* Total Sessions Over Time - matches Total Sessions card */}
            <ChartCard
              title="Total Sessions Over Time"
              subtitle="Player join events (session starts)"
              source="tracker"
              summary={cardStats.totalSessions > 0 ? `Total: ${cardStats.totalSessions.toLocaleString()}` : undefined}
              isEmpty={normalizedSessions.length === 0 && cardStats.totalSessions === 0}
              emptyTitle="No session data yet"
              emptyMessage="Sessions will appear after players start sessions in your game."
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={normalizedSessions} margin={{ top: 20, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="sessionsGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART_COLORS.cyan} stopOpacity={1}/>
                      <stop offset="100%" stopColor={CHART_COLORS.cyan} stopOpacity={0.7}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...gridProps} />
                  <XAxis 
                    dataKey="time" 
                    tickFormatter={(v) => formatChartTime(v, toChartTimeRange(chartRange))}
                    {...axisProps}
                  />
                  <YAxis 
                    allowDecimals={false}
                    {...axisProps}
                  />
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(value: number) => [value.toLocaleString(), "Sessions"]}
                    labelFormatter={(label) => formatChartTime(label, toChartTimeRange(chartRange))}
                  />
                  <Bar 
                    dataKey="value" 
                    fill="url(#sessionsGradient)"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={50}
                  >
                    {normalizedSessions.length <= 3 && (
                      <LabelList dataKey="value" position="top" fill={chartTheme.label} fontSize={12} fontWeight={600} />
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
              summary={cardStats.totalPurchases && cardStats.totalPurchases > 0 ? `Total: ${cardStats.totalPurchases.toLocaleString()}` : undefined}
              isEmpty={normalizedPurchases.length === 0 && (!cardStats.totalPurchases || cardStats.totalPurchases === 0)}
                emptyTitle="No purchases yet"
                emptyMessage="Purchases will appear after players make purchases in your game."
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={normalizedPurchases} margin={{ top: 20, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="purchasesBarGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={CHART_COLORS.green} stopOpacity={1}/>
                        <stop offset="100%" stopColor={CHART_COLORS.green} stopOpacity={0.7}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid {...gridProps} />
                    <XAxis 
                      dataKey="time" 
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
                      dataKey="value" 
                      fill="url(#purchasesBarGradient)"
                      radius={[6, 6, 0, 0]}
                      maxBarSize={50}
                    >
                      {normalizedPurchases.length <= 3 && (
                        <LabelList dataKey="value" position="top" fill={chartTheme.label} fontSize={12} fontWeight={600} />
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
