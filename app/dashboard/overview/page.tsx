"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { RangeControls, type ChartDateRange } from "@/components/dashboard/chart-card";
import { 
  RefreshCw, 
  DollarSign, 
  ShoppingCart, 
  Users, 
  TrendingUp,
  AlertCircle,
  AlertTriangle,
  ExternalLink,
  Activity,
  Package,
} from "lucide-react";
import Link from "next/link";

// Overview range type - supports 24h, 7d, 28d, 90d
type OverviewRange = "24h" | "7d" | "28d" | "90d";

// Safe number formatter - prevents crashes on undefined/null
function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString();
}

function formatRobux(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `R$${Math.round(value).toLocaleString()}`;
}

// Range label map
const RANGE_LABELS: Record<OverviewRange, string> = {
  "24h": "24H",
  "7d": "7D",
  "28d": "28D",
  "90d": "90D",
};

// API response data shape (from monetization-data endpoint)
interface MonetizationApiData {
  hasGame: boolean;
  selectedGameId?: string;
  selectedGameName?: string;
  range?: string;
  summary: {
    purchases: number;
    payingUsers: number;
    activeUsersRaw: number;
    activeUsersFixed: number;
    grossRevenue: number;
    estimatedRevenue: number;
    arppu: number | null;
    pcr: number | null;
  };
  hasTrackerEvents: boolean;
}

// Products API response
interface ProductsApiData {
  hasGame: boolean;
  products: Array<{
    productId: string;
    productName: string;
    productType: string;
    purchases: number;
    estimatedRevenue: number;
  }>;
  summary: {
    totalProducts: number;
    totalPurchases: number;
    estimatedRevenue: number;
  };
  hasTrackerEvents: boolean;
}

export default function OverviewPage() {
  // Range state - default to 28d to match Monetization tab
  const [range, setRange] = useState<OverviewRange>("28d");
  
  // Data states
  const [monetizationData, setMonetizationData] = useState<MonetizationApiData | null>(null);
  const [productsData, setProductsData] = useState<ProductsApiData | null>(null);
  const [robloxStats, setRobloxStats] = useState<{ ccu: number | null; visits: number | null } | null>(null);
  
  // Loading states
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Derived values
  const selectedGameName = monetizationData?.selectedGameName || null;
  const hasTrackerData = monetizationData?.hasTrackerEvents || false;
  const hasRobloxData = robloxStats !== null && (robloxStats.ccu !== null || robloxStats.visits !== null);
  const needsTrackingScript = !hasTrackerData && monetizationData?.hasGame;

  // Fetch data
  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      // Fetch monetization data, products data, and Roblox stats in parallel
      const [monetizationRes, productsRes, robloxRes] = await Promise.all([
        fetch(`/api/dashboard/monetization-data?range=${range}`, { cache: "no-store" }),
        fetch(`/api/dashboard/products-data?range=${range}`, { cache: "no-store" }),
        fetch(`/api/dashboard/analytics?range=${range}`, { cache: "no-store" }),
      ]);

      // Parse monetization data (same source as Monetization tab)
      if (monetizationRes.ok) {
        const monetizationResult = await monetizationRes.json();
        if (monetizationResult.success) {
          setMonetizationData(monetizationResult.data);
        }
      }

      // Parse products data (same source as Products tab)
      if (productsRes.ok) {
        const productsResult = await productsRes.json();
        if (productsResult.success) {
          setProductsData(productsResult.data);
        }
      }

      // Parse Roblox stats for CCU
      if (robloxRes.ok) {
        const robloxResult = await robloxRes.json();
        if (robloxResult.success && robloxResult.data) {
          setRobloxStats({
            ccu: robloxResult.data.robloxStats?.currentPlayers || robloxResult.data.robloxStats?.ccu || null,
            visits: robloxResult.data.robloxStats?.totalVisits || robloxResult.data.robloxStats?.visits || null,
          });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch data");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [range]);

  // Fetch on mount and when range changes
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Handle refresh
  const handleRefresh = async () => {
    await fetchData(true);
  };

  // Handle range change
  const handleRangeChange = (newRange: ChartDateRange) => {
    // Only allow supported ranges
    if (["24h", "7d", "28d", "90d"].includes(newRange)) {
      setRange(newRange as OverviewRange);
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

  // Get values from monetization data (same source as Monetization tab)
  const summary = monetizationData?.summary;
  const estimatedRevenue = summary?.estimatedRevenue ?? 0;
  const totalPurchases = summary?.purchases ?? 0;
  const payingUsers = summary?.payingUsers ?? 0;
  const activeUsers = summary?.activeUsersFixed ?? summary?.activeUsersRaw ?? 0;
  
  // Products count from products data (same source as Products tab)
  const totalProducts = productsData?.summary?.totalProducts ?? 0;

  return (
    <div className="space-y-6">
      {/* Header with Range Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Overview</h1>
          <p className="text-muted-foreground">
            {selectedGameName 
              ? `Showing data for: ${selectedGameName}` 
              : "Your game analytics at a glance"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Range Selector */}
          <RangeControls
            value={range}
            onChange={handleRangeChange}
            ranges={["24h", "7d", "28d", "90d"]}
          />
          {/* Refresh Button */}
          <Button 
            onClick={handleRefresh} 
            variant="outline" 
            disabled={isRefreshing}
            className="gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
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
        <Badge variant="outline" className="text-[10px] text-muted-foreground">
          {RANGE_LABELS[range]} data
        </Badge>
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
          <div className="col-span-full flex items-start gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 -mb-1">
            <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Revenue is estimated from RoMonetize tracker events and may differ from official Roblox dashboard reports. Use Roblox Creator Dashboard as the final source of truth.
            </p>
          </div>
        )}
        
        {/* Est. Revenue (range-based) */}
        <Card className="border-border/50">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-4 h-4 text-green-500" />
              <span className="text-xs text-muted-foreground">{RANGE_LABELS[range]} Est. Revenue</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {!hasTrackerData ? (
                <span className="text-sm text-muted-foreground font-normal">Requires tracking</span>
              ) : estimatedRevenue === 0 ? (
                <span className="text-lg font-medium text-muted-foreground">R$0</span>
              ) : (
                formatRobux(estimatedRevenue)
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">After 30% Roblox fee</p>
          </CardContent>
        </Card>

        {/* Total Purchases (range-based) */}
        <Card className="border-border/50">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <ShoppingCart className="w-4 h-4 text-blue-500" />
              <span className="text-xs text-muted-foreground">{RANGE_LABELS[range]} Purchases</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {!hasTrackerData ? (
                <span className="text-sm text-muted-foreground font-normal">Requires tracking</span>
              ) : (
                formatNumber(totalPurchases)
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Total transactions</p>
          </CardContent>
        </Card>

        {/* Paying Users (range-based) */}
        <Card className="border-border/50">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-4 h-4 text-amber-500" />
              <span className="text-xs text-muted-foreground">{RANGE_LABELS[range]} Paying Users</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {!hasTrackerData ? (
                <span className="text-sm text-muted-foreground font-normal">Requires tracking</span>
              ) : (
                formatNumber(payingUsers)
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Made a purchase</p>
          </CardContent>
        </Card>

        {/* Active Users (range-based) */}
        <Card className="border-border/50">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-purple-500" />
              <span className="text-xs text-muted-foreground">{RANGE_LABELS[range]} Active Users</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {!hasTrackerData ? (
                <span className="text-sm text-muted-foreground font-normal">Requires tracking</span>
              ) : (
                formatNumber(activeUsers)
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Unique players</p>
          </CardContent>
        </Card>

        {/* Current CCU (live) */}
        <Card className="border-border/50">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-4 h-4 text-cyan-500" />
              <span className="text-xs text-muted-foreground">Current CCU</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {!hasRobloxData ? (
                <span className="text-sm text-muted-foreground font-normal">No sync yet</span>
              ) : (
                formatNumber(robloxStats?.ccu ?? 0)
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Players online (live)</p>
          </CardContent>
        </Card>

        {/* Tracked Products (total catalog) */}
        <Card className="border-border/50">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <Package className="w-4 h-4 text-pink-500" />
              <span className="text-xs text-muted-foreground">Total Products</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {formatNumber(totalProducts)}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">In product catalog</p>
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
