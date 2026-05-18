import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";
import { CREDIT_PACKAGES, getCreditPackageById } from "@/lib/products";
import { headers } from "next/headers";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const { packageId } = body as { packageId: string };

    const creditPackage = getCreditPackageById(packageId);
    if (!creditPackage) {
      return NextResponse.json({ error: "Invalid package" }, { status: 400 });
    }

    // Get Stripe price ID from environment variable
    const stripePriceId = process.env[creditPackage.stripePriceEnvVar];
    
    // Get or create Stripe customer
    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_customer_id, email")
      .eq("id", user.id)
      .single();

    let customerId = profile?.stripe_customer_id;

    if (!customerId) {
      // Create new Stripe customer
      const customer = await stripe.customers.create({
        email: user.email || profile?.email,
        metadata: {
          supabase_user_id: user.id,
        },
      });
      customerId = customer.id;

      // Save customer ID
      await supabase
        .from("profiles")
        .upsert({
          id: user.id,
          email: user.email,
          stripe_customer_id: customerId,
        });
    }

    const headersList = await headers();
    const origin = headersList.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    // Create checkout session
    const sessionConfig: Parameters<typeof stripe.checkout.sessions.create>[0] = {
      customer: customerId,
      mode: "payment",
      payment_method_types: ["card"],
      success_url: `${origin}/dashboard/billing?credits_success=true&credits=${creditPackage.credits}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/dashboard/billing?credits_canceled=true`,
      metadata: {
        purchaseType: "ai_credits",
        userId: user.id,
        credits: creditPackage.credits.toString(),
        packageId: creditPackage.id,
      },
      payment_intent_data: {
        metadata: {
          purchaseType: "ai_credits",
          userId: user.id,
          credits: creditPackage.credits.toString(),
          packageId: creditPackage.id,
        },
      },
    };

    // Use Stripe price ID if available, otherwise use price_data
    if (stripePriceId) {
      sessionConfig.line_items = [
        {
          price: stripePriceId,
          quantity: 1,
        },
      ];
    } else {
      sessionConfig.line_items = [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `${creditPackage.credits} AI Credits`,
              description: `One-time purchase of ${creditPackage.credits} AI credits for RoMonetize`,
            },
            unit_amount: creditPackage.priceInCents,
          },
          quantity: 1,
        },
      ];
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Credits purchase error:", error);
    return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 });
  }
}

// Get available credit packages
export async function GET() {
  return NextResponse.json({
    packages: CREDIT_PACKAGES.map(pkg => ({
      id: pkg.id,
      credits: pkg.credits,
      price: pkg.priceInCents / 100,
      priceFormatted: `$${(pkg.priceInCents / 100).toFixed(2)}`,
    })),
  });
}
