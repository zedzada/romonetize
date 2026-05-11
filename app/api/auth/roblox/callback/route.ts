import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const ROBLOX_CLIENT_ID = "6125409488143470452";
const ROBLOX_CLIENT_SECRET = process.env.ROBLOX_CLIENT_SECRET;
const REDIRECT_URI = "https://www.romonetize.com/api/auth/roblox/callback";

interface RobloxTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

interface RobloxUserInfo {
  sub: string; // Roblox user ID
  name?: string;
  nickname?: string;
  preferred_username?: string;
  profile?: string;
  picture?: string;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  // Handle OAuth errors
  if (error) {
    console.error("[v0] Roblox OAuth error:", error, errorDescription);
    return NextResponse.redirect(
      new URL(`/dashboard/settings?error=${encodeURIComponent(errorDescription || error)}`, request.url)
    );
  }

  // Validate required parameters
  if (!code || !state) {
    return NextResponse.redirect(
      new URL("/dashboard/settings?error=Missing+authorization+code+or+state", request.url)
    );
  }

  // Get stored state and code verifier from cookies
  const storedState = request.cookies.get("roblox_state")?.value;
  const codeVerifier = request.cookies.get("roblox_code_verifier")?.value;

  // Validate state to prevent CSRF
  if (!storedState || state !== storedState) {
    return NextResponse.redirect(
      new URL("/dashboard/settings?error=Invalid+state+parameter", request.url)
    );
  }

  if (!codeVerifier) {
    return NextResponse.redirect(
      new URL("/dashboard/settings?error=Missing+code+verifier", request.url)
    );
  }

  // Get the current authenticated user from Supabase
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.redirect(
      new URL("/dashboard/settings?error=Please+sign+in+first", request.url)
    );
  }

  try {
    // Exchange code for access token
    const tokenResponse = await fetch("https://apis.roblox.com/oauth/v1/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: ROBLOX_CLIENT_ID,
        client_secret: ROBLOX_CLIENT_SECRET || "",
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("[v0] Roblox token exchange failed:", errorText);
      return NextResponse.redirect(
        new URL("/dashboard/settings?error=Failed+to+exchange+authorization+code", request.url)
      );
    }

    const tokenData: RobloxTokenResponse = await tokenResponse.json();

    // Fetch user info from Roblox
    const userInfoResponse = await fetch("https://apis.roblox.com/oauth/v1/userinfo", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });

    if (!userInfoResponse.ok) {
      console.error("[v0] Failed to fetch Roblox user info");
      return NextResponse.redirect(
        new URL("/dashboard/settings?error=Failed+to+fetch+Roblox+user+info", request.url)
      );
    }

    const userInfo: RobloxUserInfo = await userInfoResponse.json();
    const robloxUserId = userInfo.sub;
    const robloxUsername = userInfo.preferred_username || userInfo.nickname || userInfo.name || `User${robloxUserId}`;

    // Calculate token expiration
    const tokenExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    // Update the user's profile with Roblox data
    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        roblox_user_id: robloxUserId,
        roblox_username: robloxUsername,
        roblox_access_token: tokenData.access_token,
        roblox_refresh_token: tokenData.refresh_token,
        roblox_token_expires_at: tokenExpiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    if (updateError) {
      console.error("[v0] Failed to update profile with Roblox data:", updateError);
      return NextResponse.redirect(
        new URL("/dashboard/settings?error=Failed+to+save+Roblox+account", request.url)
      );
    }

    // Fetch user's universes and update games
    await updateUserGames(supabase, user.id, tokenData.access_token);

    // Clear the OAuth cookies and redirect to game page with success
    const response = NextResponse.redirect(
      new URL("/dashboard/game?roblox=connected", request.url)
    );
    
    response.cookies.delete("roblox_state");
    response.cookies.delete("roblox_code_verifier");

    return response;
  } catch (err) {
    console.error("[v0] Roblox OAuth callback error:", err);
    return NextResponse.redirect(
      new URL("/dashboard/settings?error=An+unexpected+error+occurred", request.url)
    );
  }
}

async function updateUserGames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  accessToken: string
) {
  try {
    // Fetch user's universes from Roblox
    // First, get the user's created experiences
    const universesResponse = await fetch(
      "https://apis.roblox.com/cloud/v2/users/me/universes?maxPageSize=100",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!universesResponse.ok) {
      console.error("[v0] Failed to fetch Roblox universes:", await universesResponse.text());
      return;
    }

    const universesData = await universesResponse.json();
    const universes = universesData.universes || [];

    // Get all user's games from our database
    const { data: games, error: gamesError } = await supabase
      .from("games")
      .select("id, roblox_game_id, name")
      .eq("user_id", userId);

    if (gamesError) {
      console.error("[v0] Failed to fetch user games:", gamesError);
      return;
    }

    // Match games with universes by name or place ID and update universe_id
    for (const game of games || []) {
      // Try to find matching universe
      const matchingUniverse = universes.find((u: { displayName?: string; path?: string }) => {
        // Match by name
        if (u.displayName && game.name && u.displayName.toLowerCase() === game.name.toLowerCase()) {
          return true;
        }
        // Match by roblox_game_id (place ID) if the universe path contains it
        if (game.roblox_game_id && u.path) {
          const universeId = u.path.replace("universes/", "");
          return universeId === game.roblox_game_id;
        }
        return false;
      });

      if (matchingUniverse) {
        const universeId = matchingUniverse.path?.replace("universes/", "") || matchingUniverse.id;
        
        await supabase
          .from("games")
          .update({ 
            universe_id: universeId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", game.id);
      }
    }
  } catch (err) {
    console.error("[v0] Error updating user games with universes:", err);
  }
}
