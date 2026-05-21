import { NextRequest, NextResponse } from "next/server";
import { handleStripeWebhook, lastWebhookEvent } from "@/lib/stripe-webhook-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET handler for health check / browser testing
export async function GET() {
  const webhookSecretConfigured = !!process.env.STRIPE_WEBHOOK_SECRET;
  
  return NextResponse.json({
    ok: true,
    route: "/api/stripe/webhook",
    webhookSecretConfigured,
    lastWebhookEvent: lastWebhookEvent || null,
    stripeEndpointConfig: {
      expectedUrl: "https://www.romonetize.com/api/stripe/webhook",
      events: [
        "checkout.session.completed",
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
        "invoice.paid",
        "invoice.payment_failed"
      ]
    }
  });
}

// POST handler for Stripe webhook events
export async function POST(request: NextRequest) {
  // CRITICAL: Use request.text() to get raw body for signature verification
  // Do NOT use request.json() - it will break signature verification
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");
  
  const result = await handleStripeWebhook(rawBody, signature, "/api/stripe/webhook");
  
  return NextResponse.json(result.body, { status: result.status });
}
