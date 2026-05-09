import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRobloxGameStats } from "@/lib/services/roblox-api";
import { getSelectedGameForUser, getAllGamesForUser, type GameSummary } from "@/lib/server/selected-game";

// Date range options
type DateRange = "1h" | "1d" | "7d" | "30d";

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
          game: null,
          range,
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
  const clickTypes = ["gamepass_click", "devproduct_click", "gamepass_prompt", "devproduct_prompt"];

  // 2. Fetch all events for the selected game in range - paginated to avoid caps
  step = "read_events";
  let allEvents: Array<{
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
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data: events, error } = await supabase
        .from("events")
        .select("id, event_type, player_id, product_id, product_name, product_type, robux, created_at, game_id, metadata")
        .eq("game_id", gameId)
        .gte("created_at", startDate.toISOString())
        .order("created_at", { ascending: true })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (error) {
        sectionErrors.events = error.message;
        break;
      }

      if (events && events.length > 0) {
        allEvents = [...allEvents, ...events];
        hasMore = events.length === pageSize;
        page++;
      } else {
        hasMore = false;
      }
    }
  } catch (err) {
    sectionErrors.events = err instanceof Error ? err.message : "Failed to fetch events";
  }

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

  // Check for purchase events
  const hasPurchaseEvents = allEvents.some(e => purchaseTypes.includes(e.event_type));
  if (hasTrackerEvents && !hasPurchaseEvents) {
    missing.push("no_purchase_events");
  }

  // Check for session/duration events
  const hasSessionEvents = allEvents.some(e => [...sessionStartTypes, ...sessionEndTypes].includes(e.event_type));
  if (hasTrackerEvents && !hasSessionEvents) {
    missing.push("no_session_duration_events");
  }

  // Check for product view/click events
  const hasProductViewEvents = allEvents.some(e => clickTypes.includes(e.event_type));
  if (hasTrackerEvents && !hasProductViewEvents) {
    missing.push("no_product_view_events");
  }

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

  // Auto-sync: If no synced data OR last sync > 5 minutes, fetch fresh from Roblox API
  const SYNC_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
  const lastSyncTime = latestSync?.synced_at ? new Date(latestSync.synced_at).getTime() : 0;
  const needsAutoSync = !robloxStats || (Date.now() - lastSyncTime > SYNC_THRESHOLD_MS);

  if (needsAutoSync && universeId) {
    try {
      const stats = await getRobloxGameStats(universeId);
      if (stats.source === "roblox_api") {
        // Calculate like ratio
        const totalVotes = (stats.likes || 0) + (stats.dislikes || 0);
        const likeRatio = totalVotes > 0 ? (stats.likes || 0) / totalVotes : null;

        robloxStats = {
          ccu: stats.currentPlayers,
          visits: stats.totalVisits,
          favorites: stats.favorites,
          likes: stats.likes,
          dislikes: stats.dislikes,
          likeRatio,
          updatedAt: stats.lastFetched,
          source: "live_api",
        };

        // Update game record with fresh Roblox stats
        await supabase
          .from("games")
          .update({
            current_players: stats.currentPlayers ?? 0,
            total_visits: stats.totalVisits ?? 0,
            favorites: stats.favorites ?? 0,
            likes: stats.likes ?? 0,
            dislikes: stats.dislikes ?? 0,
            last_roblox_sync: new Date().toISOString(),
          })
          .eq("id", gameId);

        // Store snapshot in roblox_game_syncs for historical tracking
        await supabase.from("roblox_game_syncs").insert({
          game_id: gameId,
          roblox_game_id: universeId,
          ccu: stats.currentPlayers ?? 0,
          visits: stats.totalVisits ?? 0,
          favorites: stats.favorites ?? 0,
          likes: stats.likes ?? 0,
          dislikes: stats.dislikes ?? 0,
          like_ratio: likeRatio,
          raw: stats,
          synced_at: new Date().toISOString(),
        });

        // Store CCU snapshot for chart history
        if (stats.currentPlayers !== null) {
          await supabase.from("ccu_snapshots").insert({
            game_id: gameId,
            ccu: stats.currentPlayers,
          });
        }
      }
    } catch (err) {
      sectionErrors.robloxStats = err instanceof Error ? err.message : "Failed to fetch Roblox stats";
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

  // === BASIC STATS ===
  step = "calculate_overview";
  const purchaseEvents = allEvents.filter((e) => purchaseTypes.includes(e.event_type));
  const sessionEvents = allEvents.filter((e) => sessionStartTypes.includes(e.event_type));
  const endEvents = allEvents.filter((e) => sessionEndTypes.includes(e.event_type));
  const clickEvents = allEvents.filter((e) => clickTypes.includes(e.event_type));

  const allPlayerIds = new Set(allEvents.filter((e) => e.player_id).map((e) => e.player_id));
  const uniquePlayers = allPlayerIds.size;
  const totalSessions = sessionEvents.length;
  const totalPurchases = purchaseEvents.length;
  
  // Helper to get robux from event (top-level column OR metadata fallback)
  const getEventRobux = (e: typeof purchaseEvents[0]): number => {
    const topLevelRobux = e.robux;
    const metadataRobux = e.metadata && typeof e.metadata === "object" ? (e.metadata as Record<string, unknown>).robux : undefined;
    return Number(topLevelRobux ?? metadataRobux ?? 0);
  };
  
  const totalRevenue = purchaseEvents.reduce((sum, e) => sum + getEventRobux(e), 0);

  // === 72h REVENUE (like Roblox Dashboard) ===
  const now72h = new Date();
  const start72h = new Date(now72h.getTime() - 72 * 60 * 60 * 1000);
  
  // Query purchase_success events from the last 72 hours (regardless of range filter)
  let purchases72h: typeof purchaseEvents = [];
  try {
    const { data: events72h } = await supabase
      .from("events")
      .select("id, event_type, player_id, product_id, product_name, product_type, robux, created_at, game_id, metadata")
      .eq("game_id", gameId)
      .in("event_type", purchaseTypes)
      .gte("created_at", start72h.toISOString())
      .order("created_at", { ascending: false });
    
    purchases72h = events72h || [];
  } catch (err) {
    sectionErrors.revenue72h = err instanceof Error ? err.message : "Failed to fetch 72h revenue";
  }
  
  const revenue72h = purchases72h.reduce((sum, e) => sum + getEventRobux(e), 0);

  // === HOURLY MONETIZATION CHART DATA (Last 72 hours) ===
  // This is independent of the range filter - always shows last 72 hours grouped hourly
  const hourlyMonetization: Array<{
    time: string;
    totalRevenue: number;
    devproductRevenue: number;
    gamepassRevenue: number;
    purchases: number;
  }> = [];

  // Create buckets for each hour in the last 72 hours
  const hourlyBuckets = new Map<string, { total: number; devproduct: number; gamepass: number; purchases: number }>();
  
  // Initialize all 72 hour buckets with zero values
  for (let i = 0; i < 72; i++) {
    const bucketTime = new Date(now72h.getTime() - i * 60 * 60 * 1000);
    const bucketKey = bucketTime.toISOString().slice(0, 13) + ":00:00.000Z";
    hourlyBuckets.set(bucketKey, { total: 0, devproduct: 0, gamepass: 0, purchases: 0 });
  }

  // Fill in actual purchase data
  purchases72h.forEach((e) => {
    const eventDate = new Date(e.created_at);
    const bucketKey = eventDate.toISOString().slice(0, 13) + ":00:00.000Z";
    const eventRobux = getEventRobux(e);
    
    const existing = hourlyBuckets.get(bucketKey);
    if (existing) {
      existing.total += eventRobux;
      existing.purchases += 1;
      if (e.product_type === "gamepass" || e.event_type === "gamepass_purchase") {
        existing.gamepass += eventRobux;
      } else {
        existing.devproduct += eventRobux;
      }
    }
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

  // Calculate avg session duration from paired events
  const sessionDurations: number[] = [];
  const activeSessions = new Map<string, Date>();

  [...allEvents].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()).forEach((e) => {
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

  // === NEW VS RETURNING PLAYERS ===
  let newPlayers = 0;
  let returningPlayers = 0;
  const playerFirstSeen = new Map<string, Date>();

  try {
    // Get all-time first seen dates for players
    const { data: allTimeJoins } = await supabase
      .from("events")
      .select("player_id, created_at")
      .eq("game_id", gameId)
      .in("event_type", sessionStartTypes)
      .order("created_at", { ascending: true });

    (allTimeJoins || []).forEach((e) => {
      if (e.player_id && !playerFirstSeen.has(e.player_id)) {
        playerFirstSeen.set(e.player_id, new Date(e.created_at));
      }
    });

    allPlayerIds.forEach((playerId) => {
      const firstSeen = playerFirstSeen.get(playerId!);
      if (firstSeen && firstSeen >= startDate) {
        newPlayers++;
      } else {
        returningPlayers++;
      }
    });
  } catch (err) {
    sectionErrors.newReturning = err instanceof Error ? err.message : "Failed to calculate";
  }

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

  const arpdau = uniquePlayers > 0 ? totalRevenue / uniquePlayers : 0;
  const arppu = payingUsers > 0 ? totalRevenue / payingUsers : 0;
  const conversionRate = uniquePlayers > 0 ? (payingUsers / uniquePlayers) * 100 : null;
  const purchaseRate = uniquePlayers > 0 ? (totalPurchases / uniquePlayers) * 100 : null;

  // === PRODUCT STATS ===
  step = "calculate_products";
  
  // First, fetch synced Roblox products for name enrichment
  let robloxProductsMap = new Map<string, { name: string; type: string; price: number }>();
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
    // Non-fatal - continue without Roblox enrichment
    sectionErrors.robloxProductsEnrich = err instanceof Error ? err.message : "Failed to fetch";
  }
  
  // Collect all events by product_id to find best name/type across all events
  const productEventMap = new Map<string, typeof purchaseEvents>();
  [...purchaseEvents, ...clickEvents].forEach((e) => {
    const productId = e.product_id;
    if (!productId) return;
    const existing = productEventMap.get(productId) || [];
    existing.push(e);
    productEventMap.set(productId, existing);
  });
  
  // Helper: resolve product name with priority
  // 1. event.product_name
  // 2. event.metadata.product_name
  // 3. matching product from roblox_products by product_id
  // 4. matching known product name from another event with same product_id
  // 5. fallback: Product {product_id}
  // 6. final fallback: Unknown Product (only if no product_id)
  function resolveProductName(productId: string | null, events: typeof purchaseEvents): string {
    if (!productId) return "Unknown Product";
    
    // Check all events for this product_id for a name
    for (const e of events) {
      if (e.product_name && e.product_name !== "Unknown Product" && e.product_name !== "Unknown Gamepass") {
        return e.product_name;
      }
      // Check metadata
      const meta = e.metadata as Record<string, unknown> | null;
      if (meta?.product_name && typeof meta.product_name === "string") {
        return meta.product_name;
      }
    }
    
    // Check Roblox synced products
    const robloxProduct = robloxProductsMap.get(productId);
    if (robloxProduct?.name) {
      return robloxProduct.name;
    }
    
    // Fallback to Product {product_id}
    return `Product ${productId}`;
  }
  
  // Helper: resolve product type with priority
  function resolveProductType(productId: string | null, events: typeof purchaseEvents): string {
    // Check events
    for (const e of events) {
      if (e.product_type && e.product_type !== "unknown") {
        return e.product_type;
      }
      if (e.event_type === "gamepass_purchase" || e.event_type === "gamepass_click") {
        return "gamepass";
      }
      if (e.event_type === "devproduct_purchase" || e.event_type === "devproduct_click") {
        return "devproduct";
      }
    }
    
    // Check Roblox synced products
    if (productId) {
      const robloxProduct = robloxProductsMap.get(productId);
      if (robloxProduct?.type) {
        return robloxProduct.type;
      }
    }
    
    return "gamepass";
  }
  
  const productMap = new Map<string, {
    id: string;
    name: string;
    type: string;
    revenue: number;
    purchases: number;
    clicks: number;
    uniqueBuyers: Set<string>;
  }>();

  purchaseEvents.forEach((e) => {
    const key = e.product_id || "unknown";
    const eventRobux = getEventRobux(e);
    const existing = productMap.get(key);
    
    if (existing) {
      existing.revenue += eventRobux;
      existing.purchases += 1;
      if (e.player_id) existing.uniqueBuyers.add(e.player_id);
    } else {
      const buyers = new Set<string>();
      if (e.player_id) buyers.add(e.player_id);
      
      // Get all events for this product to resolve name/type
      const allEventsForProduct = productEventMap.get(key) || [e];
      
      productMap.set(key, {
        id: e.product_id || key,
        name: resolveProductName(e.product_id, allEventsForProduct),
        type: resolveProductType(e.product_id, allEventsForProduct),
        revenue: eventRobux,
        purchases: 1,
        clicks: 0,
        uniqueBuyers: buyers,
      });
    }
  });

  clickEvents.forEach((e) => {
    const key = e.product_id || "unknown";
    const existing = productMap.get(key);
    
    if (existing) {
      existing.clicks += 1;
    } else {
      // Get all events for this product to resolve name/type
      const allEventsForProduct = productEventMap.get(key) || [e];
      
      productMap.set(key, {
        id: e.product_id || key,
        name: resolveProductName(e.product_id, allEventsForProduct),
        type: resolveProductType(e.product_id, allEventsForProduct),
        revenue: 0,
        purchases: 0,
        clicks: 1,
        uniqueBuyers: new Set(),
      });
    }
  });

  const products = Array.from(productMap.values())
    .map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      revenue: p.revenue,
      purchases: p.purchases,
      uniqueBuyers: p.uniqueBuyers.size,
      clicks: p.clicks,
      conversionRate: p.clicks > 0 ? (p.purchases / p.clicks) * 100 : null,
      conversionNeedsTracking: p.clicks === 0 && p.purchases > 0,
      revPerBuyer: p.uniqueBuyers.size > 0 ? p.revenue / p.uniqueBuyers.size : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const totalProductRevenue = products.reduce((sum, p) => sum + p.revenue, 0);
  const totalProductPurchases = products.reduce((sum, p) => sum + p.purchases, 0);
  const totalUniqueBuyers = new Set(purchaseEvents.filter((e) => e.player_id).map((e) => e.player_id)).size;
  const productsWithClicks = products.filter((p) => p.clicks > 0 && p.conversionRate !== null);
  const avgConversionRate = productsWithClicks.length > 0
    ? productsWithClicks.reduce((sum, p) => sum + (p.conversionRate || 0), 0) / productsWithClicks.length
    : null;

  // === CCU STATS (from snapshots) ===
  let ccuStats = {
    current: robloxStats?.ccu ?? null,
    peak: null as number | null,
    avg: null as number | null,
    snapshots: [] as Array<{ time: string; ccu: number }>,
    message: null as string | null,
  };

  try {
    const { data: ccuSnapshots } = await supabase
      .from("ccu_snapshots")
      .select("ccu, created_at")
      .eq("game_id", gameId)
      .gte("created_at", startDate.toISOString())
      .order("created_at", { ascending: true });

    if (ccuSnapshots && ccuSnapshots.length > 0) {
      ccuStats.snapshots = ccuSnapshots.map((s) => ({
        time: s.created_at,
        ccu: s.ccu,
      }));
      ccuStats.current = ccuSnapshots[ccuSnapshots.length - 1].ccu;
      ccuStats.peak = Math.max(...ccuSnapshots.map((s) => s.ccu));
      ccuStats.avg = Math.round(ccuSnapshots.reduce((sum, s) => sum + s.ccu, 0) / ccuSnapshots.length);
    } else {
      ccuStats.message = "CCU chart will appear after the first sync";
    }
  } catch (err) {
    sectionErrors.ccu = err instanceof Error ? err.message : "Failed to fetch CCU";
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
  // Revenue chart bucketed by range
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

  // Players chart
  const playerBuckets = new Map<string, { total: Set<string>; new: number; returning: number }>();

  allEvents.filter((e) => e.player_id).forEach((e) => {
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
  const eventsBuckets = new Map<string, number>();
  allEvents.forEach((e) => {
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

  // === TOP PRODUCTS ===
  const topProducts = products.slice(0, 10).map(p => ({
    productId: p.id,
    productName: p.name,
    productType: p.type,
    revenue: p.revenue,
    purchases: p.purchases,
    buyers: p.uniqueBuyers,
  }));

  return NextResponse.json({
    success: true,
    data: {
      game: {
        id: selectedGame.id,
        name: selectedGame.name,
        roblox_game_id: selectedGame.roblox_game_id,
        universe_id: universeId || selectedGame.universe_id,
      },
      range,
      // Data health diagnostics
      dataHealth,
      // Roblox public API stats
      robloxStats,
      // Overview stats (for Overview tab)
      overview: {
        totalRevenue,
        totalPurchases,
        uniquePlayers,
        playerJoins: totalSessions,
        conversionRate,
        purchaseRate,
      },
      // Tracker stats (for Game Performance tab)
      // Always return object with safe values when tracker is active
      trackerStats: hasTrackerEvents ? {
        totalEvents: totalEventsCount,
        uniquePlayers: uniquePlayers || 0,
        totalSessions: totalSessions || 0,
        avgSessionDuration: avgSessionDuration || null,
        avgSessionFormatted: avgSessionDuration ? `${Math.floor(avgSessionDuration / 60)}m` : null,
        newPlayers: newPlayers || 0,
        returningPlayers: returningPlayers || 0,
        totalPurchases: totalPurchases || 0,
        lastEventTime: latestEventAt || (allEvents.length > 0 ? allEvents[allEvents.length - 1].created_at : null),
      } : null,
      // Revenue stats (for Monetization tab)
      revenueStats: hasTrackerEvents ? {
        totalRevenue,
        revenue72h,
        gamepassRevenue,
        devproductRevenue,
        totalPurchases,
        payingUsers,
        conversionRate,
        arpdau,
        arppu,
      } : null,
      // Product stats (for Products tab)
      productStats: {
        totalRevenue: totalProductRevenue,
        totalPurchases: totalProductPurchases,
        uniqueBuyers: totalUniqueBuyers,
        avgConversionRate,
        avgConversionNeedsTracking: productsWithClicks.length === 0 && products.length > 0,
        products: products.slice(0, 50), // Top 50
        hasTrackerData: hasTrackerEvents,
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
      // Monetization charts
      monetizationCharts: hasTrackerEvents ? {
        revenueOverTime: revenueChart.map(r => ({ date: r.time, revenue: r.revenue })),
        purchasesOverTime,
        revenueByProductType,
        topProducts,
        // New: 72h hourly monetization data (always from last 72 hours, grouped hourly)
        hourlyMonetization,
        revenue72h,
        purchaseCount72h: purchases72h.length,
      } : null,
      // Product analytics
      productAnalytics: {
        products: products.map(p => ({
          productId: p.id,
          productName: p.name,
          productType: p.type,
          priceRobux: 0, // Would need to be fetched from Roblox API/synced products
          revenue: p.revenue,
          purchases: p.purchases,
          buyers: p.uniqueBuyers,
          views: 0, // Future: from product_view events
          clicks: p.clicks,
          conversionRate: p.conversionRate,
          revenuePerBuyer: p.revPerBuyer,
        })),
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
        // 72h Revenue debug (like Roblox Dashboard)
        revenue72hDebug: {
          windowStart: start72h.toISOString(),
          purchaseCount72h: purchases72h.length,
          revenue72h,
          recentPurchases: purchases72h.slice(0, 10).map(e => ({
            event_type: e.event_type,
            player_id: e.player_id,
            product_id: e.product_id,
            product_name: e.product_name,
            product_type: e.product_type,
            robux: getEventRobux(e),
            created_at: e.created_at,
          })),
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
