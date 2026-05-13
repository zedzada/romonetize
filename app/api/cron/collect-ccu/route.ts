import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@supabase/supabase-js";
import { getRobloxGameStats, getUniverseIdFromPlaceId } from "@/lib/services/roblox-api";

// Vercel cron jobs send CRON_SECRET in Authorization header
const CRON_SECRET = process.env.CRON_SECRET;

/**
 * CCU Collection Cron Job
 * 
 * Runs every 5 minutes (Vercel cron minimum)
 * Collects current player count (CCU) from Roblox API for all active games
 * Stores snapshots in ccu_snapshots table for historical tracking
 * 
 * This enables CCU charts even when users are not viewing the dashboard
 */
export async function GET(request: NextRequest) {
  // Verify cron secret in production
  if (process.env.NODE_ENV === "production" && CRON_SECRET) {
    const authHeader = request.headers.get("Authorization");
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Use service role client for cron jobs
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_CUSTOM_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: "Missing Supabase credentials" },
      { status: 500 }
    );
  }

  const supabase = createServerClient(supabaseUrl, supabaseServiceKey);

  try {
    // Get all active games
    const { data: games, error: gamesError } = await supabase
      .from("games")
      .select("id, roblox_game_id, universe_id, roblox_api_key")
      .eq("status", "active");

    if (gamesError) {
      console.error("[CCU Cron] Error fetching games:", gamesError);
      return NextResponse.json(
        { error: "Failed to fetch games", details: gamesError.message },
        { status: 500 }
      );
    }

    if (!games || games.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No active games to collect CCU for",
        collected: 0,
      });
    }

    const results: Array<{
      game_id: string;
      ccu: number | null;
      success: boolean;
      error?: string;
    }> = [];

    // Collect CCU for each game
    for (const game of games) {
      try {
        // Get universe ID if not already stored
        let universeId = game.universe_id;
        
        if (!universeId && game.roblox_game_id) {
          universeId = await getUniverseIdFromPlaceId(game.roblox_game_id);
          
          // Update game with universe_id for future use
          if (universeId) {
            await supabase
              .from("games")
              .update({ universe_id: universeId })
              .eq("id", game.id);
          }
        }

        if (!universeId) {
          results.push({
            game_id: game.id,
            ccu: null,
            success: false,
            error: "Could not resolve universe ID",
          });
          continue;
        }

        // Fetch CCU from Roblox API
        const stats = await getRobloxGameStats(universeId, game.roblox_api_key);

        if (stats.source === "not_available" || stats.currentPlayers === null) {
          results.push({
            game_id: game.id,
            ccu: null,
            success: false,
            error: "Roblox API unavailable",
          });
          continue;
        }

        // Get user_id for the game (needed for RLS)
        const { data: gameOwner } = await supabase
          .from("games")
          .select("user_id, roblox_game_id")
          .eq("id", game.id)
          .single();

        // Insert CCU snapshot with all required fields
        const { error: insertError } = await supabase
          .from("ccu_snapshots")
          .insert({
            user_id: gameOwner?.user_id,
            game_id: game.id,
            roblox_game_id: gameOwner?.roblox_game_id || game.roblox_game_id,
            ccu: stats.currentPlayers,
            captured_at: new Date().toISOString(),
            source: "cron_job",
            created_at: new Date().toISOString(),
          });

        if (insertError) {
          results.push({
            game_id: game.id,
            ccu: stats.currentPlayers,
            success: false,
            error: insertError.message,
          });
          continue;
        }

        // Also update the games table with current_players
        await supabase
          .from("games")
          .update({
            current_players: stats.currentPlayers,
            last_roblox_sync: new Date().toISOString(),
          })
          .eq("id", game.id);

        results.push({
          game_id: game.id,
          ccu: stats.currentPlayers,
          success: true,
        });
      } catch (error) {
        results.push({
          game_id: game.id,
          ccu: null,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    // NOTE: CCU snapshots are append-only. No automatic cleanup.
    // Manual cleanup can be done via admin API if needed.

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    return NextResponse.json({
      success: true,
      message: `Collected CCU for ${successCount}/${results.length} games`,
      collected: successCount,
      failed: failCount,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[CCU Cron] Unexpected error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Unexpected error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
