"use client";

import { useState, useEffect, useCallback } from "react";
import {
  DollarSign,
  Users,
  Percent,
  ShoppingCart,
  RefreshCw,
  BarChart3,
  Radio,
  AlertCircle,
} from "lucide-react";
import { RobuxValue } from "@/components/ui/robux-icon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getMonetizationStats } from "@/lib/actions/monetization";
import { getSelectedGame } from "@/lib/actions/games";
import { useStatsRefresh } from "@/hooks/use-stats-refresh";
import { useRealtimeStats } from "@/hooks/use-realtime-stats";
import { Tooltip as UITooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PlanLock } from "@/components/dashboard/plan-lock";
import { createClient } from "@/lib/supabase/client";
import { DataStatusBanner } from "@/components/dashboard/data-status-banner";
import { useAnalytics } from "@/hooks/use-analytics";
import { ErrorBoundary } from "@/components/ui/error-boundary";

// Safe number formatter
function safeNumber(value: unknown): number {
  if (typeof value === "number" && !isNaN(value)) return value;
  return 0;
}

// Safe number display
function formatSafeNumber(value: unknown, decimals = 0): string {
  const num = safeNumber(value);
  return decimals > 0 ? num.toFixed(decimals) : num.toLocaleString();
}

export default function MonetizationPage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedGameId, setSelectedGameId] = useState<string | undefined>();
  const [userPlan, setUserPlan] = useState<string>("free");
  const [planLoading, setPlanLoading] = useState(true);
  
  // Stats with safe defaults
  const [stats, setStats] = useState({
    totalRevenue: 0,
    passesRevenue: 0,
    devProductsRevenue: 0,
    totalPurchases: 0,
    payingUsers: 0,
    uniquePlayers: 0,
    payerConversionRate: 0,
    arppu: 0,
    arpdau: 0,
  });

  // Get dataHealth for banner - safe access
  const { dataHealth, refresh: refreshAnalytics } = useAnalytics({ enabled: !!selectedGameId });

  const fetchData = useCallback(async () => {
    try {
      const result = await getMonetizationStats();
      if (!result.error && result.stats) {
        setStats({
          totalRevenue: safeNumber(result.stats.totalRevenue),
          passesRevenue: safeNumber(result.stats.passesRevenue),
          devProductsRevenue: safeNumber(result.stats.devProductsRevenue),
          totalPurchases: safeNumber(result.stats.totalPurchases),
          payingUsers: safeNumber(result.stats.payingUsers),
          uniquePlayers: safeNumber(result.stats.uniquePlayers),
          payerConversionRate: safeNumber(result.stats.payerConversionRate),
          arppu: safeNumber(result.stats.arppu),
          arpdau: safeNumber(result.stats.arpdau),
        });
        setError(null);
      } else if (result.error) {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load monetization data");
    }
  }, []);

  useEffect(() => {
    async function loadInitial() {
      setLoading(true);
      setPlanLoading(true);
      
      try {
        // Check user plan
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("plan")
            .eq("id", user.id)
            .single();
          setUserPlan(profile?.plan || "free");
        }
        setPlanLoading(false);
        
        // Get selected game ID for realtime subscription
        const { game: selectedGame } = await getSelectedGame();
        if (selectedGame) {
          setSelectedGameId(selectedGame.id);
        }
        
        // Load stats
        await fetchData();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
        setPlanLoading(false);
      }
      
      setLoading(false);
    }
    loadInitial();
  }, [fetchData]);

  // Listen for global stats refresh
  useStatsRefresh(fetchData);

  // Get game ID for realtime subscription
  const gameIds = selectedGameId ? [selectedGameId] : [];

  // Setup Supabase Realtime subscription
  const { isLive, status: realtimeStatus } = useRealtimeStats({
    gameIds,
    onNewEvent: fetchData,
    enabled: gameIds.length > 0,
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchData(), refreshAnalytics()]);
    setRefreshing(false);
  };

  // Check if we have any data
  const hasData = stats.totalRevenue > 0 || stats.totalPurchases > 0;

  if (loading || planLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Plan lock for free users
  if (userPlan === "free") {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Monetization Analytics</h1>
          <p className="text-muted-foreground">Revenue performance and player spending insights</p>
        </div>
        <PlanLock 
          feature="Monetization Analytics" 
          description="Track revenue, paying users, conversion rates, and more with detailed monetization analytics. Available on Pro and Studio plans."
        />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Monetization Analytics</h1>
          <p className="text-muted-foreground">Revenue performance and player spending insights</p>
        </div>
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center justify-center py-8">
              <AlertCircle className="w-12 h-12 text-destructive mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">Unable to load monetization data</h3>
              <p className="text-sm text-muted-foreground mb-4">{error}</p>
              <Button variant="outline" onClick={handleRefresh}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Empty state
  if (!hasData) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Monetization Analytics</h1>
            <p className="text-muted-foreground">Revenue performance and player spending insights</p>
          </div>
        </div>

        <Card className="border-border bg-card">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <BarChart3 className="w-8 h-8 text-primary" />
            </div>
            <h3 className="text-xl font-semibold text-foreground mb-2">No monetization data yet</h3>
            <p className="text-muted-foreground text-center max-w-md mb-4">
              Start tracking purchase events in your Roblox game to see revenue analytics, paying users, and product performance.
            </p>
            <Button onClick={() => window.location.href = "/dashboard/game"}>
              Go to My Game
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <ErrorBoundary fallbackTitle="Unable to load Monetization">
      <div className="space-y-6">
        {/* Data Status Banner - safe with null check */}
        {dataHealth && <DataStatusBanner dataHealth={dataHealth} onSync={handleRefresh} />}

        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-foreground">Monetization Analytics</h1>
              {isLive ? (
                <UITooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-green-500/10 border border-green-500/20">
                      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                      <span className="text-[10px] font-semibold text-green-500 uppercase tracking-wider">Live</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>Connected to realtime updates</p>
                  </TooltipContent>
                </UITooltip>
              ) : realtimeStatus === "connecting" ? (
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-500/10 border border-amber-500/20">
                  <Radio className="w-3 h-3 text-amber-500 animate-pulse" />
                  <span className="text-[10px] font-semibold text-amber-500 uppercase tracking-wider">Connecting</span>
                </div>
              ) : null}
            </div>
            <p className="text-muted-foreground">Revenue performance and player spending insights</p>
          </div>
          <Button variant="outline" onClick={handleRefresh} disabled={refreshing} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="border-border bg-card">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                <DollarSign className="w-4 h-4" />
                Total Revenue
              </div>
              <div className="text-2xl font-bold text-foreground">
                <RobuxValue value={formatSafeNumber(stats.totalRevenue)} />
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                <ShoppingCart className="w-4 h-4" />
                Total Purchases
              </div>
              <div className="text-2xl font-bold text-foreground">
                {formatSafeNumber(stats.totalPurchases)}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                <Users className="w-4 h-4" />
                Paying Users
              </div>
              <div className="text-2xl font-bold text-foreground">
                {formatSafeNumber(stats.payingUsers)}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                <Percent className="w-4 h-4" />
                Conversion Rate
              </div>
              <div className="text-2xl font-bold text-foreground">
                {formatSafeNumber(stats.payerConversionRate, 1)}%
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ARPPU and ARPDAU */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="border-border bg-card">
            <CardContent className="pt-6">
              <div className="text-sm text-muted-foreground mb-1">Gamepasses Revenue</div>
              <div className="text-xl font-bold text-foreground">
                <RobuxValue value={formatSafeNumber(stats.passesRevenue)} />
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardContent className="pt-6">
              <div className="text-sm text-muted-foreground mb-1">Dev Products Revenue</div>
              <div className="text-xl font-bold text-foreground">
                <RobuxValue value={formatSafeNumber(stats.devProductsRevenue)} />
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardContent className="pt-6">
              <div className="text-sm text-muted-foreground mb-1">ARPPU</div>
              <div className="text-xl font-bold text-foreground">
                <RobuxValue value={formatSafeNumber(stats.arppu)} />
              </div>
              <div className="text-xs text-muted-foreground">Avg per paying user</div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardContent className="pt-6">
              <div className="text-sm text-muted-foreground mb-1">ARPDAU</div>
              <div className="text-xl font-bold text-foreground">
                <RobuxValue value={formatSafeNumber(stats.arpdau, 2)} />
              </div>
              <div className="text-xs text-muted-foreground">Avg per active user</div>
            </CardContent>
          </Card>
        </div>

        {/* Charts placeholder */}
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-primary" />
              Revenue Charts
            </CardTitle>
            <CardDescription>Coming soon - revenue trends over time</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <BarChart3 className="w-8 h-8 mr-2 opacity-50" />
              <span>Charts temporarily disabled for stability</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </ErrorBoundary>
  );
}
