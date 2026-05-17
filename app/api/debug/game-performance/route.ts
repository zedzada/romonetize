import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSelectedGameForUser } from "@/lib/server/selected-game";
import { getGamePerformanceMetrics, type PerformanceRange } from "@/lib/helpers/game-performance";

/**
 * Debug endpoint for Game Performance metrics verification
 * 
 * GET /api/debug/game-performance?range=7d
 * 
 * Returns card values, chart totals, and any mismatches
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    
    const { searchParams } = new URL(request.url);
    const range = (searchParams.get("range") || "7d") as PerformanceRange;
    const gameIdParam = searchParams.get("gameId");
    
    // Get selected game
    const { selectedGame, error: gameError } = await getSelectedGameForUser(user.id);
    
    if (gameError || !selectedGame) {
      return NextResponse.json({ 
        error: "No game selected",
        details: gameError 
      }, { status: 400 });
    }
    
    // Use gameId param if provided, otherwise use selected game
    const targetGameId = gameIdParam || selectedGame.id;
    
    // Get performance metrics using shared helper
    const metrics = await getGamePerformanceMetrics({
      userId: user.id,
      selectedGameId: targetGameId,
      selectedGameName: selectedGame.name,
      range,
    });
    
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      ...metrics.debug,
      
      // Add summary
      summary: {
        allChartsMatchCards: metrics.debug.mismatches.length === 0,
        activityMatch: metrics.debug.trackedActionsCard === metrics.debug.activityChartTotal,
        sessionsMatch: metrics.debug.totalSessionsCard === metrics.debug.playerJoinsChartTotal,
        purchasesMatch: metrics.debug.purchasesCard === metrics.debug.purchasesChartTotal,
        newPlayersValid: metrics.debug.newPlayers <= metrics.debug.uniquePlayers,
        noPaginationIssues: !metrics.debug.hitSupabaseLimit,
      },
    });
  } catch (error) {
    console.error("[v0] Game Performance Debug Error:", error);
    return NextResponse.json({ 
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error"
    }, { status: 500 });
  }
}
