"use client";

import { useState, useEffect } from "react";
import { Lock, TrendingUp, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

interface PlanLockProps {
  feature: string;
  description?: string;
}

// Hook to check if user has pro or higher access
export function usePlanAccess() {
  const [plan, setPlan] = useState<string>("free");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkPlan() {
      if (!isSupabaseConfigured) {
        setLoading(false);
        return;
      }

      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("plan")
          .eq("id", user.id)
          .single();

        if (profile) {
          setPlan(profile.plan || "free");
        }
      }
      setLoading(false);
    }

    checkPlan();
  }, []);

  return {
    plan,
    loading,
    hasProAccess: plan === "pro" || plan === "studio",
    hasStudioAccess: plan === "studio",
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
