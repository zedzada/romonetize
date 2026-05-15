import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/heartbeat/debug
 * Returns heartbeat debug information for the selected game
 * Used by ?debug=true on performance page
 */
export async function GET() {
  try {
    const supabase = await createClient();

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get selected game from user preferences or first game
    const { data: preferences } = await supabase
      .from("user_preferences")
      .select("selected_game_id")
      .eq("user_id", user.id)
      .single();

    let selectedGameId = preferences?.selected_game_id;

    // If no selected game, get first game
    if (!selectedGameId) {
      const { data: games } = await supabase
        .from("games")
        .select("id, name")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1);

      if (games && games.length > 0) {
        selectedGameId = games[0].id;
      }
    }

    if (!selectedGameId) {
      return NextResponse.json({
        selectedGameId: null,
        selectedGameName: null,
        activeServerHeartbeats: 0,
        latestHeartbeatAt: null,
        minutesSinceLatestHeartbeat: null,
        latest10Heartbeats: [],
        latest10CcuSnapshots: [],
      });
    }

    // Get game name
    const { data: game } = await supabase
      .from("games")
      .select("id, name")
      .eq("id", selectedGameId)
      .single();

    const now = new Date();
    const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000).toISOString();

    // Count active server heartbeats (last 2 minutes)
    const { count: activeCount } = await supabase
      .from("server_heartbeats")
      .select("*", { count: "exact", head: true })
      .eq("game_id", selectedGameId)
      .gte("last_seen_at", twoMinutesAgo);

    // Get latest 10 heartbeats
    const { data: latestHeartbeats } = await supabase
      .from("server_heartbeats")
      .select("server_id, ccu, last_seen_at")
      .eq("game_id", selectedGameId)
      .order("last_seen_at", { ascending: false })
      .limit(10);

    // Get latest 10 CCU snapshots
    const { data: latestSnapshots } = await supabase
      .from("ccu_snapshots")
      .select("ccu, created_at, source")
      .eq("game_id", selectedGameId)
      .order("created_at", { ascending: false })
      .limit(10);

    // Calculate minutes since latest heartbeat
    const latestHeartbeatAt = latestHeartbeats?.[0]?.last_seen_at || null;
    let minutesSinceLatestHeartbeat: number | null = null;
    if (latestHeartbeatAt) {
      const latestTime = new Date(latestHeartbeatAt).getTime();
      minutesSinceLatestHeartbeat = Math.round((now.getTime() - latestTime) / 60000);
    }

    return NextResponse.json({
      selectedGameId,
      selectedGameName: game?.name || null,
      activeServerHeartbeats: activeCount || 0,
      latestHeartbeatAt,
      minutesSinceLatestHeartbeat,
      latest10Heartbeats: (latestHeartbeats || []).map(h => ({
        server_id: h.server_id,
        ccu: h.ccu,
        last_seen_at: h.last_seen_at,
      })),
      latest10CcuSnapshots: (latestSnapshots || []).map(s => ({
        ccu: s.ccu,
        created_at: s.created_at,
        source: s.source,
      })),
    });
  } catch (error) {
    console.error("[api/heartbeat/debug] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
