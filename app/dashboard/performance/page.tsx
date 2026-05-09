"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Users,
  ShoppingCart,
  Clock,
  DollarSign,
  TrendingUp,
  Gamepad2,
  Calendar,
  RefreshCw,
  ExternalLink,
  Store,
  Activity,
  Radio,
  UserPlus,
  UserCheck,
  HelpCircle,
  BarChart3,
  Eye,
  Heart,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { RobuxValue } from "@/components/ui/robux-icon";
import { DataStatusBanner } from "@/components/dashboard/data-status-banner";
import { useAnalytics } from "@/hooks/use-analytics";
import Link from "next/link";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
} from "recharts";
import { getSelectedGame } from "@/lib/actions/games";
import { getPerformanceStats, type PerformanceData, type DataSource } from "@/lib/actions/performance";
import { useStatsRefresh } from "@/hooks/use-stats-refresh";
import { useRealtimeStats } from "@/hooks/use-realtime-stats";
import { Tooltip as UITooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type Game = {
  id: string;
  name: string;
  roblox_game_id: string;
  status: string;
  api_key: string;
  created_at: string;
  last_event_at: string | null;
};

// CCU time period tabs
const ccuPeriods = [
  { label: "Last 1 hour", value: "1h", hours: 1 },
  { label: "Last 1 day", value: "1d", hours: 24 },
  { label: "Last 7 days", value: "7d", hours: 168 },
  { label: "Last 30 days", value: "30d", hours: 720 },
];

// Retention tabs
const retentionTabs = [
  { label: "Day 1", value: "d1", days: 1 },
  { label: "Day 7", value: "d7", days: 7 },
  { label: "Day 30", value: "d30", days: 30 },
];

// Source label component with detailed unavailable messages
function SourceLabel({ source, unavailableReason }: { source: DataSource; unavailableReason?: "roblox" | "tracker" }) {
  const config = {
    roblox_api: { label: "Roblox API", color: "text-blue-500", bg: "bg-blue-500/10" },
    romonetize_tracker: { label: "RoMonetize", color: "text-primary", bg: "bg-primary/10" },
    not_available: { 
      label: unavailableReason === "roblox" 
        ? "Not available from Roblox API" 
        : unavailableReason === "tracker"
        ? "Requires more tracker data"
        : "No data",
      color: "text-muted-foreground", 
      bg: "bg-muted/50" 
    },
  };
  const c = config[source];
  return (
    <span className={`text-[9px] font-medium ${c.color} ${c.bg} px-1.5 py-0.5 rounded`}>
      {c.label}
    </span>
  );
}

export default function PerformancePage() {
  const [loading, setLoading] = useState(true);
  const [game, setGame] = useState<Game | null>(null);
  const [performanceData, setPerformanceData] = useState<PerformanceData | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [ccuPeriod, setCcuPeriod] = useState("1d");
  const [retentionTab, setRetentionTab] = useState("d1");
  const gameIds = game ? [game.id] : [];

  // Use central analytics hook for Roblox stats - single source of truth
  const { 
    dataHealth, 
    robloxStats,
    refresh: refreshAnalytics,
    isLoading: analyticsLoading,
    error: analyticsError,
  } = useAnalytics({ enabled: !!game });

  const fetchPerformanceData = async (gameId: string) => {
    const { data } = await getPerformanceStats(gameId, 30); // Always fetch 30 days for comprehensive data
    if (data) {
      setPerformanceData(data);
    }
  };



  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      const { game: selectedGame, error } = await getSelectedGame();

      if (!error && selectedGame) {
        setGame(selectedGame);
        await fetchPerformanceData(selectedGame.id);
      }

      setLoading(false);
    }

    fetchData();
  }, []);



  const handleRefresh = useCallback(async () => {
    if (!game) return;
    setIsRefreshing(true);
    await Promise.all([
      fetchPerformanceData(game.id),
      refreshAnalytics(),
    ]);
    setIsRefreshing(false);
  }, [game, refreshAnalytics]);

  useStatsRefresh(handleRefresh);

  const { isLive, status: realtimeStatus } = useRealtimeStats({
    gameIds,
    onNewEvent: handleRefresh,
    enabled: gameIds.length > 0,
  });

  const formatNumber = (num: number | null | undefined) => {
    if (num === null || num === undefined) return "—";
    if (num >= 1000000000) return (num / 1000000000).toFixed(1) + "B";
    if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
    if (num >= 1000) return (num / 1000).toFixed(1) + "K";
    return num.toString();
  };

  const formatPercent = (value: number | null) => {
    if (value === null) return "—";
    return `${value.toFixed(1)}%`;
  };

  // Loading state
  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Game Performance</h1>
          <p className="text-muted-foreground">Loading your game data...</p>
        </div>
        <Card className="border-border bg-card">
          <CardContent className="py-16">
            <div className="flex items-center justify-center">
              <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Empty state when no game is connected
  if (!game) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Game Performance</h1>
          <p className="text-muted-foreground">Monitor your game&apos;s analytics and metrics</p>
        </div>
        <Card className="border-border bg-card">
          <CardContent className="py-16">
            <Empty>
              <EmptyMedia variant="icon">
                <Gamepad2 className="w-6 h-6" />
              </EmptyMedia>
              <EmptyTitle>Connect your Roblox game first</EmptyTitle>
              <EmptyDescription>
                Connect your Roblox Game ID to view performance analytics, player metrics, and
                revenue tracking.
              </EmptyDescription>
              <Button asChild className="mt-4">
                <Link href="/dashboard/game">
                  <Gamepad2 className="w-4 h-4 mr-2" />
                  Connect a Game
                </Link>
              </Button>
            </Empty>
          </CardContent>
        </Card>
      </div>
    );
  }

  const stats = performanceData?.stats;
  const timeSeries = performanceData?.timeSeries || [];
  const hasTrackerData = stats && stats.totalEvents > 0;

  // Format dates in user's local timezone
  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  
  const lastEventDate = stats?.lastEventTime
    ? new Date(stats.lastEventTime).toLocaleString(undefined, { timeZone: userTimezone })
    : "No events yet";

  // Get retention data based on selected tab
  const getRetentionData = () => {
    switch (retentionTab) {
      case "d1":
        return { rate: stats?.day1Retention, label: "Day 1 Retention" };
      case "d7":
        return { rate: stats?.day7Retention, label: "Day 7 Retention" };
      case "d30":
        return { rate: stats?.day30Retention, label: "Day 30 Retention" };
      default:
        return { rate: null, label: "Retention" };
    }
  };

  const retentionData = getRetentionData();

  // Get CCU chart data from real CCU snapshots
  const getCCUChartData = () => {
    const period = ccuPeriods.find(p => p.value === ccuPeriod);
    if (!period) return [];
    
    // Use real CCU snapshots from the database
    const ccuSnapshots = performanceData?.ccuSnapshots || [];
    if (ccuSnapshots.length === 0) return [];
    
    // Filter data based on selected period
    const now = new Date();
    const cutoff = new Date(now.getTime() - period.hours * 60 * 60 * 1000);
    
    // Format time in user's timezone
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    
    return ccuSnapshots
      .filter(d => new Date(d.time) >= cutoff)
      .map(d => {
        const date = new Date(d.time);
        const formattedTime = date.toLocaleString(undefined, {
          weekday: "short",
          hour: "numeric",
          minute: "2-digit",
          hour12: false,
          timeZone: tz,
        });
        return {
          time: formattedTime,
          ccu: d.ccu,
        };
      });
  };

  const ccuChartData = getCCUChartData();
  const peakCCU = ccuChartData.length > 0 ? Math.max(...ccuChartData.map(d => d.ccu)) : null;
  const avgCCU = ccuChartData.length > 0 
    ? Math.round(ccuChartData.reduce((sum, d) => sum + d.ccu, 0) / ccuChartData.length) 
    : null;
  
  // Use robloxStats from central analytics hook (single source of truth)
  const currentCCU = robloxStats?.ccu ?? null;
  const totalVisits = robloxStats?.visits ?? null;
  const favorites = robloxStats?.favorites ?? null;
  const likes = robloxStats?.likes ?? null;
  const dislikes = robloxStats?.dislikes ?? null;
  const hasRobloxStats = robloxStats !== null;

  // Generate retention trend data
  const retentionChartData = timeSeries.map(d => ({
    date: d.date,
    newPlayers: d.newPlayers,
    returningPlayers: d.returningPlayers,
    rate: d.players > 0 ? Math.round((d.returningPlayers / d.players) * 100) : 0,
  }));

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-foreground">Game Performance</h1>
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
          <p className="text-muted-foreground">
            Monitor your game&apos;s analytics and metrics
            {robloxStats?.updatedAt && (
              <span className="text-xs ml-2 text-muted-foreground/60">
                Roblox data: {new Date(robloxStats.updatedAt).toLocaleTimeString(undefined, { timeZone: userTimezone })}
              </span>
            )}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="gap-2 self-start"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
          {isRefreshing ? "Refreshing..." : "Refresh Data"}
        </Button>
      </div>

      {/* Game header card */}
      <Card className="border-border bg-card">
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row md:items-center gap-6">
            <div className="w-20 h-20 rounded-xl bg-gradient-to-br from-primary/20 to-blue-400/20 flex items-center justify-center shrink-0">
              <Gamepad2 className="w-10 h-10 text-primary" />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-3 mb-2">
                <h2 className="text-xl font-bold text-foreground">{game.name}</h2>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    game.status === "active"
                      ? "bg-green-500/10 text-green-500"
                      : "bg-orange-500/10 text-orange-500"
                  }`}
                >
                  {game.status}
                </span>
                <a
                  href={`https://www.roblox.com/games/${game.roblox_game_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:text-primary/80 transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
              <p className="text-muted-foreground mb-3">Roblox Game ID: {game.roblox_game_id}</p>

              <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Connected:</span>
                  <span className="text-foreground">
                    {new Date(game.created_at).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Last event: {lastEventDate}</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Data Status Banner */}
      <DataStatusBanner 
        dataHealth={dataHealth} 
        onSync={() => {
          handleRefresh();
          refreshAnalytics();
        }}
      />

      {/* Data Sources Explanation */}
      <div className="p-4 bg-secondary/30 border border-border rounded-lg">
        <div className="flex items-start gap-3">
          <HelpCircle className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
          <div className="text-sm text-muted-foreground">
            <p className="mb-1">
              <strong className="text-foreground">Data Sources:</strong> Stats marked{" "}
              <span className="text-blue-500 bg-blue-500/10 px-1 rounded text-xs">Roblox API</span> come from Roblox directly.
              Stats marked <span className="text-primary bg-primary/10 px-1 rounded text-xs">RoMonetize</span> require the tracker script installed in your game.
            </p>
            <p className="text-xs">
              Some historical metrics are not exposed by Roblox API. RoMonetize starts collecting deep analytics after tracker installation.
            </p>
          </div>
        </div>
      </div>

      {/* Tracker Stats Overview */}
      <Card className="border-border bg-card">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            Tracker Stats
            <UITooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="w-3.5 h-3.5 text-muted-foreground/50 cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-[220px]">
                Analytics collected by RoMonetize tracker script
              </TooltipContent>
            </UITooltip>
          </CardTitle>
          <CardDescription>Overview of tracker-collected metrics</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
            <div className="p-4 rounded-lg bg-secondary/30 border border-border/50">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-4 h-4 text-primary" />
                <span className="text-xs text-muted-foreground">Tracker Events</span>
              </div>
              <div className="text-2xl font-bold text-foreground">
                {formatNumber(stats?.totalEvents)}
              </div>
              <SourceLabel source={hasTrackerData ? "romonetize_tracker" : "not_available"} unavailableReason="tracker" />
            </div>
            <div className="p-4 rounded-lg bg-secondary/30 border border-border/50">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-4 h-4 text-cyan-500" />
                <span className="text-xs text-muted-foreground">Unique Players</span>
              </div>
              <div className="text-2xl font-bold text-foreground">
                {formatNumber(stats?.uniquePlayers)}
              </div>
              <SourceLabel source={hasTrackerData ? "romonetize_tracker" : "not_available"} unavailableReason="tracker" />
            </div>
            <div className="p-4 rounded-lg bg-secondary/30 border border-border/50">
              <div className="flex items-center gap-2 mb-2">
                <Gamepad2 className="w-4 h-4 text-violet-500" />
                <span className="text-xs text-muted-foreground">Total Sessions</span>
              </div>
              <div className="text-2xl font-bold text-foreground">
                {formatNumber(stats?.visits)}
              </div>
              <SourceLabel source={hasTrackerData ? "romonetize_tracker" : "not_available"} unavailableReason="tracker" />
            </div>
            <div className="p-4 rounded-lg bg-secondary/30 border border-border/50">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-amber-500" />
                <span className="text-xs text-muted-foreground">Avg Session</span>
              </div>
              <div className="text-2xl font-bold text-foreground">
                {stats?.avgSessionDuration ? `${Math.floor(stats.avgSessionDuration / 60)}m` : "—"}
              </div>
              <SourceLabel 
                source={stats?.avgSessionDuration ? "romonetize_tracker" : "not_available"} 
                unavailableReason="tracker" 
              />
            </div>
            <div className="p-4 rounded-lg bg-secondary/30 border border-border/50">
              <div className="flex items-center gap-2 mb-2">
                <UserPlus className="w-4 h-4 text-green-500" />
                <span className="text-xs text-muted-foreground">New Players</span>
              </div>
              <div className="text-2xl font-bold text-foreground">
                {formatNumber(stats?.newPlayers)}
              </div>
              <SourceLabel source={hasTrackerData ? "romonetize_tracker" : "not_available"} unavailableReason="tracker" />
            </div>
            <div className="p-4 rounded-lg bg-secondary/30 border border-border/50">
              <div className="flex items-center gap-2 mb-2">
                <UserCheck className="w-4 h-4 text-blue-500" />
                <span className="text-xs text-muted-foreground">Returning</span>
              </div>
              <div className="text-2xl font-bold text-foreground">
                {formatNumber(stats?.returningPlayers)}
              </div>
              <SourceLabel source={hasTrackerData ? "romonetize_tracker" : "not_available"} unavailableReason="tracker" />
            </div>
            <div className="p-4 rounded-lg bg-secondary/30 border border-border/50">
              <div className="flex items-center gap-2 mb-2">
                <Store className="w-4 h-4 text-orange-500" />
                <span className="text-xs text-muted-foreground">Shop Opens</span>
              </div>
              <div className="text-2xl font-bold text-foreground">
                {formatNumber(stats?.shopOpens)}
              </div>
              <SourceLabel source={hasTrackerData ? "romonetize_tracker" : "not_available"} unavailableReason="tracker" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Roblox API Stats */}
      <Card className="border-border bg-card">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <Eye className="w-5 h-5 text-blue-500" />
            Roblox Game Stats
            <UITooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="w-3.5 h-3.5 text-muted-foreground/50 cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-[220px]">
                Live stats fetched directly from Roblox API
              </TooltipContent>
            </UITooltip>
          </CardTitle>
          <CardDescription>Live metrics from Roblox</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="p-4 rounded-lg bg-secondary/30 border border-border/50">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-4 h-4 text-green-500" />
                <span className="text-xs text-muted-foreground">Current CCU</span>
              </div>
              <div className="text-2xl font-bold text-foreground">
                {currentCCU !== null ? formatNumber(currentCCU) : "—"}
              </div>
              <SourceLabel source={hasRobloxStats ? "roblox_api" : "not_available"} unavailableReason="roblox" />
            </div>
            <div className="p-4 rounded-lg bg-secondary/30 border border-border/50">
              <div className="flex items-center gap-2 mb-2">
                <Eye className="w-4 h-4 text-blue-500" />
                <span className="text-xs text-muted-foreground">Total Visits</span>
              </div>
              <div className="text-2xl font-bold text-foreground">
                {totalVisits !== null ? formatNumber(totalVisits) : "—"}
              </div>
              <SourceLabel source={hasRobloxStats ? "roblox_api" : "not_available"} unavailableReason="roblox" />
            </div>
            <div className="p-4 rounded-lg bg-secondary/30 border border-border/50">
              <div className="flex items-center gap-2 mb-2">
                <Heart className="w-4 h-4 text-pink-500" />
                <span className="text-xs text-muted-foreground">Favorites</span>
              </div>
              <div className="text-2xl font-bold text-foreground">
                {favorites !== null ? formatNumber(favorites) : "—"}
              </div>
              <SourceLabel source={hasRobloxStats ? "roblox_api" : "not_available"} unavailableReason="roblox" />
            </div>
            <div className="p-4 rounded-lg bg-secondary/30 border border-border/50">
              <div className="flex items-center gap-2 mb-2">
                <ThumbsUp className="w-4 h-4 text-green-500" />
                <span className="text-xs text-muted-foreground">Likes</span>
              </div>
              <div className="text-2xl font-bold text-foreground">
                {likes !== null ? formatNumber(likes) : "—"}
              </div>
              <SourceLabel source={hasRobloxStats ? "roblox_api" : "not_available"} unavailableReason="roblox" />
            </div>
            <div className="p-4 rounded-lg bg-secondary/30 border border-border/50">
              <div className="flex items-center gap-2 mb-2">
                <ThumbsDown className="w-4 h-4 text-red-500" />
                <span className="text-xs text-muted-foreground">Dislikes</span>
              </div>
              <div className="text-2xl font-bold text-foreground">
                {dislikes !== null ? formatNumber(dislikes) : "—"}
              </div>
              <SourceLabel source={hasRobloxStats ? "roblox_api" : "not_available"} unavailableReason="roblox" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Current CCU Section */}
      <Card className="border-border bg-card">
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-500" />
                Current CCU
                <UITooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="w-3.5 h-3.5 text-muted-foreground/50 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-[220px]">
                    Concurrent users currently playing your game
                  </TooltipContent>
                </UITooltip>
              </CardTitle>
              <CardDescription>Track player engagement over time</CardDescription>
            </div>
            <div className="flex gap-1">
              {ccuPeriods.map((period) => (
                <Button
                  key={period.value}
                  variant={ccuPeriod === period.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => setCcuPeriod(period.value)}
                  className="text-xs"
                >
                  {period.label}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* CCU Stats Row */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="p-4 rounded-lg bg-secondary/30 border border-border/50">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-4 h-4 text-blue-500" />
                <span className="text-xs text-muted-foreground">Current CCU</span>
              </div>
              <div className="text-3xl font-bold text-foreground">
                {currentCCU !== null ? formatNumber(currentCCU) : "—"}
              </div>
              <SourceLabel source={hasRobloxStats ? "roblox_api" : "not_available"} unavailableReason="roblox" />
            </div>
            <div className="p-4 rounded-lg bg-secondary/30 border border-border/50">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-green-500" />
                <span className="text-xs text-muted-foreground">Peak CCU</span>
              </div>
              <div className="text-3xl font-bold text-foreground">
                {peakCCU !== null ? formatNumber(peakCCU) : "—"}
              </div>
              <SourceLabel source={hasTrackerData ? "romonetize_tracker" : "not_available"} unavailableReason="tracker" />
            </div>
            <div className="p-4 rounded-lg bg-secondary/30 border border-border/50">
              <div className="flex items-center gap-2 mb-2">
                <BarChart3 className="w-4 h-4 text-amber-500" />
                <span className="text-xs text-muted-foreground">Average CCU</span>
              </div>
              <div className="text-3xl font-bold text-foreground">
                {avgCCU !== null ? formatNumber(avgCCU) : "—"}
              </div>
              <SourceLabel source={hasTrackerData ? "romonetize_tracker" : "not_available"} unavailableReason="tracker" />
            </div>
          </div>

          {/* CCU Chart */}
          {ccuChartData.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={ccuChartData}>
                  <defs>
                    <linearGradient id="colorCCU" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" opacity={0.5} />
                  <XAxis
                    dataKey="time"
                    tick={{ fill: "#a1a1aa", fontSize: 11 }}
                    axisLine={{ stroke: "#52525b" }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: "#a1a1aa", fontSize: 11 }}
                    axisLine={{ stroke: "#52525b" }}
                    tickLine={false}
                    tickFormatter={(value) => formatNumber(value)}
                    domain={[0, (dataMax: number) => Math.max(dataMax, 1) * 1.2]}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#18181b",
                      border: "1px solid #3f3f46",
                      borderRadius: "8px",
                      color: "#fafafa",
                    }}
                    labelStyle={{ color: "#a1a1aa" }}
                    formatter={(value: number) => [formatNumber(value), "CCU"]}
                  />
                  <Area
                    type="monotone"
                    dataKey="ccu"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    fill="url(#colorCCU)"
                    dot={{ fill: "#3b82f6", strokeWidth: 0, r: 3 }}
                    activeDot={{ fill: "#3b82f6", strokeWidth: 2, stroke: "#fff", r: 5 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center bg-secondary/20 rounded-lg border border-dashed border-border">
              <div className="text-center">
                <Activity className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">Available after more tracking data</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Retention Section */}
      <Card className="border-border bg-card">
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <UserCheck className="w-5 h-5 text-violet-500" />
                Retention
                <UITooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="w-3.5 h-3.5 text-muted-foreground/50 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-[220px]">
                    Percentage of new players who return to play again
                  </TooltipContent>
                </UITooltip>
              </CardTitle>
              <CardDescription>Track player return rates</CardDescription>
            </div>
            <div className="flex gap-1">
              {retentionTabs.map((tab) => (
                <Button
                  key={tab.value}
                  variant={retentionTab === tab.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => setRetentionTab(tab.value)}
                  className="text-xs"
                >
                  {tab.label}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Retention Stats Row */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="p-4 rounded-lg bg-secondary/30 border border-border/50">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-4 h-4 text-violet-500" />
                <span className="text-xs text-muted-foreground">{retentionData.label}</span>
              </div>
              <div className="text-3xl font-bold text-foreground">
                {formatPercent(retentionData.rate ?? null)}
              </div>
              <SourceLabel source={retentionData.rate !== null && retentionData.rate !== undefined ? "romonetize_tracker" : "not_available"} unavailableReason="tracker" />
            </div>
            <div className="p-4 rounded-lg bg-secondary/30 border border-border/50">
              <div className="flex items-center gap-2 mb-2">
                <UserCheck className="w-4 h-4 text-cyan-500" />
                <span className="text-xs text-muted-foreground">Returning Players</span>
              </div>
              <div className="text-3xl font-bold text-foreground">
                {formatNumber(stats?.returningPlayers)}
              </div>
              <SourceLabel source={stats?.trackerSource || "not_available"} unavailableReason="tracker" />
            </div>
            <div className="p-4 rounded-lg bg-secondary/30 border border-border/50">
              <div className="flex items-center gap-2 mb-2">
                <UserPlus className="w-4 h-4 text-green-500" />
                <span className="text-xs text-muted-foreground">New Players</span>
              </div>
              <div className="text-3xl font-bold text-foreground">
                {formatNumber(stats?.newPlayers)}
              </div>
              <SourceLabel source={stats?.trackerSource || "not_available"} unavailableReason="tracker" />
            </div>
          </div>

          {/* Retention Trend Chart */}
          {retentionChartData.length > 0 && hasTrackerData ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={retentionChartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" opacity={0.5} />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: "#a1a1aa", fontSize: 11 }}
                    axisLine={{ stroke: "#52525b" }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: "#a1a1aa", fontSize: 11 }}
                    axisLine={{ stroke: "#52525b" }}
                    tickLine={false}
                    tickFormatter={(value) => `${value}%`}
                    domain={[0, 100]}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#18181b",
                      border: "1px solid #3f3f46",
                      borderRadius: "8px",
                      color: "#fafafa",
                    }}
                    labelStyle={{ color: "#a1a1aa" }}
                    formatter={(value: number, name: string) => {
                      if (name === "rate") return [`${value}%`, "Retention Rate"];
                      return [formatNumber(value), name === "newPlayers" ? "New Players" : "Returning"];
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="rate"
                    stroke="#8b5cf6"
                    strokeWidth={2}
                    dot={{ fill: "#8b5cf6", strokeWidth: 0, r: 3 }}
                    activeDot={{ fill: "#8b5cf6", strokeWidth: 2, stroke: "#fff", r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center bg-secondary/20 rounded-lg border border-dashed border-border">
              <div className="text-center">
                <Activity className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">Available after more tracking data</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Revenue Metrics Section */}
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-primary" />
            Revenue Metrics
          </CardTitle>
          <CardDescription>Track your monetization performance</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <div className="p-4 rounded-lg bg-secondary/30 border border-border/50">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="w-4 h-4 text-primary" />
                <span className="text-xs text-muted-foreground">Revenue</span>
              </div>
              <div className="text-2xl font-bold text-foreground">
                {stats?.revenue ? <RobuxValue value={formatNumber(stats.revenue)} iconSize="xs" /> : "—"}
              </div>
              <SourceLabel source={stats?.trackerSource || "not_available"} unavailableReason="tracker" />
            </div>
            <div className="p-4 rounded-lg bg-secondary/30 border border-border/50">
              <div className="flex items-center gap-2 mb-2">
                <ShoppingCart className="w-4 h-4 text-pink-500" />
                <span className="text-xs text-muted-foreground">Purchases</span>
              </div>
              <div className="text-2xl font-bold text-foreground">
                {formatNumber(stats?.purchases)}
              </div>
              <SourceLabel source={stats?.trackerSource || "not_available"} unavailableReason="tracker" />
            </div>
            <div className="p-4 rounded-lg bg-secondary/30 border border-border/50">
              <div className="flex items-center gap-2 mb-2">
                <Store className="w-4 h-4 text-orange-500" />
                <span className="text-xs text-muted-foreground">Shop Opens</span>
              </div>
              <div className="text-2xl font-bold text-foreground">
                {formatNumber(stats?.shopOpens)}
              </div>
              <SourceLabel source={stats?.trackerSource || "not_available"} unavailableReason="tracker" />
            </div>
            <div className="p-4 rounded-lg bg-secondary/30 border border-border/50">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-emerald-500" />
                <span className="text-xs text-muted-foreground">ARPDAU</span>
                <UITooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="w-3 h-3 text-muted-foreground/50 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    Average Revenue Per Daily Active User
                  </TooltipContent>
                </UITooltip>
              </div>
              <div className="text-2xl font-bold text-foreground">
                {stats?.arpdau ? `R$${stats.arpdau}` : "—"}
              </div>
              <SourceLabel source={stats?.arpdau !== null && stats?.arpdau !== undefined ? "romonetize_tracker" : "not_available"} unavailableReason="tracker" />
            </div>
            <div className="p-4 rounded-lg bg-secondary/30 border border-border/50">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-cyan-500" />
                <span className="text-xs text-muted-foreground">ARPPU</span>
                <UITooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="w-3 h-3 text-muted-foreground/50 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    Average Revenue Per Paying User
                  </TooltipContent>
                </UITooltip>
              </div>
              <div className="text-2xl font-bold text-foreground">
                {stats?.arppu ? `R$${stats.arppu}` : "—"}
              </div>
              <SourceLabel source={stats?.arppu !== null && stats?.arppu !== undefined ? "romonetize_tracker" : "not_available"} unavailableReason="tracker" />
            </div>
          </div>

          {/* Revenue Chart */}
          {!hasTrackerData ? (
            <div className="h-64 flex items-center justify-center bg-secondary/20 rounded-lg border border-dashed border-border">
              <div className="text-center">
                <Calendar className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground mb-2">Not enough tracking data yet</p>
                <Button asChild size="sm" variant="outline">
                  <Link href="/dashboard/game">
                    <Gamepad2 className="w-4 h-4 mr-2" />
                    View Installation Guide
                  </Link>
                </Button>
              </div>
            </div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={timeSeries}>
                  <defs>
                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" opacity={0.5} />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: "#a1a1aa", fontSize: 11 }}
                    axisLine={{ stroke: "#52525b" }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: "#a1a1aa", fontSize: 11 }}
                    axisLine={{ stroke: "#52525b" }}
                    tickLine={false}
                    tickFormatter={(value) => formatNumber(value)}
                    domain={[0, (dataMax: number) => Math.max(dataMax, 1) * 1.2]}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#18181b",
                      border: "1px solid #3f3f46",
                      borderRadius: "8px",
                      color: "#fafafa",
                    }}
                    labelStyle={{ color: "#a1a1aa" }}
                    formatter={(value: number) => [formatNumber(value) + " R$", "Revenue"]}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    fill="url(#colorRevenue)"
                    dot={{ fill: "#f59e0b", strokeWidth: 0, r: 3 }}
                    activeDot={{ fill: "#f59e0b", strokeWidth: 2, stroke: "#fff", r: 5 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
