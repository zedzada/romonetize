"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Code, CheckCircle, RefreshCw, ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import type { DataHealth } from "@/hooks/use-analytics";

interface DataStatusBannerProps {
  dataHealth: DataHealth | null;
  onSync?: () => void;
  showSyncButton?: boolean;
  variant?: "full" | "compact";
}

/**
 * Data Status Banner
 * 
 * Shows the status of data availability for the selected game:
 * - Tracking script not installed
 * - Roblox API data available/unavailable
 * - Missing specific event types
 */
export function DataStatusBanner({ 
  dataHealth, 
  onSync, 
  showSyncButton = true,
  variant = "full",
}: DataStatusBannerProps) {
  const { toast } = useToast();
  const [syncing, setSyncing] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (!dataHealth || dismissed) return null;

  // Defensive: ensure missing is an array before calling .includes()
  const missing = Array.isArray(dataHealth.missing) ? dataHealth.missing : [];
  const needsTracker = missing.includes("tracking_script_not_installed");
  const hasRobloxData = dataHealth.hasRobloxApiData ?? false;
  const robloxUnavailable = missing.includes("roblox_api_unavailable") || missing.includes("roblox_stats_not_synced");

  // If everything is working, don't show anything
  if (dataHealth.hasTrackerEvents && hasRobloxData) {
    return null;
  }

  const handleSync = async () => {
    setSyncing(true);
    try {
      const response = await fetch("/api/roblox/sync-selected-game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeProducts: true }),
      });

      const data = await response.json();

      if (data.success && data.synced) {
        toast({
          title: "Roblox stats synced",
          description: `CCU: ${data.stats?.ccu ?? 0}, Visits: ${data.stats?.visits?.toLocaleString() ?? 0}`,
        });
        onSync?.();
      } else {
        toast({
          variant: "destructive",
          title: "Sync failed",
          description: data.error || "Could not sync Roblox stats",
        });
      }
    } catch {
      toast({
        variant: "destructive",
        title: "Sync failed",
        description: "Network error occurred",
      });
    }
    setSyncing(false);
  };

  // Compact variant for inline use
  if (variant === "compact") {
    if (needsTracker) {
      return (
        <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>Tracking script not detected</span>
          <Link href="/dashboard/game" className="underline hover:no-underline">
            View setup
          </Link>
        </div>
      );
    }
    return null;
  }

  // Full banner variant
  return (
    <div className="relative overflow-hidden rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
      <button
        onClick={() => setDismissed(true)}
        className="absolute top-2 right-2 p-1 rounded-md hover:bg-amber-500/10 text-amber-600/60 hover:text-amber-600"
      >
        <X className="w-4 h-4" />
      </button>

      <div className="flex flex-col sm:flex-row sm:items-start gap-4">
        {/* Icon */}
        <div className="shrink-0">
          <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
            {needsTracker ? (
              <Code className="w-5 h-5 text-amber-500" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-500" />
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {needsTracker ? (
            <>
              <h3 className="font-semibold text-foreground mb-1">
                Tracking script not detected for {dataHealth.gameName || "this game"}
              </h3>
              <p className="text-sm text-muted-foreground mb-3">
                Install the RoMonetize tracking script to unlock deep analytics: revenue, purchases, 
                retention, session duration, and product performance.
                {hasRobloxData && " Roblox public stats are still available."}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button asChild size="sm" variant="default">
                  <Link href="/dashboard/game">
                    <Code className="w-4 h-4 mr-2" />
                    View Installation Guide
                  </Link>
                </Button>
                {showSyncButton && (
                  <Button 
                    size="sm" 
                    variant="outline" 
                    onClick={handleSync}
                    disabled={syncing}
                  >
                    <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
                    {syncing ? "Syncing..." : "Sync Roblox Stats"}
                  </Button>
                )}
              </div>
            </>
          ) : robloxUnavailable ? (
            <>
              <h3 className="font-semibold text-foreground mb-1">
                Roblox API data unavailable
              </h3>
              <p className="text-sm text-muted-foreground mb-3">
                Could not fetch public stats from Roblox. The game may be private or the Roblox API may be temporarily unavailable.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {showSyncButton && (
                  <Button 
                    size="sm" 
                    variant="outline" 
                    onClick={handleSync}
                    disabled={syncing}
                  >
                    <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
                    {syncing ? "Retrying..." : "Retry Sync"}
                  </Button>
                )}
                <Button asChild size="sm" variant="ghost">
                  <a 
                    href={`https://www.roblox.com/games/${dataHealth.robloxGameId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    View on Roblox
                  </a>
                </Button>
              </div>
            </>
          ) : (
            <>
              <h3 className="font-semibold text-foreground mb-1">
                Some analytics data is missing
              </h3>
              <p className="text-sm text-muted-foreground mb-3">
                {missing.includes("no_purchase_events") && "No purchase events tracked yet. "}
                {missing.includes("no_session_duration_events") && "No session events tracked yet. "}
                {missing.includes("no_product_view_events") && "No product click events tracked yet. "}
                Make sure your tracking script is sending the appropriate events.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button asChild size="sm" variant="outline">
                  <Link href="/dashboard/game">
                    View Tracker Setup
                  </Link>
                </Button>
              </div>
            </>
          )}
        </div>

        {/* Status indicators */}
        <div className="shrink-0 flex flex-col gap-1 text-xs">
          <div className="flex items-center gap-1.5">
            {dataHealth.hasTrackerEvents ? (
              <CheckCircle className="w-3.5 h-3.5 text-green-500" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
            )}
            <span className="text-muted-foreground">
              Tracker: {dataHealth.hasTrackerEvents ? `${dataHealth.trackerEventsCount} events` : "Not installed"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {hasRobloxData ? (
              <CheckCircle className="w-3.5 h-3.5 text-green-500" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
            )}
            <span className="text-muted-foreground">
              Roblox API: {hasRobloxData ? "Connected" : "Unavailable"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Needs Tracking Badge
 * 
 * Small badge to show when a metric requires tracking script
 */
export function NeedsTrackingBadge({ metric }: { metric?: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">
      <AlertTriangle className="w-3 h-3" />
      {metric ? `${metric} needs tracking` : "Needs tracking"}
    </span>
  );
}

/**
 * Empty State Card
 * 
 * Reusable empty state for metrics that require tracking
 */
export function TrackerRequiredCard({ 
  title, 
  description,
  showLink = true,
}: { 
  title: string; 
  description?: string;
  showLink?: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
      <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center mb-3">
        <Code className="w-6 h-6 text-amber-500" />
      </div>
      <h4 className="font-medium text-foreground mb-1">{title}</h4>
      <p className="text-sm text-muted-foreground max-w-xs mb-3">
        {description || "Install the RoMonetize tracking script to unlock this metric."}
      </p>
      {showLink && (
        <Button asChild size="sm" variant="outline">
          <Link href="/dashboard/game">
            View Installation Guide
          </Link>
        </Button>
      )}
    </div>
  );
}
