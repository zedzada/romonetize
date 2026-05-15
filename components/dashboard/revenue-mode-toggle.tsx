"use client";

import { useRevenueDisplayMode, getRevenueModeDescription, type RevenueDisplayMode } from "@/hooks/use-revenue-display-mode";

interface RevenueModeSelectorProps {
  showDescription?: boolean;
  className?: string;
}

/**
 * A toggle component for switching between Gross Sales and Estimated Revenue display modes.
 * 
 * This component uses shared state that persists to localStorage, so switching
 * the mode here will affect all pages that display revenue metrics.
 */
export function RevenueModeToggle({ showDescription = true, className = "" }: RevenueModeSelectorProps) {
  const { mode, setMode } = useRevenueDisplayMode();
  
  return (
    <div className={`space-y-1 ${className}`}>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Show:</span>
        <div className="inline-flex items-center rounded-lg bg-muted/50 p-0.5">
          <button
            type="button"
            onClick={() => setMode("estimated")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              mode === "estimated"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            title="Est. Revenue applies an approximate 70% creator payout estimate after Roblox marketplace fees. May not match Roblox exactly."
          >
            Est. Revenue
          </button>
          <button
            type="button"
            onClick={() => setMode("gross")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              mode === "gross"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            title="Gross Sales are calculated from tracked purchase events before Roblox marketplace fees. May not match Roblox exactly."
          >
            Gross Sales
          </button>
        </div>
      </div>
      
      {showDescription && (
        <p className="text-[10px] text-muted-foreground">
          {getRevenueModeDescription(mode)}
        </p>
      )}
    </div>
  );
}

/**
 * Inline toggle for smaller spaces (no description)
 */
export function RevenueModeToggleCompact({ className = "" }: { className?: string }) {
  return <RevenueModeToggle showDescription={false} className={className} />;
}
