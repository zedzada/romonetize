import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { AI_CREDIT_COSTS } from "@/lib/products";

// Lazy init for service role client
function getSupabaseAdmin() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_CUSTOM_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  return createClient(supabaseUrl!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
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
    const { type, reason } = body as { type: "text" | "image" | "textImage"; reason?: string };

    if (!type || !AI_CREDIT_COSTS[type]) {
      return NextResponse.json({ error: "Invalid credit type" }, { status: 400 });
    }

    const creditsToRefund = AI_CREDIT_COSTS[type];

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

    // Refund to extra credits (simplest approach - original source is unknown)
    const newExtraCredits = (balance?.extra_credits || 0) + creditsToRefund;
    const newTotalCredits = (balance?.monthly_credits || 0) + newExtraCredits;

    // Update balance
    const { error: updateError } = await supabaseAdmin
      .from("ai_credit_balances")
      .upsert({
        user_id: user.id,
        monthly_credits: balance?.monthly_credits || 0,
        extra_credits: newExtraCredits,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: "user_id",
      });

    if (updateError) {
      console.error("Error updating balance:", updateError);
      return NextResponse.json({ error: "Failed to refund credits" }, { status: 500 });
    }

    // Record transaction
    await supabaseAdmin
      .from("ai_credit_transactions")
      .insert({
        user_id: user.id,
        type: "refund",
        amount: creditsToRefund,
        balance_after: newTotalCredits,
        metadata: { type, reason: reason || "AI request failed" },
        created_at: new Date().toISOString(),
      });

    return NextResponse.json({
      success: true,
      refunded: creditsToRefund,
      newBalance: newTotalCredits,
    });
  } catch (error) {
    console.error("Credits refund error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
