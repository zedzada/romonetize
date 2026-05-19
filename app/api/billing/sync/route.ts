import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { getPlanById, PRICING_PLANS, getAiCreditsForPlan } from "@/lib/products";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

export const dynamic = "force-dynamic";

// Price ID to plan mapping using correct env var names
function getPriceToPlanMap(): Record<string, "pro" | "studio"> {
  const map: Record<string, "pro" | "studio"> = {};
  
  // Use the correct env var names (without MONTHLY suffix)
  if (process.env.STRIPE_PRO_PRICE_ID) {
    map[process.env.STRIPE_PRO_PRICE_ID] = "pro";
  }
  if (process.env.STRIPE_PRO_YEARLY_PRICE_ID) {
    map[process.env.STRIPE_PRO_YEARLY_PRICE_ID] = "pro";
  }
  if (process.env.STRIPE_STUDIO_PRICE_ID) {
    map[process.env.STRIPE_STUDIO_PRICE_ID] = "studio";
  }
  if (process.env.STRIPE_STUDIO_YEARLY_PRICE_ID) {
    map[process.env.STRIPE_STUDIO_YEARLY_PRICE_ID] = "studio";
  }
  
  return map;
}

// Get admin client for DB operations (bypasses RLS)
function getSupabaseAdmin() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_CUSTOM_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  
  if (!supabaseUrl || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  
  return createAdminClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// Grant monthly credits for subscription
async function grantMonthlyCredits(userId: string, credits: number) {
  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) return { error: "No admin client" };
  
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  try {
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
      return { error: error.message };
    }

    const totalCredits = credits + (currentBalance?.extra_credits || 0);

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
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Unknown credit grant error" };
  }
}

export async function POST(request: NextRequest) {
  let step = "start";
  const debug: Record<string, unknown> = {};
  
  try {
    // Step 1: Check env vars
    step = "env_check";
    
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({
        success: false,
        error: "SUPABASE_SERVICE_ROLE_KEY missing",
        step,
        debug: { envCheck: "SUPABASE_SERVICE_ROLE_KEY is not set" },
      }, { status: 500 });
    }
    
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({
        success: false,
        error: "STRIPE_SECRET_KEY missing",
        step,
        debug: { envCheck: "STRIPE_SECRET_KEY is not set" },
      }, { status: 500 });
    }
    
    debug.envPriceIds = {
      STRIPE_PRO_PRICE_ID: process.env.STRIPE_PRO_PRICE_ID ? true : false,
      STRIPE_PRO_YEARLY_PRICE_ID: process.env.STRIPE_PRO_YEARLY_PRICE_ID ? true : false,
      STRIPE_STUDIO_PRICE_ID: process.env.STRIPE_STUDIO_PRICE_ID ? true : false,
      STRIPE_STUDIO_YEARLY_PRICE_ID: process.env.STRIPE_STUDIO_YEARLY_PRICE_ID ? true : false,
    };
    
    // Warn if no price IDs configured (but don't fail - we'll default to pro)
    const hasPriceIds = process.env.STRIPE_PRO_PRICE_ID || 
                        process.env.STRIPE_PRO_YEARLY_PRICE_ID || 
                        process.env.STRIPE_STUDIO_PRICE_ID || 
                        process.env.STRIPE_STUDIO_YEARLY_PRICE_ID;
    if (!hasPriceIds) {
      debug.priceIdWarning = "No STRIPE_*_PRICE_ID env vars set. Will default any active subscription to 'pro'.";
    }

    // Step 2: Get authenticated user
    step = "get_user";
    let supabase;
    try {
      supabase = await createClient();
    } catch (e) {
      return NextResponse.json({
        success: false,
        error: "Failed to create Supabase client",
        step,
        authDebug: {
          hasSession: false,
          authError: e instanceof Error ? e.message : "Unknown error creating client",
        },
        debug,
      }, { status: 500 });
    }
    
    let user = null;
    let userError = null;
    
    try {
      const result = await supabase.auth.getUser();
      user = result.data?.user || null;
      userError = result.error;
    } catch (e) {
      return NextResponse.json({
        success: false,
        error: "Unable to get authenticated user",
        step,
        authDebug: {
          hasSession: false,
          authError: e instanceof Error ? e.message : "Exception calling getUser",
        },
        debug,
      }, { status: 500 });
    }

    if (userError || !user) {
      return NextResponse.json({
        success: false,
        error: "Unable to get authenticated user",
        step,
        authDebug: {
          hasSession: false,
          authError: userError?.message || "No user returned from auth",
        },
        debug,
      }, { status: 401 });
    }
    
    debug.userId = user.id;
    debug.email = user.email;
    debug.authDebug = { hasSession: true };

    // Step 3: Get URL params
    step = "parse_params";
    const url = new URL(request.url);
    const sessionIdFromUrl = url.searchParams.get("session_id");
    const debugMode = url.searchParams.get("debug") === "true";
    
    let sessionIdFromBody: string | null = null;
    try {
      const body = await request.json().catch(() => ({}));
      sessionIdFromBody = body.session_id || null;
    } catch {
      // No body
    }
    
    const sessionId = sessionIdFromUrl || sessionIdFromBody;
    debug.sessionId = sessionId;

    // Step 4: Initialize Stripe
    step = "init_stripe";
    const stripe = getStripe();

    // Step 5: Load profile from DB
    step = "load_profile";
    const supabaseAdmin = getSupabaseAdmin();
    
    if (!supabaseAdmin) {
      return NextResponse.json({
        success: false,
        error: "Failed to create admin client",
        step,
        debug,
      }, { status: 500 });
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("stripe_customer_id, plan, subscription_status, email")
      .eq("id", user.id)
      .single();

    debug.dbBefore = {
      plan: profile?.plan || null,
      subscription_status: profile?.subscription_status || null,
      stripe_customer_id: profile?.stripe_customer_id || null,
      profileError: profileError?.message || null,
    };

    if (profileError && profileError.code !== "PGRST116") {
      // Real error, not just "no rows"
      return NextResponse.json({
        success: false,
        error: `Profile load failed: ${profileError.message}`,
        step,
        debug: debugMode ? debug : undefined,
      }, { status: 500 });
    }

    // Step 6: If session_id provided, retrieve checkout session and subscription directly
    step = "resolve_session_id";
    let subscription: Stripe.Subscription | null = null;
    let stripeCustomerId: string | null = profile?.stripe_customer_id || null;
    
    if (sessionId) {
      step = "retrieve_checkout_session";
      try {
        const checkoutSession = await stripe.checkout.sessions.retrieve(sessionId, {
          expand: ["subscription", "customer"],
        });
        
        debug.checkoutSession = {
          id: checkoutSession.id,
          mode: checkoutSession.mode,
          status: checkoutSession.status,
          paymentStatus: checkoutSession.payment_status,
          customerId: typeof checkoutSession.customer === "string" 
            ? checkoutSession.customer 
            : checkoutSession.customer?.id,
          subscriptionId: typeof checkoutSession.subscription === "string"
            ? checkoutSession.subscription
            : checkoutSession.subscription?.id,
          metadata: checkoutSession.metadata,
        };
        
        // Check if this is a credit purchase (not subscription)
        if (checkoutSession.metadata?.purchaseType === "ai_credits") {
          return NextResponse.json({
            success: true,
            type: "ai_credits_session",
            message: "This is an AI credits session, use credit sync endpoint",
            sessionId,
            debug: debugMode ? debug : undefined,
          });
        }
        
        // Get customer ID from session
        if (checkoutSession.customer) {
          stripeCustomerId = typeof checkoutSession.customer === "string" 
            ? checkoutSession.customer 
            : checkoutSession.customer.id;
        }
        
        // Get subscription from session
        if (checkoutSession.mode === "subscription" && checkoutSession.subscription) {
          subscription = typeof checkoutSession.subscription === "string"
            ? await stripe.subscriptions.retrieve(checkoutSession.subscription)
            : checkoutSession.subscription;
        }
        
        // Update profile with customer ID if we got one
        if (stripeCustomerId && stripeCustomerId !== profile?.stripe_customer_id) {
          await supabaseAdmin
            .from("profiles")
            .update({ stripe_customer_id: stripeCustomerId, updated_at: new Date().toISOString() })
            .eq("id", user.id);
          debug.customerIdUpdatedFromSession = true;
        }
        
      } catch (e) {
        debug.sessionRetrieveError = e instanceof Error ? e.message : "Unknown error";
        // Don't fail - continue with normal customer lookup
      }
    }
    
    debug.stripeCustomerId = stripeCustomerId;

    // Step 7: List subscriptions from Stripe (if we don't have one from session)
    step = "list_subscriptions";
    
    if (!subscription && !stripeCustomerId) {
      return NextResponse.json({
        success: false,
        error: "No Stripe customer ID found",
        step: "resolve_customer",
        plan: profile?.plan || "free",
        subscriptionStatus: profile?.subscription_status || "inactive",
        debug: debugMode ? debug : undefined,
      });
    }
    
    // If we still don't have a subscription, try listing from Stripe
    if (!subscription && stripeCustomerId) {
      let allSubscriptions;
      let activeSubscriptions;
      
      try {
        allSubscriptions = await stripe.subscriptions.list({
          customer: stripeCustomerId,
          limit: 10,
        });
        
        activeSubscriptions = await stripe.subscriptions.list({
          customer: stripeCustomerId,
          status: "active",
          limit: 5,
        });
      } catch (e) {
        return NextResponse.json({
          success: false,
          error: `Stripe subscription list failed: ${e instanceof Error ? e.message : "Unknown error"}`,
          step,
          stripeCustomerId,
          debug: debugMode ? debug : undefined,
        }, { status: 500 });
      }
      
      debug.stripeLookup = {
        customerIdUsed: stripeCustomerId,
        totalSubscriptionsFound: allSubscriptions.data.length,
        activeSubscriptionsFound: activeSubscriptions.data.length,
        subscriptions: allSubscriptions.data.map(sub => ({
          id: sub.id,
          status: sub.status,
          priceId: sub.items.data[0]?.price.id,
          currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
          metadata: sub.metadata,
        })),
      };

      subscription = activeSubscriptions.data[0] || null;
      
      if (!subscription) {
        const latestSub = allSubscriptions.data[0];
        return NextResponse.json({
          success: false,
          error: latestSub 
            ? `Subscription status is '${latestSub.status}', not 'active'`
            : "No subscriptions found for this customer",
          step,
          plan: profile?.plan || "free",
          subscriptionStatus: latestSub?.status || "no_subscription",
          stripeCustomerId,
          stripeSubscriptionId: latestSub?.id || null,
          stripePriceId: latestSub?.items.data[0]?.price.id || null,
          debug: debugMode ? debug : undefined,
        });
      }
    }

    // At this point we must have a subscription
    if (!subscription) {
      return NextResponse.json({
        success: false,
        error: "No active subscription found",
        step,
        debug: debugMode ? debug : undefined,
      });
    }

    // Add subscription to debug
    debug.stripeSubscription = {
      id: subscription.id,
      status: subscription.status,
      priceId: subscription.items.data[0]?.price.id,
      currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
      metadata: subscription.metadata,
    };

    // Step 8: Resolve plan from price ID
    step = "resolve_plan";
    const priceId = subscription.items.data[0]?.price.id;
    const priceToPlan = getPriceToPlanMap();
    
    let resolvedPlan: "pro" | "studio" = "pro"; // Default
    let resolutionMethod = "default_pro";
    
    // Try subscription metadata first
    if (subscription.metadata?.plan_id === "pro" || subscription.metadata?.plan_id === "studio") {
      resolvedPlan = subscription.metadata.plan_id as "pro" | "studio";
      resolutionMethod = "subscription_metadata";
    }
    // Try price ID mapping
    else if (priceId && priceToPlan[priceId]) {
      resolvedPlan = priceToPlan[priceId];
      resolutionMethod = "price_id_mapping";
    }
    
    debug.priceMapping = {
      stripePriceId: priceId,
      resolvedPlan,
      resolutionMethod,
      priceToPlanKeys: Object.keys(priceToPlan),
      priceIdMatched: priceId ? !!priceToPlan[priceId] : false,
    };

    const plan = getPlanById(resolvedPlan) || PRICING_PLANS.find(p => p.id === "pro") || PRICING_PLANS[0];

    // Step 9: Update database
    step = "update_database";
    const updateWarnings: string[] = [];
    
    // Update profiles table
    const profileUpdate: Record<string, unknown> = {
      plan: plan.id,
      updated_at: new Date().toISOString(),
    };
    
    // Add optional fields if they exist in schema
    profileUpdate.subscription_status = "active";
    profileUpdate.stripe_customer_id = stripeCustomerId;
    profileUpdate.current_period_end = new Date(subscription.current_period_end * 1000).toISOString();
    
    const { error: profileUpdateError } = await supabaseAdmin
      .from("profiles")
      .update(profileUpdate)
      .eq("id", user.id);
    
    if (profileUpdateError) {
      // Try minimal update with just plan
      const { error: minimalError } = await supabaseAdmin
        .from("profiles")
        .update({ plan: plan.id, updated_at: new Date().toISOString() })
        .eq("id", user.id);
      
      if (minimalError) {
        return NextResponse.json({
          success: false,
          error: `Database update failed: ${minimalError.message}`,
          step,
          profileUpdateError: profileUpdateError.message,
          minimalUpdateError: minimalError.message,
          debug: debugMode ? debug : undefined,
        }, { status: 500 });
      }
      
      updateWarnings.push(`Full profile update failed (${profileUpdateError.message}), but plan was updated`);
    }
    
    // Update subscriptions table
    const { error: subUpdateError } = await supabaseAdmin
      .from("subscriptions")
      .upsert({
        user_id: user.id,
        stripe_customer_id: stripeCustomerId,
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
    
    if (subUpdateError) {
      updateWarnings.push(`Subscriptions table update failed: ${subUpdateError.message}`);
    }
    
    // Verify update
    const { data: profileAfter } = await supabaseAdmin
      .from("profiles")
      .select("plan, subscription_status, stripe_customer_id")
      .eq("id", user.id)
      .single();
    
    debug.dbAfter = {
      plan: profileAfter?.plan,
      subscription_status: profileAfter?.subscription_status,
      stripe_customer_id: profileAfter?.stripe_customer_id,
      updateWarnings,
    };

    // Step 10: Grant monthly credits
    step = "grant_credits";
    let creditsResult = null;
    const aiCredits = getAiCreditsForPlan(plan.id);
    if (aiCredits > 0) {
      creditsResult = await grantMonthlyCredits(user.id, aiCredits);
    }
    
    // Get final credit balance
    const { data: creditBalance } = await supabaseAdmin
      .from("ai_credit_balances")
      .select("monthly_credits, extra_credits")
      .eq("user_id", user.id)
      .single();

    // Step 11: Return success
    step = "return_success";
    
    return NextResponse.json({
      success: true,
      plan: plan.id,
      planName: plan.name,
      subscriptionStatus: "active",
      stripeCustomerId,
      stripeSubscriptionId: subscription.id,
      stripePriceId: priceId,
      currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
      monthlyCredits: creditBalance?.monthly_credits || 0,
      extraCredits: creditBalance?.extra_credits || 0,
      totalCredits: (creditBalance?.monthly_credits || 0) + (creditBalance?.extra_credits || 0),
      credits: creditsResult,
      warnings: updateWarnings.length > 0 ? updateWarnings : undefined,
      debug: debugMode ? debug : undefined,
    });

  } catch (error) {
    console.error("Billing sync error at step:", step, error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      step,
      debug,
    }, { status: 500 });
  }
}
