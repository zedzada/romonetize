"use client";

import { useState, useEffect } from "react";
import { Lock, TrendingUp, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { resolvePlanFromProfile, type PlanInfo, type UserPlan } from "@/lib/plan";

interface PlanLockProps {
  feature: string;
  description?: string;
}

// Hook to check if user has pro or higher access - uses shared plan helper
export function usePlanAccess() {
  const [planInfo, setPlanInfo] = useState<PlanInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkPlan() {
      if (!isSupabaseConfigured) {
        setPlanInfo(resolvePlanFromProfile(null));
        setLoading(false);
        return;
      }

      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (user) {
        // Fetch both plan and subscription_status for accurate resolution
        const { data: profile } = await supabase
          .from("profiles")
          .select("plan, subscription_status")
          .eq("id", user.id)
          .single();

        setPlanInfo(resolvePlanFromProfile(profile));
      } else {
        setPlanInfo(resolvePlanFromProfile(null));
      }
      setLoading(false);
    }

    checkPlan();
    
    // Listen for plan updates (from billing page, settings, etc.)
    const handlePlanUpdate = () => checkPlan();
    window.addEventListener("plan-updated", handlePlanUpdate);
    return () => window.removeEventListener("plan-updated", handlePlanUpdate);
  }, []);

  const plan = planInfo?.plan ?? "free";

  return {
    plan,
    planInfo: planInfo ?? null,
    loading,
    hasProAccess: planInfo?.canAccessMonetization ?? false,
    hasStudioAccess: planInfo?.plan === "studio" && (planInfo?.canAccessMonetization ?? false),
    canAccessMonetization: planInfo?.canAccessMonetization ?? false,
    canAccessProducts: planInfo?.canAccessProducts ?? false,
  };
}

export function PlanLock({ feature, description }: PlanLockProps) {
  return (
    <Card className="border-border bg-card">
      <CardContent className="flex flex-col items-center justify-center py-16">
        <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-6">
          <Lock className="w-10 h-10 text-primary" />
        </div>
        <h3 className="text-2xl font-bold text-foreground mb-3">
          Upgrade to Pro to unlock {feature}
        </h3>
        <p className="text-muted-foreground text-center max-w-md mb-8">
          {description || `${feature} analytics are available on Pro and Studio plans. Upgrade your plan to unlock detailed insights and more.`}
        </p>
        
        {/* Benefits list */}
        <div className="flex flex-wrap justify-center gap-4 mb-8 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <TrendingUp className="w-4 h-4 text-primary" />
            <span>Revenue breakdowns</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Sparkles className="w-4 h-4 text-primary" />
            <span>Product performance</span>
          </div>
        </div>
        
        <Button asChild size="lg" className="px-8">
          <a href="/dashboard/billing">Upgrade to Pro</a>
        </Button>
      </CardContent>
    </Card>
  );
}
