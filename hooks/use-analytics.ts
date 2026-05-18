"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import useSWR from "swr";
import { useRealtimeStats } from "./use-realtime-stats";
import { useStatsRefresh } from "./use-stats-refresh";

export type DateRange = "1h" | "1d" | "7d" | "30d" | "90d";

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
  hasSyncedProducts: boolean;
  syncedProductsCount: number;
  missing: string[];
}

export interface SyncedProduct {
  id: string;
  robloxProductId: string;
  name: string;
  productType: string;
  priceRobux: number;
  isForSale: boolean;
  iconUrl: string | null;
  syncedAt: string;
}

export interface SyncedProductsData {
  products: SyncedProduct[];
  totalCount: number;
  gamepasses: number;
  devProducts: number;
  hasSyncedProducts: boolean;
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
  // New players = players whose first event for this game is within the selected range
  newPlayers: number;
  // Legacy alias (same as newPlayers)
  firstSeenPlayers: number;
  // Returning players = players who were seen BEFORE range AND are active in range
  // Invariant: newPlayers + returningPlayers = uniquePlayers
  returningPlayers: number;
  hasHistoryBeforeRange: boolean;
  // Status for returning players UI: "ok" | "no_players" | "no_returning_yet" | "needs_history"
  returningPlayersStatus: "ok" | "no_players" | "no_returning_yet" | "needs_history";
  rangeStart: string;
  rangeEnd: string;
  totalPurchases: number;
  lastEventTime: string | null;
}

export interface RevenueStats {
  // Gross values (raw tracked sales)
  grossRevenue: number;
  grossRevenue72h: number;
  grossGamepassRevenue: number;
  grossDevproductRevenue: number;
  grossArpdau: number;
  grossArppu: number;
  // Estimated values (70% creator payout)
  estimatedRevenue: number;
  estimatedRevenue72h: number;
  estimatedGamepassRevenue: number;
  estimatedDevproductRevenue: number;
  estimatedArpdau: number;
  estimatedArppu: number;
  // Legacy fields for backwards compatibility
  totalRevenue: number;
  revenue72h: number;
  gamepassRevenue: number;
  devproductRevenue: number;
  arpdau: number;
  arppu: number;
  // Non-revenue metrics
  totalPurchases: number;
  gamepassPurchases: number;
  devproductPurchases: number;
  payingUsers: number;
  conversionRate: number;
  // 72h product type breakdown
  gamepassRevenue72h: number;
  devproductRevenue72h: number;
  gamepassPurchases72h: number;
  devproductPurchases72h: number;
  // DAU metrics for ARPDAU calculation
  averageDau?: number;
  daysWithData?: number;
  // === Active user metrics from ACTIVE_USER_EVENT_TYPES (for PCR & ARPDAU) ===
  trackerActiveUsers?: number;
  trackerPayingUsers?: number;
  trackerAverageDau?: number;
  trackerDaysWithData?: number;
  trackerActiveUserEventCounts?: Record<string, number>;
  sampleActiveUserEvents?: string[];
  trackerPcr?: number | null;
  trackerGrossArpdau?: number | null;
}

export interface ProductInfo {
  id: string;
  name: string;
  type: string;
  // Gross values
  grossRevenue?: number;
  grossRevenuePerBuyer?: number;
  // Estimated values (70% creator payout)
  estimatedRevenue?: number;
  estimatedRevenuePerBuyer?: number;
  // Legacy fields
  revenue: number;
  revPerBuyer: number;
  // Non-revenue metrics
  purchases: number;
  uniqueBuyers: number;
  clicks: number;
  conversionRate: number | null;
  conversionNeedsTracking: boolean;
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

export type CCUHistoryRange = "1h" | "24h" | "7d" | "28d" | "90d";
export type CCUHistoryInterval = "1m" | "hourly" | "daily";

export interface CCUHistory {
  currentCcu: number | null;
  // Raw snapshots - client handles bucketing and time formatting
  rawSnapshots: Array<{ time: string; ccu: number; source?: string }>;
  // Data source identifier
  source?: string;
  // Cron debug status
  cronStatus?: Record<string, unknown>;
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

export interface PerformanceCharts {
  eventsOverTime: Array<{ date: string; events: number }>;
  playersOverTime: Array<{ date: string; players: number }>;
  sessionsOverTime: Array<{ date: string; sessions: number }>;
  purchasesOverTime: Array<{ date: string; purchases: number }>;
  ccuOverTime: Array<{ time: string; ccu: number }>;
}

export interface HourlyMonetizationPoint {
  time: string;
  totalRevenue: number;
  devproductRevenue: number;
  gamepassRevenue: number;
  purchases: number;
  gamepassPurchases?: number;
  devproductPurchases?: number;
}

export interface MonetizationCharts {
  revenueOverTime: Array<{ date: string; revenue: number }>;
  purchasesOverTime: Array<{ date: string; purchases: number }>;
  revenueByProductType: Array<{ productType: string; revenue: number }>;
  // Top products with both gross and estimated values
  topProducts: Array<{ 
    productId: string; 
    productName: string; 
    productType: string; 
    revenue: number; // Legacy: gross revenue
    grossRevenue?: number;
    estimatedRevenue?: number;
    purchases: number; 
    buyers: number;
  }>;
  // 72h hourly monetization data
  hourlyMonetization: HourlyMonetizationPoint[];
  // 24h minute-level monetization data (for real-time 1m interval)
  minuteMonetization: HourlyMonetizationPoint[];
  // 72h totals with product type breakdown
  revenue72h: number;
  gamepassRevenue72h: number;
  devproductRevenue72h: number;
  purchaseCount72h: number;
  gamepassPurchases72h: number;
  devproductPurchases72h: number;
}

export interface ProductAnalyticsItem {
  productId: string;
  productName: string;
  productType: string;
  // Gross values (before 30% Roblox fee)
  grossRevenue: number;
  grossRevenuePerBuyer: number;
  // Estimated values (after 30% Roblox fee - creator payout)
  estimatedRevenue: number;
  estimatedRevenuePerBuyer: number;
  // Counts
  purchases: number;
  buyers: number;
  views: number;
  clicks: number;
  // Metrics - conversion rate calculated as: purchases / clicks (or purchases / views if no clicks)
  conversionRate: number | null;
  // If true, purchases exist but no views/clicks tracked yet
  conversionNeedsTracking: boolean;
}

export interface ProductAnalyticsTopProduct {
  productId: string;
  productName: string;
  productType: string;
  grossRevenue: number;
  estimatedRevenue: number;
  purchases: number;
  buyers: number;
}

export interface ProductAnalytics {
  products: ProductAnalyticsItem[];
  // Top 4 products for Overview page (same data as products, just sliced)
  topProducts: ProductAnalyticsTopProduct[];
  // Summary totals
  totalPurchases: number;
  totalBuyers: number;
  grossTotalRevenue: number;
  estimatedTotalRevenue: number;
  // Debug info
  aggregationSource: string;
  totalEventsUsed: number;
  hitSupabaseLimit: boolean;
  selectedRange: string;
  locked: boolean;
}

export interface AnalyticsData {
  // Selected game identity - must match current selection before rendering
  selectedGameId: string | null;
  selectedGameName: string | null;
  robloxGameId: string | null;
  game: {
    id: string;
    name: string;
    roblox_game_id: string;
    universe_id: string | null;
    icon_url?: string | null;
  } | null;
  range: DateRange;
  // Plan-based monetization gating
  monetizationLocked: boolean;
  userPlan: string;
  dataHealth: DataHealth | null;
  robloxStats: RobloxStats | null;
  overview: OverviewStats | null;
  trackerStats: TrackerStats | null;
  revenueStats: RevenueStats | null;
  productStats: ProductStats | null;
  syncedProducts: SyncedProductsData | null;
  retentionStats: RetentionStats | null;
  ccuStats: CCUStats | null;
  ccuHistory: CCUHistory | null;
  charts: ChartData | null;
  performanceCharts: PerformanceCharts | null;
  monetizationCharts: MonetizationCharts | null;
  productAnalytics: ProductAnalytics | null;
  sectionErrors: Record<string, string>;
  lastUpdated: string;
}

interface UseAnalyticsOptions {
  gameId?: string;
  selectedGameId?: string; // Pass current selected game ID to validate responses
  range?: DateRange;
  monetizationRangeHours?: number; // Optional: hours for monetization metric calculations (PCR, ARPPU, ARPDAU)
  enabled?: boolean;
}

// Custom fetcher with 8 second timeout to prevent infinite skeleton
const fetcher = async (url: string) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout
  
  try {
    const response = await fetch(url, { 
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error("Failed to fetch analytics");
    }
    const json = await response.json();
    if (!json.success) {
      throw new Error(json.error || "Analytics request failed");
    }
    return json.data as AnalyticsData;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Request timed out - showing cached data");
    }
    throw err;
  }
};

/**
 * Centralized analytics hook that provides consistent data across all dashboard tabs
 * Uses SWR for caching, deduplication, and revalidation
 * 
 * IMPORTANT: Cache key includes selectedGameId to ensure data isolation between games.
 * When selectedGameId changes, cache is invalidated and fresh data is fetched.
 */
export function useAnalytics({ gameId, selectedGameId, range = "7d", monetizationRangeHours, enabled = true }: UseAnalyticsOptions = {}) {
  const [manualRefreshing, setManualRefreshing] = useState(false);
  // Track the current selected game ID - starts null, gets populated from API response or game change event
  const [currentSelectedGameId, setCurrentSelectedGameId] = useState<string | null>(selectedGameId || null);
  // Track pending game change to show loading state immediately
  const [isPendingGameChange, setIsPendingGameChange] = useState(false);
  // Track request ID to ignore stale responses from in-flight requests
  const requestIdRef = useRef(0);
  // Track last fetch timestamp for debug
  const [lastFetchAt, setLastFetchAt] = useState<string | null>(null);
  
  // Build SWR cache key
  // - When currentSelectedGameId is known, include it for proper cache isolation
  // - On initial load (null), use "auto" to let API determine selected game server-side
  // This ensures we fetch data on initial load even before knowing the selected game
  const effectiveGameKey = currentSelectedGameId || "auto";
  const swrKey = enabled
    ? ["analytics", effectiveGameKey, range, monetizationRangeHours || "default", gameId || "default"]
    : null;
  
  // Build API URL - only include selectedGameId if explicitly set (for game switching)
  // On initial load, the API uses the server-side is_selected game
  const apiUrl = `/api/dashboard/analytics?range=${range}${monetizationRangeHours ? `&monetizationRangeHours=${monetizationRangeHours}` : ""}${gameId ? `&gameId=${gameId}` : ""}${currentSelectedGameId ? `&selectedGameId=${currentSelectedGameId}` : ""}`;

  // Custom fetcher that uses the URL and tracks fetch time
  const swrFetcher = useCallback(async () => {
    const data = await fetcher(apiUrl);
    setLastFetchAt(new Date().toISOString());
    return data;
  }, [apiUrl]);

  // Use SWR for data fetching with caching
  // Auto-refresh every 60 seconds for Roblox public stats (per spec)
  const { data, error, isLoading, mutate } = useSWR<AnalyticsData>(
    swrKey,
    swrFetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 5000, // Dedupe requests within 5 seconds
      refreshInterval: 60000, // Auto-refresh every 60 seconds for Roblox stats
      // Clear data immediately when key changes (game switch)
      keepPreviousData: false,
    }
  );
  
  // On initial load, populate currentSelectedGameId from API response
  // This ensures subsequent cache keys are game-specific
  useEffect(() => {
    if (data?.selectedGameId && !currentSelectedGameId) {
      setCurrentSelectedGameId(data.selectedGameId);
    }
  }, [data?.selectedGameId, currentSelectedGameId]);

  // Validate response matches current selected game - ignore stale responses from in-flight requests
  // IMPORTANT: Only consider response stale if:
  // 1. We have data from API
  // 2. We have an explicit currentSelectedGameId set (not initial load)
  // 3. The response's selectedGameId differs from currentSelectedGameId
  // 4. BOTH IDs are truthy strings (not null/undefined/empty)
  const isResponseStale = Boolean(
    data?.selectedGameId && 
    currentSelectedGameId && 
    data.selectedGameId !== currentSelectedGameId
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

  // Listen for selected game changes and reset analytics state
  useEffect(() => {
    const handleGameChange = (event: CustomEvent<{ gameId: string; robloxGameId: string }>) => {
      const newGameId = event.detail.gameId;
      const previousGameId = currentSelectedGameId;
      
      // Skip if same game
      if (newGameId === previousGameId) return;
      
      // Increment request ID to invalidate any in-flight requests
      requestIdRef.current += 1;
      const thisRequestId = requestIdRef.current;
      
      // Debug in development
      if (process.env.NODE_ENV === "development") {
        console.log("[v0] Game switch detected", {
          previousGameId,
          newGameId,
          action: "clearing_cache_and_switching",
          requestId: thisRequestId,
        });
      }
      
      // Show loading state immediately - clear previous data from view
      setIsPendingGameChange(true);
      
      // Update current selected game ID - this changes the SWR cache key,
      // which automatically triggers a new fetch for the new game
      setCurrentSelectedGameId(newGameId);
      
      // Clear the OLD game's cache entry explicitly (SWR key was the old key)
      // The new key will trigger a fresh fetch automatically
      mutate(undefined, { revalidate: false });
      
      // Clear pending state after a short delay to allow SWR to start new fetch
      // The isLoading state from SWR will take over
      setTimeout(() => {
        if (requestIdRef.current === thisRequestId) {
          setIsPendingGameChange(false);
        }
      }, 100);
    };

    window.addEventListener("selected-game-changed", handleGameChange as EventListener);
    return () => {
      window.removeEventListener("selected-game-changed", handleGameChange as EventListener);
    };
  }, [mutate, currentSelectedGameId]);

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
  const hasSyncedProducts = data?.dataHealth?.hasSyncedProducts ?? false;
  
  // Use safe data that ignores stale responses
  const safeData = isResponseStale ? null : data;
  
  // Debug info for tracking data scope and cache behavior
  const debugInfo = {
    // Game identity
    currentSelectedGameId,
    responseSelectedGameId: data?.selectedGameId ?? null,
    selectedGameName: data?.selectedGameName ?? null,
    // Cache/fetch state
    isResponseStale,
    isPendingGameChange,
    isLoading,
    swrKey: swrKey ? JSON.stringify(swrKey) : null,
    lastFetchAt,
    requestId: requestIdRef.current,
    // Tracker status - THE KEY DIAGNOSTIC for this regression
    hasTrackerEvents: data?.dataHealth?.hasTrackerEvents ?? false,
    trackerEventsCount: data?.dataHealth?.trackerEventsCount ?? 0,
    lastTrackerEventAt: data?.dataHealth?.lastTrackerEventAt ?? null,
    needsTrackingScript,
    hasTrackerData,
    // What the missing array says
    missingFlags: data?.dataHealth?.missing ?? [],
    // CCU data validation
    ccuPointsCount: data?.ccuHistory?.rawSnapshots?.length ?? 0,
    ccuCurrentValue: data?.ccuHistory?.currentCcu ?? null,
    // Plan info
    userPlan: data?.userPlan ?? "unknown",
    monetizationLocked: data?.monetizationLocked ?? false,
  };

  // Debug in development when data arrives
  useEffect(() => {
    if (process.env.NODE_ENV === "development" && data && !isResponseStale) {
      console.log("[v0] Analytics data loaded", {
        ...debugInfo,
        trackedActions: data.trackerStats?.totalEvents ?? 0,
        estimatedRevenue: data.revenueStats?.estimatedRevenue ?? 0,
        purchases: data.revenueStats?.totalPurchases ?? 0,
      });
    }
  }, [data, isResponseStale, currentSelectedGameId, debugInfo]);

  return {
    // Data - return null if response is stale or pending game change
    data: safeData,
    game: safeData?.game ?? null,
    // CRITICAL FIX: Always return dataHealth from data (not safeData) so hasTrackerEvents is correct
    dataHealth: data?.dataHealth ?? null,
    robloxStats: safeData?.robloxStats ?? null,
    overview: safeData?.overview ?? null,
    // CRITICAL FIX: Always return trackerStats from data (not safeData) to prevent zeros
    // The stale check is for game-switching scenarios, but trackerStats should always show
    // the latest backend values. The backend already validates game ownership.
    trackerStats: data?.trackerStats ?? null,
    revenueStats: safeData?.revenueStats ?? null,
    productStats: safeData?.productStats ?? null,
    syncedProducts: safeData?.syncedProducts ?? null,
    retentionStats: safeData?.retentionStats ?? null,
    ccuStats: safeData?.ccuStats ?? null,
    // CRITICAL FIX: Always return ccuHistory from data (not safeData) to prevent stale cache
    // Fresh snapshots should show immediately after refresh, not wait for cache invalidation
    ccuHistory: data?.ccuHistory ?? null,
    charts: safeData?.charts ?? null,
    // CRITICAL FIX: Always return performanceCharts from data (not safeData)
    performanceCharts: data?.performanceCharts ?? null,
    monetizationCharts: safeData?.monetizationCharts ?? null,
    productAnalytics: safeData?.productAnalytics ?? null,
    sectionErrors: safeData?.sectionErrors ?? {},
    lastUpdated: safeData?.lastUpdated ?? null,
    
    // Selected game identity - for UI to verify data matches selection
    selectedGameId: safeData?.selectedGameId ?? null,
    selectedGameName: safeData?.selectedGameName ?? null,

    // Data health helpers
    needsTrackingScript: safeData ? needsTrackingScript : false,
    hasRobloxData: safeData ? hasRobloxData : false,
    hasTrackerData: safeData ? hasTrackerData : false,
    hasSyncedProducts: safeData ? hasSyncedProducts : false,
    
    // Plan-based monetization gating
    monetizationLocked: safeData?.monetizationLocked ?? false,
    userPlan: safeData?.userPlan ?? "free",

    // State - show loading during game change or stale data
    isLoading: isLoading || isPendingGameChange || isResponseStale,
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
    
    // Debug info for troubleshooting game switching issues
    debugInfo,
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
 * Uses undefined locale to respect user's browser timezone
 */
export function formatChartTime(timeStr: string, range: DateRange): string {
  const date = new Date(timeStr);

  if (range === "1h" || range === "1d") {
    // Time only format in user's local timezone: "14:32"
    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } else {
    // Daily format in user's local: "15 Jan"
    return date.toLocaleDateString(undefined, {
      day: "2-digit",
      month: "short",
    });
  }
}
