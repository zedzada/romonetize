"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { getPlanById, PRICING_PLANS } from "@/lib/products";

export interface Game {
  id: string;
  user_id: string;
  roblox_game_id: string;
  name: string;
  api_key: string;
  status: "active" | "paused" | "deleted";
  created_at: string;
  updated_at: string;
  last_event_at: string | null;
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
  thumbnail_url?: string | null;
  last_roblox_sync?: string | null;
  roblox_sync_status?: string | null;
  roblox_api_key?: string | null;
}

export interface GameStats {
  totalEvents: number;
  totalRevenue: number;
  totalProducts: number;
  last24hEvents: number;
}

// Generate a secure API key
function generateApiKey(): string {
  return `rm_${randomBytes(24).toString("hex")}`;
}

// Get all games for the current user
export async function getUserGames(): Promise<{ games: Game[]; error: string | null }> {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    return { games: [], error: "Not authenticated" };
  }

  const { data: games, error } = await supabase
    .from("games")
    .select("*")
    .eq("user_id", user.id)
    .neq("status", "deleted")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching games:", error);
    return { games: [], error: error.message };
  }

  return { games: games || [], error: null };
}

// Get a single game by ID
export async function getGame(gameId: string): Promise<{ game: Game | null; error: string | null }> {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    return { game: null, error: "Not authenticated" };
  }

  const { data: game, error } = await supabase
    .from("games")
    .select("*")
    .eq("id", gameId)
    .eq("user_id", user.id)
    .single();

  if (error) {
    return { game: null, error: error.message };
  }

  return { game, error: null };
}

// Create a new game
export async function createGame(
  robloxGameId: string,
  name: string
): Promise<{ game: Game | null; error: string | null }> {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    return { game: null, error: "Not authenticated" };
  }

  // Check if game already exists for this user
  const { data: existingGame } = await supabase
    .from("games")
    .select("id")
    .eq("user_id", user.id)
    .eq("roblox_game_id", robloxGameId)
    .single();

  if (existingGame) {
    return { game: null, error: "This game is already connected to your account." };
  }

  // Check plan limits for game connections
  const { data: profile } = await supabase
    .from("profiles")
    .select("plan")
    .eq("id", user.id)
    .single();

  const userPlan = getPlanById(profile?.plan || "free") || PRICING_PLANS[0];
  
  // Count existing active games
  const { count: gameCount } = await supabase
    .from("games")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .neq("status", "deleted");

  // Check if user has reached their game limit (-1 means unlimited)
  if (userPlan.limits.games !== -1 && (gameCount || 0) >= userPlan.limits.games) {
    return { 
      game: null, 
      error: `You've reached your ${userPlan.name} plan limit of ${userPlan.limits.games} game${userPlan.limits.games !== 1 ? "s" : ""}. Upgrade your plan at /dashboard/billing to add more games.` 
    };
  }

  const apiKey = generateApiKey();

  const { data: game, error } = await supabase
    .from("games")
    .insert({
      user_id: user.id,
      roblox_game_id: robloxGameId,
      name,
      api_key: apiKey,
    })
    .select()
    .single();

  if (error) {
    console.error("Error creating game:", error);
    return { game: null, error: error.message };
  }

  revalidatePath("/dashboard/game");
  revalidatePath("/dashboard");
  
  return { game, error: null };
}

// Update a game
export async function updateGame(
  gameId: string,
  updates: { name?: string; status?: "active" | "paused" }
): Promise<{ success: boolean; error: string | null }> {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  const { error } = await supabase
    .from("games")
    .update(updates)
    .eq("id", gameId)
    .eq("user_id", user.id);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/dashboard/game");
  revalidatePath("/dashboard");
  
  return { success: true, error: null };
}

// Regenerate API key for a game
export async function regenerateApiKey(
  gameId: string
): Promise<{ apiKey: string | null; error: string | null }> {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    return { apiKey: null, error: "Not authenticated" };
  }

  const newApiKey = generateApiKey();

  const { error } = await supabase
    .from("games")
    .update({ api_key: newApiKey })
    .eq("id", gameId)
    .eq("user_id", user.id);

  if (error) {
    return { apiKey: null, error: error.message };
  }

  revalidatePath("/dashboard/game");
  
  return { apiKey: newApiKey, error: null };
}

// Delete a game (soft delete)
export async function deleteGame(
  gameId: string
): Promise<{ success: boolean; error: string | null }> {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  const { error } = await supabase
    .from("games")
    .update({ status: "deleted" })
    .eq("id", gameId)
    .eq("user_id", user.id);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/dashboard/game");
  revalidatePath("/dashboard");
  
  return { success: true, error: null };
}

// Update Roblox Open Cloud API key for a game
// Returns validation result with connection status
export async function updateRobloxApiKey(
  gameId: string,
  robloxApiKey: string | null
): Promise<{ 
  success: boolean; 
  error: string | null;
  connected?: boolean;
  validationError?: string;
}> {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  // If clearing the key, just update and return
  if (!robloxApiKey || robloxApiKey.trim() === "") {
    const { error } = await supabase
      .from("games")
      .update({ roblox_api_key: null, roblox_sync_status: "not_synced" })
      .eq("id", gameId)
      .eq("user_id", user.id);

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath("/dashboard/game");
    return { success: true, error: null, connected: false };
  }

  // Save the API key first
  const { error } = await supabase
    .from("games")
    .update({ roblox_api_key: robloxApiKey.trim() })
    .eq("id", gameId)
    .eq("user_id", user.id);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/dashboard/game");
  
  // Key saved - validation will happen via API call from frontend
  return { success: true, error: null, connected: true };
}

// Get the currently selected game (is_selected = true)
// If no game is selected but user has games, auto-select the first one
export async function getSelectedGame(): Promise<{ game: Game | null; error: string | null }> {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    return { game: null, error: "Not authenticated" };
  }

  // Try to get the selected game
  const { data: selectedGame } = await supabase
    .from("games")
    .select("*")
    .eq("user_id", user.id)
    .eq("is_selected", true)
    .neq("status", "deleted")
    .single();

  if (selectedGame) {
    return { game: selectedGame, error: null };
  }

  // No selected game - auto-select the first active game
  const { data: firstGame, error: firstError } = await supabase
    .from("games")
    .select("*")
    .eq("user_id", user.id)
    .neq("status", "deleted")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (firstError || !firstGame) {
    return { game: null, error: null }; // No games at all
  }

  // Auto-select this game
  await supabase
    .from("games")
    .update({ is_selected: true })
    .eq("id", firstGame.id);

  return { game: { ...firstGame, is_selected: true }, error: null };
}

// Select a game (set is_selected = true and deselect others)
export async function selectGame(gameId: string): Promise<{ success: boolean; error: string | null }> {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  // Verify ownership
  const { data: game } = await supabase
    .from("games")
    .select("id")
    .eq("id", gameId)
    .eq("user_id", user.id)
    .single();

  if (!game) {
    return { success: false, error: "Game not found" };
  }

  // Deselect all games first
  await supabase
    .from("games")
    .update({ is_selected: false })
    .eq("user_id", user.id);

  // Select the target game
  const { error } = await supabase
    .from("games")
    .update({ is_selected: true })
    .eq("id", gameId);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/game");
  revalidatePath("/dashboard/performance");
  revalidatePath("/dashboard/monetization");
  revalidatePath("/dashboard/products");
  revalidatePath("/dashboard/ai");
  
  return { success: true, error: null };
}

// Get selected game's API key (for test events) - uses is_selected = true game
export async function getFirstGameApiKey(): Promise<{ 
  apiKey: string | null; 
  gameId: string | null;
  gameName: string | null;
  error: string | null 
}> {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    return { apiKey: null, gameId: null, gameName: null, error: "Not authenticated" };
  }

  // First try to get the selected game
  const { data: selectedGame } = await supabase
    .from("games")
    .select("id, name, api_key")
    .eq("user_id", user.id)
    .eq("is_selected", true)
    .neq("status", "deleted")
    .single();

  if (selectedGame) {
    return { 
      apiKey: selectedGame.api_key, 
      gameId: selectedGame.id, 
      gameName: selectedGame.name,
      error: null 
    };
  }

  // Fallback: auto-select the first active game
  const { data: game, error } = await supabase
    .from("games")
    .select("id, name, api_key")
    .eq("user_id", user.id)
    .neq("status", "deleted")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error) {
    return { apiKey: null, gameId: null, gameName: null, error: error.message };
  }

  if (!game) {
    return { apiKey: null, gameId: null, gameName: null, error: "No game found" };
  }

  // Auto-select this game
  await supabase
    .from("games")
    .update({ is_selected: true })
    .eq("id", game.id);

  return { 
    apiKey: game.api_key, 
    gameId: game.id, 
    gameName: game.name,
    error: null 
  };
}

// Get game statistics
export async function getGameStats(
  gameId: string
): Promise<{ stats: GameStats | null; error: string | null }> {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    return { stats: null, error: "Not authenticated" };
  }

  // Verify ownership
  const { data: game } = await supabase
    .from("games")
    .select("id")
    .eq("id", gameId)
    .eq("user_id", user.id)
    .single();

  if (!game) {
    return { stats: null, error: "Game not found" };
  }

  // Get total events count
  const { count: totalEvents } = await supabase
    .from("events")
    .select("*", { count: "exact", head: true })
    .eq("game_id", gameId);

  // Get total revenue from purchase_success events
  const { data: revenueData } = await supabase
    .from("events")
    .select("robux")
    .eq("game_id", gameId)
    .eq("event_type", "purchase_success");

  const totalRevenue = revenueData?.reduce((sum, e) => sum + (e.robux || 0), 0) || 0;

  // Get total products count
  const { count: totalProducts } = await supabase
    .from("products")
    .select("*", { count: "exact", head: true })
    .eq("game_id", gameId);

  // Get last 24h events
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: last24hEvents } = await supabase
    .from("events")
    .select("*", { count: "exact", head: true })
    .eq("game_id", gameId)
    .gte("created_at", oneDayAgo);

  return {
    stats: {
      totalEvents: totalEvents || 0,
      totalRevenue,
      totalProducts: totalProducts || 0,
      last24hEvents: last24hEvents || 0,
    },
    error: null,
  };
}
