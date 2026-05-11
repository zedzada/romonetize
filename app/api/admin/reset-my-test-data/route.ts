import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/admin/reset-my-test-data
 * 
 * Safe reset endpoint for authenticated users to clear their test data.
 * Only resets connected games and analytics data for the current user.
 * 
 * DOES NOT DELETE:
 * - auth.users
 * - public.profiles
 * - public.subscriptions
 * - public.ai_credit_balances
 * - public.ai_credit_transactions
 * - Stripe/billing data
 * - Roblox account connection (kept in profiles)
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
      games: 0,
      events: 0,
      ccuSnapshots: 0,
      gameSnapshots: 0,
      products: 0,
    };
    const skipped: string[] = [];

    // Step 1: Get all game IDs owned by this user
    const { data: userGames, error: gamesError } = await supabase
      .from("games")
      .select("id, roblox_game_id")
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
        message: "No games found to reset",
        deleted,
        skipped,
      });
    }

    const gameIds = userGames.map(g => g.id);

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

    // Step 4: Delete game snapshots for these games
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

    // Step 5: Delete products for these games
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

    // Step 6: Finally, delete the games themselves
    const { error: deleteGamesError, count: gamesCount } = await supabase
      .from("games")
      .delete({ count: "exact" })
      .eq("user_id", userId);

    if (deleteGamesError) {
      console.error("[reset-my-test-data] Error deleting games:", deleteGamesError);
      return NextResponse.json(
        { error: "Failed to delete games. Some data may have been partially deleted." },
        { status: 500 }
      );
    }

    deleted.games = gamesCount || 0;

    return NextResponse.json({
      success: true,
      message: `Reset complete. Deleted ${deleted.games} games and associated data.`,
      deleted,
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
