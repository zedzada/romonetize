import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { AI_CREDIT_COSTS } from "@/lib/products";

// Lazy init for service role client
function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: NextRequest) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const { type } = body as { type: "text" | "image" | "textImage" };

    if (!type || !AI_CREDIT_COSTS[type]) {
      return NextResponse.json({ error: "Invalid credit type" }, { status: 400 });
    }

    const creditsRequired = AI_CREDIT_COSTS[type];

    // Get current balance
    const { data: balance, error: balanceError } = await supabaseAdmin
      .from("ai_credit_balances")
      .select("monthly_credits, extra_credits")
      .eq("user_id", user.id)
      .single();

    if (balanceError && balanceError.code !== "PGRST116") {
      console.error("Error fetching balance:", balanceError);
      return NextResponse.json({ error: "Failed to fetch balance" }, { status: 500 });
    }

    const monthlyCredits = balance?.monthly_credits || 0;
    const extraCredits = balance?.extra_credits || 0;
    const totalCredits = monthlyCredits + extraCredits;

    // Check if user has enough credits
    if (totalCredits < creditsRequired) {
      return NextResponse.json({ 
        error: "Insufficient credits",
        required: creditsRequired,
        available: totalCredits,
      }, { status: 402 }); // Payment required
    }

    // Consume credits: monthly first, then extra
    let newMonthlyCredits = monthlyCredits;
    let newExtraCredits = extraCredits;
    let creditsToConsume = creditsRequired;

    // First consume monthly credits
    if (newMonthlyCredits >= creditsToConsume) {
      newMonthlyCredits -= creditsToConsume;
      creditsToConsume = 0;
    } else {
      creditsToConsume -= newMonthlyCredits;
      newMonthlyCredits = 0;
    }

    // Then consume extra credits if needed
    if (creditsToConsume > 0) {
      newExtraCredits -= creditsToConsume;
    }

    const newTotalCredits = newMonthlyCredits + newExtraCredits;

    // Update balance
    const { error: updateError } = await supabaseAdmin
      .from("ai_credit_balances")
      .upsert({
        user_id: user.id,
        monthly_credits: newMonthlyCredits,
        extra_credits: newExtraCredits,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: "user_id",
      });

    if (updateError) {
      console.error("Error updating balance:", updateError);
      return NextResponse.json({ error: "Failed to consume credits" }, { status: 500 });
    }

    // Record transaction
    await supabaseAdmin
      .from("ai_credit_transactions")
      .insert({
        user_id: user.id,
        type: `ai_${type}`,
        amount: -creditsRequired,
        balance_after: newTotalCredits,
        metadata: { type, creditsConsumed: creditsRequired },
        created_at: new Date().toISOString(),
      });

    return NextResponse.json({
      success: true,
      consumed: creditsRequired,
      remaining: newTotalCredits,
      monthlyCredits: newMonthlyCredits,
      extraCredits: newExtraCredits,
    });
  } catch (error) {
    console.error("Credits consume error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
