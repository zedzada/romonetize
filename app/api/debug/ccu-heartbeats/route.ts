import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

// GET /api/debug/ccu-heartbeats?gameId=...
// Returns debug info about CCU heartbeats and snapshots for a game
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  
  // Check auth
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const gameId = request.nextUrl.searchParams.get("gameId");
  if (!gameId) {
    return NextResponse.json(
      { success: false, error: "Missing gameId parameter" },
      { status: 400 }
    );
  }

  // Verify user owns this game
  const { data: game, error: gameError } = await supabase
    .from("games")
    .select("id, name, user_id")
    .eq("id", gameId)
    .eq("user_id", user.id)
    .single();

  if (gameError || !game) {
    return NextResponse.json(
      { success: false, error: "Game not found or not authorized" },
      { status: 404 }
    );
  }

  const now = Date.now();

  // Get latest 10 server heartbeats
  const { data: serverHeartbeats, error: heartbeatError } = await supabase
    .from("server_heartbeats")
    .select("server_id, ccu, last_seen_at, place_id, universe_id, created_at")
    .eq("game_id", gameId)
    .order("last_seen_at", { ascending: false })
    .limit(10);

  // Get latest 10 CCU snapshots
  const { data: ccuSnapshots, error: snapshotError } = await supabase
    .from("ccu_snapshots")
    .select("id, ccu, source, server_id, created_at")
    .eq("game_id", gameId)
    .order("created_at", { ascending: false })
    .limit(10);

  // Calculate timing info
  const latestHeartbeat = serverHeartbeats?.[0];
  const latestSnapshot = ccuSnapshots?.[0];

  const latestHeartbeatAt = latestHeartbeat?.last_seen_at 
    ? new Date(latestHeartbeat.last_seen_at).getTime() 
    : null;
  const latestSnapshotAt = latestSnapshot?.created_at 
    ? new Date(latestSnapshot.created_at).getTime() 
    : null;

  const minutesSinceLatestHeartbeat = latestHeartbeatAt 
    ? Math.round((now - latestHeartbeatAt) / 60000 * 10) / 10 
    : null;
  const minutesSinceLatestSnapshot = latestSnapshotAt 
    ? Math.round((now - latestSnapshotAt) / 60000 * 10) / 10 
    : null;

  return NextResponse.json({
    success: true,
    selectedGameId: gameId,
    gameName: game.name,
    
    // Heartbeat info
    latestServerHeartbeat: latestHeartbeat || null,
    minutesSinceLatestHeartbeat,
    latest10ServerHeartbeats: serverHeartbeats || [],
    heartbeatError: heartbeatError?.message || null,
    
    // Snapshot info
    latestCcuSnapshot: latestSnapshot || null,
    latestCcuSnapshotAt: latestSnapshot?.created_at || null,
    minutesSinceLatestSnapshot,
    latest10CcuSnapshots: ccuSnapshots || [],
    snapshotError: snapshotError?.message || null,
    
    // Status
    isReceivingHeartbeats: minutesSinceLatestHeartbeat !== null && minutesSinceLatestHeartbeat < 2,
    isInsertingSnapshots: minutesSinceLatestSnapshot !== null && minutesSinceLatestSnapshot < 2,
    
    checkedAt: new Date().toISOString(),
  });
}
