import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { 
  getRobloxGameStats, 
  getUniverseIdFromPlaceId,
  getRobloxGameInfo,
  getRobloxGameThumbnail 
} from "@/lib/services/roblox-api";

// Lazy init for service role client (for inserts that bypass RLS)
function getSupabaseAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const ROBLOX_DEVELOP_API = "https://develop.roblox.com/v1";
const ROBLOX_THUMBNAILS_API = "https://thumbnails.roblox.com/v1";

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
    console.error(`[Roblox Sync] API error for ${url}:`, response.status, errorText);
    throw new Error(`Roblox API error: ${response.status}`);
  }
  
  return response.json();
}

// Fetch asset thumbnails
async function fetchThumbnails(assetIds: number[], accessToken: string): Promise<Map<number, string>> {
  const thumbnailMap = new Map<number, string>();
  
  if (assetIds.length === 0) return thumbnailMap;
  
  try {
    const idsParam = assetIds.slice(0, 100).join(",");
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
    console.error("[Roblox Sync] Error fetching thumbnails:", error);
  }
  
  return thumbnailMap;
}

interface RobloxProduct {
  id: string;
  name: string;
  description?: string;
  productType: "gamepass" | "devproduct";
  priceRobux: number;
  isForSale: boolean;
  iconUrl?: string;
  raw: Record<string, unknown>;
}

// Fetch gamepasses for a universe
async function fetchGamepasses(universeId: string, accessToken: string): Promise<RobloxProduct[]> {
  try {
    const gamepassUrl = `${ROBLOX_DEVELOP_API}/universes/${universeId}/passes?sortOrder=Asc&limit=100`;
    const gamepassData = await robloxFetch(gamepassUrl, accessToken);
    
    const passes = gamepassData?.data || [];
    
    // Fetch thumbnails
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
    }) => ({
      id: String(pass.id),
      name: pass.name,
      description: pass.description,
      productType: "gamepass" as const,
      priceRobux: pass.price || 0,
      isForSale: pass.isForSale ?? true,
      iconUrl: pass.iconImageAssetId ? thumbnails.get(pass.iconImageAssetId) : undefined,
      raw: pass,
    }));
  } catch (error) {
    console.error("[Roblox Sync] Error fetching gamepasses for universe", universeId, error);
    return [];
  }
}

// Fetch developer products for a universe
async function fetchDevProducts(universeId: string, accessToken: string): Promise<RobloxProduct[]> {
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
      productType: "devproduct" as const,
      priceRobux: product.priceInRobux || product.price || 0,
      isForSale: true,
      iconUrl: product.iconImageAssetId ? thumbnails.get(product.iconImageAssetId) : undefined,
      raw: product,
    }));
  } catch (error) {
    console.error("[Roblox Sync] Error fetching dev products for universe", universeId, error);
    return [];
  }
}

/**
 * POST /api/roblox/sync-selected-game
 * 
 * Comprehensive Roblox data sync for the selected game.
 * - Fetches public stats (CCU, visits, favorites, likes/dislikes)
 * - Fetches products (gamepasses, dev products) if OAuth token available
 * - Stores snapshots in roblox_game_syncs and roblox_products tables
 * - Returns detailed sync results with unavailable metrics flagged
 */
export async function POST(request: Request) {
  const supabaseAdmin = getSupabaseAdmin();
  
  try {
    const supabase = await createClient();
    
    // Get authenticated user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError || !user) {
      return NextResponse.json(
        { success: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    // Parse request body for options
    let options: { includeProducts?: boolean; forceRefresh?: boolean } = {};
    try {
      const body = await request.json();
      options = body || {};
    } catch {
      // Empty body is fine, default options
    }

    console.log("[Roblox Sync] Starting sync for user:", user.id);

    // Get the selected game
    const { data: selectedGame, error: gameError } = await supabase
      .from("games")
      .select("id, name, roblox_game_id, universe_id, root_place_id")
      .eq("user_id", user.id)
      .eq("is_selected", true)
      .neq("status", "deleted")
      .single();

    if (gameError || !selectedGame) {
      console.log("[Roblox Sync] No game selected");
      return NextResponse.json(
        { success: false, error: "No game selected" },
        { status: 404 }
      );
    }

    console.log("[Roblox Sync] Selected game:", selectedGame.name, "ID:", selectedGame.id);
    console.log("[Roblox Sync] Roblox game ID:", selectedGame.roblox_game_id);
    console.log("[Roblox Sync] Root place ID:", selectedGame.root_place_id);

    // Track what's unavailable
    const unavailable: string[] = [];
    const sectionErrors: Record<string, string> = {};

    // Resolve universe ID if needed
    let universeId = selectedGame.universe_id;
    if (!universeId && selectedGame.roblox_game_id) {
      console.log("[Roblox Sync] Resolving universe ID from place ID:", selectedGame.roblox_game_id);
      universeId = await getUniverseIdFromPlaceId(selectedGame.roblox_game_id);
      if (universeId) {
        await supabaseAdmin
          .from("games")
          .update({ universe_id: universeId })
          .eq("id", selectedGame.id);
        console.log("[Roblox Sync] Resolved universe ID:", universeId);
      }
    }

    if (!universeId) {
      return NextResponse.json(
        { 
          success: false, 
          error: "Could not resolve universe ID for this game",
          unavailable: ["universe_id_resolution_failed"],
        },
        { status: 400 }
      );
    }

    // Fetch Roblox stats in parallel
    console.log("[Roblox Sync] Fetching Roblox stats for universe:", universeId);
    const [stats, gameInfo, thumbnailUrl] = await Promise.all([
      getRobloxGameStats(universeId),
      getRobloxGameInfo(universeId),
      getRobloxGameThumbnail(universeId),
    ]);

    console.log("[Roblox Sync] Stats source:", stats.source);
    console.log("[Roblox Sync] CCU:", stats.currentPlayers);
    console.log("[Roblox Sync] Visits:", stats.totalVisits);

    // Build game sync result
    let gameSync: {
      ccu: number | null;
      visits: number | null;
      favorites: number | null;
      likes: number | null;
      dislikes: number | null;
      maxPlayers: number | null;
      genre: string | null;
      syncedAt: string;
    } | null = null;

    if (stats.source === "roblox_api") {
      // Store sync snapshot in roblox_game_syncs
      const syncData = {
        game_id: selectedGame.id,
        roblox_game_id: selectedGame.roblox_game_id,
        root_place_id: selectedGame.root_place_id,
        name: gameInfo?.name || selectedGame.name,
        ccu: stats.currentPlayers,
        visits: stats.totalVisits,
        favorites: stats.favorites,
        likes: stats.likes,
        dislikes: stats.dislikes,
        max_players: gameInfo?.maxPlayers,
        genre: gameInfo?.genre,
        description: gameInfo?.description,
        thumbnail_url: thumbnailUrl,
        raw: {
          stats,
          gameInfo,
        },
        synced_at: new Date().toISOString(),
      };

      const { error: syncInsertError } = await supabaseAdmin
        .from("roblox_game_syncs")
        .insert(syncData);

      if (syncInsertError) {
        console.error("[Roblox Sync] Error inserting sync:", syncInsertError);
        sectionErrors.gameSync = syncInsertError.message;
      }

      // Also update games table for quick access
      const gameUpdateData: Record<string, unknown> = {
        universe_id: universeId,
        current_players: stats.currentPlayers ?? 0,
        total_visits: stats.totalVisits ?? 0,
        favorites: stats.favorites ?? 0,
        likes: stats.likes ?? 0,
        dislikes: stats.dislikes ?? 0,
        last_roblox_sync: new Date().toISOString(),
        roblox_sync_status: "synced",
      };

      if (thumbnailUrl) {
        gameUpdateData.thumbnail_url = thumbnailUrl;
      }

      if (gameInfo) {
        gameUpdateData.name = gameInfo.name || selectedGame.name;
        gameUpdateData.description = gameInfo.description;
        gameUpdateData.genre = gameInfo.genre;
        gameUpdateData.max_players = gameInfo.maxPlayers;
        if (gameInfo.creator) {
          gameUpdateData.creator_name = gameInfo.creator.name;
          gameUpdateData.creator_type = gameInfo.creator.type;
        }
      }

      await supabaseAdmin
        .from("games")
        .update(gameUpdateData)
        .eq("id", selectedGame.id);

      // Store CCU snapshot for historical charts
      if (stats.currentPlayers !== null) {
        await supabaseAdmin.from("ccu_snapshots").insert({
          game_id: selectedGame.id,
          ccu: stats.currentPlayers,
        });
      }

      gameSync = {
        ccu: stats.currentPlayers,
        visits: stats.totalVisits,
        favorites: stats.favorites,
        likes: stats.likes,
        dislikes: stats.dislikes,
        maxPlayers: gameInfo?.maxPlayers ?? null,
        genre: gameInfo?.genre ?? null,
        syncedAt: new Date().toISOString(),
      };
    } else {
      unavailable.push("roblox_public_stats_not_available");
      sectionErrors.gameStats = "Roblox API returned no data";
    }

    // Fetch and sync products if requested or by default
    let productsSynced = 0;
    let productsData: { gamepasses: number; devProducts: number } | null = null;

    // Get user's Roblox OAuth token
    const { data: profile } = await supabase
      .from("profiles")
      .select("roblox_access_token, roblox_token_expires_at")
      .eq("id", user.id)
      .single();

    const hasValidToken = profile?.roblox_access_token && (
      !profile.roblox_token_expires_at || 
      new Date(profile.roblox_token_expires_at) > new Date()
    );

    if (hasValidToken && profile.roblox_access_token) {
      console.log("[Roblox Sync] Fetching products with OAuth token");
      
      try {
        const [gamepasses, devProducts] = await Promise.all([
          fetchGamepasses(universeId, profile.roblox_access_token),
          fetchDevProducts(universeId, profile.roblox_access_token),
        ]);

        console.log("[Roblox Sync] Fetched", gamepasses.length, "gamepasses");
        console.log("[Roblox Sync] Fetched", devProducts.length, "dev products");

        const allProducts = [...gamepasses, ...devProducts];
        
        // Upsert products into roblox_products table
        for (const product of allProducts) {
          const { error: upsertError } = await supabaseAdmin
            .from("roblox_products")
            .upsert(
              {
                game_id: selectedGame.id,
                roblox_product_id: product.id,
                name: product.name,
                product_type: product.productType,
                price_robux: product.priceRobux,
                is_for_sale: product.isForSale,
                icon_url: product.iconUrl,
                description: product.description,
                raw: product.raw,
                synced_at: new Date().toISOString(),
              },
              { 
                onConflict: "game_id,roblox_product_id,product_type",
                ignoreDuplicates: false 
              }
            );

          if (upsertError) {
            console.error("[Roblox Sync] Error upserting product:", product.id, upsertError);
          } else {
            productsSynced++;
          }
        }

        // Update last products sync timestamp
        await supabaseAdmin
          .from("games")
          .update({ last_products_sync: new Date().toISOString() })
          .eq("id", selectedGame.id);

        productsData = {
          gamepasses: gamepasses.length,
          devProducts: devProducts.length,
        };
      } catch (productError) {
        console.error("[Roblox Sync] Error syncing products:", productError);
        sectionErrors.products = productError instanceof Error ? productError.message : "Failed to sync products";
        unavailable.push("products_sync_failed");
      }
    } else {
      console.log("[Roblox Sync] No valid OAuth token for products sync");
      unavailable.push("products_requires_oauth_connection");
    }

    // Always flag unavailable Creator Dashboard metrics
    unavailable.push(
      "revenue_history_not_available_from_roblox_api",
      "retention_not_available_from_roblox_api",
      "conversion_not_available_from_roblox_api",
      "arppu_not_available_from_roblox_api",
      "product_sales_history_not_available_from_roblox_api"
    );

    console.log("[Roblox Sync] Sync complete. Products synced:", productsSynced);

    return NextResponse.json({
      success: true,
      synced: gameSync !== null || productsSynced > 0,
      gameSync,
      productsSynced,
      productsData,
      unavailable,
      sectionErrors: Object.keys(sectionErrors).length > 0 ? sectionErrors : undefined,
      message: gameSync 
        ? `Roblox data synced. CCU: ${gameSync.ccu ?? 0}, Products: ${productsSynced}` 
        : "Partial sync completed",
    });
  } catch (error) {
    console.error("[Roblox Sync] Error:", error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : "Internal server error",
        unavailable: ["sync_failed"],
      },
      { status: 500 }
    );
  }
}
