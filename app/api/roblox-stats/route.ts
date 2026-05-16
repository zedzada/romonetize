import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { 
  getRobloxGameStats, 
  getUniverseIdFromPlaceId,
  getRobloxGameInfo,
  getRobloxGameThumbnail 
} from "@/lib/services/roblox-api";

export interface RobloxStatsResponse {
  success: boolean;
  data?: {
    universeId: string;
    currentPlayers: number;
    totalVisits: number;
    favorites: number;
    likes: number;
    dislikes: number;
    likeRatio: number | null;
    name: string;
    description: string;
    genre: string;
    maxPlayers: number;
    thumbnailUrl: string | null;
    createdAt: string | null;
    lastFetched: string;
  };
  error?: string;
  errorCode?: string;
}

// Test if an API key is valid by making a simple request
async function testRobloxApiKey(apiKey: string, universeId: string): Promise<{ valid: boolean; error?: string }> {
  try {
    // Try to fetch game stats with the API key
    const response = await fetch(
      `https://games.roblox.com/v1/games?universeIds=${universeId}`,
      {
        headers: {
          "Accept": "application/json",
          "x-api-key": apiKey,
        },
        cache: "no-store",
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      
      if (response.status === 401) {
        return { valid: false, error: "Invalid API key - authentication failed" };
      }
      if (response.status === 403) {
        return { valid: false, error: "API key does not have permission for this universe" };
      }
      if (response.status === 429) {
        return { valid: false, error: "Rate limited - too many requests" };
      }
      
      return { valid: false, error: `Roblox API error (${response.status}): ${errorText}` };
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, error: `Connection error: ${error instanceof Error ? error.message : "Unknown error"}` };
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const gameId = searchParams.get("gameId");
  const testKey = searchParams.get("testKey") === "true";

  if (!gameId) {
    return NextResponse.json<RobloxStatsResponse>(
      { success: false, error: "Missing gameId parameter", errorCode: "MISSING_GAME_ID" },
      { status: 400 }
    );
  }

  try {
    const supabase = await createClient();

    // Verify user is authenticated
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json<RobloxStatsResponse>(
        { success: false, error: "Not authenticated", errorCode: "UNAUTHORIZED" },
        { status: 401 }
      );
    }

    // Fetch the game from database
    const { data: game, error: gameError } = await supabase
      .from("games")
      .select("*")
      .eq("id", gameId)
      .eq("user_id", user.id)
      .single();

    if (gameError || !game) {
      return NextResponse.json<RobloxStatsResponse>(
        { success: false, error: "Game not found", errorCode: "GAME_NOT_FOUND" },
        { status: 404 }
      );
    }

    // Get universe ID
    // roblox_game_id IS the universe ID (stored from Roblox games API)
    // Priority: universe_id > roblox_game_id > lookup from root_place_id
    let universeId = game.universe_id || game.roblox_game_id;
    
    if (!universeId && game.root_place_id) {
      universeId = await getUniverseIdFromPlaceId(game.root_place_id);
      
      // Save the universe ID for future use
      if (universeId) {
        await supabase
          .from("games")
          .update({ universe_id: universeId })
          .eq("id", gameId);
      }
    }

    if (!universeId) {
      return NextResponse.json<RobloxStatsResponse>(
        { success: false, error: "Could not determine universe ID. Please check your Roblox game ID.", errorCode: "NO_UNIVERSE_ID" },
        { status: 400 }
      );
    }

    // If this is a key test request, validate the API key
    if (testKey && game.roblox_api_key) {
      const keyTest = await testRobloxApiKey(game.roblox_api_key, universeId);
      if (!keyTest.valid) {
        return NextResponse.json<RobloxStatsResponse>(
          { success: false, error: keyTest.error, errorCode: "INVALID_API_KEY" },
          { status: 400 }
        );
      }
    }

    // First, try to get data from roblox_game_syncs (most reliable, from manual sync)
    const { data: latestSync } = await supabase
      .from("roblox_game_syncs")
      .select("ccu, visits, favorites, likes, dislikes, synced_at, name, description, genre, max_players, icon_url")
      .eq("game_id", gameId)
      .order("synced_at", { ascending: false })
      .limit(1)
      .single();

    // If we have recent synced data (within last hour), use it directly
    const syncedRecently = latestSync && 
      (Date.now() - new Date(latestSync.synced_at).getTime() < 60 * 60 * 1000);

    if (syncedRecently && latestSync) {
      const totalVotes = (latestSync.likes || 0) + (latestSync.dislikes || 0);
      const likeRatio = totalVotes > 0 ? (latestSync.likes || 0) / totalVotes : null;

      return NextResponse.json<RobloxStatsResponse>({
        success: true,
        data: {
          universeId,
          currentPlayers: latestSync.ccu ?? 0,
          totalVisits: latestSync.visits ?? 0,
          favorites: latestSync.favorites ?? 0,
          likes: latestSync.likes ?? 0,
          dislikes: latestSync.dislikes ?? 0,
          likeRatio,
          name: latestSync.name || game.name,
          description: latestSync.description || "",
          genre: latestSync.genre || "Unknown",
          maxPlayers: latestSync.max_players || 0,
          thumbnailUrl: latestSync.icon_url || game.icon_url,
          createdAt: game.created_at,
          lastFetched: latestSync.synced_at,
        },
      });
    }

    // Try live API fetch
    const [stats, gameInfo, thumbnailUrl] = await Promise.all([
      getRobloxGameStats(universeId, game.roblox_api_key),
      getRobloxGameInfo(universeId),
      getRobloxGameThumbnail(universeId),
    ]);

    // If live API fails, fall back to any stored data
    if (stats.source === "not_available") {
      // Check if we have ANY synced data (even if older)
      if (latestSync) {
        const totalVotes = (latestSync.likes || 0) + (latestSync.dislikes || 0);
        const likeRatio = totalVotes > 0 ? (latestSync.likes || 0) / totalVotes : null;

        return NextResponse.json<RobloxStatsResponse>({
          success: true,
          data: {
            universeId,
            currentPlayers: latestSync.ccu ?? 0,
            totalVisits: latestSync.visits ?? 0,
            favorites: latestSync.favorites ?? 0,
            likes: latestSync.likes ?? 0,
            dislikes: latestSync.dislikes ?? 0,
            likeRatio,
            name: latestSync.name || game.name,
            description: latestSync.description || "",
            genre: latestSync.genre || "Unknown",
            maxPlayers: latestSync.max_players || 0,
            thumbnailUrl: latestSync.icon_url || game.icon_url,
            createdAt: game.created_at,
            lastFetched: latestSync.synced_at,
          },
        });
      }
      
      // Check if we have data in games table
      if (game.last_roblox_sync && game.total_visits !== null) {
        const totalVotes = (game.likes || 0) + (game.dislikes || 0);
        const likeRatio = totalVotes > 0 ? (game.likes || 0) / totalVotes : null;

        return NextResponse.json<RobloxStatsResponse>({
          success: true,
          data: {
            universeId,
            currentPlayers: game.current_players ?? 0,
            totalVisits: game.total_visits ?? 0,
            favorites: game.favorites ?? 0,
            likes: game.likes ?? 0,
            dislikes: game.dislikes ?? 0,
            likeRatio,
            name: game.name,
            description: game.description || "",
            genre: game.genre || "Unknown",
            maxPlayers: game.max_players || 0,
            thumbnailUrl: game.icon_url,
            createdAt: game.created_at,
            lastFetched: game.last_roblox_sync,
          },
        });
      }

      // No stored data at all
      return NextResponse.json<RobloxStatsResponse>(
        { success: false, error: "No Roblox data available. Click 'Sync Roblox Stats' to fetch data.", errorCode: "NO_DATA" },
        { status: 404 }
      );
    }

    // Update game record with latest stats
    const updateData = {
      universe_id: universeId,
      current_players: stats.currentPlayers ?? 0,
      total_visits: stats.totalVisits ?? 0,
      favorites: stats.favorites ?? 0,
      likes: stats.likes ?? 0,
      dislikes: stats.dislikes ?? 0,
      icon_url: thumbnailUrl,
      last_roblox_sync: new Date().toISOString(),
      roblox_sync_status: "synced",
      ...(gameInfo && {
        name: gameInfo.name || game.name,
        description: gameInfo.description,
        genre: gameInfo.genre,
        max_players: gameInfo.maxPlayers,
        creator_name: gameInfo.creator?.name,
        creator_type: gameInfo.creator?.type,
      }),
    };

    await supabase
      .from("games")
      .update(updateData)
      .eq("id", gameId);

    // Save snapshot for historical tracking
    const today = new Date().toISOString().split("T")[0];
    
    // Check if we already have a snapshot for today
    const { data: existingSnapshot } = await supabase
      .from("game_snapshots")
      .select("id")
      .eq("game_id", gameId)
      .eq("snapshot_date", today)
      .single();

    if (!existingSnapshot) {
      // Create new snapshot
      await supabase.from("game_snapshots").insert({
        game_id: gameId,
        snapshot_date: today,
        visits: stats.totalVisits ?? 0,
        unique_players: stats.currentPlayers ?? 0,
      });
    } else {
      // Update existing snapshot
      await supabase
        .from("game_snapshots")
        .update({
          visits: stats.totalVisits ?? 0,
          unique_players: stats.currentPlayers ?? 0,
        })
        .eq("id", existingSnapshot.id);
    }

    return NextResponse.json<RobloxStatsResponse>({
      success: true,
      data: {
        universeId,
        currentPlayers: stats.currentPlayers ?? 0,
        totalVisits: stats.totalVisits ?? 0,
        favorites: stats.favorites ?? 0,
        likes: stats.likes ?? 0,
        dislikes: stats.dislikes ?? 0,
        likeRatio: stats.likeRatio,
        name: gameInfo?.name || game.name,
        description: gameInfo?.description || "",
        genre: gameInfo?.genre || "Unknown",
        maxPlayers: gameInfo?.maxPlayers || 0,
        thumbnailUrl,
        createdAt: game.created_at,
        lastFetched: stats.lastFetched || new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("[v0] Error in roblox-stats API:", error);
    return NextResponse.json<RobloxStatsResponse>(
      { success: false, error: "Internal server error", errorCode: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
