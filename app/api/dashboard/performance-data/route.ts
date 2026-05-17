import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

    // Get user profile with selected game
    const { data: profile } = await supabase
      .from("profiles")
      .select("selected_game_id")
      .eq("id", user.id)
      .single();

    if (!profile?.selected_game_id) {
      return NextResponse.json(
        { success: false, error: "No game selected" },
        { status: 400, headers }
      );
    }

    // Get selected game
    const { data: selectedGame } = await supabase
      .from("games")
      .select("id, name, roblox_game_id")
      .eq("id", profile.selected_game_id)
      .single();

    if (!selectedGame) {
      return NextResponse.json(
        { success: false, error: "Selected game not found" },
        { status: 404, headers }
      );
    }

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
        .from("game_events")
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
        .from("game_events")
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
    let avgSessionSeconds = 0;
    const sessionEndEvents = allEvents.filter(e => e.event_type === "session_end");
    if (sessionEndEvents.length > 0) {
      let totalDuration = 0;
      let durationCount = 0;
      for (const e of sessionEndEvents) {
        const duration = (e.metadata as { session_duration_seconds?: number })?.session_duration_seconds;
        if (typeof duration === "number" && duration > 0) {
          totalDuration += duration;
          durationCount++;
        }
      }
      if (durationCount > 0) {
        avgSessionSeconds = Math.round(totalDuration / durationCount);
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

      metrics: {
        trackedActions,
        uniquePlayers,
        totalSessions,
        avgSessionSeconds,
        newPlayers,
        purchases,
      },

      charts: {
        activityOverTime,
        sessionsOverTime,
        purchasesOverTime,
      },

      totals: {
        activityTotal,
        sessionsTotal,
        purchasesTotal,
      },

      debug: {
        eventTypeCounts,
        rawEventCount: allEvents.length,
        firstEventAt,
        latestEventAt,
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
