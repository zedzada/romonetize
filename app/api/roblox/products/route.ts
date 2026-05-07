import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const ROBLOX_DEVELOP_API = "https://develop.roblox.com/v1";
const ROBLOX_GAMES_API = "https://games.roblox.com/v1/games";
const ROBLOX_THUMBNAILS_API = "https://thumbnails.roblox.com/v1";

interface RobloxProductDetails {
  id: string;
  name: string;
  description?: string;
  type: "gamepass" | "devproduct";
  price: number;
  isForSale: boolean;
  iconImageAssetId?: number;
  thumbnailUrl?: string;
  created?: string;
  updated?: string;
  gameId: string;
  gameName: string;
  universeId: string;
}

// Helper to make authenticated Roblox API requests
async function robloxFetch(url: string, accessToken: string) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[v0] Roblox API error for ${url}:`, response.status, errorText);
    throw new Error(`Roblox API error: ${response.status}`);
  }
  
  return response.json();
}

// Fetch asset thumbnails
async function fetchThumbnails(assetIds: number[], accessToken: string): Promise<Map<number, string>> {
  const thumbnailMap = new Map<number, string>();
  
  if (assetIds.length === 0) return thumbnailMap;
  
  try {
    const idsParam = assetIds.slice(0, 100).join(","); // API limit
    const url = `${ROBLOX_THUMBNAILS_API}/assets?assetIds=${idsParam}&size=150x150&format=Png`;
    
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    
    if (response.ok) {
      const data = await response.json();
      (data?.data || []).forEach((item: { targetId: number; imageUrl?: string }) => {
        if (item.imageUrl) {
          thumbnailMap.set(item.targetId, item.imageUrl);
        }
      });
    }
  } catch (error) {
    console.error("[v0] Error fetching thumbnails:", error);
  }
  
  return thumbnailMap;
}

// Fetch gamepasses for a universe with details
async function fetchGamepassesDetailed(
  universeId: string, 
  accessToken: string,
  gameId: string,
  gameName: string
): Promise<RobloxProductDetails[]> {
  try {
    const gamepassUrl = `${ROBLOX_DEVELOP_API}/universes/${universeId}/passes?sortOrder=Asc&limit=100`;
    const gamepassData = await robloxFetch(gamepassUrl, accessToken);
    
    const passes = gamepassData?.data || [];
    
    // Fetch thumbnails for all passes
    const iconIds = passes
      .filter((p: { iconImageAssetId?: number }) => p.iconImageAssetId)
      .map((p: { iconImageAssetId: number }) => p.iconImageAssetId);
    const thumbnails = await fetchThumbnails(iconIds, accessToken);
    
    return passes.map((pass: {
      id: number;
      name: string;
      description?: string;
      price?: number;
      isForSale?: boolean;
      iconImageAssetId?: number;
      created?: string;
      updated?: string;
    }) => ({
      id: String(pass.id),
      name: pass.name,
      description: pass.description,
      type: "gamepass" as const,
      price: pass.price || 0,
      isForSale: pass.isForSale ?? true,
      iconImageAssetId: pass.iconImageAssetId,
      thumbnailUrl: pass.iconImageAssetId ? thumbnails.get(pass.iconImageAssetId) : undefined,
      created: pass.created,
      updated: pass.updated,
      gameId,
      gameName,
      universeId,
    }));
  } catch (error) {
    console.error("[v0] Error fetching gamepasses for universe", universeId, error);
    return [];
  }
}

// Fetch developer products for a universe with details
async function fetchDevProductsDetailed(
  universeId: string, 
  accessToken: string,
  gameId: string,
  gameName: string
): Promise<RobloxProductDetails[]> {
  try {
    const devProductUrl = `${ROBLOX_DEVELOP_API}/universes/${universeId}/developerproducts?pageNumber=1&pageSize=100`;
    const devProductData = await robloxFetch(devProductUrl, accessToken);
    
    const products = devProductData?.developerProducts || devProductData?.data || [];
    
    // Fetch thumbnails
    const iconIds = products
      .filter((p: { iconImageAssetId?: number }) => p.iconImageAssetId)
      .map((p: { iconImageAssetId: number }) => p.iconImageAssetId);
    const thumbnails = await fetchThumbnails(iconIds, accessToken);
    
    return products.map((product: {
      id: number;
      productId?: number;
      name: string;
      Description?: string;
      description?: string;
      priceInRobux?: number;
      price?: number;
      iconImageAssetId?: number;
    }) => ({
      id: String(product.id || product.productId),
      name: product.name,
      description: product.Description || product.description,
      type: "devproduct" as const,
      price: product.priceInRobux || product.price || 0,
      isForSale: true,
      iconImageAssetId: product.iconImageAssetId,
      thumbnailUrl: product.iconImageAssetId ? thumbnails.get(product.iconImageAssetId) : undefined,
      gameId,
      gameName,
      universeId,
    }));
  } catch (error) {
    console.error("[v0] Error fetching dev products for universe", universeId, error);
    return [];
  }
}

export async function GET() {
  try {
    const supabase = await createClient();
    
    // Get authenticated user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError || !user) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

    // Get user's Roblox access token from profile
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("roblox_access_token, roblox_user_id, roblox_token_expires_at")
      .eq("id", user.id)
      .single();

    if (profileError || !profile?.roblox_access_token) {
      return NextResponse.json(
        { 
          error: "Roblox account not connected",
          needsConnection: true 
        },
        { status: 400 }
      );
    }

    // Check if token is expired
    if (profile.roblox_token_expires_at) {
      const expiresAt = new Date(profile.roblox_token_expires_at);
      if (expiresAt < new Date()) {
        return NextResponse.json(
          { 
            error: "Roblox token expired. Please reconnect your account.",
            needsReconnection: true 
          },
          { status: 401 }
        );
      }
    }

    const accessToken = profile.roblox_access_token;

    // Get the selected game (is_selected = true) - single source of truth
    let { data: selectedGame, error: gamesError } = await supabase
      .from("games")
      .select("id, name, roblox_game_id, universe_id")
      .eq("user_id", user.id)
      .eq("is_selected", true)
      .neq("status", "deleted")
      .single();

    // If no game selected, auto-select the first one
    if (!selectedGame) {
      const { data: firstGame } = await supabase
        .from("games")
        .select("id, name, roblox_game_id, universe_id")
        .eq("user_id", user.id)
        .neq("status", "deleted")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      
      if (firstGame) {
        await supabase.from("games").update({ is_selected: true }).eq("id", firstGame.id);
        selectedGame = firstGame;
      }
    }

    const games = selectedGame ? [selectedGame] : [];

    if (gamesError) {
      return NextResponse.json(
        { error: "Failed to fetch games" },
        { status: 500 }
      );
    }

    // Collect all products from all games in parallel
    const productPromises = (games || []).map(async (game) => {
      const universeId = game.universe_id || game.roblox_game_id;
      if (!universeId) return [];

      const [gamepasses, devProducts] = await Promise.all([
        fetchGamepassesDetailed(universeId, accessToken, game.id, game.name),
        fetchDevProductsDetailed(universeId, accessToken, game.id, game.name),
      ]);

      return [...gamepasses, ...devProducts];
    });

    const productsArrays = await Promise.all(productPromises);
    const allProducts = productsArrays.flat();

    // Group products by game
    const productsByGame: Record<string, RobloxProductDetails[]> = {};
    allProducts.forEach((product) => {
      if (!productsByGame[product.gameId]) {
        productsByGame[product.gameId] = [];
      }
      productsByGame[product.gameId].push(product);
    });

    // Calculate summary stats
    const summary = {
      totalProducts: allProducts.length,
      totalGamepasses: allProducts.filter(p => p.type === "gamepass").length,
      totalDevProducts: allProducts.filter(p => p.type === "devproduct").length,
      activeProducts: allProducts.filter(p => p.isForSale).length,
      avgGamepassPrice: 0,
      avgDevProductPrice: 0,
    };

    const gamepassPrices = allProducts.filter(p => p.type === "gamepass" && p.price > 0).map(p => p.price);
    const devProductPrices = allProducts.filter(p => p.type === "devproduct" && p.price > 0).map(p => p.price);
    
    if (gamepassPrices.length > 0) {
      summary.avgGamepassPrice = Math.round(gamepassPrices.reduce((a, b) => a + b, 0) / gamepassPrices.length);
    }
    if (devProductPrices.length > 0) {
      summary.avgDevProductPrice = Math.round(devProductPrices.reduce((a, b) => a + b, 0) / devProductPrices.length);
    }

    return NextResponse.json({
      success: true,
      products: allProducts,
      productsByGame,
      summary,
      robloxUserId: profile.roblox_user_id,
    });
  } catch (error) {
    console.error("[v0] Error in products API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
