import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import crypto from "crypto";

function generateApiKey(): string {
  return `rm_${crypto.randomBytes(24).toString("hex")}`;
}

export async function POST(request: NextRequest) {
  try {
    // Parse request body
    const body = await request.json();
    const { roblox_game_id, name } = body;

    // Validate required fields
    if (!roblox_game_id || !name) {
      return NextResponse.json(
        { error: "Missing required fields: roblox_game_id, name" },
        { status: 400 }
      );
    }

    // Get authenticated user
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // First, deselect all current games for this user
    await supabase
      .from("games")
      .update({ is_selected: false })
      .eq("user_id", user.id);

    // Check if this game already exists for this user
    const { data: existingGame, error: existingError } = await supabase
      .from("games")
      .select("*")
      .eq("user_id", user.id)
      .eq("roblox_game_id", String(roblox_game_id))
      .single();

    if (existingGame) {
      // Game exists - just select it
      const { data: updatedGame, error: updateError } = await supabase
        .from("games")
        .update({ 
          is_selected: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingGame.id)
        .select("*")
        .single();

      if (updateError) {
        console.error("[API] Error selecting game:", updateError);
        return NextResponse.json(
          { error: "Failed to select game" },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        game: updatedGame,
        message: `Selected ${name}`,
        action: "selected",
      });
    }

    // Game doesn't exist - create new entry with is_selected = true
    const apiKey = generateApiKey();

    const { data: newGame, error: insertError } = await supabase
      .from("games")
      .insert({
        user_id: user.id,
        roblox_game_id: String(roblox_game_id),
        name: name.trim(),
        api_key: apiKey,
        status: "active",
        is_selected: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select("*")
      .single();

    if (insertError) {
      console.error("[API] Error creating game:", insertError);
      return NextResponse.json(
        { error: "Failed to create game" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      game: newGame,
      message: `Selected ${name}`,
      action: "created",
    });
  } catch (error) {
    console.error("[API] /api/roblox/select-game error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
