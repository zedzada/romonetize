import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Admin client for bypassing RLS
function getSupabaseAdmin() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_CUSTOM_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase configuration");
  }
  
  return createClient(supabaseUrl, serviceRoleKey);
}

/**
 * GET /api/ai/debug - Debug AI context data
 * Shows exactly what data the AI would see
 */
export async function GET(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ 
      success: false, 
      error: "Not authenticated",
      help: "You must be logged in to see AI debug info"
    }, { status: 401 });
  }

  const supabaseAdmin = getSupabaseAdmin();

  try {
    // 1. Check for selected game
    const { data: selectedGame, error: selectedError } = await supabaseAdmin
      .from("games")
      .select("id, name, roblox_game_id, current_players, total_visits, favorites, is_selected, status")
      .eq("user_id", user.id)
      .eq("is_selected", true)
      .neq("status", "deleted")
      .single();

    // 2. Check for any games
    const { data: allGames, error: allGamesError } = await supabaseAdmin
      .from("games")
      .select("id, name, is_selected, status, total_visits, current_players")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5);

    // 3. Pick the game to use
    const targetGame = selectedGame || (allGames && allGames.length > 0 ? allGames[0] : null);

    if (!targetGame) {
      return NextResponse.json({
        success: true,
        hasGame: false,
        reason: "no_games_found",
        userId: user.id,
        selectedGameQuery: { data: selectedGame, error: selectedError?.message },
        allGamesQuery: { data: allGames, error: allGamesError?.message },
      });
    }

    // 4. Query events for this game
    const hours = 168; // 7 days
    const now = new Date();
    const rangeStart = new Date(now.getTime() - hours * 60 * 60 * 1000);

    const { count: eventsCount, error: eventsError } = await supabaseAdmin
      .from("events")
      .select("*", { count: "exact", head: true })
      .eq("game_id", targetGame.id)
      .gte("created_at", rangeStart.toISOString())
      .lte("created_at", now.toISOString());

    // 5. Query purchases
    const { data: purchases, error: purchasesError } = await supabaseAdmin
      .from("events")
      .select("id, event_type, robux, player_id")
      .eq("game_id", targetGame.id)
      .in("event_type", ["purchase_success", "gamepass_purchase", "devproduct_purchase"])
      .gte("created_at", rangeStart.toISOString())
      .lte("created_at", now.toISOString())
      .limit(100);

    // 6. Query products
    const { data: products, error: productsError } = await supabaseAdmin
      .from("roblox_products")
      .select("name, product_type, price_robux")
      .eq("game_id", targetGame.id)
      .limit(10);

    // 7. Calculate hasData
    const hasTrackerEvents = (eventsCount ?? 0) > 0;
    const hasPurchaseEvents = (purchases?.length ?? 0) > 0;
    const hasRobloxStats = !!(targetGame.total_visits || targetGame.current_players);
    const hasProducts = (products?.length ?? 0) > 0;

    const hasData = hasTrackerEvents || hasPurchaseEvents || hasRobloxStats || hasProducts;

    return NextResponse.json({
      success: true,
      hasGame: true,
      hasData,
      hasDataBreakdown: {
        hasTrackerEvents,
        hasPurchaseEvents,
        hasRobloxStats,
        hasProducts,
      },
      game: {
        id: targetGame.id,
        name: targetGame.name,
        isSelected: targetGame.is_selected,
        status: targetGame.status,
        visits: targetGame.total_visits,
        ccu: targetGame.current_players,
      },
      events: {
        count: eventsCount,
        error: eventsError?.message,
        dateRange: { start: rangeStart.toISOString(), end: now.toISOString() },
      },
      purchases: {
        count: purchases?.length ?? 0,
        totalRobux: purchases?.reduce((sum, p) => sum + (p.robux || 0), 0) ?? 0,
        error: purchasesError?.message,
      },
      products: {
        count: products?.length ?? 0,
        error: productsError?.message,
      },
      userId: user.id,
      allGames: allGames?.map(g => ({ 
        id: g.id, 
        name: g.name, 
        isSelected: g.is_selected, 
        status: g.status 
      })),
    });
  } catch (error) {
    console.error("[api/ai/debug] Error:", error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : "Unknown error" 
    }, { status: 500 });
  }
}
