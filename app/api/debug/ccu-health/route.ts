import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSelectedGameForUser } from "@/lib/server/selected-game";

/**
 * CCU Health Debug Endpoint
 * 
 * GET /api/debug/ccu-health
 * 
 * Returns diagnostic information about CCU snapshot collection:
 * - Total snapshots for selected game
 * - Snapshots in last 1h and 24h
 * - Latest snapshot timestamp and age
 * - CCU heartbeat events (from tracker)
 * - Source breakdown (tracker vs roblox_api)
 * - Any insert errors
 */
export async function GET(request: NextRequest) {
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
      });
    }

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Get total snapshots count
    const { count: totalSnapshots } = await supabase
      .from("ccu_snapshots")
      .select("id", { count: "exact", head: true })
      .eq("game_id", selectedGame.id);

    // Get snapshots in last 1h
    const { count: snapshotsLast1h, data: recentSnapshots } = await supabase
      .from("ccu_snapshots")
      .select("id, ccu, source, created_at", { count: "exact" })
      .eq("game_id", selectedGame.id)
      .gte("created_at", oneHourAgo.toISOString())
      .order("created_at", { ascending: false })
      .limit(10);

    // Get snapshots in last 24h
    const { count: snapshotsLast24h } = await supabase
      .from("ccu_snapshots")
      .select("id", { count: "exact", head: true })
      .eq("game_id", selectedGame.id)
      .gte("created_at", twentyFourHoursAgo.toISOString());

    // Get latest snapshot
    const { data: latestSnapshotData } = await supabase
      .from("ccu_snapshots")
      .select("ccu, source, created_at")
      .eq("game_id", selectedGame.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    const latestSnapshotAt = latestSnapshotData?.created_at || null;
    const latestSnapshotAgeMinutes = latestSnapshotAt
      ? Math.round((now.getTime() - new Date(latestSnapshotAt).getTime()) / 60000)
      : null;

    // Get CCU heartbeat events in last 1h (from events table)
    const { count: ccuHeartbeatEventsLast1h } = await supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("game_id", selectedGame.id)
      .eq("event_type", "ccu_heartbeat")
      .gte("created_at", oneHourAgo.toISOString());

    // Get latest CCU heartbeat event
    const { data: latestCcuHeartbeatData } = await supabase
      .from("events")
      .select("created_at, metadata, player_id")
      .eq("game_id", selectedGame.id)
      .eq("event_type", "ccu_heartbeat")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // Get source breakdown for last 24h
    const { data: sourceData } = await supabase
      .from("ccu_snapshots")
      .select("source")
      .eq("game_id", selectedGame.id)
      .gte("created_at", twentyFourHoursAgo.toISOString());

    const sourceCounts: Record<string, number> = {};
    sourceData?.forEach((s: { source: string | null }) => {
      const src = s.source || "unknown";
      sourceCounts[src] = (sourceCounts[src] || 0) + 1;
    });

    // Check server_heartbeats for active servers
    const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);
    const { data: activeServers, count: activeServersCount } = await supabase
      .from("server_heartbeats")
      .select("server_id, ccu, last_seen_at", { count: "exact" })
      .eq("game_id", selectedGame.id)
      .gte("last_seen_at", twoMinutesAgo.toISOString());

    return NextResponse.json({
      selectedGameId: selectedGame.id,
      selectedGameName: selectedGame.name,
      robloxGameId: selectedGame.roblox_game_id,
      
      // Snapshot stats
      totalSnapshots: totalSnapshots ?? 0,
      snapshotsLast1h: snapshotsLast1h ?? 0,
      snapshotsLast24h: snapshotsLast24h ?? 0,
      
      // Latest snapshot
      latestSnapshotAt,
      latestSnapshotAgeMinutes,
      latestSnapshotCcu: latestSnapshotData?.ccu ?? null,
      latestSnapshotSource: latestSnapshotData?.source ?? null,
      
      // Recent snapshots sample
      recentSnapshots: recentSnapshots?.map(s => ({
        ccu: s.ccu,
        source: s.source,
        created_at: s.created_at,
      })) ?? [],
      
      // CCU heartbeat events (from tracker)
      ccuHeartbeatEventsLast1h: ccuHeartbeatEventsLast1h ?? 0,
      latestCcuHeartbeatEventAt: latestCcuHeartbeatData?.created_at ?? null,
      latestCcuHeartbeatPayload: latestCcuHeartbeatData ? {
        metadata: latestCcuHeartbeatData.metadata,
        player_id: latestCcuHeartbeatData.player_id,
      } : null,
      
      // Source breakdown
      sourceCounts,
      
      // Active servers (from server_heartbeats)
      activeServersCount: activeServersCount ?? 0,
      activeServers: activeServers?.map(s => ({
        server_id: s.server_id,
        ccu: s.ccu,
        last_seen_at: s.last_seen_at,
      })) ?? [],
      
      // Diagnosis
      diagnosis: getDiagnosis({
        snapshotsLast1h: snapshotsLast1h ?? 0,
        ccuHeartbeatEventsLast1h: ccuHeartbeatEventsLast1h ?? 0,
        latestSnapshotAgeMinutes,
        activeServersCount: activeServersCount ?? 0,
      }),
      
      // Timestamps
      now: now.toISOString(),
      oneHourAgo: oneHourAgo.toISOString(),
    });
  } catch (error) {
    console.error("[CCU Health] Error:", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}

function getDiagnosis(data: {
  snapshotsLast1h: number;
  ccuHeartbeatEventsLast1h: number;
  latestSnapshotAgeMinutes: number | null;
  activeServersCount: number;
}): string[] {
  const issues: string[] = [];
  
  if (data.snapshotsLast1h === 0) {
    issues.push("NO_SNAPSHOTS_LAST_1H: No CCU snapshots in the last hour");
    
    if (data.ccuHeartbeatEventsLast1h === 0) {
      issues.push("NO_HEARTBEAT_EVENTS: Tracker is not sending ccu_heartbeat events - check if game server is running");
    } else {
      issues.push("HEARTBEATS_NOT_INSERTED: Tracker is sending ccu_heartbeat events but snapshots are not being inserted - check /api/events handler");
    }
  }
  
  if (data.activeServersCount === 0 && data.ccuHeartbeatEventsLast1h > 0) {
    issues.push("NO_ACTIVE_SERVERS: Heartbeats received but no active servers in server_heartbeats - possible upsert issue");
  }
  
  if (data.latestSnapshotAgeMinutes !== null && data.latestSnapshotAgeMinutes > 60) {
    issues.push(`STALE_SNAPSHOTS: Latest snapshot is ${data.latestSnapshotAgeMinutes} minutes old`);
  }
  
  if (issues.length === 0) {
    issues.push("OK: CCU collection appears healthy");
  }
  
  return issues;
}
