/**
 * Pure server utility functions for selected game logic.
 * 
 * NO "use server" directive - these are plain functions that can be
 * called from API routes, server components, or server actions.
 * 
 * This is the single source of truth for selected game logic.
 */

import { SupabaseClient } from "@supabase/supabase-js";

export interface GameRecord {
  id: string;
  user_id: string;
  roblox_game_id: string;
  name: string;
  api_key: string;
  status: "active" | "paused" | "deleted";
  created_at: string;
  updated_at: string;
  last_event_at: string | null;
  is_selected?: boolean;
  // Source metadata
  source?: "user" | "group" | null;
  group_id?: string | null;
  group_name?: string | null;
  role_name?: string | null;
  root_place_id?: string | null;
  // Roblox API data
  universe_id?: string | null;
  creator_name?: string | null;
  creator_type?: string | null;
  description?: string | null;
  max_players?: number | null;
  genre?: string | null;
  total_visits?: number | null;
  favorites?: number | null;
  likes?: number | null;
  dislikes?: number | null;
  current_players?: number | null;
  icon_url?: string | null;
  last_roblox_sync?: string | null;
  roblox_sync_status?: string | null;
  roblox_api_key?: string | null;
}

export interface GameSummary {
  id: string;
  name: string;
  roblox_game_id: string;
  status: string;
  is_selected: boolean | null;
  source: string | null;
  group_name: string | null;
}

/**
 * Get selected game for a user ID.
 * If no game is selected, auto-selects the most recently updated game.
 * 
 * @param userId - The user's ID
 * @param supabase - Supabase client instance
 * @returns The selected game or null if user has no games
 */
export async function getSelectedGameForUser(
  userId: string,
  supabase: SupabaseClient
): Promise<{ game: GameRecord | null; error: string | null }> {
  try {
    // Try to get the selected game
    const { data: selectedGame, error: selectedError } = await supabase
      .from("games")
      .select("*")
      .eq("user_id", userId)
      .eq("is_selected", true)
      .neq("status", "deleted")
      .single();

    if (selectedGame && !selectedError) {
      return { game: selectedGame as GameRecord, error: null };
    }

    // No selected game - auto-select the first active game
    const { data: firstGame, error: firstError } = await supabase
      .from("games")
      .select("*")
      .eq("user_id", userId)
      .neq("status", "deleted")
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();

    if (firstError || !firstGame) {
      return { game: null, error: null }; // No games at all
    }

    // Auto-select: deselect all first, then select this one
    await supabase
      .from("games")
      .update({ is_selected: false })
      .eq("user_id", userId);

    await supabase
      .from("games")
      .update({ is_selected: true })
      .eq("id", firstGame.id);

    return { game: { ...firstGame, is_selected: true } as GameRecord, error: null };
  } catch (err) {
    return { 
      game: null, 
      error: err instanceof Error ? err.message : "Unknown error in getSelectedGameForUser" 
    };
  }
}

/**
 * Get all games for a user (for debug/listing purposes).
 * 
 * @param userId - The user's ID
 * @param supabase - Supabase client instance
 * @returns Array of game summaries
 */
export async function getAllGamesForUser(
  userId: string,
  supabase: SupabaseClient
): Promise<{ games: GameSummary[]; error: string | null }> {
  try {
    const { data: games, error } = await supabase
      .from("games")
      .select("id, name, roblox_game_id, status, is_selected, source, group_name")
      .eq("user_id", userId)
      .neq("status", "deleted")
      .order("updated_at", { ascending: false });

    if (error) {
      return { games: [], error: error.message };
    }

    return { games: (games || []) as GameSummary[], error: null };
  } catch (err) {
    return { 
      games: [], 
      error: err instanceof Error ? err.message : "Unknown error in getAllGamesForUser" 
    };
  }
}
