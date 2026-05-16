import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSelectedGameForUser } from "@/lib/server/selected-game";
import { getDashboardMetrics } from "@/lib/server/dashboard-metrics";

/**
 * Debug Metrics Endpoint
 * 
 * GET /api/dashboard/debug-metrics?gameId=...&range=7d
 * 
 * Returns raw diagnostic data to verify analytics are working correctly.
 * Uses the shared getDashboardMetrics helper - SINGLE SOURCE OF TRUTH.
 * 
 * This endpoint NEVER returns fake zeros - if a query fails, it returns an error.
 * 
 * Use this to debug:
 * - Verify events are being tracked for the selected game
 * - Check purchase_success events exist and have robux values
 * - Validate unique players are being counted correctly
 * - Confirm session events are present
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const range = (searchParams.get("range") || "7d") as "1h" | "1d" | "7d" | "30d" | "90d";
    const queryGameId = searchParams.get("gameId");
    
    // Auth check
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ 
        error: "Not authenticated",
        authError: authError?.message,
      }, { status: 401 });
    }
    
    // Get selected game
    let selectedGameId: string | null = queryGameId;
    
    if (!selectedGameId) {
      const { game, error: helperError } = await getSelectedGameForUser(user.id, supabase);
      if (helperError || !game) {
        return NextResponse.json({
          error: "No game selected",
          userId: user.id,
          helperError,
        }, { status: 400 });
      }
      selectedGameId = game.id;
    }
    
    // Use shared helper for consistent metrics
    const metrics = await getDashboardMetrics(user.id, selectedGameId, range);
    
    // Add additional debug info
    return NextResponse.json({
      ...metrics,
      // Add warnings for clarity
      warnings: {
        ccuHeartbeatExcluded: "ccu_heartbeat events are excluded from unique player counts",
        serverPlayerExcluded: "player_id='server' events are excluded from unique player counts",
        nullMeansQueryFailed: "null values indicate a query failure, 0 indicates successful query with no results",
      },
      // Summary for quick validation
      validation: {
        hasEvents: metrics.totalEventsFound !== null && metrics.totalEventsFound > 0,
        hasPurchases: metrics.purchases !== null && metrics.purchases > 0,
        hasRevenue: metrics.grossRevenue !== null && metrics.grossRevenue > 0,
        hasPlayers: metrics.uniquePlayers !== null && metrics.uniquePlayers > 0,
        hasSessions: metrics.totalSessions !== null && metrics.totalSessions > 0,
        hasPayingUsers: metrics.payingUsers !== null && metrics.payingUsers > 0,
        allQueriesSucceeded: metrics.success,
      },
    });
    
  } catch (err) {
    return NextResponse.json({
      error: "Internal server error",
      message: err instanceof Error ? err.message : "Unknown error",
    }, { status: 500 });
  }
}
