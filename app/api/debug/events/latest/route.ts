import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// GET /api/debug/events/latest - Return latest 20 events for selected game
// Authenticated only - uses user's selected game
export async function GET() {
  try {
    const supabase = await createClient();
    
    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Get user's selected game from profile
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("selected_game_id")
      .eq("id", user.id)
      .single();

    if (profileError || !profile?.selected_game_id) {
      return NextResponse.json({
        success: false,
        error: "No game selected",
        selectedGameId: null,
        latestEvents: [],
      });
    }

    const selectedGameId = profile.selected_game_id;

    // Get game info
    const { data: game, error: gameError } = await supabase
      .from("games")
      .select("id, name, api_key, status, last_event_at")
      .eq("id", selectedGameId)
      .eq("user_id", user.id)
      .single();

    if (gameError || !game) {
      return NextResponse.json({
        success: false,
        error: "Game not found or not owned by user",
        selectedGameId,
        latestEvents: [],
      });
    }

    // Fetch latest 20 events for this game
    const { data: events, error: eventsError } = await supabase
      .from("events")
      .select("id, created_at, event_type, player_id, product_id, product_name, product_type, robux, metadata")
      .eq("game_id", selectedGameId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (eventsError) {
      return NextResponse.json({
        success: false,
        error: "Failed to fetch events: " + eventsError.message,
        selectedGameId,
        latestEvents: [],
      });
    }

    // Count events by type
    const eventTypeCounts: Record<string, number> = {};
    for (const event of events || []) {
      const type = event.event_type || "unknown";
      eventTypeCounts[type] = (eventTypeCounts[type] || 0) + 1;
    }

    return NextResponse.json({
      success: true,
      selectedGameId,
      gameName: game.name,
      gameStatus: game.status,
      lastEventAt: game.last_event_at,
      eventCount: events?.length || 0,
      eventTypeCounts,
      latestEvents: (events || []).map((e) => ({
        id: e.id,
        created_at: e.created_at,
        event_type: e.event_type,
        player_id: e.player_id,
        product_id: e.product_id,
        product_name: e.product_name,
        product_type: e.product_type,
        robux: e.robux,
        metadata: e.metadata,
      })),
    });
  } catch (error) {
    console.error("[api/debug/events/latest] Error:", error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error",
        latestEvents: [],
      },
      { status: 500 }
    );
  }
}
