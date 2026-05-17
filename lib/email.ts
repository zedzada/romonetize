import { Resend } from "resend";

interface SendEmailParams {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}

interface SendEmailResult {
  success: boolean;
  error?: string;
  messageId?: string;
}

/**
 * Email abstraction layer for sending notification emails.
 * Uses Resend if configured, otherwise logs and returns success for dev/testing.
 * 
 * IMPORTANT: This function is designed to be safe for cron jobs:
 * - Missing provider config does NOT throw or crash
 * - Always returns a result object with success/error status
 */
export async function sendNotificationEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const { to, subject, html, text } = params;
  
  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.FROM_EMAIL || "RoMonetize <noreply@romonetize.com>";
  
  // If Resend is not configured, log warning and return success (dev mode / testing)
  if (!resendApiKey) {
    console.warn("[Email] RESEND_API_KEY not configured - email not sent:", { to, subject });
    return { 
      success: true, 
      error: "Email provider not configured (RESEND_API_KEY missing)" 
    };
  }
  
  try {
    const resend = new Resend(resendApiKey);
    
    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text: text || html.replace(/<[^>]*>/g, ""), // Strip HTML for plain text fallback
    });
    
    if (error) {
      console.error("[Email] Resend error:", error);
      return { success: false, error: error.message };
    }
    
    return { success: true, messageId: data?.id };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown email error";
    console.error("[Email] Unexpected error:", errorMessage);
    return { success: false, error: errorMessage };
  }
}

// ========================================
// Notification Email Templates
// ========================================

const emailWrapper = (content: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">
  <div style="background-color: #ffffff; border-radius: 8px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
    ${content}
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
    <p style="color: #6b7280; font-size: 12px; margin: 0;">
      RoMonetize - Roblox Game Analytics<br/>
      <a href="https://romonetize.com/dashboard/settings" style="color: #3b82f6;">Manage notification preferences</a>
    </p>
  </div>
</body>
</html>
`;

export function buildTrackingInactiveEmail(gameName: string, hoursInactive: number): { subject: string; html: string } {
  return {
    subject: `[Alert] No tracking events from ${gameName} for ${hoursInactive}+ hours`,
    html: emailWrapper(`
      <h2 style="color: #dc2626; margin: 0 0 16px 0;">Tracking Inactive Alert</h2>
      <p style="color: #374151; margin: 0 0 16px 0;">
        Your game <strong>${gameName}</strong> has not sent any tracker events for over <strong>${hoursInactive} hours</strong>.
      </p>
      <p style="color: #374151; margin: 0 0 16px 0;">
        This could mean:
      </p>
      <ul style="color: #374151; margin: 0 0 16px 0; padding-left: 20px;">
        <li>The tracking script was removed or disabled</li>
        <li>Your game has no active players</li>
        <li>There's a connection issue with the tracker</li>
      </ul>
      <p style="color: #374151; margin: 0;">
        <a href="https://romonetize.com/dashboard/game/tracking-setup" style="color: #3b82f6;">Check your tracking setup</a>
      </p>
    `),
  };
}

export function buildCcuStoppedEmail(gameName: string, minutesStopped: number): { subject: string; html: string } {
  return {
    subject: `[Alert] CCU tracking stopped for ${gameName}`,
    html: emailWrapper(`
      <h2 style="color: #dc2626; margin: 0 0 16px 0;">CCU Tracking Stopped</h2>
      <p style="color: #374151; margin: 0 0 16px 0;">
        No CCU snapshots or heartbeats have been received for <strong>${gameName}</strong> in the last <strong>${minutesStopped} minutes</strong>.
      </p>
      <p style="color: #374151; margin: 0 0 16px 0;">
        This typically means the game servers are not sending heartbeat data. Please verify your tracker integration is working correctly.
      </p>
      <p style="color: #374151; margin: 0;">
        <a href="https://romonetize.com/dashboard/game/tracking-setup" style="color: #3b82f6;">Check your tracking setup</a>
      </p>
    `),
  };
}

export function buildPurchaseSpikeEmail(gameName: string, currentPurchases: number, previousPurchases: number, percentIncrease: number): { subject: string; html: string } {
  return {
    subject: `[Alert] Purchase spike detected for ${gameName}`,
    html: emailWrapper(`
      <h2 style="color: #16a34a; margin: 0 0 16px 0;">Purchase Spike Detected</h2>
      <p style="color: #374151; margin: 0 0 16px 0;">
        Great news! <strong>${gameName}</strong> is seeing a significant increase in purchases.
      </p>
      <div style="background-color: #f0fdf4; border-radius: 6px; padding: 16px; margin: 0 0 16px 0;">
        <p style="color: #166534; margin: 0 0 8px 0;">
          <strong>Current Period:</strong> ${currentPurchases} purchases
        </p>
        <p style="color: #166534; margin: 0 0 8px 0;">
          <strong>Previous Period:</strong> ${previousPurchases} purchases
        </p>
        <p style="color: #166534; margin: 0; font-size: 18px;">
          <strong>+${percentIncrease.toFixed(0)}% increase</strong>
        </p>
      </div>
      <p style="color: #374151; margin: 0;">
        <a href="https://romonetize.com/dashboard/monetization" style="color: #3b82f6;">View monetization dashboard</a>
      </p>
    `),
  };
}

export function buildRevenueDropEmail(gameName: string, currentRevenue: number, previousRevenue: number, percentDrop: number): { subject: string; html: string } {
  return {
    subject: `[Alert] Revenue drop detected for ${gameName}`,
    html: emailWrapper(`
      <h2 style="color: #dc2626; margin: 0 0 16px 0;">Revenue Drop Alert</h2>
      <p style="color: #374151; margin: 0 0 16px 0;">
        <strong>${gameName}</strong> has experienced a significant drop in estimated revenue.
      </p>
      <div style="background-color: #fef2f2; border-radius: 6px; padding: 16px; margin: 0 0 16px 0;">
        <p style="color: #991b1b; margin: 0 0 8px 0;">
          <strong>Current Period:</strong> R$${currentRevenue.toLocaleString()}
        </p>
        <p style="color: #991b1b; margin: 0 0 8px 0;">
          <strong>Previous Period:</strong> R$${previousRevenue.toLocaleString()}
        </p>
        <p style="color: #991b1b; margin: 0; font-size: 18px;">
          <strong>-${percentDrop.toFixed(0)}% decrease</strong>
        </p>
      </div>
      <p style="color: #374151; margin: 0;">
        <a href="https://romonetize.com/dashboard/monetization" style="color: #3b82f6;">View monetization dashboard</a>
      </p>
    `),
  };
}

export function buildLowCreditsEmail(remainingCredits: number): { subject: string; html: string } {
  return {
    subject: `[Alert] Low AI credits - ${remainingCredits} remaining`,
    html: emailWrapper(`
      <h2 style="color: #f59e0b; margin: 0 0 16px 0;">Low AI Credits Warning</h2>
      <p style="color: #374151; margin: 0 0 16px 0;">
        Your AI credits are running low. You have <strong>${remainingCredits} credits</strong> remaining.
      </p>
      <p style="color: #374151; margin: 0 0 16px 0;">
        AI features may become unavailable once credits are depleted.
      </p>
      <p style="color: #374151; margin: 0;">
        <a href="https://romonetize.com/pricing" style="color: #3b82f6;">Purchase more credits</a>
      </p>
    `),
  };
}
