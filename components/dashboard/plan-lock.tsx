"use client";

import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface PlanLockProps {
  feature: string;
  description?: string;
}

export function PlanLock({ feature, description }: PlanLockProps) {
  return (
    <Card className="border-border bg-card">
      <CardContent className="flex flex-col items-center justify-center py-16">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <Lock className="w-8 h-8 text-muted-foreground" />
        </div>
        <h3 className="text-xl font-semibold text-foreground mb-2">
          Upgrade to access {feature}
        </h3>
        <p className="text-muted-foreground text-center max-w-md mb-6">
          {description || `${feature} is available on Pro and Studio plans. Upgrade your plan to unlock this feature and more.`}
        </p>
        <Button asChild>
          <a href="/dashboard/billing">Upgrade Plan</a>
        </Button>
      </CardContent>
    </Card>
  );
}
