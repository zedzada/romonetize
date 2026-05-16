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
  iconUrl?: string | null;
}

interface ThumbnailData {
  targetId: number;
  state: string;
  imageUrl: string | null;
}

// Pagination helper: fetch ALL pages from a Roblox games endpoint
async function fetchAllRobloxGames(
  baseUrl: string,
  limit = 50,
  maxPages = 20, // Safety cap to avoid infinite loops
): Promise<{ games: RobloxGame[]; pagesFetched: number }> {
  const allGames: RobloxGame[] = [];
  let cursor: string | undefined = undefined;
  let pagesFetched = 0;

  do {
    const separator = baseUrl.includes("?") ? "&" : "?";
    const url = cursor
      ? `${baseUrl}${separator}limit=${limit}&cursor=${cursor}`
      : `${baseUrl}${separator}limit=${limit}`;

    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        next: { revalidate: 60 },
      });

      if (!res.ok) {
        console.error(`[Roblox API] Pagination fetch failed (${res.status}) for ${url}`);
        break;
      }

      const data: RobloxGamesResponse = await res.json();
      pagesFetched++;
      allGames.push(...(data.data || []));
      cursor = data.nextPageCursor || undefined;
    } catch (error) {
      console.error(`[Roblox API] Pagination fetch error for ${url}:`, error);
      break;
    }
  } while (cursor && pagesFetched < maxPages);

  return { games: allGames, pagesFetched };
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
    let personalPagesFetched = 0;
    let groupPagesFetched = 0;
    let personalGamesCount = 0;
    let groupGamesCount = 0;
    const eligibleGroupCount = { total: 0 };

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
        eligibleGroupCount.total = eligibleGroups.length;

        // Fetch games for each eligible group (with pagination)
        for (const groupRole of eligibleGroups) {
          try {
            const { games: groupGames, pagesFetched } = await fetchAllRobloxGames(
              `https://games.roblox.com/v2/groups/${groupRole.group.id}/games?accessFilter=Public`,
            );
            groupPagesFetched += pagesFetched;

            for (const game of groupGames) {
              groupGamesCount++;
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

    // 2. Fetch personal games with pagination (processed second - group games already in map take priority)
    try {
      const { games: personalGames, pagesFetched } = await fetchAllRobloxGames(
        `https://games.roblox.com/v2/users/${robloxUserId}/games?accessFilter=Public`,
      );
      personalPagesFetched = pagesFetched;

      for (const game of personalGames) {
        // Check if the game's creator is actually a Group (Roblox API returns creator info)
        const isGroupCreator = game.creator?.type === "Group";
        
        if (isGroupCreator && game.creator) {
          groupGamesCount++;
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
          personalGamesCount++;
          // Truly personal game
          addGame({
            id: game.id,
            name: game.name,
            rootPlaceId: game.rootPlaceId,
            source: "user",
          });
        }
      }
    } catch (error) {
      console.error("[Roblox API] Failed to fetch personal games:", error);
    }

    // Convert map to array
    const allGames = Array.from(gamesMap.values());

    // Batch fetch thumbnails for all games
    if (allGames.length > 0) {
      try {
        const universeIds = allGames.map(g => g.id).join(",");
        const thumbnailResponse = await fetch(
          `https://thumbnails.roblox.com/v1/games/icons?universeIds=${universeIds}&size=150x150&format=Png&isCircular=false`,
          {
            headers: { "Accept": "application/json" },
            next: { revalidate: 3600 }, // Cache for 1 hour
          }
        );

        if (thumbnailResponse.ok) {
          const thumbnailData = await thumbnailResponse.json();
          const thumbnails: ThumbnailData[] = thumbnailData.data || [];
          
          // Map thumbnails back to games
          for (const game of allGames) {
            const thumbnail = thumbnails.find((t: ThumbnailData) => t.targetId === game.id);
            if (thumbnail && thumbnail.state === "Completed" && thumbnail.imageUrl) {
              game.iconUrl = thumbnail.imageUrl;
            }
          }

          // Debug log in development
          if (process.env.NODE_ENV === "development") {
            console.log("[Roblox API] Thumbnails:", {
              universeIdsRequested: allGames.length,
              thumbnailsReturned: thumbnails.length,
              gamesWithIconUrl: allGames.filter(g => g.iconUrl).length,
            });
          }
        }
      } catch (error) {
        console.error("[Roblox API] Failed to fetch thumbnails:", error);
        // Continue without thumbnails - games will use fallback icons
      }
    }

    // Return combined results with pagination metadata
    return NextResponse.json({ 
      games: allGames,
      warning: groupWarning,
      meta: {
        robloxUserId,
        totalGamesFetched: allGames.length,
        personalGamesCount,
        groupGamesCount,
        personalPagesFetched,
        groupPagesFetched,
        connectedGamesInList: 0, // client fills this in
        sampleGameIds: allGames.slice(0, 5).map(g => ({ id: g.id, name: g.name, source: g.source })),
      },
    });
  } catch (error) {
    console.error("[API] /api/roblox/games error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
