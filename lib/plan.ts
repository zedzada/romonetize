/**
 * Shared plan helper - single source of truth for user plan state.
 * 
 * Plan priority:
 * 1. Active Stripe subscription status (if exists)
 * 2. profiles.plan from database
 * 3. Fallback to "free"
 * 
 * Rules:
 * - Free: locked Monetization + Products
 * - Pro: unlocked Monetization + Products
 * - Studio: unlocked Monetization + Products
 */

export type UserPlan = "free" | "pro" | "studio";

export interface PlanInfo {
  plan: UserPlan;
  status: "active" | "inactive" | "canceled" | "past_due";
  gameLimit: number;
  aiMonthlyCredits: number;
  canAccessMonetization: boolean;
  canAccessProducts: boolean;
  sourceUsed: "stripe" | "database" | "fallback";
}

// Plan limits configuration
const PLAN_LIMITS: Record<UserPlan, { gameLimit: number; aiMonthlyCredits: number }> = {
  free: { gameLimit: 1, aiMonthlyCredits: 0 },
  pro: { gameLimit: 3, aiMonthlyCredits: 100 },
  studio: { gameLimit: 10, aiMonthlyCredits: 500 },
};

/**
 * Resolve user plan from profile data.
 * This is a pure function that can be used on both client and server.
 */
export function resolvePlanFromProfile(profileData: {
  plan?: string | null;
  subscription_status?: string | null;
} | null): PlanInfo {
  // No profile data - fallback to free
  if (!profileData) {
    return {
      plan: "free",
      status: "inactive",
      gameLimit: PLAN_LIMITS.free.gameLimit,
      aiMonthlyCredits: PLAN_LIMITS.free.aiMonthlyCredits,
      canAccessMonetization: false,
      canAccessProducts: false,
      sourceUsed: "fallback",
    };
  }

  // Resolve plan from profile
  const rawPlan = profileData.plan?.toLowerCase();
  const plan: UserPlan = 
    rawPlan === "pro" ? "pro" :
    rawPlan === "studio" ? "studio" :
    "free";

  // Check subscription status (from Stripe webhook updates)
  const subscriptionStatus = profileData.subscription_status?.toLowerCase();
  const isActiveSubscription = subscriptionStatus === "active" || subscriptionStatus === "trialing";
  
  // Determine effective status
  const status: PlanInfo["status"] = 
    isActiveSubscription ? "active" :
    subscriptionStatus === "canceled" ? "canceled" :
    subscriptionStatus === "past_due" ? "past_due" :
    plan === "free" ? "inactive" : // Free users are always "inactive" (no subscription)
    "inactive";

  // For paid plans, only grant access if subscription is active
  // For free plan, never grant access to monetization/products
  const hasAccess = plan !== "free" && (isActiveSubscription || !subscriptionStatus);

  return {
    plan,
    status,
    gameLimit: PLAN_LIMITS[plan].gameLimit,
    aiMonthlyCredits: PLAN_LIMITS[plan].aiMonthlyCredits,
    canAccessMonetization: hasAccess,
    canAccessProducts: hasAccess,
    sourceUsed: subscriptionStatus ? "stripe" : "database",
  };
}

/**
 * Get display name for plan
 */
export function getPlanDisplayName(plan: UserPlan): string {
  switch (plan) {
    case "pro": return "Pro Plan";
    case "studio": return "Studio Plan";
    default: return "Free Plan";
  }
}

/**
 * Check if plan has pro-level access (pro or studio)
 */
export function hasProAccess(plan: UserPlan): boolean {
  return plan === "pro" || plan === "studio";
}

/**
 * Check if plan has studio-level access
 */
export function hasStudioAccess(plan: UserPlan): boolean {
  return plan === "studio";
}
