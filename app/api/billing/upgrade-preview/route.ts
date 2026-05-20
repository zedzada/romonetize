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

/**
 * GET /api/billing/upgrade-preview
 * 
 * Returns a preview of the upgrade cost from Pro to Studio.
 * Uses Stripe's upcoming invoice preview to get exact prorated amounts.
 */
export async function GET(request: NextRequest) {
  const debug: Record<string, unknown> = {};
  
  try {
    const url = new URL(request.url);
    const targetPlan = url.searchParams.get("targetPlan") || "studio";
    const interval = (url.searchParams.get("interval") || "monthly") as "monthly" | "yearly";
    const debugMode = url.searchParams.get("debug") === "true";
    
    debug.requestParams = { targetPlan, interval };
    
    // Validate target plan
    if (!["pro", "studio"].includes(targetPlan)) {
      return NextResponse.json({
        error: "Invalid target plan",
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
    debug.stripeCustomerId = profile.stripe_customer_id ? "exists" : "missing";
    
    // Must have a Stripe customer ID
    if (!profile.stripe_customer_id) {
      return NextResponse.json({
        error: "No Stripe customer found. Please subscribe first.",
        debug: debugMode ? debug : undefined,
      }, { status: 400 });
    }
    
    // Get Stripe instance
    const stripe = getStripe();
    if (!stripe) {
      return NextResponse.json({
        error: "Stripe not configured",
        debug: debugMode ? debug : undefined,
      }, { status: 500 });
    }
    
    // Get the target Stripe price ID
    const targetPriceId = getStripePriceId(targetPlan, interval);
    if (!targetPriceId) {
      return NextResponse.json({
        error: `No Stripe price configured for ${targetPlan} (${interval})`,
        debug: debugMode ? debug : undefined,
      }, { status: 500 });
    }
    
    debug.targetPriceId = targetPriceId;
    
    // Get the customer's active subscription
    const subscriptions = await stripe.subscriptions.list({
      customer: profile.stripe_customer_id,
      status: "active",
      limit: 1,
    });
    
    const currentSubscription = subscriptions.data[0];
    if (!currentSubscription) {
      return NextResponse.json({
        error: "No active subscription found",
        debug: debugMode ? debug : undefined,
      }, { status: 400 });
    }
    
    debug.subscriptionId = currentSubscription.id;
    debug.currentPeriodEnd = new Date(currentSubscription.current_period_end * 1000).toISOString();
    
    // Get the current subscription item
    const currentItem = currentSubscription.items.data[0];
    if (!currentItem) {
      return NextResponse.json({
        error: "No subscription item found",
        debug: debugMode ? debug : undefined,
      }, { status: 400 });
    }
    
    debug.currentPriceId = currentItem.price.id;
    debug.currentPriceAmount = currentItem.price.unit_amount;
    
    // Get the target price details
    const targetPrice = await stripe.prices.retrieve(targetPriceId);
    debug.targetPriceAmount = targetPrice.unit_amount;
    
    // Try to get an upcoming invoice preview with the upgrade
    let estimatedImmediateCharge = 0;
    let previewAvailable = false;
    let renewalDate = new Date(currentSubscription.current_period_end * 1000);
    
    try {
      // Create an invoice preview for the subscription upgrade
      const invoicePreview = await stripe.invoices.createPreview({
        customer: profile.stripe_customer_id,
        subscription: currentSubscription.id,
        subscription_items: [
          {
            id: currentItem.id,
            price: targetPriceId,
          },
        ],
        subscription_proration_behavior: "always_invoice",
      });
      
      debug.invoicePreviewTotal = invoicePreview.total;
      debug.invoicePreviewSubtotal = invoicePreview.subtotal;
      debug.invoicePreviewAmountDue = invoicePreview.amount_due;
      
      // The amount_due is what the customer will be charged immediately
      estimatedImmediateCharge = invoicePreview.amount_due;
      previewAvailable = true;
      
      // Get line items for more detail
      const lineItems = invoicePreview.lines.data;
      debug.lineItemsCount = lineItems.length;
      debug.lineItems = lineItems.map(item => ({
        description: item.description,
        amount: item.amount,
        proration: item.proration,
      }));
      
    } catch (previewError) {
      // If preview fails, calculate estimated difference
      debug.previewError = previewError instanceof Error ? previewError.message : "Unknown";
      
      // Estimate based on price difference (for monthly, this is straightforward)
      const currentAmount = currentItem.price.unit_amount || 0;
      const targetAmount = targetPrice.unit_amount || 0;
      
      // Simple estimate: difference in monthly price
      // This doesn't account for proration, but gives a rough idea
      estimatedImmediateCharge = targetAmount - currentAmount;
      previewAvailable = false;
    }
    
    // Format amounts
    const currentPlanAmount = currentItem.price.unit_amount || 0;
    const targetPlanAmount = targetPrice.unit_amount || 0;
    const nextRenewalAmount = targetPlanAmount;
    const currency = targetPrice.currency || "usd";
    
    debug.calculatedAmounts = {
      currentPlanAmount,
      targetPlanAmount,
      estimatedImmediateCharge,
      nextRenewalAmount,
    };
    
    return NextResponse.json({
      success: true,
      currentPlan: profile.plan,
      targetPlan,
      interval,
      currentPlanAmount, // in cents
      targetPlanAmount, // in cents
      estimatedImmediateCharge, // in cents
      nextRenewalAmount, // in cents
      currency,
      renewalDate: renewalDate.toISOString(),
      previewAvailable,
      debug: debugMode ? debug : undefined,
    });
    
  } catch (error) {
    debug.error = error instanceof Error ? error.message : "Unknown error";
    
    return NextResponse.json({
      error: "Failed to preview upgrade",
      debug: debug,
    }, { status: 500 });
  }
}
