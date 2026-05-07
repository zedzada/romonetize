import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { 
  getRobloxGameStats, 
  getUniverseIdFromPlaceId,
  getRobloxGameInfo,
  getRobloxGameThumbnail 
} from "@/lib/services/roblox-api";

/**
 * POST /api/roblox/sync-selected-game
 * 
 * Syncs Roblox public stats for the selected game.
 * - Fetches CCU, visits, favorites, likes/dislikes
 * - Updates the games table with fresh data
 * - Stores a CCU snapshot for historical charts
 * - Optionally fetches products if requested
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    
    // Get authenticated user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError || !user) {
      return NextResponse.json(
        { success: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    // Parse request body for options
    let options: { includeProducts?: boolean } = {};
    try {
      const body = await request.json();
      options = body || {};
    } catch {
      // Empty body is fine
    }

    // Get the selected game
    const { data: selectedGame, error: gameError } = await supabase
      .from("games")
      .select("id, name, roblox_game_id, universe_id, root_place_id, roblox_api_key")
      .eq("user_id", user.id)
      .eq("is_selected", true)
      .neq("status", "deleted")
      .single();

    if (gameError || !selectedGame) {
      return NextResponse.json(
        { success: false, error: "No game selected" },
        { status: 404 }
      );
    }

    // Resolve universe ID if needed
    let universeId = selectedGame.universe_id;
    if (!universeId && selectedGame.roblox_game_id) {
      universeId = await getUniverseIdFromPlaceId(selectedGame.roblox_game_id);
      if (universeId) {
        await supabase
          .from("games")
          .update({ universe_id: universeId })
          .eq("id", selectedGame.id);
      }
    }

    if (!universeId) {
      return NextResponse.json(
        { 
          success: false, 
          error: "Could not resolve universe ID for this game",
          stats: null,
        },
        { status: 400 }
      );
    }

    // Fetch Roblox stats in parallel
    const [stats, gameInfo, thumbnailUrl] = await Promise.all([
      getRobloxGameStats(universeId, selectedGame.roblox_api_key),
      getRobloxGameInfo(universeId),
      getRobloxGameThumbnail(universeId),
    ]);

    if (stats.source !== "roblox_api") {
      return NextResponse.json({
        success: true,
        synced: false,
        error: "Roblox API data not available",
        stats: null,
        sectionErrors: { robloxStats: "Roblox API returned no data" },
      });
    }

    // Update game record with fresh stats
    const updateData: Record<string, unknown> = {
      universe_id: universeId,
      current_players: stats.currentPlayers ?? 0,
      total_visits: stats.totalVisits ?? 0,
      favorites: stats.favorites ?? 0,
      likes: stats.likes ?? 0,
      dislikes: stats.dislikes ?? 0,
      last_roblox_sync: new Date().toISOString(),
      roblox_sync_status: "synced",
    };

    if (thumbnailUrl) {
      updateData.thumbnail_url = thumbnailUrl;
    }

    if (gameInfo) {
      updateData.name = gameInfo.name || selectedGame.name;
      updateData.description = gameInfo.description;
      updateData.genre = gameInfo.genre;
      updateData.max_players = gameInfo.maxPlayers;
      if (gameInfo.creator) {
        updateData.creator_name = gameInfo.creator.name;
        updateData.creator_type = gameInfo.creator.type;
      }
    }

    await supabase
      .from("games")
      .update(updateData)
      .eq("id", selectedGame.id);

    // Store CCU snapshot for historical charts
    if (stats.currentPlayers !== null) {
      await supabase.from("ccu_snapshots").insert({
        game_id: selectedGame.id,
        ccu: stats.currentPlayers,
      });
    }

    // Optionally fetch and sync products
    let productsCount = 0;
    if (options.includeProducts) {
      try {
        // Get user's Roblox OAuth token
        const { data: profile } = await supabase
          .from("profiles")
          .select("roblox_access_token")
          .eq("id", user.id)
          .single();

        if (profile?.roblox_access_token) {
          // Fetch products via the products API
          const productsResponse = await fetch(
            `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/api/roblox/products`,
            {
              headers: {
                Cookie: request.headers.get("Cookie") || "",
              },
            }
          );
          
          if (productsResponse.ok) {
            const productsData = await productsResponse.json();
            productsCount = productsData.products?.length || 0;
          }
        }
      } catch {
        // Products sync is optional, don't fail the whole request
      }
    }

    return NextResponse.json({
      success: true,
      synced: true,
      stats: {
        ccu: stats.currentPlayers,
        visits: stats.totalVisits,
        favorites: stats.favorites,
        likes: stats.likes,
        dislikes: stats.dislikes,
        likeRatio: stats.likeRatio,
        updatedAt: stats.lastFetched,
      },
      gameInfo: gameInfo ? {
        name: gameInfo.name,
        genre: gameInfo.genre,
        maxPlayers: gameInfo.maxPlayers,
      } : null,
      thumbnailUrl,
      productsCount: options.includeProducts ? productsCount : undefined,
    });
  } catch (error) {
    console.error("[v0] Error in sync-selected-game:", error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : "Internal server error",
        stats: null,
      },
      { status: 500 }
    );
  }
}
