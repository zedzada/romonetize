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

  // Count connected games (games with roblox_game_id)
  const { count: connectedGamesCount } = await supabase
    .from("games")
    .select("*", { count: "exact", head: true })
    .not("roblox_game_id", "is", null);

  // Get snapshots grouped by source in last 10 minutes
  // First, get all snapshots in last 10 minutes
  const { data: recentSnapshots } = await supabase
    .from("ccu_snapshots")
    .select("source, created_at, captured_at")
    .gte("created_at", tenMinutesAgo.toISOString())
    .order("created_at", { ascending: false });

  // Group by source
  const sourceGroups: Record<string, { count: number; latest: string | null }> = {};
  let vercelCronRowsLast10Minutes = 0;
  let robloxApiRowsLast10Minutes = 0;
  
  for (const snap of recentSnapshots || []) {
    const source = snap.source || "unknown";
    if (!sourceGroups[source]) {
      sourceGroups[source] = { count: 0, latest: null };
    }
    sourceGroups[source].count++;
    if (!sourceGroups[source].latest) {
      sourceGroups[source].latest = snap.captured_at || snap.created_at;
    }
    
    if (source === "vercel_cron") {
      vercelCronRowsLast10Minutes++;
    } else if (source === "roblox_api") {
      robloxApiRowsLast10Minutes++;
    }
  }

  // Get latest cron snapshot specifically
  const { data: latestCronSnapshot } = await supabase
    .from("ccu_snapshots")
    .select("created_at, captured_at, source")
    .eq("source", "vercel_cron")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  const latestCronSnapshotAt = latestCronSnapshot?.captured_at || latestCronSnapshot?.created_at || null;
  const minutesSinceLatestCronSnapshot = latestCronSnapshotAt
    ? Math.round((now.getTime() - new Date(latestCronSnapshotAt).getTime()) / 60000)
    : null;

  // Calculate expected rows: 1 snapshot per game per minute = connectedGamesCount * 10
  const expectedRowsLast10Minutes = (connectedGamesCount || 0) * 10;

  // Format latestRowsBySource for easy reading
  const latestRowsBySource = Object.entries(sourceGroups).map(([source, data]) => ({
    source,
    rows: data.count,
    latest: data.latest,
  }));

  return NextResponse.json({
    now: now.toISOString(),
    latestCronSnapshotAt,
    minutesSinceLatestCronSnapshot,
    vercelCronRowsLast10Minutes,
    robloxApiRowsLast10Minutes,
    latestRowsBySource,
    connectedGamesCount: connectedGamesCount || 0,
    expectedRowsLast10Minutes,
    // Diagnostic info
    cronConfigured: !!process.env.CRON_SECRET,
    cronFrequency: "* * * * * (every minute)",
    note: vercelCronRowsLast10Minutes === 0 
      ? "No vercel_cron snapshots found. Run the migration script to add source column, then deploy."
      : undefined,
  });
}
