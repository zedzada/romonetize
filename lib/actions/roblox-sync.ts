"use server";

import { createClient } from "@/lib/supabase/server";
import { 
  getUniverseIdFromPlaceId, 
  getRobloxGameStats, 
  getRobloxGameInfo,
  getRobloxGameThumbnail,
} from "@/lib/services/roblox-api";

export interface SyncResult {
  success: boolean;
  error?: string;
  data?: {
    universeId: string;
    name: string;
    currentPlayers: number;
    totalVisits: number;
    favorites: number;
    likes: number;
    dislikes: number;
    thumbnailUrl?: string;
  };
}

export async function syncRobloxData(gameId: string): Promise<SyncResult> {
  const supabase = await createClient();
  
  // Get current user
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  // Get the game
  const { data: game, error: gameError } = await supabase
    .from("games")
    .select("*")
    .eq("id", gameId)
    .eq("user_id", user.id)
    .single();

  if (gameError || !game) {
    return { success: false, error: "Game not found" };
  }

  // Update status to syncing
  await supabase
    .from("games")
    .update({ roblox_sync_status: "syncing" })
    .eq("id", gameId);

  try {
    // Get universe ID from place ID (roblox_game_id)
    const universeId = await getUniverseIdFromPlaceId(game.roblox_game_id);
    if (!universeId) {
      await supabase
        .from("games")
        .update({ roblox_sync_status: "error" })
        .eq("id", gameId);
      return { success: false, error: "Could not find Universe ID for this game. Make sure the Place ID is correct." };
    }

    // Fetch game stats (pass API key if available for enhanced access)
    const stats = await getRobloxGameStats(universeId, game.roblox_api_key);
    if (!stats) {
      await supabase
        .from("games")
        .update({ roblox_sync_status: "error" })
        .eq("id", gameId);
      return { success: false, error: "Could not fetch game stats from Roblox API" };
    }

    // Fetch game info
    const info = await getRobloxGameInfo(universeId);

    // Fetch thumbnail
    const thumbnailUrl = await getRobloxGameThumbnail(universeId);

    // Update game with Roblox data
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

    if (info) {
      updateData.creator_name = info.creator?.name;
      updateData.creator_type = info.creator?.type;
      updateData.description = info.description;
      updateData.max_players = info.maxPlayers;
      updateData.genre = info.genre;
    }

    if (thumbnailUrl) {
      updateData.thumbnail_url = thumbnailUrl;
    }

    const { error: updateError } = await supabase
      .from("games")
      .update(updateData)
      .eq("id", gameId);

    if (updateError) {
      await supabase
        .from("games")
        .update({ roblox_sync_status: "error" })
        .eq("id", gameId);
      return { success: false, error: "Failed to save Roblox data" };
    }

    // Also create a snapshot for historical tracking
    await supabase.from("game_snapshots").insert({
      game_id: gameId,
      current_players: stats.currentPlayers ?? 0,
      total_visits: stats.totalVisits ?? 0,
      favorites: stats.favorites ?? 0,
      likes: stats.likes ?? 0,
      dislikes: stats.dislikes ?? 0,
      snapshot_type: "roblox_sync",
    });

    return {
      success: true,
      data: {
        universeId,
        name: info?.name || game.name,
        currentPlayers: stats.currentPlayers ?? 0,
        totalVisits: stats.totalVisits ?? 0,
        favorites: stats.favorites ?? 0,
        likes: stats.likes ?? 0,
        dislikes: stats.dislikes ?? 0,
        thumbnailUrl,
      },
    };
  } catch (error) {
    console.error("Roblox sync error:", error);
    await supabase
      .from("games")
      .update({ roblox_sync_status: "error" })
      .eq("id", gameId);
    return { success: false, error: "An error occurred while syncing with Roblox" };
  }
}

export async function getRobloxSyncStatus(gameId: string): Promise<{
  status: string;
  lastSync: string | null;
  data: {
    universeId: string | null;
    currentPlayers: number;
    totalVisits: number;
    favorites: number;
    likes: number;
    dislikes: number;
    thumbnailUrl: string | null;
    creatorName: string | null;
    genre: string | null;
  } | null;
}> {
  const supabase = await createClient();
  
  const { data: game } = await supabase
    .from("games")
    .select("universe_id, current_players, total_visits, favorites, likes, dislikes, thumbnail_url, creator_name, genre, last_roblox_sync, roblox_sync_status")
    .eq("id", gameId)
    .single();

  if (!game) {
    return { status: "not_found", lastSync: null, data: null };
  }

  return {
    status: game.roblox_sync_status || "not_synced",
    lastSync: game.last_roblox_sync,
    data: game.universe_id ? {
      universeId: game.universe_id,
      currentPlayers: game.current_players ?? 0,
      totalVisits: game.total_visits ?? 0,
      favorites: game.favorites ?? 0,
      likes: game.likes ?? 0,
      dislikes: game.dislikes ?? 0,
      thumbnailUrl: game.thumbnail_url,
      creatorName: game.creator_name,
      genre: game.genre,
    } : null,
  };
}
