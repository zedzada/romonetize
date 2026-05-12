"use client";

import Link from "next/link";
import { Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface LockedStatCardProps {
  label: string;
  icon: React.ReactNode;
  iconBgClassName?: string;
  gradientClassName?: string;
  className?: string;
}

/**
 * A locked stat card for monetization metrics that free users can't access.
 * Displays "Locked" instead of data with an upgrade CTA.
 * Clicking anywhere on the card navigates to the billing page.
 */
export function LockedStatCard({
  label,
  icon,
  iconBgClassName = "bg-muted",
  gradientClassName = "from-card to-muted/20",
  className,
}: LockedStatCardProps) {
  return (
    <Link href="/dashboard/billing" className="block">
      <Card 
        className={cn(
          "border-border/50 shadow-sm hover:shadow-md transition-all cursor-pointer group",
          `bg-gradient-to-br ${gradientClassName}`,
          className
        )}
      >
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center justify-between mb-3">
            <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center opacity-50", iconBgClassName)}>
              {icon}
            </div>
            <Lock className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="text-2xl font-bold text-muted-foreground tracking-tight flex items-center gap-2">
            <Lock className="w-5 h-5" />
            <span>Locked</span>
          </div>
          <div className="text-xs text-muted-foreground mt-1">{label}</div>
          <div className="text-[10px] text-primary mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
            Upgrade to Pro to unlock
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
