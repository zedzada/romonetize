import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRobloxGameStats } from "@/lib/services/roblox-api";
import { getSelectedGameForUser, getAllGamesForUser, type GameSummary } from "@/lib/server/selected-game";
import { calculatePeriodMetrics, type EventWithMetrics } from "@/lib/metrics/arppu-arpdau";
import { 
  aggregateProducts, 
  getTopProducts,
  getEventRobux as getEventRobuxShared,
  CREATOR_REVENUE_RATE,
  type ProductPurchaseEvent,
  type ProductClickEvent,
  type ProductViewEvent,
  type RobloxProductInfo,
  type AggregatedProduct,
} from "@/lib/utils/product-aggregation";

// Date range options
type DateRange = "1h" | "1d" | "7d" | "30d" | "90d";

// Supabase default row limit - must paginate if more rows expected
const SUPABASE_PAGE_SIZE = 1000;

// Helper to fetch all rows with pagination (bypasses 1000 row limit)
async function fetchAllRows<T>(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: string,
  query: {
    select: string;
    filters: Array<{ column: string; operator: string; value: unknown }>;
    order?: { column: string; ascending: boolean };
  }
): Promise<T[]> {
  const allRows: T[] = [];
  let from = 0;
  let hasMore = true;
  
  while (hasMore) {
    let queryBuilder = supabase
      .from(table)
      .select(query.select)
      .range(from, from + SUPABASE_PAGE_SIZE - 1);
    
    // Apply filters
    for (const filter of query.filters) {
      if (filter.operator === "eq") {
        queryBuilder = queryBuilder.eq(filter.column, filter.value);
      } else if (filter.operator === "in") {
        queryBuilder = queryBuilder.in(filter.column, filter.value as unknown[]);
      } else if (filter.operator === "gte") {
        queryBuilder = queryBuilder.gte(filter.column, filter.value);
      } else if (filter.operator === "lte") {
        queryBuilder = queryBuilder.lte(filter.column, filter.value);
      }
    }
    
    // Apply order
    if (query.order) {
      queryBuilder = queryBuilder.order(query.order.column, { ascending: query.order.ascending });
    }
    
    const { data, error } = await queryBuilder;
    
    if (error) throw error;
    
    if (data && data.length > 0) {
      allRows.push(...(data as T[]));
      from += SUPABASE_PAGE_SIZE;
      hasMore = data.length === SUPABASE_PAGE_SIZE;
    } else {
      hasMore = false;
    }
  }
  
  return allRows;
}

function getRangeConfig(range: DateRange): { hours: number; bucketMinutes: number } {
  switch (range) {
    case "1h":
      return { hours: 1, bucketMinutes: 5 };
    case "1d":
      return { hours: 24, bucketMinutes: 60 };
    case "7d":
      return { hours: 168, bucketMinutes: 1440 };
    case "30d":
      return { hours: 720, bucketMinutes: 1440 };
    case "90d":
      return { hours: 2160, bucketMinutes: 1440 }; // 90 days, daily buckets
    default:
      return { hours: 168, bucketMinutes: 1440 };
  }
}

/**
 * Central Analytics API
 * 
 * All dashboard tabs use this single endpoint for consistent data.
 * Uses the selected game (is_selected = true) as the single source of truth.
 * 
 * GET /api/dashboard/analytics?range=7d&debug=true
 * 
 * Returns:
 * - dataHealth: diagnostic info about data availability
 * - robloxStats: public Roblox API stats (CCU, visits, favorites, etc)
 * - trackerStats: deep analytics from tracking script
 * - All other analytics data
 */
export async function GET(request: NextRequest) {
  // Debug tracking
  let step = "init";
  let authUserId: string | null = null;
  let queryGameId: string | null = null;
  let selectedGameUsed: Record<string, unknown> | null = null;
  let allUserGames: GameSummary[] = [];
  let robloxSyncLatestRow: Record<string, unknown> | null = null;

  try {
    const { searchParams } = new URL(request.url);
    const range = (searchParams.get("range") || "7d") as DateRange;
    queryGameId = searchParams.get("gameId");
    const debug = searchParams.get("debug") === "true";

    step = "auth";
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ 
        success: false, 
        error: "Not authenticated",
        debug: debug ? { step, authError: authError?.message } : undefined,
      }, { status: 401 });
    }

    authUserId = user.id;

    // Check user's plan for monetization gating
    step = "check_plan";
    const { data: profileData } = await supabase
      .from("profiles")
      .select("plan")
      .eq("id", user.id)
      .single();
    
    const userPlan = profileData?.plan || "free";
    const monetizationLocked = userPlan === "free";

    // Section errors tracking
    const sectionErrors: Record<string, string> = {};

    // 1. Get all user games for debug output
    step = "read_all_user_games";
    const { games: userGames, error: gamesError } = await getAllGamesForUser(user.id, supabase);
    allUserGames = userGames;
    
    if (gamesError) {
      sectionErrors.allUserGames = gamesError;
    }

    // 2. Get selected game using shared helper (single source of truth)
    step = "read_selected_game";
    let selectedGame: {
      id: string;
      name: string;
      roblox_game_id: string | null;
      universe_id: string | null;
      root_place_id: string | null;
      api_key: string | null;
      last_event_at: string | null;
      current_players: number | null;
      total_visits: number | null;
      favorites: number | null;
      likes: number | null;
      dislikes: number | null;
      last_roblox_sync: string | null;
      source?: string | null;
      group_name?: string | null;
    } | null = null;

    if (queryGameId) {
      // If gameId is provided, verify it belongs to current user
      const { data: gameData, error: gameError } = await supabase
        .from("games")
        .select("id, name, roblox_game_id, universe_id, root_place_id, api_key, last_event_at, current_players, total_visits, favorites, likes, dislikes, last_roblox_sync, source, group_name")
        .eq("id", queryGameId)
        .eq("user_id", user.id)
        .neq("status", "deleted")
        .single();

      if (gameError) {
        sectionErrors.queryGame = gameError.message;
      }
      if (gameData) {
        selectedGame = gameData;
      }
    }

    // If no game from query, use shared helper
    if (!selectedGame) {
      const { game: helperGame, error: helperError } = await getSelectedGameForUser(user.id, supabase);
      if (helperError) {
        sectionErrors.selectedGameHelper = helperError;
      }
      if (helperGame) {
        selectedGame = {
          id: helperGame.id,
          name: helperGame.name,
          roblox_game_id: helperGame.roblox_game_id,
          universe_id: helperGame.universe_id || null,
          root_place_id: helperGame.root_place_id || null,
          api_key: helperGame.api_key,
          last_event_at: helperGame.last_event_at,
          current_players: helperGame.current_players ?? null,
          total_visits: helperGame.total_visits ?? null,
          favorites: helperGame.favorites ?? null,
          likes: helperGame.likes ?? null,
          dislikes: helperGame.dislikes ?? null,
          last_roblox_sync: helperGame.last_roblox_sync || null,
          source: helperGame.source || null,
          group_name: helperGame.group_name || null,
        };
      }
    }

    // No games at all - return empty state with dataHealth
    if (!selectedGame) {
      const debugData = debug ? {
        step,
        authUserId,
        queryGameId,
        allUserGamesCount: allUserGames.length,
        allUserGames: allUserGames.map(g => ({
          id: g.id,
          name: g.name,
          roblox_game_id: g.roblox_game_id,
          is_selected: g.is_selected,
          source: g.source,
          group_name: g.group_name,
        })),
        selectedGameUsed: null,
        sectionErrors,
      } : undefined;

      return NextResponse.json({
        success: true,
        data: {
          // Selected game identity - null when no game connected
          selectedGameId: null,
          selectedGameName: null,
          robloxGameId: null,
          game: null,
          range,
          // Plan-based monetization gating
          monetizationLocked,
          userPlan,
          dataHealth: {
            selectedGameId: null,
            robloxGameId: null,
            rootPlaceId: null,
            gameName: null,
            hasTrackerEvents: false,
            trackerEventsCount: 0,
            lastTrackerEventAt: null,
            hasRobloxApiData: false,
            robloxApiLastSyncedAt: null,
            hasSyncedProducts: false,
            syncedProductsCount: 0,
            missing: ["no_game_connected"],
          },
          overview: null,
          trackerStats: null,
          revenueStats: null,
          productStats: null,
          syncedProducts: null,
          retentionStats: null,
          ccuStats: null,
          robloxStats: null,
          charts: null,
          sectionErrors,
          lastUpdated: new Date().toISOString(),
        },
        debug: debugData,
      });
    }

    // Build selectedGameUsed for debug output (never expose api_key)
    selectedGameUsed = {
      id: selectedGame.id,
      name: selectedGame.name,
      roblox_game_id: selectedGame.roblox_game_id,
      universe_id: selectedGame.universe_id,
      root_place_id: selectedGame.root_place_id,
      source: selectedGame.source,
      group_name: selectedGame.group_name,
    };

  const gameId = selectedGame.id;
  const rangeConfig = getRangeConfig(range);
  const now = new Date();
  const startDate = new Date(now.getTime() - rangeConfig.hours * 60 * 60 * 1000);

  // Event type constants
  const purchaseTypes = ["purchase_success", "gamepass_purchase", "devproduct_purchase"];
  const sessionStartTypes = ["player_join", "session_start"];
  const sessionEndTypes = ["player_leave", "session_end"];
  const clickTypes = ["product_click", "gamepass_click", "devproduct_click", "gamepass_prompt", "devproduct_prompt"];
  const viewTypes = ["product_view"];

  // 2. Use SQL RPC for summary stats instead of fetching all events
  // This is the optimized approach that won't timeout
  step = "read_summary_stats";
  let summaryStats = {
    totalRevenue: 0,
    totalPurchases: 0,
    totalBuyers: 0,
    totalSessions: 0,
    uniquePlayers: 0,
  };
  
  try {
    const { data: statsData, error: statsError } = await supabase.rpc("aggregate_summary_stats", {
      p_game_id: gameId,
      p_range_start: startDate.toISOString(),
      p_range_end: now.toISOString(),
    });
    
    if (statsError) {
      sectionErrors.summaryStats = statsError.message;
    } else if (statsData && statsData.length > 0) {
      summaryStats = {
        totalRevenue: Number(statsData[0].total_revenue) || 0,
        totalPurchases: Number(statsData[0].total_purchases) || 0,
        totalBuyers: Number(statsData[0].total_buyers) || 0,
        totalSessions: Number(statsData[0].total_sessions) || 0,
        uniquePlayers: Number(statsData[0].unique_players) || 0,
      };
    }
  } catch (err) {
    sectionErrors.summaryStats = err instanceof Error ? err.message : "Failed to fetch summary stats";
  }
  
  // For chart data and basic counts, we use separate targeted queries
  // DO NOT fetch all events - this is what caused the timeout
  
  // Fetch limited purchase events for revenue chart (last 500 only for JS bucketing)
  // This is a fallback - ideally we'd use the SQL RPC for chart data too
  step = "read_chart_events";
  let purchaseEvents: Array<{
    id: string;
    event_type: string;
    player_id: string | null;
    product_id: string | null;
    product_name: string | null;
    product_type: string | null;
    robux: number | null;
    created_at: string;
    game_id: string;
    metadata: Record<string, unknown> | null;
  }> = [];
  
  try {
    const { data: purchaseData, error: purchaseError } = await supabase
      .from("events")
      .select("id, event_type, player_id, product_id, product_name, product_type, robux, created_at, game_id, metadata")
      .eq("game_id", gameId)
      .in("event_type", purchaseTypes)
      .gte("created_at", startDate.toISOString())
      .order("created_at", { ascending: true })
      .limit(2000); // Limit to prevent timeout
    
    if (purchaseError) {
      sectionErrors.chartEvents = purchaseError.message;
    } else {
      purchaseEvents = purchaseData || [];
    }
  } catch (err) {
    sectionErrors.chartEvents = err instanceof Error ? err.message : "Failed to fetch chart events";
  }
  
  // Fetch limited session events for session chart
  let sessionEvents: Array<{
    id: string;
    event_type: string;
    player_id: string | null;
    created_at: string;
    game_id: string;
  }> = [];
  
  try {
    const { data: sessionData, error: sessionError } = await supabase
      .from("events")
      .select("id, event_type, player_id, created_at, game_id")
      .eq("game_id", gameId)
      .in("event_type", [...sessionStartTypes, ...sessionEndTypes])
      .gte("created_at", startDate.toISOString())
      .order("created_at", { ascending: true })
      .limit(2000);
    
    if (sessionError) {
      sectionErrors.sessionEvents = sessionError.message;
    } else {
      sessionEvents = sessionData || [];
    }
  } catch (err) {
    sectionErrors.sessionEvents = err instanceof Error ? err.message : "Failed to fetch session events";
  }
  
  // For data health checks, use counts instead of fetching all events
  const allEvents: Array<{ event_type: string; player_id: string | null }> = []; // Empty - we don't need full events anymore

  // Get total event count and latest event time for dataHealth (all-time, not just range)
  let totalEventsCount = 0;
  let latestEventAt: string | null = null;
  try {
    const { count } = await supabase
      .from("events")
      .select("*", { count: "exact", head: true })
      .eq("game_id", gameId);
    totalEventsCount = count || 0;

    // Get latest event time if we have events
    if (totalEventsCount > 0) {
      const { data: latestEvent } = await supabase
        .from("events")
        .select("created_at")
        .eq("game_id", gameId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      latestEventAt = latestEvent?.created_at || null;
    }
  } catch {
    // Ignore count error
  }

  // === DATA HEALTH DIAGNOSTICS ===
  const missing: string[] = [];
  
  // Check tracker events
  const hasTrackerEvents = totalEventsCount > 0;
  if (!hasTrackerEvents) {
    missing.push("tracking_script_not_installed");
  }

  // Check for purchase events using the fetched limited purchase events
  const hasPurchaseEvents = purchaseEvents.length > 0 || summaryStats.totalPurchases > 0;
  if (hasTrackerEvents && !hasPurchaseEvents) {
    missing.push("no_purchase_events");
  }

  // Check for session/duration events using the fetched limited session events
  const hasSessionEvents = sessionEvents.length > 0 || summaryStats.totalSessions > 0;
  if (hasTrackerEvents && !hasSessionEvents) {
    missing.push("no_session_duration_events");
  }

  // Note: We don't check for product_view/click events in data health anymore
  // since we don't fetch all events - this is acceptable as it's optional tracking

  // Check Roblox API data
  const hasRobloxApiData = selectedGame.last_roblox_sync !== null;

  // === ROBLOX PUBLIC STATS ===
  step = "read_roblox_sync";
  
  // Resolve universeId early - used for Roblox API calls and response
  // Priority: universe_id column > roblox_game_id (which IS the universe ID from /api/roblox/games)
  const universeId = selectedGame.universe_id || selectedGame.roblox_game_id || null;
  
  // Priority: 1) Latest from roblox_game_syncs table, 2) games table fields, 3) Live API fetch
  let robloxStats: {
    ccu: number | null;
    visits: number | null;
    favorites: number | null;
    likes: number | null;
    dislikes: number | null;
    likeRatio: number | null;
    updatedAt: string | null;
    source: "roblox_game_syncs" | "games_table" | "live_api" | null;
  } | null = null;
  
  // First, try to read from roblox_game_syncs table (most reliable, from manual sync)
  const { data: latestSync } = await supabase
    .from("roblox_game_syncs")
    .select("ccu, visits, favorites, likes, dislikes, synced_at")
    .eq("game_id", gameId)
    .order("synced_at", { ascending: false })
    .limit(1)
    .single();

  // Store for debug output
  if (latestSync) {
    robloxSyncLatestRow = {
      ccu: latestSync.ccu,
      visits: latestSync.visits,
      favorites: latestSync.favorites,
      likes: latestSync.likes,
      dislikes: latestSync.dislikes,
      synced_at: latestSync.synced_at,
    };
  }

  if (latestSync && (latestSync.visits !== null || latestSync.ccu !== null)) {
    // Calculate like ratio
    const totalVotes = (latestSync.likes || 0) + (latestSync.dislikes || 0);
    const likeRatio = totalVotes > 0 ? (latestSync.likes || 0) / totalVotes : null;
    
    robloxStats = {
      ccu: latestSync.ccu,
      visits: latestSync.visits,
      favorites: latestSync.favorites,
      likes: latestSync.likes,
      dislikes: latestSync.dislikes,
      likeRatio,
      updatedAt: latestSync.synced_at,
      source: "roblox_game_syncs",
    };
  } else if (hasRobloxApiData && selectedGame.total_visits !== null) {
    // Fallback to games table fields (from previous syncs)
    const totalVotes = (selectedGame.likes || 0) + (selectedGame.dislikes || 0);
    const likeRatio = totalVotes > 0 ? (selectedGame.likes || 0) / totalVotes : null;
    
    robloxStats = {
      ccu: selectedGame.current_players,
      visits: selectedGame.total_visits,
      favorites: selectedGame.favorites,
      likes: selectedGame.likes,
      dislikes: selectedGame.dislikes,
      likeRatio,
      updatedAt: selectedGame.last_roblox_sync,
      source: "games_table",
    };
  }

  // NOTE: We DO NOT auto-sync Roblox API in the analytics GET handler
  // to avoid blocking page render. Client should call /api/roblox/sync-selected-game
  // separately if fresh data is needed. This keeps initial load fast.
  // 
  // The useAnalytics hook auto-refreshes every 60s which will pick up
  // any background syncs that completed.

  // Final check - if still no data, mark as unavailable
  if (!robloxStats) {
    missing.push("roblox_stats_not_synced");
  }

  // Build dataHealth (note: syncedProducts count will be added after we fetch them)
  const dataHealth = {
    selectedGameId: selectedGame.id,
    robloxGameId: selectedGame.roblox_game_id,
    rootPlaceId: selectedGame.root_place_id,
    universeId: selectedGame.universe_id || selectedGame.roblox_game_id,
    gameName: selectedGame.name,
    apiKey: selectedGame.api_key, // For tracking setup page
    hasTrackerEvents,
    trackerEventsCount: totalEventsCount,
    // Use latestEventAt from events query, fall back to games.last_event_at
    lastTrackerEventAt: latestEventAt || selectedGame.last_event_at,
    hasRobloxApiData: hasRobloxApiData || robloxStats !== null,
    robloxApiLastSyncedAt: selectedGame.last_roblox_sync || robloxStats?.updatedAt || null,
    // Products sync info (will be populated later)
    hasSyncedProducts: false, // Updated below after fetching products
    syncedProductsCount: 0,
    missing,
  };

  // === BASIC STATS (from SQL RPC summaryStats) ===
  step = "calculate_overview";
  // purchaseEvents and sessionEvents are already fetched above (limited to 2000 for chart data)
  // Use summaryStats for accurate counts (from SQL aggregation)
  const endEvents: typeof sessionEvents = []; // Not needed for stats, only for chart
  const clickEvents: Array<{ event_type: string; player_id: string | null }> = []; // Not used - we use SQL RPC
  const viewEvents: Array<{ event_type: string; player_id: string | null }> = []; // Not used - we use SQL RPC

  // Use SQL-aggregated stats instead of JS-calculated ones
  const uniquePlayers = summaryStats.uniquePlayers;
  const totalSessions = summaryStats.totalSessions;
  const totalPurchases = summaryStats.totalPurchases;
  const totalRevenue = summaryStats.totalRevenue;
  
  // Helper to get robux from event (for chart bucketing, not for totals)
  const getEventRobux = (e: { robux: number | null; metadata: Record<string, unknown> | null }): number => {
    const topLevelRobux = e.robux;
    const metadataRobux = e.metadata && typeof e.metadata === "object" ? (e.metadata as Record<string, unknown>).robux : undefined;
    return Number(topLevelRobux ?? metadataRobux ?? 0);
  };

  // === 72h REVENUE (using SQL RPC for fast aggregation) ===
  const now72h = new Date();
  const start72h = new Date(now72h.getTime() - 72 * 60 * 60 * 1000);
  
  // Use SQL RPC for 72h hourly revenue aggregation
  let revenue72h = 0;
  let purchases72hCount = 0;
  const hourlyMonetization: Array<{
    time: string;
    totalRevenue: number;
    devproductRevenue: number;
    gamepassRevenue: number;
    purchases: number;
  }> = [];
  
  try {
    const { data: hourlyData, error: hourlyError } = await supabase.rpc("aggregate_hourly_revenue", {
      p_game_id: gameId,
      p_range_start: start72h.toISOString(),
      p_range_end: now72h.toISOString(),
    });
    
    if (hourlyError) {
      sectionErrors.hourlyRevenue = hourlyError.message;
    } else if (hourlyData) {
      // Build hourly buckets map (initialize all 72 hours with zeros)
      const hourlyBuckets = new Map<string, { total: number; devproduct: number; gamepass: number; purchases: number }>();
      for (let i = 0; i < 72; i++) {
        const bucketTime = new Date(now72h.getTime() - i * 60 * 60 * 1000);
        const bucketKey = bucketTime.toISOString().slice(0, 13) + ":00:00.000Z";
        hourlyBuckets.set(bucketKey, { total: 0, devproduct: 0, gamepass: 0, purchases: 0 });
      }
      
      // Fill in SQL results
      hourlyData.forEach((row: { time_bucket: string; revenue: number; purchases: number }) => {
        const bucketKey = new Date(row.time_bucket).toISOString().slice(0, 13) + ":00:00.000Z";
        const existing = hourlyBuckets.get(bucketKey);
        if (existing) {
          existing.total = Number(row.revenue) || 0;
          existing.purchases = Number(row.purchases) || 0;
          // Note: SQL doesn't split by product type, so we leave devproduct/gamepass as 0
          // This is acceptable for the chart - total is what matters
        }
        revenue72h += Number(row.revenue) || 0;
        purchases72hCount += Number(row.purchases) || 0;
      });
      
      // Convert to sorted array (oldest first)
      Array.from(hourlyBuckets.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .forEach(([time, data]) => {
          hourlyMonetization.push({
            time,
            totalRevenue: data.total,
            devproductRevenue: data.devproduct,
            gamepassRevenue: data.gamepass,
            purchases: data.purchases,
          });
        });
    }
  } catch (err) {
    sectionErrors.revenue72h = err instanceof Error ? err.message : "Failed to fetch 72h revenue";
  }

  // === MINUTE-LEVEL MONETIZATION CHART DATA ===
  // Note: We're not building minute-level data anymore to avoid heavy fetch
  // The hourlyMonetization chart is sufficient for most use cases
  const minuteMonetization: Array<{
    time: string;
    totalRevenue: number;
    devproductRevenue: number;
    gamepassRevenue: number;
    purchases: number;
  }> = []; // Empty - would require separate SQL RPC for minute-level aggregation

  // === SESSION DURATION ===
  // Calculate avg session duration from paired session events we fetched
  const sessionDurations: number[] = [];
  const activeSessions = new Map<string, Date>();

  // Use the limited session events we fetched (not allEvents)
  [...sessionEvents].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()).forEach((e) => {
    if (!e.player_id) return;
    if (sessionStartTypes.includes(e.event_type)) {
      activeSessions.set(e.player_id, new Date(e.created_at));
    } else if (sessionEndTypes.includes(e.event_type)) {
      const start = activeSessions.get(e.player_id);
      if (start) {
        const duration = (new Date(e.created_at).getTime() - start.getTime()) / 1000;
        if (duration > 0 && duration < 86400) {
          sessionDurations.push(duration);
        }
        activeSessions.delete(e.player_id);
      }
    }
  });

  const avgSessionDuration = sessionDurations.length > 0
    ? Math.round(sessionDurations.reduce((a, b) => a + b, 0) / sessionDurations.length)
    : null;

  // === FIRST SEEN VS RETURNING PLAYERS ===
  // Get unique player joins in range from sessionEvents
  const joinEvents = sessionEvents.filter((e) => sessionStartTypes.includes(e.event_type));
  // === NEW vs RETURNING PLAYERS CALCULATION ===
  // Simplified: Use session events we already fetched instead of querying all-time events
  // This avoids a slow query that fetches all events
  
  let newPlayers = 0;
  let returningPlayers = 0;
  let returningPlayersStatus: "ok" | "no_players" | "no_returning_yet" | "needs_history" = "needs_history";
  const playerFirstSeen = new Map<string, Date>();
  const playerDistinctHours = new Map<string, Set<string>>();
  const sampleReturningPlayerIds: string[] = [];

  // Get unique player IDs from session events (not allEvents since it's empty now)
  const activePlayerIdsInRange = new Set(sessionEvents.filter((e) => e.player_id).map((e) => e.player_id));

  try {
    if (activePlayerIdsInRange.size > 0) {
      // Use session events for session counting (limited to 2000 events)
      // This is an approximation - for accurate counts we'd need SQL RPC
      sessionEvents.forEach((e) => {
        if (!e.player_id) return;
        
        if (!playerFirstSeen.has(e.player_id)) {
          playerFirstSeen.set(e.player_id, new Date(e.created_at));
        }
        
        const hourBucket = new Date(e.created_at).toISOString().slice(0, 13);
        if (!playerDistinctHours.has(e.player_id)) {
          playerDistinctHours.set(e.player_id, new Set());
        }
        playerDistinctHours.get(e.player_id)!.add(hourBucket);
      });

      // Classify each active player
      activePlayerIdsInRange.forEach((playerId) => {
        if (!playerId) return;
        const distinctHours = playerDistinctHours.get(playerId)?.size || 0;
        
        if (distinctHours >= 2) {
          returningPlayers++;
          if (sampleReturningPlayerIds.length < 5) {
            sampleReturningPlayerIds.push(playerId);
          }
        } else {
          newPlayers++;
        }
      });
      
      // Determine status for UI
      if (uniquePlayers === 0) {
        returningPlayersStatus = "no_players";
      } else if (returningPlayers > 0) {
        returningPlayersStatus = "ok";
      } else if (newPlayers > 0) {
        // We have active players but none have multiple sessions yet
        returningPlayersStatus = "no_returning_yet";
      } else {
        returningPlayersStatus = "needs_history";
      }
      
      // Debug logging - uses session events count now
      if (process.env.NODE_ENV === "development") {
        let playersWithMultipleHours = 0;
        playerDistinctHours.forEach((hours) => {
          if (hours.size >= 2) playersWithMultipleHours++;
        });
        
        console.log("[v0] Returning Users Debug", {
          selectedGameId: gameId,
          sessionEventsCount: sessionEvents.length,
          distinctPlayers: playerDistinctHours.size,
          playersWithMultipleSessions: playersWithMultipleHours,
          activeInRange: activePlayerIdsInRange.size,
          returningUsers: returningPlayers,
          newUsers: newPlayers,
          sum: newPlayers + returningPlayers,
          returningPlayersStatus,
          rangeStart: startDate.toISOString(),
        });
      }
    } else {
      // No players active in range
      returningPlayersStatus = "no_players";
    }
  } catch (err) {
    sectionErrors.newReturning = err instanceof Error ? err.message : "Failed to calculate";
    // Fallback: treat all players as new
    if (uniquePlayers > 0) {
      newPlayers = uniquePlayers;
      returningPlayersStatus = "no_returning_yet";
    }
  }
  
  // Alias for backwards compatibility (firstSeenPlayers = newPlayers)
  const firstSeenPlayers = newPlayers;

  // === RETENTION STATS (cohort-based) ===
  const retentionStats = {
    day1: null as number | null,
    day7: null as number | null,
    day30: null as number | null,
    day1Message: null as string | null,
    day7Message: null as string | null,
    day30Message: null as string | null,
  };

  if (!hasTrackerEvents) {
    retentionStats.day1Message = "Install tracking script to unlock retention";
    retentionStats.day7Message = "Install tracking script to unlock retention";
    retentionStats.day30Message = "Install tracking script to unlock retention";
  } else {
    try {
      // D1 retention: cohort from 2 days ago, check if they returned on day 1
      const calculateRetention = async (daysAgo: number, returnDay: number) => {
        const cohortStart = new Date(now);
        cohortStart.setDate(cohortStart.getDate() - daysAgo);
        cohortStart.setHours(0, 0, 0, 0);
        const cohortEnd = new Date(cohortStart);
        cohortEnd.setDate(cohortEnd.getDate() + 1);

        // Players whose first join is in the cohort window
        const cohortPlayers = new Set<string>();
        playerFirstSeen.forEach((firstSeen, playerId) => {
          if (firstSeen >= cohortStart && firstSeen < cohortEnd) {
            cohortPlayers.add(playerId);
          }
        });

        if (cohortPlayers.size === 0) {
          return { rate: null, message: "Not enough data yet" };
        }

        // Check how many returned on the target day
        const returnStart = new Date(cohortStart);
        returnStart.setDate(returnStart.getDate() + returnDay);
        const returnEnd = new Date(returnStart);
        returnEnd.setDate(returnEnd.getDate() + 1);

        // Fetch return visits
        const { data: returnVisits } = await supabase
          .from("events")
          .select("player_id")
          .eq("game_id", gameId)
          .in("event_type", sessionStartTypes)
          .gte("created_at", returnStart.toISOString())
          .lt("created_at", returnEnd.toISOString());

        const returnedPlayers = new Set<string>();
        (returnVisits || []).forEach((e) => {
          if (e.player_id && cohortPlayers.has(e.player_id)) {
            returnedPlayers.add(e.player_id);
          }
        });

        const rate = Math.round((returnedPlayers.size / cohortPlayers.size) * 100);
        return { rate, message: null };
      };

      // D1: cohort from 2 days ago, returned on day 1 after
      const d1Result = await calculateRetention(2, 1);
      retentionStats.day1 = d1Result.rate;
      retentionStats.day1Message = d1Result.message;

      // D7: cohort from 8 days ago, returned on day 7 after
      const d7Result = await calculateRetention(8, 7);
      retentionStats.day7 = d7Result.rate;
      retentionStats.day7Message = d7Result.message;

      // D30: cohort from 31 days ago, returned on day 30 after
      const d30Result = await calculateRetention(31, 30);
      retentionStats.day30 = d30Result.rate;
      retentionStats.day30Message = d30Result.message;
    } catch (err) {
      sectionErrors.retention = err instanceof Error ? err.message : "Failed to calculate retention";
    }
  }

  // === REVENUE STATS ===
  const payingPlayerIds = new Set(purchaseEvents.filter((e) => e.player_id).map((e) => e.player_id));
  const payingUsers = payingPlayerIds.size;
  const gamepassRevenue = purchaseEvents
    .filter((e) => e.product_type === "gamepass" || e.event_type === "gamepass_purchase")
    .reduce((sum, e) => sum + getEventRobux(e), 0);
  const devproductRevenue = purchaseEvents
    .filter((e) => e.product_type === "devproduct" || e.event_type === "devproduct_purchase")
    .reduce((sum, e) => sum + getEventRobux(e), 0);

  // Use shared helper for consistent ARPPU/ARPDAU calculations
  // Combine session and purchase events for metrics (since we don't have allEvents)
  const combinedEvents = [...sessionEvents, ...purchaseEvents];
  const allEventsForMetrics: EventWithMetrics[] = combinedEvents.map(e => ({
    player_id: e.player_id,
    created_at: e.created_at,
    event_type: e.event_type,
  }));
  const purchaseEventsForMetrics: EventWithMetrics[] = purchaseEvents.map(e => ({
    player_id: e.player_id,
    created_at: e.created_at,
    event_type: e.event_type,
    robux: getEventRobux(e),
  }));
  
  const periodMetrics = calculatePeriodMetrics(allEventsForMetrics, purchaseEventsForMetrics);
  
  // ARPPU = Revenue / Paying Users (from shared helper)
  const arppu = periodMetrics.periodArppu;
  
  // ARPDAU = Revenue / Average Daily Active Users (from shared helper)
  const arpdau = periodMetrics.periodArpdau;
  const averageDau = periodMetrics.averageDau;
  const daysWithData = periodMetrics.daysWithData;
  
  const conversionRate = uniquePlayers > 0 ? (payingUsers / uniquePlayers) * 100 : null;
  const purchaseRate = uniquePlayers > 0 ? (totalPurchases / uniquePlayers) * 100 : null;

  // === PRODUCT STATS (using SQL RPC for server-side aggregation) ===
  step = "calculate_products";
  
  // Use SQL RPC for fast server-side aggregation instead of fetching all events
  // This is the SINGLE SOURCE OF TRUTH for all product data across:
  // - Overview Top Products
  // - Products page table  
  // - Monetization product breakdown
  // - AI Assistant context
  const productQueryStart = Date.now();
  let sqlProductStats: Array<{
    product_id: string;
    product_name: string;
    product_type: string;
    gross_revenue: number;
    purchases: number;
    buyers: number;
    views: number;
    clicks: number;
  }> = [];
  let productQueryDurationMs = 0;
  
  try {
    const { data: rpcData, error: rpcError } = await supabase.rpc("aggregate_product_stats", {
      p_game_id: gameId,
      p_range_start: startDate.toISOString(),
      p_range_end: now.toISOString(),
    });
    
    productQueryDurationMs = Date.now() - productQueryStart;
    
    if (rpcError) {
      sectionErrors.productStatsRpc = rpcError.message;
    } else {
      sqlProductStats = rpcData || [];
    }
  } catch (err) {
    productQueryDurationMs = Date.now() - productQueryStart;
    sectionErrors.productStatsRpc = err instanceof Error ? err.message : "Failed to fetch product stats";
  }
  
  // Fetch synced Roblox products for name enrichment
  const robloxProductsMap = new Map<string, RobloxProductInfo>();
  try {
    const { data: robloxProducts } = await supabase
      .from("roblox_products")
      .select("roblox_product_id, name, product_type, price_robux")
      .eq("game_id", gameId);
    
    (robloxProducts || []).forEach((p) => {
      robloxProductsMap.set(String(p.roblox_product_id), {
        name: p.name,
        type: p.product_type,
        price: p.price_robux || 0,
      });
    });
  } catch (err) {
    sectionErrors.robloxProductsEnrich = err instanceof Error ? err.message : "Failed to fetch";
  }
  
  // Transform SQL results to product format with enrichment
  const products = sqlProductStats.map((p) => {
    // Enrich from roblox_products if available
    const robloxProduct = robloxProductsMap.get(p.product_id);
    const productName = robloxProduct?.name || p.product_name || `Unknown Product #${p.product_id}`;
    const productType = robloxProduct?.type || p.product_type || "gamepass";
    
    const grossRevenue = Number(p.gross_revenue) || 0;
    const purchases = Number(p.purchases) || 0;
    const buyers = Number(p.buyers) || 0;
    const views = Number(p.views) || 0;
    const clicks = Number(p.clicks) || 0;
    
    // Calculate conversion rate: purchases / clicks (or purchases / views if no clicks)
    let conversionRate: number | null = null;
    if (clicks > 0) {
      conversionRate = (purchases / clicks) * 100;
    } else if (views > 0) {
      conversionRate = (purchases / views) * 100;
    }
    
    const conversionNeedsTracking = purchases > 0 && clicks === 0 && views === 0;
    const grossRevenuePerBuyer = buyers > 0 ? Math.round(grossRevenue / buyers) : 0;
    const estimatedRevenue = Math.round(grossRevenue * CREATOR_REVENUE_RATE);
    const estimatedRevenuePerBuyer = buyers > 0 ? Math.round(estimatedRevenue / buyers) : 0;
    
    return {
      id: p.product_id,
      name: productName,
      type: productType,
      revenue: grossRevenue,
      grossRevenue,
      estimatedRevenue,
      purchases,
      uniqueBuyers: buyers,
      views,
      clicks,
      conversionRate,
      conversionNeedsTracking,
      revPerBuyer: grossRevenuePerBuyer,
      grossRevenuePerBuyer,
      estimatedRevenuePerBuyer,
    };
  });
  
  // Get top 4 products for Overview page
  const topProducts = products.slice(0, 4);

  const totalProductRevenue = products.reduce((sum, p) => sum + p.grossRevenue, 0);
  const totalProductPurchases = products.reduce((sum, p) => sum + p.purchases, 0);
  const totalUniqueBuyers = products.reduce((sum, p) => sum + p.uniqueBuyers, 0);
  
  // Calculate avg conversion rate from products with valid denominator (clicks or views)
  const productsWithConversion = products.filter((p) => (p.clicks > 0 || p.views > 0) && p.conversionRate !== null);
  const totalConversionDenominator = productsWithConversion.reduce((sum, p) => sum + (p.clicks > 0 ? p.clicks : p.views), 0);
  const totalConversionNumerator = productsWithConversion.reduce((sum, p) => sum + p.purchases, 0);
  const avgConversionRate = totalConversionDenominator > 0 
    ? (totalConversionNumerator / totalConversionDenominator) * 100
    : null;
  const avgConversionNeedsTracking = totalProductPurchases > 0 && productsWithConversion.length === 0;

  // === CCU STATS (prioritize tracker heartbeats over Roblox API) ===
  let ccuStats = {
    current: null as number | null,
    peak: null as number | null,
    avg: null as number | null,
    snapshots: [] as Array<{ time: string; ccu: number }>,
    message: null as string | null,
    source: "none" as "romonetize_tracker" | "roblox_api" | "none",
  };

  try {
    // PRIORITY 1: Check for tracker heartbeat CCU from active servers
    const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000).toISOString();
    const { data: activeServers } = await supabase
      .from("server_heartbeats")
      .select("ccu, last_seen_at")
      .eq("game_id", gameId)
      .gte("last_seen_at", twoMinutesAgo);

    if (activeServers && activeServers.length > 0) {
      // Sum CCU across all active servers for total CCU
      const trackerCcu = activeServers.reduce((sum, s) => sum + (s.ccu || 0), 0);
      ccuStats.current = trackerCcu;
      ccuStats.source = "romonetize_tracker";
    } else if (robloxStats?.ccu !== null) {
      // FALLBACK: Use Roblox API CCU
      ccuStats.current = robloxStats.ccu;
      ccuStats.source = "roblox_api";
    }

    // Use captured_at for time filtering (preferred), fallback to created_at
    const { data: ccuSnapshots } = await supabase
      .from("ccu_snapshots")
      .select("ccu, captured_at, created_at")
      .eq("game_id", gameId)
      .or(`captured_at.gte.${startDate.toISOString()},and(captured_at.is.null,created_at.gte.${startDate.toISOString()})`)
      .order("captured_at", { ascending: true, nullsFirst: false });

    if (ccuSnapshots && ccuSnapshots.length > 0) {
      ccuStats.snapshots = ccuSnapshots.map((s) => ({
        time: s.captured_at || s.created_at,
        ccu: s.ccu,
      }));
      // Only override current if not already set from tracker heartbeats
      if (ccuStats.current === null) {
        ccuStats.current = ccuSnapshots[ccuSnapshots.length - 1].ccu;
      }
      ccuStats.peak = Math.max(...ccuSnapshots.map((s) => s.ccu));
      ccuStats.avg = Math.round(ccuSnapshots.reduce((sum, s) => sum + s.ccu, 0) / ccuSnapshots.length);
    } else {
      ccuStats.message = "CCU chart will appear after the first sync";
    }
  } catch (err) {
    sectionErrors.ccu = err instanceof Error ? err.message : "Failed to fetch CCU";
  }

// === CCU HISTORY (from ccu_snapshots - RAW SNAPSHOTS) ===
  // Returns raw snapshots for client-side bucketing/filtering (no page reload on range change)
  // Always fetch last 90 days of data - client will filter by selected range
  const ccuHistoryStart = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000); // 90 days
  
let ccuHistory: {
    currentCcu: number | null;
    // Raw snapshots - client handles bucketing and time formatting
    // Each snapshot includes source for tooltip display
    rawSnapshots: Array<{ time: string; ccu: number; source: string }>;
    // Overall source tracking for debugging
    source: "ccu_snapshots" | "roblox_game_syncs" | "none";
    // Cron status for debug display
    cronStatus?: {
      now: string;
      selectedGameId: string;
      latestSnapshotAt: string | null;
      minutesSinceLatestSnapshot: number | null;
      snapshotsLast15Minutes: number;
      expectedSnapshotsLast15Minutes: number;
      cronRunsLast15Minutes: number;
      latestCronRun: { started_at: string; ok: boolean; snapshots_inserted: number } | null;
      latestCronSnapshotAt: string | null;
      latestBrowserSnapshotAt: string | null;
      cronConfigured: boolean;
      cronInterval: string;
      browserPollInterval: string;
    };
  } = {
    // Priority: tracker heartbeats > snapshots > roblox API
    currentCcu: ccuStats.current ?? robloxStats?.ccu ?? null,
    rawSnapshots: [],
    source: "none",
  };
  
  try {
    // PRIMARY: Fetch from ccu_snapshots table (populated by tracker heartbeats and sync)
    // Include source field for tooltip display
    // Use captured_at for time filtering (preferred), fallback to created_at for older rows
    const { data: ccuSnapshotsData } = await supabase
      .from("ccu_snapshots")
      .select("ccu, captured_at, created_at, source")
      .eq("game_id", gameId)
      .or(`captured_at.gte.${ccuHistoryStart.toISOString()},and(captured_at.is.null,created_at.gte.${ccuHistoryStart.toISOString()})`)
      .order("captured_at", { ascending: true, nullsFirst: false });
    
    if (ccuSnapshotsData && ccuSnapshotsData.length > 0) {
      ccuHistory.rawSnapshots = ccuSnapshotsData
        .filter((snap) => snap.ccu !== null)
        .map((snap) => ({
          time: snap.captured_at || snap.created_at,
          ccu: snap.ccu as number,
          source: snap.source || "unknown",
        }));
      ccuHistory.source = "ccu_snapshots";
      
      // Update current CCU from latest snapshot if available
      if (ccuHistory.rawSnapshots.length > 0) {
        ccuHistory.currentCcu = ccuHistory.rawSnapshots[ccuHistory.rawSnapshots.length - 1].ccu;
      }
    } else {
      // FALLBACK: Try roblox_game_syncs (legacy/manual syncs)
      const { data: syncSnapshots } = await supabase
        .from("roblox_game_syncs")
        .select("ccu, synced_at")
        .eq("game_id", gameId)
        .gte("synced_at", ccuHistoryStart.toISOString())
        .order("synced_at", { ascending: true });
      
      if (syncSnapshots && syncSnapshots.length > 0) {
        ccuHistory.rawSnapshots = syncSnapshots
          .filter((snap) => snap.ccu !== null)
          .map((snap) => ({
            time: snap.synced_at,
            ccu: snap.ccu as number,
            source: "roblox_game_syncs",
          }));
        ccuHistory.source = "roblox_game_syncs";
        
        // Update current CCU from latest snapshot if available
        if (ccuHistory.rawSnapshots.length > 0) {
          ccuHistory.currentCcu = ccuHistory.rawSnapshots[ccuHistory.rawSnapshots.length - 1].ccu;
        }
      }
    }
    
    // Fetch cron status for debug display
    const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);
    const { data: cronSnapshots } = await supabase
      .from("ccu_snapshots")
      .select("source, captured_at")
      .eq("game_id", gameId)
      .gte("captured_at", fifteenMinutesAgo.toISOString())
      .order("captured_at", { ascending: false });
    
    // Find latest snapshot overall
    const latestSnapshot = cronSnapshots?.[0];
    // Find latest cron vs browser snapshot
    const latestCronSnapshot = cronSnapshots?.find(s => s.source === "vercel_cron");
    const latestBrowserSnapshot = cronSnapshots?.find(s => s.source !== "vercel_cron" && s.source !== null);
    
    // Calculate minutes since latest snapshot
    const latestSnapshotAt = latestSnapshot?.captured_at ? new Date(latestSnapshot.captured_at) : null;
    const minutesSinceLatestSnapshot = latestSnapshotAt 
      ? Math.round((now.getTime() - latestSnapshotAt.getTime()) / 60000) 
      : null;
    
    // Query cron_runs table if it exists
    let cronRunsLast15Minutes = 0;
    let latestCronRun: { started_at: string; ok: boolean; snapshots_inserted: number } | null = null;
    try {
      const { data: cronRuns } = await supabase
        .from("cron_runs")
        .select("started_at, ok, snapshots_inserted")
        .eq("job_name", "collect-ccu")
        .gte("started_at", fifteenMinutesAgo.toISOString())
        .order("started_at", { ascending: false });
      
      cronRunsLast15Minutes = cronRuns?.length ?? 0;
      latestCronRun = cronRuns?.[0] ?? null;
    } catch {
      // Table may not exist - ignore
    }
    
    ccuHistory.cronStatus = {
      now: now.toISOString(),
      selectedGameId: gameId,
      latestSnapshotAt: latestSnapshotAt?.toISOString() ?? null,
      minutesSinceLatestSnapshot,
      snapshotsLast15Minutes: cronSnapshots?.length ?? 0,
      expectedSnapshotsLast15Minutes: 15, // 1 per minute if browser open, or 3 if only cron (5-min interval)
      cronRunsLast15Minutes,
      latestCronRun,
      latestCronSnapshotAt: latestCronSnapshot?.captured_at ?? null,
      latestBrowserSnapshotAt: latestBrowserSnapshot?.captured_at ?? null,
      cronConfigured: !!process.env.CRON_SECRET,
      // Note: Vercel cron runs every minute, browser polling every 60s when dashboard open
      cronInterval: "1m (Vercel)",
      browserPollInterval: "60s (when dashboard open)",
    };
  } catch (err) {
    sectionErrors.ccuHistory = err instanceof Error ? err.message : "Failed to fetch CCU history";
  }

  // === SYNCED ROBLOX PRODUCTS ===
  step = "build_response";
  // Fetch products from roblox_products table (synced via OAuth)
  let syncedProducts: Array<{
    id: string;
    robloxProductId: string;
    name: string;
    productType: string;
    priceRobux: number;
    isForSale: boolean;
    iconUrl: string | null;
    syncedAt: string;
  }> = [];
  
  try {
    const { data: robloxProducts } = await supabase
      .from("roblox_products")
      .select("id, roblox_product_id, name, product_type, price_robux, is_for_sale, icon_url, synced_at")
      .eq("game_id", gameId)
      .order("synced_at", { ascending: false });

    if (robloxProducts) {
      syncedProducts = robloxProducts.map(p => ({
        id: p.id,
        robloxProductId: p.roblox_product_id,
        name: p.name,
        productType: p.product_type,
        priceRobux: p.price_robux || 0,
        isForSale: p.is_for_sale ?? true,
        iconUrl: p.icon_url,
        syncedAt: p.synced_at,
      }));
      // Update dataHealth with products info
      dataHealth.hasSyncedProducts = syncedProducts.length > 0;
      dataHealth.syncedProductsCount = syncedProducts.length;
    }
  } catch (err) {
    sectionErrors.syncedProducts = err instanceof Error ? err.message : "Failed to fetch synced products";
  }

  // === CHARTS DATA ===
  // Revenue chart bucketed by range - uses limited purchaseEvents (up to 2000)
  const revenueBuckets = new Map<string, { revenue: number; purchases: number; passes: number; devProducts: number }>();

  purchaseEvents.forEach((e) => {
    const eventDate = new Date(e.created_at);
    let bucketKey: string;

    if (range === "1h") {
      // 5-minute buckets
      const minutes = Math.floor(eventDate.getMinutes() / 5) * 5;
      bucketKey = `${eventDate.toISOString().slice(0, 13)}:${minutes.toString().padStart(2, "0")}`;
    } else if (range === "1d") {
      // Hourly buckets
      bucketKey = eventDate.toISOString().slice(0, 13) + ":00";
    } else {
      // Daily buckets
      bucketKey = eventDate.toISOString().slice(0, 10);
    }

    const eventRobux = getEventRobux(e);
    const existing = revenueBuckets.get(bucketKey) || { revenue: 0, purchases: 0, passes: 0, devProducts: 0 };
    existing.revenue += eventRobux;
    existing.purchases += 1;
    if (e.product_type === "gamepass" || e.event_type === "gamepass_purchase") {
      existing.passes += eventRobux;
    } else {
      existing.devProducts += eventRobux;
    }
    revenueBuckets.set(bucketKey, existing);
  });

  const revenueChart = Array.from(revenueBuckets.entries())
    .map(([time, data]) => ({ time, ...data }))
    .sort((a, b) => a.time.localeCompare(b.time));

  // Players chart - uses sessionEvents instead of allEvents
  const playerBuckets = new Map<string, { total: Set<string>; new: number; returning: number }>();

  sessionEvents.filter((e) => e.player_id).forEach((e) => {
    const eventDate = new Date(e.created_at);
    let bucketKey: string;

    if (range === "1h") {
      const minutes = Math.floor(eventDate.getMinutes() / 5) * 5;
      bucketKey = `${eventDate.toISOString().slice(0, 13)}:${minutes.toString().padStart(2, "0")}`;
    } else if (range === "1d") {
      bucketKey = eventDate.toISOString().slice(0, 13) + ":00";
    } else {
      bucketKey = eventDate.toISOString().slice(0, 10);
    }

    const existing = playerBuckets.get(bucketKey) || { total: new Set<string>(), new: 0, returning: 0 };
    existing.total.add(e.player_id!);
    playerBuckets.set(bucketKey, existing);
  });

  const playersChart = Array.from(playerBuckets.entries())
    .map(([time, data]) => ({ time, players: data.total.size }))
    .sort((a, b) => a.time.localeCompare(b.time));

  // === EVENTS OVER TIME CHART ===
  // Combine session and purchase events for the chart (we don't have allEvents anymore)
  const eventsBuckets = new Map<string, number>();
  const allChartEvents = [...sessionEvents, ...purchaseEvents];
  allChartEvents.forEach((e) => {
    const eventDate = new Date(e.created_at);
    let bucketKey: string;
    if (range === "1h") {
      const minutes = Math.floor(eventDate.getMinutes() / 5) * 5;
      bucketKey = `${eventDate.toISOString().slice(0, 13)}:${minutes.toString().padStart(2, "0")}`;
    } else if (range === "1d") {
      bucketKey = eventDate.toISOString().slice(0, 13) + ":00";
    } else {
      bucketKey = eventDate.toISOString().slice(0, 10);
    }
    eventsBuckets.set(bucketKey, (eventsBuckets.get(bucketKey) || 0) + 1);
  });
  const eventsOverTime = Array.from(eventsBuckets.entries())
    .map(([date, events]) => ({ date, events }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // === SESSIONS OVER TIME CHART ===
  const sessionsBuckets = new Map<string, number>();
  sessionEvents.forEach((e) => {
    const eventDate = new Date(e.created_at);
    let bucketKey: string;
    if (range === "1h") {
      const minutes = Math.floor(eventDate.getMinutes() / 5) * 5;
      bucketKey = `${eventDate.toISOString().slice(0, 13)}:${minutes.toString().padStart(2, "0")}`;
    } else if (range === "1d") {
      bucketKey = eventDate.toISOString().slice(0, 13) + ":00";
    } else {
      bucketKey = eventDate.toISOString().slice(0, 10);
    }
    sessionsBuckets.set(bucketKey, (sessionsBuckets.get(bucketKey) || 0) + 1);
  });
  const sessionsOverTime = Array.from(sessionsBuckets.entries())
    .map(([date, sessions]) => ({ date, sessions }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // === PURCHASES OVER TIME CHART ===
  const purchasesBuckets = new Map<string, number>();
  purchaseEvents.forEach((e) => {
    const eventDate = new Date(e.created_at);
    let bucketKey: string;
    if (range === "1h") {
      const minutes = Math.floor(eventDate.getMinutes() / 5) * 5;
      bucketKey = `${eventDate.toISOString().slice(0, 13)}:${minutes.toString().padStart(2, "0")}`;
    } else if (range === "1d") {
      bucketKey = eventDate.toISOString().slice(0, 13) + ":00";
    } else {
      bucketKey = eventDate.toISOString().slice(0, 10);
    }
    purchasesBuckets.set(bucketKey, (purchasesBuckets.get(bucketKey) || 0) + 1);
  });
  const purchasesOverTime = Array.from(purchasesBuckets.entries())
    .map(([date, purchases]) => ({ date, purchases }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // === REVENUE BY PRODUCT TYPE ===
  const revenueByProductType = [
    { productType: "gamepass", revenue: gamepassRevenue },
    { productType: "devproduct", revenue: devproductRevenue },
  ].filter(r => r.revenue > 0);

  // === TOP PRODUCTS (for monetizationCharts - uses same shared aggregation) ===
  // This ensures monetization page top products match products page exactly
  const monetizationTopProducts = products.slice(0, 10).map(p => ({
    productId: p.id,
    productName: p.name,
    productType: p.type,
    // Include both gross and estimated for proper display mode support
    revenue: p.grossRevenue, // Legacy: gross revenue for backwards compatibility
    grossRevenue: p.grossRevenue,
    estimatedRevenue: p.estimatedRevenue,
    purchases: p.purchases,
    buyers: p.uniqueBuyers,
  }));

  return NextResponse.json({
    success: true,
    data: {
      // Selected game identity - clients must verify this matches before rendering
      selectedGameId: selectedGame.id,
      selectedGameName: selectedGame.name,
      robloxGameId: selectedGame.roblox_game_id,
      game: {
        id: selectedGame.id,
        name: selectedGame.name,
        roblox_game_id: selectedGame.roblox_game_id,
        universe_id: universeId || selectedGame.universe_id,
      },
      range,
      // Plan-based monetization gating
      monetizationLocked,
      userPlan,
      // Data health diagnostics
      dataHealth,
      // Roblox public API stats
      robloxStats,
      // Overview stats (for Overview tab)
      // For free users, null out monetization fields
      overview: monetizationLocked ? {
        totalRevenue: null,
        totalPurchases: null,
        uniquePlayers,
        playerJoins: totalSessions,
        conversionRate: null,
        purchaseRate: null,
      } : {
        totalRevenue,
        totalPurchases,
        uniquePlayers,
        playerJoins: totalSessions,
        conversionRate,
        purchaseRate,
      },
      // Tracker stats (for Game Performance tab)
      // Always return object with safe values when tracker is active
      // For free users, null out purchase count
trackerStats: hasTrackerEvents ? {
  totalEvents: totalEventsCount,
  uniquePlayers: uniquePlayers || 0,
  totalSessions: totalSessions || 0,
  avgSessionDuration: avgSessionDuration || null,
  avgSessionFormatted: avgSessionDuration ? `${Math.floor(avgSessionDuration / 60)}m` : null,
  // New players = players with only one session (one distinct hour of activity)
  newPlayers: newPlayers || 0,
  // Legacy alias for backwards compatibility
  firstSeenPlayers: firstSeenPlayers || 0,
  // Returning = players with >= 2 distinct sessions (hours of activity) - LIFETIME count
  returningPlayers: returningPlayers || 0,
  // Invariant: newPlayers + returningPlayers = uniquePlayers (active in range)
  // Status for UI rendering: "ok" | "no_players" | "no_returning_yet" | "needs_history"
  returningPlayersStatus,
  rangeStart: startDate.toISOString(),
  rangeEnd: now.toISOString(),
  // For free users, null out purchases
  totalPurchases: monetizationLocked ? null : (totalPurchases || 0),
  lastEventTime: latestEventAt || (allEvents.length > 0 ? allEvents[allEvents.length - 1].created_at : null),
  // Debug info for returning users calculation (included in response for debug panel)
  _debug: {
    distinctPlayersAllTime: playerDistinctHours.size,
    playersWithMultipleSessions: Array.from(playerDistinctHours.values()).filter(h => h.size >= 2).length,
    activeInRange: activePlayerIdsInRange.size,
    sampleReturningPlayerIds,
  },
  } : null,
      // Revenue stats (for Monetization tab)
      // For free users, return null (locked)
      revenueStats: monetizationLocked ? null : (hasTrackerEvents ? {
        // Gross values (raw tracked sales)
        grossRevenue: totalRevenue,
        grossRevenue72h: revenue72h,
        grossGamepassRevenue: gamepassRevenue,
        grossDevproductRevenue: devproductRevenue,
        grossArpdau: arpdau,
        grossArppu: arppu,
        // Estimated values (after 30% Roblox fee)
        estimatedRevenue: Math.round(totalRevenue * CREATOR_REVENUE_RATE),
        estimatedRevenue72h: Math.round(revenue72h * CREATOR_REVENUE_RATE),
        estimatedGamepassRevenue: Math.round(gamepassRevenue * CREATOR_REVENUE_RATE),
        estimatedDevproductRevenue: Math.round(devproductRevenue * CREATOR_REVENUE_RATE),
        estimatedArpdau: arpdau > 0 ? Math.round(arpdau * CREATOR_REVENUE_RATE) : 0,
        estimatedArppu: arppu > 0 ? Math.round(arppu * CREATOR_REVENUE_RATE) : 0,
        // Legacy fields for backwards compatibility (now point to gross)
        totalRevenue,
        revenue72h,
        gamepassRevenue,
        devproductRevenue,
        arpdau,
        arppu,
        // Non-revenue metrics unchanged
        totalPurchases,
        payingUsers,
        conversionRate,
        // Additional metrics for transparency
        averageDau: averageDau > 0 ? Math.round(averageDau) : 0,
        daysWithData,
      } : null),
      // Product stats (for Products tab)
      // For free users, return locked state
      productStats: monetizationLocked ? {
        grossTotalRevenue: null,
        estimatedTotalRevenue: null,
        totalRevenue: null,
        totalPurchases: null,
        uniqueBuyers: null,
        avgConversionRate: null,
        avgConversionNeedsTracking: false,
        products: [],
        hasTrackerData: hasTrackerEvents,
        locked: true,
      } : {
        // Gross values (raw tracked)
        grossTotalRevenue: totalProductRevenue,
        // Estimated values (after 30% Roblox fee)
        estimatedTotalRevenue: Math.round(totalProductRevenue * CREATOR_REVENUE_RATE),
        // Legacy field - now points to gross for backwards compatibility
        totalRevenue: totalProductRevenue,
        totalPurchases: totalProductPurchases,
        uniqueBuyers: totalUniqueBuyers,
        avgConversionRate,
        // Uses new formula: true if purchases exist but no views/clicks tracked
        avgConversionNeedsTracking,
        products: products.slice(0, 50), // Top 50
        hasTrackerData: hasTrackerEvents,
        locked: false,
      },
      // Synced Roblox products (from OAuth sync)
      syncedProducts: {
        products: syncedProducts,
        totalCount: syncedProducts.length,
        gamepasses: syncedProducts.filter(p => p.productType === "gamepass").length,
        devProducts: syncedProducts.filter(p => p.productType === "devproduct").length,
        hasSyncedProducts: syncedProducts.length > 0,
      },
  // Retention stats
  retentionStats,
  // CCU stats
  ccuStats,
  // CCU history (from roblox_game_syncs with interval support)
  ccuHistory,
      // Charts (legacy format)
      charts: hasTrackerEvents ? {
        revenue: revenueChart,
        players: playersChart,
      } : null,
      // Performance charts
      performanceCharts: hasTrackerEvents ? {
        eventsOverTime,
        playersOverTime: playersChart.map(p => ({ date: p.time, players: p.players })),
        sessionsOverTime,
        purchasesOverTime,
        ccuOverTime: ccuStats?.snapshots?.map(s => ({ time: s.time, ccu: s.ccu })) || [],
      } : null,
  // Monetization charts - locked for free users
  // Uses same shared product aggregation for consistency with Products page
  monetizationCharts: monetizationLocked ? null : (hasTrackerEvents ? {
  revenueOverTime: revenueChart.map(r => ({ date: r.time, revenue: r.revenue })),
  purchasesOverTime,
  revenueByProductType,
  topProducts: monetizationTopProducts,
  // 72h hourly monetization data (always from last 72 hours, grouped hourly)
  hourlyMonetization,
  // 24h minute-level monetization data (always from last 24 hours, grouped per minute)
  minuteMonetization,
  revenue72h,
purchaseCount72h: purchases72hCount,
    } : null),
// Product analytics - locked for free users
  // SINGLE SOURCE OF TRUTH for all product data - same data for Overview, Products, Monetization pages
  // Now using SQL RPC for server-side aggregation
  productAnalytics: monetizationLocked ? { products: [], locked: true, aggregationSource: "locked" } : {
    // Products from SQL RPC aggregation
    products: products.map(p => ({
      productId: p.id,
      productName: p.name,
      productType: p.type,
      // Gross values (before 30% Roblox fee)
      grossRevenue: p.grossRevenue,
      grossRevenuePerBuyer: p.grossRevenuePerBuyer,
      // Estimated values (after 30% Roblox fee - creator payout)
      estimatedRevenue: p.estimatedRevenue,
      estimatedRevenuePerBuyer: p.estimatedRevenuePerBuyer,
      // Counts
      purchases: p.purchases,
      buyers: p.uniqueBuyers,
      views: p.views,
      clicks: p.clicks,
      // Metrics
      conversionRate: p.conversionRate,
      conversionNeedsTracking: p.conversionNeedsTracking,
    })),
    // Top 4 products for Overview page (same data, just sliced)
    topProducts: topProducts.map(p => ({
      productId: p.id,
      productName: p.name,
      productType: p.type,
      grossRevenue: p.grossRevenue,
      estimatedRevenue: p.estimatedRevenue,
      purchases: p.purchases,
      buyers: p.uniqueBuyers,
    })),
    // Summary totals (calculated from products array)
    totalPurchases: totalProductPurchases,
    totalBuyers: totalUniqueBuyers,
    grossTotalRevenue: totalProductRevenue,
    estimatedTotalRevenue: Math.round(totalProductRevenue * CREATOR_REVENUE_RATE),
    // Debug info
    aggregationSource: "sql_rpc",
    productQueryDurationMs: productQueryDurationMs,
    productsCount: products.length,
    selectedRange: range,
    locked: false,
  },
      sectionErrors,
      lastUpdated: new Date().toISOString(),
    },
    // Debug output (only when ?debug=true)
    ...(debug ? {
      debug: {
        step: "build_response",
        authUserId,
        queryGameId,
        selectedGameUsed,
        robloxSyncLatestRow,
        robloxStatsMapped: robloxStats,
        allUserGamesCount: allUserGames.length,
        allUserGames: allUserGames.map(g => ({
          id: g.id,
          name: g.name,
          roblox_game_id: g.roblox_game_id,
          is_selected: g.is_selected,
          source: g.source,
          group_name: g.group_name,
        })),
        // Purchase revenue debug info
        purchaseRevenueDebug: {
          purchaseEventCount: purchaseEvents.length,
          purchaseEvents: purchaseEvents.slice(0, 20).map(e => ({
            id: e.id,
            event_type: e.event_type,
            player_id: e.player_id,
            product_id: e.product_id,
            product_name: e.product_name,
            product_type: e.product_type,
            robux: e.robux,
            metadata_robux: e.metadata && typeof e.metadata === "object" ? (e.metadata as Record<string, unknown>).robux : undefined,
            created_at: e.created_at,
          })),
          revenueFromColumn: purchaseEvents.reduce((sum, e) => sum + (e.robux || 0), 0),
          revenueFromMetadata: purchaseEvents.reduce((sum, e) => {
            const metaRobux = e.metadata && typeof e.metadata === "object" ? (e.metadata as Record<string, unknown>).robux : 0;
            return sum + Number(metaRobux || 0);
          }, 0),
          finalRevenue: totalRevenue,
        },
        // 72h Revenue debug (like Roblox Dashboard) - now using SQL RPC
        revenue72hDebug: {
          windowStart: start72h.toISOString(),
          purchaseCount72h: purchases72hCount,
          revenue72h,
          aggregationMethod: "sql_rpc",
          productQueryDurationMs: productQueryDurationMs,
        },
      },
    } : {}),
  });

  } catch (error) {
    // Global error handler - always return JSON, never crash
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    return NextResponse.json({
      success: false,
      error: errorMessage,
      stack: process.env.NODE_ENV !== "production" ? errorStack : undefined,
      debug: {
        step,
        authUserId,
        queryGameId,
        selectedGameUsed,
        allUserGamesCount: allUserGames.length,
      },
    }, { status: 500 });
  }
}
