"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAnalytics } from "@/hooks/use-analytics";
import { 
  RefreshCw, 
  DollarSign, 
  ShoppingCart, 
  Users, 
  TrendingUp,
  AlertCircle,
  ExternalLink,
  Coins,
} from "lucide-react";
import Link from "next/link";

// Safe number formatter - prevents crashes on undefined/null
function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString();
}

function formatRobux(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `R$${value.toLocaleString()}`;
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(1)}%`;
}

export default function MonetizationPage() {
  const {
    isLoading,
    isRefreshing,
    error,
    dataHealth,
    revenueStats,
    hasTrackerData,
    needsTrackingScript,
    refresh,
  } = useAnalytics({ enabled: true });

  // Safe defaults for revenue stats
  const safeRevenueStats = {
    totalRevenue: revenueStats?.totalRevenue ?? null,
    totalPurchases: revenueStats?.totalPurchases ?? null,
    payingUsers: revenueStats?.payingUsers ?? null,
    arppu: revenueStats?.arppu ?? null,
    arpdau: revenueStats?.arpdau ?? null,
  };

  // Handle refresh
  const handleRefresh = async () => {
    if (refresh) {
      await refresh();
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-8 w-48 mb-2" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Monetization</h1>
          <p className="text-muted-foreground">Track revenue and purchase metrics</p>
        </div>
        <Card className="border-destructive/50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3 text-destructive">
              <AlertCircle className="w-5 h-5" />
              <p>Failed to load monetization data: {error}</p>
            </div>
            <Button onClick={handleRefresh} variant="outline" className="mt-4">
              <RefreshCw className="w-4 h-4 mr-2" />
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Monetization</h1>
          <p className="text-muted-foreground">Track revenue and purchase metrics from your tracking script</p>
        </div>
        <Button 
          onClick={handleRefresh} 
          variant="outline" 
          disabled={isRefreshing}
          className="gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
          Refresh Data
        </Button>
      </div>

      {/* Data source badge */}
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px]">
          RoMonetize Tracker
        </Badge>
        {hasTrackerData && (
          <span className="text-xs text-muted-foreground">
            Revenue data from purchase_success events
          </span>
        )}
      </div>

      {/* Tracking script required banner */}
      {needsTrackingScript && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-500 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-foreground mb-1">Install tracking script to track revenue</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Monetization data requires the RoMonetize tracking script. The script captures purchase events 
                  including the robux amount, product details, and player information.
                </p>
                <Button variant="outline" size="sm" asChild>
                  <Link href="/dashboard/settings?tab=tracking">
                    <ExternalLink className="w-4 h-4 mr-2" />
                    View Installation Guide
                  </Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Revenue Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {/* Revenue */}
        <Card className="border-border/50">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-4 h-4 text-green-500" />
              <span className="text-xs text-muted-foreground">Revenue</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {hasTrackerData ? formatRobux(safeRevenueStats.totalRevenue) : (
                <span className="text-sm text-muted-foreground font-normal">Requires tracking</span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Purchases */}
        <Card className="border-border/50">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <ShoppingCart className="w-4 h-4 text-blue-500" />
              <span className="text-xs text-muted-foreground">Purchases</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {hasTrackerData ? formatNumber(safeRevenueStats.totalPurchases) : (
                <span className="text-sm text-muted-foreground font-normal">Requires tracking</span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Paying Users */}
        <Card className="border-border/50">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-4 h-4 text-purple-500" />
              <span className="text-xs text-muted-foreground">Paying Users</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {hasTrackerData ? formatNumber(safeRevenueStats.payingUsers) : (
                <span className="text-sm text-muted-foreground font-normal">Requires tracking</span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ARPPU */}
        <Card className="border-border/50">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <Coins className="w-4 h-4 text-amber-500" />
              <span className="text-xs text-muted-foreground">ARPPU</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {hasTrackerData ? formatRobux(safeRevenueStats.arppu) : (
                <span className="text-sm text-muted-foreground font-normal">Requires tracking</span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Avg Revenue Per Paying User</p>
          </CardContent>
        </Card>

        {/* ARPDAU */}
        <Card className="border-border/50">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-cyan-500" />
              <span className="text-xs text-muted-foreground">ARPDAU</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {hasTrackerData ? formatRobux(safeRevenueStats.arpdau) : (
                <span className="text-sm text-muted-foreground font-normal">Requires tracking</span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Avg Revenue Per Daily Active User</p>
          </CardContent>
        </Card>
      </div>

      {/* Data explanation */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-base">How Monetization Data Works</CardTitle>
          <CardDescription>
            Understanding the data sources for your revenue metrics
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="p-4 rounded-lg bg-secondary/30 border border-border/50">
              <h4 className="font-medium text-foreground mb-2 flex items-center gap-2">
                <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px]">
                  RoMonetize Tracker
                </Badge>
              </h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Revenue (from purchase_success robux field)</li>
                <li>• Purchases (count of purchase_success events)</li>
                <li>• Paying Users (distinct player_id from purchases)</li>
                <li>• ARPPU (revenue / paying users)</li>
                <li>• ARPDAU (revenue / unique active players)</li>
              </ul>
            </div>

            <div className="p-4 rounded-lg bg-secondary/30 border border-border/50">
              <h4 className="font-medium text-foreground mb-2">Required Event: purchase_success</h4>
              <p className="text-sm text-muted-foreground mb-2">
                Fire this event when a player completes a purchase:
              </p>
              <pre className="text-xs bg-background/50 p-2 rounded border border-border/30 overflow-x-auto">
{`RoMonetize:TrackPurchase({
  player_id = player.UserId,
  product_id = productId,
  product_name = "Sword",
  product_type = "gamepass",
  robux = 150
})`}
              </pre>
            </div>
          </div>

          <div className="p-4 rounded-lg bg-blue-500/5 border border-blue-500/20">
            <h4 className="font-medium text-foreground mb-1 text-sm">Note on Roblox Revenue API</h4>
            <p className="text-sm text-muted-foreground">
              Roblox does not provide public API access to Creator Analytics revenue data. 
              Revenue tracking requires the RoMonetize tracking script to capture purchase events directly from your game.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
