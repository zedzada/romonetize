import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { getPlanById, PRICING_PLANS, getAiCreditsForPlan } from "@/lib/products";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// Get admin client for credit operations
function getSupabaseAdmin() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_CUSTOM_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  return createAdminClient(supabaseUrl!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// Check if a Stripe session was already processed (for idempotency)
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

// Grant extra credits for AI credit purchase
async function grantExtraCredits(userId: string, credits: number, stripeSessionId: string, packageId?: string) {
  const supabaseAdmin = getSupabaseAdmin();
  
  // Check idempotency first
  const alreadyProcessed = await isSessionProcessed(userId, stripeSessionId);
  if (alreadyProcessed) {
    return { 
      alreadyProcessed: true,
      message: "Session already processed",
    };
  }

  // Get current balance
  const { data: balance } = await supabaseAdmin
    .from("ai_credit_balances")
    .select("monthly_credits, extra_credits")
    .eq("user_id", userId)
    .single();

  const currentExtraCredits = balance?.extra_credits || 0;
  const currentMonthlyCredits = balance?.monthly_credits || 0;
  const newExtraCredits = currentExtraCredits + credits;
  const totalCredits = currentMonthlyCredits + newExtraCredits;

  // Update balance - only add to extra_credits, never touch monthly_credits
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
    console.error("Error granting extra credits:", updateError);
    return { error: updateError.message };
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
        stripe_session_id: stripeSessionId,
        source: "billing_sync",
      },
      created_at: new Date().toISOString(),
    });

  return {
    granted: credits,
    beforeExtraCredits: currentExtraCredits,
    afterExtraCredits: newExtraCredits,
    totalCredits,
  };
}

// Grant monthly credits for subscription (sync version with idempotency)
async function grantMonthlyCredits(userId: string, credits: number) {
  const supabaseAdmin = getSupabaseAdmin();
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  // Get current balance to preserve extra_credits and check if already granted
  const { data: currentBalance } = await supabaseAdmin
    .from("ai_credit_balances")
    .select("extra_credits, monthly_credits, monthly_credits_reset_at")
    .eq("user_id", userId)
    .single();

  // Check if credits were already granted this period
  if (currentBalance?.monthly_credits_reset_at) {
    const resetAt = new Date(currentBalance.monthly_credits_reset_at);
    if (resetAt > now && currentBalance.monthly_credits >= credits) {
      return { 
        alreadyGranted: true, 
        currentCredits: currentBalance.monthly_credits,
        extraCredits: currentBalance.extra_credits || 0,
      };
    }
  }

  const { error } = await supabaseAdmin
    .from("ai_credit_balances")
    .upsert({
      user_id: userId,
      monthly_credits: credits,
      extra_credits: currentBalance?.extra_credits || 0,
      monthly_credits_reset_at: nextMonth.toISOString(),
      updated_at: new Date().toISOString(),
    }, {
      onConflict: "user_id",
    });

  if (error) {
    console.error("Error granting monthly credits:", error);
    return { error: error.message };
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
      metadata: { source: "billing_sync" },
      created_at: new Date().toISOString(),
    });

  return { 
    granted: credits, 
    totalCredits,
    extraCredits: currentBalance?.extra_credits || 0,
  };
}

// Sync a specific checkout session (for repairing AI credit purchases)
async function syncCheckoutSession(userId: string, sessionId: string, stripe: ReturnType<typeof getStripe>) {
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    
    // Verify session belongs to this user
    if (session.metadata?.userId !== userId && session.metadata?.user_id !== userId) {
      return {
        error: "Session does not belong to this user",
        sessionUserId: session.metadata?.userId || session.metadata?.user_id,
        requestUserId: userId,
      };
    }

    // Check if this is an AI credits purchase
    if (session.metadata?.purchaseType === "ai_credits") {
      const credits = parseInt(session.metadata?.credits || "0", 10);
      const packageId = session.metadata?.packageId;

      if (session.payment_status !== "paid") {
        return {
          error: "Payment not completed",
          paymentStatus: session.payment_status,
          sessionId,
        };
      }

      if (credits <= 0) {
        return {
          error: "Invalid credits amount in session",
          credits,
          sessionId,
        };
      }

      // Grant credits (with idempotency check)
      const creditsResult = await grantExtraCredits(userId, credits, sessionId, packageId);

      // Get current balance after grant
      const supabaseAdmin = getSupabaseAdmin();
      const { data: balance } = await supabaseAdmin
        .from("ai_credit_balances")
        .select("monthly_credits, extra_credits")
        .eq("user_id", userId)
        .single();

      return {
        type: "ai_credits",
        sessionId,
        paymentStatus: session.payment_status,
        credits,
        packageId,
        creditSync: creditsResult,
        currentBalance: {
          monthlyCredits: balance?.monthly_credits || 0,
          extraCredits: balance?.extra_credits || 0,
          totalCredits: (balance?.monthly_credits || 0) + (balance?.extra_credits || 0),
        },
        synced: true,
      };
    }

    // Not an AI credits purchase - it's a subscription checkout
    // Return null to continue with normal subscription sync
    return null;
    
  } catch (error) {
    console.error("Error syncing checkout session:", error);
    return {
      error: "Failed to retrieve checkout session",
      sessionId,
      details: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Check for session_id in URL params or body (for repairing AI credit purchases)
  const url = new URL(request.url);
  const sessionIdFromUrl = url.searchParams.get("session_id");
  const debugMode = url.searchParams.get("debug") === "true";
  
  let sessionIdFromBody: string | null = null;
  try {
    const body = await request.json().catch(() => ({}));
    sessionIdFromBody = body.session_id || null;
  } catch {
    // No body or invalid JSON
  }
  
  const sessionId = sessionIdFromUrl || sessionIdFromBody;

  // Initialize debug info
  const debug: {
    userId: string;
    email: string | undefined;
    dbBefore: Record<string, unknown>;
    stripeLookup: Record<string, unknown>;
    priceMapping: Record<string, unknown>;
    dbAfter: Record<string, unknown>;
    failureReason: string | null;
  } = {
    userId: user.id,
    email: user.email,
    dbBefore: {},
    stripeLookup: {},
    priceMapping: {},
    dbAfter: {},
    failureReason: null,
  };

  try {
    const stripe = getStripe();
    
    // If session_id provided, try to sync that specific checkout session
    if (sessionId) {
      const syncResult = await syncCheckoutSession(user.id, sessionId, stripe);
      if (syncResult) {
        return NextResponse.json(syncResult);
      }
    }

    // Get user profile - DB BEFORE state
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("stripe_customer_id, plan, subscription_status, email")
      .eq("id", user.id)
      .single();

    // Also get subscription record if exists
    const { data: existingSubscription } = await supabase
      .from("subscriptions")
      .select("stripe_subscription_id, stripe_price_id, status, plan")
      .eq("user_id", user.id)
      .single();

    debug.dbBefore = {
      plan: profile?.plan || null,
      subscription_status: profile?.subscription_status || null,
      stripe_customer_id: profile?.stripe_customer_id || null,
      stripe_subscription_id: existingSubscription?.stripe_subscription_id || null,
      stripe_price_id: existingSubscription?.stripe_price_id || null,
      profileError: profileError?.message || null,
    };

    if (!profile) {
      debug.failureReason = "no_profile_found";
      return NextResponse.json({ 
        error: "No profile found",
        userId: user.id,
        email: user.email,
        failureReason: debug.failureReason,
        debug: debugMode ? debug : undefined,
      });
    }

    // If no Stripe customer, return current DB state
    if (!profile.stripe_customer_id) {
      debug.failureReason = "no_stripe_customer_id_in_db";
      debug.stripeLookup = {
        customerIdUsed: null,
        customerFound: false,
        activeSubscriptionsFound: 0,
        subscriptions: [],
      };
      return NextResponse.json({
        plan: profile.plan || "free",
        status: profile.subscription_status || "inactive",
        source: "database_only",
        message: "No Stripe customer ID in database",
        stripeCustomerId: null,
        failureReason: debug.failureReason,
        debug: debugMode ? debug : undefined,
      });
    }

    // Check if Stripe customer exists
    let stripeCustomer = null;
    try {
      stripeCustomer = await stripe.customers.retrieve(profile.stripe_customer_id);
      if ((stripeCustomer as { deleted?: boolean }).deleted) {
        stripeCustomer = null;
      }
    } catch {
      stripeCustomer = null;
    }

    if (!stripeCustomer) {
      debug.failureReason = "stripe_customer_not_found";
      debug.stripeLookup = {
        customerIdUsed: profile.stripe_customer_id,
        customerFound: false,
        activeSubscriptionsFound: 0,
        subscriptions: [],
      };
      return NextResponse.json({
        plan: profile.plan || "free",
        status: profile.subscription_status || "inactive",
        source: "stripe_customer_deleted",
        message: "Stripe customer not found or deleted",
        stripeCustomerId: profile.stripe_customer_id,
        failureReason: debug.failureReason,
        debug: debugMode ? debug : undefined,
      });
    }

    // Fetch ALL subscriptions from Stripe (not just active)
    const allSubscriptions = await stripe.subscriptions.list({
      customer: profile.stripe_customer_id,
      limit: 10,
    });

    // Fetch active subscriptions specifically
    const activeSubscriptions = await stripe.subscriptions.list({
      customer: profile.stripe_customer_id,
      status: "active",
      limit: 5,
    });

    // Build stripeLookup debug info
    debug.stripeLookup = {
      customerIdUsed: profile.stripe_customer_id,
      customerFound: true,
      customerEmail: (stripeCustomer as { email?: string }).email,
      totalSubscriptionsFound: allSubscriptions.data.length,
      activeSubscriptionsFound: activeSubscriptions.data.length,
      subscriptions: allSubscriptions.data.map(sub => ({
        id: sub.id,
        status: sub.status,
        priceId: sub.items.data[0]?.price.id,
        currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        metadata: sub.metadata,
        itemMetadata: sub.items.data[0]?.metadata,
      })),
    };

    const subscription = activeSubscriptions.data[0];

    if (!subscription) {
      // No active subscriptions
      const latestSub = allSubscriptions.data[0];
      
      if (!latestSub) {
        debug.failureReason = "no_subscriptions_for_customer";
      } else {
        debug.failureReason = `subscription_not_active_status_${latestSub.status}`;
      }

      return NextResponse.json({
        plan: profile.plan || "free",
        status: latestSub?.status || "no_subscription",
        source: latestSub ? "stripe_inactive" : "stripe_no_subscription",
        stripeCustomerId: profile.stripe_customer_id,
        stripeSubscriptionId: latestSub?.id || null,
        stripePriceId: latestSub?.items.data[0]?.price.id || null,
        subscriptionStatus: latestSub?.status || null,
        message: latestSub 
          ? `Subscription status is '${latestSub.status}', not 'active'` 
          : "No subscriptions found for this customer",
        failureReason: debug.failureReason,
        debug: debugMode ? debug : undefined,
      });
    }

    // Active subscription found - determine plan
    const priceId = subscription.items.data[0]?.price.id;
    
    // Check price mapping
    const priceEnvVars = {
      proMonthly: process.env.STRIPE_PRO_MONTHLY_PRICE_ID,
      proYearly: process.env.STRIPE_PRO_YEARLY_PRICE_ID,
      studioMonthly: process.env.STRIPE_STUDIO_MONTHLY_PRICE_ID,
      studioYearly: process.env.STRIPE_STUDIO_YEARLY_PRICE_ID,
    };

    debug.priceMapping = {
      actualPriceId: priceId,
      proMonthlyEnvPresent: !!priceEnvVars.proMonthly,
      proMonthlyMatch: priceId === priceEnvVars.proMonthly,
      proYearlyEnvPresent: !!priceEnvVars.proYearly,
      proYearlyMatch: priceId === priceEnvVars.proYearly,
      studioMonthlyEnvPresent: !!priceEnvVars.studioMonthly,
      studioMonthlyMatch: priceId === priceEnvVars.studioMonthly,
      studioYearlyEnvPresent: !!priceEnvVars.studioYearly,
      studioYearlyMatch: priceId === priceEnvVars.studioYearly,
      matchedPriceId: null as string | null,
      resolvedPlan: null as string | null,
      resolutionMethod: null as string | null,
    };

    // Determine plan from metadata or price
    let resolvedPlan = "pro"; // Default to pro for any active subscription
    let resolutionMethod = "default_pro";
    
    // Check subscription metadata first
    if (subscription.metadata?.plan_id) {
      resolvedPlan = subscription.metadata.plan_id;
      resolutionMethod = "subscription_metadata";
    }
    // Check subscription items metadata
    else if (subscription.items.data[0]?.metadata?.plan_id) {
      resolvedPlan = subscription.items.data[0].metadata.plan_id;
      resolutionMethod = "item_metadata";
    }
    // Try price ID matching as fallback
    else if (priceId === priceEnvVars.proMonthly || priceId === priceEnvVars.proYearly) {
      resolvedPlan = "pro";
      resolutionMethod = "price_id_match_pro";
      debug.priceMapping.matchedPriceId = priceId;
    }
    else if (priceId === priceEnvVars.studioMonthly || priceId === priceEnvVars.studioYearly) {
      resolvedPlan = "studio";
      resolutionMethod = "price_id_match_studio";
      debug.priceMapping.matchedPriceId = priceId;
    }

    debug.priceMapping.resolvedPlan = resolvedPlan;
    debug.priceMapping.resolutionMethod = resolutionMethod;

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

    if (updateError) {
      debug.failureReason = `db_update_failed: ${updateError.message}`;
    }

    // Also update/create subscriptions table record
    const { error: subUpdateError } = await supabase
      .from("subscriptions")
      .upsert({
        user_id: user.id,
        stripe_customer_id: profile.stripe_customer_id,
        stripe_subscription_id: subscription.id,
        stripe_price_id: priceId,
        status: "active",
        plan: plan.id,
        current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
        current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
        cancel_at_period_end: subscription.cancel_at_period_end,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: "stripe_subscription_id",
      });

    // Fetch DB AFTER state
    const { data: profileAfter } = await supabase
      .from("profiles")
      .select("stripe_customer_id, plan, subscription_status")
      .eq("id", user.id)
      .single();

    const { data: subscriptionAfter } = await supabase
      .from("subscriptions")
      .select("stripe_subscription_id, stripe_price_id, status, plan")
      .eq("user_id", user.id)
      .single();

    debug.dbAfter = {
      plan: profileAfter?.plan || null,
      subscription_status: profileAfter?.subscription_status || null,
      stripe_customer_id: profileAfter?.stripe_customer_id || null,
      stripe_subscription_id: subscriptionAfter?.stripe_subscription_id || null,
      stripe_price_id: subscriptionAfter?.stripe_price_id || null,
      profileUpdateError: updateError?.message || null,
      subscriptionUpdateError: subUpdateError?.message || null,
    };

    // Grant monthly AI credits for active subscription
    let creditsResult = null;
    const aiCredits = getAiCreditsForPlan(plan.id);
    if (aiCredits > 0) {
      creditsResult = await grantMonthlyCredits(user.id, aiCredits);
    }

    return NextResponse.json({
      plan: plan.id,
      planName: plan.name,
      status: "active",
      source: "stripe_active",
      stripeCustomerId: profile.stripe_customer_id,
      stripeSubscriptionId: subscription.id,
      stripePriceId: priceId,
      currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
      updateError: updateError?.message || null,
      synced: !updateError,
      credits: creditsResult,
      aiCreditsForPlan: aiCredits,
      failureReason: debug.failureReason,
      debug: debugMode ? debug : undefined,
    });

  } catch (error) {
    console.error("Billing sync error:", error);
    debug.failureReason = `exception: ${error instanceof Error ? error.message : "Unknown error"}`;
    return NextResponse.json({ 
      error: "Failed to sync billing",
      details: error instanceof Error ? error.message : "Unknown error",
      failureReason: debug.failureReason,
      debug: debugMode ? debug : undefined,
    }, { status: 500 });
  }
}

// Also support GET for debugging
export async function GET() {
  return POST();
}
