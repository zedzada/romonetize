import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@supabase/supabase-js";
import { sendNotificationEmail } from "@/lib/email";

// Vercel cron jobs send CRON_SECRET in Authorization header
const CRON_SECRET = process.env.CRON_SECRET;

interface WeeklyStats {
  gameName: string;
  revenue: number;
  purchases: number;
  payingUsers: number;
  pcr: number; // Purchase Conversion Rate
  arppu: number; // Average Revenue Per Paying User
  arpdau: number; // Average Revenue Per Daily Active User
  dau: number;
}

/**
 * Weekly Reports Cron Job
 * 
 * Runs once a week (Monday 9 AM UTC recommended) via Vercel Cron
 * Sends weekly summary emails to users with weekly_reports enabled
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
    console.warn("[Weekly Reports] Unauthorized request rejected");
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
  const results: { userId: string; email: string; sent: boolean; error?: string }[] = [];
  
  try {
    // Get all users with weekly_reports enabled
    const { data: users, error: usersError } = await supabase
      .from("profiles")
      .select(`
        id,
        email,
        user_notification_settings (
          email_alerts,
          weekly_reports
        )
      `);

    if (usersError) {
      console.error("[Weekly Reports] Error fetching users:", usersError);
      return NextResponse.json(
        { error: "Failed to fetch users", details: usersError.message },
        { status: 500 }
      );
    }

    if (!users || users.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No users to process",
        reportsSent: 0,
      });
    }

    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    for (const user of users) {
      if (!user.email) continue;
      
      // Get notification settings
      const settings = (user.user_notification_settings as unknown as { email_alerts: boolean; weekly_reports: boolean }[])?.[0];
      
      // Skip if email alerts or weekly reports are disabled
      if (settings?.email_alerts === false || settings?.weekly_reports === false) {
        continue;
      }

      // Get user's games
      const { data: games } = await supabase
        .from("games")
        .select("id, name")
        .eq("user_id", user.id);

      if (!games || games.length === 0) continue;

      // Collect stats for all games
      const gameStats: WeeklyStats[] = [];

      for (const game of games) {
        // Get events for the past week
        const { data: events } = await supabase
          .from("events")
          .select("event_type, robux, player_id")
          .eq("game_id", game.id)
          .gte("created_at", oneWeekAgo.toISOString())
          .lt("created_at", now.toISOString());

        if (!events || events.length === 0) continue;

        // Calculate stats
        const purchaseEvents = events.filter(e => 
          ["purchase", "product_purchase", "gamepass_purchase", "devproduct_purchase"].includes(e.event_type)
        );
        
        const revenue = purchaseEvents.reduce((sum, e) => sum + (e.robux || 0), 0);
        const purchases = purchaseEvents.length;
        const payingUsers = new Set(purchaseEvents.map(e => e.player_id).filter(Boolean)).size;
        const uniquePlayers = new Set(events.map(e => e.player_id).filter(Boolean)).size;
        
        // DAU approximation: unique players / 7 days
        const dau = Math.round(uniquePlayers / 7);
        
        // PCR: paying users / unique players
        const pcr = uniquePlayers > 0 ? (payingUsers / uniquePlayers) * 100 : 0;
        
        // ARPPU: revenue / paying users
        const arppu = payingUsers > 0 ? revenue / payingUsers : 0;
        
        // ARPDAU: revenue / (DAU * 7 days)
        const arpdau = dau > 0 ? revenue / (dau * 7) : 0;

        gameStats.push({
          gameName: game.name,
          revenue,
          purchases,
          payingUsers,
          pcr,
          arppu,
          arpdau,
          dau,
        });
      }

      // Skip if no game data
      if (gameStats.length === 0) continue;

      // Build and send email
      const emailHtml = buildWeeklyReportEmail(gameStats, oneWeekAgo, now);
      const result = await sendNotificationEmail({
        to: user.email,
        subject: `Your Weekly RoMonetize Report - ${formatDateRange(oneWeekAgo, now)}`,
        html: emailHtml,
      });

      results.push({
        userId: user.id,
        email: user.email,
        sent: result.success,
        error: result.error,
      });
    }

    const sentCount = results.filter(r => r.sent).length;

    return NextResponse.json({
      success: true,
      message: `Sent ${sentCount} weekly reports`,
      usersProcessed: users.length,
      reportsSent: sentCount,
      results,
      durationMs: Date.now() - startedAt.getTime(),
    });
  } catch (error) {
    console.error("[Weekly Reports] Unexpected error:", error);
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

function formatDateRange(start: Date, end: Date): string {
  const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${start.toLocaleDateString("en-US", options)} - ${end.toLocaleDateString("en-US", options)}`;
}

function buildWeeklyReportEmail(stats: WeeklyStats[], startDate: Date, endDate: Date): string {
  const totalRevenue = stats.reduce((sum, s) => sum + s.revenue, 0);
  const totalPurchases = stats.reduce((sum, s) => sum + s.purchases, 0);
  const totalPayingUsers = stats.reduce((sum, s) => sum + s.payingUsers, 0);

  const gameRows = stats.map(s => `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; font-weight: 500;">${s.gameName}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">R$${s.revenue.toLocaleString()}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">${s.purchases}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">${s.payingUsers}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">${s.pcr.toFixed(1)}%</td>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">R$${s.arppu.toFixed(0)}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">R$${s.arpdau.toFixed(2)}</td>
    </tr>
  `).join("");

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">
  <div style="background-color: #ffffff; border-radius: 8px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
    <h1 style="color: #1f2937; margin: 0 0 8px 0; font-size: 24px;">Weekly Report</h1>
    <p style="color: #6b7280; margin: 0 0 24px 0;">${formatDateRange(startDate, endDate)}</p>
    
    <div style="display: flex; gap: 16px; margin-bottom: 24px;">
      <div style="flex: 1; background: #f0fdf4; border-radius: 8px; padding: 16px; text-align: center;">
        <p style="color: #166534; margin: 0 0 4px 0; font-size: 24px; font-weight: bold;">R$${totalRevenue.toLocaleString()}</p>
        <p style="color: #15803d; margin: 0; font-size: 14px;">Total Revenue</p>
      </div>
      <div style="flex: 1; background: #eff6ff; border-radius: 8px; padding: 16px; text-align: center;">
        <p style="color: #1d4ed8; margin: 0 0 4px 0; font-size: 24px; font-weight: bold;">${totalPurchases}</p>
        <p style="color: #2563eb; margin: 0; font-size: 14px;">Purchases</p>
      </div>
      <div style="flex: 1; background: #fdf4ff; border-radius: 8px; padding: 16px; text-align: center;">
        <p style="color: #a21caf; margin: 0 0 4px 0; font-size: 24px; font-weight: bold;">${totalPayingUsers}</p>
        <p style="color: #c026d3; margin: 0; font-size: 14px;">Paying Users</p>
      </div>
    </div>
    
    <h2 style="color: #374151; margin: 0 0 16px 0; font-size: 18px;">Game Performance</h2>
    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
      <thead>
        <tr style="background: #f9fafb;">
          <th style="padding: 12px; text-align: left; border-bottom: 2px solid #e5e7eb;">Game</th>
          <th style="padding: 12px; text-align: right; border-bottom: 2px solid #e5e7eb;">Revenue</th>
          <th style="padding: 12px; text-align: right; border-bottom: 2px solid #e5e7eb;">Purchases</th>
          <th style="padding: 12px; text-align: right; border-bottom: 2px solid #e5e7eb;">Paying Users</th>
          <th style="padding: 12px; text-align: right; border-bottom: 2px solid #e5e7eb;">PCR</th>
          <th style="padding: 12px; text-align: right; border-bottom: 2px solid #e5e7eb;">ARPPU</th>
          <th style="padding: 12px; text-align: right; border-bottom: 2px solid #e5e7eb;">ARPDAU</th>
        </tr>
      </thead>
      <tbody>
        ${gameRows}
      </tbody>
    </table>
    
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
    <p style="color: #6b7280; font-size: 12px; margin: 0;">
      RoMonetize - Roblox Game Analytics<br/>
      <a href="https://romonetize.com/dashboard" style="color: #3b82f6;">View full dashboard</a> |
      <a href="https://romonetize.com/dashboard/settings" style="color: #3b82f6;">Manage notification preferences</a>
    </p>
  </div>
</body>
</html>
  `;
}
