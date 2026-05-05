"use server";

import { createClient } from "@/lib/supabase/server";
import { getRobloxGameStats, getUniverseIdFromPlaceId } from "@/lib/services/roblox-api";

// Data source types
export type DataSource = "roblox_api" | "romonetize_tracker" | "not_available";

export interface PerformanceStats {
  // From RoMonetize Tracker
  totalEvents: number;
  uniquePlayers: number;
  purchases: number;
  revenue: number;
  visits: number;
  shopOpens: number;
  lastEventTime: string | null;
  
  // Player metrics (from tracker)
  newPlayers: number;
  returningPlayers: number;
  avgSessionDuration: number | null; // in seconds
  avgPlaytime: number | null; // in minutes per player
  
  // Retention metrics (from tracker)
  day1Retention: number | null;
  day7Retention: number | null;
  day30Retention: number | null;
  
  // Monetization metrics (from tracker)
  arpdau: number | null; // Average Revenue Per Daily Active User
  arppu: number | null; // Average Revenue Per Paying User
  
  // Source tracking
  trackerSource: DataSource;
}

export interface RobloxApiStats {
  currentPlayers: number | null;
  totalVisits: number | null;
  favorites: number | null;
  likes: number | null;
  dislikes: number | null;
  likeRatio: number | null;
  source: DataSource;
  lastFetched: string | null;
}

export interface TimeSeriesData {
  date: string;
  players: number;
  newPlayers: number;
  returningPlayers: number;
  events: number;
  purchases: number;
  revenue: number;
  avgSessionDuration: number;
}

export interface PerformanceData {
  stats: PerformanceStats;
  robloxStats: RobloxApiStats;
  timeSeries: TimeSeriesData[];
}

// Get performance stats for a specific game
export async function getPerformanceStats(
  gameId: string,
  days: number = 7
): Promise<{ data: PerformanceData | null; error: string | null }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { data: null, error: "Not authenticated" };
  }

  // Verify game ownership and get roblox_game_id
  const { data: game } = await supabase
    .from("games")
    .select("id, roblox_game_id")
    .eq("id", gameId)
    .eq("user_id", user.id)
    .single();

  if (!game) {
    return { data: null, error: "Game not found" };
  }

  // Calculate date range
  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - days);

  // Fetch events and Roblox API stats in parallel
  const [eventsResult, robloxStatsResult] = await Promise.all([
    supabase
      .from("events")
      .select("id, event_type, player_id, robux, created_at, metadata")
      .eq("game_id", gameId)
      .gte("created_at", startDate.toISOString())
      .order("created_at", { ascending: true }),
    fetchRobloxStats(game.roblox_game_id),
  ]);

  if (eventsResult.error) {
    return { data: null, error: eventsResult.error.message };
  }

  const events = eventsResult.data || [];

  // Event type groups (legacy + new Roblox events)
  const purchaseTypes = ["purchase_success", "gamepass_purchase", "devproduct_purchase"];
  const sessionStartTypes = ["player_join", "session_start"];
  const sessionEndTypes = ["player_leave", "session_end"];
  const shopTypes = ["shop_open", "offer_view"];
  
  // Calculate basic stats
  const totalEvents = events.length;
  const allPlayerIds = new Set(events.filter(e => e.player_id).map(e => e.player_id));
  const uniquePlayers = allPlayerIds.size;
  const purchaseEvents = events.filter(e => purchaseTypes.includes(e.event_type));
  const purchases = purchaseEvents.length;
  const revenue = purchaseEvents.reduce((sum, e) => sum + (e.robux || 0), 0);
  const visits = events.filter(e => sessionStartTypes.includes(e.event_type)).length;
  const shopOpens = events.filter(e => shopTypes.includes(e.event_type)).length;
  const lastEvent = events.length > 0 ? events[events.length - 1] : null;
  const lastEventTime = lastEvent?.created_at || null;

  // Track player first seen dates for retention calculation
  const { data: allTimeEvents } = await supabase
    .from("events")
    .select("player_id, created_at")
    .eq("game_id", gameId)
    .in("event_type", sessionStartTypes)
    .order("created_at", { ascending: true });

  // Calculate first seen date for each player
  const playerFirstSeen = new Map<string, Date>();
  (allTimeEvents || []).forEach(e => {
    if (e.player_id && !playerFirstSeen.has(e.player_id)) {
      playerFirstSeen.set(e.player_id, new Date(e.created_at));
    }
  });

  // Calculate new vs returning players
  let newPlayers = 0;
  let returningPlayers = 0;
  
  allPlayerIds.forEach(playerId => {
    const firstSeen = playerFirstSeen.get(playerId);
    if (firstSeen && firstSeen >= startDate) {
      newPlayers++;
    } else {
      returningPlayers++;
    }
  });

  // Calculate session duration from paired join/leave events
  const sessionDurations: number[] = [];
  const playerSessions = new Map<string, Date>();
  
  events.forEach(e => {
    if (!e.player_id) return;
    
    if (sessionStartTypes.includes(e.event_type)) {
      playerSessions.set(e.player_id, new Date(e.created_at));
    } else if (sessionEndTypes.includes(e.event_type)) {
      const startTime = playerSessions.get(e.player_id);
      if (startTime) {
        const duration = (new Date(e.created_at).getTime() - startTime.getTime()) / 1000;
        if (duration > 0 && duration < 86400) { // Ignore sessions longer than 24h
          sessionDurations.push(duration);
        }
        playerSessions.delete(e.player_id);
      }
    }
  });

  const avgSessionDuration = sessionDurations.length > 0 
    ? Math.round(sessionDurations.reduce((a, b) => a + b, 0) / sessionDurations.length)
    : null;

  // Calculate average playtime per player
  const totalPlaytime = sessionDurations.reduce((a, b) => a + b, 0);
  const avgPlaytime = uniquePlayers > 0 ? Math.round(totalPlaytime / uniquePlayers / 60) : null;

  // Calculate retention (requires historical data)
  const retention = await calculateRetention(supabase, gameId, sessionStartTypes);

  // Calculate ARPDAU and ARPPU
  const daysWithPlayers = new Set(
    events.filter(e => e.player_id).map(e => new Date(e.created_at).toISOString().split("T")[0])
  ).size;
  const dailyActivePlayers = daysWithPlayers > 0 ? uniquePlayers / daysWithPlayers : 0;
  const arpdau = dailyActivePlayers > 0 ? revenue / (dailyActivePlayers * Math.min(days, daysWithPlayers)) : null;
  
  const payingPlayers = new Set(purchaseEvents.filter(e => e.player_id).map(e => e.player_id)).size;
  const arppu = payingPlayers > 0 ? revenue / payingPlayers : null;

  // Build time series data grouped by day
  const timeSeriesMap = new Map<string, TimeSeriesData>();
  const playersByDay = new Map<string, Set<string>>();
  const newPlayersByDay = new Map<string, Set<string>>();
  const returningPlayersByDay = new Map<string, Set<string>>();
  const sessionDurationsByDay = new Map<string, number[]>();

  // Initialize all days in range with zeros
  for (let i = 0; i < days; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() - (days - 1 - i));
    const dateStr = date.toISOString().split("T")[0];
    timeSeriesMap.set(dateStr, {
      date: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      players: 0,
      newPlayers: 0,
      returningPlayers: 0,
      events: 0,
      purchases: 0,
      revenue: 0,
      avgSessionDuration: 0,
    });
    playersByDay.set(dateStr, new Set());
    newPlayersByDay.set(dateStr, new Set());
    returningPlayersByDay.set(dateStr, new Set());
    sessionDurationsByDay.set(dateStr, []);
  }

  // Track session starts per day for duration calculation
  const playerSessionsByDay = new Map<string, Map<string, Date>>();

  // Aggregate events by day
  events.forEach((event) => {
    const eventDate = new Date(event.created_at);
    const dateStr = eventDate.toISOString().split("T")[0];
    const existing = timeSeriesMap.get(dateStr);

    if (existing) {
      existing.events += 1;

      // Track purchases
      if (purchaseTypes.includes(event.event_type)) {
        existing.purchases += 1;
        existing.revenue += event.robux || 0;
      }

      // Track players
      if (event.player_id) {
        playersByDay.get(dateStr)?.add(event.player_id);
        
        // Check if new or returning
        const firstSeen = playerFirstSeen.get(event.player_id);
        if (firstSeen && firstSeen.toISOString().split("T")[0] === dateStr) {
          newPlayersByDay.get(dateStr)?.add(event.player_id);
        } else {
          returningPlayersByDay.get(dateStr)?.add(event.player_id);
        }

        // Track session duration
        if (!playerSessionsByDay.has(dateStr)) {
          playerSessionsByDay.set(dateStr, new Map());
        }
        const daySessions = playerSessionsByDay.get(dateStr)!;

        if (sessionStartTypes.includes(event.event_type)) {
          daySessions.set(event.player_id, eventDate);
        } else if (sessionEndTypes.includes(event.event_type)) {
          const startTime = daySessions.get(event.player_id);
          if (startTime) {
            const duration = (eventDate.getTime() - startTime.getTime()) / 1000;
            if (duration > 0 && duration < 86400) {
              sessionDurationsByDay.get(dateStr)?.push(duration);
            }
            daySessions.delete(event.player_id);
          }
        }
      }
    }
  });

  // Set aggregated values per day
  playersByDay.forEach((players, dateStr) => {
    const existing = timeSeriesMap.get(dateStr);
    if (existing) {
      existing.players = players.size;
      existing.newPlayers = newPlayersByDay.get(dateStr)?.size || 0;
      existing.returningPlayers = returningPlayersByDay.get(dateStr)?.size || 0;
      
      const durations = sessionDurationsByDay.get(dateStr) || [];
      existing.avgSessionDuration = durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0;
    }
  });

  const timeSeries = Array.from(timeSeriesMap.values());

  return {
    data: {
      stats: {
        totalEvents,
        uniquePlayers,
        purchases,
        revenue,
        visits,
        shopOpens,
        lastEventTime,
        newPlayers,
        returningPlayers,
        avgSessionDuration,
        avgPlaytime,
        day1Retention: retention.day1,
        day7Retention: retention.day7,
        day30Retention: retention.day30,
        arpdau: arpdau ? Math.round(arpdau * 100) / 100 : null,
        arppu: arppu ? Math.round(arppu * 100) / 100 : null,
        trackerSource: totalEvents > 0 ? "romonetize_tracker" : "not_available",
      },
      robloxStats: robloxStatsResult,
      timeSeries,
    },
    error: null,
  };
}

// Fetch Roblox API stats with universe ID conversion
async function fetchRobloxStats(robloxGameId: string): Promise<RobloxApiStats> {
  try {
    // roblox_game_id is typically a place ID, need to get universe ID
    const universeId = await getUniverseIdFromPlaceId(robloxGameId);
    
    if (!universeId) {
      // Try using the ID directly as universe ID
      const stats = await getRobloxGameStats(robloxGameId);
      return {
        currentPlayers: stats.currentPlayers,
        totalVisits: stats.totalVisits,
        favorites: stats.favorites,
        likes: stats.likes,
        dislikes: stats.dislikes,
        likeRatio: stats.likeRatio,
        source: stats.source === "roblox_api" ? "roblox_api" : "not_available",
        lastFetched: stats.lastFetched,
      };
    }

    const stats = await getRobloxGameStats(universeId);
    return {
      currentPlayers: stats.currentPlayers,
      totalVisits: stats.totalVisits,
      favorites: stats.favorites,
      likes: stats.likes,
      dislikes: stats.dislikes,
      likeRatio: stats.likeRatio,
      source: stats.source === "roblox_api" ? "roblox_api" : "not_available",
      lastFetched: stats.lastFetched,
    };
  } catch (error) {
    console.error("[v0] Error fetching Roblox stats:", error);
    return {
      currentPlayers: null,
      totalVisits: null,
      favorites: null,
      likes: null,
      dislikes: null,
      likeRatio: null,
      source: "not_available",
      lastFetched: null,
    };
  }
}

// Calculate retention metrics
async function calculateRetention(
  supabase: Awaited<ReturnType<typeof createClient>>,
  gameId: string,
  sessionStartTypes: string[]
): Promise<{ day1: number | null; day7: number | null; day30: number | null }> {
  const now = new Date();
  
  // Get cohort of players who first played 30+ days ago
  const cohortStartDate = new Date(now);
  cohortStartDate.setDate(cohortStartDate.getDate() - 37); // 30 days + 7 day buffer
  const cohortEndDate = new Date(now);
  cohortEndDate.setDate(cohortEndDate.getDate() - 30);

  // Get all session events for retention calculation
  const { data: allEvents } = await supabase
    .from("events")
    .select("player_id, created_at")
    .eq("game_id", gameId)
    .in("event_type", sessionStartTypes)
    .gte("created_at", cohortStartDate.toISOString())
    .order("created_at", { ascending: true });

  if (!allEvents || allEvents.length === 0) {
    return { day1: null, day7: null, day30: null };
  }

  // Find first play date for each player
  const playerFirstPlay = new Map<string, Date>();
  allEvents.forEach(e => {
    if (e.player_id && !playerFirstPlay.has(e.player_id)) {
      playerFirstPlay.set(e.player_id, new Date(e.created_at));
    }
  });

  // Get cohort: players who first played in the cohort window
  const cohortPlayers = new Set<string>();
  playerFirstPlay.forEach((firstPlay, playerId) => {
    if (firstPlay >= cohortStartDate && firstPlay < cohortEndDate) {
      cohortPlayers.add(playerId);
    }
  });

  if (cohortPlayers.size === 0) {
    return { day1: null, day7: null, day30: null };
  }

  // Track return visits
  const returnedDay1 = new Set<string>();
  const returnedDay7 = new Set<string>();
  const returnedDay30 = new Set<string>();

  allEvents.forEach(e => {
    if (!e.player_id || !cohortPlayers.has(e.player_id)) return;
    
    const firstPlay = playerFirstPlay.get(e.player_id);
    if (!firstPlay) return;

    const eventDate = new Date(e.created_at);
    const daysSinceFirst = Math.floor((eventDate.getTime() - firstPlay.getTime()) / (1000 * 60 * 60 * 24));

    if (daysSinceFirst === 1) returnedDay1.add(e.player_id);
    if (daysSinceFirst >= 1 && daysSinceFirst <= 7) returnedDay7.add(e.player_id);
    if (daysSinceFirst >= 1 && daysSinceFirst <= 30) returnedDay30.add(e.player_id);
  });

  const cohortSize = cohortPlayers.size;
  return {
    day1: cohortSize > 0 ? Math.round((returnedDay1.size / cohortSize) * 100) : null,
    day7: cohortSize > 0 ? Math.round((returnedDay7.size / cohortSize) * 100) : null,
    day30: cohortSize > 0 ? Math.round((returnedDay30.size / cohortSize) * 100) : null,
  };
}
