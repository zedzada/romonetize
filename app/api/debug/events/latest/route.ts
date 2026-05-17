import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { getSelectedGameForUser } from "@/lib/server/selected-game";

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

    // Get selected game using shared utility
    const { game: selectedGame, error: gameError } = await getSelectedGameForUser(user.id, supabase);

    if (gameError || !selectedGame) {
      return NextResponse.json({
        success: false,
        error: gameError || "No game found",
        selectedGameId: null,
        latestEvents: [],
      });
    }

    const selectedGameId = selectedGame.id;

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
      latestEvents: (events || []).map((e: { id: string; created_at: string; event_type: string; player_id: string | null; product_id: string | null; product_name: string | null; product_type: string | null; robux: number | null; metadata: Record<string, unknown> | null }) => ({
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
