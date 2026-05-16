import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSelectedGameForUser } from "@/lib/server/selected-game";

/**
 * GET /api/debug/data-health?gameId=<uuid>
 * 
 * Returns detailed data health diagnostics for a selected game.
 * If gameId is omitted, uses the user's currently selected game.
 * Requires authentication.
 * 
 * Returns per spec:
 * - selectedGameId, selectedGameName
 * - totalEvents, eventTypeCounts
 * - validPlayerEvents (excluding server-only)
 * - distinctPlayers (excluding "server" and null)
 * - playerJoinCount, sessionStartCount, sessionEndCount
 * - purchaseSuccessCount, ccuHeartbeatCount, scriptStartedCount
 * - avgSessionSourceCount
 * - ccuSnapshotsCount
 * - latestEventAt, latestPurchaseAt, latestCcuSnapshotAt
 * - inconsistencies array with detected issues
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    
    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized. Please log in." },
        { status: 401 }
      );
    }

    const url = new URL(request.url);
    let gameId = url.searchParams.get("gameId");

    // If no gameId provided, use selected game
    if (!gameId) {
      const { game: selectedGame, error: selectedError } = await getSelectedGameForUser(user.id, supabase);
      if (selectedError || !selectedGame) {
        return NextResponse.json(
          { error: "No game selected and no gameId provided" },
          { status: 400 }
        );
      }
      gameId = selectedGame.id;
    }

    // Verify user owns this game
    const { data: game, error: gameError } = await supabase
      .from("games")
      .select("id, name, roblox_game_id, api_key")
      .eq("id", gameId)
      .eq("user_id", user.id)
      .single();

    if (gameError || !game) {
      return NextResponse.json(
        { error: "Game not found or not owned by you" },
        { status: 404 }
      );
    }

    // Count total events
    const { count: totalEvents } = await supabase
      .from("events")
      .select("*", { count: "exact", head: true })
      .eq("game_id", gameId);

    // Count events by type (for eventTypeCounts breakdown)
    const { data: eventTypesRaw } = await supabase
      .from("events")
      .select("event_type")
      .eq("game_id", gameId);
    
    const eventTypeCounts: Record<string, number> = {};
    (eventTypesRaw || []).forEach((e: { event_type: string }) => {
      eventTypeCounts[e.event_type] = (eventTypeCounts[e.event_type] || 0) + 1;
    });

    // Count valid player events (excluding server and null player_id, excluding ccu_heartbeat/script_started)
    const { count: validPlayerEvents } = await supabase
      .from("events")
      .select("*", { count: "exact", head: true })
      .eq("game_id", gameId)
      .not("player_id", "is", null)
      .neq("player_id", "server")
      .not("event_type", "in", "(ccu_heartbeat,script_started)");

    // Get distinct players (excluding "server" and null)
    const { data: playerIdsRaw } = await supabase
      .from("events")
      .select("player_id")
      .eq("game_id", gameId)
      .not("player_id", "is", null)
      .neq("player_id", "server")
      .not("event_type", "in", "(ccu_heartbeat,script_started)");
    
    const distinctPlayerIds = new Set((playerIdsRaw || []).map((e: { player_id: string }) => e.player_id));
    const distinctPlayers = distinctPlayerIds.size;

    // Specific event type counts
    const { count: purchaseSuccessCount } = await supabase
      .from("events")
      .select("*", { count: "exact", head: true })
      .eq("game_id", gameId)
      .eq("event_type", "purchase_success");

    const { count: playerJoinCount } = await supabase
      .from("events")
      .select("*", { count: "exact", head: true })
      .eq("game_id", gameId)
      .eq("event_type", "player_join");

    const { count: sessionStartCount } = await supabase
      .from("events")
      .select("*", { count: "exact", head: true })
      .eq("game_id", gameId)
      .eq("event_type", "session_start");

    const { count: sessionEndCount } = await supabase
      .from("events")
      .select("*", { count: "exact", head: true })
      .eq("game_id", gameId)
      .eq("event_type", "session_end");

    const { count: ccuHeartbeatCount } = await supabase
      .from("events")
      .select("*", { count: "exact", head: true })
      .eq("game_id", gameId)
      .eq("event_type", "ccu_heartbeat");

    const { count: scriptStartedCount } = await supabase
      .from("events")
      .select("*", { count: "exact", head: true })
      .eq("game_id", gameId)
      .eq("event_type", "script_started");

    // CCU and related counts
    const { count: ccuSnapshotsCount } = await supabase
      .from("ccu_snapshots")
      .select("*", { count: "exact", head: true })
      .eq("game_id", gameId);

    const { count: serverHeartbeatsCount } = await supabase
      .from("server_heartbeats")
      .select("*", { count: "exact", head: true })
      .eq("game_id", gameId);

    const { count: productsCount } = await supabase
      .from("products")
      .select("*", { count: "exact", head: true })
      .eq("game_id", gameId);

    const { count: gameSnapshotsCount } = await supabase
      .from("game_snapshots")
      .select("*", { count: "exact", head: true })
      .eq("game_id", gameId);

    // For avgSession source count - how many session_end events have duration data
    const { count: avgSessionSourceCount } = await supabase
      .from("events")
      .select("*", { count: "exact", head: true })
      .eq("game_id", gameId)
      .in("event_type", ["session_end", "player_leave"]);

    // Get latest timestamps
    const { data: latestEvent } = await supabase
      .from("events")
      .select("created_at")
      .eq("game_id", gameId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    const { data: latestPurchase } = await supabase
      .from("events")
      .select("created_at")
      .eq("game_id", gameId)
      .eq("event_type", "purchase_success")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    const { data: latestCcuSnapshot } = await supabase
      .from("ccu_snapshots")
      .select("created_at")
      .eq("game_id", gameId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // Build inconsistencies array
    const inconsistencies: string[] = [];
    
    // Check: if totalEvents > 0 but eventTypeCounts is empty
    if ((totalEvents ?? 0) > 0 && Object.keys(eventTypeCounts).length === 0) {
      inconsistencies.push("totalEvents > 0 but eventTypeCounts is empty");
    }
    
    // Check: if avgSessionSourceCount > 0 but avgSession would be null (totalSessions = 0)
    const totalSessions = (playerJoinCount ?? 0) + (sessionStartCount ?? 0);
    if ((avgSessionSourceCount ?? 0) > 0 && totalSessions === 0) {
      inconsistencies.push("avgSessionSourceCount > 0 but totalSessions is 0 (session_end exists but no session_start/player_join)");
    }
    
    // Check: if distinctPlayers > 0 but no valid player events
    if (distinctPlayers > 0 && (validPlayerEvents ?? 0) === 0) {
      inconsistencies.push("distinctPlayers > 0 but validPlayerEvents is 0");
    }
    
    // Check: server events mixed in player counts (shouldn't happen after fix)
    const serverEvents = eventTypeCounts["script_started"] || eventTypeCounts["ccu_heartbeat"];
    if (serverEvents && distinctPlayers === 0 && (totalEvents ?? 0) > 0) {
      inconsistencies.push("Only server events present (ccu_heartbeat/script_started) - no real player data yet");
    }

    return NextResponse.json({
      selectedGameId: gameId,
      selectedGameName: game.name || game.roblox_game_id || gameId,
      hasApiKey: !!game.api_key,
      
      // Total counts
      totalEvents: totalEvents ?? 0,
      eventTypeCounts,
      
      // Player-specific counts (excluding server-only events)
      validPlayerEvents: validPlayerEvents ?? 0,
      distinctPlayers,
      
      // Event type breakdown
      purchaseSuccessCount: purchaseSuccessCount ?? 0,
      playerJoinCount: playerJoinCount ?? 0,
      sessionStartCount: sessionStartCount ?? 0,
      sessionEndCount: sessionEndCount ?? 0,
      ccuHeartbeatCount: ccuHeartbeatCount ?? 0,
      scriptStartedCount: scriptStartedCount ?? 0,
      
      // Session metrics source
      avgSessionSourceCount: avgSessionSourceCount ?? 0,
      
      // Related table counts
      ccuSnapshotsCount: ccuSnapshotsCount ?? 0,
      serverHeartbeatsCount: serverHeartbeatsCount ?? 0,
      productsCount: productsCount ?? 0,
      gameSnapshotsCount: gameSnapshotsCount ?? 0,
      
      // Latest timestamps
      latestEventAt: latestEvent?.created_at ?? null,
      latestPurchaseAt: latestPurchase?.created_at ?? null,
      latestCcuSnapshotAt: latestCcuSnapshot?.created_at ?? null,
      
      // Summary flags
      hasAnyData: (totalEvents ?? 0) > 0 || (ccuSnapshotsCount ?? 0) > 0,
      hasPurchases: (purchaseSuccessCount ?? 0) > 0,
      hasPlayerActivity: (playerJoinCount ?? 0) > 0 || (sessionEndCount ?? 0) > 0 || (sessionStartCount ?? 0) > 0,
      hasCcuTracking: (ccuHeartbeatCount ?? 0) > 0 || (ccuSnapshotsCount ?? 0) > 0,
      
      // Inconsistency detection
      inconsistencies,
    });

  } catch (error) {
    console.error("[data-health] Unexpected error:", error);
    return NextResponse.json(
      { error: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
