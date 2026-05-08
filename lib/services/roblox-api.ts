"use server";

// Roblox Open Cloud API integration
// Note: Requires ROBLOX_OPEN_CLOUD_API_KEY environment variable

export interface RobloxGameStats {
  // Player metrics
  currentPlayers: number | null;
  totalVisits: number | null;
  favorites: number | null;
  likes: number | null;
  dislikes: number | null;
  
  // Computed
  likeRatio: number | null;
  
  // Source tracking
  source: "roblox_api" | "not_available";
  lastFetched: string | null;
}

export interface RobloxUniverseInfo {
  id: number;
  name: string;
  description: string;
  creator: {
    id: number;
    type: string;
    name: string;
  };
  price: number | null;
  allowedGearGenres: string[];
  allowedGearCategories: string[];
  isGenreEnforced: boolean;
  copyingAllowed: boolean;
  playing: number;
  visits: number;
  maxPlayers: number;
  created: string;
  updated: string;
  studioAccessToApisAllowed: boolean;
  createVipServersAllowed: boolean;
  universeAvatarType: string;
  genre: string;
  isAllGenre: boolean;
  isFavoritedByUser: boolean;
  favoritedCount: number;
}

// Fetch game stats from Roblox API (public endpoints)
// Optional apiKey parameter enables authenticated requests for enhanced data
export async function getRobloxGameStats(universeId: string, apiKey?: string | null): Promise<RobloxGameStats> {
  const defaultStats: RobloxGameStats = {
    currentPlayers: null,
    totalVisits: null,
    favorites: null,
    likes: null,
    dislikes: null,
    likeRatio: null,
    source: "not_available",
    lastFetched: null,
  };

  const apiUrl = `https://games.roblox.com/v1/games?universeIds=${universeId}`;
  console.log("[Roblox API] Fetching stats from:", apiUrl);

  try {
    // Build headers - add API key if provided
    const headers: Record<string, string> = {
      "Accept": "application/json",
    };
    if (apiKey) {
      headers["x-api-key"] = apiKey;
    }

    // Fetch universe info (public API)
    const universeResponse = await fetch(apiUrl, { 
      next: { revalidate: 60 }, // Cache for 1 minute
      headers,
    });

    console.log("[Roblox API] Response status:", universeResponse.status);

    if (!universeResponse.ok) {
      const errorText = await universeResponse.text();
      console.error("[Roblox API] Error response:", errorText);
      return defaultStats;
    }

    const universeData = await universeResponse.json();
    console.log("[Roblox API] Raw response data keys:", Object.keys(universeData));
    console.log("[Roblox API] data array length:", universeData.data?.length ?? 0);
    
    const gameInfo = universeData.data?.[0];

    if (!gameInfo) {
      console.log("[Roblox API] No game found in response for universeId:", universeId);
      return defaultStats;
    }

    // Log raw game info for debugging
    console.log("[Roblox API] Raw game info:", JSON.stringify({
      id: gameInfo.id,
      name: gameInfo.name,
      playing: gameInfo.playing,
      visits: gameInfo.visits,
      favoritedCount: gameInfo.favoritedCount,
    }));

    // Fetch votes (likes/dislikes)
    let likes: number | null = null;
    let dislikes: number | null = null;
    
    try {
      const votesResponse = await fetch(
        `https://games.roblox.com/v1/games/votes?universeIds=${universeId}`,
        { 
          next: { revalidate: 60 },
          headers,
        }
      );
      
      if (votesResponse.ok) {
        const votesData = await votesResponse.json();
        const votes = votesData.data?.[0];
        if (votes) {
          likes = votes.upVotes ?? null;
          dislikes = votes.downVotes ?? null;
        }
      }
    } catch (error) {
      console.error("[v0] Error fetching votes:", error);
    }

    // Calculate like ratio
    const totalVotes = (likes || 0) + (dislikes || 0);
    const likeRatio = totalVotes > 0 ? ((likes || 0) / totalVotes) * 100 : null;

    return {
      currentPlayers: gameInfo.playing ?? null,
      totalVisits: gameInfo.visits ?? null,
      favorites: gameInfo.favoritedCount ?? null,
      likes,
      dislikes,
      likeRatio,
      source: "roblox_api",
      lastFetched: new Date().toISOString(),
    };
  } catch (error) {
    console.error("[v0] Error fetching Roblox stats:", error);
    return defaultStats;
  }
}

// Get universe ID from place ID
export async function getUniverseIdFromPlaceId(placeId: string): Promise<string | null> {
  try {
    const response = await fetch(
      `https://apis.roblox.com/universes/v1/places/${placeId}/universe`,
      {
        next: { revalidate: 3600 }, // Cache for 1 hour
        headers: {
          "Accept": "application/json",
        }
      }
    );

    if (!response.ok) {
      // Fallback: try the game details API
      const gameResponse = await fetch(
        `https://games.roblox.com/v1/games/multiget-place-details?placeIds=${placeId}`,
        {
          next: { revalidate: 3600 },
          headers: {
            "Accept": "application/json",
          }
        }
      );

      if (gameResponse.ok) {
        const data = await gameResponse.json();
        return data[0]?.universeId?.toString() ?? null;
      }
      return null;
    }

    const data = await response.json();
    return data.universeId?.toString() ?? null;
  } catch (error) {
    console.error("[v0] Error fetching universe ID:", error);
    return null;
  }
}

// Define RobloxGameInfo interface
export interface RobloxGameInfo {
  id: number;
  name: string;
  description: string;
  creator: {
    id: number;
    type: string;
    name: string;
  } | null;
  maxPlayers: number;
  genre: string;
}

// Get game info from Roblox API
export async function getRobloxGameInfo(universeId: string): Promise<RobloxGameInfo | null> {
  try {
    const response = await fetch(
      `https://games.roblox.com/v1/games?universeIds=${universeId}`,
      {
        next: { revalidate: 300 },
        headers: {
          "Accept": "application/json",
        }
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const game = data.data?.[0];
    
    if (!game) {
      return null;
    }

    return {
      id: game.id,
      name: game.name ?? "",
      description: game.description ?? "",
      creator: game.creator ? {
        id: game.creator.id,
        type: game.creator.type,
        name: game.creator.name,
      } : null,
      maxPlayers: game.maxPlayers ?? 0,
      genre: game.genre ?? "Unknown",
    };
  } catch (error) {
    console.error("[v0] Error fetching game info:", error);
    return null;
  }
}

// Get game thumbnail from Roblox API
export async function getRobloxGameThumbnail(universeId: string): Promise<string | null> {
  try {
    const response = await fetch(
      `https://thumbnails.roblox.com/v1/games/icons?universeIds=${universeId}&size=512x512&format=Png&isCircular=false`,
      {
        next: { revalidate: 3600 },
        headers: {
          "Accept": "application/json",
        }
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data.data?.[0]?.imageUrl ?? null;
  } catch (error) {
    console.error("[v0] Error fetching game thumbnail:", error);
    return null;
  }
}
