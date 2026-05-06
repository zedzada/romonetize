import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface RobloxGame {
  id: number;
  name: string;
  rootPlaceId: number;
}

interface RobloxGamesResponse {
  data: RobloxGame[];
  nextPageCursor?: string;
}

export async function GET() {
  try {
    // Get authenticated user
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Get user's roblox_user_id from profiles
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("roblox_user_id")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json(
        { error: "Profile not found" },
        { status: 404 }
      );
    }

    if (!profile.roblox_user_id) {
      return NextResponse.json(
        { error: "Roblox account not connected. Please connect your Roblox account in Settings." },
        { status: 400 }
      );
    }

    // Fetch games from Roblox API
    const robloxResponse = await fetch(
      `https://games.roblox.com/v2/users/${profile.roblox_user_id}/games?accessFilter=Public&limit=50`,
      {
        headers: {
          "Accept": "application/json",
        },
        next: { revalidate: 60 }, // Cache for 1 minute
      }
    );

    if (!robloxResponse.ok) {
      const errorText = await robloxResponse.text();
      console.error("[Roblox API Error]", robloxResponse.status, errorText);
      return NextResponse.json(
        { error: "Failed to fetch games from Roblox" },
        { status: 502 }
      );
    }

    const robloxData: RobloxGamesResponse = await robloxResponse.json();

    // Return simplified game data
    const games = (robloxData.data || []).map((game) => ({
      id: game.id,
      name: game.name,
      rootPlaceId: game.rootPlaceId,
    }));

    return NextResponse.json({ games });
  } catch (error) {
    console.error("[API] /api/roblox/games error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
