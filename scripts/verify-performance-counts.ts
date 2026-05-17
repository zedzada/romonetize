/**
 * SQL Consistency Check Script
 * Verifies that dashboard counts match raw database counts
 * 
 * Usage: node --env-file-if-exists=/vercel/share/.env.project scripts/verify-performance-counts.ts
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  // Get a game with events to test
  const { data: games, error: gamesError } = await supabase
    .from("games")
    .select("id, name, user_id")
    .limit(10);

  if (gamesError || !games?.length) {
    console.error("No games found:", gamesError);
    process.exit(1);
  }

  // Find a game with events
  let selectedGame = null;
  for (const game of games) {
    const { count } = await supabase
      .from("events")
      .select("*", { count: "exact", head: true })
      .eq("game_id", game.id);
    
    if (count && count > 0) {
      selectedGame = { ...game, eventCount: count };
      break;
    }
  }

  if (!selectedGame) {
    console.error("No games with events found");
    process.exit(1);
  }

  console.log("\n========================================");
  console.log("SQL CONSISTENCY CHECK");
  console.log("========================================");
  console.log(`Game ID: ${selectedGame.id}`);
  console.log(`Game Name: ${selectedGame.name}`);
  console.log(`Total Events: ${selectedGame.eventCount}`);
  console.log("========================================\n");

  // SQL Check 1: Event type counts (all time)
  console.log("--- SQL Check 1: Event Type Counts (All Time) ---");
  const { data: eventTypeCounts, error: etError } = await supabase
    .from("events")
    .select("event_type")
    .eq("game_id", selectedGame.id);

  if (etError) {
    console.error("Error fetching events:", etError);
  } else if (eventTypeCounts) {
    const counts: Record<string, { count: number; players: Set<string> }> = {};
    for (const event of eventTypeCounts) {
      if (!counts[event.event_type]) {
        counts[event.event_type] = { count: 0, players: new Set() };
      }
      counts[event.event_type].count++;
    }
    
    console.log("\nEvent Type | Count");
    console.log("-----------|------");
    const sorted = Object.entries(counts).sort((a, b) => b[1].count - a[1].count);
    for (const [type, data] of sorted) {
      console.log(`${type.padEnd(30)} | ${data.count}`);
    }
  }

  // SQL Check 2: Range counts (24h)
  const now = new Date();
  const ranges = [
    { name: "24h", hours: 24 },
    { name: "7d", hours: 168 },
    { name: "28d", hours: 672 },
  ];

  for (const range of ranges) {
    const rangeStart = new Date(now.getTime() - range.hours * 60 * 60 * 1000);
    
    console.log(`\n--- SQL Check 2: Range Counts (${range.name}) ---`);
    console.log(`Range: ${rangeStart.toISOString()} to ${now.toISOString()}`);

    // Get all events in range
    const { data: rangeEvents, error: reError } = await supabase
      .from("events")
      .select("event_type, player_id")
      .eq("game_id", selectedGame.id)
      .gte("created_at", rangeStart.toISOString())
      .lte("created_at", now.toISOString());

    if (reError) {
      console.error("Error fetching range events:", reError);
      continue;
    }

    if (!rangeEvents || rangeEvents.length === 0) {
      console.log("No events in this range");
      continue;
    }

    // Calculate metrics
    const SERVER_ONLY = ["ccu_heartbeat", "script_started"];
    const SESSION_START = ["player_join", "session_start"];
    const PURCHASES = ["purchase_success", "devproduct_purchase", "gamepass_purchase"];
    const ACTIVE_USER_TYPES = ["player_join", "session_start", "session_end", "purchase_success", "devproduct_purchase", "gamepass_purchase"];

    let trackedActions = 0;
    let totalSessions = 0;
    let purchases = 0;
    const uniquePlayerIds = new Set<string>();

    for (const event of rangeEvents) {
      // Tracked actions (exclude server-only)
      if (!SERVER_ONLY.includes(event.event_type)) {
        trackedActions++;
      }

      // Total sessions
      if (SESSION_START.includes(event.event_type)) {
        totalSessions++;
      }

      // Purchases
      if (PURCHASES.includes(event.event_type)) {
        purchases++;
      }

      // Unique players (from active user event types, excluding null and 'server')
      if (
        ACTIVE_USER_TYPES.includes(event.event_type) &&
        event.player_id &&
        event.player_id !== "server"
      ) {
        uniquePlayerIds.add(event.player_id);
      }
    }

    console.log("\n SQL Query Results:");
    console.log(`  tracked_actions:  ${trackedActions}`);
    console.log(`  total_sessions:   ${totalSessions}`);
    console.log(`  purchases:        ${purchases}`);
    console.log(`  unique_players:   ${uniquePlayerIds.size}`);
    console.log(`  total_events:     ${rangeEvents.length}`);
    
    // Output for comparison with dashboard
    console.log("\n Expected Dashboard Values:");
    console.log(`  Tracked Actions card: ${trackedActions}`);
    console.log(`  Total Sessions card:  ${totalSessions}`);
    console.log(`  Purchases card:       ${purchases}`);
    console.log(`  Unique Players card:  ${uniquePlayerIds.size}`);
    console.log(`  Activity Chart Total: ${trackedActions}`);
    console.log(`  Sessions Chart Total: ${totalSessions}`);
    console.log(`  Purchases Chart Total: ${purchases}`);
  }

  console.log("\n========================================");
  console.log("VERIFICATION COMPLETE");
  console.log("========================================");
  console.log("Compare these values with the debug endpoint output at:");
  console.log(`  /api/debug/game-performance?gameId=${selectedGame.id}&range=1d`);
  console.log(`  /api/debug/game-performance?gameId=${selectedGame.id}&range=7d`);
  console.log("========================================\n");
}

main().catch(console.error);
