import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { getSelectedGameForUser } from "@/lib/server/selected-game";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Range definitions in milliseconds
const RANGE_MS: Record<string, number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "28d": 28 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
};

// Bucket size in milliseconds per range (for aggregation)
const BUCKET_MS: Record<string, number> = {
  "1h": 60 * 1000,           // 1 minute buckets
  "24h": 5 * 60 * 1000,      // 5 minute buckets
  "7d": 60 * 60 * 1000,      // 1 hour buckets
  "28d": 6 * 60 * 60 * 1000, // 6 hour buckets
  "90d": 24 * 60 * 60 * 1000, // 1 day buckets
};

/**
 * Format CCU chart axis label based on range
 * Uses explicit Europe/Paris timezone for consistent display
 */
function formatCcuAxisLabel(isoString: string, range: string): string {
  const date = new Date(isoString);
  
  if (range === "1h" || range === "24h") {
    // Show time only: HH:mm in Europe/Paris
    return new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }
  
  // 7d: show date + time (hour only)
  if (range === "7d") {
    return new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      hour12: false,
    }).format(date);
  }
  
  // 28d, 90d: show date only
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit",
    month: "short",
  }).format(date);
}

/**
 * Bucket raw data points into time intervals and return max CCU per bucket
 */
function bucketData(
  rows: Array<{ created_at: string; ccu: number; source: string }>,
  bucketMs: number,
  range: string
): Array<{ time: string; label: string; ccu: number; source: string }> {
  if (rows.length === 0) return [];
  
  // Group rows into buckets
  const buckets = new Map<number, { maxCcu: number; source: string; timestamp: string }>();
  
  for (const row of rows) {
    const ts = new Date(row.created_at).getTime();
    const bucketKey = Math.floor(ts / bucketMs) * bucketMs;
    
    const existing = buckets.get(bucketKey);
    if (!existing || row.ccu > existing.maxCcu) {
      buckets.set(bucketKey, {
        maxCcu: row.ccu,
        source: row.source,
        timestamp: new Date(bucketKey).toISOString(),
      });
    }
  }
  
  // Convert to sorted array
  const sortedBuckets = Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, bucket]) => ({
      time: bucket.timestamp,
      label: formatCcuAxisLabel(bucket.timestamp, range),
      ccu: bucket.maxCcu,
      source: bucket.source,
    }));
  
  return sortedBuckets;
}

export async function GET(request: Request) {
  const headers = {
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Pragma": "no-cache",
  };

  try {
    const supabase = await createClient();
    
    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401, headers }
      );
    }

    // Parse range from query
    const url = new URL(request.url);
    const range = url.searchParams.get("range") || "1h";
    const normalizedRange = range.toLowerCase();
    
    // Calculate time range
    const now = Date.now();
    const rangeMs = RANGE_MS[normalizedRange] ?? RANGE_MS["1h"];
    const rangeStartMs = now - rangeMs;
    const rangeEndMs = now;
    const rangeStartIso = new Date(rangeStartMs).toISOString();
    const rangeEndIso = new Date(rangeEndMs).toISOString();

    // Get selected game using shared utility
    const { game: selectedGame, error: gameError } = await getSelectedGameForUser(user.id, supabase);

    if (gameError) {
      return NextResponse.json(
        { 
          success: false, 
          error: gameError,
          chartData: [],
          usedSnapshots: 0,
          chartDataLength: 0,
        },
        { status: 200, headers }
      );
    }

    if (!selectedGame) {
      return NextResponse.json(
        { 
          success: false, 
          error: "No game found",
          chartData: [],
          usedSnapshots: 0,
          chartDataLength: 0,
        },
        { status: 200, headers }
      );
    }

    // Query Supabase directly - filter by game_id and range only (NO source filter)
    const { data: rows, error: queryError } = await supabase
      .from("ccu_snapshots")
      .select("id, game_id, ccu, source, created_at")
      .eq("game_id", selectedGame.id)
      .gte("created_at", rangeStartIso)
      .lte("created_at", rangeEndIso)
      .order("created_at", { ascending: true });

    if (queryError) {
      console.error("[ccu-history] Query error:", queryError);
      return NextResponse.json(
        { success: false, error: queryError.message },
        { status: 500, headers }
      );
    }

    const allRows = rows ?? [];
    const rowsFoundBeforeSourceFilter = allRows.length;

    // Source priority: romonetize_tracker > roblox_api > other
    const trackerRows = allRows.filter(r => r.source === "romonetize_tracker");
    const robloxRows = allRows.filter(r => r.source === "roblox_api");
    const otherRows = allRows.filter(r => r.source !== "romonetize_tracker" && r.source !== "roblox_api");
    
    const usedRows = trackerRows.length > 0 ? trackerRows : robloxRows.length > 0 ? robloxRows : otherRows;
    const usedSource = trackerRows.length > 0 
      ? "romonetize_tracker" 
      : robloxRows.length > 0 
        ? "roblox_api" 
        : otherRows.length > 0 
          ? otherRows[0].source 
          : "none";

    // Debug fallback: if no rows for this game, check if ANY snapshots exist in range
    let debugRecentSnapshotsAnyGame: Array<{ game_id: string; source: string; ccu: number; created_at: string }> | null = null;
    if (rowsFoundBeforeSourceFilter === 0) {
      const { data: recentAnyGameRows } = await supabase
        .from("ccu_snapshots")
        .select("game_id, source, ccu, created_at")
        .gte("created_at", rangeStartIso)
        .lte("created_at", rangeEndIso)
        .order("created_at", { ascending: false })
        .limit(20);
      
      debugRecentSnapshotsAnyGame = recentAnyGameRows ?? [];
    }

    // Build chart data with proper bucketing per range
    const bucketMs = BUCKET_MS[normalizedRange] ?? BUCKET_MS["1h"];
    const chartData = bucketData(
      usedRows.map(r => ({ created_at: r.created_at, ccu: Number(r.ccu) || 0, source: r.source })),
      bucketMs,
      normalizedRange
    );

    // Calculate stats
    const ccuValues = chartData.map(p => p.ccu);
    const currentCcu = chartData.length > 0 ? chartData[chartData.length - 1].ccu : null;
    const peakCcu = ccuValues.length > 0 ? Math.max(...ccuValues) : null;
    const avgCcu = ccuValues.length > 0 
      ? Math.round(ccuValues.reduce((sum, c) => sum + c, 0) / ccuValues.length)
      : null;

    return NextResponse.json({
      success: true,
      selectedGameId: selectedGame.id,
      selectedGameName: selectedGame.name,
      range: normalizedRange,
      rangeStartIso,
      rangeEndIso,
      
      // Key diagnostic fields
      rowsFoundBeforeSourceFilter,
      sourceCounts: {
        romonetize_tracker: trackerRows.length,
        roblox_api: robloxRows.length,
        other: otherRows.length,
      },
      
      usedSource,
      usedSnapshots: usedRows.length,
      chartDataLength: chartData.length,
      latestSnapshotAt: usedRows.length > 0 ? usedRows[usedRows.length - 1].created_at : null,
      currentCcu,
      peakCcu,
      avgCcu,
      chartData,
      
      // Debug fallback (only populated if rowsFoundBeforeSourceFilter === 0)
      debugRecentSnapshotsAnyGame,
    }, { headers });

  } catch (error) {
    console.error("[ccu-history] Unexpected error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
