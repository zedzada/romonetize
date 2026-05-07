import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { roblox_game_id, source, groupId, groupName, roleName, roleRank, rootPlaceId } = body;

    if (!roblox_game_id) {
      return NextResponse.json(
        { error: "Missing required field: roblox_game_id" },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Build update object with only provided fields
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (source !== undefined) {
      updateData.source = source === "group" ? "group" : "user";
    }
    if (groupId !== undefined) {
      updateData.group_id = groupId ? String(groupId) : null;
    }
    if (groupName !== undefined) {
      updateData.group_name = groupName || null;
    }
    if (rootPlaceId !== undefined) {
      updateData.root_place_id = rootPlaceId ? String(rootPlaceId) : null;
    }
    if (roleName !== undefined) {
      updateData.role_name = roleName || null;
    }
    if (roleRank !== undefined) {
      updateData.role_rank = roleRank !== null ? Number(roleRank) : null;
    }

    // Update the game matching user_id and roblox_game_id
    const { data: updatedGame, error: updateError } = await supabase
      .from("games")
      .update(updateData)
      .eq("user_id", user.id)
      .eq("roblox_game_id", String(roblox_game_id))
      .select("*")
      .single();

    if (updateError) {
      console.error("[API] sync-game-metadata error:", updateError);
      return NextResponse.json(
        { error: `Failed to sync metadata: ${updateError.message}` },
        { status: 500 }
      );
    }

    if (!updatedGame) {
      return NextResponse.json(
        { error: "Game not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      game: updatedGame,
    });
  } catch (error) {
    console.error("[API] sync-game-metadata unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
