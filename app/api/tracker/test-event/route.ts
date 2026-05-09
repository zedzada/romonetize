import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// POST /api/tracker/test-event - Send a server test event for the authenticated user's selected game
export async function POST() {
  try {
    const supabase = await createClient();

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, step: "auth", error: "Not authenticated" },
        { status: 401 }
      );
    }

    // Get user's selected game
    const { data: selectedGame, error: gameError } = await supabase
      .from("games")
      .select("id, name, roblox_game_id, api_key, status")
      .eq("user_id", user.id)
      .neq("status", "deleted")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (gameError || !selectedGame) {
      return NextResponse.json(
        { success: false, step: "game_lookup", error: "No game connected. Connect a game first." },
        { status: 404 }
      );
    }

    if (!selectedGame.api_key) {
      return NextResponse.json(
        { success: false, step: "game_lookup", error: "Game has no API key. This should not happen." },
        { status: 500 }
      );
    }

    // Use admin client to insert event (bypasses RLS)
    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Insert test event directly
    const testEvent = {
      game_id: selectedGame.id,
      event_type: "script_started",
      player_id: "server_test",
      metadata: {
        source: "dashboard_test",
        timestamp: new Date().toISOString(),
        user_id: user.id,
      },
    };

    const { data: insertedEvent, error: insertError } = await supabaseAdmin
      .from("events")
      .insert(testEvent)
      .select()
      .single();

    if (insertError) {
      console.error("[api/tracker/test-event] Insert error:", insertError);
      return NextResponse.json(
        { success: false, step: "insert", error: "Failed to insert test event", details: insertError.message },
        { status: 500 }
      );
    }

    // Update last_event_at on the game
    await supabaseAdmin
      .from("games")
      .update({ last_event_at: new Date().toISOString() })
      .eq("id", selectedGame.id);

    console.log(`[api/tracker/test-event] Test event inserted: game_id=${selectedGame.id}, event_id=${insertedEvent.id}`);

    return NextResponse.json({
      success: true,
      message: "Test event inserted successfully",
      event: {
        id: insertedEvent.id,
        event_type: insertedEvent.event_type,
        game_id: insertedEvent.game_id,
        created_at: insertedEvent.created_at,
      },
      game: {
        id: selectedGame.id,
        name: selectedGame.name,
        roblox_game_id: selectedGame.roblox_game_id,
      },
    });
  } catch (error) {
    console.error("[api/tracker/test-event] Error:", error);
    return NextResponse.json(
      { success: false, step: "unknown", error: "Internal server error", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
