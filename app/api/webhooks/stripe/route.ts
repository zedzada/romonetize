import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createClient } from "@supabase/supabase-js";
import { getPlanById, PRICING_PLANS, getAiCreditsForPlan } from "@/lib/products";
import Stripe from "stripe";

// Track processed sessions to prevent duplicate credit grants
const processedSessions = new Set<string>();

// Lazy init for service role client
function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: NextRequest) {
  const stripe = getStripe();
  const supabaseAdmin = getSupabaseAdmin();
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutCompleted(session);
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpdate(subscription);
        break;
      }
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(subscription);
        break;
      }
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        await handlePaymentSucceeded(invoice);
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        await handlePaymentFailed(invoice);
        break;
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Webhook handler error:", error);
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const sessionId = session.id;
  
  // Idempotency check - prevent duplicate processing
  if (processedSessions.has(sessionId)) {
    console.log("Session already processed:", sessionId);
    return;
  }
  processedSessions.add(sessionId);

  // Check if this is a credit purchase
  const purchaseType = session.metadata?.purchaseType;
  if (purchaseType === "ai_credits") {
    await handleCreditPurchase(session);
    return;
  }

  // Otherwise, handle subscription checkout
  const userId = session.metadata?.user_id;
  const planId = session.metadata?.plan_id;

  if (!userId || !planId) {
    console.error("Missing metadata in checkout session");
    return;
  }

  const plan = getPlanById(planId);
  if (!plan) return;

  // Update profile with new plan
  await supabaseAdmin
    .from("profiles")
    .update({
      plan: planId,
      subscription_status: "active",
      stripe_customer_id: session.customer as string,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  // Update usage limits for the new plan
  const monthYear = new Date().toISOString().slice(0, 7);
  await supabaseAdmin
    .from("usage_limits")
    .upsert({
      user_id: userId,
      month_year: monthYear,
      events_limit: plan.limits.eventsPerMonth,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: "user_id,month_year",
    });

  // Grant initial monthly AI credits for new subscription
  const aiCredits = getAiCreditsForPlan(planId);
  if (aiCredits > 0) {
    await grantMonthlyCredits(userId, aiCredits);
  }
}

// Handle AI credit purchases
async function handleCreditPurchase(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.userId;
  const credits = parseInt(session.metadata?.credits || "0", 10);
  const packageId = session.metadata?.packageId;

  if (!userId || !credits || credits <= 0) {
    console.error("Invalid credit purchase metadata:", session.metadata);
    return;
  }

  console.log(`Processing credit purchase: ${credits} credits for user ${userId}`);

  // Get current balance
  const { data: balance } = await supabaseAdmin
    .from("ai_credit_balances")
    .select("extra_credits, monthly_credits")
    .eq("user_id", userId)
    .single();

  const currentExtraCredits = balance?.extra_credits || 0;
  const newExtraCredits = currentExtraCredits + credits;
  const totalCredits = (balance?.monthly_credits || 0) + newExtraCredits;

  // Update balance - only increment extra_credits, never touch monthly_credits
  const { error: updateError } = await supabaseAdmin
    .from("ai_credit_balances")
    .upsert({
      user_id: userId,
      monthly_credits: balance?.monthly_credits || 0,
      extra_credits: newExtraCredits,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: "user_id",
    });

  if (updateError) {
    console.error("Error granting credits:", updateError);
    return;
  }

  // Record transaction with idempotency
  await supabaseAdmin
    .from("ai_credit_transactions")
    .insert({
      user_id: userId,
      type: `purchase_${credits}`,
      amount: credits,
      balance_after: totalCredits,
      metadata: {
        packageId,
        stripe_session_id: session.id,
        stripe_payment_intent: session.payment_intent,
      },
      created_at: new Date().toISOString(),
    });

  console.log(`Granted ${credits} extra credits to user ${userId}. New extra balance: ${newExtraCredits}`);
}

// Grant monthly credits for subscription
async function grantMonthlyCredits(userId: string, credits: number) {
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  // Get current balance to preserve extra_credits
  const { data: currentBalance } = await supabaseAdmin
    .from("ai_credit_balances")
    .select("extra_credits")
    .eq("user_id", userId)
    .single();

  const { error } = await supabaseAdmin
    .from("ai_credit_balances")
    .upsert({
      user_id: userId,
      monthly_credits: credits,
      extra_credits: currentBalance?.extra_credits || 0, // Never reset extra_credits
      monthly_credits_reset_at: nextMonth.toISOString(),
      updated_at: new Date().toISOString(),
    }, {
      onConflict: "user_id",
    });

  if (error) {
    console.error("Error granting monthly credits:", error);
    return;
  }

  const totalCredits = credits + (currentBalance?.extra_credits || 0);

  // Record transaction
  await supabaseAdmin
    .from("ai_credit_transactions")
    .insert({
      user_id: userId,
      type: "monthly_grant",
      amount: credits,
      balance_after: totalCredits,
      metadata: { source: "subscription" },
      created_at: new Date().toISOString(),
    });

  console.log(`Granted ${credits} monthly credits to user ${userId}`);
}

async function handleSubscriptionUpdate(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;

  // Find user by Stripe customer ID
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id, plan")
    .eq("stripe_customer_id", customerId)
    .single();

  if (!profile) {
    console.error("No user found for customer:", customerId);
    return;
  }

  // Determine plan from price
  const priceId = subscription.items.data[0]?.price.id;
  let planId = profile.plan || "free";

  // Get plan from subscription metadata or infer from price
  if (subscription.metadata?.plan_id) {
    planId = subscription.metadata.plan_id;
  }

  const plan = getPlanById(planId) || PRICING_PLANS[0];

  // Update subscription record
  await supabaseAdmin
    .from("subscriptions")
    .upsert({
      user_id: profile.id,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscription.id,
      stripe_price_id: priceId,
      status: subscription.status,
      plan: planId,
      current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      cancel_at_period_end: subscription.cancel_at_period_end,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: "stripe_subscription_id",
    });

  // Update profile
  await supabaseAdmin
    .from("profiles")
    .update({
      plan: planId,
      subscription_status: subscription.status,
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", profile.id);

  // Update usage limits
  const monthYear = new Date().toISOString().slice(0, 7);
  await supabaseAdmin
    .from("usage_limits")
    .upsert({
      user_id: profile.id,
      month_year: monthYear,
      events_limit: plan.limits.eventsPerMonth,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: "user_id,month_year",
    });
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .single();

  if (!profile) return;

  // Downgrade to free
  await supabaseAdmin
    .from("profiles")
    .update({
      plan: "free",
      subscription_status: "canceled",
      updated_at: new Date().toISOString(),
    })
    .eq("id", profile.id);

  // Update subscription record
  await supabaseAdmin
    .from("subscriptions")
    .update({
      status: "canceled",
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_subscription_id", subscription.id);

  // Reset usage limits to free tier
  const freePlan = PRICING_PLANS[0];
  const monthYear = new Date().toISOString().slice(0, 7);
  await supabaseAdmin
    .from("usage_limits")
    .upsert({
      user_id: profile.id,
      month_year: monthYear,
      events_limit: freePlan.limits.eventsPerMonth,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: "user_id,month_year",
    });
}

async function handlePaymentSucceeded(invoice: Stripe.Invoice) {
  // Reset usage for new billing period
  const customerId = invoice.customer as string;

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id, plan")
    .eq("stripe_customer_id", customerId)
    .single();

  if (!profile) return;

  const plan = getPlanById(profile.plan) || PRICING_PLANS[0];
  const monthYear = new Date().toISOString().slice(0, 7);

  await supabaseAdmin
    .from("usage_limits")
    .upsert({
      user_id: profile.id,
      month_year: monthYear,
      events_count: 0,
      events_limit: plan.limits.eventsPerMonth,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: "user_id,month_year",
    });

  // Grant monthly AI credits on invoice payment (subscription renewal)
  const aiCredits = getAiCreditsForPlan(profile.plan);
  if (aiCredits > 0) {
    await grantMonthlyCredits(profile.id, aiCredits);
  }
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string;

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .single();

  if (!profile) return;

  // Mark subscription as past_due
  await supabaseAdmin
    .from("profiles")
    .update({
      subscription_status: "past_due",
      updated_at: new Date().toISOString(),
    })
    .eq("id", profile.id);
}
