import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSelectedGameForUser } from "@/lib/server/selected-game";
import { 
  getPurchaseMetrics, 
  type PurchaseMetricsRange,
  CREATOR_REVENUE_RATE,
} from "@/lib/analytics/purchase-metrics";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Fast Monetization Data API
 * 
 * GET /api/dashboard/monetization-data?range=28d&debug=true
 * 
 * Returns monetization metrics from tracker events only.
 * Uses the SAME shared helper as products-data for consistent numbers.
 * Does NOT call external Roblox APIs to avoid timeouts.
 * Must return within 5 seconds.
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const { searchParams } = new URL(request.url);
    const range = (searchParams.get("range") || "28d") as PurchaseMetricsRange;
    const debug = searchParams.get("debug") === "true";
    
    // Auth
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({
        success: false,
        error: "Not authenticated",
      }, { status: 401 });
    }
    
    // Get selected game
    const { game: selectedGame, error: gameError } = await getSelectedGameForUser(user.id, supabase);
    
    if (gameError || !selectedGame) {
      return NextResponse.json({
        success: true,
        data: {
          hasGame: false,
          summary: {
            purchases: 0,
            payingUsers: 0,
            grossRevenue: 0,
            estimatedRevenue: 0,
            arppu: null,
            payerConversionRate: null,
          },
          timeSeries: [],
          products: [],
          debug: debug ? { error: gameError || "No game selected" } : undefined,
        },
      });
    }
    
    // Get purchase metrics using shared helper (same as products-data)
    const metrics = await getPurchaseMetrics({
      gameId: selectedGame.id,
      range,
      supabase,
    });
    
    const elapsed = Date.now() - startTime;
    
    return NextResponse.json({
      success: true,
      data: {
        hasGame: true,
        selectedGameId: selectedGame.id,
        selectedGameName: selectedGame.name,
        range,
        
        // Summary stats (same calculations as Products page)
        summary: {
          purchases: metrics.purchases,
          payingUsers: metrics.payingUsers,
          activeUsersRaw: metrics.activeUsersRaw,
          activeUsersFixed: metrics.activeUsersFixed,
          grossRevenue: metrics.grossRevenue,
          estimatedRevenue: metrics.estimatedRevenue,
          arppu: metrics.arppu,
          pcr: metrics.pcr,
          arpdau: metrics.arpdau,
          averageDau: metrics.averageDau,
          averageDailyRevenue: metrics.averageDailyRevenue,
          numberOfDays: metrics.numberOfDays,
        },
        
        // Time series for chart
        timeSeries: metrics.timeSeries,
        
        // Products for breakdown pie chart
        products: metrics.products,
        
        // Has tracker events
        hasTrackerEvents: metrics.purchases > 0 || metrics.activeUsers > 0,
        
        // Debug info
        debug: debug ? {
          ...metrics.debug,
          elapsedMs: elapsed,
          creatorRevenueRate: CREATOR_REVENUE_RATE,
          chartPointCount: metrics.timeSeries.length,
        } : undefined,
        
        lastUpdated: new Date().toISOString(),
      },
    });
    
  } catch (err) {
    console.error("[monetization-data] Error:", err);
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : "Internal server error",
    }, { status: 500 });
  }
}
