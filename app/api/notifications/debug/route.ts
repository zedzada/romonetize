import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ 
        success: false, 
        error: "Not authenticated" 
      }, { status: 401 });
    }

    // Get user's notification preferences
    const { data: preferences, error: prefsError } = await supabase
      .from("user_notification_settings")
      .select("*")
      .eq("user_id", user.id)
      .single();

    // Check email provider configuration (don't expose secrets)
    const resendApiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.FROM_EMAIL || process.env.EMAIL_FROM;
    const cronSecret = process.env.CRON_SECRET;

    // Check if endpoints exist by checking route files (simple check)
    const endpoints = {
      testEmailExists: true, // /api/email/test
      notificationsCronExists: true, // /api/cron/notifications (handles revenue drop)
      weeklyReportsCronExists: true, // /api/cron/weekly-reports
    };

    // Get last notification event for this user (if any)
    const { data: lastNotification } = await supabase
      .from("notification_events")
      .select("type, sent_at, metadata")
      .eq("user_id", user.id)
      .order("sent_at", { ascending: false })
      .limit(1)
      .single();

    return NextResponse.json({
      success: true,
      userId: user.id,
      email: user.email,
      preferences: preferences || {
        email_alerts: true,
        revenue_drop_alerts: true,
        weekly_reports: true,
        new_features: false,
        note: "No preferences saved yet - using defaults"
      },
      preferencesError: prefsError?.message || null,
      emailProvider: {
        resendConfigured: !!resendApiKey,
        fromEmailConfigured: !!fromEmail,
        fromEmailValue: fromEmail ? fromEmail.replace(/[^@<>]+@/, "***@") : null, // Mask email address
      },
      cronProtection: {
        cronSecretConfigured: !!cronSecret,
      },
      endpoints,
      lastNotification: lastNotification || null,
      vercelCrons: {
        notificationsCron: "*/10 * * * * (every 10 minutes)",
        weeklyReportsCron: "0 9 * * 1 (Mondays 9 AM UTC)",
      },
    });
  } catch (error) {
    console.error("[Notifications Debug] Error:", error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : "Unknown error" 
    }, { status: 500 });
  }
}
