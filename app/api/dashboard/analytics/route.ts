import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRobloxGameStats, getUniverseIdFromPlaceId } from "@/lib/services/roblox-api";

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
 * GET /api/dashboard/analytics?range=7d
 * 
 * Returns:
 * - dataHealth: diagnostic info about data availability
 * - robloxStats: public Roblox API stats (CCU, visits, favorites, etc)
 * - trackerStats: deep analytics from tracking script
 * - All other analytics data
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const range = (searchParams.get("range") || "7d") as DateRange;

  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  }

  // Section errors tracking
  const sectionErrors: Record<string, string> = {};

  // 1. Get selected game (is_selected = true) with full details
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
  } | null = null;

  const { data: selectedGameData } = await supabase
    .from("games")
    .select("id, name, roblox_game_id, universe_id, root_place_id, api_key, last_event_at, current_players, total_visits, favorites, likes, dislikes, last_roblox_sync")
    .eq("user_id", user.id)
    .eq("is_selected", true)
    .neq("status", "deleted")
    .single();

  if (selectedGameData) {
    selectedGame = selectedGameData;
  } else {
    // No game selected - auto-select the first active game
    const { data: firstGame } = await supabase
      .from("games")
      .select("id, name, roblox_game_id, universe_id, root_place_id, api_key, last_event_at, current_players, total_visits, favorites, likes, dislikes, last_roblox_sync")
      .eq("user_id", user.id)
      .neq("status", "deleted")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (firstGame) {
      // Auto-select this game
      await supabase
        .from("games")
        .update({ is_selected: true })
        .eq("id", firstGame.id);
      
      selectedGame = firstGame;
    }
  }

  // No games at all - return empty state with dataHealth
  if (!selectedGame) {
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
          missing: ["no_game_connected"],
        },
        overview: null,
        trackerStats: null,
        revenueStats: null,
        productStats: null,
        retentionStats: null,
        ccuStats: null,
        robloxStats: null,
        charts: null,
        sectionErrors: {},
        lastUpdated: new Date().toISOString(),
      },
    });
  }

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

  // Get total event count for dataHealth (all-time, not just range)
  let totalEventsCount = 0;
  try {
    const { count } = await supabase
      .from("events")
      .select("*", { count: "exact", head: true })
      .eq("game_id", gameId);
    totalEventsCount = count || 0;
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
  let robloxStats: {
    ccu: number | null;
    visits: number | null;
    favorites: number | null;
    likes: number | null;
    dislikes: number | null;
    likeRatio: number | null;
    updatedAt: string | null;
  } | null = null;

  // Resolve universe ID if needed
  let universeId = selectedGame.universe_id;
  if (!universeId && selectedGame.roblox_game_id) {
    universeId = await getUniverseIdFromPlaceId(selectedGame.roblox_game_id);
    if (universeId) {
      // Store for future use
      await supabase
        .from("games")
        .update({ universe_id: universeId })
        .eq("id", gameId);
    }
  }

  if (universeId) {
    try {
      const stats = await getRobloxGameStats(universeId);
      if (stats.source === "roblox_api") {
        robloxStats = {
          ccu: stats.currentPlayers,
          visits: stats.totalVisits,
          favorites: stats.favorites,
          likes: stats.likes,
          dislikes: stats.dislikes,
          likeRatio: stats.likeRatio,
          updatedAt: stats.lastFetched,
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

        // Store CCU snapshot for chart history
        if (stats.currentPlayers !== null) {
          await supabase.from("ccu_snapshots").insert({
            game_id: gameId,
            ccu: stats.currentPlayers,
          });
        }
      } else {
        if (!hasRobloxApiData) {
          missing.push("roblox_api_unavailable");
        }
        sectionErrors.robloxStats = "Could not fetch Roblox API data";
      }
    } catch (err) {
      sectionErrors.robloxStats = err instanceof Error ? err.message : "Failed to fetch Roblox stats";
      if (!hasRobloxApiData) {
        missing.push("roblox_api_unavailable");
      }
    }
  } else {
    if (!hasRobloxApiData) {
      missing.push("roblox_api_unavailable");
    }
  }

  // Build dataHealth
  const dataHealth = {
    selectedGameId: selectedGame.id,
    robloxGameId: selectedGame.roblox_game_id,
    rootPlaceId: selectedGame.root_place_id,
    gameName: selectedGame.name,
    hasTrackerEvents,
    trackerEventsCount: totalEventsCount,
    lastTrackerEventAt: selectedGame.last_event_at,
    hasRobloxApiData: hasRobloxApiData || robloxStats !== null,
    robloxApiLastSyncedAt: selectedGame.last_roblox_sync || robloxStats?.updatedAt || null,
    missing,
  };

  // === BASIC STATS ===
  const purchaseEvents = allEvents.filter((e) => purchaseTypes.includes(e.event_type));
  const sessionEvents = allEvents.filter((e) => sessionStartTypes.includes(e.event_type));
  const endEvents = allEvents.filter((e) => sessionEndTypes.includes(e.event_type));
  const clickEvents = allEvents.filter((e) => clickTypes.includes(e.event_type));

  const allPlayerIds = new Set(allEvents.filter((e) => e.player_id).map((e) => e.player_id));
  const uniquePlayers = allPlayerIds.size;
  const totalSessions = sessionEvents.length;
  const totalPurchases = purchaseEvents.length;
  const totalRevenue = purchaseEvents.reduce((sum, e) => sum + (e.robux || 0), 0);

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
    .reduce((sum, e) => sum + (e.robux || 0), 0);
  const devproductRevenue = purchaseEvents
    .filter((e) => e.product_type === "devproduct" || e.event_type === "devproduct_purchase")
    .reduce((sum, e) => sum + (e.robux || 0), 0);

  const arpdau = uniquePlayers > 0 ? totalRevenue / uniquePlayers : 0;
  const arppu = payingUsers > 0 ? totalRevenue / payingUsers : 0;
  const conversionRate = uniquePlayers > 0 ? (payingUsers / uniquePlayers) * 100 : null;
  const purchaseRate = uniquePlayers > 0 ? (totalPurchases / uniquePlayers) * 100 : null;

  // === PRODUCT STATS ===
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
    const key = e.product_id || e.product_name || "unknown";
    const existing = productMap.get(key);
    if (existing) {
      existing.revenue += e.robux || 0;
      existing.purchases += 1;
      if (e.player_id) existing.uniqueBuyers.add(e.player_id);
    } else {
      const buyers = new Set<string>();
      if (e.player_id) buyers.add(e.player_id);
      productMap.set(key, {
        id: e.product_id || key,
        name: e.product_name || "Unknown Product",
        type: e.product_type || "gamepass",
        revenue: e.robux || 0,
        purchases: 1,
        clicks: 0,
        uniqueBuyers: buyers,
      });
    }
  });

  clickEvents.forEach((e) => {
    const key = e.product_id || e.product_name || "unknown";
    const existing = productMap.get(key);
    if (existing) {
      existing.clicks += 1;
    } else {
      productMap.set(key, {
        id: e.product_id || key,
        name: e.product_name || "Unknown Product",
        type: e.product_type || "gamepass",
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

    const existing = revenueBuckets.get(bucketKey) || { revenue: 0, purchases: 0, passes: 0, devProducts: 0 };
    existing.revenue += e.robux || 0;
    existing.purchases += 1;
    if (e.product_type === "gamepass" || e.event_type === "gamepass_purchase") {
      existing.passes += e.robux || 0;
    } else {
      existing.devProducts += e.robux || 0;
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
      trackerStats: hasTrackerEvents ? {
        totalEvents: allEvents.length,
        uniquePlayers,
        totalSessions,
        avgSessionDuration,
        avgSessionFormatted: avgSessionDuration ? `${Math.floor(avgSessionDuration / 60)}m` : null,
        newPlayers,
        returningPlayers,
        totalPurchases,
        lastEventTime: allEvents.length > 0 ? allEvents[allEvents.length - 1].created_at : null,
      } : null,
      // Revenue stats (for Monetization tab)
      revenueStats: hasTrackerEvents ? {
        totalRevenue,
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
      // Retention stats
      retentionStats,
      // CCU stats
      ccuStats,
      // Charts
      charts: hasTrackerEvents ? {
        revenue: revenueChart,
        players: playersChart,
      } : null,
      sectionErrors,
      lastUpdated: new Date().toISOString(),
    },
  });
}
