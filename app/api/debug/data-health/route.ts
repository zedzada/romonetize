import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/debug/data-health?gameId=<uuid>
 * 
 * Returns data health counts for a selected game.
 * Requires authentication.
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
    const gameId = url.searchParams.get("gameId");

    if (!gameId) {
      return NextResponse.json(
        { error: "Missing gameId query parameter" },
        { status: 400 }
      );
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

    // Count events by type
    const { count: eventsCount } = await supabase
      .from("events")
      .select("*", { count: "exact", head: true })
      .eq("game_id", gameId);

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

    return NextResponse.json({
      selectedGameId: gameId,
      selectedGameName: game.name || game.roblox_game_id || gameId,
      hasApiKey: !!game.api_key,
      
      // Event counts
      eventsCount: eventsCount ?? 0,
      purchaseSuccessCount: purchaseSuccessCount ?? 0,
      playerJoinCount: playerJoinCount ?? 0,
      sessionEndCount: sessionEndCount ?? 0,
      ccuHeartbeatCount: ccuHeartbeatCount ?? 0,
      
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
      hasAnyData: (eventsCount ?? 0) > 0 || (ccuSnapshotsCount ?? 0) > 0,
      hasPurchases: (purchaseSuccessCount ?? 0) > 0,
      hasPlayerActivity: (playerJoinCount ?? 0) > 0 || (sessionEndCount ?? 0) > 0,
      hasCcuTracking: (ccuHeartbeatCount ?? 0) > 0 || (ccuSnapshotsCount ?? 0) > 0,
    });

  } catch (error) {
    console.error("[data-health] Unexpected error:", error);
    return NextResponse.json(
      { error: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
