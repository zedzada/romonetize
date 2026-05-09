"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAnalytics, formatChartTime } from "@/hooks/use-analytics";
import { ChartCard, chartAxisStyle, chartGridStyle, CHART_COLORS } from "@/components/dashboard/chart-card";
import { 
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  Tooltip,
  LabelList,
} from "recharts";
import { 
  Users, 
  Eye, 
  Heart, 
  ThumbsUp, 
  ThumbsDown, 
  RefreshCw,
  Activity,
  Clock,
  UserPlus,
  UserCheck,
  ShoppingCart,
  Gamepad2,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";

// Safe number formatter - never crashes
function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString();
}

// Safe duration formatter
function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

export default function PerformancePage() {
  const {
    isLoading,
    isRefreshing,
    error,
    game,
    dataHealth,
    robloxStats,
    trackerStats,
    performanceCharts,
    ccuStats,
    refresh,
    needsTrackingScript,
    hasTrackerData,
    hasRobloxData,
  } = useAnalytics({ enabled: true, range: "7d" });

  // Safe defaults
  const safeDataHealth = dataHealth ?? {
    hasTrackerEvents: false,
    trackerEventsCount: 0,
    hasRobloxApiData: false,
    missing: [],
  };

  const safeTrackerStats = trackerStats ?? {
    totalEvents: 0,
    uniquePlayers: 0,
    totalSessions: 0,
    avgSessionDuration: null,
    newPlayers: 0,
    returningPlayers: 0,
    totalPurchases: 0,
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Game Performance</h1>
          <p className="text-muted-foreground">Monitor your game&apos;s analytics and metrics</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[...Array(5)].map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <Skeleton className="h-4 w-20 mb-2" />
                <Skeleton className="h-8 w-24" />
              </CardContent>
            </Card>
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
          <h1 className="text-2xl font-bold text-foreground">Game Performance</h1>
          <p className="text-muted-foreground">Monitor your game&apos;s analytics and metrics</p>
        </div>
        <Card className="border-destructive/50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="w-5 h-5" />
              <span>Failed to load analytics: {error}</span>
            </div>
            <Button onClick={refresh} variant="outline" className="mt-4">
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
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Game Performance</h1>
          <p className="text-muted-foreground">Monitor your game&apos;s analytics and metrics</p>
        </div>
        <Button 
          onClick={refresh} 
          variant="outline" 
          disabled={isRefreshing}
          className="w-fit"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`} />
          Refresh Data
        </Button>
      </div>

      {/* Selected Game Card */}
      {game && (
        <Card className="border-border/50">
          <CardContent className="pt-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Gamepad2 className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h2 className="font-semibold text-foreground">{game.name}</h2>
                  <p className="text-sm text-muted-foreground">
                    {game.universe_id ? `Universe ID: ${game.universe_id}` : `Game ID: ${game.roblox_game_id}`}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {hasRobloxData && (
                  <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 border-blue-500/20">
                    Roblox API
                  </Badge>
                )}
                {hasTrackerData ? (
                  <Badge variant="secondary" className="bg-green-500/10 text-green-600 border-green-500/20">
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    Tracking active
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 border-amber-500/20">
                    <AlertCircle className="w-3 h-3 mr-1" />
                    Waiting for tracking script
                  </Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Data Status Banner */}
      {hasRobloxData && (
        <div className="flex items-center gap-2 text-sm text-green-600 bg-green-500/10 px-4 py-2 rounded-lg border border-green-500/20">
          <CheckCircle2 className="w-4 h-4" />
          Roblox data synced
        </div>
      )}

      {needsTrackingScript && (
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-amber-500/10 px-4 py-3 rounded-lg border border-amber-500/20">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5" />
            <p className="text-sm text-amber-700">
              Install the RoMonetize tracking script to unlock sessions, retention, purchases, and revenue.
            </p>
          </div>
          <Button variant="outline" size="sm" asChild className="w-fit">
            <Link href="/dashboard/game/tracking-setup">
              View Installation Guide
              <ExternalLink className="w-3 h-3 ml-2" />
            </Link>
          </Button>
        </div>
      )}

      {/* Roblox Game Stats */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground">Roblox Game Stats</h3>
          <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-[10px]">
            Roblox API
          </Badge>
        </div>
        {robloxStats ? (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Card className="border-border/50">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-2 mb-2">
                  <Users className="w-4 h-4 text-green-500" />
                  <span className="text-xs text-muted-foreground">Current CCU</span>
                </div>
                <div className="text-2xl font-bold text-foreground">
                  {formatNumber(robloxStats.ccu)}
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-2 mb-2">
                  <Eye className="w-4 h-4 text-blue-500" />
                  <span className="text-xs text-muted-foreground">Total Visits</span>
                </div>
                <div className="text-2xl font-bold text-foreground">
                  {formatNumber(robloxStats.visits)}
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-2 mb-2">
                  <Heart className="w-4 h-4 text-pink-500" />
                  <span className="text-xs text-muted-foreground">Favorites</span>
                </div>
                <div className="text-2xl font-bold text-foreground">
                  {formatNumber(robloxStats.favorites)}
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-2 mb-2">
                  <ThumbsUp className="w-4 h-4 text-green-500" />
                  <span className="text-xs text-muted-foreground">Likes</span>
                </div>
                <div className="text-2xl font-bold text-foreground">
                  {formatNumber(robloxStats.likes)}
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-2 mb-2">
                  <ThumbsDown className="w-4 h-4 text-red-500" />
                  <span className="text-xs text-muted-foreground">Dislikes</span>
                </div>
                <div className="text-2xl font-bold text-foreground">
                  {formatNumber(robloxStats.dislikes)}
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card className="border-border/50">
            <CardContent className="pt-6 pb-6 text-center">
              <p className="text-muted-foreground mb-4">No Roblox data available yet</p>
              <Button onClick={refresh} variant="outline">
                <RefreshCw className="w-4 h-4 mr-2" />
                Sync Roblox Data
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Tracker Stats */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground">Tracker Stats</h3>
          <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px]">
            RoMonetize Tracker
          </Badge>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          <Card className="border-border/50">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-4 h-4 text-indigo-500" />
                <span className="text-xs text-muted-foreground">Tracker Events</span>
              </div>
              {safeDataHealth.hasTrackerEvents ? (
                <div className="text-2xl font-bold text-foreground">
                  {formatNumber(safeDataHealth.trackerEventsCount || safeTrackerStats.totalEvents)}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">Requires tracking script</div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-4 h-4 text-cyan-500" />
                <span className="text-xs text-muted-foreground">Unique Players</span>
              </div>
              {safeDataHealth.hasTrackerEvents ? (
                <div className="text-2xl font-bold text-foreground">
                  {formatNumber(safeTrackerStats.uniquePlayers)}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">Requires tracking script</div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-4 h-4 text-violet-500" />
                <span className="text-xs text-muted-foreground">Total Sessions</span>
              </div>
              {safeDataHealth.hasTrackerEvents ? (
                <div className="text-2xl font-bold text-foreground">
                  {formatNumber(safeTrackerStats.totalSessions)}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">Requires tracking script</div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-orange-500" />
                <span className="text-xs text-muted-foreground">Avg Session</span>
              </div>
              {safeDataHealth.hasTrackerEvents ? (
                safeTrackerStats.avgSessionDuration !== null ? (
                  <div className="text-2xl font-bold text-foreground">
                    {formatDuration(safeTrackerStats.avgSessionDuration)}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">Not enough data yet</div>
                )
              ) : (
                <div className="text-xs text-muted-foreground">Requires tracking script</div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2 mb-2">
                <UserPlus className="w-4 h-4 text-emerald-500" />
                <span className="text-xs text-muted-foreground">New Players</span>
              </div>
              {safeDataHealth.hasTrackerEvents ? (
                <div className="text-2xl font-bold text-foreground">
                  {formatNumber(safeTrackerStats.newPlayers)}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">Requires tracking script</div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2 mb-2">
                <UserCheck className="w-4 h-4 text-teal-500" />
                <span className="text-xs text-muted-foreground">Returning Players</span>
              </div>
              {safeDataHealth.hasTrackerEvents ? (
                <div className="text-2xl font-bold text-foreground">
                  {formatNumber(safeTrackerStats.returningPlayers)}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">Requires tracking script</div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2 mb-2">
                <ShoppingCart className="w-4 h-4 text-rose-500" />
                <span className="text-xs text-muted-foreground">Purchases</span>
              </div>
              {safeDataHealth.hasTrackerEvents ? (
                <div className="text-2xl font-bold text-foreground">
                  {formatNumber(safeTrackerStats.totalPurchases)}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">Requires tracking script</div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Charts Section */}
      {(hasTrackerData || ccuStats?.snapshots?.length) && (
        <div className="space-y-6">
          <h3 className="text-lg font-semibold text-foreground">Performance Charts</h3>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* CCU Over Time */}
            <ChartCard
              title="CCU Over Time"
              subtitle="Concurrent users playing your game"
              source="roblox"
              summary={ccuStats?.snapshots?.length ? `Current: ${ccuStats.snapshots[ccuStats.snapshots.length - 1]?.ccu ?? 0} · Peak: ${Math.max(...ccuStats.snapshots.map(s => s.ccu ?? 0))}` : undefined}
              isEmpty={!ccuStats?.snapshots?.length}
              emptyTitle="No CCU history yet"
              emptyMessage="CCU snapshots will appear after Roblox data is synced."
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={ccuStats?.snapshots ?? []} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="ccuGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART_COLORS.blue} stopOpacity={0.4}/>
                      <stop offset="100%" stopColor={CHART_COLORS.blue} stopOpacity={0.05}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...chartGridStyle} />
                  <XAxis 
                    dataKey="time" 
                    tickFormatter={(v) => formatChartTime(v, "7d")}
                    {...chartAxisStyle}
                  />
                  <YAxis 
                    domain={[0, (dataMax: number) => Math.max(Math.ceil(dataMax * 1.2), 10)]}
                    allowDecimals={false}
                    {...chartAxisStyle}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#171717",
                      border: "1px solid #404040",
                      borderRadius: "8px",
                      padding: "10px",
                    }}
                    labelStyle={{ color: "#F5F5F5", fontWeight: 600 }}
                    formatter={(value: number) => [value, "CCU"]}
                    labelFormatter={(label) => formatChartTime(label, "7d")}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="ccu" 
                    stroke={CHART_COLORS.blue}
                    strokeWidth={3}
                    fill="url(#ccuGradient)"
                    dot={{ r: 3, fill: CHART_COLORS.blue, strokeWidth: 0 }}
                    activeDot={{ r: 6, fill: CHART_COLORS.blue, strokeWidth: 2, stroke: "#0a0a0a" }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* Events Over Time */}
            <ChartCard
              title="Events Over Time"
              subtitle="All tracked events from your game"
              source="tracker"
              summary={performanceCharts?.eventsOverTime?.length ? `Total: ${performanceCharts.eventsOverTime.reduce((sum, d) => sum + (d.events ?? 0), 0).toLocaleString()}` : undefined}
              isEmpty={!performanceCharts?.eventsOverTime?.length}
              emptyTitle="No events yet"
              emptyMessage="Events will appear after players interact with your game."
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={performanceCharts?.eventsOverTime ?? []} margin={{ top: 20, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="eventsGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART_COLORS.violet} stopOpacity={1}/>
                      <stop offset="100%" stopColor={CHART_COLORS.violet} stopOpacity={0.7}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...chartGridStyle} />
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={(v) => formatChartTime(v, "7d")}
                    {...chartAxisStyle}
                  />
                  <YAxis 
                    allowDecimals={false}
                    {...chartAxisStyle}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#171717",
                      border: "1px solid #404040",
                      borderRadius: "8px",
                      padding: "10px",
                    }}
                    labelStyle={{ color: "#F5F5F5", fontWeight: 600 }}
                    formatter={(value: number) => [value.toLocaleString(), "Events"]}
                    labelFormatter={(label) => formatChartTime(label, "7d")}
                  />
                  <Bar 
                    dataKey="events" 
                    fill="url(#eventsGradient)"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={50}
                  >
                    {(performanceCharts?.eventsOverTime?.length ?? 0) <= 3 && (
                      <LabelList dataKey="events" position="top" fill="#F5F5F5" fontSize={12} fontWeight={600} />
                    )}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* Players Over Time */}
            <ChartCard
              title="Player Joins Over Time"
              subtitle="Unique players who joined sessions"
              source="tracker"
              summary={performanceCharts?.playersOverTime?.length ? `Total: ${performanceCharts.playersOverTime.reduce((sum, d) => sum + (d.players ?? 0), 0).toLocaleString()}` : undefined}
              isEmpty={!performanceCharts?.playersOverTime?.length}
              emptyTitle="No player data yet"
              emptyMessage="Player joins will appear after session_start events are tracked."
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={performanceCharts?.playersOverTime ?? []} margin={{ top: 20, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="playersGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART_COLORS.cyan} stopOpacity={1}/>
                      <stop offset="100%" stopColor={CHART_COLORS.cyan} stopOpacity={0.7}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...chartGridStyle} />
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={(v) => formatChartTime(v, "7d")}
                    {...chartAxisStyle}
                  />
                  <YAxis 
                    allowDecimals={false}
                    {...chartAxisStyle}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#171717",
                      border: "1px solid #404040",
                      borderRadius: "8px",
                      padding: "10px",
                    }}
                    labelStyle={{ color: "#F5F5F5", fontWeight: 600 }}
                    formatter={(value: number) => [value.toLocaleString(), "Players"]}
                    labelFormatter={(label) => formatChartTime(label, "7d")}
                  />
                  <Bar 
                    dataKey="players" 
                    fill="url(#playersGradient)"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={50}
                  >
                    {(performanceCharts?.playersOverTime?.length ?? 0) <= 3 && (
                      <LabelList dataKey="players" position="top" fill="#F5F5F5" fontSize={12} fontWeight={600} />
                    )}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* Purchases Over Time */}
            <ChartCard
              title="Purchases Over Time"
              subtitle="Successful product purchases"
              source="tracker"
              summary={performanceCharts?.purchasesOverTime?.length ? `Total: ${performanceCharts.purchasesOverTime.reduce((sum, d) => sum + (d.purchases ?? 0), 0).toLocaleString()}` : undefined}
              isEmpty={!performanceCharts?.purchasesOverTime?.length}
              emptyTitle="No purchases yet"
              emptyMessage="Purchases will appear after purchase_success events are tracked."
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={performanceCharts?.purchasesOverTime ?? []} margin={{ top: 20, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="purchasesBarGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART_COLORS.green} stopOpacity={1}/>
                      <stop offset="100%" stopColor={CHART_COLORS.green} stopOpacity={0.7}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...chartGridStyle} />
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={(v) => formatChartTime(v, "7d")}
                    {...chartAxisStyle}
                  />
                  <YAxis 
                    allowDecimals={false}
                    {...chartAxisStyle}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#171717",
                      border: "1px solid #404040",
                      borderRadius: "8px",
                      padding: "10px",
                    }}
                    labelStyle={{ color: "#F5F5F5", fontWeight: 600 }}
                    formatter={(value: number) => [value.toLocaleString(), "Purchases"]}
                    labelFormatter={(label) => formatChartTime(label, "7d")}
                  />
                  <Bar 
                    dataKey="purchases" 
                    fill="url(#purchasesBarGradient)"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={50}
                  >
                    {(performanceCharts?.purchasesOverTime?.length ?? 0) <= 3 && (
                      <LabelList dataKey="purchases" position="top" fill="#F5F5F5" fontSize={12} fontWeight={600} />
                    )}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        </div>
      )}

      {/* Empty state for charts when no tracker data and no CCU data */}
      {!hasTrackerData && !ccuStats?.snapshots?.length && (
        <Card className="border-neutral-700/60 bg-neutral-900/50">
          <CardContent className="pt-6 pb-6">
            <div className="text-center">
              <TrendingUp className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
              <h4 className="font-medium text-foreground mb-2">Charts require tracking data</h4>
              <p className="text-sm text-muted-foreground mb-4">
                Install the RoMonetize tracking script to see events, players, and purchase charts.
              </p>
              <Button variant="outline" asChild>
                <Link href="/dashboard/game/tracking-setup">
                  View Installation Guide
                  <ExternalLink className="w-3 h-3 ml-2" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
