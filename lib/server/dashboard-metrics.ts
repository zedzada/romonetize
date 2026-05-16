import { createClient } from "@/lib/supabase/server";
import { CREATOR_REVENUE_RATE } from "@/lib/utils/product-aggregation";

/**
 * Shared Dashboard Metrics Helper
 * 
 * SINGLE SOURCE OF TRUTH for all dashboard analytics.
 * Used by: Overview, Game Performance, Monetization, Products, AI Assistant.
 * 
 * Key principles:
 * 1. NEVER return fake zeros - if a query fails, return null with error message
 * 2. Use internal Supabase game_id (not roblox_game_id or universe_id)
 * 3. Support both root fields and metadata for event data
 * 4. Exclude ccu_heartbeat and player_id="server" from player counts
 */

export interface DashboardMetricsResult {
  // Success flag
  success: boolean;
  
  // Identity
  userId: string;
  selectedGameId: string;
  selectedGameName: string;
  robloxGameId: string | null;
  rangeStart: string;
  rangeEnd: string;
  
  // Event counts - null means query failed (NOT zero)
  totalEventsFound: number | null;
  eventTypeCounts: Record<string, number>;
  
  // Engagement metrics - null means query failed (NOT zero)
  trackedActions: number | null;
  uniquePlayers: number | null;
  totalSessions: number | null;
  avgSessionSeconds: number | null;
  newPlayers: number | null;
  
  // Monetization metrics - null means query failed (NOT zero)
  purchases: number | null;
  grossRevenue: number | null;
  estimatedRevenue: number | null;
  payingUsers: number | null;
  activeUsers: number | null;
  
  // Derived metrics - null if inputs are null or denominator is 0
  pcr: number | null; // Payer Conversion Rate (payingUsers / activeUsers * 100)
  arppu: number | null; // Average Revenue Per Paying User (grossRevenue / payingUsers)
  arpdau: number | null; // Average Revenue Per DAU (dailyRevenue / DAU)
  
  // Products
  productsCount: number | null;
  
  // Sample data for debugging
  samplePurchaseEvents: Array<{
    id: string;
    event_type: string;
    player_id: string | null;
    product_id: string | null;
    product_name: string | null;
    product_type: string | null;
    robux: number | null;
    metadata_robux: number | null;
    created_at: string;
  }>;
  
  // Errors - only present if queries failed
  errors: Record<string, string>;
}

type DateRange = "1h" | "1d" | "7d" | "30d" | "90d";

function getRangeHours(range: DateRange): number {
  switch (range) {
    case "1h": return 1;
    case "1d": return 24;
    case "7d": return 168;
    case "30d": return 720;
    case "90d": return 2160;
    default: return 168;
  }
}

// Event types that indicate player activity (excluding server-side events)
const PLAYER_ACTIVITY_TYPES = [
  "player_join",
  "session_start",
  "session_end",
  "player_leave",
  "purchase_success",
  "gamepass_purchase",
  "devproduct_purchase",
  "product_click",
  "gamepass_click",
  "devproduct_click",
  "gamepass_prompt",
  "devproduct_prompt",
  "product_view",
  "shop_open",
];

const SESSION_START_TYPES = ["player_join", "session_start"];
const PURCHASE_TYPES = ["purchase_success", "gamepass_purchase", "devproduct_purchase"];

/**
 * Get dashboard metrics for a specific game and date range.
 * 
 * IMPORTANT: This function NEVER returns fake zeros.
 * - If a query fails, the corresponding metric is null and an error is recorded.
 * - If a query succeeds with 0 results, the metric is 0 (which is correct).
 */
export async function getDashboardMetrics(
  userId: string,
  selectedGameId: string,
  range: DateRange = "7d"
): Promise<DashboardMetricsResult> {
  const errors: Record<string, string> = {};
  
  const supabase = await createClient();
  
  // Get game info
  const { data: game, error: gameError } = await supabase
    .from("games")
    .select("id, name, roblox_game_id")
    .eq("id", selectedGameId)
    .eq("user_id", userId)
    .neq("status", "deleted")
    .single();
  
  if (gameError || !game) {
    return {
      success: false,
      userId,
      selectedGameId,
      selectedGameName: "Unknown",
      robloxGameId: null,
      rangeStart: "",
      rangeEnd: "",
      totalEventsFound: null,
      eventTypeCounts: {},
      trackedActions: null,
      uniquePlayers: null,
      totalSessions: null,
      avgSessionSeconds: null,
      newPlayers: null,
      purchases: null,
      grossRevenue: null,
      estimatedRevenue: null,
      payingUsers: null,
      activeUsers: null,
      pcr: null,
      arppu: null,
      arpdau: null,
      productsCount: null,
      samplePurchaseEvents: [],
      errors: { game: gameError?.message || "Game not found" },
    };
  }
  
  const hours = getRangeHours(range);
  const now = new Date();
  const rangeStart = new Date(now.getTime() - hours * 60 * 60 * 1000);
  const rangeEnd = now;
  const gameId = game.id;
  
  // Initialize result with nulls (not zeros)
  const result: DashboardMetricsResult = {
    success: true,
    userId,
    selectedGameId: gameId,
    selectedGameName: game.name,
    robloxGameId: game.roblox_game_id,
    rangeStart: rangeStart.toISOString(),
    rangeEnd: rangeEnd.toISOString(),
    totalEventsFound: null,
    eventTypeCounts: {},
    trackedActions: null,
    uniquePlayers: null,
    totalSessions: null,
    avgSessionSeconds: null,
    newPlayers: null,
    purchases: null,
    grossRevenue: null,
    estimatedRevenue: null,
    payingUsers: null,
    activeUsers: null,
    pcr: null,
    arppu: null,
    arpdau: null,
    productsCount: null,
    samplePurchaseEvents: [],
    errors,
  };
  
  // Query 1: Total events count
  try {
    const { count, error } = await supabase
      .from("events")
      .select("*", { count: "exact", head: true })
      .eq("game_id", gameId)
      .gte("created_at", rangeStart.toISOString())
      .lte("created_at", rangeEnd.toISOString());
    
    if (error) {
      errors.totalEventsFound = error.message;
    } else {
      result.totalEventsFound = count ?? 0;
      result.trackedActions = count ?? 0;
    }
  } catch (err) {
    errors.totalEventsFound = err instanceof Error ? err.message : "Unknown error";
  }
  
  // Query 2: Event type counts
  try {
    const { data, error } = await supabase
      .from("events")
      .select("event_type")
      .eq("game_id", gameId)
      .gte("created_at", rangeStart.toISOString())
      .lte("created_at", rangeEnd.toISOString());
    
    if (error) {
      errors.eventTypeCounts = error.message;
    } else if (data) {
      const counts: Record<string, number> = {};
      data.forEach((e: { event_type: string }) => {
        counts[e.event_type] = (counts[e.event_type] || 0) + 1;
      });
      result.eventTypeCounts = counts;
    }
  } catch (err) {
    errors.eventTypeCounts = err instanceof Error ? err.message : "Unknown error";
  }
  
  // Query 3: Unique players (excluding ccu_heartbeat and server)
  try {
    const { data, error } = await supabase
      .from("events")
      .select("player_id")
      .eq("game_id", gameId)
      .gte("created_at", rangeStart.toISOString())
      .lte("created_at", rangeEnd.toISOString())
      .in("event_type", PLAYER_ACTIVITY_TYPES)
      .not("player_id", "is", null)
      .neq("player_id", "server")
      .neq("player_id", "");
    
    if (error) {
      errors.uniquePlayers = error.message;
    } else if (data) {
      const playerIds = new Set(data.map((e: { player_id: string }) => e.player_id));
      result.uniquePlayers = playerIds.size;
      result.activeUsers = playerIds.size;
    }
  } catch (err) {
    errors.uniquePlayers = err instanceof Error ? err.message : "Unknown error";
  }
  
  // Query 4: Total sessions
  try {
    const { count, error } = await supabase
      .from("events")
      .select("*", { count: "exact", head: true })
      .eq("game_id", gameId)
      .in("event_type", SESSION_START_TYPES)
      .gte("created_at", rangeStart.toISOString())
      .lte("created_at", rangeEnd.toISOString());
    
    if (error) {
      errors.totalSessions = error.message;
    } else {
      result.totalSessions = count ?? 0;
    }
  } catch (err) {
    errors.totalSessions = err instanceof Error ? err.message : "Unknown error";
  }
  
  // Query 5: Avg session duration from session_end metadata
  try {
    const { data, error } = await supabase
      .from("events")
      .select("metadata")
      .eq("game_id", gameId)
      .in("event_type", ["session_end", "player_leave"])
      .gte("created_at", rangeStart.toISOString())
      .lte("created_at", rangeEnd.toISOString())
      .limit(500);
    
    if (error) {
      errors.avgSessionSeconds = error.message;
    } else if (data && data.length > 0) {
      const durations: number[] = [];
      data.forEach((e: { metadata: Record<string, unknown> | null }) => {
        const duration = e.metadata?.duration_seconds || e.metadata?.session_duration;
        if (typeof duration === "number" && duration > 0 && duration < 86400) {
          durations.push(duration);
        }
      });
      if (durations.length > 0) {
        result.avgSessionSeconds = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
      } else {
        result.avgSessionSeconds = 0;
      }
    } else {
      result.avgSessionSeconds = 0;
    }
  } catch (err) {
    errors.avgSessionSeconds = err instanceof Error ? err.message : "Unknown error";
  }
  
  // Query 6: Purchase events (with full data for revenue calculation)
  try {
    const { data, error } = await supabase
      .from("events")
      .select("id, event_type, player_id, product_id, product_name, product_type, robux, metadata, created_at")
      .eq("game_id", gameId)
      .in("event_type", PURCHASE_TYPES)
      .gte("created_at", rangeStart.toISOString())
      .lte("created_at", rangeEnd.toISOString());
    
    if (error) {
      errors.purchases = error.message;
    } else if (data) {
      result.purchases = data.length;
      
      // Calculate revenue (support both root field and metadata)
      let totalRobux = 0;
      const payerIds = new Set<string>();
      const productIds = new Set<string>();
      
      data.forEach((e: { 
        player_id: string | null; 
        product_id: string | null;
        robux: number | null; 
        metadata: Record<string, unknown> | null;
      }) => {
        // Get robux from root field OR metadata
        const robux = e.robux ?? (e.metadata?.robux as number | undefined) ?? 0;
        totalRobux += Number(robux) || 0;
        
        // Track paying users
        if (e.player_id && e.player_id !== "server" && e.player_id !== "") {
          payerIds.add(e.player_id);
        }
        
        // Track unique products
        const productId = e.product_id ?? (e.metadata?.product_id as string | undefined);
        if (productId) {
          productIds.add(String(productId));
        }
      });
      
      result.grossRevenue = totalRobux;
      result.estimatedRevenue = Math.round(totalRobux * CREATOR_REVENUE_RATE);
      result.payingUsers = payerIds.size;
      result.productsCount = productIds.size;
      
      // Sample purchase events for debugging
      result.samplePurchaseEvents = data.slice(0, 5).map((e: {
        id: string;
        event_type: string;
        player_id: string | null;
        product_id: string | null;
        product_name: string | null;
        product_type: string | null;
        robux: number | null;
        metadata: Record<string, unknown> | null;
        created_at: string;
      }) => ({
        id: e.id,
        event_type: e.event_type,
        player_id: e.player_id,
        product_id: e.product_id ?? (e.metadata?.product_id as string | undefined) ?? null,
        product_name: e.product_name ?? (e.metadata?.product_name as string | undefined) ?? null,
        product_type: e.product_type ?? (e.metadata?.product_type as string | undefined) ?? null,
        robux: e.robux,
        metadata_robux: (e.metadata?.robux as number | undefined) ?? null,
        created_at: e.created_at,
      }));
    } else {
      result.purchases = 0;
      result.grossRevenue = 0;
      result.estimatedRevenue = 0;
      result.payingUsers = 0;
      result.productsCount = 0;
    }
  } catch (err) {
    errors.purchases = err instanceof Error ? err.message : "Unknown error";
  }
  
  // Calculate derived metrics (only if inputs are valid)
  
  // PCR = payingUsers / activeUsers * 100
  if (result.payingUsers !== null && result.activeUsers !== null && result.activeUsers > 0) {
    result.pcr = (result.payingUsers / result.activeUsers) * 100;
  }
  
  // ARPPU = grossRevenue / payingUsers
  if (result.grossRevenue !== null && result.payingUsers !== null && result.payingUsers > 0) {
    result.arppu = result.grossRevenue / result.payingUsers;
  }
  
  // ARPDAU = dailyRevenue / DAU
  // For this we need to calculate average daily revenue and average DAU
  // Simplified: totalRevenue / (days * avgDAU) ≈ totalRevenue / uniquePlayers for the period
  if (result.grossRevenue !== null && result.activeUsers !== null && result.activeUsers > 0) {
    // Use a simple approximation: ARPDAU ≈ total revenue / active users
    // This is correct for 1-day range, an approximation for longer ranges
    result.arpdau = result.grossRevenue / result.activeUsers;
  }
  
  // Update errors
  result.errors = errors;
  result.success = Object.keys(errors).length === 0;
  
  return result;
}
