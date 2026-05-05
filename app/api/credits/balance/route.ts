import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Get credit balance
    const { data: balance, error } = await supabase
      .from("ai_credit_balances")
      .select("monthly_credits, extra_credits, monthly_credits_reset_at")
      .eq("user_id", user.id)
      .single();

    if (error && error.code !== "PGRST116") {
      // PGRST116 = no rows returned
      console.error("Error fetching credit balance:", error);
      return NextResponse.json({ error: "Failed to fetch balance" }, { status: 500 });
    }

    // Return balance (default to 0 if no record exists)
    return NextResponse.json({
      monthlyCredits: balance?.monthly_credits || 0,
      extraCredits: balance?.extra_credits || 0,
      totalCredits: (balance?.monthly_credits || 0) + (balance?.extra_credits || 0),
      monthlyCreditsResetAt: balance?.monthly_credits_reset_at || null,
    }, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error) {
    console.error("Credits balance error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
