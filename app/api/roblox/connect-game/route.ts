import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPlanLimits } from "@/lib/products";
import crypto from "crypto";

// Plan game limits
const PLAN_GAME_LIMITS: Record<string, number> = {
  free: 1,
  pro: 5,
  studio: 25,
};

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

    // Get user's profile for plan info
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("plan, roblox_user_id")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json(
        { error: "Profile not found" },
        { status: 404 }
      );
    }

    // Get plan limit
    const plan = profile.plan || "free";
    const gameLimit = PLAN_GAME_LIMITS[plan] || PLAN_GAME_LIMITS.free;

    // Count existing games for user
    const { count: existingGamesCount, error: countError } = await supabase
      .from("games")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id);

    if (countError) {
      console.error("[API] Error counting games:", countError);
      return NextResponse.json(
        { error: "Failed to check game count" },
        { status: 500 }
      );
    }

    // Check plan limit
    if ((existingGamesCount || 0) >= gameLimit) {
      return NextResponse.json(
        { 
          error: "Plan limit reached",
          message: `Your ${plan} plan allows ${gameLimit} game(s). Please upgrade to add more games.`,
          currentCount: existingGamesCount,
          limit: gameLimit,
        },
        { status: 403 }
      );
    }

    // Check for duplicate (same roblox_game_id for same user)
    const { data: existingGame, error: duplicateError } = await supabase
      .from("games")
      .select("id")
      .eq("user_id", user.id)
      .eq("roblox_game_id", String(roblox_game_id))
      .single();

    if (existingGame) {
      return NextResponse.json(
        { error: "This game is already connected to your account" },
        { status: 409 }
      );
    }

    // Generate API key for the game
    const apiKey = generateApiKey();

    // Insert new game
    const { data: newGame, error: insertError } = await supabase
      .from("games")
      .insert({
        user_id: user.id,
        roblox_game_id: String(roblox_game_id),
        name: name.trim(),
        api_key: apiKey,
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select("id, name, api_key, roblox_game_id")
      .single();

    if (insertError) {
      console.error("[API] Error inserting game:", insertError);
      return NextResponse.json(
        { error: "Failed to connect game" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      game: newGame,
      message: `Successfully connected ${name}`,
    });
  } catch (error) {
    console.error("[API] /api/roblox/connect-game error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
