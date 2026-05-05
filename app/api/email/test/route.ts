import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { Resend } from "resend";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const { email } = body;

    if (!email) {
      return NextResponse.json({ error: "Email required" }, { status: 400 });
    }

    // Check if Resend is configured
    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      // Return success even without Resend for testing
      console.log("[v0] Resend not configured, skipping test email");
      return NextResponse.json({ success: true, message: "Test email would be sent (Resend not configured)" });
    }

    const resend = new Resend(resendApiKey);
    const fromEmail = process.env.FROM_EMAIL || "RoMonetize <noreply@romonetize.com>";

    await resend.emails.send({
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

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[v0] Error sending test email:", error);
    return NextResponse.json({ error: "Failed to send test email" }, { status: 500 });
  }
}
