import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/cron/status
 * 
 * Returns diagnostic information about cron job execution and CCU snapshot collection.
 * Used by the debug panel on /dashboard/performance?debug=true
 */
export async function GET() {
  const supabase = await createClient();
  
  // Get the current user's games
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);

  // Get user's games
  const { data: games } = await supabase
    .from("games")
    .select("id, name, roblox_game_id")
    .eq("user_id", user.id)
    .eq("status", "active");

  const gameIds = games?.map(g => g.id) || [];

  // Get latest snapshots by game
  const latestSnapshotsByGame: Array<{
    game_id: string;
    game_name: string;
    latest_snapshot_at: string | null;
    latest_ccu: number | null;
    snapshots_last_10_min: number;
  }> = [];

  for (const game of games || []) {
    // Get latest snapshot for this game
    const { data: latestSnapshot } = await supabase
      .from("ccu_snapshots")
      .select("ccu, created_at")
      .eq("game_id", game.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // Count snapshots in last 10 minutes
    const { count } = await supabase
      .from("ccu_snapshots")
      .select("*", { count: "exact", head: true })
      .eq("game_id", game.id)
      .gte("created_at", tenMinutesAgo.toISOString());

    latestSnapshotsByGame.push({
      game_id: game.id,
      game_name: game.name || game.roblox_game_id || game.id,
      latest_snapshot_at: latestSnapshot?.created_at || null,
      latest_ccu: latestSnapshot?.ccu ?? null,
      snapshots_last_10_min: count || 0,
    });
  }

  // Get total snapshots inserted in last 10 minutes for user's games
  let totalSnapshotsLast10Min = 0;
  if (gameIds.length > 0) {
    const { count } = await supabase
      .from("ccu_snapshots")
      .select("*", { count: "exact", head: true })
      .in("game_id", gameIds)
      .gte("created_at", tenMinutesAgo.toISOString());
    totalSnapshotsLast10Min = count || 0;
  }

  // Try to get cron_runs data (table may not exist)
  let latestCronRun = null;
  let cronRunsLast10Minutes = 0;
  
  try {
    // Get latest cron run
    const { data: latestRun } = await supabase
      .from("cron_runs")
      .select("*")
      .eq("job_name", "collect-ccu")
      .order("started_at", { ascending: false })
      .limit(1)
      .single();
    
    latestCronRun = latestRun;

    // Count cron runs in last 10 minutes
    const { count } = await supabase
      .from("cron_runs")
      .select("*", { count: "exact", head: true })
      .eq("job_name", "collect-ccu")
      .gte("started_at", tenMinutesAgo.toISOString());
    
    cronRunsLast10Minutes = count || 0;
  } catch {
    // cron_runs table may not exist - that's okay
  }

  return NextResponse.json({
    now: now.toISOString(),
    latestCronRun,
    cronRunsLast10Minutes,
    expectedRunsLast10Minutes: 10, // 1 per minute
    snapshotsInsertedLast10Minutes: totalSnapshotsLast10Min,
    latestSnapshotsByGame,
    gamesCount: games?.length || 0,
    cronConfigured: !!process.env.CRON_SECRET,
    // Note about cron frequency
    cronFrequency: "Every minute (* * * * *)",
  });
}
