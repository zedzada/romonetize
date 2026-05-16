import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/admin/reset-my-test-data
 * 
 * Safe reset endpoint for authenticated users to clear their test/analytics data.
 * Only resets analytics data for the current user's games.
 * 
 * DELETES (analytics data only):
 * - events (purchase_success, player_join, session_end, ccu_heartbeat, etc.)
 * - ccu_snapshots
 * - server_heartbeats
 * - game_snapshots
 * - products (tracked product stats)
 * 
 * DOES NOT DELETE:
 * - games (connected games stay, API keys stay)
 * - profiles
 * - subscriptions
 * - ai_credit_balances / ai_credit_transactions
 * - Stripe/billing data
 * - Roblox account connection
 */
export async function POST() {
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

    const userId = user.id;
    const deleted: Record<string, number> = {
      events: 0,
      ccuSnapshots: 0,
      serverHeartbeats: 0,
      gameSnapshots: 0,
      products: 0,
    };
    const skipped: string[] = [];

    // Step 1: Get all game IDs owned by this user
    const { data: userGames, error: gamesError } = await supabase
      .from("games")
      .select("id, name, roblox_game_id")
      .eq("user_id", userId);

    if (gamesError) {
      console.error("[reset-my-test-data] Error fetching user games:", gamesError);
      return NextResponse.json(
        { error: "Failed to fetch user games" },
        { status: 500 }
      );
    }

    // If no games, nothing to delete
    if (!userGames || userGames.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No games found. Nothing to reset.",
        deleted,
        skipped,
        gamesPreserved: 0,
      });
    }

    const gameIds = userGames.map(g => g.id);
    const gameNames = userGames.map(g => g.name || g.roblox_game_id || g.id);

    // Step 2: Delete events for these games
    const { error: eventsError, count: eventsCount } = await supabase
      .from("events")
      .delete({ count: "exact" })
      .in("game_id", gameIds);

    if (eventsError) {
      console.error("[reset-my-test-data] Error deleting events:", eventsError);
      skipped.push("events");
    } else {
      deleted.events = eventsCount || 0;
    }

    // Step 3: Delete CCU snapshots for these games
    const { error: ccuError, count: ccuCount } = await supabase
      .from("ccu_snapshots")
      .delete({ count: "exact" })
      .in("game_id", gameIds);

    if (ccuError) {
      console.error("[reset-my-test-data] Error deleting ccu_snapshots:", ccuError);
      skipped.push("ccu_snapshots");
    } else {
      deleted.ccuSnapshots = ccuCount || 0;
    }

    // Step 4: Delete server heartbeats for these games
    const { error: heartbeatsError, count: heartbeatsCount } = await supabase
      .from("server_heartbeats")
      .delete({ count: "exact" })
      .in("game_id", gameIds);

    if (heartbeatsError) {
      console.error("[reset-my-test-data] Error deleting server_heartbeats:", heartbeatsError);
      skipped.push("server_heartbeats");
    } else {
      deleted.serverHeartbeats = heartbeatsCount || 0;
    }

    // Step 5: Delete game snapshots for these games
    const { error: snapshotsError, count: snapshotsCount } = await supabase
      .from("game_snapshots")
      .delete({ count: "exact" })
      .in("game_id", gameIds);

    if (snapshotsError) {
      console.error("[reset-my-test-data] Error deleting game_snapshots:", snapshotsError);
      skipped.push("game_snapshots");
    } else {
      deleted.gameSnapshots = snapshotsCount || 0;
    }

    // Step 6: Delete products for these games
    const { error: productsError, count: productsCount } = await supabase
      .from("products")
      .delete({ count: "exact" })
      .in("game_id", gameIds);

    if (productsError) {
      console.error("[reset-my-test-data] Error deleting products:", productsError);
      skipped.push("products");
    } else {
      deleted.products = productsCount || 0;
    }

    // NOTE: We do NOT delete games - they stay connected with API keys intact
    // User can immediately re-run tracker script without re-adding games

    const totalDeleted = Object.values(deleted).reduce((a, b) => a + b, 0);

    return NextResponse.json({
      success: true,
      message: `Reset complete. Deleted ${totalDeleted} records. Your ${gameIds.length} connected game(s) are preserved.`,
      deleted,
      gamesPreserved: gameIds.length,
      gameNames,
      skipped: skipped.length > 0 ? skipped : undefined,
    });

  } catch (error) {
    console.error("[reset-my-test-data] Unexpected error:", error);
    return NextResponse.json(
      { error: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}

// Prevent GET requests
export async function GET() {
  return NextResponse.json(
    { error: "Method not allowed. Use POST." },
    { status: 405 }
  );
}
