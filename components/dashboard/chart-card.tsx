"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity } from "lucide-react";
import type { ReactNode } from "react";

interface ChartCardProps {
  title: string;
  subtitle?: string;
  source: "roblox" | "tracker";
  summary?: string;
  children: ReactNode;
  isEmpty?: boolean;
  emptyIcon?: ReactNode;
  emptyTitle?: string;
  emptyMessage?: string;
  className?: string;
}

export function ChartCard({
  title,
  subtitle,
  source,
  summary,
  children,
  isEmpty = false,
  emptyIcon,
  emptyTitle = "No data yet",
  emptyMessage = "Data will appear once events are tracked.",
  className = "",
}: ChartCardProps) {
  const sourceConfig = {
    roblox: {
      label: "Roblox API",
      className: "bg-sky-500/20 text-sky-400 border-sky-500/40",
    },
    tracker: {
      label: "RoMonetize Tracker",
      className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/40",
    },
  };

  const { label, className: badgeClassName } = sourceConfig[source];

  return (
    <Card className={`border-neutral-700/60 bg-neutral-900/50 ${className}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3">
              <CardTitle className="text-base font-semibold text-foreground">
                {title}
              </CardTitle>
              {summary && (
                <span className="text-xs font-medium text-muted-foreground bg-muted/50 px-2 py-0.5 rounded">
                  {summary}
                </span>
              )}
            </div>
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
            )}
          </div>
          <Badge variant="secondary" className={`text-[10px] shrink-0 ${badgeClassName}`}>
            {label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {isEmpty ? (
          <div className="h-[280px] flex flex-col items-center justify-center text-center px-6">
            <div className="text-muted-foreground/40 mb-4">
              {emptyIcon || <Activity className="w-12 h-12" />}
            </div>
            <p className="text-sm font-medium text-foreground mb-1">{emptyTitle}</p>
            <p className="text-xs text-muted-foreground max-w-[240px]">
              {emptyMessage}
            </p>
          </div>
        ) : (
          <div className="h-[280px]">{children}</div>
        )}
      </CardContent>
    </Card>
  );
}

// Explicit chart colors - use these directly for visibility
export const CHART_COLORS = {
  // Primary colors by metric
  emerald: "#34d399",   // Revenue, Purchases (green)
  sky: "#38bdf8",       // CCU, Roblox API data (blue)
  violet: "#a78bfa",    // Events (purple)
  cyan: "#22d3ee",      // Player joins (teal)
  amber: "#fbbf24",     // Accent/warnings
  rose: "#fb7185",      // Errors/negative
  // Product types
  gamepass: "#38bdf8",  // Blue for gamepasses
  devproduct: "#a78bfa", // Purple for dev products
  unknown: "#6b7280",   // Gray for unknown
} as const;

// Consistent chart styling props
export const chartAxisStyle = {
  axisLine: false,
  tickLine: false,
  tickMargin: 8,
  tick: { fill: "#9ca3af", fontSize: 11 },
};

export const chartGridStyle = {
  strokeDasharray: "3 3",
  stroke: "#374151",
  strokeOpacity: 0.8,
  vertical: false,
};

export const chartTooltipStyle = {
  contentStyle: {
    backgroundColor: "hsl(var(--popover))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "8px",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
  },
  labelStyle: { color: "hsl(var(--foreground))", fontWeight: 600 },
  itemStyle: { color: "hsl(var(--foreground))" },
};
