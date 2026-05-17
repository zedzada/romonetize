import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSelectedGameForUser } from "@/lib/server/selected-game";
import { getGamePerformanceMetrics, type PerformanceRange, ACTIVE_PLAYER_EVENT_TYPES } from "@/lib/helpers/game-performance";

/**
 * Debug endpoint for Game Performance metrics verification
 * 
 * GET /api/debug/game-performance?range=7d
 * 
 * Returns exact values that should match the UI cards
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
    
    // Additional player_id debug query - count root player_id directly
    const { count: rootPlayerIdCount } = await supabase
      .from("events")
      .select("*", { count: "exact", head: true })
      .eq("game_id", targetGameId)
      .in("event_type", ACTIVE_PLAYER_EVENT_TYPES)
      .not("player_id", "is", null)
      .neq("player_id", "server")
      .gte("created_at", metrics.debug.rangeStartUtc)
      .lte("created_at", metrics.debug.rangeEndUtc);
    
    // Get distinct root player_id count via raw SQL (approximate)
    const { data: distinctData } = await supabase
      .from("events")
      .select("player_id")
      .eq("game_id", targetGameId)
      .in("event_type", ACTIVE_PLAYER_EVENT_TYPES)
      .not("player_id", "is", null)
      .neq("player_id", "server")
      .gte("created_at", metrics.debug.rangeStartUtc)
      .lte("created_at", metrics.debug.rangeEndUtc)
      .limit(5000);
    
    const distinctRootPlayers = new Set(distinctData?.map(e => e.player_id).filter(Boolean)).size;
    const sampleRootPlayerIds = Array.from(new Set(distinctData?.map(e => e.player_id).filter(Boolean))).slice(0, 10);
    
    // Format chart debug
    const chartDebug = {
      activityBucketsLength: metrics.charts.activityOverTime.length,
      activityVisualTotal: metrics.charts.activityOverTime.reduce((s, b) => s + b.value, 0),
      sessionsBucketsLength: metrics.charts.playerJoinsOverTime.length,
      sessionsVisualTotal: metrics.charts.playerJoinsOverTime.reduce((s, b) => s + b.value, 0),
      purchasesBucketsLength: metrics.charts.purchasesOverTime.length,
      purchasesVisualTotal: metrics.charts.purchasesOverTime.reduce((s, b) => s + b.value, 0),
      activityBucketSample: metrics.charts.activityOverTime.filter(b => b.value > 0).slice(0, 5),
      sessionsBucketSample: metrics.charts.playerJoinsOverTime.filter(b => b.value > 0).slice(0, 5),
      purchasesBucketSample: metrics.charts.purchasesOverTime.filter(b => b.value > 0).slice(0, 5),
    };
    
    // Return exact format requested
    return NextResponse.json({
      selectedGameId: targetGameId,
      selectedGameName: selectedGame.name,
      range,
      rangeStartUtc: metrics.debug.rangeStartUtc,
      rangeEndUtc: metrics.debug.rangeEndUtc,
      
      // Card values - THESE ARE THE SOURCE OF TRUTH
      trackedActions: metrics.cards.trackedActions,
      uniquePlayers: metrics.cards.uniquePlayers,
      totalSessions: metrics.cards.totalSessions,
      avgSessionSeconds: metrics.cards.avgSessionSeconds,
      newPlayers: metrics.cards.newPlayers,
      purchases: metrics.cards.purchases,
      
      // Event type breakdown
      eventTypeCounts: metrics.debug.eventTypeCounts,
      
      // Player ID debug
      playerIdDebug: {
        rootPlayerIdCount: rootPlayerIdCount ?? 0,
        metadataPlayerIdCount: 0, // We no longer use metadata player_id
        distinctRootPlayers,
        distinctMetadataPlayers: 0, // We no longer use metadata player_id
        sampleRootPlayerIds,
        validPlayerIdCount: metrics.debug.validPlayerIdCount,
        samplePlayerEvents: metrics.debug.samplePlayerEvents,
      },
      
      // Chart debug
      chartDebug,
      
      // Raw debug from helper
      helperDebug: {
        rowsFetched: metrics.debug.rowsFetched,
        exactEventCount: metrics.debug.exactEventCount,
        hitSupabaseLimit: metrics.debug.hitSupabaseLimit,
        mismatches: metrics.debug.mismatches,
        bucketType: metrics.debug.bucketType,
        bucketCount: metrics.debug.bucketCount,
      },
      
      // Summary
      summary: {
        allChartsMatchCards: metrics.debug.mismatches.length === 0,
        activityMatch: metrics.cards.trackedActions === chartDebug.activityVisualTotal,
        sessionsMatch: metrics.cards.totalSessions === chartDebug.sessionsVisualTotal,
        purchasesMatch: metrics.cards.purchases === chartDebug.purchasesVisualTotal,
        newPlayersValid: metrics.cards.newPlayers <= metrics.cards.uniquePlayers,
        noPaginationIssues: !metrics.debug.hitSupabaseLimit,
      },
      
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[v0] Game Performance Debug Error:", error);
    return NextResponse.json({ 
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error"
    }, { status: 500 });
  }
}
