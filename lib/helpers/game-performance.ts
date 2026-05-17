import { createClient } from "@/lib/supabase/server";

// ============================================================
// SHARED GAME PERFORMANCE HELPER
// Single source of truth for Tracker Stats cards AND charts
// ============================================================

// Event type constants - must match everywhere
export const PURCHASE_EVENT_TYPES = [
  "purchase_success",
  "devproduct_purchase",
  "gamepass_purchase"
];

export const SESSION_START_EVENT_TYPES = [
  "player_join",
  "session_start"
];

export const ACTIVE_PLAYER_EVENT_TYPES = [
  "player_join",
  "session_start",
  "session_end",
  "purchase_success",
  "devproduct_purchase",
  "gamepass_purchase"
];

export const SERVER_ONLY_EVENT_TYPES = [
  "ccu_heartbeat",
  "script_started"
];

// Range configuration
export type PerformanceRange = "1h" | "1d" | "3d" | "7d" | "28d" | "90d";

export interface RangeWindow {
  rangeStartUtc: Date;
  rangeEndUtc: Date;
  bucketType: "5min" | "hourly" | "daily";
  bucketIntervalMs: number;
}

export function getRangeWindow(range: PerformanceRange, now: Date = new Date()): RangeWindow {
  const rangeEndUtc = now;
  let hoursBack: number;
  let bucketType: "5min" | "hourly" | "daily";
  
  switch (range) {
    case "1h":
      hoursBack = 1;
      bucketType = "5min";
      break;
    case "1d":
      hoursBack = 24;
      bucketType = "hourly";
      break;
    case "3d":
      hoursBack = 72;
      bucketType = "hourly";
      break;
    case "7d":
      hoursBack = 168;
      bucketType = "daily";
      break;
    case "28d":
      hoursBack = 672;
      bucketType = "daily";
      break;
    case "90d":
      hoursBack = 2160;
      bucketType = "daily";
      break;
    default:
      hoursBack = 168;
      bucketType = "daily";
  }
  
  const rangeStartUtc = new Date(rangeEndUtc.getTime() - hoursBack * 60 * 60 * 1000);
  
  // Calculate bucket interval in milliseconds
  let bucketIntervalMs: number;
  if (bucketType === "5min") {
    bucketIntervalMs = 5 * 60 * 1000;
  } else if (bucketType === "hourly") {
    bucketIntervalMs = 60 * 60 * 1000;
  } else {
    bucketIntervalMs = 24 * 60 * 60 * 1000;
  }
  
  return { rangeStartUtc, rangeEndUtc, bucketType, bucketIntervalMs };
}

// Generate all bucket keys for a range (empty buckets = 0)
export function generateBucketKeys(rangeWindow: RangeWindow): string[] {
  const { rangeStartUtc, rangeEndUtc, bucketType, bucketIntervalMs } = rangeWindow;
  const keys: string[] = [];
  
  let current = new Date(rangeStartUtc);
  
  if (bucketType === "5min") {
    current.setMinutes(Math.floor(current.getMinutes() / 5) * 5, 0, 0);
    while (current <= rangeEndUtc) {
      const minutes = current.getMinutes();
      keys.push(`${current.toISOString().slice(0, 13)}:${minutes.toString().padStart(2, "0")}`);
      current = new Date(current.getTime() + bucketIntervalMs);
    }
  } else if (bucketType === "hourly") {
    current.setMinutes(0, 0, 0);
    while (current <= rangeEndUtc) {
      keys.push(current.toISOString().slice(0, 13) + ":00");
      current = new Date(current.getTime() + bucketIntervalMs);
    }
  } else {
    current.setUTCHours(0, 0, 0, 0);
    while (current <= rangeEndUtc) {
      keys.push(current.toISOString().slice(0, 10));
      current = new Date(current.getTime() + bucketIntervalMs);
    }
  }
  
  return keys;
}

// Get bucket key for an event timestamp
export function getBucketKeyForEvent(eventDate: Date, bucketType: "5min" | "hourly" | "daily"): string {
  if (bucketType === "5min") {
    const minutes = Math.floor(eventDate.getMinutes() / 5) * 5;
    return `${eventDate.toISOString().slice(0, 13)}:${minutes.toString().padStart(2, "0")}`;
  } else if (bucketType === "hourly") {
    return eventDate.toISOString().slice(0, 13) + ":00";
  } else {
    return eventDate.toISOString().slice(0, 10);
  }
}

// Card metrics interface
export interface TrackerStatsCards {
  trackedActions: number;
  uniquePlayers: number;
  totalSessions: number;
  avgSessionSeconds: number | null;
  newPlayers: number;
  purchases: number;
}

// Chart bucket interface
export interface ChartBucket {
  date: string;
  value: number;
}

// Full performance metrics result
export interface GamePerformanceMetrics {
  cards: TrackerStatsCards;
  charts: {
    activityOverTime: ChartBucket[];
    playerJoinsOverTime: ChartBucket[];
    purchasesOverTime: ChartBucket[];
  };
  debug: {
    selectedGameId: string;
    selectedGameName: string | null;
    selectedRange: string;
    rangeStartUtc: string;
    rangeEndUtc: string;
    bucketType: string;
    bucketCount: number;
    eventTypeCounts: Record<string, number>;
    trackedActionsCard: number;
    activityChartTotal: number;
    totalSessionsCard: number;
    playerJoinsChartTotal: number;
    purchasesCard: number;
    purchasesChartTotal: number;
    uniquePlayers: number;
    newPlayers: number;
    avgSessionSeconds: number | null;
    rowsFetched: number;
    exactEventCount: number;
    hitSupabaseLimit: boolean;
    mismatches: string[];
  };
}

const PAGE_SIZE = 1000;

/**
 * Shared Game Performance backend helper
 * Returns BOTH card metrics AND chart buckets from the SAME data source
 * This ensures cards and charts always match
 */
export async function getGamePerformanceMetrics(params: {
  userId: string;
  selectedGameId: string;
  selectedGameName?: string | null;
  range: PerformanceRange;
}): Promise<GamePerformanceMetrics> {
  const { userId, selectedGameId, selectedGameName, range } = params;
  const supabase = await createClient();
  const now = new Date();
  const rangeWindow = getRangeWindow(range, now);
  const { rangeStartUtc, rangeEndUtc, bucketType } = rangeWindow;
  
  // Generate all bucket keys upfront (empty = 0)
  const allBucketKeys = generateBucketKeys(rangeWindow);
  
  // ============================================================
  // STEP 1: GET EXACT COUNTS (for card values)
  // Use SQL count with exact: true to avoid 1000 row limit
  // ============================================================
  
  // Count tracked actions (all events except SERVER_ONLY)
  const { count: trackedActionsCount } = await supabase
    .from("events")
    .select("*", { count: "exact", head: true })
    .eq("game_id", selectedGameId)
    .not("event_type", "in", `(${SERVER_ONLY_EVENT_TYPES.join(",")})`)
    .gte("created_at", rangeStartUtc.toISOString())
    .lte("created_at", rangeEndUtc.toISOString());
  
  // Count session starts (player_join + session_start)
  const { count: sessionStartsCount } = await supabase
    .from("events")
    .select("*", { count: "exact", head: true })
    .eq("game_id", selectedGameId)
    .in("event_type", SESSION_START_EVENT_TYPES)
    .gte("created_at", rangeStartUtc.toISOString())
    .lte("created_at", rangeEndUtc.toISOString());
  
  // Count purchases
  const { count: purchasesCount } = await supabase
    .from("events")
    .select("*", { count: "exact", head: true })
    .eq("game_id", selectedGameId)
    .in("event_type", PURCHASE_EVENT_TYPES)
    .gte("created_at", rangeStartUtc.toISOString())
    .lte("created_at", rangeEndUtc.toISOString());
  
  // ============================================================
  // STEP 2: FETCH ALL EVENTS WITH PAGINATION
  // This is the SINGLE source of truth for BOTH cards and charts
  // ============================================================
  
  // Fetch ALL non-server events (for activity chart + unique players)
  const allTrackedEvents: Array<{
    event_type: string;
    player_id: string | null;
    created_at: string;
    duration_seconds: number | null;
    metadata: Record<string, unknown> | null;
  }> = [];
  
  let from = 0;
  let hasMore = true;
  let hitSupabaseLimit = false;
  
  while (hasMore) {
    const { data: pageData, error: pageError } = await supabase
      .from("events")
      .select("event_type, player_id, created_at, duration_seconds, metadata")
      .eq("game_id", selectedGameId)
      .not("event_type", "in", `(${SERVER_ONLY_EVENT_TYPES.join(",")})`)
      .gte("created_at", rangeStartUtc.toISOString())
      .lte("created_at", rangeEndUtc.toISOString())
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    
    if (pageError) {
      console.error("[v0] getGamePerformanceMetrics pagination error:", pageError);
      hasMore = false;
    } else if (pageData && pageData.length > 0) {
      allTrackedEvents.push(...pageData);
      from += PAGE_SIZE;
      hasMore = pageData.length === PAGE_SIZE;
    } else {
      hasMore = false;
    }
  }
  
  // Check if we hit limit
  if (trackedActionsCount && allTrackedEvents.length < trackedActionsCount) {
    hitSupabaseLimit = true;
  }
  
  // ============================================================
  // STEP 3: COMPUTE CARD METRICS FROM FETCHED EVENTS
  // ============================================================
  
  // Helper: Extract player_id from event (check root AND metadata)
  function extractPlayerId(event: { player_id: string | null; metadata: Record<string, unknown> | null }): string | null {
    const rawPlayerId = 
      event.player_id ??
      (event.metadata?.player_id as string | null | undefined) ??
      (event.metadata?.playerId as string | null | undefined) ??
      null;
    
    // Normalize to string or null
    if (rawPlayerId === null || rawPlayerId === undefined) return null;
    const normalized = String(rawPlayerId);
    
    // Validate: reject invalid player IDs
    if (
      normalized === "" ||
      normalized === "server" ||
      normalized === "null" ||
      normalized === "undefined"
    ) {
      return null;
    }
    
    return normalized;
  }
  
  // Count event types for debug
  const eventTypeCounts: Record<string, number> = {};
  allTrackedEvents.forEach(e => {
    eventTypeCounts[e.event_type] = (eventTypeCounts[e.event_type] || 0) + 1;
  });
  
  // Sample player events for debug (shows where player_id comes from)
  const samplePlayerEvents: Array<{
    event_type: string;
    root_player_id: string | null;
    metadata_player_id: unknown;
    metadata_playerId: unknown;
    resolvedPlayerId: string | null;
  }> = [];
  
  // Unique players from ACTIVE_PLAYER_EVENT_TYPES only
  const uniquePlayerIds = new Set<string>();
  const firstSeenMap = new Map<string, Date>(); // player_id -> first event time in range
  
  allTrackedEvents
    .filter(e => ACTIVE_PLAYER_EVENT_TYPES.includes(e.event_type))
    .forEach(e => {
      const resolvedPlayerId = extractPlayerId(e);
      
      // Collect sample events for debug (first 10)
      if (samplePlayerEvents.length < 10) {
        samplePlayerEvents.push({
          event_type: e.event_type,
          root_player_id: e.player_id,
          metadata_player_id: e.metadata?.player_id,
          metadata_playerId: e.metadata?.playerId,
          resolvedPlayerId,
        });
      }
      
      if (resolvedPlayerId) {
        uniquePlayerIds.add(resolvedPlayerId);
        const eventTime = new Date(e.created_at);
        if (!firstSeenMap.has(resolvedPlayerId) || eventTime < firstSeenMap.get(resolvedPlayerId)!) {
          firstSeenMap.set(resolvedPlayerId, eventTime);
        }
      }
    });
  
  // New players: check if their first-ever event is within range
  // Need to query DB for first event time for each player
  let newPlayersCount = 0;
  
  if (uniquePlayerIds.size > 0) {
    // For each unique player, check if their first event for this game is within range
    // Check both root player_id AND metadata player_id/playerId
    const playerIds = Array.from(uniquePlayerIds);
    const batchSize = 50; // Smaller batch since we do 2 queries per player
    
    for (let i = 0; i < playerIds.length; i += batchSize) {
      const batch = playerIds.slice(i, i + batchSize);
      
      for (const playerId of batch) {
        // Query 1: Check root player_id
        const { data: rootFirstEvent } = await supabase
          .from("events")
          .select("created_at")
          .eq("game_id", selectedGameId)
          .eq("player_id", playerId)
          .in("event_type", ACTIVE_PLAYER_EVENT_TYPES)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        
        // Query 2: Check metadata->player_id (JSONB contains)
        const { data: metaFirstEvent } = await supabase
          .from("events")
          .select("created_at")
          .eq("game_id", selectedGameId)
          .or(`metadata->player_id.eq.${playerId},metadata->player_id.eq."${playerId}",metadata->playerId.eq.${playerId},metadata->playerId.eq."${playerId}"`)
          .in("event_type", ACTIVE_PLAYER_EVENT_TYPES)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        
        // Find the earliest event between root and metadata
        let firstEventTime: Date | null = null;
        
        if (rootFirstEvent) {
          firstEventTime = new Date(rootFirstEvent.created_at);
        }
        if (metaFirstEvent) {
          const metaTime = new Date(metaFirstEvent.created_at);
          if (!firstEventTime || metaTime < firstEventTime) {
            firstEventTime = metaTime;
          }
        }
        
        if (firstEventTime && firstEventTime >= rangeStartUtc && firstEventTime <= rangeEndUtc) {
          newPlayersCount++;
        }
      }
    }
  }
  
  // Ensure newPlayers never exceeds uniquePlayers
  if (newPlayersCount > uniquePlayerIds.size) {
    newPlayersCount = uniquePlayerIds.size;
  }
  
  // Average session duration from session_end events
  const sessionEndEvents = allTrackedEvents.filter(e => e.event_type === "session_end");
  let avgSessionSeconds: number | null = null;
  
  if (sessionEndEvents.length > 0) {
    const validDurations: number[] = [];
    
    sessionEndEvents.forEach(e => {
      const duration = 
        e.duration_seconds ??
        (e.metadata as Record<string, unknown>)?.duration_seconds ??
        (e.metadata as Record<string, unknown>)?.session_duration ??
        (e.metadata as Record<string, unknown>)?.duration;
      
      if (typeof duration === "number" && duration > 0) {
        validDurations.push(duration);
      }
    });
    
    if (validDurations.length > 0) {
      avgSessionSeconds = Math.round(validDurations.reduce((a, b) => a + b, 0) / validDurations.length);
    }
  }
  
  // ============================================================
  // STEP 4: COMPUTE CHART BUCKETS FROM SAME EVENTS
  // ============================================================
  
  // Activity Over Time (all tracked events)
  const activityBuckets = new Map<string, number>();
  allBucketKeys.forEach(key => activityBuckets.set(key, 0));
  allTrackedEvents.forEach(e => {
    const key = getBucketKeyForEvent(new Date(e.created_at), bucketType);
    if (activityBuckets.has(key)) {
      activityBuckets.set(key, activityBuckets.get(key)! + 1);
    }
  });
  
  // Player Joins Over Time (session starts only)
  const sessionBuckets = new Map<string, number>();
  allBucketKeys.forEach(key => sessionBuckets.set(key, 0));
  allTrackedEvents
    .filter(e => SESSION_START_EVENT_TYPES.includes(e.event_type))
    .forEach(e => {
      const key = getBucketKeyForEvent(new Date(e.created_at), bucketType);
      if (sessionBuckets.has(key)) {
        sessionBuckets.set(key, sessionBuckets.get(key)! + 1);
      }
    });
  
  // Purchases Over Time
  const purchaseBuckets = new Map<string, number>();
  allBucketKeys.forEach(key => purchaseBuckets.set(key, 0));
  allTrackedEvents
    .filter(e => PURCHASE_EVENT_TYPES.includes(e.event_type))
    .forEach(e => {
      const key = getBucketKeyForEvent(new Date(e.created_at), bucketType);
      if (purchaseBuckets.has(key)) {
        purchaseBuckets.set(key, purchaseBuckets.get(key)! + 1);
      }
    });
  
  // Convert to arrays
  const activityOverTime = Array.from(activityBuckets.entries())
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));
  
  const playerJoinsOverTime = Array.from(sessionBuckets.entries())
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));
  
  const purchasesOverTime = Array.from(purchaseBuckets.entries())
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));
  
  // ============================================================
  // STEP 5: COMPUTE TOTALS AND VERIFY ALIGNMENT
  // ============================================================
  
  const activityChartTotal = activityOverTime.reduce((sum, d) => sum + d.value, 0);
  const playerJoinsChartTotal = playerJoinsOverTime.reduce((sum, d) => sum + d.value, 0);
  const purchasesChartTotal = purchasesOverTime.reduce((sum, d) => sum + d.value, 0);
  
  // Card values - prefer exact counts from SQL, fallback to fetched
  const trackedActionsCard = trackedActionsCount ?? allTrackedEvents.length;
  const totalSessionsCard = sessionStartsCount ?? allTrackedEvents.filter(e => SESSION_START_EVENT_TYPES.includes(e.event_type)).length;
  const purchasesCard = purchasesCount ?? allTrackedEvents.filter(e => PURCHASE_EVENT_TYPES.includes(e.event_type)).length;
  
  // Check for mismatches
  const mismatches: string[] = [];
  
  if (trackedActionsCard !== activityChartTotal) {
    mismatches.push(`trackedActions: card=${trackedActionsCard} chart=${activityChartTotal}`);
  }
  if (totalSessionsCard !== playerJoinsChartTotal) {
    mismatches.push(`sessions: card=${totalSessionsCard} chart=${playerJoinsChartTotal}`);
  }
  if (purchasesCard !== purchasesChartTotal) {
    mismatches.push(`purchases: card=${purchasesCard} chart=${purchasesChartTotal}`);
  }
  if (newPlayersCount > uniquePlayerIds.size) {
    mismatches.push(`newPlayers(${newPlayersCount}) > uniquePlayers(${uniquePlayerIds.size})`);
  }
  if (hitSupabaseLimit) {
    mismatches.push(`hitSupabaseLimit: fetched=${allTrackedEvents.length} expected=${trackedActionsCount}`);
  }
  
  return {
    cards: {
      trackedActions: trackedActionsCard,
      uniquePlayers: uniquePlayerIds.size,
      totalSessions: totalSessionsCard,
      avgSessionSeconds,
      newPlayers: newPlayersCount,
      purchases: purchasesCard,
    },
    charts: {
      activityOverTime,
      playerJoinsOverTime,
      purchasesOverTime,
    },
    debug: {
      selectedGameId,
      selectedGameName: selectedGameName ?? null,
      selectedRange: range,
      rangeStartUtc: rangeStartUtc.toISOString(),
      rangeEndUtc: rangeEndUtc.toISOString(),
      bucketType,
      bucketCount: allBucketKeys.length,
      eventTypeCounts,
      // Player ID debug info (per spec)
      samplePlayerEvents,
      validPlayerIdsFound: uniquePlayerIds.size,
      trackedActionsCard,
      activityChartTotal,
      totalSessionsCard,
      playerJoinsChartTotal,
      purchasesCard,
      purchasesChartTotal,
      uniquePlayers: uniquePlayerIds.size,
      newPlayers: newPlayersCount,
      avgSessionSeconds,
      rowsFetched: allTrackedEvents.length,
      exactEventCount: trackedActionsCount ?? 0,
      hitSupabaseLimit,
      mismatches,
    },
  };
}
