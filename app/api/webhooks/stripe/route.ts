import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createClient } from "@supabase/supabase-js";
import { getPlanById, PRICING_PLANS, getAiCreditsForPlan } from "@/lib/products";
import Stripe from "stripe";

// Lazy init for service role client
let supabaseAdmin: ReturnType<typeof createClient> | null = null;

function getSupabaseAdmin() {
  if (!supabaseAdmin) {
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_CUSTOM_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL;
    supabaseAdmin = createClient(supabaseUrl!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return supabaseAdmin;
}

// Check if a Stripe session was already processed (DB-based idempotency)
async function isSessionProcessed(userId: string, sessionId: string): Promise<boolean> {
  const supabaseAdmin = getSupabaseAdmin();
  const { data } = await supabaseAdmin
    .from("ai_credit_transactions")
    .select("id")
    .eq("user_id", userId)
    .contains("metadata", { stripe_session_id: sessionId })
    .limit(1);
  
  return (data?.length || 0) > 0;
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
  const supabaseAdmin = getSupabaseAdmin();

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
  const supabaseAdmin = getSupabaseAdmin();
  const userId = session.metadata?.userId;
  const credits = parseInt(session.metadata?.credits || "0", 10);
  const packageId = session.metadata?.packageId;
  const sessionId = session.id;

  if (!userId || !credits || credits <= 0) {
    console.error("Invalid credit purchase metadata:", session.metadata);
    return;
  }

  // DB-based idempotency check
  const alreadyProcessed = await isSessionProcessed(userId, sessionId);
  if (alreadyProcessed) {
    console.log("Credit purchase session already processed:", sessionId);
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
  const currentMonthlyCredits = balance?.monthly_credits || 0;
  const newExtraCredits = currentExtraCredits + credits;
  const totalCredits = currentMonthlyCredits + newExtraCredits;

  // Update balance - only increment extra_credits, never touch monthly_credits
  const { error: updateError } = await supabaseAdmin
    .from("ai_credit_balances")
    .upsert({
      user_id: userId,
      monthly_credits: currentMonthlyCredits,
      extra_credits: newExtraCredits,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: "user_id",
    });

  if (updateError) {
    console.error("Error granting credits:", updateError);
    return;
  }

  // Record transaction with stripe_session_id for idempotency
  await supabaseAdmin
    .from("ai_credit_transactions")
    .insert({
      user_id: userId,
      type: `purchase_${credits}`,
      amount: credits,
      balance_after: totalCredits,
      metadata: {
        packageId,
        stripe_session_id: sessionId,
        stripe_payment_intent: session.payment_intent,
        source: "webhook",
      },
      created_at: new Date().toISOString(),
    });

  console.log(`Granted ${credits} extra credits to user ${userId}. New extra balance: ${newExtraCredits}`);
}

// Grant monthly credits for subscription
async function grantMonthlyCredits(userId: string, credits: number) {
  const supabaseAdmin = getSupabaseAdmin();
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
  const supabaseAdmin = getSupabaseAdmin();
  const customerId = subscription.customer as string;

  // Try to find user by multiple methods (priority order):
  // 1. subscription.metadata.user_id
  // 2. stripe_customer_id in profiles
  // 3. customer email fallback
  
  let userId: string | null = null;
  let profile: { id: string; plan: string | null } | null = null;

  // Method 1: Check subscription metadata
  if (subscription.metadata?.user_id) {
    userId = subscription.metadata.user_id;
    const { data } = await supabaseAdmin
      .from("profiles")
      .select("id, plan")
      .eq("id", userId)
      .single();
    profile = data;
  }

  // Method 2: Find by Stripe customer ID
  if (!profile) {
    const { data } = await supabaseAdmin
      .from("profiles")
      .select("id, plan")
      .eq("stripe_customer_id", customerId)
      .single();
    profile = data;
    if (profile) userId = profile.id;
  }

  // Method 3: Fetch customer email from Stripe and find by email
  if (!profile) {
    try {
      const stripe = getStripe();
      const customer = await stripe.customers.retrieve(customerId);
      if (!("deleted" in customer) && customer.email) {
        const { data } = await supabaseAdmin
          .from("profiles")
          .select("id, plan")
          .eq("email", customer.email)
          .single();
        profile = data;
        if (profile) {
          userId = profile.id;
          // Update profile with stripe_customer_id for future lookups
          await supabaseAdmin
            .from("profiles")
            .update({ stripe_customer_id: customerId })
            .eq("id", profile.id);
        }
      }
    } catch (e) {
      console.error("Failed to fetch Stripe customer:", e);
    }
  }

  if (!profile || !userId) {
    console.error("No user found for subscription:", subscription.id, "customer:", customerId);
    return;
  }

  // Determine plan from subscription metadata or price
  let planId = profile.plan || "free";
  
  // Check subscription metadata first
  if (subscription.metadata?.plan_id) {
    planId = subscription.metadata.plan_id;
  }
  // Check subscription items metadata
  else if (subscription.items.data[0]?.metadata?.plan_id) {
    planId = subscription.items.data[0].metadata.plan_id;
  }

  const plan = getPlanById(planId) || PRICING_PLANS.find(p => p.id === "pro") || PRICING_PLANS[0];
  const priceId = subscription.items.data[0]?.price.id;

  // Update subscription record
  await supabaseAdmin
    .from("subscriptions")
    .upsert({
      user_id: userId,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscription.id,
      stripe_price_id: priceId,
      status: subscription.status,
      plan: plan.id,
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
      plan: plan.id,
      subscription_status: subscription.status,
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      stripe_customer_id: customerId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  // Update usage limits
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

  // Grant monthly AI credits for new/updated subscription if active
  if (subscription.status === "active") {
    const aiCredits = getAiCreditsForPlan(plan.id);
    if (aiCredits > 0) {
      await grantMonthlyCredits(userId, aiCredits);
    }
  }

  console.log(`Subscription updated for user ${userId}: plan=${plan.id}, status=${subscription.status}`);
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const supabaseAdmin = getSupabaseAdmin();
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
  const supabaseAdmin = getSupabaseAdmin();
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
  const supabaseAdmin = getSupabaseAdmin();
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
