"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DollarSign,
  Eye,
  MousePointerClick,
  ShoppingCart,
  Percent,
  Copy,
  Gamepad2,
  Sparkles,
  Send,
  ArrowRight,
  AlertTriangle,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  FlaskConical,
  CheckCircle,
  XCircle,
  Bell,
  Clock,
  HelpCircle,
  Radio,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getDashboardStats, getAnalyticsAlerts, getUserGameIds, type DashboardStats, type AnalyticsAlert } from "@/lib/actions/analytics";
import { useRealtimeStats } from "@/hooks/use-realtime-stats";
import { createGame, getFirstGameApiKey } from "@/lib/actions/games";
import { RobuxValue } from "@/components/ui/robux-icon";
import { useToast } from "@/hooks/use-toast";
import { triggerStatsRefresh, useStatsRefresh } from "@/hooks/use-stats-refresh";

export default function DashboardPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [gameId, setGameId] = useState("");
  const [gameName, setGameName] = useState("");
  
  const [aiMessage, setAiMessage] = useState("");
  const [aiResponse, setAiResponse] = useState(
    "Connect a game and start tracking events to get AI-powered monetization insights."
  );
  const [isConnecting, setIsConnecting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [alerts, setAlerts] = useState<AnalyticsAlert[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sendingTestEvent, setSendingTestEvent] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [gameIds, setGameIds] = useState<string[]>([]);

  // Fetch dashboard stats and alerts (fresh from Supabase)
  const fetchStats = useCallback(async (showLoadingState = true) => {
    if (showLoadingState) setIsRefreshing(true);
    
    // Fetch stats, alerts, and game IDs in parallel
    const [statsResult, alertsResult, gameIdsResult] = await Promise.all([
      getDashboardStats(),
      getAnalyticsAlerts(),
      getUserGameIds(),
    ]);
    
    if (statsResult.error) {
      setError(statsResult.error);
    } else {
      setStats(statsResult.stats);
      setLastRefresh(new Date());
      // Update AI response based on data
      if (statsResult.stats && statsResult.stats.totalEvents > 0) {
        setAiResponse(
          `I'm analyzing your ${statsResult.stats.totalEvents.toLocaleString()} tracked player actions across ${statsResult.stats.totalGames} game${statsResult.stats.totalGames !== 1 ? "s" : ""}. Your total revenue is ${statsResult.stats.totalRevenue.toLocaleString()} Robux with ${statsResult.stats.totalProducts} tracked products. Ask me anything about your monetization performance!`
        );
      }
    }
    
    // Set alerts
    if (!alertsResult.error) {
      setAlerts(alertsResult.alerts);
    }
    
    // Set game IDs for realtime subscription
    if (!gameIdsResult.error) {
      setGameIds(gameIdsResult.gameIds);
    }
    
    if (showLoadingState) setIsRefreshing(false);
    setLoading(false);
  }, []);

  // Setup Supabase Realtime subscription
  const { status: realtimeStatus, isLive } = useRealtimeStats({
    gameIds,
    onNewEvent: () => fetchStats(false),
    enabled: gameIds.length > 0,
  });

  // Initial fetch
  useEffect(() => {
    setLoading(true);
    fetchStats(false);
  }, [fetchStats]);

  // Listen for global stats refresh
  useStatsRefresh(fetchStats);

  // Fallback polling only when realtime is not connected (every 15 seconds)
  // The realtime hook handles polling internally when connection fails
  useEffect(() => {
    // Only poll if we have no realtime connection and no games (realtime hook won't activate)
    if (gameIds.length === 0 && !loading) {
      const interval = setInterval(() => {
        fetchStats(false);
      }, 15000);
      return () => clearInterval(interval);
    }
  }, [fetchStats, gameIds.length, loading]);

  // Manual refresh handler
  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchStats(false);
    setIsRefreshing(false);
  };

  

  const handleConnectGame = async () => {
    if (!gameId.trim() || !gameName.trim()) return;
    setIsConnecting(true);
    setError(null);
    
    const { game, error: createError } = await createGame(gameId.trim(), gameName.trim());
    
    if (createError) {
      setError(createError);
    } else if (game) {
      // Refresh stats
      const { stats: newStats } = await getDashboardStats();
      setStats(newStats);
      setGameId("");
      setGameName("");
    }
    setIsConnecting(false);
  };

  const handleAskAI = () => {
    if (!aiMessage.trim()) return;
    // In a real app, this would call your AI endpoint
    if (stats && stats.totalEvents > 0) {
      setAiResponse(
        `Based on your question "${aiMessage}", I analyzed your game data. With ${stats.totalRevenue.toLocaleString()} Robux in revenue and ${stats.totalPurchases || 0} purchases, your performance is solid. Focus on increasing conversion rates for better results.`
      );
    } else {
      setAiResponse(
        `I can help answer "${aiMessage}" once you have some tracking data. Connect a game and send events to get personalized insights.`
      );
    }
    setAiMessage("");
  };

  const handleSendTestEvent = async () => {
    setSendingTestEvent(true);
    setError(null);

    try {
      // Fetch API key fresh from database via server action
      const result = await getFirstGameApiKey();
      const { apiKey, error: keyError } = result;
      
      if (keyError || !apiKey) {
        toast({
          variant: "destructive",
          title: "No active game found",
          description: keyError || "Connect a real game first to send test events.",
        });
        setSendingTestEvent(false);
        return;
      }

      // Send test event to API with x-api-key header
      const response = await fetch("/api/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey.trim(),
        },
        body: JSON.stringify({
          event_type: "purchase_success",
          product_name: "VIP Pass",
          product_id: "vip_pass_199",
          product_type: "gamepass",
          robux: 199,
          player_id: "test_player_" + Date.now(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        toast({
          variant: "destructive",
          title: "Test event failed",
          description: data.error || "Failed to send test event",
        });
        setSendingTestEvent(false);
        return;
      }

      // Success - refresh stats
      toast({
        title: "Test event received",
        description: "Purchase event saved successfully. Refreshing stats...",
      });

      // Trigger global stats refresh for all dashboard pages
      triggerStatsRefresh();

      // Refresh dashboard stats
      await fetchStats(false);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Error",
        description: err instanceof Error ? err.message : "Unknown error occurred",
      });
    }

    setSendingTestEvent(false);
  };

  const formatEventType = (type: string) => {
    return type.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
  };

  const formatTimeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Empty state - no game connected
  if (!stats || stats.totalGames === 0) {
    return (
      <div className="space-y-8">
        {/* Premium empty state hero */}
        <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-card to-blue-500/5 p-8 md:p-12">
          <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-blue-500/10 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />
          
          <div className="relative z-10 flex flex-col items-center text-center max-w-xl mx-auto">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary to-blue-500 flex items-center justify-center mb-6 shadow-lg shadow-primary/20">
              <Gamepad2 className="w-10 h-10 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-foreground mb-3">Start tracking your revenue</h1>
            <p className="text-muted-foreground mb-6 text-lg">
              Connect your Roblox game in 2 minutes and start seeing real-time monetization insights.
            </p>
            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-500" />
                <span>Free to start</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-500" />
                <span>No credit card</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-500" />
                <span>5 min setup</span>
              </div>
            </div>
          </div>
        </div>

        {/* Setup cards */}
        <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          {/* Connect game card */}
          <Card className="border-primary/30 bg-gradient-to-br from-card to-primary/5 shadow-lg shadow-primary/5 relative overflow-hidden">
            <div className="absolute top-3 right-3">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-primary bg-primary/10 px-2 py-1 rounded-full">
                Step 1
              </span>
            </div>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Gamepad2 className="w-4 h-4 text-primary" />
                </div>
                Connect your game
              </CardTitle>
              <CardDescription>Enter your Roblox Game ID to start tracking</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {error && (
                <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-lg border border-destructive/20">
                  {error}
                </div>
              )}
              <Input
                placeholder="Roblox Game ID (e.g., 123456789)"
                value={gameId}
                onChange={(e) => setGameId(e.target.value)}
                className="bg-background/50 border-border/50 h-11"
              />
              <Input
                placeholder="Game Name"
                value={gameName}
                onChange={(e) => setGameName(e.target.value)}
                className="bg-background/50 border-border/50 h-11"
              />
              <Button 
                className="w-full gap-2 h-11 text-base shadow-lg shadow-primary/20" 
                onClick={handleConnectGame}
                disabled={isConnecting || !gameId.trim() || !gameName.trim()}
              >
                {isConnecting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  "Connect Game"
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Installation card */}
          <Card className="border-border/50 bg-card shadow-lg relative overflow-hidden">
            <div className="absolute top-3 right-3">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-secondary px-2 py-1 rounded-full">
                Step 2
              </span>
            </div>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center">
                  <Copy className="w-4 h-4 text-muted-foreground" />
                </div>
                Install RoMonetize Tracker
              </CardTitle>
              <CardDescription>Add the full tracking script to your game</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Setup steps */}
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold">1</div>
                  <span className="text-muted-foreground">Create Script in <code className="text-foreground bg-secondary px-1 rounded">ServerScriptService</code></span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold">2</div>
                  <span className="text-muted-foreground">Paste the full tracker script</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold">3</div>
                  <span className="text-muted-foreground">Enable HTTP Requests in Game Settings</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold">4</div>
                  <span className="text-muted-foreground">Publish your game</span>
                </div>
              </div>
              
              <p className="text-xs text-muted-foreground">
                Connect a game first to get your API key, then copy the full script from the My Game page.
              </p>
              
              <Button variant="outline" className="w-full gap-2 h-11" asChild>
                <Link href="/dashboard/game">
                  <ArrowRight className="w-4 h-4" />
                  Go to My Game
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Dashboard with data
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-foreground">Overview</h1>
            {/* Live indicator */}
            {isLive ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-green-500/10 border border-green-500/20">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-[10px] font-semibold text-green-500 uppercase tracking-wider">Live</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>Connected to realtime updates</p>
                </TooltipContent>
              </Tooltip>
            ) : realtimeStatus === "connecting" ? (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-500/10 border border-amber-500/20">
                <Radio className="w-3 h-3 text-amber-500 animate-pulse" />
                <span className="text-[10px] font-semibold text-amber-500 uppercase tracking-wider">Connecting</span>
              </div>
            ) : null}
          </div>
          <p className="text-muted-foreground">
            Track your Roblox game monetization performance
            <span className="text-xs ml-2 text-muted-foreground/60">
              Last updated: {lastRefresh.toLocaleTimeString()}
            </span>
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
            {isRefreshing ? "Refreshing..." : "Refresh Data"}
          </Button>
          <Button
            variant="outline"
            onClick={handleSendTestEvent}
            disabled={sendingTestEvent}
            className="gap-2 border-dashed border-primary/50 hover:border-primary hover:bg-primary/5"
          >
            {sendingTestEvent ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <FlaskConical className="w-4 h-4" />
                Send Test Event
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Stats cards - Premium hierarchy */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card className="border-border/50 bg-gradient-to-br from-card to-primary/5 shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Gamepad2 className="w-5 h-5 text-primary" />
              </div>
            </div>
            <div className="text-3xl font-bold text-foreground tracking-tight">{stats.totalGames}</div>
            <div className="text-xs text-muted-foreground mt-1">Connected Games</div>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-gradient-to-br from-card to-blue-500/5 shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-blue-500" />
              </div>
              {stats.totalEvents > 100 && (
                <span className="text-[10px] font-semibold text-blue-500 bg-blue-500/10 px-2 py-0.5 rounded-full">
                  Active
                </span>
              )}
            </div>
            <div className="text-3xl font-bold text-foreground tracking-tight">{stats.totalEvents.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              Tracked Actions
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="w-3 h-3 text-muted-foreground/50 cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[200px]">
                  Player actions like joins, purchases, clicks, shop opens, and rewards
                </TooltipContent>
              </Tooltip>
            </div>
          </CardContent>
        </Card>

        <Card className="border-green-500/20 bg-gradient-to-br from-card to-green-500/5 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
          <div className="absolute top-0 right-0 w-20 h-20 bg-green-500/10 rounded-full blur-2xl" />
          <CardContent className="pt-5 pb-4 relative">
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-green-500" />
              </div>
              {stats.totalRevenue > 0 && (
                <span className="text-[10px] font-semibold text-green-500 bg-green-500/10 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" />
                  Revenue
                </span>
              )}
            </div>
            <div className="text-3xl font-bold text-foreground tracking-tight">
              <RobuxValue value={stats.totalRevenue.toLocaleString()} iconSize="sm" />
            </div>
            <div className="text-xs text-muted-foreground mt-1">Total Revenue</div>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-gradient-to-br from-card to-pink-500/5 shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-xl bg-pink-500/10 flex items-center justify-center">
                <ShoppingCart className="w-5 h-5 text-pink-500" />
              </div>
              {stats.totalPurchases > 10 && (
                <span className="text-[10px] font-semibold text-pink-500 bg-pink-500/10 px-2 py-0.5 rounded-full">
                  {stats.totalPurchases > 100 ? "Hot" : "Growing"}
                </span>
              )}
            </div>
            <div className="text-3xl font-bold text-foreground tracking-tight">{stats.totalPurchases.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground mt-1">Total Purchases</div>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-gradient-to-br from-card to-amber-500/5 shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
                <Eye className="w-5 h-5 text-amber-500" />
              </div>
            </div>
            <div className="text-3xl font-bold text-foreground tracking-tight">{stats.totalProducts}</div>
            <div className="text-xs text-muted-foreground mt-1">Tracked Products</div>
          </CardContent>
        </Card>
      </div>

      {/* Alerts Card - Premium styling */}
      {alerts.length > 0 && (
        <Card className="border-amber-500/30 bg-gradient-to-br from-card to-amber-500/5 shadow-lg shadow-amber-500/5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 rounded-full blur-3xl" />
          <CardHeader className="pb-3 relative">
            <CardTitle className="text-base flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-amber-500/10 flex items-center justify-center">
                <Bell className="w-4 h-4 text-amber-500" />
              </div>
              <span>Alerts</span>
              <span className="ml-auto text-[10px] font-semibold text-amber-500 bg-amber-500/10 px-2.5 py-1 rounded-full animate-pulse">
                {alerts.length} active
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 relative">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className={`flex items-start gap-3 p-4 rounded-xl transition-colors ${
                  alert.severity === "critical"
                    ? "bg-red-500/10 border border-red-500/20 hover:bg-red-500/15"
                    : alert.severity === "warning"
                    ? "bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/15"
                    : "bg-blue-500/10 border border-blue-500/20 hover:bg-blue-500/15"
                }`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                  alert.severity === "critical" ? "bg-red-500/10" : 
                  alert.severity === "warning" ? "bg-amber-500/10" : "bg-blue-500/10"
                }`}>
                  <div className={`${
                    alert.severity === "critical" ? "text-red-500" : 
                    alert.severity === "warning" ? "text-amber-500" : "text-blue-500"
                  }`}>
                    {alert.type === "revenue_drop" && <TrendingDown className="w-4 h-4" />}
                    {alert.type === "purchases_drop" && <ShoppingCart className="w-4 h-4" />}
                    {alert.type === "no_events" && <Clock className="w-4 h-4" />}
                    {alert.type === "conversion_drop" && <Percent className="w-4 h-4" />}
                    {alert.type === "info" && <Bell className="w-4 h-4" />}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-semibold ${
                    alert.severity === "critical" ? "text-red-500" : 
                    alert.severity === "warning" ? "text-amber-500" : "text-blue-500"
                  }`}>
                    {alert.title}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {alert.message}
                  </div>
                </div>
                <div className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                  alert.severity === "critical" ? "text-red-500 bg-red-500/10" : 
                  alert.severity === "warning" ? "text-amber-500 bg-amber-500/10" : "text-blue-500 bg-blue-500/10"
                }`}>
                  {alert.severity === "critical" ? "Critical" : alert.severity === "warning" ? "Warning" : "Info"}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Setup cards row */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Connect game card */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Gamepad2 className="w-4 h-4 text-primary" />
              Connect another game
            </CardTitle>
            <CardDescription>Add more Roblox games to track</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {error && (
              <div className="text-sm text-destructive bg-destructive/10 p-2 rounded">
                {error}
              </div>
            )}
            <Input
              placeholder="Roblox Game ID (e.g., 123456789)"
              value={gameId}
              onChange={(e) => setGameId(e.target.value)}
              className="bg-secondary/30"
            />
            <Input
              placeholder="Game Name"
              value={gameName}
              onChange={(e) => setGameName(e.target.value)}
              className="bg-secondary/30"
            />
            <Button 
              className="w-full gap-2" 
              onClick={handleConnectGame}
              disabled={isConnecting || !gameId.trim() || !gameName.trim()}
            >
              {isConnecting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                "Connect Game"
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Installation card */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Copy className="w-4 h-4 text-primary" />
              Install RoMonetize Tracker
            </CardTitle>
            <CardDescription>Get the full tracking script from the My Game page</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Setup steps */}
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold">1</div>
                <span className="text-muted-foreground">Create Script in <code className="text-foreground bg-secondary px-1 rounded">ServerScriptService</code></span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold">2</div>
                <span className="text-muted-foreground">Paste the full tracker script</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold">3</div>
                <span className="text-muted-foreground">Enable HTTP Requests in Game Settings</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold">4</div>
                <span className="text-muted-foreground">Publish your game</span>
              </div>
            </div>
            
            <Button variant="outline" className="w-full gap-2" asChild>
              <Link href="/dashboard/game">
                <ArrowRight className="w-4 h-4" />
                Copy Full Script
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Recent Player Actions & Top Products */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Recent Player Actions */}
        <Card className="border-border/50 bg-card shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold flex items-center gap-1.5">
                  Recent Activity
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="w-3.5 h-3.5 text-muted-foreground/50 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-[220px]">
                      Tracked player actions: joins, purchases, clicks, shop opens, rewards, and more
                    </TooltipContent>
                  </Tooltip>
                </CardTitle>
                <CardDescription>Latest player actions from your games</CardDescription>
              </div>
              {stats.recentEvents.length > 0 && (
                <span className="text-[10px] font-medium text-primary bg-primary/10 px-2 py-1 rounded-full">
                  Live
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {stats.recentEvents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-16 h-16 rounded-2xl bg-secondary/50 flex items-center justify-center mb-4">
                  <MousePointerClick className="w-7 h-7 text-muted-foreground/50" />
                </div>
                <p className="text-sm font-medium text-foreground mb-1">No activity yet</p>
                <p className="text-xs text-muted-foreground max-w-[200px]">
                  Player actions will appear here once your game starts sending tracking data
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-2 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-primary/20 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent">
                {stats.recentEvents.map((event, index) => (
                  <div 
                    key={event.id} 
                    className={`flex items-center justify-between p-3 rounded-xl transition-colors ${
                      index === 0 ? "bg-primary/5 border border-primary/10" : "bg-secondary/30 hover:bg-secondary/50"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${
                        event.robux > 0 ? "bg-green-500" : "bg-blue-500"
                      }`} />
                      <div>
                        <div className="text-sm font-medium text-foreground">
                          {formatEventType(event.event_type)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {event.game_name} • {formatTimeAgo(event.created_at)}
                        </div>
                      </div>
                    </div>
                    {event.robux > 0 && (
                      <div className="text-sm font-semibold text-green-500 bg-green-500/10 px-2 py-1 rounded-lg">
                        <RobuxValue value={`+${event.robux}`} iconSize="xs" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top Products */}
        <Card className="border-border/50 bg-card shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold">Top Products</CardTitle>
                <CardDescription>Best performing monetization products</CardDescription>
              </div>
              {stats.topProducts.length > 0 && (
                <Link href="/dashboard/products">
                  <Button variant="ghost" size="sm" className="text-xs h-7 gap-1">
                    View all <ArrowRight className="w-3 h-3" />
                  </Button>
                </Link>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {stats.topProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-16 h-16 rounded-2xl bg-secondary/50 flex items-center justify-center mb-4">
                  <ShoppingCart className="w-7 h-7 text-muted-foreground/50" />
                </div>
                <p className="text-sm font-medium text-foreground mb-1">No products tracked</p>
                <p className="text-xs text-muted-foreground max-w-[200px]">
                  Products appear automatically after purchase events are received
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-2 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-primary/20 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent">
                {stats.topProducts.map((product, index) => (
                  <div 
                    key={product.id} 
                    className={`flex items-center justify-between p-3 rounded-xl transition-colors ${
                      index === 0 ? "bg-amber-500/5 border border-amber-500/10" : "bg-secondary/30 hover:bg-secondary/50"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {index === 0 && (
                        <div className="w-6 h-6 rounded-lg bg-amber-500/10 flex items-center justify-center">
                          <span className="text-amber-500 text-xs font-bold">#1</span>
                        </div>
                      )}
                      <div>
                        <div className="text-sm font-medium text-foreground flex items-center gap-2">
                          {product.name}
                          {index === 0 && (
                            <span className="text-[9px] font-semibold text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded">
                              BEST
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          <span className={`${product.product_type === "gamepass" ? "text-primary" : "text-teal-500"}`}>
                            {product.product_type}
                          </span>
                          {" • "}{product.total_purchases} sales
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-foreground">
                        <RobuxValue value={product.total_revenue.toLocaleString()} iconSize="xs" />
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {product.total_clicks > 0 ? `${((product.total_purchases / product.total_clicks) * 100).toFixed(0)}% conv` : "—"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* AI Assistant - Premium styling */}
      <Card className="border-primary/20 bg-gradient-to-br from-card via-card to-primary/5 shadow-lg shadow-primary/5 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-40 h-40 bg-primary/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl" />
        
        <CardHeader className="pb-3 relative">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary to-blue-500 flex items-center justify-center shadow-lg shadow-primary/20">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <span>AI Assistant</span>
              <span className="text-[10px] font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                Beta
              </span>
            </CardTitle>
            <Link href="/dashboard/ai">
              <Button variant="ghost" size="sm" className="text-xs h-7 gap-1">
                Open full view <ArrowRight className="w-3 h-3" />
              </Button>
            </Link>
          </div>
          <CardDescription>Get AI-powered insights about your monetization data</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 relative">
          {/* Example questions */}
          <div className="flex flex-wrap gap-2">
            {[
              "What are my trends?",
              "Which product needs work?",
              "How to increase revenue?",
            ].map((question) => (
              <Button
                key={question}
                variant="outline"
                size="sm"
                className="text-xs bg-background/50 hover:bg-primary/10 hover:border-primary/30 hover:text-primary transition-colors"
                onClick={() => setAiMessage(question)}
              >
                {question}
              </Button>
            ))}
          </div>

          {/* AI Response */}
          <div className="p-4 rounded-xl bg-gradient-to-br from-background/80 to-primary/5 border border-primary/10 backdrop-blur-sm">
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-blue-500 flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
                <Sparkles className="w-3.5 h-3.5 text-white" />
              </div>
              <p className="text-sm text-foreground leading-relaxed">{aiResponse}</p>
            </div>
          </div>

          {/* Input */}
          <div className="flex gap-2">
            <Input
              placeholder="Ask about your monetization..."
              value={aiMessage}
              onChange={(e) => setAiMessage(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAskAI()}
              className="bg-background/50 border-border/50 h-11"
            />
            <Button onClick={handleAskAI} className="gap-2 h-11 px-6 shadow-lg shadow-primary/20">
              <Send className="w-4 h-4" />
              Ask
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-3">
        <Button className="gap-2 h-11 px-5 shadow-lg shadow-primary/20" onClick={() => router.push("/dashboard/game")}>
          <Gamepad2 className="w-4 h-4" />
          Manage Games
        </Button>
        <Button variant="outline" className="gap-2 h-11 px-5 hover:bg-primary/5 hover:border-primary/30" onClick={() => router.push("/dashboard/monetization")}>
          <TrendingUp className="w-4 h-4" />
          View Analytics
        </Button>
        <Button variant="outline" className="gap-2 h-11 px-5 hover:bg-primary/5 hover:border-primary/30" onClick={() => router.push("/dashboard/products")}>
          <Eye className="w-4 h-4" />
          View Products
        </Button>
        <Button variant="outline" className="gap-2 h-11 px-5 hover:bg-primary/5 hover:border-primary/30" onClick={() => router.push("/dashboard/billing")}>
          <DollarSign className="w-4 h-4" />
          Billing
        </Button>
      </div>
    </div>
  );
}
