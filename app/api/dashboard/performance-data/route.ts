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

    // Roblox stats come directly from the games table (synced via Roblox API)
    const robloxStats = {
      ccu: selectedGame.current_players ?? 0,
      visits: selectedGame.total_visits ?? 0,
      favorites: selectedGame.favorites ?? 0,
      likes: selectedGame.likes ?? 0,
      dislikes: selectedGame.dislikes ?? 0,
    };

    const hasRobloxData = (
      robloxStats.visits > 0 || 
      robloxStats.favorites > 0 || 
      robloxStats.likes > 0
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

    // New Players: players whose FIRST event for this game is within this range
    // We need to check if player's first event ever is in this range
    // For efficiency, we'll query for first event per player
    let newPlayers = 0;
    if (validPlayerIds.size > 0) {
      const playerIdArray = Array.from(validPlayerIds);
      
      // For each unique player in range, check if their first event is in this range
      // This is expensive but accurate for new player definition
      const { data: firstEventsData } = await supabase
        .from("events")
        .select("player_id, created_at")
        .eq("game_id", selectedGame.id)
        .in("player_id", playerIdArray)
        .in("event_type", PLAYER_EVENT_TYPES)
        .order("created_at", { ascending: true });

      if (firstEventsData) {
        // Group by player_id and get first event
        const playerFirstEvent = new Map<string, string>();
        for (const e of firstEventsData) {
          if (e.player_id && !playerFirstEvent.has(e.player_id)) {
            playerFirstEvent.set(e.player_id, e.created_at);
          }
        }

        // Count players whose first event is within range
        for (const [, firstEventAt] of playerFirstEvent) {
          const firstMs = new Date(firstEventAt).getTime();
          if (firstMs >= rangeStart.getTime() && firstMs <= rangeEnd.getTime()) {
            newPlayers++;
          }
        }
      }
    }

    // Average session duration (if we have session_end events with duration)
    let avgSessionSeconds: number | null = null;
    const sessionEndEvents = allEvents.filter(e => e.event_type === "session_end");
    const validDurations: number[] = [];
    let sampleSessionEndMetadata: Record<string, unknown> | null = null;
    
    if (sessionEndEvents.length > 0) {
      // Capture first sample for debug
      if (sessionEndEvents[0]?.metadata) {
        sampleSessionEndMetadata = sessionEndEvents[0].metadata as Record<string, unknown>;
      }
      
      for (const e of sessionEndEvents) {
        // Support multiple duration field variants - check root columns and metadata
        const meta = e.metadata as Record<string, unknown> | null;
        const eventRecord = e as Record<string, unknown>;
        
        const duration = 
          // Root column variants
          eventRecord.duration ??
          eventRecord.session_duration ??
          eventRecord.duration_seconds ??
          // Metadata variants
          meta?.duration ??
          meta?.session_duration ??
          meta?.duration_seconds ??
          meta?.session_duration_seconds ??
          meta?.sessionLength ??
          meta?.session_length;
        
        const seconds = Number(duration);
        if (Number.isFinite(seconds) && seconds > 0) {
          validDurations.push(seconds);
        }
      }
      
      if (validDurations.length > 0) {
        avgSessionSeconds = Math.round(validDurations.reduce((a, b) => a + b, 0) / validDurations.length);
      }
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
        // Session debug
        sessionEndCount: sessionEndEvents.length,
        validSessionDurationCount: validDurations.length,
        sampleSessionEndMetadata,
        // New players debug
        firstSeenPlayersChecked: validPlayerIds.size,
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
