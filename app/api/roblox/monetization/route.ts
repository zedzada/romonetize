import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Roblox API endpoints
const ROBLOX_USERS_API = "https://users.roblox.com/v1/users/authenticated";
const ROBLOX_GAMES_API = "https://games.roblox.com/v1/games";
const ROBLOX_DEVELOP_API = "https://develop.roblox.com/v1";
const ROBLOX_ECONOMY_API = "https://economy.roblox.com";

interface RobloxProduct {
  id: string;
  name: string;
  type: "gamepass" | "devproduct";
  price: number;
  isForSale: boolean;
  iconImageAssetId?: number;
  description?: string;
}

interface RobloxTransaction {
  id: string;
  created: string;
  isPending: boolean;
  agent: {
    id: number;
    type: string;
    name: string;
  };
  details?: {
    id?: number;
    name?: string;
    place?: {
      placeId: number;
      universeId: number;
      name: string;
    };
  };
  currency: {
    amount: number;
    type: string;
  };
}

interface MonetizationData {
  products: RobloxProduct[];
  transactions: RobloxTransaction[];
  totalRevenue: number;
  gamepassRevenue: number;
  devproductRevenue: number;
  error?: string;
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

// Fetch gamepasses for a universe
async function fetchGamepasses(universeId: string, accessToken: string): Promise<RobloxProduct[]> {
  try {
    // Get the root place ID first
    const universeData = await robloxFetch(
      `${ROBLOX_GAMES_API}?universeIds=${universeId}`,
      accessToken
    );
    
    const rootPlaceId = universeData?.data?.[0]?.rootPlaceId;
    if (!rootPlaceId) {
      console.log("[v0] No root place found for universe", universeId);
      return [];
    }

    // Fetch gamepasses for the place
    const gamepassUrl = `${ROBLOX_DEVELOP_API}/universes/${universeId}/passes?sortOrder=Asc&limit=100`;
    const gamepassData = await robloxFetch(gamepassUrl, accessToken);
    
    return (gamepassData?.data || []).map((pass: {
      id: number;
      name: string;
      price?: number;
      isForSale?: boolean;
      iconImageAssetId?: number;
      description?: string;
    }) => ({
      id: String(pass.id),
      name: pass.name,
      type: "gamepass" as const,
      price: pass.price || 0,
      isForSale: pass.isForSale ?? true,
      iconImageAssetId: pass.iconImageAssetId,
      description: pass.description,
    }));
  } catch (error) {
    console.error("[v0] Error fetching gamepasses:", error);
    return [];
  }
}

// Fetch developer products for a universe
async function fetchDevProducts(universeId: string, accessToken: string): Promise<RobloxProduct[]> {
  try {
    const devProductUrl = `${ROBLOX_DEVELOP_API}/universes/${universeId}/developerproducts?pageNumber=1&pageSize=100`;
    const devProductData = await robloxFetch(devProductUrl, accessToken);
    
    return (devProductData?.developerProducts || devProductData?.data || []).map((product: {
      id: number;
      productId?: number;
      name: string;
      priceInRobux?: number;
      price?: number;
      iconImageAssetId?: number;
      description?: string;
    }) => ({
      id: String(product.id || product.productId),
      name: product.name,
      type: "devproduct" as const,
      price: product.priceInRobux || product.price || 0,
      isForSale: true,
      iconImageAssetId: product.iconImageAssetId,
      description: product.description,
    }));
  } catch (error) {
    console.error("[v0] Error fetching dev products:", error);
    return [];
  }
}

// Fetch user transaction history (sales)
async function fetchUserTransactions(
  accessToken: string,
  transactionType: "Sale" | "Purchase" = "Sale",
  limit: number = 100
): Promise<RobloxTransaction[]> {
  try {
    // First get the authenticated user's ID
    const userData = await robloxFetch(ROBLOX_USERS_API, accessToken);
    const userId = userData?.id;
    
    if (!userId) {
      console.log("[v0] Could not get user ID for transactions");
      return [];
    }

    // Fetch transaction history
    const transactionsUrl = `${ROBLOX_ECONOMY_API}/v2/users/${userId}/transactions?transactionType=${transactionType}&limit=${limit}`;
    const transactionsData = await robloxFetch(transactionsUrl, accessToken);
    
    return transactionsData?.data || [];
  } catch (error) {
    console.error("[v0] Error fetching transactions:", error);
    return [];
  }
}

// Fetch transaction totals for the user
async function fetchTransactionTotals(accessToken: string): Promise<{
  salesTotal?: number;
  purchasesTotal?: number;
  pendingRobux?: number;
}> {
  try {
    const userData = await robloxFetch(ROBLOX_USERS_API, accessToken);
    const userId = userData?.id;
    
    if (!userId) {
      return {};
    }

    // The transaction-totals endpoint may require different auth
    const totalsUrl = `${ROBLOX_ECONOMY_API}/v1/user/transaction-totals?timeFrame=Year&transactionType=summary`;
    const totalsData = await robloxFetch(totalsUrl, accessToken);
    
    return {
      salesTotal: totalsData?.salesTotal,
      purchasesTotal: totalsData?.purchasesTotal,
      pendingRobux: totalsData?.pendingRobux,
    };
  } catch (error) {
    console.error("[v0] Error fetching transaction totals:", error);
    return {};
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

    // Get user's profile including plan
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("roblox_access_token, roblox_user_id, roblox_token_expires_at, plan")
      .eq("id", user.id)
      .single();

    // Check plan access - monetization is Pro+ only
    const userPlan = profile?.plan || "free";
    if (userPlan === "free") {
      return NextResponse.json(
        { 
          error: "Monetization analytics requires Pro or Studio plan",
          upgradeRequired: true,
          currentPlan: "free"
        },
        { status: 403 }
      );
    }

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

    if (gamesError && !selectedGame) {
      return NextResponse.json(
        { error: "Failed to fetch games" },
        { status: 500 }
      );
    }

    // Collect products from the selected game
    const allProducts: RobloxProduct[] = [];
    const productsByGame: Record<string, RobloxProduct[]> = {};

    for (const game of games || []) {
      const universeId = game.universe_id || game.roblox_game_id;
      if (!universeId) continue;

      const [gamepasses, devProducts] = await Promise.all([
        fetchGamepasses(universeId, accessToken),
        fetchDevProducts(universeId, accessToken),
      ]);

      const gameProducts = [...gamepasses, ...devProducts];
      productsByGame[game.id] = gameProducts;
      allProducts.push(...gameProducts);
    }

    // Fetch user transactions
    const [transactions, totals] = await Promise.all([
      fetchUserTransactions(accessToken, "Sale", 100),
      fetchTransactionTotals(accessToken),
    ]);

    // Calculate revenue from transactions
    const totalRevenue = transactions.reduce((sum, tx) => {
      if (tx.currency?.type === "Robux" && !tx.isPending) {
        return sum + (tx.currency.amount || 0);
      }
      return sum;
    }, 0);

    // Try to categorize revenue by product type (best effort)
    let gamepassRevenue = 0;
    let devproductRevenue = 0;

    transactions.forEach((tx) => {
      if (tx.currency?.type === "Robux" && !tx.isPending) {
        // Roblox doesn't always indicate product type in transactions
        // We'd need to cross-reference with our product list
        const amount = tx.currency.amount || 0;
        // For now, we'll split it proportionally based on product counts
        const gamepassCount = allProducts.filter(p => p.type === "gamepass").length;
        const devProductCount = allProducts.filter(p => p.type === "devproduct").length;
        const totalCount = gamepassCount + devProductCount;
        
        if (totalCount > 0) {
          gamepassRevenue += amount * (gamepassCount / totalCount);
          devproductRevenue += amount * (devProductCount / totalCount);
        }
      }
    });

    const monetizationData: MonetizationData = {
      products: allProducts,
      transactions,
      totalRevenue: totals.salesTotal || totalRevenue,
      gamepassRevenue: Math.round(gamepassRevenue),
      devproductRevenue: Math.round(devproductRevenue),
    };

    return NextResponse.json({
      success: true,
      data: monetizationData,
      productsByGame,
      robloxUserId: profile.roblox_user_id,
    });
  } catch (error) {
    console.error("[v0] Error in monetization API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
