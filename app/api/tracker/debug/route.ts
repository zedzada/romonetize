import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { getSelectedGameForUser } from "@/lib/server/selected-game";

// GET /api/tracker/debug - Debug tracker status for authenticated user's selected game
// Uses the same selected game logic as dashboard header/layout
export async function GET() {
  try {
    const supabase = await createClient();

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    // Use shared utility - same logic as dashboard header and getSelectedGame action
    const { game: selectedGame, error: gameError } = await getSelectedGameForUser(user.id, supabase);

    if (gameError || !selectedGame) {
      return NextResponse.json({
        success: true,
        selectedGame: null,
        eventsTableExists: true,
        eventCountForGame: 0,
        lastEvent: null,
        recentEvents: [],
        trackingActive: false,
        reason: gameError || "No game connected",
      });
    }

    // Count events for this game
    const { count: eventCount, error: countError } = await supabase
      .from("events")
      .select("*", { count: "exact", head: true })
      .eq("game_id", selectedGame.id);

    if (countError) {
      return NextResponse.json(
        { success: false, error: "Failed to count events", details: countError.message },
        { status: 500 }
      );
    }

    // Get recent events
    const { data: recentEvents, error: recentError } = await supabase
      .from("events")
      .select("event_type, player_id, metadata, created_at")
      .eq("game_id", selectedGame.id)
      .order("created_at", { ascending: false })
      .limit(10);

    if (recentError) {
      return NextResponse.json(
        { success: false, error: "Failed to fetch recent events", details: recentError.message },
        { status: 500 }
      );
    }

    // Determine tracking status
    const trackingActive = 
      selectedGame.last_event_at !== null || 
      (eventCount !== null && eventCount > 0);

    let reason = "Unknown";
    if (trackingActive) {
      reason = `Tracking active: ${eventCount} event(s) received`;
    } else {
      reason = "No events received yet. Install tracking script and publish game.";
    }

    // Get last event
    const lastEvent = recentEvents && recentEvents.length > 0 ? {
      event_type: recentEvents[0].event_type,
      player_id: recentEvents[0].player_id,
      created_at: recentEvents[0].created_at,
    } : null;

    // Get CCU heartbeat status from server_heartbeats table
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    
    // Count active servers (heartbeat within last 2 minutes)
    const { count: activeServerCount } = await supabase
      .from("server_heartbeats")
      .select("*", { count: "exact", head: true })
      .eq("game_id", selectedGame.id)
      .gte("last_seen_at", twoMinutesAgo);

    // Get latest heartbeat
    const { data: latestHeartbeat } = await supabase
      .from("server_heartbeats")
      .select("last_seen_at, ccu, server_id")
      .eq("game_id", selectedGame.id)
      .order("last_seen_at", { ascending: false })
      .limit(1)
      .single();

    const heartbeatActive = (activeServerCount ?? 0) > 0;
    const latestHeartbeatAt = latestHeartbeat?.last_seen_at || null;

    return NextResponse.json({
      success: true,
      selectedGame: {
        id: selectedGame.id,
        name: selectedGame.name,
        roblox_game_id: selectedGame.roblox_game_id,
        universe_id: selectedGame.universe_id,
        // Only show full api_key in development, otherwise show prefix only
        api_key: process.env.NODE_ENV === "development" ? selectedGame.api_key : undefined,
        api_key_prefix: selectedGame.api_key ? selectedGame.api_key.slice(0, 8) + "..." : null,
        last_event_at: selectedGame.last_event_at,
        status: selectedGame.status,
      },
      eventsTableExists: true,
      eventCountForGame: eventCount || 0,
      lastEvent,
      recentEvents: (recentEvents || []).map(e => ({
        event_type: e.event_type,
        player_id: e.player_id,
        created_at: e.created_at,
      })),
      trackingActive,
      reason,
      // CCU heartbeat status
      heartbeatActive,
      latestHeartbeatAt,
      activeServerCount: activeServerCount ?? 0,
      latestHeartbeatCcu: latestHeartbeat?.ccu ?? null,
    });
  } catch (error) {
    console.error("[api/tracker/debug] Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
