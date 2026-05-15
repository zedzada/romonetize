import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@supabase/supabase-js";

/**
 * GET /api/cron/status
 * 
 * Returns diagnostic information about cron job execution and CCU snapshot collection.
 * NO AUTH REQUIRED - this is a diagnostic endpoint for debugging cron issues.
 * 
 * Used by:
 * - Debug panel on /dashboard/performance?debug=true
 * - Manual verification that cron is working
 */
export async function GET() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_CUSTOM_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: "Missing Supabase credentials" },
      { status: 500 }
    );
  }

  // Use service role to bypass RLS and see all data
  const supabase = createServerClient(supabaseUrl, supabaseServiceKey);

  const now = new Date();
  const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
  const sixtyMinutesAgo = new Date(now.getTime() - 60 * 60 * 1000);

  // Count connected games (games with roblox_game_id)
  const { count: connectedGamesCount } = await supabase
    .from("games")
    .select("*", { count: "exact", head: true })
    .not("roblox_game_id", "is", null);

  // Count active games (games with status = 'active')
  const { count: activeGamesCount } = await supabase
    .from("games")
    .select("*", { count: "exact", head: true })
    .eq("status", "active");

  // Get snapshots in last 10 minutes (using only existing columns: id, game_id, ccu, created_at)
  const { data: recentSnapshots10, count: rowsLast10Minutes } = await supabase
    .from("ccu_snapshots")
    .select("id, game_id, ccu, created_at", { count: "exact" })
    .gte("created_at", tenMinutesAgo.toISOString())
    .order("created_at", { ascending: false });

  // Get snapshots in last 60 minutes
  const { count: rowsLast60Minutes } = await supabase
    .from("ccu_snapshots")
    .select("*", { count: "exact", head: true })
    .gte("created_at", sixtyMinutesAgo.toISOString());

  // Get latest snapshot
  const { data: latestSnapshot } = await supabase
    .from("ccu_snapshots")
    .select("id, game_id, ccu, created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  const latestSnapshotAt = latestSnapshot?.created_at || null;
  const minutesSinceLatestSnapshot = latestSnapshotAt
    ? Math.round((now.getTime() - new Date(latestSnapshotAt).getTime()) / 60000)
    : null;

  // Calculate expected rows: 1 snapshot per game per minute
  const expectedRowsLast10Minutes = (connectedGamesCount || 0) * 10;
  const expectedRowsLast60Minutes = (connectedGamesCount || 0) * 60;

  // Group recent snapshots by game to show per-game activity
  const gameActivity: Record<string, { count: number; latestCcu: number; latestAt: string }> = {};
  for (const snap of recentSnapshots10 || []) {
    const gameId = snap.game_id;
    if (!gameActivity[gameId]) {
      gameActivity[gameId] = { count: 0, latestCcu: snap.ccu, latestAt: snap.created_at };
    }
    gameActivity[gameId].count++;
  }

  // Determine if cron appears to be working
  // If we have snapshots in the last 10 minutes without browser activity, cron is likely working
  const cronLikelyWorking = (rowsLast10Minutes || 0) > 0 && minutesSinceLatestSnapshot !== null && minutesSinceLatestSnapshot < 5;

  return NextResponse.json({
    // Timestamps
    now: now.toISOString(),
    latestSnapshotAt,
    minutesSinceLatestSnapshot,
    
    // Snapshot counts
    rowsLast10Minutes: rowsLast10Minutes || 0,
    rowsLast60Minutes: rowsLast60Minutes || 0,
    expectedRowsLast10Minutes,
    expectedRowsLast60Minutes,
    
    // Game counts
    connectedGamesCount: connectedGamesCount || 0,
    activeGamesCount: activeGamesCount || 0,
    
    // Per-game activity in last 10 mins
    gamesWithSnapshotsLast10Min: Object.keys(gameActivity).length,
    
    // Configuration
    cronConfigured: !!process.env.CRON_SECRET,
    cronConfiguredPath: "/api/cron/collect-ccu",
    cronFrequency: "* * * * * (every minute)",
    
    // Status
    cronLikelyWorking,
    note: (rowsLast10Minutes || 0) === 0
      ? "No snapshots in last 10 minutes. Verify cron is deployed and running."
      : cronLikelyWorking
        ? "Cron appears to be working - snapshots are being collected."
        : "Snapshots exist but may be from browser polling only.",
  });
}
