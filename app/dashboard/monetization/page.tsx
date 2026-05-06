"use client";

import { useState, useEffect, useCallback } from "react";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Users,
  Percent,
  ChevronDown,
  Coins,
  ShoppingCart,
  RefreshCw,
  BarChart3,
  Radio,
} from "lucide-react";
import { RobuxValue } from "@/components/ui/robux-icon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  getMonetizationStats,
  type MonetizationStats,
  type HourlyRevenue,
  type DailyRevenue,
  type RevenueSource,
  type DailyMetric,
  type TopProduct,
} from "@/lib/actions/monetization";
import { getUserGames } from "@/lib/actions/games";
import { useStatsRefresh } from "@/hooks/use-stats-refresh";
import { useRealtimeStats } from "@/hooks/use-realtime-stats";
import { useRobloxMonetization } from "@/hooks/use-roblox-monetization";
import { Tooltip as UITooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Gamepad2, ExternalLink } from "lucide-react";
import { PlanLock } from "@/components/dashboard/plan-lock";
import { createClient } from "@/lib/supabase/client";

// Filter options
const dateRanges = ["Last 7 days", "Last 14 days", "Last 28 days"];

// Custom tooltip for charts - formats timestamps in user's local timezone
const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name: string; color: string }>; label?: string }) => {
  if (active && payload && payload.length) {
    // Format label in user's timezone if it looks like a timestamp
    let formattedLabel = label;
    if (label) {
      try {
        const date = new Date(label);
        if (!isNaN(date.getTime())) {
          const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
          formattedLabel = date.toLocaleString(undefined, { timeZone: tz });
        }
      } catch {
        // Keep original label
      }
    }
    
    return (
      <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
        <p className="text-sm font-medium text-foreground mb-1">{formattedLabel}</p>
        {payload.map((entry, index) => (
          <p key={index} className="text-sm" style={{ color: entry.color }}>
            {entry.name}: {typeof entry.value === "number" ? entry.value.toLocaleString() : entry.value}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

export default function MonetizationPage() {
  const [dateRange, setDateRange] = useState("Last 7 days");
  const [productSort, setProductSort] = useState<"revenue" | "purchases">("revenue");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<MonetizationStats | null>(null);
  const [hourlyRevenue, setHourlyRevenue] = useState<HourlyRevenue[]>([]);
  const [dailyRevenue, setDailyRevenue] = useState<DailyRevenue[]>([]);
  const [revenueSources, setRevenueSources] = useState<RevenueSource[]>([]);
  const [payingUsersOverTime, setPayingUsersOverTime] = useState<DailyMetric[]>([]);
  const [conversionOverTime, setConversionOverTime] = useState<DailyMetric[]>([]);
  const [arppuOverTime, setArppuOverTime] = useState<DailyMetric[]>([]);
  const [arpdauOverTime, setArpdauOverTime] = useState<DailyMetric[]>([]);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [games, setGames] = useState<{ id: string; name: string }[]>([]);
  const [selectedGameId, setSelectedGameId] = useState<string | undefined>();
  const [userPlan, setUserPlan] = useState<string>("free");
  const [planLoading, setPlanLoading] = useState(true);

  // Fetch real Roblox monetization data
  const { 
    monetizationData: robloxData, 
    isLoading: robloxLoading, 
    error: robloxError,
    needsConnection: robloxNeedsConnection,
    refresh: refreshRobloxData 
  } = useRobloxMonetization();

  const fetchData = useCallback(async () => {
    const result = await getMonetizationStats(selectedGameId);
    if (!result.error) {
      setStats(result.stats);
      setHourlyRevenue(result.hourlyRevenue);
      setDailyRevenue(result.dailyRevenue);
      setRevenueSources(result.revenueSources);
      setPayingUsersOverTime(result.payingUsersOverTime);
      setConversionOverTime(result.conversionOverTime);
      setArppuOverTime(result.arppuOverTime);
      setArpdauOverTime(result.arpdauOverTime);
      setTopProducts(result.topProducts);
    }
  }, [selectedGameId]);

  useEffect(() => {
    async function loadInitial() {
      setLoading(true);
      setPlanLoading(true);
      
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
      
      // Load games
      const { games: userGames } = await getUserGames();
      if (userGames && userGames.length > 0) {
        setGames(userGames.map((g) => ({ id: g.id, name: g.name })));
      }
      // Load stats
      await fetchData();
      setLoading(false);
    }
    loadInitial();
  }, [fetchData]);

  useEffect(() => {
    if (!loading) {
      fetchData();
    }
  }, [selectedGameId, fetchData, loading]);

  // Listen for global stats refresh
  useStatsRefresh(fetchData);

  // Get game IDs for realtime subscription
  const gameIds = selectedGameId ? [selectedGameId] : games.map(g => g.id);

  // Setup Supabase Realtime subscription
  const { isLive, status: realtimeStatus } = useRealtimeStats({
    gameIds,
    onNewEvent: fetchData,
    enabled: gameIds.length > 0,
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchData(), refreshRobloxData()]);
    setRefreshing(false);
  };

  // Get days based on date range for filtering charts
  const getDays = () => {
    switch (dateRange) {
      case "Last 7 days": return 7;
      case "Last 14 days": return 14;
      case "Last 28 days": return 28;
      default: return 7;
    }
  };

  const days = getDays();
  const filteredDailyRevenue = dailyRevenue.slice(-days);
  const filteredPayingUsers = payingUsersOverTime.slice(-days);
  const filteredConversion = conversionOverTime.slice(-days);
  const filteredArppu = arppuOverTime.slice(-days);
  const filteredArpdau = arpdauOverTime.slice(-days);

  // Sort products
  const sortedProducts = [...topProducts].sort((a, b) => {
    if (productSort === "revenue") return b.revenue - a.revenue;
    return b.purchases - a.purchases;
  });

  // Check if we have any data
  const hasData = stats && (stats.totalRevenue > 0 || stats.totalPurchases > 0);

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
            <div className="p-4 bg-amber-500/5 border border-amber-500/20 rounded-lg mb-6 max-w-md">
              <p className="text-sm text-amber-600 dark:text-amber-400 text-center">
                <strong>Setup hint:</strong> Send a <code className="bg-amber-500/10 px-1 rounded">purchase_success</code> event 
                or complete a Roblox purchase in your game to unlock monetization analytics.
              </p>
            </div>
            <Button onClick={() => window.location.href = "/dashboard/game"}>
              Go to My Game
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Merge Roblox API data with local event data
  const displayStats = {
    totalRevenue: robloxData?.totalRevenue || stats?.totalRevenue || 0,
    passesRevenue: robloxData?.gamepassRevenue || stats?.passesRevenue || 0,
    devProductsRevenue: robloxData?.devproductRevenue || stats?.devProductsRevenue || 0,
    totalPurchases: stats?.totalPurchases || 0,
    payingUsers: stats?.payingUsers || 0,
    uniquePlayers: stats?.uniquePlayers || 0,
    payerConversionRate: stats?.payerConversionRate || 0,
    arppu: stats?.arppu || 0,
    arpdau: stats?.arpdau || 0,
  };

  const hasRobloxData = robloxData && robloxData.totalRevenue > 0;

  return (
    <div className="space-y-6">
      {/* Roblox Connection Banner */}
      {robloxNeedsConnection && (
        <Alert className="border-blue-500/30 bg-blue-500/5">
          <Gamepad2 className="h-4 w-4 text-blue-500" />
          <AlertDescription className="flex items-center justify-between">
            <span className="text-blue-700 dark:text-blue-300">
              Connect your Roblox account to see real revenue data from the Roblox API.
            </span>
            <Button variant="outline" size="sm" className="ml-4 gap-2" asChild>
              <a href="/dashboard/settings">
                Connect Roblox
                <ExternalLink className="w-3 h-3" />
              </a>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Roblox Data Available Banner */}
      {hasRobloxData && (
        <Alert className="border-green-500/30 bg-green-500/5">
          <Gamepad2 className="h-4 w-4 text-green-500" />
          <AlertDescription className="text-green-700 dark:text-green-300">
            Showing real-time revenue data from Roblox API. Total lifetime revenue: <strong>R${robloxData.totalRevenue.toLocaleString()}</strong>
          </AlertDescription>
        </Alert>
      )}

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

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 p-4 bg-card border border-border rounded-lg">
        {/* Game selector */}
        {games.length > 1 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                {selectedGameId ? games.find((g) => g.id === selectedGameId)?.name : "All Games"}
                <ChevronDown className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => setSelectedGameId(undefined)}>
                All Games
              </DropdownMenuItem>
              {games.map((game) => (
                <DropdownMenuItem key={game.id} onClick={() => setSelectedGameId(game.id)}>
                  {game.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Date Range */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              {dateRange}
              <ChevronDown className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {dateRanges.map((range) => (
              <DropdownMenuItem key={range} onClick={() => setDateRange(range)}>
                {range}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-border bg-card">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <DollarSign className="w-4 h-4" />
              Total Revenue
              {hasRobloxData && <span className="text-[10px] text-green-500 ml-1">(Roblox API)</span>}
            </div>
            <div className="text-2xl font-bold text-foreground">
              <RobuxValue value={displayStats.totalRevenue.toLocaleString()} />
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
              {displayStats.totalPurchases.toLocaleString()}
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
              {displayStats.payingUsers.toLocaleString()}
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
              {displayStats.payerConversionRate.toFixed(1)}%
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ARPPU and ARPDAU */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-border bg-card">
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground mb-1">
              Gamepasses Revenue
              {hasRobloxData && <span className="text-[10px] text-green-500 ml-1">(Roblox API)</span>}
            </div>
            <div className="text-xl font-bold text-foreground">
              <RobuxValue value={displayStats.passesRevenue.toLocaleString()} />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground mb-1">
              Dev Products Revenue
              {hasRobloxData && <span className="text-[10px] text-green-500 ml-1">(Roblox API)</span>}
            </div>
            <div className="text-xl font-bold text-foreground">
              <RobuxValue value={displayStats.devProductsRevenue.toLocaleString()} />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground mb-1">ARPPU</div>
            <div className="text-xl font-bold text-foreground">
              <RobuxValue value={displayStats.arppu.toFixed(0)} />
            </div>
            <div className="text-xs text-muted-foreground">Avg per paying user</div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground mb-1">ARPDAU</div>
            <div className="text-xl font-bold text-foreground">
              <RobuxValue value={displayStats.arpdau.toFixed(2)} />
            </div>
            <div className="text-xs text-muted-foreground">Avg per active user</div>
          </CardContent>
        </Card>
      </div>

      {/* Hourly Revenue Chart */}
      <Card className="border-border bg-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-primary" />
                Hourly Revenue
              </CardTitle>
              <CardDescription>Last 72 hours breakdown</CardDescription>
            </div>
            <span className="text-xs text-muted-foreground bg-secondary/50 px-2 py-1 rounded">Fixed timeframe</span>
          </div>
        </CardHeader>
        <CardContent>
          {hourlyRevenue.length > 0 ? (
            <>
              {/* Summary stats */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
                <div className="p-3 bg-secondary/30 rounded-lg border-l-2 border-blue-500">
                  <div className="text-xs text-muted-foreground">Total Revenue</div>
                  <div className="text-lg font-bold text-foreground">
                    <RobuxValue value={hourlyRevenue.reduce((sum, d) => sum + d.total, 0).toLocaleString()} iconSize="xs" />
                  </div>
                </div>
                <div className="p-3 bg-secondary/30 rounded-lg border-l-2 border-green-500">
                  <div className="text-xs text-muted-foreground">Gamepasses</div>
                  <div className="text-lg font-bold text-foreground">
                    <RobuxValue value={hourlyRevenue.reduce((sum, d) => sum + d.passes, 0).toLocaleString()} iconSize="xs" />
                  </div>
                </div>
                <div className="p-3 bg-secondary/30 rounded-lg border-l-2 border-purple-500">
                  <div className="text-xs text-muted-foreground">Dev Products</div>
                  <div className="text-lg font-bold text-foreground">
                    <RobuxValue value={hourlyRevenue.reduce((sum, d) => sum + d.devProducts, 0).toLocaleString()} iconSize="xs" />
                  </div>
                </div>
              </div>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={hourlyRevenue}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis 
                      dataKey="time" 
                      tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} 
                      tickLine={false} 
                      axisLine={false}
                      interval={11}
                    />
                    <YAxis 
                      tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} 
                      tickLine={false} 
                      axisLine={false} 
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend 
                      wrapperStyle={{ paddingTop: "16px" }}
                      formatter={(value) => <span className="text-foreground text-sm">{value}</span>}
                    />
                    <Line type="monotone" dataKey="total" name="Total" stroke="#3b82f6" strokeWidth={2.5} dot={false} />
                    <Line type="monotone" dataKey="passes" name="Gamepasses" stroke="#22c55e" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="devProducts" name="Dev Products" stroke="#a855f7" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          ) : (
            <div className="h-48 flex items-center justify-center text-muted-foreground">
              No hourly data available
            </div>
          )}
        </CardContent>
      </Card>

      {/* Daily Revenue Chart */}
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            Daily Revenue
          </CardTitle>
          <CardDescription>{dateRange} revenue performance</CardDescription>
        </CardHeader>
        <CardContent>
          {filteredDailyRevenue.length > 0 ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={filteredDailyRevenue}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="revenue" name="Revenue" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center text-muted-foreground">
              No daily data available
            </div>
          )}
        </CardContent>
      </Card>

      {/* Revenue Sources & Payer Conversion */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Revenue Sources */}
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Coins className="w-5 h-5 text-primary" />
              Revenue Sources
            </CardTitle>
            <CardDescription>Breakdown by product type</CardDescription>
          </CardHeader>
          <CardContent>
            {revenueSources.length > 0 && revenueSources.some((s) => s.value > 0) ? (
              <div className="space-y-4">
                {revenueSources.map((source) => {
                  const total = revenueSources.reduce((sum, s) => sum + s.value, 0);
                  const percentage = total > 0 ? ((source.value / total) * 100).toFixed(1) : "0";
                  return (
                    <div key={source.name} className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: source.color }} />
                          <span className="text-foreground">{source.name}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-muted-foreground">{percentage}%</span>
                          <span className="font-medium text-foreground">
                            <RobuxValue value={source.value.toLocaleString()} iconSize="xs" />
                          </span>
                        </div>
                      </div>
                      <div className="h-2 bg-secondary/50 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${percentage}%`, backgroundColor: source.color }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="h-32 flex items-center justify-center text-muted-foreground">
                No revenue source data
              </div>
            )}
          </CardContent>
        </Card>

        {/* Payer Conversion Rate */}
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Percent className="w-5 h-5 text-primary" />
              Payer Conversion Rate
            </CardTitle>
            <CardDescription>Percentage of players who make a purchase</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 mb-4">
              <div className="text-3xl font-bold text-foreground">{stats?.payerConversionRate.toFixed(1) || 0}%</div>
            </div>
            {filteredConversion.length > 0 ? (
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={filteredConversion}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="date" tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v.toFixed(0)}%`} />
                    <Tooltip content={<CustomTooltip />} />
                    <Line type="monotone" dataKey="value" name="Conversion %" stroke="var(--primary)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-48 flex items-center justify-center text-muted-foreground">
                No conversion data
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Paying Users & ARPPU */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Paying Users */}
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" />
              Paying Users
            </CardTitle>
            <CardDescription>Unique users who made purchases</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 mb-4">
              <div className="text-3xl font-bold text-foreground">{stats?.payingUsers.toLocaleString() || 0}</div>
            </div>
            {filteredPayingUsers.length > 0 ? (
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={filteredPayingUsers}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="date" tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} tickLine={false} axisLine={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Area type="monotone" dataKey="value" name="Paying Users" stroke="var(--primary)" fill="var(--primary)" fillOpacity={0.2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-48 flex items-center justify-center text-muted-foreground">
                No user data
              </div>
            )}
          </CardContent>
        </Card>

        {/* ARPPU Over Time */}
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-primary" />
              ARPPU Trend
            </CardTitle>
            <CardDescription>Average Revenue Per Paying User</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 mb-4">
              <div className="text-3xl font-bold text-foreground">
                <RobuxValue value={stats?.arppu.toFixed(0) || "0"} />
              </div>
            </div>
            {filteredArppu.length > 0 ? (
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={filteredArppu}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="date" tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} tickLine={false} axisLine={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Line type="monotone" dataKey="value" name="ARPPU" stroke="#22c55e" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-48 flex items-center justify-center text-muted-foreground">
                No ARPPU data
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top Monetization Products */}
      <Card className="border-border bg-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Top Monetization Products</CardTitle>
              <CardDescription>Best performing products by revenue</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant={productSort === "revenue" ? "default" : "outline"}
                size="sm"
                onClick={() => setProductSort("revenue")}
              >
                By Revenue
              </Button>
              <Button
                variant={productSort === "purchases" ? "default" : "outline"}
                size="sm"
                onClick={() => setProductSort("purchases")}
              >
                By Purchases
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {sortedProducts.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">Product</th>
                    <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">Type</th>
                    <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">Revenue</th>
                    <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">Purchases</th>
                    <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">Conversion</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedProducts.map((product, index) => (
                    <tr key={product.id} className="border-b border-border/50 hover:bg-secondary/20">
                      <td className="py-3 px-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground w-5">{index + 1}</span>
                          <span className="font-medium text-foreground">{product.name}</span>
                        </div>
                      </td>
                      <td className="py-3 px-2">
                        <span className={`text-xs px-2 py-1 rounded ${
                          product.type === "Gamepass" 
                            ? "bg-blue-500/10 text-blue-500" 
                            : "bg-green-500/10 text-green-500"
                        }`}>
                          {product.type}
                        </span>
                      </td>
                      <td className="py-3 px-2 text-right font-medium text-foreground">
                        <RobuxValue value={product.revenue.toLocaleString()} iconSize="xs" />
                      </td>
                      <td className="py-3 px-2 text-right text-foreground">
                        {product.purchases.toLocaleString()}
                      </td>
                      <td className="py-3 px-2 text-right text-muted-foreground">
                        {product.conversion > 0 ? `${product.conversion.toFixed(1)}%` : "Needs tracking"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="h-32 flex items-center justify-center text-muted-foreground">
              No product data available. Send test events to see products here.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
