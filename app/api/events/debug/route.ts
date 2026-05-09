import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

// GET /api/events/debug?gameId=SELECTED_GAME_ID
// Returns debug info about events for the current user's game
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }
    
    // Get gameId from query params
    const { searchParams } = new URL(request.url);
    const gameId = searchParams.get("gameId");
    
    if (!gameId) {
      return NextResponse.json(
        { success: false, error: "Missing gameId parameter" },
        { status: 400 }
      );
    }
    
    // Verify user owns this game
    const { data: game, error: gameError } = await supabase
      .from("games")
      .select("id, name, api_key, roblox_game_id, last_event_at, status")
      .eq("id", gameId)
      .eq("user_id", user.id)
      .single();
    
    if (gameError || !game) {
      return NextResponse.json(
        { success: false, error: "Game not found or access denied" },
        { status: 404 }
      );
    }
    
    // Get event count
    const { count: eventCount } = await supabase
      .from("events")
      .select("*", { count: "exact", head: true })
      .eq("game_id", gameId);
    
    // Get last event
    const { data: lastEventData } = await supabase
      .from("events")
      .select("event_type, player_id, created_at")
      .eq("game_id", gameId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    
    // Get recent events (last 10)
    const { data: recentEvents } = await supabase
      .from("events")
      .select("event_type, player_id, created_at")
      .eq("game_id", gameId)
      .order("created_at", { ascending: false })
      .limit(10);
    
    return NextResponse.json({
      success: true,
      game: {
        id: game.id,
        name: game.name,
        roblox_game_id: game.roblox_game_id,
        status: game.status,
        last_event_at: game.last_event_at,
        // Show only prefix of API key for debugging
        api_key_prefix: game.api_key?.slice(0, 8) + "...",
      },
      eventCount: eventCount || 0,
      lastEvent: lastEventData || null,
      recentEvents: recentEvents || [],
    });
  } catch (error) {
    console.error("[api/events/debug] Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
