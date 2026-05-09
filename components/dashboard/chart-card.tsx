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

// Bright, high-contrast chart colors for dark mode visibility
export const CHART_COLORS = {
  // Primary metrics - vivid and visible
  blue: "#3B82F6",        // Total revenue, CCU
  green: "#22C55E",       // Dev products, purchases success
  pink: "#EC4899",        // Game passes
  amber: "#F59E0B",       // Purchases, warnings
  violet: "#8B5CF6",      // Events, sessions
  cyan: "#06B6D4",        // Player joins
  rose: "#F43F5E",        // Errors/negative
  
  // Legacy aliases for compatibility
  emerald: "#22C55E",
  sky: "#3B82F6",
  
  // Product types
  gamepass: "#EC4899",    // Pink for gamepasses
  devproduct: "#22C55E",  // Green for dev products
  unknown: "#6B7280",     // Gray for unknown
  
  // Chart frame
  grid: "#374151",
  axis: "#9CA3AF",
} as const;

// Consistent chart styling props - improved visibility
export const chartAxisStyle = {
  axisLine: false,
  tickLine: false,
  tickMargin: 10,
  tick: { fill: "#D1D5DB", fontSize: 11 },  // Brighter axis labels
};

export const chartGridStyle = {
  strokeDasharray: "3 3",
  stroke: "#4B5563",      // Slightly brighter grid
  strokeOpacity: 0.6,
  vertical: false,
};

export const chartTooltipStyle = {
  contentStyle: {
    backgroundColor: "#171717",
    border: "1px solid #404040",
    borderRadius: "8px",
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
    padding: "12px",
  },
  labelStyle: { color: "#F5F5F5", fontWeight: 600, marginBottom: "4px" },
  itemStyle: { color: "#E5E5E5" },
};
