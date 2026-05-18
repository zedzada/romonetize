import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSelectedGameForUser } from "@/lib/server/selected-game";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RangeKey = "24h" | "72h" | "7d" | "28d" | "90d";

const RANGE_MS: Record<RangeKey, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "72h": 72 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "28d": 28 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
};

// Bucket interval for charts
const BUCKET_CONFIG: Record<RangeKey, { bucketMs: number; bucketType: "hour" | "day" }> = {
  "24h": { bucketMs: 60 * 60 * 1000, bucketType: "hour" },
  "72h": { bucketMs: 60 * 60 * 1000, bucketType: "hour" },
  "7d": { bucketMs: 24 * 60 * 60 * 1000, bucketType: "day" },
  "28d": { bucketMs: 24 * 60 * 60 * 1000, bucketType: "day" },
  "90d": { bucketMs: 24 * 60 * 60 * 1000, bucketType: "day" },
};

// Event types that count as "tracked actions" (exclude heartbeats and script events)
const EXCLUDED_EVENT_TYPES = ["ccu_heartbeat", "script_started"];

// Event types for sessions
const SESSION_EVENT_TYPES = ["player_join", "session_start"];

// Event types for purchases
const PURCHASE_EVENT_TYPES = ["purchase_success", "devproduct_purchase", "gamepass_purchase"];

// Event types for player tracking (unique/new players)
const PLAYER_EVENT_TYPES = [
  "player_join",
  "session_start",
  "session_end",
  "purchase_success",
  "devproduct_purchase",
  "gamepass_purchase",
];

function getBucketKey(isoTimestamp: string, bucketType: "hour" | "day"): string {
  const date = new Date(isoTimestamp);
  if (bucketType === "hour") {
    return new Date(Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      date.getUTCHours()
    )).toISOString();
  }
  // day bucket
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  )).toISOString();
}

export async function GET(request: NextRequest) {
  const headers = {
    "Cache-Control": "no-store",
  };

  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401, headers }
      );
    }

    // Get selected game using shared utility
    const { game: selectedGame, error: gameError } = await getSelectedGameForUser(user.id, supabase as Parameters<typeof getSelectedGameForUser>[1]);

    if (gameError) {
      return NextResponse.json(
        { success: false, error: gameError },
        { status: 500, headers }
      );
    }

    if (!selectedGame) {
      return NextResponse.json(
        { success: false, error: "No game found" },
        { status: 400, headers }
      );
    }

    // Resolve universe ID - games.roblox_game_id is actually the universe ID in our schema
    const resolvedUniverseId = 
      (selectedGame as Record<string, unknown>).universe_id ||
      selectedGame.roblox_game_id ||
      (selectedGame as Record<string, unknown>).robloxGameId ||
      null;

    // Try to get Roblox stats from multiple sources:
    // 1. First try public Roblox API (most up-to-date)
    // 2. Fall back to games table (from previous sync)
    let robloxStats = {
      ccu: 0,
      visits: 0,
      favorites: 0,
      likes: 0,
      dislikes: 0,
    };
    let robloxStatsSource: "public_api" | "games_table" | "none" = "none";
    let robloxApiUrl: string | null = null;
    let robloxStatsDebug: Record<string, unknown> = {};

    if (resolvedUniverseId) {
      robloxApiUrl = `https://games.roblox.com/v1/games?universeIds=${resolvedUniverseId}`;
      const robloxVotesApiUrl = `https://games.roblox.com/v1/games/votes?universeIds=${resolvedUniverseId}`;
      
      let liveGame: Record<string, unknown> | null = null;
      let voteData: Record<string, unknown> | null = null;
      let voteApiStatus: string = "not_called";
      
      try {
        // Fetch from public Roblox API for game stats (CCU, visits, favorites)
        const robloxResponse = await fetch(robloxApiUrl, {
          headers: {
            "Accept": "application/json",
          },
          // Short timeout to not block the whole request
          signal: AbortSignal.timeout(5000),
        });

        if (robloxResponse.ok) {
          const robloxData = await robloxResponse.json();
          liveGame = robloxData?.data?.[0] ?? null;
        }
      } catch (apiError) {
        console.log("[performance-data] Roblox games API fetch failed, falling back to DB:", apiError);
      }

      // Fetch votes from separate Roblox votes endpoint
      try {
        const votesResponse = await fetch(robloxVotesApiUrl, {
          headers: {
            "Accept": "application/json",
          },
          signal: AbortSignal.timeout(5000),
        });

        if (votesResponse.ok) {
          const votesData = await votesResponse.json();
          voteData = votesData?.data?.[0] ?? null;
          voteApiStatus = voteData ? "ok" : "empty_response";
        } else {
          voteApiStatus = `http_${votesResponse.status}`;
          console.log("[performance-data] Roblox votes API returned status:", votesResponse.status);
        }
      } catch (voteApiError) {
        voteApiStatus = "fetch_error";
        console.log("[performance-data] Roblox votes API fetch failed:", voteApiError);
      }

      // DB row as fallback source (syncRow)
      const syncRow = {
        current_players: selectedGame.current_players,
        total_visits: selectedGame.total_visits,
        favorites: selectedGame.favorites,
        likes: selectedGame.likes,
        dislikes: selectedGame.dislikes,
        up_votes: (selectedGame as Record<string, unknown>).up_votes,
        upVotes: (selectedGame as Record<string, unknown>).upVotes,
        down_votes: (selectedGame as Record<string, unknown>).down_votes,
        downVotes: (selectedGame as Record<string, unknown>).downVotes,
        raw: (selectedGame as Record<string, unknown>).raw,
        raw_data: (selectedGame as Record<string, unknown>).raw_data,
      };

      // Safe mapping for likes - check vote API FIRST (dedicated endpoint), then liveGame, then DB
      const likes =
        voteData?.upVotes ??
        voteData?.up_votes ??
        liveGame?.upVotes ??
        liveGame?.likes ??
        (liveGame?.voteCounts as Record<string, unknown>)?.upVotes ??
        syncRow?.likes ??
        syncRow?.up_votes ??
        syncRow?.upVotes ??
        (syncRow?.raw as Record<string, unknown>)?.upVotes ??
        (syncRow?.raw_data as Record<string, unknown>)?.upVotes ??
        null;

      // Safe mapping for dislikes - check vote API FIRST (dedicated endpoint), then liveGame, then DB
      const dislikes =
        voteData?.downVotes ??
        voteData?.down_votes ??
        liveGame?.downVotes ??
        liveGame?.dislikes ??
        (liveGame?.voteCounts as Record<string, unknown>)?.downVotes ??
        syncRow?.dislikes ??
        syncRow?.down_votes ??
        syncRow?.downVotes ??
        (syncRow?.raw as Record<string, unknown>)?.downVotes ??
        (syncRow?.raw_data as Record<string, unknown>)?.downVotes ??
        null;

      if (liveGame) {
        robloxStats = {
          ccu: Number(liveGame.playing) || 0,
          visits: Number(liveGame.visits) || 0,
          favorites: Number(liveGame.favoritedCount) || 0,
          likes: Number(likes) || 0,
          dislikes: Number(dislikes) || 0,
        };
        robloxStatsSource = "public_api";
      } else {
        // Fall back to games table
        robloxStats = {
          ccu: Number(syncRow.current_players) || 0,
          visits: Number(syncRow.total_visits) || 0,
          favorites: Number(syncRow.favorites) || 0,
          likes: Number(likes) || 0,
          dislikes: Number(dislikes) || 0,
        };
        
        // Only mark as games_table if we have some data
        if (robloxStats.visits > 0 || robloxStats.favorites > 0 || robloxStats.likes > 0) {
          robloxStatsSource = "games_table";
        }
      }

      // Debug info for likes/dislikes mapping (enhanced with vote API debug)
      robloxStatsDebug = {
        source: robloxStatsSource,
        universeId: resolvedUniverseId,
        // Vote API debug
        voteApiUrl: robloxVotesApiUrl,
        voteApiStatus,
        voteApiRawFirstItem: voteData,
        // Game API debug
        liveGameKeys: liveGame ? Object.keys(liveGame) : [],
        syncRowKeys: Object.keys(syncRow).filter(k => syncRow[k as keyof typeof syncRow] !== undefined),
        rawVoteFields: {
          voteApiUpVotes: voteData?.upVotes,
          voteApiDownVotes: voteData?.downVotes,
          liveUpVotes: liveGame?.upVotes,
          liveDownVotes: liveGame?.downVotes,
          syncLikes: syncRow?.likes,
          syncDislikes: syncRow?.dislikes,
          syncUpVotes: syncRow?.upVotes ?? syncRow?.up_votes,
          syncDownVotes: syncRow?.downVotes ?? syncRow?.down_votes,
          rawUpVotes: (syncRow?.raw as Record<string, unknown>)?.upVotes ?? (syncRow?.raw_data as Record<string, unknown>)?.upVotes,
          rawDownVotes: (syncRow?.raw as Record<string, unknown>)?.downVotes ?? (syncRow?.raw_data as Record<string, unknown>)?.downVotes,
        },
        resolvedLikes: likes,
        resolvedDislikes: dislikes,
      };
    }

    const hasRobloxData = (
      robloxStats.visits > 0 || 
      robloxStats.favorites > 0 || 
      robloxStats.likes > 0 ||
      robloxStats.ccu > 0
    );

    // Parse range
    const url = new URL(request.url);
    const rangeParam = url.searchParams.get("range") || "24h";
    const normalizedRange = rangeParam.toLowerCase() as RangeKey;
    const rangeMs = RANGE_MS[normalizedRange] ?? RANGE_MS["24h"];

    const rangeEnd = new Date();
    const rangeStart = new Date(rangeEnd.getTime() - rangeMs);
    const rangeStartIso = rangeStart.toISOString();
    const rangeEndIso = rangeEnd.toISOString();

    const bucketConfig = BUCKET_CONFIG[normalizedRange] ?? BUCKET_CONFIG["24h"];

    // Fetch all events for this game in range
    // Use pagination to avoid Supabase 1000 row limit
    const allEvents: Array<{
      id: string;
      event_type: string;
      player_id: string | null;
      created_at: string;
      metadata: Record<string, unknown> | null;
    }> = [];

    let offset = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data: pageEvents, error: queryError } = await supabase
        .from("events")
        .select("id, event_type, player_id, created_at, metadata")
        .eq("game_id", selectedGame.id)
        .gte("created_at", rangeStartIso)
        .lte("created_at", rangeEndIso)
        .order("created_at", { ascending: true })
        .range(offset, offset + pageSize - 1);

      if (queryError) {
        console.error("[performance-data] Query error:", queryError);
        return NextResponse.json(
          { success: false, error: queryError.message },
          { status: 500, headers }
        );
      }

      if (pageEvents && pageEvents.length > 0) {
        allEvents.push(...pageEvents);
        offset += pageSize;
        hasMore = pageEvents.length === pageSize;
      } else {
        hasMore = false;
      }
    }

    // Count event types for debug
    const eventTypeCounts: Record<string, number> = {};
    for (const event of allEvents) {
      eventTypeCounts[event.event_type] = (eventTypeCounts[event.event_type] || 0) + 1;
    }

    // Calculate metrics

    // Tracked Actions: NOT IN [ccu_heartbeat, script_started]
    const trackedActionEvents = allEvents.filter(
      e => !EXCLUDED_EVENT_TYPES.includes(e.event_type)
    );
    const trackedActions = trackedActionEvents.length;

    // Total Sessions: player_join OR session_start
    const sessionEvents = allEvents.filter(
      e => SESSION_EVENT_TYPES.includes(e.event_type)
    );
    const totalSessions = sessionEvents.length;

    // Purchases: purchase_success, devproduct_purchase, gamepass_purchase
    const purchaseEvents = allEvents.filter(
      e => PURCHASE_EVENT_TYPES.includes(e.event_type)
    );
    const purchases = purchaseEvents.length;

    // Unique Players: distinct player_id where not null and not "server"
    const playerTrackingEvents = allEvents.filter(
      e => PLAYER_EVENT_TYPES.includes(e.event_type)
    );
    const validPlayerIds = new Set<string>();
    for (const e of playerTrackingEvents) {
      if (e.player_id && e.player_id !== "server") {
        validPlayerIds.add(e.player_id);
      }
    }
    const uniquePlayers = validPlayerIds.size;

    // New Players: players whose FIRST-EVER event for this game is within this range
    // IMPORTANT: We must query ALL TIME (no date filter) to find the true first event per player
    // Then compare that first_seen date against the selected range
    let newPlayers = 0;
    let totalPlayersEver = 0;
    const sampleFirstSeenRows: Array<{ player_id: string; first_seen: string }> = [];
    
    // Query first_seen per player across ALL TIME for this game using SQL aggregation
    // This avoids the Supabase 1000 row limit issue
    const { data: firstSeenRows, error: firstSeenError } = await supabase
      .rpc("get_player_first_seen", { p_game_id: selectedGame.id });
    
    // Fallback if RPC doesn't exist: use raw query with pagination
    if (firstSeenError || !firstSeenRows) {
      console.log("[performance-data] RPC get_player_first_seen not available, using fallback");
      
      // Fallback: fetch all events and compute first_seen in JS
      // Use pagination to get all events
      const allPlayerEvents: Array<{ player_id: string; created_at: string }> = [];
      let fpOffset = 0;
      const fpPageSize = 1000;
      let fpHasMore = true;
      
      while (fpHasMore) {
        const { data: fpPage } = await supabase
          .from("events")
          .select("player_id, created_at")
          .eq("game_id", selectedGame.id)
          .not("player_id", "is", null)
          .neq("player_id", "server")
          .order("created_at", { ascending: true })
          .range(fpOffset, fpOffset + fpPageSize - 1);
        
        if (fpPage && fpPage.length > 0) {
          allPlayerEvents.push(...fpPage);
          fpOffset += fpPageSize;
          fpHasMore = fpPage.length === fpPageSize;
        } else {
          fpHasMore = false;
        }
      }
      
      // Group by player_id and get first event
      const playerFirstEvent = new Map<string, string>();
      for (const e of allPlayerEvents) {
        if (e.player_id && !playerFirstEvent.has(e.player_id)) {
          playerFirstEvent.set(e.player_id, e.created_at);
        }
      }
      
      totalPlayersEver = playerFirstEvent.size;

      // Count players whose first event is within range
      for (const [playerId, firstEventAt] of playerFirstEvent) {
        const firstMs = new Date(firstEventAt).getTime();
        if (firstMs >= rangeStart.getTime() && firstMs <= rangeEnd.getTime()) {
          newPlayers++;
          // Collect sample for debug
          if (sampleFirstSeenRows.length < 10) {
            sampleFirstSeenRows.push({ player_id: playerId, first_seen: firstEventAt });
          }
        }
      }
    } else {
      // RPC returned results
      totalPlayersEver = firstSeenRows.length;
      
      for (const row of firstSeenRows) {
        const firstMs = new Date(row.first_seen).getTime();
        if (firstMs >= rangeStart.getTime() && firstMs <= rangeEnd.getTime()) {
          newPlayers++;
          if (sampleFirstSeenRows.length < 10) {
            sampleFirstSeenRows.push({ player_id: row.player_id, first_seen: row.first_seen });
          }
        }
      }
    }

    // Average session duration (if we have session_end events with duration)
    // Helper to find duration from metadata only (events table has no root duration columns)
    function findDurationSeconds(event: { metadata: Record<string, unknown> | null }): number | null {
      const metadata = (event?.metadata ?? {}) as Record<string, unknown>;
      const session = (metadata?.session ?? {}) as Record<string, unknown>;

      const candidates = [
        // Metadata fields (comprehensive list)
        metadata?.duration,
        metadata?.session_duration,
        metadata?.duration_seconds,
        metadata?.durationSeconds,
        metadata?.duration_ms,
        metadata?.durationMs,
        metadata?.sessionLength,
        metadata?.session_length,
        metadata?.sessionTime,
        metadata?.session_time,
        metadata?.playtime,
        metadata?.play_time,
        metadata?.time_played,
        metadata?.timePlayed,
        metadata?.elapsed,
        metadata?.elapsed_seconds,
        metadata?.elapsedSeconds,

        // Nested session object
        metadata?.session?.duration,
        (session as Record<string, unknown>)?.duration,
        (session as Record<string, unknown>)?.duration_seconds,
        (session as Record<string, unknown>)?.durationSeconds,
        (session as Record<string, unknown>)?.length,
        (session as Record<string, unknown>)?.time,
      ];

      for (const raw of candidates) {
        if (raw === null || raw === undefined) continue;

        let n = Number(raw);
        if (!Number.isFinite(n) || n <= 0) continue;

        // Convert milliseconds to seconds if needed
        if (n > 10000) n = n / 1000;

        return n;
      }

      return null;
    }

    let avgSessionSeconds: number | null = null;
    const sessionEndEvents = allEvents.filter(e => e.event_type === "session_end");
    const validDurations: number[] = [];
    const sampleSessionEndEvents: Array<Record<string, unknown>> = [];
    
    // Capture first 10 samples for debug
    for (let i = 0; i < Math.min(10, sessionEndEvents.length); i++) {
      const evt = sessionEndEvents[i];
      sampleSessionEndEvents.push({
        created_at: evt.created_at,
        player_id: evt.player_id,
        metadataKeys: Object.keys(evt.metadata ?? {}),
        metadata: evt.metadata,
      });
    }

    // Try to extract duration from session_end events metadata
    for (const e of sessionEndEvents) {
      const duration = findDurationSeconds(e);
      if (duration !== null) {
        validDurations.push(duration);
      }
    }
    
    // Fallback: if no valid durations from metadata, compute from player_join/session_end pairs
    let usedFallback = false;
    if (validDurations.length === 0 && sessionEndEvents.length > 0) {
      usedFallback = true;
      
      // Get all player_join events in range
      const playerJoinEvents = allEvents.filter(e => e.event_type === "player_join");
      
      // Build a map of player_id -> sorted join times
      const playerJoinTimes = new Map<string, Date[]>();
      for (const e of playerJoinEvents) {
        if (e.player_id && e.player_id !== "server") {
          const times = playerJoinTimes.get(e.player_id) || [];
          times.push(new Date(e.created_at));
          playerJoinTimes.set(e.player_id, times);
        }
      }
      // Sort each player's join times ascending
      for (const times of playerJoinTimes.values()) {
        times.sort((a, b) => a.getTime() - b.getTime());
      }
      
      // For each session_end, find the latest player_join before it
      for (const endEvent of sessionEndEvents) {
        if (!endEvent.player_id || endEvent.player_id === "server") continue;
        
        const joinTimes = playerJoinTimes.get(endEvent.player_id);
        if (!joinTimes || joinTimes.length === 0) continue;
        
        const endTime = new Date(endEvent.created_at);
        
        // Find latest join time before this end time
        let latestJoinBefore: Date | null = null;
        for (const joinTime of joinTimes) {
          if (joinTime.getTime() < endTime.getTime()) {
            latestJoinBefore = joinTime;
          } else {
            break;
          }
        }
        
        if (latestJoinBefore) {
          const durationSeconds = (endTime.getTime() - latestJoinBefore.getTime()) / 1000;
          // Only accept durations > 0 and < 12 hours
          if (durationSeconds > 0 && durationSeconds < 12 * 60 * 60) {
            validDurations.push(durationSeconds);
          }
        }
      }
    }

    if (validDurations.length > 0) {
      avgSessionSeconds = Math.round(validDurations.reduce((a, b) => a + b, 0) / validDurations.length);
    }

    // Generate charts

    // Activity chart: tracked actions bucketed
    const activityBuckets = new Map<string, number>();
    for (const e of trackedActionEvents) {
      const key = getBucketKey(e.created_at, bucketConfig.bucketType);
      activityBuckets.set(key, (activityBuckets.get(key) || 0) + 1);
    }
    const activityOverTime = Array.from(activityBuckets.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([time, value]) => ({ time, value }));

    // Sessions chart: session events bucketed
    const sessionBuckets = new Map<string, number>();
    for (const e of sessionEvents) {
      const key = getBucketKey(e.created_at, bucketConfig.bucketType);
      sessionBuckets.set(key, (sessionBuckets.get(key) || 0) + 1);
    }
    const sessionsOverTime = Array.from(sessionBuckets.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([time, value]) => ({ time, value }));

    // Purchases chart: purchase events bucketed
    const purchaseBuckets = new Map<string, number>();
    for (const e of purchaseEvents) {
      const key = getBucketKey(e.created_at, bucketConfig.bucketType);
      purchaseBuckets.set(key, (purchaseBuckets.get(key) || 0) + 1);
    }
    const purchasesOverTime = Array.from(purchaseBuckets.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([time, value]) => ({ time, value }));

    // Calculate chart totals (must match card values)
    const activityTotal = activityOverTime.reduce((sum, p) => sum + p.value, 0);
    const sessionsTotal = sessionsOverTime.reduce((sum, p) => sum + p.value, 0);
    const purchasesTotal = purchasesOverTime.reduce((sum, p) => sum + p.value, 0);

    // Debug info
    const firstEventAt = allEvents.length > 0 ? allEvents[0].created_at : null;
    const latestEventAt = allEvents.length > 0 ? allEvents[allEvents.length - 1].created_at : null;

    return NextResponse.json({
      success: true,
      selectedGameId: selectedGame.id,
      selectedGameName: selectedGame.name,
      range: normalizedRange,
      rangeStartIso,
      rangeEndIso,

      // Game object for the selected game card
      game: {
        id: selectedGame.id,
        name: selectedGame.name,
        roblox_game_id: selectedGame.roblox_game_id,
        roblox_universe_id: selectedGame.universe_id,
        root_place_id: (selectedGame as Record<string, unknown>).root_place_id ?? null,
        icon_url: selectedGame.thumbnail_url,
      },

      // Roblox API stats
      robloxStats,
      hasRobloxData,
      robloxStatsSource,
      robloxApiUrl,
      resolvedUniverseId,
      robloxStatsDebug,

      // Tracker metrics
      metrics: {
        trackedActions,
        uniquePlayers,
        totalSessions,
        avgSessionSeconds,
        newPlayers,
        purchases,
      },

      // Chart data
      charts: {
        activityOverTime,
        sessionsOverTime,
        purchasesOverTime,
      },

      // Totals for chart badges
      totals: {
        activityTotal,
        sessionsTotal,
        purchasesTotal,
      },

      // Events found count - used for hasTrackerData check
      eventsFound: allEvents.length,

      // Monetization locked status (false for now - can be enhanced with subscription check)
      monetizationLocked: false,

      // Debug info
      debug: {
        eventTypeCounts,
        rawEventCount: allEvents.length,
        firstEventAt,
        latestEventAt,
      },
      
      // Avg Session debug
      avgSessionDebug: {
        sessionEndCount: sessionEndEvents.length,
        validSessionDurationCount: validDurations.length,
        usedFallback,
        sampleSessionEnds: sampleSessionEndEvents,
        avgSessionSeconds,
      },
      
      // New Players debug
      newPlayersDebug: {
        totalPlayersEver,
        rangeStartIso,
        rangeEndIso,
        newPlayers,
        sampleFirstSeenRows,
      },
    }, { headers });

  } catch (error) {
    console.error("[performance-data] Error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500, headers }
    );
  }
}
