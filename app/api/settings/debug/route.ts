import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolvePlanFromProfile } from "@/lib/plan";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Fetch profile row
    const { data: profileRow, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    // Check which profile columns exist
    const profileColumnsAvailable = profileRow ? Object.keys(profileRow) : [];

    // Resolve plan using shared helper
    const planInfo = resolvePlanFromProfile(profileRow);

    // Count connected games
    const { count: connectedGamesCount } = await supabase
      .from("games")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);

    // Check for Roblox connection in profile
    const robloxConnectionFound = !!(profileRow?.roblox_user_id);
    const robloxUsername = profileRow?.roblox_username || null;

    // Determine plan source
    let planSource = "fallback_free";
    if (profileRow?.subscription_status === "active") {
      planSource = "active_stripe_subscription";
    } else if (profileRow?.plan && profileRow.plan !== "free") {
      planSource = "database_plan_column";
    }

    return NextResponse.json({
      success: true,
      debug: {
        userId: user.id,
        email: user.email,
        profileRow: profileRow || null,
        profileColumnsAvailable,
        profileError: profileError?.message || null,
        resolvedPlan: planInfo.plan,
        planSource,
        planInfo,
        connectedGamesCount: connectedGamesCount || 0,
        robloxConnectionFound,
        robloxUsername,
        authProvider: user.app_metadata?.provider || "email",
        userMetadata: user.user_metadata,
      },
    });
  } catch (error) {
    console.error("[api/settings/debug] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
