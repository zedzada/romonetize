import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { getSelectedGameForUser } from "@/lib/server/selected-game";

export const dynamic = "force-dynamic";

/**
 * GET /api/dashboard/sessions-chart
 * 
 * Returns Total Sessions Over Time chart data.
 * Uses SQL aggregation to avoid Supabase 1000 row cap.
 * 
 * Query params:
 * - range: "24h" | "72h" | "7d" | "28d" | "90d" (default: "24h")
 * 
 * Sessions = event_type IN ("player_join", "session_start")
 * Uses created_at for filtering.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range") || "24h";
  
  const supabase = await createClient();
  
  // Get authenticated user
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  
  // Get selected game using shared utility
  const { game: selectedGame, error: gameError } = await getSelectedGameForUser(user.id, supabase);
  
  if (gameError) {
    return NextResponse.json({ 
      success: false, 
      error: gameError,
      chartData: [],
      totalSessions: 0,
    });
  }
  
  if (!selectedGame) {
    return NextResponse.json({ 
      success: false, 
      error: "No game found",
      chartData: [],
      totalSessions: 0,
    });
  }
  
  const gameId = selectedGame.id;
  
  // Calculate range
  const now = new Date();
  let rangeMs: number;
  let bucketType: "hour" | "day";
  
  switch (range) {
    case "72h":
      rangeMs = 72 * 60 * 60 * 1000;
      bucketType = "hour";
      break;
    case "7d":
      rangeMs = 7 * 24 * 60 * 60 * 1000;
      bucketType = "day";
      break;
    case "28d":
      rangeMs = 28 * 24 * 60 * 60 * 1000;
      bucketType = "day";
      break;
    case "90d":
      rangeMs = 90 * 24 * 60 * 60 * 1000;
      bucketType = "day";
      break;
    case "24h":
    default:
      rangeMs = 24 * 60 * 60 * 1000;
      bucketType = "hour";
      break;
  }
  
  const rangeStart = new Date(now.getTime() - rangeMs);
  const rangeStartIso = rangeStart.toISOString();
  const rangeEndIso = now.toISOString();
  
  // SQL aggregation query - group by hour or day
  // This avoids the 1000 row cap by aggregating on the server
  const truncFn = bucketType === "hour" ? "hour" : "day";
  
  const { data: buckets, error: bucketsError } = await supabase.rpc(
    "get_sessions_over_time",
    {
      p_game_id: gameId,
      p_range_start: rangeStartIso,
      p_range_end: rangeEndIso,
      p_bucket_type: truncFn,
    }
  );
  
  // If RPC doesn't exist, fall back to manual aggregation
  if (bucketsError) {
    // Fallback: fetch all session events and aggregate client-side
    // Use pagination to get all rows
    const allEvents: Array<{ created_at: string }> = [];
    let offset = 0;
    const pageSize = 1000;
    let hasMore = true;
    
    while (hasMore) {
      const { data: page, error: pageError } = await supabase
        .from("events")
        .select("created_at")
        .eq("game_id", gameId)
        .in("event_type", ["player_join", "session_start"])
        .gte("created_at", rangeStartIso)
        .lte("created_at", rangeEndIso)
        .order("created_at", { ascending: true })
        .range(offset, offset + pageSize - 1);
      
      if (pageError) {
        return NextResponse.json({ 
          success: false, 
          error: pageError.message,
          chartData: [],
          totalSessions: 0,
        });
      }
      
      if (page && page.length > 0) {
        allEvents.push(...page);
        offset += pageSize;
        hasMore = page.length === pageSize;
      } else {
        hasMore = false;
      }
    }
    
    // Aggregate into buckets
    const bucketMap = new Map<string, number>();
    
    allEvents.forEach(e => {
      const date = new Date(e.created_at);
      let bucketKey: string;
      
      if (bucketType === "hour") {
        // Truncate to hour
        bucketKey = new Date(
          date.getUTCFullYear(),
          date.getUTCMonth(),
          date.getUTCDate(),
          date.getUTCHours(),
          0, 0, 0
        ).toISOString();
      } else {
        // Truncate to day
        bucketKey = new Date(
          date.getUTCFullYear(),
          date.getUTCMonth(),
          date.getUTCDate(),
          0, 0, 0, 0
        ).toISOString();
      }
      
      bucketMap.set(bucketKey, (bucketMap.get(bucketKey) || 0) + 1);
    });
    
    // Convert to array and sort
    const chartData = Array.from(bucketMap.entries())
      .map(([time, value]) => ({ time, value: Number(value) || 0 }))
      .sort((a, b) => a.time.localeCompare(b.time));
    
    const totalSessions = chartData.reduce((sum, p) => sum + p.value, 0);
    
    return NextResponse.json({
      success: true,
      selectedGameId: gameId,
      range,
      rangeStartIso,
      rangeEndIso,
      bucketType,
      chartData,
      totalSessions,
      bucketCount: chartData.length,
      firstBucket: chartData[0] ?? null,
      lastBucket: chartData[chartData.length - 1] ?? null,
      eventTypesUsed: ["player_join", "session_start"],
      method: "pagination_fallback",
    }, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  }
  
  // RPC succeeded - format response
  const chartData = (buckets || []).map((b: { bucket_time: string; session_count: number }) => ({
    time: b.bucket_time,
    value: Number(b.session_count) || 0,
  })).sort((a: { time: string }, b: { time: string }) => a.time.localeCompare(b.time));
  
  const totalSessions = chartData.reduce((sum: number, p: { value: number }) => sum + p.value, 0);
  
  return NextResponse.json({
    success: true,
    selectedGameId: gameId,
    range,
    rangeStartIso,
    rangeEndIso,
    bucketType,
    chartData,
    totalSessions,
    bucketCount: chartData.length,
    firstBucket: chartData[0] ?? null,
    lastBucket: chartData[chartData.length - 1] ?? null,
    eventTypesUsed: ["player_join", "session_start"],
    method: "sql_rpc",
  }, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
