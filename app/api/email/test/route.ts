import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { Resend } from "resend";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ 
        success: false, 
        error: "Not authenticated" 
      }, { status: 401 });
    }

    const body = await request.json();
    const { email } = body;

    if (!email) {
      return NextResponse.json({ 
        success: false, 
        error: "Email required" 
      }, { status: 400 });
    }

    // Check notification settings - is email_alerts enabled?
    const { data: settings } = await supabase
      .from("user_notification_settings")
      .select("email_alerts")
      .eq("user_id", user.id)
      .single();

    if (settings && settings.email_alerts === false) {
      return NextResponse.json({ 
        success: false, 
        error: "Email alerts are disabled in your settings. Enable them first." 
      });
    }

    // Check if Resend is configured - do NOT fake success
    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      return NextResponse.json({ 
        success: false, 
        error: "Missing RESEND_API_KEY - email provider not configured" 
      });
    }

    const fromEmail = process.env.FROM_EMAIL || process.env.EMAIL_FROM;
    if (!fromEmail) {
      return NextResponse.json({ 
        success: false, 
        error: "Missing FROM_EMAIL or EMAIL_FROM - sender address not configured" 
      });
    }

    const resend = new Resend(resendApiKey);

    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: email,
      subject: "RoMonetize Test Email",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #3b82f6;">Test Email from RoMonetize</h1>
          <p>This is a test email to confirm your notification settings are working correctly.</p>
          <p>You will receive alerts and reports at this email address when enabled in your settings.</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
          <p style="color: #6b7280; font-size: 12px;">RoMonetize - Roblox Game Analytics</p>
        </div>
      `,
    });

    if (error) {
      console.error("[Test Email] Resend error:", error);
      return NextResponse.json({ 
        success: false, 
        error: `Email send failed: ${error.message}` 
      });
    }

    return NextResponse.json({ 
      success: true, 
      message: "Test email sent successfully",
      messageId: data?.id 
    });
  } catch (error) {
    console.error("[Test Email] Error:", error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : "Failed to send test email" 
    }, { status: 500 });
  }
}
