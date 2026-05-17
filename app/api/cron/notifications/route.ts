import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@supabase/supabase-js";
import {
  sendNotificationEmail,
  buildTrackingInactiveEmail,
  buildCcuStoppedEmail,
  buildPurchaseSpikeEmail,
  buildRevenueDropEmail,
  buildLowCreditsEmail,
} from "@/lib/email";

// Vercel cron jobs send CRON_SECRET in Authorization header
const CRON_SECRET = process.env.CRON_SECRET;

// Default thresholds
const DEFAULT_TRACKING_INACTIVE_HOURS = 6;
const DEFAULT_CCU_STOPPED_MINUTES = 10;
const PURCHASE_SPIKE_THRESHOLD_PERCENT = 50; // 50% increase triggers alert
const REVENUE_DROP_THRESHOLD_PERCENT = 30; // 30% drop triggers alert
const LOW_CREDITS_THRESHOLD = 50; // Alert when credits drop below this

interface NotificationSettings {
  user_id: string;
  email_alerts: boolean;
  revenue_drop_alerts: boolean;
  tracking_inactive_alerts?: boolean;
  ccu_stopped_alerts?: boolean;
  purchase_spike_alerts?: boolean;
  low_credits_alerts?: boolean;
  tracking_inactive_hours?: number;
  ccu_stopped_minutes?: number;
}

interface AlertResult {
  type: string;
  user_id: string;
  game_id?: string;
  sent: boolean;
  reason?: string;
}

/**
 * Notifications Cron Job
 * 
 * Runs periodically (every 10 minutes recommended) via Vercel Cron
 * Detects alert conditions and sends notification emails to users
 * 
 * Alert types:
 * 1. tracking_inactive - No tracker events for X hours
 * 2. ccu_stopped - No CCU snapshots/heartbeats for X minutes
 * 3. purchase_spike - Purchases significantly higher than previous period
 * 4. revenue_drop - Revenue significantly lower than previous period
 * 5. low_credits - AI credits running low
 * 
 * Auth: Requires CRON_SECRET for security
 */
export async function GET(request: NextRequest) {
  const startedAt = new Date();
  
  // Auth: Verify CRON_SECRET
  const authHeader = request.headers.get("Authorization");
  const cronSecretHeader = request.headers.get("x-cron-secret");
  const isDev = process.env.NODE_ENV !== "production";
  
  const isValidAuth = 
    authHeader === `Bearer ${CRON_SECRET}` ||
    cronSecretHeader === CRON_SECRET ||
    isDev;
  
  if (!isValidAuth && CRON_SECRET) {
    console.warn("[Notifications Cron] Unauthorized request rejected");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: "Missing Supabase credentials" },
      { status: 500 }
    );
  }

  const supabase = createServerClient(supabaseUrl, supabaseServiceKey);
  const results: AlertResult[] = [];
  
  try {
    // Get all users with their notification settings and email
    const { data: users, error: usersError } = await supabase
      .from("profiles")
      .select(`
        id,
        email,
        user_notification_settings (
          email_alerts,
          revenue_drop_alerts,
          tracking_inactive_alerts,
          ccu_stopped_alerts,
          purchase_spike_alerts,
          low_credits_alerts,
          tracking_inactive_hours,
          ccu_stopped_minutes
        )
      `);

    if (usersError) {
      console.error("[Notifications Cron] Error fetching users:", usersError);
      return NextResponse.json(
        { error: "Failed to fetch users", details: usersError.message },
        { status: 500 }
      );
    }

    if (!users || users.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No users to process",
        alerts: [],
      });
    }

    const now = new Date();

    for (const user of users) {
      if (!user.email) continue;
      
      // Get notification settings (with defaults)
      const settings = (user.user_notification_settings as unknown as NotificationSettings[])?.[0];
      
      // Skip if email alerts are disabled entirely
      if (settings && settings.email_alerts === false) continue;

      // Get user's games
      const { data: games } = await supabase
        .from("games")
        .select("id, name, last_event_at, roblox_game_id")
        .eq("user_id", user.id);

      if (!games || games.length === 0) continue;

      for (const game of games) {
        // === Check 1: Tracking Inactive ===
        if (settings?.tracking_inactive_alerts !== false) {
          const trackingResult = await checkTrackingInactive(
            supabase,
            user.id,
            user.email,
            game,
            settings?.tracking_inactive_hours || DEFAULT_TRACKING_INACTIVE_HOURS,
            now
          );
          if (trackingResult) results.push(trackingResult);
        }

        // === Check 2: CCU Stopped ===
        if (settings?.ccu_stopped_alerts !== false && game.roblox_game_id) {
          const ccuResult = await checkCcuStopped(
            supabase,
            user.id,
            user.email,
            game,
            settings?.ccu_stopped_minutes || DEFAULT_CCU_STOPPED_MINUTES,
            now
          );
          if (ccuResult) results.push(ccuResult);
        }

        // === Check 3: Purchase Spike ===
        if (settings?.purchase_spike_alerts !== false) {
          const spikeResult = await checkPurchaseSpike(
            supabase,
            user.id,
            user.email,
            game,
            now
          );
          if (spikeResult) results.push(spikeResult);
        }

        // === Check 4: Revenue Drop ===
        if (settings?.revenue_drop_alerts !== false) {
          const dropResult = await checkRevenueDrop(
            supabase,
            user.id,
            user.email,
            game,
            now
          );
          if (dropResult) results.push(dropResult);
        }
      }

      // === Check 5: Low Credits ===
      if (settings?.low_credits_alerts !== false) {
        const creditsResult = await checkLowCredits(
          supabase,
          user.id,
          user.email,
          now
        );
        if (creditsResult) results.push(creditsResult);
      }
    }

    const sentCount = results.filter(r => r.sent).length;
    const skippedCount = results.filter(r => !r.sent).length;

    return NextResponse.json({
      success: true,
      message: `Processed ${users.length} users, sent ${sentCount} alerts`,
      usersProcessed: users.length,
      alertsSent: sentCount,
      alertsSkipped: skippedCount,
      results,
      durationMs: Date.now() - startedAt.getTime(),
    });
  } catch (error) {
    console.error("[Notifications Cron] Unexpected error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Unexpected error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

// ========================================
// Alert Detection Functions
// ========================================

async function checkTrackingInactive(
  supabase: ReturnType<typeof createServerClient>,
  userId: string,
  userEmail: string,
  game: { id: string; name: string; last_event_at: string | null },
  thresholdHours: number,
  now: Date
): Promise<AlertResult | null> {
  // Skip if game has never had events
  if (!game.last_event_at) return null;

  const lastEventTime = new Date(game.last_event_at);
  const hoursSinceEvent = (now.getTime() - lastEventTime.getTime()) / (1000 * 60 * 60);

  if (hoursSinceEvent < thresholdHours) return null;

  // Generate fingerprint for deduplication (hourly granularity)
  const dateHour = now.toISOString().slice(0, 13); // YYYY-MM-DDTHH
  const fingerprint = `${userId}:${game.id}:tracking_inactive:${dateHour}`;

  // Check if already sent
  const { data: existing } = await supabase
    .from("notification_events")
    .select("id")
    .eq("fingerprint", fingerprint)
    .single();

  if (existing) {
    return { type: "tracking_inactive", user_id: userId, game_id: game.id, sent: false, reason: "Already sent this hour" };
  }

  // Send email
  const email = buildTrackingInactiveEmail(game.name, Math.floor(hoursSinceEvent));
  const result = await sendNotificationEmail({
    to: userEmail,
    subject: email.subject,
    html: email.html,
  });

  if (result.success) {
    // Record sent notification
    await supabase.from("notification_events").insert({
      user_id: userId,
      game_id: game.id,
      type: "tracking_inactive",
      fingerprint,
      metadata: { hours_inactive: Math.floor(hoursSinceEvent) },
    });
  }

  return {
    type: "tracking_inactive",
    user_id: userId,
    game_id: game.id,
    sent: result.success,
    reason: result.error,
  };
}

async function checkCcuStopped(
  supabase: ReturnType<typeof createServerClient>,
  userId: string,
  userEmail: string,
  game: { id: string; name: string; roblox_game_id: string | null },
  thresholdMinutes: number,
  now: Date
): Promise<AlertResult | null> {
  // Check last CCU snapshot or heartbeat
  const cutoffTime = new Date(now.getTime() - thresholdMinutes * 60 * 1000);

  // Check ccu_snapshots
  const { data: ccuSnapshot } = await supabase
    .from("ccu_snapshots")
    .select("created_at")
    .eq("game_id", game.id)
    .gte("created_at", cutoffTime.toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  // Check server_heartbeats
  const { data: heartbeat } = await supabase
    .from("server_heartbeats")
    .select("last_seen_at")
    .eq("game_id", game.id)
    .gte("last_seen_at", cutoffTime.toISOString())
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .single();

  // If we have recent data, no alert needed
  if (ccuSnapshot || heartbeat) return null;

  // Check if game ever had CCU data
  const { count: totalCcuCount } = await supabase
    .from("ccu_snapshots")
    .select("id", { count: "exact", head: true })
    .eq("game_id", game.id);

  // Don't alert for games that never had CCU tracking
  if (!totalCcuCount || totalCcuCount === 0) return null;

  // Generate fingerprint (10-minute granularity)
  const timeBucket = Math.floor(now.getTime() / (10 * 60 * 1000));
  const fingerprint = `${userId}:${game.id}:ccu_stopped:${timeBucket}`;

  // Check if already sent
  const { data: existing } = await supabase
    .from("notification_events")
    .select("id")
    .eq("fingerprint", fingerprint)
    .single();

  if (existing) {
    return { type: "ccu_stopped", user_id: userId, game_id: game.id, sent: false, reason: "Already sent this period" };
  }

  // Send email
  const email = buildCcuStoppedEmail(game.name, thresholdMinutes);
  const result = await sendNotificationEmail({
    to: userEmail,
    subject: email.subject,
    html: email.html,
  });

  if (result.success) {
    await supabase.from("notification_events").insert({
      user_id: userId,
      game_id: game.id,
      type: "ccu_stopped",
      fingerprint,
      metadata: { minutes_stopped: thresholdMinutes },
    });
  }

  return {
    type: "ccu_stopped",
    user_id: userId,
    game_id: game.id,
    sent: result.success,
    reason: result.error,
  };
}

async function checkPurchaseSpike(
  supabase: ReturnType<typeof createServerClient>,
  userId: string,
  userEmail: string,
  game: { id: string; name: string },
  now: Date
): Promise<AlertResult | null> {
  // Compare last hour to previous hour
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

  // Count purchases in current hour
  const { count: currentCount } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("game_id", game.id)
    .in("event_type", ["purchase", "product_purchase", "gamepass_purchase", "devproduct_purchase"])
    .gte("created_at", oneHourAgo.toISOString())
    .lt("created_at", now.toISOString());

  // Count purchases in previous hour
  const { count: previousCount } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("game_id", game.id)
    .in("event_type", ["purchase", "product_purchase", "gamepass_purchase", "devproduct_purchase"])
    .gte("created_at", twoHoursAgo.toISOString())
    .lt("created_at", oneHourAgo.toISOString());

  const current = currentCount || 0;
  const previous = previousCount || 0;

  // Need at least some baseline and significant increase
  if (previous < 5 || current <= previous) return null;
  
  const percentIncrease = ((current - previous) / previous) * 100;
  if (percentIncrease < PURCHASE_SPIKE_THRESHOLD_PERCENT) return null;

  // Generate fingerprint (hourly)
  const dateHour = now.toISOString().slice(0, 13);
  const fingerprint = `${userId}:${game.id}:purchase_spike:${dateHour}`;

  const { data: existing } = await supabase
    .from("notification_events")
    .select("id")
    .eq("fingerprint", fingerprint)
    .single();

  if (existing) {
    return { type: "purchase_spike", user_id: userId, game_id: game.id, sent: false, reason: "Already sent this hour" };
  }

  const email = buildPurchaseSpikeEmail(game.name, current, previous, percentIncrease);
  const result = await sendNotificationEmail({
    to: userEmail,
    subject: email.subject,
    html: email.html,
  });

  if (result.success) {
    await supabase.from("notification_events").insert({
      user_id: userId,
      game_id: game.id,
      type: "purchase_spike",
      fingerprint,
      metadata: { current_purchases: current, previous_purchases: previous, percent_increase: percentIncrease },
    });
  }

  return {
    type: "purchase_spike",
    user_id: userId,
    game_id: game.id,
    sent: result.success,
    reason: result.error,
  };
}

async function checkRevenueDrop(
  supabase: ReturnType<typeof createServerClient>,
  userId: string,
  userEmail: string,
  game: { id: string; name: string },
  now: Date
): Promise<AlertResult | null> {
  // Compare last 24 hours to previous 24 hours
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  // Sum revenue in current period
  const { data: currentData } = await supabase
    .from("events")
    .select("robux")
    .eq("game_id", game.id)
    .in("event_type", ["purchase", "product_purchase", "gamepass_purchase", "devproduct_purchase"])
    .gte("created_at", oneDayAgo.toISOString())
    .lt("created_at", now.toISOString());

  // Sum revenue in previous period
  const { data: previousData } = await supabase
    .from("events")
    .select("robux")
    .eq("game_id", game.id)
    .in("event_type", ["purchase", "product_purchase", "gamepass_purchase", "devproduct_purchase"])
    .gte("created_at", twoDaysAgo.toISOString())
    .lt("created_at", oneDayAgo.toISOString());

  const currentRevenue = currentData?.reduce((sum, e) => sum + (e.robux || 0), 0) || 0;
  const previousRevenue = previousData?.reduce((sum, e) => sum + (e.robux || 0), 0) || 0;

  // Need significant baseline and significant drop
  if (previousRevenue < 1000 || currentRevenue >= previousRevenue) return null;
  
  const percentDrop = ((previousRevenue - currentRevenue) / previousRevenue) * 100;
  if (percentDrop < REVENUE_DROP_THRESHOLD_PERCENT) return null;

  // Generate fingerprint (daily)
  const dateDay = now.toISOString().slice(0, 10);
  const fingerprint = `${userId}:${game.id}:revenue_drop:${dateDay}`;

  const { data: existing } = await supabase
    .from("notification_events")
    .select("id")
    .eq("fingerprint", fingerprint)
    .single();

  if (existing) {
    return { type: "revenue_drop", user_id: userId, game_id: game.id, sent: false, reason: "Already sent today" };
  }

  const email = buildRevenueDropEmail(game.name, currentRevenue, previousRevenue, percentDrop);
  const result = await sendNotificationEmail({
    to: userEmail,
    subject: email.subject,
    html: email.html,
  });

  if (result.success) {
    await supabase.from("notification_events").insert({
      user_id: userId,
      game_id: game.id,
      type: "revenue_drop",
      fingerprint,
      metadata: { current_revenue: currentRevenue, previous_revenue: previousRevenue, percent_drop: percentDrop },
    });
  }

  return {
    type: "revenue_drop",
    user_id: userId,
    game_id: game.id,
    sent: result.success,
    reason: result.error,
  };
}

async function checkLowCredits(
  supabase: ReturnType<typeof createServerClient>,
  userId: string,
  userEmail: string,
  now: Date
): Promise<AlertResult | null> {
  // Check user's AI credit balance
  const { data: balance } = await supabase
    .from("ai_credit_balances")
    .select("monthly_credits, extra_credits")
    .eq("user_id", userId)
    .single();

  if (!balance) return null;

  const totalCredits = (balance.monthly_credits || 0) + (balance.extra_credits || 0);
  
  if (totalCredits >= LOW_CREDITS_THRESHOLD) return null;

  // Generate fingerprint (daily, per threshold bucket)
  const dateDay = now.toISOString().slice(0, 10);
  const creditBucket = Math.floor(totalCredits / 10) * 10; // Group by 10s
  const fingerprint = `${userId}:low_credits:${creditBucket}:${dateDay}`;

  const { data: existing } = await supabase
    .from("notification_events")
    .select("id")
    .eq("fingerprint", fingerprint)
    .single();

  if (existing) {
    return { type: "low_credits", user_id: userId, sent: false, reason: "Already sent for this credit level today" };
  }

  const email = buildLowCreditsEmail(totalCredits);
  const result = await sendNotificationEmail({
    to: userEmail,
    subject: email.subject,
    html: email.html,
  });

  if (result.success) {
    await supabase.from("notification_events").insert({
      user_id: userId,
      type: "low_credits",
      fingerprint,
      metadata: { credits_remaining: totalCredits },
    });
  }

  return {
    type: "low_credits",
    user_id: userId,
    sent: result.success,
    reason: result.error,
  };
}
