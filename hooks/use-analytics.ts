"use client";

import { useState, useCallback } from "react";
import useSWR from "swr";
import { useRealtimeStats } from "./use-realtime-stats";
import { useStatsRefresh } from "./use-stats-refresh";

export type DateRange = "1h" | "1d" | "7d" | "30d";

export interface DataHealth {
  selectedGameId: string | null;
  robloxGameId: string | null;
  rootPlaceId: string | null;
  gameName: string | null;
  hasTrackerEvents: boolean;
  trackerEventsCount: number;
  lastTrackerEventAt: string | null;
  hasRobloxApiData: boolean;
  robloxApiLastSyncedAt: string | null;
  missing: string[];
}

export interface RobloxStats {
  ccu: number | null;
  visits: number | null;
  favorites: number | null;
  likes: number | null;
  dislikes: number | null;
  likeRatio: number | null;
  updatedAt: string | null;
}

export interface TrackerStats {
  totalEvents: number;
  uniquePlayers: number;
  totalSessions: number;
  avgSessionDuration: number | null;
  avgSessionFormatted: string | null;
  newPlayers: number;
  returningPlayers: number;
  totalPurchases: number;
  lastEventTime: string | null;
}

export interface RevenueStats {
  totalRevenue: number;
  gamepassRevenue: number;
  devproductRevenue: number;
  totalPurchases: number;
  payingUsers: number;
  conversionRate: number;
  arpdau: number;
  arppu: number;
}

export interface ProductInfo {
  id: string;
  name: string;
  type: string;
  revenue: number;
  purchases: number;
  uniqueBuyers: number;
  clicks: number;
  conversionRate: number | null;
  conversionNeedsTracking: boolean;
  revPerBuyer: number;
}

export interface ProductStats {
  totalRevenue: number;
  totalPurchases: number;
  uniqueBuyers: number;
  avgConversionRate: number | null;
  avgConversionNeedsTracking: boolean;
  products: ProductInfo[];
  hasTrackerData: boolean;
}

export interface RetentionStats {
  day1: number | null;
  day7: number | null;
  day30: number | null;
  day1Message: string | null;
  day7Message: string | null;
  day30Message: string | null;
}

export interface CCUStats {
  current: number | null;
  peak: number | null;
  avg: number | null;
  snapshots: Array<{ time: string; ccu: number }>;
  message: string | null;
}

export interface OverviewStats {
  totalRevenue: number;
  totalPurchases: number;
  uniquePlayers: number;
  playerJoins: number;
  conversionRate: number | null;
  purchaseRate: number | null;
}

export interface ChartData {
  revenue: Array<{ time: string; revenue: number; purchases: number; passes: number; devProducts: number }>;
  players: Array<{ time: string; players: number }>;
}

export interface AnalyticsData {
  game: {
    id: string;
    name: string;
    roblox_game_id: string;
    universe_id: string | null;
  } | null;
  range: DateRange;
  dataHealth: DataHealth | null;
  robloxStats: RobloxStats | null;
  overview: OverviewStats | null;
  trackerStats: TrackerStats | null;
  revenueStats: RevenueStats | null;
  productStats: ProductStats | null;
  retentionStats: RetentionStats | null;
  ccuStats: CCUStats | null;
  charts: ChartData | null;
  sectionErrors: Record<string, string>;
  lastUpdated: string;
}

interface UseAnalyticsOptions {
  gameId?: string;
  range?: DateRange;
  enabled?: boolean;
}

const fetcher = async (url: string) => {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to fetch analytics");
  }
  const json = await response.json();
  if (!json.success) {
    throw new Error(json.error || "Analytics request failed");
  }
  return json.data as AnalyticsData;
};

/**
 * Centralized analytics hook that provides consistent data across all dashboard tabs
 * Uses SWR for caching, deduplication, and revalidation
 */
export function useAnalytics({ gameId, range = "7d", enabled = true }: UseAnalyticsOptions = {}) {
  const [manualRefreshing, setManualRefreshing] = useState(false);

  // Build API URL
  const apiUrl = enabled
    ? `/api/dashboard/analytics?range=${range}${gameId ? `&gameId=${gameId}` : ""}`
    : null;

  // Use SWR for data fetching with caching
  const { data, error, isLoading, mutate } = useSWR<AnalyticsData>(
    apiUrl,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 5000, // Dedupe requests within 5 seconds
      refreshInterval: 0, // Don't auto-refresh, we use realtime
    }
  );

  // Get game IDs for realtime subscription
  const gameIds = data?.game?.id ? [data.game.id] : [];

  // Realtime subscription
  const { isLive, status: realtimeStatus } = useRealtimeStats({
    gameIds,
    onNewEvent: () => mutate(),
    enabled: enabled && gameIds.length > 0,
  });

  // Listen for global stats refresh
  useStatsRefresh(() => mutate());

  // Manual refresh function
  const refresh = useCallback(async () => {
    setManualRefreshing(true);
    try {
      await mutate();
    } finally {
      setManualRefreshing(false);
    }
  }, [mutate]);

  // Format time in user's timezone
  const formatTime = useCallback((isoString: string | null | undefined) => {
    if (!isoString) return null;
    try {
      return new Date(isoString).toLocaleString(undefined, {
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
    } catch {
      return isoString;
    }
  }, []);

  // Format time ago
  const formatTimeAgo = useCallback((isoString: string | null | undefined) => {
    if (!isoString) return null;
    try {
      const diff = Date.now() - new Date(isoString).getTime();
      const minutes = Math.floor(diff / 60000);
      const hours = Math.floor(diff / 3600000);
      const days = Math.floor(diff / 86400000);

      if (minutes < 1) return "Just now";
      if (minutes < 60) return `${minutes}m ago`;
      if (hours < 24) return `${hours}h ago`;
      return `${days}d ago`;
    } catch {
      return null;
    }
  }, []);

  // Helper to check if tracking script is needed
  const needsTrackingScript = data?.dataHealth?.missing.includes("tracking_script_not_installed") ?? false;
  const hasRobloxData = data?.dataHealth?.hasRobloxApiData ?? false;
  const hasTrackerData = data?.dataHealth?.hasTrackerEvents ?? false;

  return {
    // Data
    data,
    game: data?.game ?? null,
    dataHealth: data?.dataHealth ?? null,
    robloxStats: data?.robloxStats ?? null,
    overview: data?.overview ?? null,
    trackerStats: data?.trackerStats ?? null,
    revenueStats: data?.revenueStats ?? null,
    productStats: data?.productStats ?? null,
    retentionStats: data?.retentionStats ?? null,
    ccuStats: data?.ccuStats ?? null,
    charts: data?.charts ?? null,
    sectionErrors: data?.sectionErrors ?? {},
    lastUpdated: data?.lastUpdated ?? null,

    // Data health helpers
    needsTrackingScript,
    hasRobloxData,
    hasTrackerData,

    // State
    isLoading,
    isRefreshing: manualRefreshing,
    error: error?.message ?? null,
    isLive,
    realtimeStatus,

    // Actions
    refresh,
    mutate,

    // Utilities
    formatTime,
    formatTimeAgo,
  };
}

/**
 * Get range configuration for display
 */
export function getRangeLabel(range: DateRange): string {
  switch (range) {
    case "1h":
      return "Last 1 hour";
    case "1d":
      return "Last 24 hours";
    case "7d":
      return "Last 7 days";
    case "30d":
      return "Last 30 days";
    default:
      return "Last 7 days";
  }
}

/**
 * Get chart bucket label based on range
 */
export function formatChartTime(timeStr: string, range: DateRange): string {
  const date = new Date(timeStr);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  if (range === "1h" || range === "1d") {
    // Hourly format: "Mon 14:00"
    return date.toLocaleString(undefined, {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: false,
      timeZone: tz,
    });
  } else {
    // Daily format: "Jan 15"
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      timeZone: tz,
    });
  }
}
