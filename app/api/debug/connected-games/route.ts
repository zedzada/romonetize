import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { getSelectedGameForUser, getAllGamesForUser } from "@/lib/server/selected-game";

export async function GET() {
  const supabase = await createClient();
  
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  
  if (!user) {
    return NextResponse.json({
      success: false,
      error: "Not authenticated",
      authError: authError?.message ?? null,
    }, { status: 401 });
  }

  // 1. Get selected game using the same helper as dashboard header
  const selectedResult = await getSelectedGameForUser(user.id, supabase);
  
  // 2. Get all games using the same helper
  const allGamesResult = await getAllGamesForUser(user.id, supabase);
  
  // 3. Direct query (same as My Game page uses) for comparison
  const { data: directQueryGames, error: directQueryError } = await supabase
    .from("games")
    .select("id, roblox_game_id, name, api_key, is_selected, source, group_id, group_name, root_place_id, role_name, role_rank, thumbnail_url, status")
    .eq("user_id", user.id)
    .neq("status", "deleted")
    .order("created_at", { ascending: false });

  // 4. RLS test - try selecting without user_id filter
  const { data: rlsTestData, error: rlsTestError } = await supabase
    .from("games")
    .select("id, user_id, name")
    .limit(5);

  return NextResponse.json({
    success: true,
    userId: user.id,
    userEmail: user.email,
    selectedGameFromHelper: selectedResult.game ? {
      id: selectedResult.game.id,
      name: selectedResult.game.name,
      roblox_game_id: selectedResult.game.roblox_game_id,
      is_selected: selectedResult.game.is_selected,
    } : null,
    selectedGameError: selectedResult.error,
    gamesFromHelper: allGamesResult.games,
    gamesFromHelperCount: allGamesResult.games.length,
    gamesFromHelperError: allGamesResult.error,
    gamesFromDirectQuery: directQueryGames?.map(g => ({
      id: g.id,
      name: g.name,
      roblox_game_id: g.roblox_game_id,
      is_selected: g.is_selected,
      status: g.status,
    })) ?? [],
    gamesFromDirectQueryCount: directQueryGames?.length ?? 0,
    directQueryError: directQueryError?.message ?? null,
    rlsTest: {
      gamesFound: rlsTestData?.length ?? 0,
      userIdMatches: rlsTestData?.filter(g => g.user_id === user.id).length ?? 0,
      error: rlsTestError?.message ?? null,
    },
  });
}
