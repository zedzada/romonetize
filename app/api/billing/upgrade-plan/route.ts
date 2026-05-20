import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

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

// Get the correct Stripe price ID for the target plan and interval
function getStripePriceId(targetPlan: string, interval: "monthly" | "yearly"): string | null {
  if (targetPlan === "studio") {
    return interval === "yearly" 
      ? process.env.STRIPE_STUDIO_YEARLY_PRICE_ID || null
      : process.env.STRIPE_STUDIO_PRICE_ID || null;
  }
  if (targetPlan === "pro") {
    return interval === "yearly"
      ? process.env.STRIPE_PRO_YEARLY_PRICE_ID || null
      : process.env.STRIPE_PRO_PRICE_ID || null;
  }
  return null;
}

export async function POST(request: NextRequest) {
  const debug: Record<string, unknown> = {};
  
  try {
    // Parse request body
    let body: { targetPlan?: string; interval?: "monthly" | "yearly"; confirmed?: boolean } = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    
    const { targetPlan, interval = "monthly", confirmed } = body;
    const url = new URL(request.url);
    const debugMode = url.searchParams.get("debug") === "true";
    
    debug.requestBody = { targetPlan, interval, confirmed };
    
    // IMPORTANT: Require explicit confirmation to prevent accidental upgrades
    if (confirmed !== true) {
      return NextResponse.json({
        error: "Upgrade must be confirmed. Please use the confirmation modal.",
        requiresConfirmation: true,
        debug: debugMode ? debug : undefined,
      }, { status: 400 });
    }
    
    // Validate target plan
    if (!targetPlan || !["pro", "studio"].includes(targetPlan)) {
      return NextResponse.json({
        error: "Invalid target plan. Must be 'pro' or 'studio'.",
        debug: debugMode ? debug : undefined,
      }, { status: 400 });
    }
    
    // Get authenticated user
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    
    debug.userId = user.id;
    
    // Get Supabase admin client
    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
      return NextResponse.json({
        error: "Server configuration error",
        debug: debugMode ? debug : undefined,
      }, { status: 500 });
    }
    
    // Get user's profile with stripe customer ID and current plan
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("stripe_customer_id, plan, subscription_status")
      .eq("id", user.id)
      .single();
    
    if (profileError || !profile) {
      return NextResponse.json({
        error: "Failed to load user profile",
        debug: debugMode ? debug : undefined,
      }, { status: 500 });
    }
    
    debug.currentPlan = profile.plan;
    debug.subscriptionStatus = profile.subscription_status;
    debug.stripeCustomerIdExists = !!profile.stripe_customer_id;
    
    // Check if user has a Stripe customer ID
    if (!profile.stripe_customer_id) {
      return NextResponse.json({
        error: "No billing account found. Please subscribe to a plan first.",
        debug: debugMode ? debug : undefined,
      }, { status: 400 });
    }
    
    // Initialize Stripe
    const stripe = getStripe();
    
    // Find active subscription for this customer
    const subscriptions = await stripe.subscriptions.list({
      customer: profile.stripe_customer_id,
      status: "active",
      limit: 1,
    });
    
    debug.activeSubscriptionCount = subscriptions.data.length;
    
    if (subscriptions.data.length === 0) {
      // No active subscription - user needs to subscribe first, not upgrade
      return NextResponse.json({
        error: "No active subscription found. Please subscribe to a plan first.",
        redirectToCheckout: true,
        debug: debugMode ? debug : undefined,
      }, { status: 400 });
    }
    
    const currentSubscription = subscriptions.data[0];
    const currentPriceId = currentSubscription.items.data[0]?.price.id;
    const currentItemId = currentSubscription.items.data[0]?.id;
    
    debug.activeSubscriptionId = currentSubscription.id;
    debug.activeSubscriptionPriceId = currentPriceId;
    debug.subscriptionItemId = currentItemId;
    
    // Get target price ID
    const targetPriceId = getStripePriceId(targetPlan, interval);
    
    debug.targetPlan = targetPlan;
    debug.targetInterval = interval;
    debug.targetPriceId = targetPriceId;
    debug.targetStudioPriceId = getStripePriceId("studio", interval);
    
    if (!targetPriceId) {
      return NextResponse.json({
        error: `Price ID not configured for ${targetPlan} ${interval} plan. Please contact support.`,
        debug: debugMode ? debug : undefined,
      }, { status: 500 });
    }
    
    // Check if already on the target plan
    if (currentPriceId === targetPriceId) {
      return NextResponse.json({
        error: `You are already on the ${targetPlan} plan.`,
        debug: debugMode ? debug : undefined,
      }, { status: 400 });
    }
    
    // Determine upgrade mode - either direct subscription update or portal session
    // We'll use direct subscription update with proration for the best UX
    debug.upgradeMode = "direct_subscription_update";
    
    try {
      // Update the subscription item to the new price with IMMEDIATE invoice
      // This charges the user right away instead of waiting for the next billing cycle
      debug.prorationBehavior = "always_invoice";
      debug.paymentBehavior = "pending_if_incomplete";
      
      const updatedSubscription = await stripe.subscriptions.update(currentSubscription.id, {
        items: [
          {
            id: currentItemId,
            price: targetPriceId,
          },
        ],
        // ALWAYS_INVOICE: Creates an invoice immediately with prorated charges
        // This ensures the user is charged NOW, not at the end of the billing cycle
        proration_behavior: "always_invoice",
        // PENDING_IF_INCOMPLETE: Allow subscription to go into "past_due" if payment fails
        // This lets us track pending upgrades and only activate after invoice.paid webhook
        payment_behavior: "pending_if_incomplete",
        metadata: {
          ...currentSubscription.metadata,
          plan_id: targetPlan,
          upgrade_requested_at: new Date().toISOString(),
          previous_plan: profile.plan,
          upgrade_pending: "true",
        },
      });
      
      debug.subscriptionUpdated = true;
      debug.newPriceId = updatedSubscription.items.data[0]?.price.id;
      debug.newStatus = updatedSubscription.status;
      debug.latestInvoice = updatedSubscription.latest_invoice;
      
      // Check if payment was successful (subscription is active)
      // IMPORTANT: Only activate Studio if payment actually succeeded
      const paymentSucceeded = updatedSubscription.status === "active";
      debug.paymentSucceeded = paymentSucceeded;
      
      if (paymentSucceeded) {
        // Payment succeeded immediately - update the profile in Supabase
        const aiCredits = targetPlan === "studio" ? 500 : targetPlan === "pro" ? 100 : 0;
        const gameLimit = targetPlan === "studio" ? 25 : targetPlan === "pro" ? 5 : 1;
        
        await supabaseAdmin
          .from("profiles")
          .update({
            plan: targetPlan,
            subscription_status: "active",
            updated_at: new Date().toISOString(),
          })
          .eq("id", user.id);
        
        // Update subscriptions table
        await supabaseAdmin
          .from("subscriptions")
          .update({
            stripe_price_id: targetPriceId,
            plan: targetPlan,
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_subscription_id", currentSubscription.id);
        
        // Grant the new monthly credits for the upgraded plan
        const now = new Date();
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        
        // Get current extra credits to preserve them
        const { data: currentBalance } = await supabaseAdmin
          .from("ai_credit_balances")
          .select("extra_credits")
          .eq("user_id", user.id)
          .single();
        
        const extraCredits = currentBalance?.extra_credits || 0;
        
        await supabaseAdmin
          .from("ai_credit_balances")
          .upsert({
            user_id: user.id,
            monthly_credits: aiCredits,
            extra_credits: extraCredits, // Preserve extra credits
            monthly_credits_reset_at: nextMonth.toISOString(),
            updated_at: new Date().toISOString(),
          }, {
            onConflict: "user_id",
          });
        
        // Record transaction
        await supabaseAdmin
          .from("ai_credit_transactions")
          .insert({
            user_id: user.id,
            type: "upgrade_grant",
            amount: aiCredits,
            balance_after: aiCredits + extraCredits,
            metadata: {
              source: "plan_upgrade",
              from_plan: profile.plan,
              to_plan: targetPlan,
            },
            created_at: new Date().toISOString(),
          });
        
        // Clear the upgrade_pending flag in Stripe
        await stripe.subscriptions.update(updatedSubscription.id, {
          metadata: {
            ...updatedSubscription.metadata,
            upgrade_pending: null,
          },
        });
        
        debug.creditsGranted = aiCredits;
        debug.extraCreditsPreserved = extraCredits;
        debug.dbUpdated = true;
        debug.planAfterSync = targetPlan;
        debug.monthlyCreditsAfterSync = aiCredits;
        debug.activationSource = "immediate_payment_success";
        
        return NextResponse.json({
          success: true,
          message: `Studio upgrade successful. Your Studio benefits are now active.`,
          plan: targetPlan,
          subscriptionId: updatedSubscription.id,
          priceId: targetPriceId,
          monthlyCredits: aiCredits,
          extraCredits: extraCredits,
          totalCredits: aiCredits + extraCredits,
          gameLimit: gameLimit,
          chargedImmediately: true,
          debug: debugMode ? debug : undefined,
        });
      } else {
        // Payment is pending or requires action - DO NOT activate Studio yet
        // The webhook will handle activation when invoice.paid fires
        debug.upgradePending = true;
        debug.dbUpdated = false;
        debug.planAfterSync = profile.plan; // Still on old plan
        debug.activationSource = "waiting_for_webhook";
        
        // Check if there's a payment intent that requires action
        let paymentUrl: string | null = null;
        if (updatedSubscription.latest_invoice) {
          try {
            const invoice = await stripe.invoices.retrieve(
              typeof updatedSubscription.latest_invoice === "string" 
                ? updatedSubscription.latest_invoice 
                : updatedSubscription.latest_invoice.id
            );
            debug.invoiceStatus = invoice.status;
            debug.invoicePaymentIntent = invoice.payment_intent;
            
            if (invoice.hosted_invoice_url) {
              paymentUrl = invoice.hosted_invoice_url;
            }
          } catch (invoiceErr) {
            debug.invoiceRetrieveError = invoiceErr instanceof Error ? invoiceErr.message : "Unknown";
          }
        }
        
        // If no invoice URL, create a portal session as fallback
        if (!paymentUrl) {
          const origin = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
          const portalSession = await stripe.billingPortal.sessions.create({
            customer: profile.stripe_customer_id,
            return_url: `${origin}/dashboard/billing?upgrade_pending=true`,
          });
          paymentUrl = portalSession.url;
        }
        
        return NextResponse.json({
          success: false,
          pending: true,
          message: "Studio upgrade pending. Complete payment to activate Studio.",
          url: paymentUrl,
          subscriptionStatus: updatedSubscription.status,
          debug: debugMode ? debug : undefined,
        });
      }
      
    } catch (stripeError) {
      // Check if this is a card_error that requires action (e.g., 3D Secure)
      const err = stripeError as { type?: string; code?: string; message?: string; raw?: { payment_intent?: { client_secret?: string; status?: string } } };
      
      debug.directUpdateError = err.message || "Unknown error";
      debug.stripeErrorType = err.type;
      debug.stripeErrorCode = err.code;
      
      // If payment requires action (3D Secure), redirect to Stripe to complete
      if (err.type === "StripeCardError" && err.raw?.payment_intent) {
        const origin = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
        
        // Create a checkout session for completing the payment
        try {
          const portalSession = await stripe.billingPortal.sessions.create({
            customer: profile.stripe_customer_id,
            return_url: `${origin}/dashboard/billing?upgraded=true`,
          });
          
          return NextResponse.json({
            success: false,
            requiresPaymentAction: true,
            message: "Complete your Studio upgrade in Stripe.",
            url: portalSession.url,
            debug: debugMode ? debug : undefined,
          });
        } catch {
          // Fall through to general error
        }
      }
      
      // If direct update fails for other reasons, fall back to portal session
      debug.upgradeMode = "portal_fallback";
      
      // Create a portal session - user will need to upgrade manually
      const origin = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      
      try {
        const portalSession = await stripe.billingPortal.sessions.create({
          customer: profile.stripe_customer_id,
          return_url: `${origin}/dashboard/billing?success=true`,
        });
        
        return NextResponse.json({
          success: false,
          fallback: true,
          message: "Direct upgrade failed. Redirecting to billing portal.",
          url: portalSession.url,
          debug: debugMode ? debug : undefined,
        });
      } catch (portalError) {
        return NextResponse.json({
          error: "Failed to upgrade subscription",
          details: stripeError instanceof Error ? stripeError.message : "Unknown error",
          debug: debugMode ? debug : undefined,
        }, { status: 500 });
      }
    }
    
  } catch (error) {
    console.error("Upgrade plan error:", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Failed to process upgrade",
      debug,
    }, { status: 500 });
  }
}
