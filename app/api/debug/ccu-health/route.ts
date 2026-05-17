import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSelectedGameForUser } from "@/lib/server/selected-game";

/**
 * CCU Health Debug Endpoint
 * 
 * GET /api/debug/ccu-health
 * 
 * Returns diagnostic information to identify CCU snapshot ingestion issues:
 * - Compares heartbeat events received vs snapshots inserted
 * - Identifies the exact issue: no_recent_heartbeats, heartbeats_exist_but_snapshots_not_inserted, or snapshots_recent_ok
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Get selected game
    const { game: selectedGame, error: gameError } = await getSelectedGameForUser(user.id, supabase);
    
    if (gameError || !selectedGame) {
      return NextResponse.json({
        error: "No selected game",
        selectedGameId: null,
        selectedGameName: null,
        issue: "no_game_selected",
      });
    }

    const now = new Date();
    const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // === EVENTS TABLE: CCU Heartbeat Events ===
    
    // Get latest event of any type
    const { data: latestEventData } = await supabase
      .from("events")
      .select("created_at")
      .eq("game_id", selectedGame.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    
    // Get latest CCU heartbeat event
    const { data: latestCcuHeartbeatData } = await supabase
      .from("events")
      .select("created_at, metadata")
      .eq("game_id", selectedGame.id)
      .eq("event_type", "ccu_heartbeat")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // Count CCU heartbeat events in last 15 min
    const { count: ccuHeartbeatEventsLast15Min } = await supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("game_id", selectedGame.id)
      .eq("event_type", "ccu_heartbeat")
      .gte("created_at", fifteenMinutesAgo.toISOString());

    // Count CCU heartbeat events in last 1h
    const { count: ccuHeartbeatEventsLast1h } = await supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("game_id", selectedGame.id)
      .eq("event_type", "ccu_heartbeat")
      .gte("created_at", oneHourAgo.toISOString());

    // === CCU_SNAPSHOTS TABLE ===
    
    // Get latest snapshot
    const { data: latestSnapshotData } = await supabase
      .from("ccu_snapshots")
      .select("id, ccu, source, server_id, created_at")
      .eq("game_id", selectedGame.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // Count snapshots in last 15 min
    const { count: snapshotsLast15Min } = await supabase
      .from("ccu_snapshots")
      .select("id", { count: "exact", head: true })
      .eq("game_id", selectedGame.id)
      .gte("created_at", fifteenMinutesAgo.toISOString());

    // Count snapshots in last 1h
    const { count: snapshotsLast1h } = await supabase
      .from("ccu_snapshots")
      .select("id", { count: "exact", head: true })
      .eq("game_id", selectedGame.id)
      .gte("created_at", oneHourAgo.toISOString());

    // Count snapshots in last 24h
    const { count: snapshotsLast24h } = await supabase
      .from("ccu_snapshots")
      .select("id", { count: "exact", head: true })
      .eq("game_id", selectedGame.id)
      .gte("created_at", twentyFourHoursAgo.toISOString());

    // === DETERMINE ISSUE ===
    
    let issue: "heartbeats_exist_but_snapshots_not_inserted" | "no_recent_heartbeats" | "snapshots_recent_ok";
    
    const hasRecentHeartbeats = (ccuHeartbeatEventsLast15Min ?? 0) > 0;
    const hasRecentSnapshots = (snapshotsLast15Min ?? 0) > 0;
    
    if (hasRecentSnapshots) {
      issue = "snapshots_recent_ok";
    } else if (hasRecentHeartbeats && !hasRecentSnapshots) {
      issue = "heartbeats_exist_but_snapshots_not_inserted";
    } else {
      issue = "no_recent_heartbeats";
    }

    return NextResponse.json({
      // Identity
      selectedGameId: selectedGame.id,
      selectedGameName: selectedGame.name,
      
      // Events table - any event
      latestEventAt: latestEventData?.created_at ?? null,
      
      // Events table - CCU heartbeat specific
      latestCcuHeartbeatEventAt: latestCcuHeartbeatData?.created_at ?? null,
      ccuHeartbeatEventsLast15Min: ccuHeartbeatEventsLast15Min ?? 0,
      ccuHeartbeatEventsLast1h: ccuHeartbeatEventsLast1h ?? 0,
      
      // CCU snapshots table
      latestCcuSnapshotAt: latestSnapshotData?.created_at ?? null,
      snapshotsLast15Min: snapshotsLast15Min ?? 0,
      snapshotsLast1h: snapshotsLast1h ?? 0,
      snapshotsLast24h: snapshotsLast24h ?? 0,
      
      // Payload samples for debugging
      latestHeartbeatPayload: latestCcuHeartbeatData?.metadata ?? null,
      latestSnapshotRow: latestSnapshotData ? {
        id: latestSnapshotData.id,
        ccu: latestSnapshotData.ccu,
        source: latestSnapshotData.source,
        server_id: latestSnapshotData.server_id,
        created_at: latestSnapshotData.created_at,
      } : null,
      
      // Diagnosis
      issue,
      
      // Timestamps for reference
      _debug: {
        now: now.toISOString(),
        fifteenMinutesAgo: fifteenMinutesAgo.toISOString(),
        oneHourAgo: oneHourAgo.toISOString(),
      },
    });
  } catch (error) {
    console.error("[CCU Health] Error:", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unknown error",
      issue: "error",
    }, { status: 500 });
  }
}
