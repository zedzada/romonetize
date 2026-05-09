"use client";

import { useState, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Activity, Maximize2, X } from "lucide-react";

// Standard date range type used across analytics
export type ChartDateRange = "24h" | "72h" | "7d" | "28d" | "90d";

// Range configuration
export const CHART_RANGES: { value: ChartDateRange; label: string; tooltip: string }[] = [
  { value: "24h", label: "24H", tooltip: "Last 24 hours" },
  { value: "72h", label: "72H", tooltip: "Last 72 hours" },
  { value: "7d", label: "7D", tooltip: "Last 7 days" },
  { value: "28d", label: "28D", tooltip: "Last 28 days" },
  { value: "90d", label: "90D", tooltip: "Last 90 days" },
];

// Helper to get range label
export function getRangeTooltip(range: ChartDateRange): string {
  return CHART_RANGES.find(r => r.value === range)?.tooltip ?? range;
}

interface RangeControlsProps {
  value: ChartDateRange;
  onChange: (range: ChartDateRange) => void;
  ranges?: ChartDateRange[];
  className?: string;
}

export function RangeControls({ 
  value, 
  onChange, 
  ranges = ["24h", "72h", "7d", "28d", "90d"],
  className = "",
}: RangeControlsProps) {
  const availableRanges = CHART_RANGES.filter(r => ranges.includes(r.value));
  
  return (
    <div className={`flex items-center bg-neutral-800/50 rounded-lg p-0.5 ${className}`}>
      {availableRanges.map((r) => (
        <TooltipProvider key={r.value} delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => onChange(r.value)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  value === r.value
                    ? "bg-neutral-700 text-white"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                {r.label}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {r.tooltip}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ))}
    </div>
  );
}

interface ChartCardProps {
  title: string;
  subtitle?: string;
  source: "roblox" | "tracker";
  summary?: string;
  children: ReactNode;
  expandedChildren?: ReactNode;
  isEmpty?: boolean;
  emptyIcon?: ReactNode;
  emptyTitle?: string;
  emptyMessage?: string;
  className?: string;
  isExpandable?: boolean;
  // Range controls
  range?: ChartDateRange;
  onRangeChange?: (range: ChartDateRange) => void;
  availableRanges?: ChartDateRange[];
  // Additional controls slot
  controls?: ReactNode;
}

export function ChartCard({
  title,
  subtitle,
  source,
  summary,
  children,
  expandedChildren,
  isEmpty = false,
  emptyIcon,
  emptyTitle = "No data yet",
  emptyMessage = "Data will appear once events are tracked.",
  className = "",
  isExpandable = true,
  range,
  onRangeChange,
  availableRanges,
  controls,
}: ChartCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

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

  const renderChart = (height: string, content: ReactNode) => (
    <div className={height}>
      {isEmpty ? (
        <div className="h-full flex flex-col items-center justify-center text-center px-6">
          <div className="text-muted-foreground/40 mb-4">
            {emptyIcon || <Activity className="w-12 h-12" />}
          </div>
          <p className="text-sm font-medium text-foreground mb-1">{emptyTitle}</p>
          <p className="text-xs text-muted-foreground max-w-[240px]">
            {emptyMessage}
          </p>
        </div>
      ) : (
        content
      )}
    </div>
  );

  return (
    <>
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
            <div className="flex items-center gap-2 shrink-0">
              {/* Range controls */}
              {range && onRangeChange && (
                <RangeControls 
                  value={range} 
                  onChange={onRangeChange}
                  ranges={availableRanges}
                />
              )}
              {/* Additional controls */}
              {controls}
              {/* Source badge */}
              <Badge variant="secondary" className={`text-[10px] ${badgeClassName}`}>
                {label}
              </Badge>
              {/* Expand button */}
              {isExpandable && !isEmpty && (
                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-neutral-400 hover:text-white hover:bg-neutral-700/50"
                        onClick={() => setIsExpanded(true)}
                      >
                        <Maximize2 className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs">
                      Expand chart
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {renderChart("h-[280px]", children)}
        </CardContent>
      </Card>

      {/* Expanded Modal - Large analytics view */}
      <Dialog open={isExpanded} onOpenChange={setIsExpanded}>
        <DialogContent className="w-[94vw] max-w-[1400px] h-[85vh] max-h-[85vh] bg-neutral-900 border-neutral-700 p-0 gap-0 sm:rounded-lg max-sm:w-[100vw] max-sm:h-[100vh] max-sm:max-h-[100vh] max-sm:rounded-none">
          <div className="flex h-full flex-col">
            {/* Header */}
            <DialogHeader className="shrink-0 p-6 pb-4 border-b border-neutral-800">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <DialogTitle className="text-xl font-semibold text-foreground">
                      {title}
                    </DialogTitle>
                    {/* Source badge */}
                    <Badge variant="secondary" className={`text-xs ${badgeClassName}`}>
                      {label}
                    </Badge>
                    {summary && (
                      <span className="text-sm font-medium text-muted-foreground bg-muted/50 px-2.5 py-1 rounded">
                        {summary}
                      </span>
                    )}
                  </div>
                  {subtitle && (
                    <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
                  )}
                </div>
                {/* Close button */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-neutral-400 hover:text-white hover:bg-neutral-700/50"
                  onClick={() => setIsExpanded(false)}
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
              {/* Controls row below header */}
              {(range && onRangeChange || controls) && (
                <div className="flex items-center gap-3 mt-4 flex-wrap">
                  {range && onRangeChange && (
                    <RangeControls 
                      value={range} 
                      onChange={onRangeChange}
                      ranges={availableRanges}
                    />
                  )}
                  {controls}
                </div>
              )}
            </DialogHeader>
            {/* Chart area - fills remaining space */}
            <div className="flex-1 min-h-0 p-6">
              <div className="h-full w-full min-h-[620px]">
                {isEmpty ? (
                  <div className="h-full flex flex-col items-center justify-center text-center px-6">
                    <div className="text-muted-foreground/40 mb-4">
                      {emptyIcon || <Activity className="w-12 h-12" />}
                    </div>
                    <p className="text-sm font-medium text-foreground mb-1">{emptyTitle}</p>
                    <p className="text-xs text-muted-foreground max-w-[240px]">
                      {emptyMessage}
                    </p>
                  </div>
                ) : (
                  expandedChildren || children
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
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
