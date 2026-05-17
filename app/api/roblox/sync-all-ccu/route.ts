import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getRobloxGameStats } from "@/lib/services/roblox-api";

// Lazy init for service role client (for inserts that bypass RLS)
function getSupabaseAdmin() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_CUSTOM_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  return createAdminClient(supabaseUrl!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// Max concurrency to avoid overwhelming Roblox API
const MAX_CONCURRENT_SYNCS = 3;

interface GameCcuResult {
  gameId: string;
  gameName: string;
  robloxGameId: string;
  ccu: number | null;
  success: boolean;
  error?: string;
}

/**
 * POST /api/roblox/sync-all-ccu
 * 
 * Syncs CCU snapshots for ALL connected games for the authenticated user.
 * This ensures all games collect CCU data even when the user is viewing a different game.
 * 
 * Behavior:
 * - Fetches all connected games for the user
 * - For each game with roblox_game_id, fetches current Roblox stats
 * - Inserts a new CCU snapshot row (append-only, no upsert)
 * - Updates cached game stats
 * - Continues processing other games even if one fails
 * - Returns per-game success/error results
 */
export async function POST() {
  try {
    const supabase = await createClient();
    const supabaseAdmin = getSupabaseAdmin();

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Fetch all connected games for this user
    const { data: games, error: gamesError } = await supabase
      .from("games")
      .select("id, name, roblox_game_id, universe_id")
      .eq("user_id", user.id)
      .neq("status", "deleted")
      .not("roblox_game_id", "is", null);

    if (gamesError) {
      return NextResponse.json(
        { error: "Failed to fetch games", details: gamesError.message },
        { status: 500 }
      );
    }

    if (!games || games.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No connected games to sync",
        results: [],
        totalGames: 0,
        successCount: 0,
        failureCount: 0,
      });
    }

    const results: GameCcuResult[] = [];
    const capturedAt = new Date().toISOString();

    // Process games with limited concurrency
    const processGame = async (game: typeof games[0]): Promise<GameCcuResult> => {
      // Resolve roblox_game_id - never insert without it
      const robloxGameId = game.roblox_game_id || game.universe_id;
      
      const result: GameCcuResult = {
        gameId: game.id,
        gameName: game.name,
        robloxGameId: robloxGameId || "MISSING",
        ccu: null,
        success: false,
      };

      // GUARD: Never insert CCU snapshot without roblox_game_id
      if (!robloxGameId) {
        result.error = "Skipped: No roblox_game_id";
        return result;
      }

      try {
        // Fetch current stats from Roblox API
        const stats = await getRobloxGameStats(robloxGameId);
        
        if (!stats || stats.currentPlayers === null) {
          result.error = "Roblox API returned no data";
          return result;
        }

        result.ccu = stats.currentPlayers;

        // Insert CCU snapshot (append-only)
        // Schema columns: id, game_id, ccu, source, server_id, created_at
        const { error: insertError } = await supabaseAdmin
          .from("ccu_snapshots")
          .insert({
            game_id: game.id,
            ccu: stats.currentPlayers,
            source: "roblox_api_poll_all",
            created_at: capturedAt,
          });

        if (insertError) {
          result.error = `CCU insert failed: ${insertError.message}`;
          return result;
        }

        // Update cached game stats
        await supabaseAdmin
          .from("games")
          .update({
            current_players: stats.currentPlayers,
            total_visits: stats.totalVisits ?? undefined,
            favorites: stats.favorites ?? undefined,
            likes: stats.likes ?? undefined,
            dislikes: stats.dislikes ?? undefined,
            last_roblox_sync: capturedAt,
          })
          .eq("id", game.id);

        result.success = true;
        return result;
      } catch (err) {
        result.error = err instanceof Error ? err.message : "Unknown error";
        return result;
      }
    };

    // Process in batches with limited concurrency
    for (let i = 0; i < games.length; i += MAX_CONCURRENT_SYNCS) {
      const batch = games.slice(i, i + MAX_CONCURRENT_SYNCS);
      const batchResults = await Promise.all(batch.map(processGame));
      results.push(...batchResults);
    }

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;

    // Log in development
    if (process.env.NODE_ENV === "development") {
      console.log(`[sync-all-ccu] Synced ${successCount}/${games.length} games at ${capturedAt}`);
      if (failureCount > 0) {
        console.log("[sync-all-ccu] Failures:", results.filter((r) => !r.success));
      }
    }

    return NextResponse.json({
      success: true,
      message: `Synced CCU for ${successCount} of ${games.length} games`,
      results,
      totalGames: games.length,
      successCount,
      failureCount,
      capturedAt,
    });
  } catch (err) {
    console.error("[sync-all-ccu] Unexpected error:", err);
    return NextResponse.json(
      { 
        error: "Internal server error", 
        details: err instanceof Error ? err.message : "Unknown error" 
      },
      { status: 500 }
    );
  }
}
