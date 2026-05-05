"use server";

import { stripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { PRICING_PLANS, getPlanById } from "@/lib/products";
import { headers } from "next/headers";

// Get or create Stripe customer for user
async function getOrCreateStripeCustomer(userId: string, email: string) {
  const supabase = await createClient();
  
  // Check if user already has a Stripe customer ID
  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", userId)
    .single();

  if (profile?.stripe_customer_id) {
    return profile.stripe_customer_id;
  }

  // Create new Stripe customer
  const customer = await stripe.customers.create({
    email,
    metadata: {
      supabase_user_id: userId,
    },
  });

  // Save customer ID to profile
  await supabase
    .from("profiles")
    .upsert({
      id: userId,
      email,
      stripe_customer_id: customer.id,
    });

  return customer.id;
}

// Create checkout session for subscription
export async function createCheckoutSession(planId: string, billingPeriod: "monthly" | "yearly" = "monthly") {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  const plan = getPlanById(planId);
  if (!plan || plan.id === "free") {
    return { error: "Invalid plan" };
  }

  const customerId = await getOrCreateStripeCustomer(user.id, user.email || "");
  
  const headersList = await headers();
  const origin = headersList.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  const priceInCents = billingPeriod === "yearly" ? plan.yearlyPriceInCents : plan.priceInCents;

  try {
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `RoMonetize ${plan.name} Plan`,
              description: plan.description,
            },
            unit_amount: priceInCents,
            recurring: {
              interval: billingPeriod === "yearly" ? "year" : "month",
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        user_id: user.id,
        plan_id: planId,
        billing_period: billingPeriod,
      },
      success_url: `${origin}/dashboard/billing?success=true`,
      cancel_url: `${origin}/dashboard/billing?canceled=true`,
    });

    return { url: session.url };
  } catch (error) {
    console.error("Stripe checkout error:", error);
    return { error: "Failed to create checkout session" };
  }
}

// Create portal session for managing subscription
export async function createPortalSession() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .single();

  if (!profile?.stripe_customer_id) {
    return { error: "No billing account found" };
  }

  const headersList = await headers();
  const origin = headersList.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${origin}/dashboard/billing`,
    });

    return { url: session.url };
  } catch (error) {
    console.error("Stripe portal error:", error);
    return { error: "Failed to create portal session" };
  }
}

// Get user's subscription status
export async function getSubscriptionStatus() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  // Get profile with subscription info
  const { data: profile } = await supabase
    .from("profiles")
    .select("plan, subscription_status, current_period_end")
    .eq("id", user.id)
    .single();

  // Get current month usage
  const monthYear = new Date().toISOString().slice(0, 7); // e.g., "2024-01"
  const { data: usage } = await supabase
    .from("usage_limits")
    .select("events_count, events_limit")
    .eq("user_id", user.id)
    .eq("month_year", monthYear)
    .single();

  // Get game count
  const { count: gameCount } = await supabase
    .from("games")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id);

  const plan = getPlanById(profile?.plan || "free") || PRICING_PLANS[0];

  return {
    plan: plan,
    status: profile?.subscription_status || "inactive",
    currentPeriodEnd: profile?.current_period_end,
    usage: {
      events: usage?.events_count || 0,
      eventsLimit: usage?.events_limit || plan.limits.eventsPerMonth,
      games: gameCount || 0,
      gamesLimit: plan.limits.games,
    },
  };
}

// Cancel subscription
export async function cancelSubscription() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("stripe_subscription_id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .single();

  if (!subscription?.stripe_subscription_id) {
    return { error: "No active subscription found" };
  }

  try {
    await stripe.subscriptions.update(subscription.stripe_subscription_id, {
      cancel_at_period_end: true,
    });

    await supabase
      .from("subscriptions")
      .update({ cancel_at_period_end: true })
      .eq("stripe_subscription_id", subscription.stripe_subscription_id);

    return { success: true };
  } catch (error) {
    console.error("Cancel subscription error:", error);
    return { error: "Failed to cancel subscription" };
  }
}
