import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSelectedGameForUser } from "@/lib/server/selected-game";

/**
 * Roblox Sync Debug Endpoint
 * 
 * GET /api/debug/roblox-sync
 * 
 * Returns diagnostic information about Roblox API sync:
 * - Selected game info
 * - Roblox game ID availability
 * - Latest sync timestamps
 * - Latest CCU snapshot
 * - Environment variable status (without exposing keys)
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Get selected game
    const { game: selectedGame, error: gameError } = await getSelectedGameForUser(user.id, supabase);
    
    if (gameError || !selectedGame) {
      return NextResponse.json({
        error: "No selected game",
        selectedGameId: null,
        selectedGameName: null,
        robloxGameId: null,
        hasRobloxGameId: false,
        latestRobloxSync: null,
        latestCcuSnapshot: null,
        syncAllCcuLastError: null,
        env: {
          hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
          hasServiceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
          hasAnonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        },
        diagnosis: ["NO_SELECTED_GAME: User has no selected game"],
      });
    }

    const now = new Date();

    // Get latest CCU snapshot from Roblox API source
    const { data: latestRobloxSyncData } = await supabase
      .from("ccu_snapshots")
      .select("ccu, source, created_at")
      .eq("game_id", selectedGame.id)
      .in("source", ["roblox_api", "roblox_api_poll", "roblox_api_poll_all"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Get latest CCU snapshot (any source)
    const { data: latestCcuSnapshotData } = await supabase
      .from("ccu_snapshots")
      .select("ccu, source, created_at")
      .eq("game_id", selectedGame.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Check for recent sync errors in logs (if stored)
    // For now, we'll check if there have been any recent sync attempts
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const { count: robloxSyncCount } = await supabase
      .from("ccu_snapshots")
      .select("id", { count: "exact", head: true })
      .eq("game_id", selectedGame.id)
      .in("source", ["roblox_api", "roblox_api_poll", "roblox_api_poll_all"])
      .gte("created_at", oneHourAgo.toISOString());

    // Check tracker CCU snapshots for comparison
    const { count: trackerSyncCount } = await supabase
      .from("ccu_snapshots")
      .select("id", { count: "exact", head: true })
      .eq("game_id", selectedGame.id)
      .eq("source", "romonetize_tracker")
      .gte("created_at", oneHourAgo.toISOString());

    // Calculate ages
    const latestRobloxSyncAge = latestRobloxSyncData?.created_at
      ? Math.round((now.getTime() - new Date(latestRobloxSyncData.created_at).getTime()) / 60000)
      : null;
    const latestCcuSnapshotAge = latestCcuSnapshotData?.created_at
      ? Math.round((now.getTime() - new Date(latestCcuSnapshotData.created_at).getTime()) / 60000)
      : null;

    // Build diagnosis
    const diagnosis: string[] = [];
    
    if (!selectedGame.roblox_game_id) {
      diagnosis.push("NO_ROBLOX_GAME_ID: Game is not linked to a Roblox universe ID - Roblox API sync will not work");
    }
    
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      diagnosis.push("NO_SERVICE_ROLE_KEY: SUPABASE_SERVICE_ROLE_KEY is not set - admin operations will fail");
    }
    
    if (selectedGame.roblox_game_id && (robloxSyncCount ?? 0) === 0) {
      diagnosis.push("NO_ROBLOX_SYNCS_1H: No Roblox API syncs in the last hour - cron job may not be running");
    }
    
    if (latestRobloxSyncAge !== null && latestRobloxSyncAge > 60) {
      diagnosis.push(`STALE_ROBLOX_SYNC: Latest Roblox sync is ${latestRobloxSyncAge} minutes old`);
    }
    
    if ((trackerSyncCount ?? 0) > 0 && (robloxSyncCount ?? 0) === 0) {
      diagnosis.push("TRACKER_ONLY: Only receiving tracker CCU, no Roblox API data");
    }
    
    if (diagnosis.length === 0) {
      diagnosis.push("OK: Roblox sync appears healthy");
    }

    return NextResponse.json({
      selectedGameId: selectedGame.id,
      selectedGameName: selectedGame.name,
      robloxGameId: selectedGame.roblox_game_id,
      hasRobloxGameId: !!selectedGame.roblox_game_id,
      
      latestRobloxSync: latestRobloxSyncData ? {
        ccu: latestRobloxSyncData.ccu,
        source: latestRobloxSyncData.source,
        created_at: latestRobloxSyncData.created_at,
        ageMinutes: latestRobloxSyncAge,
      } : null,
      
      latestCcuSnapshot: latestCcuSnapshotData ? {
        ccu: latestCcuSnapshotData.ccu,
        source: latestCcuSnapshotData.source,
        created_at: latestCcuSnapshotData.created_at,
        ageMinutes: latestCcuSnapshotAge,
      } : null,
      
      syncCountsLast1h: {
        robloxApi: robloxSyncCount ?? 0,
        tracker: trackerSyncCount ?? 0,
      },
      
      // No actual error storage yet, but placeholder for future
      syncAllCcuLastError: null,
      
      env: {
        hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
        hasServiceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        hasAnonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      },
      
      diagnosis,
      
      now: now.toISOString(),
    });
  } catch (error) {
    console.error("[Roblox Sync Debug] Error:", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unknown error",
      selectedGameId: null,
      selectedGameName: null,
      robloxGameId: null,
      hasRobloxGameId: false,
      latestRobloxSync: null,
      latestCcuSnapshot: null,
      syncAllCcuLastError: error instanceof Error ? error.message : "Unknown error",
      env: {
        hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
        hasServiceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        hasAnonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      },
      diagnosis: ["ERROR: " + (error instanceof Error ? error.message : "Unknown error")],
    }, { status: 500 });
  }
}
