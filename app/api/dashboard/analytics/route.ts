import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRobloxGameStats } from "@/lib/services/roblox-api";
import { getSelectedGameForUser, getAllGamesForUser, type GameSummary } from "@/lib/server/selected-game";
import { calculatePeriodMetrics, type EventWithMetrics } from "@/lib/metrics/arppu-arpdau";
import { resolvePlanFromProfile, type PlanInfo } from "@/lib/plan";
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
    // Optional: monetization range in hours (for PCR, ARPPU, ARPDAU calculations)
    // When specified, tracker metrics are calculated for this range instead of the full range
    const monetizationRangeHoursParam = searchParams.get("monetizationRangeHours");
    const monetizationRangeHours = monetizationRangeHoursParam ? parseInt(monetizationRangeHoursParam, 10) : null;

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

    // Check user's plan for monetization gating using shared helper
    step = "check_plan";
    const { data: profileData } = await supabase
      .from("profiles")
      .select("plan, subscription_status")
      .eq("id", user.id)
      .single();
    
    // Use shared plan helper for consistent plan resolution across all pages
    const planInfo: PlanInfo = resolvePlanFromProfile(profileData);
    const userPlan = planInfo.plan;
    // Studio/Pro users with active subscription or no subscription_status (legacy) should NOT be locked
    const monetizationLocked = !planInfo.canAccessMonetization;

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
  
  // Active user event types (for PCR & ARPDAU)
  // Any player event that indicates a real human player was active.
  // Excludes: ccu_heartbeat, script_started, null player_id, player_id="server"
  const ACTIVE_USER_EVENT_TYPES = [
    "player_join",
    "session_start",
    "session_end",
    "purchase_success",
    "devproduct_purchase",
    "gamepass_purchase",
  ];

  // 2. Use SQL RPC v2 for summary stats with product type breakdown
  // This is the optimized approach that won't timeout
  step = "read_summary_stats";
  let summaryStats = {
    totalRevenue: 0,
    gamepassRevenue: 0,
    devproductRevenue: 0,
    totalPurchases: 0,
    gamepassPurchases: 0,
    devproductPurchases: 0,
    totalBuyers: 0,
    totalSessions: 0,
    uniquePlayers: 0,
  };
  
  try {
    const { data: statsData, error: statsError } = await supabase.rpc("aggregate_summary_stats_v2", {
      p_game_id: gameId,
      p_range_start: startDate.toISOString(),
      p_range_end: now.toISOString(),
    });
    
    if (statsError) {
      sectionErrors.summaryStats = statsError.message;
    } else if (statsData && statsData.length > 0) {
      summaryStats = {
        totalRevenue: Number(statsData[0].total_revenue) || 0,
        gamepassRevenue: Number(statsData[0].gamepass_revenue) || 0,
        devproductRevenue: Number(statsData[0].devproduct_revenue) || 0,
        totalPurchases: Number(statsData[0].total_purchases) || 0,
        gamepassPurchases: Number(statsData[0].gamepass_purchases) || 0,
        devproductPurchases: Number(statsData[0].devproduct_purchases) || 0,
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
  
  // Fetch ALL purchase events using pagination (bypasses 1000/2000 row limits)
  // This is critical for accurate revenue/purchase counts
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
  let purchaseExactCount = 0;
  let purchasePagesFetched = 0;
  let hitSupabaseLimit = false;
  
  try {
    // First get exact count to verify we fetch all rows
    const { count, error: countError } = await supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("game_id", gameId)
      .in("event_type", purchaseTypes)
      .gte("created_at", startDate.toISOString())
      .lte("created_at", now.toISOString());
    
    if (countError) {
      sectionErrors.chartEventsCount = countError.message;
    } else {
      purchaseExactCount = count ?? 0;
    }
    
    // Fetch all purchase events with pagination
    const PAGE_SIZE = 1000;
    let from = 0;
    let hasMore = true;
    
    while (hasMore) {
      const { data: pageData, error: pageError } = await supabase
        .from("events")
        .select("id, event_type, player_id, product_id, product_name, product_type, robux, created_at, game_id, metadata")
        .eq("game_id", gameId)
        .in("event_type", purchaseTypes)
        .gte("created_at", startDate.toISOString())
        .lte("created_at", now.toISOString())
        .order("created_at", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      
      if (pageError) {
        sectionErrors.chartEvents = pageError.message;
        hasMore = false;
      } else if (pageData && pageData.length > 0) {
        purchaseEvents.push(...pageData);
        purchasePagesFetched++;
        from += PAGE_SIZE;
        hasMore = pageData.length === PAGE_SIZE;
      } else {
        hasMore = false;
      }
    }
    
    // Verify we got all rows
    if (purchaseExactCount > 0 && purchaseEvents.length !== purchaseExactCount) {
      hitSupabaseLimit = true;
      sectionErrors.chartEventsPartial = `Fetched ${purchaseEvents.length} of ${purchaseExactCount} purchase events`;
    }
  } catch (err) {
    sectionErrors.chartEvents = err instanceof Error ? err.message : "Failed to fetch chart events";
  }
  
  // === FALLBACK: If SQL RPC summaryStats returned zeros but purchaseEvents exist, rebuild from events ===
  if (summaryStats.totalPurchases === 0 && purchaseEvents.length > 0) {
    const buyerSet = new Set<string>();
    let totalRobux = 0;
    let gpRevenue = 0;
    let dpRevenue = 0;
    let gpCount = 0;
    let dpCount = 0;
    
    purchaseEvents.forEach((e) => {
      const robux = Number(e.robux ?? 0);
      totalRobux += robux;
      if (e.player_id && e.player_id !== "server") buyerSet.add(e.player_id);
      
      if (e.event_type === "gamepass_purchase") {
        gpRevenue += robux;
        gpCount += 1;
      } else if (e.event_type === "devproduct_purchase") {
        dpRevenue += robux;
        dpCount += 1;
      } else {
        // purchase_success - check product_type
        const pt = (e.product_type || "").toLowerCase();
        if (["gamepass", "game_pass", "pass"].includes(pt)) {
          gpRevenue += robux;
          gpCount += 1;
        } else if (["devproduct", "dev_product", "developer_product"].includes(pt)) {
          dpRevenue += robux;
          dpCount += 1;
        }
      }
    });
    
    summaryStats = {
      ...summaryStats,
      totalRevenue: totalRobux,
      gamepassRevenue: gpRevenue,
      devproductRevenue: dpRevenue,
      totalPurchases: purchaseEvents.length,
      gamepassPurchases: gpCount,
      devproductPurchases: dpCount,
      totalBuyers: buyerSet.size,
    };
  }
  
  // Fetch limited session events for session chart (include metadata for duration)
  let sessionEvents: Array<{
    id: string;
    event_type: string;
    player_id: string | null;
    created_at: string;
    game_id: string;
    metadata: Record<string, unknown> | null;
  }> = [];
  
  try {
    const { data: sessionData, error: sessionError } = await supabase
      .from("events")
      .select("id, event_type, player_id, created_at, game_id, metadata")
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
  
  // === ACTIVITY EVENTS (for Activity Over Time chart) ===
  // Fetch ALL events in range EXCEPT ccu_heartbeat and script_started
  // This must match totalEventsInRange for card/chart consistency
  let activityEvents: Array<{ created_at: string }> = [];
  let activityEventsFetched = 0;
  let activityExactCount = totalEventsInRange; // Already calculated above
  
  try {
    // Paginate to get all activity events for the chart
    const ACTIVITY_PAGE_SIZE = 1000;
    let from = 0;
    let hasMore = true;
    
    while (hasMore) {
      const { data: pageData, error: pageError } = await supabase
        .from("events")
        .select("created_at")
        .eq("game_id", gameId)
        .not("event_type", "in", `(${SERVER_ONLY_EVENT_TYPES.join(",")})`)
        .gte("created_at", startDate.toISOString())
        .lte("created_at", now.toISOString())
        .order("created_at", { ascending: true })
        .range(from, from + ACTIVITY_PAGE_SIZE - 1);
      
      if (pageError) {
        sectionErrors.activityEvents = pageError.message;
        hasMore = false;
      } else if (pageData && pageData.length > 0) {
        activityEvents.push(...pageData);
        activityEventsFetched += pageData.length;
        from += ACTIVITY_PAGE_SIZE;
        hasMore = pageData.length === ACTIVITY_PAGE_SIZE;
      } else {
        hasMore = false;
      }
    }
  } catch (err) {
    sectionErrors.activityEvents = err instanceof Error ? err.message : "Failed to fetch activity events";
  }
  
  // === ACTIVE USERS QUERY (for PCR & ARPDAU) ===
  // Fetch distinct player_ids from ACTIVE_USER_EVENT_TYPES in range
  // Also fetch per-day breakdown for ARPDAU's averageDAU calculation
  // 
  // IMPORTANT: When monetizationRangeHours is specified, use that for the query range
  // This allows the Monetization page to request metrics for a specific chart range
  // (e.g., 6h) while the main data range remains broader (e.g., 7d)
  const monetizationStartDate = monetizationRangeHours 
    ? new Date(now.getTime() - monetizationRangeHours * 60 * 60 * 1000)
    : startDate;
  const effectiveMonetizationRangeHours = monetizationRangeHours || rangeConfig.hours;
  
  let trackerActiveUsers = 0;
  let trackerPayingUsers = 0;
  let trackerAverageDau = 0;
  let trackerDaysWithData = 0;
  const trackerActiveUserEventCounts: Record<string, number> = {};
  let sampleActiveUserEvents: string[] = [];
  
  try {
    // Query 1: Distinct active users in monetization range
    const { data: activeUserData, error: activeUserError } = await supabase
      .from("events")
      .select("player_id, event_type, created_at")
      .eq("game_id", gameId)
      .in("event_type", ACTIVE_USER_EVENT_TYPES)
      .gte("created_at", monetizationStartDate.toISOString())
      .lte("created_at", now.toISOString())
      .not("player_id", "is", null)
      .neq("player_id", "server")
      .order("created_at", { ascending: true })
      .limit(10000);
    
    if (activeUserError) {
      sectionErrors.activeUsers = activeUserError.message;
    } else if (activeUserData && activeUserData.length > 0) {
      // Count distinct active players
      const activePlayerIds = new Set<string>();
      const payingPlayerIds = new Set<string>();
      const dailyActivePlayers = new Map<string, Set<string>>();
      
      activeUserData.forEach((e: { player_id: string | null; event_type: string; created_at: string }) => {
        if (!e.player_id || e.player_id === "server") return;
        
        activePlayerIds.add(e.player_id);
        
        // Count by event type
        trackerActiveUserEventCounts[e.event_type] = (trackerActiveUserEventCounts[e.event_type] || 0) + 1;
        
        // Track paying users
        if (purchaseTypes.includes(e.event_type)) {
          payingPlayerIds.add(e.player_id);
        }
        
        // Track daily active users
        const day = e.created_at.slice(0, 10); // YYYY-MM-DD
        if (!dailyActivePlayers.has(day)) {
          dailyActivePlayers.set(day, new Set());
        }
        dailyActivePlayers.get(day)!.add(e.player_id);
      });
      
      trackerActiveUsers = activePlayerIds.size;
      trackerPayingUsers = payingPlayerIds.size;
      trackerDaysWithData = dailyActivePlayers.size;
      
      // Calculate average DAU
      if (trackerDaysWithData > 0) {
        const totalDailyPlayers = Array.from(dailyActivePlayers.values())
          .reduce((sum, players) => sum + players.size, 0);
        trackerAverageDau = totalDailyPlayers / trackerDaysWithData;
      }
      
      // Sample events for debug
      sampleActiveUserEvents = activeUserData.slice(0, 5).map((e: { player_id: string | null; event_type: string; created_at: string }) => 
        `${e.event_type}:${e.player_id?.slice(0, 8)}@${e.created_at.slice(11, 19)}`
      );
    }
  } catch (err) {
    sectionErrors.activeUsers = err instanceof Error ? err.message : "Failed to fetch active users";
  }
  
  // For data health checks, use counts instead of fetching all events
  const allEvents: Array<{ event_type: string; player_id: string | null }> = []; // Empty - we don't need full events anymore

  // Get total event count and latest event time for dataHealth (all-time, not just range)
  // For "Tracked Actions": exclude server-only events (ccu_heartbeat, script_started)
  const SERVER_ONLY_EVENT_TYPES = ["ccu_heartbeat", "script_started"];
  let totalEventsCount = 0;
  let totalEventsCountAllTypes = 0; // Including server events, for hasTrackerEvents check
  let totalEventsInRange = 0; // Tracked Actions for selected range (excludes server-only)
  let latestEventAt: string | null = null;
  try {
    // Count all events (for hasTrackerEvents check)
    const { count: allCount } = await supabase
      .from("events")
      .select("*", { count: "exact", head: true })
      .eq("game_id", gameId);
    totalEventsCountAllTypes = allCount || 0;

    // Count user actions only (excluding ccu_heartbeat, script_started) - ALL TIME
    const { count: actionCount } = await supabase
      .from("events")
      .select("*", { count: "exact", head: true })
      .eq("game_id", gameId)
      .not("event_type", "in", `(${SERVER_ONLY_EVENT_TYPES.join(",")})`);
    totalEventsCount = actionCount || 0;

    // Count user actions in SELECTED RANGE (for Tracked Actions card to match chart)
    const { count: rangeActionCount } = await supabase
      .from("events")
      .select("*", { count: "exact", head: true })
      .eq("game_id", gameId)
      .not("event_type", "in", `(${SERVER_ONLY_EVENT_TYPES.join(",")})`)
      .gte("created_at", startDate.toISOString())
      .lte("created_at", now.toISOString());
    totalEventsInRange = rangeActionCount || 0;

    // Get latest event time if we have events (use allTypes count)
    if (totalEventsCountAllTypes > 0) {
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
  const hasTrackerEvents = totalEventsCountAllTypes > 0;
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
  // HOWEVER: If robloxStats is still null and we have a universeId, 
  // do a quick inline fetch (just public stats, no products/thumbnail)
  // so first-time users see data immediately without clicking Sync.
  if (!robloxStats && universeId) {
    try {
      const quickStats = await getRobloxGameStats(universeId);
      if (quickStats.source === "roblox_api") {
        const totalVotes = (quickStats.likes || 0) + (quickStats.dislikes || 0);
        const likeRatio = totalVotes > 0 ? (quickStats.likes || 0) / totalVotes : null;
        
        robloxStats = {
          ccu: quickStats.currentPlayers ?? null,
          visits: quickStats.totalVisits ?? null,
          favorites: quickStats.favorites ?? null,
          likes: quickStats.likes ?? null,
          dislikes: quickStats.dislikes ?? null,
          likeRatio,
          updatedAt: quickStats.lastFetched || new Date().toISOString(),
          source: "live_api",
        };
        
        // Remove the "not synced" missing flag since we just fetched live
        const idx = missing.indexOf("roblox_stats_not_synced");
        if (idx !== -1) missing.splice(idx, 1);
      }
    } catch (err) {
      console.error("[Analytics] Quick Roblox fetch failed:", err);
      // Non-fatal - just leave robloxStats as null
    }
  }

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
  trackerEventsCount: totalEventsCount, // All-time count for dataHealth
  trackerEventsInRange: totalEventsInRange, // Range-filtered for Tracked Actions card
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
  // IMPORTANT: uniquePlayers from SQL RPC may include server events - we recalculate below
  let uniquePlayers = summaryStats.uniquePlayers;
  // Override totalSessions from SQL RPC: count player_join + session_start from fetched sessionEvents
  // === TOTAL SESSIONS: Robust fallback chain ===
  // Priority: 1) SQL RPC total_sessions (if > 0)
  //           2) Direct COUNT of player_join + session_start events in range
  //           3) Filtered count from limited sessionEvents (last resort)
  let totalSessions = summaryStats.totalSessions;
  
  if (totalSessions === 0) {
    // SQL RPC returned 0 - try direct COUNT (handles player_join + session_start)
    try {
      const { count: sessionCount } = await supabase
        .from("events")
        .select("*", { count: "exact", head: true })
        .eq("game_id", gameId)
        .in("event_type", sessionStartTypes)
        .gte("created_at", startDate.toISOString());
      
      if (sessionCount && sessionCount > 0) {
        totalSessions = sessionCount;
      }
    } catch {
      // Ignore - fall through to sessionEvents filter
    }
  }
  
  if (totalSessions === 0) {
    // Last resort: count from the limited 2000-row sessionEvents fetch
    totalSessions = sessionEvents.filter(e => sessionStartTypes.includes(e.event_type)).length;
  }

  // === TOTAL PURCHASES: SQL RPC first, then purchaseEvents count ===
  let totalPurchases = summaryStats.totalPurchases;
  
  if (totalPurchases === 0 && purchaseEvents.length > 0) {
    totalPurchases = purchaseEvents.length;
  } else if (totalPurchases === 0) {
    // Direct COUNT fallback when both RPC and purchaseEvents are empty
    try {
      const { count: purchaseCount } = await supabase
        .from("events")
        .select("*", { count: "exact", head: true })
        .eq("game_id", gameId)
        .in("event_type", purchaseTypes)
        .gte("created_at", startDate.toISOString());
      
      if (purchaseCount && purchaseCount > 0) {
        totalPurchases = purchaseCount;
      }
    } catch {
      // Ignore
    }
  }
  
  const totalRevenue = summaryStats.totalRevenue || (purchaseEvents.length > 0
    ? purchaseEvents.reduce((sum, e) => sum + Number(e.robux ?? 0), 0)
    : 0);
  
  // RECALCULATE uniquePlayers to exclude server-only events
  // This ensures consistency with newPlayers/returningPlayers calculation
  // Query for distinct player_id excluding "server" and null, excluding ccu_heartbeat events
  let recalculatedUniquePlayers = 0;
  try {
    const { data: playerCountData, error: playerCountError } = await supabase
      .from("events")
      .select("player_id")
      .eq("game_id", gameId)
      .gte("created_at", startDate.toISOString())
      .not("player_id", "is", null)
      .neq("player_id", "server")
      .not("event_type", "in", "(ccu_heartbeat,script_started)");
    
    if (!playerCountError && playerCountData) {
      // Get distinct player IDs
      const distinctPlayers = new Set(playerCountData.map((e: { player_id: string | null }) => e.player_id));
      recalculatedUniquePlayers = distinctPlayers.size;
      // Use recalculated value if we got data, otherwise fall back to SQL RPC
      if (recalculatedUniquePlayers > 0 || playerCountData.length > 0) {
        uniquePlayers = recalculatedUniquePlayers;
      }
    }
  } catch {
    // Keep SQL RPC value on error
  }
  
  // Helper to get robux from event (for chart bucketing, not for totals)
  const getEventRobux = (e: { robux: number | null; metadata: Record<string, unknown> | null }): number => {
    const topLevelRobux = e.robux;
    const metadataRobux = e.metadata && typeof e.metadata === "object" ? (e.metadata as Record<string, unknown>).robux : undefined;
    return Number(topLevelRobux ?? metadataRobux ?? 0);
  };

  // === RANGE-BASED REVENUE (using SQL RPC v2 with product type breakdown) ===
  // Use the full selected range (startDate to now) so chart covers 7d/28d/90d etc.
  const rangeNow = new Date();
  const rangeStart = startDate; // Already calculated from getRangeConfig above
  const rangeHours = Math.ceil((rangeNow.getTime() - rangeStart.getTime()) / (60 * 60 * 1000));
  
  // Use SQL RPC v2 for hourly revenue aggregation with product type breakdown
  let revenue72h = 0;
  let purchases72hCount = 0;
  let gamepassRevenue72h = 0;
  let devproductRevenue72h = 0;
  let gamepassPurchases72h = 0;
  let devproductPurchases72h = 0;
  const hourlyMonetization: Array<{
    time: string;
    totalRevenue: number;
    devproductRevenue: number;
    gamepassRevenue: number;
    purchases: number;
    gamepassPurchases: number;
    devproductPurchases: number;
  }> = [];
  
  try {
    const { data: hourlyData, error: hourlyError } = await supabase.rpc("aggregate_hourly_revenue_v2", {
      p_game_id: gameId,
      p_range_start: rangeStart.toISOString(),
      p_range_end: rangeNow.toISOString(),
    });
    
    if (hourlyError) {
      sectionErrors.hourlyRevenue = hourlyError.message;
    } else if (hourlyData) {
      // Build hourly buckets map (initialize all hours in range with zeros)
      const hourlyBuckets = new Map<string, { 
        total: number; 
        devproduct: number; 
        gamepass: number; 
        purchases: number;
        gamepassPurchases: number;
        devproductPurchases: number;
      }>();
      for (let i = 0; i < rangeHours; i++) {
        const bucketTime = new Date(rangeNow.getTime() - i * 60 * 60 * 1000);
        const bucketKey = bucketTime.toISOString().slice(0, 13) + ":00:00.000Z";
        hourlyBuckets.set(bucketKey, { total: 0, devproduct: 0, gamepass: 0, purchases: 0, gamepassPurchases: 0, devproductPurchases: 0 });
      }
      
      // Fill in SQL results with product type breakdown
      hourlyData.forEach((row: { 
        time_bucket: string; 
        total_revenue: number;
        gamepass_revenue: number;
        devproduct_revenue: number;
        total_purchases: number;
        gamepass_purchases: number;
        devproduct_purchases: number;
      }) => {
        const bucketKey = new Date(row.time_bucket).toISOString().slice(0, 13) + ":00:00.000Z";
        const existing = hourlyBuckets.get(bucketKey);
        if (existing) {
          existing.total = Number(row.total_revenue) || 0;
          existing.gamepass = Number(row.gamepass_revenue) || 0;
          existing.devproduct = Number(row.devproduct_revenue) || 0;
          existing.purchases = Number(row.total_purchases) || 0;
          existing.gamepassPurchases = Number(row.gamepass_purchases) || 0;
          existing.devproductPurchases = Number(row.devproduct_purchases) || 0;
        }
        revenue72h += Number(row.total_revenue) || 0;
        gamepassRevenue72h += Number(row.gamepass_revenue) || 0;
        devproductRevenue72h += Number(row.devproduct_revenue) || 0;
        purchases72hCount += Number(row.total_purchases) || 0;
        gamepassPurchases72h += Number(row.gamepass_purchases) || 0;
        devproductPurchases72h += Number(row.devproduct_purchases) || 0;
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
            gamepassPurchases: data.gamepassPurchases,
            devproductPurchases: data.devproductPurchases,
          });
        });
    }
  } catch (err) {
    sectionErrors.revenue72h = err instanceof Error ? err.message : "Failed to fetch 72h revenue";
  }

  // === FALLBACK: Build hourlyMonetization from purchaseEvents if SQL RPC failed/empty ===
  // This ensures the chart renders whenever the cards show data (same source of truth)
  if (hourlyMonetization.length === 0 && purchaseEvents.length > 0) {
    // Normalize product type from event_type and product_type fields
    const normalizeProductType = (eventType: string, productType: string | null, metadata: Record<string, unknown> | null): "gamepass" | "devproduct" | "unknown" => {
      if (eventType === "gamepass_purchase") return "gamepass";
      if (eventType === "devproduct_purchase") return "devproduct";
      // For purchase_success, check product_type field
      const pt = (productType || (metadata?.product_type as string) || "").toLowerCase();
      if (["gamepass", "game_pass", "pass"].includes(pt)) return "gamepass";
      if (["devproduct", "dev_product", "developer_product"].includes(pt)) return "devproduct";
      return "unknown";
    };

    // Build hourly buckets from raw purchase events
    const fallbackBuckets = new Map<string, {
      total: number; devproduct: number; gamepass: number;
      purchases: number; gamepassPurchases: number; devproductPurchases: number;
    }>();
    
    // Initialize all hours in range with zeros
    for (let i = 0; i < rangeHours; i++) {
      const bucketTime = new Date(rangeNow.getTime() - i * 60 * 60 * 1000);
      const bucketKey = bucketTime.toISOString().slice(0, 13) + ":00:00.000Z";
      fallbackBuckets.set(bucketKey, { total: 0, devproduct: 0, gamepass: 0, purchases: 0, gamepassPurchases: 0, devproductPurchases: 0 });
    }
    
    // Place each purchase into the correct bucket
    purchaseEvents.forEach((e) => {
      const bucketKey = new Date(e.created_at).toISOString().slice(0, 13) + ":00:00.000Z";
      const bucket = fallbackBuckets.get(bucketKey);
      if (!bucket) return; // Event outside range
      
      const robux = getEventRobux(e);
      const pType = normalizeProductType(e.event_type, e.product_type, e.metadata);
      
      bucket.total += robux;
      bucket.purchases += 1;
      if (pType === "gamepass") {
        bucket.gamepass += robux;
        bucket.gamepassPurchases += 1;
      } else if (pType === "devproduct") {
        bucket.devproduct += robux;
        bucket.devproductPurchases += 1;
      }
    });
    
    // Convert to sorted array and populate hourlyMonetization
    Array.from(fallbackBuckets.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .forEach(([time, data]) => {
        hourlyMonetization.push({
          time,
          totalRevenue: data.total,
          devproductRevenue: data.devproduct,
          gamepassRevenue: data.gamepass,
          purchases: data.purchases,
          gamepassPurchases: data.gamepassPurchases,
          devproductPurchases: data.devproductPurchases,
        });
      });
    
    // Also update the totals from the fallback data
    purchaseEvents.forEach((e) => {
      const robux = getEventRobux(e);
      const pType = normalizeProductType(e.event_type, e.product_type, e.metadata);
      revenue72h += robux;
      purchases72hCount += 1;
      if (pType === "gamepass") {
        gamepassRevenue72h += robux;
        gamepassPurchases72h += 1;
      } else if (pType === "devproduct") {
        devproductRevenue72h += robux;
        devproductPurchases72h += 1;
      }
    });
  }

  // === MINUTE-LEVEL MONETIZATION CHART DATA ===
  // Build from purchaseEvents (same source as hourlyMonetization fallback).
  // Groups purchases into 1-minute buckets for 1H/6H chart display.
  const minuteMonetization: Array<{
    time: string;
    totalRevenue: number;
    devproductRevenue: number;
    gamepassRevenue: number;
    purchases: number;
    gamepassPurchases: number;
    devproductPurchases: number;
  }> = [];

  if (purchaseEvents.length > 0) {
    const minuteBuckets = new Map<string, {
      total: number; devproduct: number; gamepass: number;
      purchases: number; gamepassPurchases: number; devproductPurchases: number;
    }>();

    // Normalize product type helper (same logic as hourly fallback)
    const normPType = (eventType: string, productType: string | null, metadata: Record<string, unknown> | null): "gamepass" | "devproduct" | "unknown" => {
      if (eventType === "gamepass_purchase") return "gamepass";
      if (eventType === "devproduct_purchase") return "devproduct";
      const pt = (productType || (metadata?.product_type as string) || "").toLowerCase();
      if (["gamepass", "game_pass", "pass"].includes(pt)) return "gamepass";
      if (["devproduct", "dev_product", "developer_product"].includes(pt)) return "devproduct";
      return "unknown";
    };

    purchaseEvents.forEach((e) => {
      // Bucket key = ISO string truncated to minute precision
      const minuteKey = new Date(e.created_at).toISOString().slice(0, 16) + ":00.000Z";
      const bucket = minuteBuckets.get(minuteKey) || {
        total: 0, devproduct: 0, gamepass: 0, purchases: 0,
        gamepassPurchases: 0, devproductPurchases: 0,
      };

      const robux = getEventRobux(e);
      const pType = normPType(e.event_type, e.product_type, e.metadata);

      bucket.total += robux;
      bucket.purchases += 1;
      if (pType === "gamepass") { bucket.gamepass += robux; bucket.gamepassPurchases += 1; }
      else if (pType === "devproduct") { bucket.devproduct += robux; bucket.devproductPurchases += 1; }
      minuteBuckets.set(minuteKey, bucket);
    });

    Array.from(minuteBuckets.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .forEach(([time, data]) => {
        minuteMonetization.push({
          time,
          totalRevenue: data.total,
          devproductRevenue: data.devproduct,
          gamepassRevenue: data.gamepass,
          purchases: data.purchases,
          gamepassPurchases: data.gamepassPurchases,
          devproductPurchases: data.devproductPurchases,
        });
      });
  }

  // === SESSION DURATION ===
  // Calculate avg session duration from session_end metadata OR paired start/end events
  const sessionDurations: number[] = [];
  const activeSessions = new Map<string, Date>();

  // Helper: extract duration_seconds from session_end metadata
  const extractDurationFromMetadata = (metadata: Record<string, unknown> | null): number | null => {
    if (!metadata) return null;
    // Check multiple metadata fields where duration may be stored
    const candidates = [
      metadata.duration_seconds,
      metadata.session_duration,
      metadata.duration,
    ];
    for (const val of candidates) {
      if (typeof val === "number" && val > 0 && val < 86400) return val;
      if (typeof val === "string") {
        const parsed = parseFloat(val);
        if (!isNaN(parsed) && parsed > 0 && parsed < 86400) return parsed;
      }
    }
    return null;
  };

  // Use the limited session events we fetched (not allEvents)
  [...sessionEvents].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()).forEach((e) => {
    if (!e.player_id) return;
    if (sessionStartTypes.includes(e.event_type)) {
      activeSessions.set(e.player_id, new Date(e.created_at));
    } else if (sessionEndTypes.includes(e.event_type)) {
      // First try: extract duration from session_end metadata
      const metadataDuration = extractDurationFromMetadata(e.metadata);
      if (metadataDuration !== null) {
        sessionDurations.push(metadataDuration);
        activeSessions.delete(e.player_id);
        return;
      }
      // Fallback: calculate from paired start/end timestamps
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
  // IMPORTANT: Must be consistent with uniquePlayers calculation
  // Use ALL player events (excluding server/ccu_heartbeat) not just session events
  
  let newPlayers = 0;
  let returningPlayers = 0;
  let returningPlayersStatus: "ok" | "no_players" | "no_returning_yet" | "needs_history" = "needs_history";
  const playerFirstSeen = new Map<string, Date>();
  const playerDistinctHours = new Map<string, Set<string>>();
  const sampleReturningPlayerIds: string[] = [];

  // Combine ALL player events: session events + purchase events (both have player_id)
  // This ensures uniquePlayers count matches newPlayers + returningPlayers
  const allPlayerEvents = [
    ...sessionEvents.filter((e) => e.player_id && e.player_id !== "server"),
    ...purchaseEvents.filter((e) => e.player_id && e.player_id !== "server"),
  ];
  
  // Get unique player IDs from all player events
  const activePlayerIdsInRange = new Set(allPlayerEvents.map((e) => e.player_id));

  try {
    if (activePlayerIdsInRange.size > 0) {
      // Process all player events for distinct hours calculation
      allPlayerEvents.forEach((e) => {
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
      
      // INVARIANT: newPlayers + returningPlayers = uniquePlayers (from same event set)
      // If there's a mismatch, prefer local calculation over SQL RPC
      const localUniquePlayers = newPlayers + returningPlayers;
      if (localUniquePlayers !== uniquePlayers && localUniquePlayers > 0) {
        // Use local calculation as source of truth
        uniquePlayers = localUniquePlayers;
      }
      
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
      
      // Debug logging
      if (process.env.NODE_ENV === "development") {
        let playersWithMultipleHours = 0;
        playerDistinctHours.forEach((hours) => {
          if (hours.size >= 2) playersWithMultipleHours++;
        });
        
        console.log("[v0] Player Metrics Debug", {
          selectedGameId: gameId,
          sessionEventsCount: sessionEvents.length,
          purchaseEventsCount: purchaseEvents.length,
          combinedPlayerEventsCount: allPlayerEvents.length,
          distinctPlayers: playerDistinctHours.size,
          playersWithMultipleSessions: playersWithMultipleHours,
          activeInRange: activePlayerIdsInRange.size,
          returningUsers: returningPlayers,
          newUsers: newPlayers,
          uniquePlayers,
          invariantCheck: newPlayers + returningPlayers === uniquePlayers ? "PASS" : "MISMATCH",
          returningPlayersStatus,
          rangeStart: startDate.toISOString(),
        });
      }
    } else {
      // No players active in range
      returningPlayersStatus = "no_players";
      // Also set uniquePlayers to 0 if no valid player events found
      uniquePlayers = 0;
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
        (returnVisits || []).forEach((e: { player_id: string | null }) => {
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
  // Use SQL RPC values for accurate product type breakdown (not limited to 2000 events)
  const payingUsers = summaryStats.totalBuyers;
  const gamepassRevenue = summaryStats.gamepassRevenue;
  const devproductRevenue = summaryStats.devproductRevenue;
  const gamepassPurchases = summaryStats.gamepassPurchases;
  const devproductPurchases = summaryStats.devproductPurchases;

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
    
    (robloxProducts || []).forEach((p: { roblox_product_id: string; name: string; product_type: string; price_robux: number | null }) => {
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
      const trackerCcu = activeServers.reduce((sum: number, s: { ccu: number | null }) => sum + (s.ccu || 0), 0);
      ccuStats.current = trackerCcu;
      ccuStats.source = "romonetize_tracker";
    } else if (robloxStats && robloxStats.ccu !== null) {
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
      ccuStats.snapshots = ccuSnapshots.map((s: { ccu: number; captured_at: string | null; created_at: string }) => ({
        time: s.captured_at || s.created_at,
        ccu: s.ccu,
      }));
      // Only override current if not already set from tracker heartbeats
      if (ccuStats.current === null) {
        ccuStats.current = ccuSnapshots[ccuSnapshots.length - 1].ccu;
      }
      ccuStats.peak = Math.max(...ccuSnapshots.map((s: { ccu: number }) => s.ccu));
      ccuStats.avg = Math.round(ccuSnapshots.reduce((sum: number, s: { ccu: number }) => sum + s.ccu, 0) / ccuSnapshots.length);
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
    // Fetch ALL snapshots in last 90 days, ordered by timestamp
    // Use created_at as the primary filter (always populated), then prefer captured_at for display
    const { data: ccuSnapshotsData, error: ccuQueryError } = await supabase
      .from("ccu_snapshots")
      .select("ccu, captured_at, created_at, source")
      .eq("game_id", gameId)
      .gte("created_at", ccuHistoryStart.toISOString())
      .order("created_at", { ascending: true })
      .limit(5000);
    
    if (ccuQueryError) {
      console.error("[Analytics] CCU snapshots query error:", ccuQueryError);
    }
    
    if (ccuSnapshotsData && ccuSnapshotsData.length > 0) {
      ccuHistory.rawSnapshots = ccuSnapshotsData
        .filter((snap: { ccu: number | null }) => snap.ccu !== null)
        .map((snap: { captured_at: string | null; created_at: string; ccu: number; source: string | null }) => ({
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
          .filter((snap: { ccu: number | null }) => snap.ccu !== null)
          .map((snap: { synced_at: string; ccu: number }) => ({
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
    const latestCronSnapshot = cronSnapshots?.find((s: { source: string | null }) => s.source === "vercel_cron");
    const latestBrowserSnapshot = cronSnapshots?.find((s: { source: string | null }) => s.source !== "vercel_cron" && s.source !== null);
    
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
      syncedProducts = robloxProducts.map((p: {
        id: string;
        roblox_product_id: string;
        name: string;
        product_type: string;
        price_robux: number | null;
        is_for_sale: boolean | null;
        icon_url: string | null;
        synced_at: string;
      }) => ({
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
  // Use activityEvents (ALL events except ccu_heartbeat, script_started)
  // This must match totalEventsInRange for card/chart consistency
  const eventsBuckets = new Map<string, number>();
  activityEvents.forEach((e) => {
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
  // IMPORTANT: Only count session START events (player_join + session_start)
  // This must match the Total Sessions card calculation
  const sessionsBuckets = new Map<string, number>();
  sessionEvents
    .filter((e) => sessionStartTypes.includes(e.event_type))
    .forEach((e) => {
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
  // Use range-filtered count for Tracked Actions card (matches chart data)
  totalEvents: totalEventsInRange,
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
  // Use purchaseEvents or sessionEvents for last event time (since allEvents is empty now)
  lastEventTime: latestEventAt || (purchaseEvents.length > 0 ? purchaseEvents[purchaseEvents.length - 1].created_at : (sessionEvents.length > 0 ? sessionEvents[sessionEvents.length - 1].created_at : null)),
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
        gamepassPurchases,
        devproductPurchases,
        payingUsers,
        conversionRate,
        // 72h product type breakdown
        gamepassRevenue72h,
        devproductRevenue72h,
        gamepassPurchases72h,
        devproductPurchases72h,
        // Additional metrics for transparency
        averageDau: averageDau > 0 ? Math.round(averageDau) : 0,
        daysWithData,
        // === NEW: Active user metrics from ACTIVE_USER_EVENT_TYPES ===
        // These are the canonical values for PCR & ARPDAU on the Monetization page
        trackerActiveUsers,
        trackerPayingUsers,
        trackerAverageDau: trackerAverageDau > 0 ? Math.round(trackerAverageDau * 100) / 100 : 0,
        trackerDaysWithData,
        trackerActiveUserEventCounts,
        sampleActiveUserEvents,
        // Pre-calculated PCR: payingUsers / activeUsers * 100
        trackerPcr: trackerActiveUsers > 0 ? (trackerPayingUsers / trackerActiveUsers) * 100 : null,
        // Pre-calculated ARPDAU
        // For ranges <= 24h: ARPDAU = revenue / activeUsersInRange
        // For ranges > 24h: ARPDAU = revenue / averageDailyActiveUsers
        // Uses effectiveMonetizationRangeHours when monetizationRangeHours is specified
        trackerGrossArpdau: (() => {
          // Use monetization range hours if specified, otherwise use main range
          const rangeHoursForArpdau = effectiveMonetizationRangeHours;
          if (rangeHoursForArpdau <= 24) {
            // Short range: use activeUsersInRange as DAU proxy
            return trackerActiveUsers > 0 ? totalRevenue / trackerActiveUsers : null;
          }
          // Long range: use average DAU
          return trackerAverageDau > 0 ? totalRevenue / trackerAverageDau : null;
        })(),
        // Additional debug info for monetization range
        monetizationRangeHours: monetizationRangeHours || null,
        effectiveMonetizationRangeHours,
        // Pagination debug info (to verify all rows fetched)
        purchaseExactCount,
        purchaseRowsFetched: purchaseEvents.length,
        purchasePagesFetched,
        hitSupabaseLimit,
      } : null),
      // Product stats (for Products tab)
      // For free users, return locked state
      productStats: monetizationLocked ? {
        grossTotalRevenue: null,
        estimatedTotalRevenue: null,
        totalRevenue: null,
        totalPurchases: null,
        uniqueBuyers: null,
        uniqueActiveUsers: null,
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
        // Unique active users (for payer conversion rate calculation)
        uniqueActiveUsers: summaryStats.uniquePlayers,
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
  // Now includes product type breakdown for chart filtering
  hourlyMonetization,
  // 24h minute-level monetization data (always from last 24 hours, grouped per minute)
  minuteMonetization,
  // 72h totals with product type breakdown
  revenue72h,
  gamepassRevenue72h,
  devproductRevenue72h,
  purchaseCount72h: purchases72hCount,
  gamepassPurchases72h,
  devproductPurchases72h,
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
    // Unique active users (for payer conversion rate calculation)
    uniqueActiveUsers: summaryStats.uniquePlayers,
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
        // Plan resolution debug - shows exactly how plan was determined
        planDebug: {
          rawProfileData: profileData ? { plan: profileData.plan, subscription_status: profileData.subscription_status } : null,
          resolvedPlanInfo: {
            plan: planInfo.plan,
            status: planInfo.status,
            canAccessMonetization: planInfo.canAccessMonetization,
            canAccessProducts: planInfo.canAccessProducts,
            sourceUsed: planInfo.sourceUsed,
          },
          monetizationLocked,
          userPlan,
        },
        // Monetization summary debug - shows aggregation results
        monetizationDebug: {
          selectedGameId: gameId,
          selectedGameName: selectedGame?.name,
          range,
          rangeStart: startDate.toISOString(),
          rangeEnd: now.toISOString(),
          summaryStats,
          // Pagination debug info
          purchaseExactCount,
          purchaseRowsFetched: purchaseEvents.length,
          purchasePagesFetched,
          pageSize: 1000,
          hitSupabaseLimit,
          revenue72h,
          purchases72hCount,
          grossRevenue: totalRevenue,
          estimatedRevenue: Math.round(totalRevenue * CREATOR_REVENUE_RATE),
          payingUsers: summaryStats.totalBuyers,
          usedSqlRpc: true,
          samplePurchaseEvents: purchaseEvents.slice(0, 5).map(e => ({
            id: e.id,
            event_type: e.event_type,
            robux: e.robux,
            metadata_robux: e.metadata && typeof e.metadata === "object" ? (e.metadata as Record<string, unknown>).robux : undefined,
            product_id: e.product_id,
            product_name: e.product_name,
            product_type: e.product_type,
            created_at: e.created_at,
          })),
          sectionErrors,
        },
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
          purchaseExactCount,
          purchaseRowsFetched: purchaseEvents.length,
          purchasePagesFetched,
          hitSupabaseLimit,
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
        // Revenue debug (range-based) - now using SQL RPC for full selected range
        revenueRangeDebug: {
          windowStart: rangeStart.toISOString(),
          windowEnd: rangeNow.toISOString(),
          rangeHours,
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
