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

    // Get universe ID (either from DB or by looking it up)
    let universeId = game.universe_id;
    
    if (!universeId && game.roblox_game_id) {
      universeId = await getUniverseIdFromPlaceId(game.roblox_game_id);
      
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

    // Fetch stats from Roblox API (with API key if available)
    const [stats, gameInfo, thumbnailUrl] = await Promise.all([
      getRobloxGameStats(universeId, game.roblox_api_key),
      getRobloxGameInfo(universeId),
      getRobloxGameThumbnail(universeId),
    ]);

    if (stats.source === "not_available") {
      return NextResponse.json<RobloxStatsResponse>(
        { success: false, error: "Could not fetch data from Roblox API", errorCode: "ROBLOX_API_ERROR" },
        { status: 502 }
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
      thumbnail_url: thumbnailUrl,
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
