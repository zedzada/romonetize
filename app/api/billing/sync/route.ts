import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { getPlanById, PRICING_PLANS } from "@/lib/products";

export const dynamic = "force-dynamic";

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    // Get user profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_customer_id, plan, subscription_status")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return NextResponse.json({ 
        error: "No profile found",
        userId: user.id,
        email: user.email,
      });
    }

    // If no Stripe customer, return current DB state
    if (!profile.stripe_customer_id) {
      return NextResponse.json({
        plan: profile.plan || "free",
        status: profile.subscription_status || "inactive",
        source: "database_only",
        message: "No Stripe customer found",
        stripeCustomerId: null,
      });
    }

    const stripe = getStripe();

    // Fetch active subscriptions from Stripe
    const subscriptions = await stripe.subscriptions.list({
      customer: profile.stripe_customer_id,
      status: "active",
      limit: 1,
    });

    const subscription = subscriptions.data[0];

    if (!subscription) {
      // Check for any subscription (including canceled, past_due, etc.)
      const allSubs = await stripe.subscriptions.list({
        customer: profile.stripe_customer_id,
        limit: 5,
      });

      // No subscriptions at all
      if (allSubs.data.length === 0) {
        return NextResponse.json({
          plan: profile.plan || "free",
          status: profile.subscription_status || "inactive",
          source: "stripe_no_subscription",
          stripeCustomerId: profile.stripe_customer_id,
          subscriptions: [],
        });
      }

      // Return most recent subscription status
      const latestSub = allSubs.data[0];
      return NextResponse.json({
        plan: profile.plan || "free",
        status: latestSub.status,
        source: "stripe_inactive",
        stripeCustomerId: profile.stripe_customer_id,
        stripeSubscriptionId: latestSub.id,
        stripePriceId: latestSub.items.data[0]?.price.id,
        subscriptionStatus: latestSub.status,
        message: `Subscription status: ${latestSub.status}`,
      });
    }

    // Active subscription found - determine plan from metadata or price
    let resolvedPlan = "pro"; // Default to pro for any active subscription
    
    // Check subscription metadata first
    if (subscription.metadata?.plan_id) {
      resolvedPlan = subscription.metadata.plan_id;
    }
    // Check subscription items metadata
    else if (subscription.items.data[0]?.metadata?.plan_id) {
      resolvedPlan = subscription.items.data[0].metadata.plan_id;
    }

    const plan = getPlanById(resolvedPlan) || PRICING_PLANS.find(p => p.id === "pro") || PRICING_PLANS[0];

    // Update profile with active subscription
    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        plan: plan.id,
        subscription_status: "active",
        current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    // Also update/create subscriptions table record
    await supabase
      .from("subscriptions")
      .upsert({
        user_id: user.id,
        stripe_customer_id: profile.stripe_customer_id,
        stripe_subscription_id: subscription.id,
        stripe_price_id: subscription.items.data[0]?.price.id,
        status: "active",
        plan: plan.id,
        current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
        current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
        cancel_at_period_end: subscription.cancel_at_period_end,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: "stripe_subscription_id",
      });

    return NextResponse.json({
      plan: plan.id,
      planName: plan.name,
      status: "active",
      source: "stripe_active",
      stripeCustomerId: profile.stripe_customer_id,
      stripeSubscriptionId: subscription.id,
      stripePriceId: subscription.items.data[0]?.price.id,
      currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
      updateError: updateError?.message || null,
      synced: true,
    });

  } catch (error) {
    console.error("Billing sync error:", error);
    return NextResponse.json({ 
      error: "Failed to sync billing",
      details: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}

// Also support GET for debugging
export async function GET() {
  return POST();
}
