"use client";

import { Card, CardContent } from "@/components/ui/card";
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
  Activity,
} from "lucide-react";
import Link from "next/link";

// Safe number formatter - prevents crashes on undefined/null
function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString();
}

function formatRobux(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `R$${Math.round(value).toLocaleString()}`;
}

export default function OverviewPage() {
  const {
    isLoading,
    isRefreshing,
    error,
    dataHealth,
    robloxStats,
    revenueStats,
    trackerStats,
    ccuStats,
    hasTrackerData,
    hasRobloxData,
    needsTrackingScript,
    selectedGameId,
    selectedGameName,
    refresh,
  } = useAnalytics({ enabled: true, range: "7d" });

  // Safe defaults - use estimated revenue (70% creator payout)
  const safeRevenueStats = {
    estimatedRevenue: revenueStats?.estimatedRevenue ?? null,
    estimatedRevenue72h: revenueStats?.estimatedRevenue72h ?? null,
    totalPurchases: revenueStats?.totalPurchases ?? null,
    payingUsers: revenueStats?.payingUsers ?? null,
  };

  const safeTrackerStats = {
    uniquePlayers: trackerStats?.uniquePlayers ?? null,
    totalSessions: trackerStats?.totalSessions ?? null,
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
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
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
          <h1 className="text-2xl font-bold text-foreground">Overview</h1>
          <p className="text-muted-foreground">Your game analytics at a glance</p>
        </div>
        <Card className="border-destructive/50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3 text-destructive">
              <AlertCircle className="w-5 h-5" />
              <p>Failed to load overview data: {error}</p>
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
          <h1 className="text-2xl font-bold text-foreground">Overview</h1>
          <p className="text-muted-foreground">
            {selectedGameName 
              ? `Showing data for: ${selectedGameName}` 
              : "Your game analytics at a glance"}
          </p>
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

      {/* Data source badges */}
      <div className="flex items-center gap-2 flex-wrap">
        {hasRobloxData && (
          <Badge variant="secondary" className="bg-sky-500/10 text-sky-500 border-sky-500/20 text-[10px]">
            Roblox API
          </Badge>
        )}
        {hasTrackerData && (
          <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px]">
            RoMonetize Tracker
          </Badge>
        )}
      </div>

      {/* Tracking script required banner */}
      {needsTrackingScript && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-500 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-foreground mb-1">Install tracking script for full analytics</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  The RoMonetize tracking script unlocks revenue tracking, player analytics, and retention metrics.
                </p>
                <Button variant="outline" size="sm" asChild>
                  <Link href="/dashboard/game/tracking-setup">
                    <ExternalLink className="w-4 h-4 mr-2" />
                    View Installation Guide
                  </Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {/* Revenue disclaimer */}
        {hasTrackerData && (
          <p className="col-span-full text-[10px] text-muted-foreground -mb-2">
            Revenue is estimated from RoMonetize tracker events and may differ from official Roblox dashboard reports.
          </p>
        )}
        {/* Est. Total Revenue */}
        <Card className="border-border/50">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-4 h-4 text-green-500" />
              <span className="text-xs text-muted-foreground">Est. Revenue</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {!hasTrackerData ? (
                <span className="text-sm text-muted-foreground font-normal">Requires tracking</span>
              ) : safeRevenueStats.estimatedRevenue === 0 ? (
                <span className="text-lg font-medium text-muted-foreground">R$0</span>
              ) : (
                formatRobux(safeRevenueStats.estimatedRevenue)
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">All time (after 30% fee)</p>
          </CardContent>
        </Card>

        {/* Est. 72h Revenue */}
        <Card className="border-border/50">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-emerald-500" />
              <span className="text-xs text-muted-foreground">Est. 72h Revenue</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {!hasTrackerData ? (
                <span className="text-sm text-muted-foreground font-normal">Requires tracking</span>
              ) : (
                formatRobux(safeRevenueStats.estimatedRevenue72h ?? 0)
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Last 72 hours</p>
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
              {!hasTrackerData ? (
                <span className="text-sm text-muted-foreground font-normal">Requires tracking</span>
              ) : (
                formatNumber(safeRevenueStats.totalPurchases ?? 0)
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Total transactions</p>
          </CardContent>
        </Card>

        {/* Current CCU */}
        <Card className="border-border/50">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-4 h-4 text-cyan-500" />
              <span className="text-xs text-muted-foreground">Current CCU</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {!hasRobloxData && !ccuStats?.current ? (
                <span className="text-sm text-muted-foreground font-normal">No sync yet</span>
              ) : (
                formatNumber(ccuStats?.current ?? robloxStats?.ccu ?? 0)
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Players online</p>
          </CardContent>
        </Card>

        {/* Unique Players */}
        <Card className="border-border/50">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-4 h-4 text-purple-500" />
              <span className="text-xs text-muted-foreground">Unique Players</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {!hasTrackerData ? (
                <span className="text-sm text-muted-foreground font-normal">Requires tracking</span>
              ) : (
                formatNumber(safeTrackerStats.uniquePlayers ?? 0)
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">In selected period</p>
          </CardContent>
        </Card>

        {/* Paying Users */}
        <Card className="border-border/50">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-4 h-4 text-amber-500" />
              <span className="text-xs text-muted-foreground">Paying Users</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {!hasTrackerData ? (
                <span className="text-sm text-muted-foreground font-normal">Requires tracking</span>
              ) : (
                formatNumber(safeRevenueStats.payingUsers ?? 0)
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Made a purchase</p>
          </CardContent>
        </Card>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-border/50 hover:border-border transition-colors">
          <CardContent className="pt-5 pb-4">
            <Link href="/dashboard/performance" className="block">
              <h3 className="font-semibold text-foreground mb-1">Performance</h3>
              <p className="text-sm text-muted-foreground">View detailed player and session analytics</p>
            </Link>
          </CardContent>
        </Card>

        <Card className="border-border/50 hover:border-border transition-colors">
          <CardContent className="pt-5 pb-4">
            <Link href="/dashboard/monetization" className="block">
              <h3 className="font-semibold text-foreground mb-1">Monetization</h3>
              <p className="text-sm text-muted-foreground">Track revenue and purchase metrics</p>
            </Link>
          </CardContent>
        </Card>

        <Card className="border-border/50 hover:border-border transition-colors">
          <CardContent className="pt-5 pb-4">
            <Link href="/dashboard/products" className="block">
              <h3 className="font-semibold text-foreground mb-1">Products</h3>
              <p className="text-sm text-muted-foreground">Analyze product performance</p>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
