import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface RobloxGameCreator {
  id: number;
  name: string;
  type: "User" | "Group";
}

interface RobloxGame {
  id: number;
  name: string;
  rootPlaceId: number;
  creator?: RobloxGameCreator;
}

interface RobloxGamesResponse {
  data: RobloxGame[];
  nextPageCursor?: string;
}

interface GroupRole {
  group: {
    id: number;
    name: string;
  };
  role: {
    name: string;
    rank: number;
  };
}

interface GroupRolesResponse {
  data: GroupRole[];
}

interface EnhancedGame {
  id: number;
  name: string;
  rootPlaceId: number;
  source: "user" | "group";
  groupName?: string;
  groupId?: number;
  roleName?: string;
  roleRank?: number;
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

    const robloxUserId = profile.roblox_user_id;
    // Use a Map to allow replacing user games with group games (group wins)
    const gamesMap = new Map<number, EnhancedGame>();
    let groupWarning: string | null = null;

    // Helper to add/merge a game - group source always wins over user source
    const addGame = (game: EnhancedGame) => {
      const existing = gamesMap.get(game.id);
      
      if (!existing) {
        // New game - add it
        gamesMap.set(game.id, game);
      } else if (existing.source === "user" && game.source === "group") {
        // Existing is user, incoming is group - replace with group (group wins)
        gamesMap.set(game.id, game);
      }
      // If existing is group and incoming is user, keep existing (group wins)
      // If both same source, keep first
    };

    // 1. Fetch user's groups and their games FIRST (group games take priority)
    try {
      const groupsResponse = await fetch(
        `https://groups.roblox.com/v2/users/${robloxUserId}/groups/roles`,
        {
          headers: { "Accept": "application/json" },
          next: { revalidate: 60 },
        }
      );

      if (groupsResponse.ok) {
        const groupsData: GroupRolesResponse = await groupsResponse.json();
        
        // Filter groups where user has meaningful access (rank >= 200 or owner role)
        const eligibleGroups = (groupsData.data || []).filter(gr => {
          const highRank = gr.role.rank >= 200;
          const ownerRole = gr.role.name.toLowerCase().includes("owner");
          return highRank || ownerRole;
        });

        // Fetch games for each eligible group
        for (const groupRole of eligibleGroups) {
          try {
            const groupGamesResponse = await fetch(
              `https://games.roblox.com/v2/groups/${groupRole.group.id}/games?accessFilter=Public&limit=50`,
              {
                headers: { "Accept": "application/json" },
                next: { revalidate: 60 },
              }
            );

            if (groupGamesResponse.ok) {
              const groupGamesData: RobloxGamesResponse = await groupGamesResponse.json();
              for (const game of groupGamesData.data || []) {
                addGame({
                  id: game.id,
                  name: game.name,
                  rootPlaceId: game.rootPlaceId,
                  source: "group",
                  groupName: groupRole.group.name,
                  groupId: groupRole.group.id,
                  roleName: groupRole.role.name,
                  roleRank: groupRole.role.rank,
                });
              }
            }
          } catch (error) {
            console.error(`[Roblox API] Failed to fetch games for group ${groupRole.group.id}:`, error);
          }
        }
      } else {
        groupWarning = "Could not fetch group games. Showing personal games only.";
      }
    } catch (error) {
      console.error("[Roblox API] Failed to fetch user groups:", error);
      groupWarning = "Could not fetch group games. Showing personal games only.";
    }

    // 2. Fetch personal games (processed second - group games already in map take priority)
    try {
      const personalResponse = await fetch(
        `https://games.roblox.com/v2/users/${robloxUserId}/games?accessFilter=Public&limit=50`,
        {
          headers: { "Accept": "application/json" },
          next: { revalidate: 60 },
        }
      );

      if (personalResponse.ok) {
        const personalData: RobloxGamesResponse = await personalResponse.json();
        for (const game of personalData.data || []) {
          // Check if the game's creator is actually a Group (Roblox API returns creator info)
          const isGroupCreator = game.creator?.type === "Group";
          
          if (isGroupCreator && game.creator) {
            // This "personal" game is actually group-owned - add as group
            addGame({
              id: game.id,
              name: game.name,
              rootPlaceId: game.rootPlaceId,
              source: "group",
              groupId: game.creator.id,
              groupName: game.creator.name,
            });
          } else {
            // Truly personal game
            addGame({
              id: game.id,
              name: game.name,
              rootPlaceId: game.rootPlaceId,
              source: "user",
            });
          }
        }
      }
    } catch (error) {
      console.error("[Roblox API] Failed to fetch personal games:", error);
    }

    // Convert map to array
    const allGames = Array.from(gamesMap.values());

    // Return combined results
    return NextResponse.json({ 
      games: allGames,
      warning: groupWarning,
    });
  } catch (error) {
    console.error("[API] /api/roblox/games error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
