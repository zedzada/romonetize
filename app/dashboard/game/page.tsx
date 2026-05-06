"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  Gamepad2,
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  Eye,
  EyeOff,
  Code,
  ChevronDown,
  ChevronUp,
  Link2,
  Loader2,
  CheckCircle,
  AlertCircle,
  Crown,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";

// Roblox game from API (now includes group games)
interface RobloxGame {
  id: number;
  name: string;
  rootPlaceId: number;
  source: "user" | "group";
  groupName?: string;
  groupId?: number;
  roleName?: string;
  roleRank?: number;
}

// Game from database
interface ConnectedGame {
  id: string;
  roblox_game_id: string;
  name: string;
  api_key: string;
  is_selected: boolean;
  source?: string;
  group_id?: string;
  group_name?: string;
  root_place_id?: string;
  role_name?: string;
  role_rank?: number;
}

// Plan limits
const PLAN_LIMITS: Record<string, number> = {
  free: 1,
  pro: 5,
  studio: 25,
};

export default function GamePage() {
  const router = useRouter();
  
  // User plan
  const [userPlan, setUserPlan] = useState<string>("free");
  
  // Connected games from database
  const [connectedGames, setConnectedGames] = useState<ConnectedGame[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Roblox games from API
  const [robloxGames, setRobloxGames] = useState<RobloxGame[]>([]);
  const [loadingRobloxGames, setLoadingRobloxGames] = useState(false);
  const [robloxError, setRobloxError] = useState<string | null>(null);
  const [groupWarning, setGroupWarning] = useState<string | null>(null);
  const [hasRobloxAccount, setHasRobloxAccount] = useState<boolean | null>(null);
  
  // Selection/connection state
  const [selectingGameId, setSelectingGameId] = useState<number | null>(null);
  const [connectingGameId, setConnectingGameId] = useState<number | null>(null);
  const [limitError, setLimitError] = useState<string | null>(null);
  
  // UI state
  const [copied, setCopied] = useState<string | null>(null);
  const [showTrackingModal, setShowTrackingModal] = useState(false);
  const [showFullScript, setShowFullScript] = useState(false);
  
  // Debug state - shows click feedback and API response
  const [debugMessage, setDebugMessage] = useState<string | null>(null);
  const [debugApiResponse, setDebugApiResponse] = useState<string | null>(null);

  // Get selected game
  const selectedGame = connectedGames.find(g => g.is_selected) || null;
  const planLimit = PLAN_LIMITS[userPlan] || 1;
  const gamesUsed = connectedGames.length;
  const isAtLimit = gamesUsed >= planLimit;

  // Fetch connected games and user plan
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setLoading(false);
        return;
      }
      
      // Get user plan and Roblox account status
      const { data: profile } = await supabase
        .from("profiles")
        .select("plan, roblox_user_id")
        .eq("id", user.id)
        .single();
      
      setUserPlan(profile?.plan || "free");
      setHasRobloxAccount(!!profile?.roblox_user_id);
      
      // Fetch connected games with group metadata
      const { data: games } = await supabase
        .from("games")
        .select("id, roblox_game_id, name, api_key, is_selected, source, group_id, group_name, root_place_id, role_name, role_rank")
        .eq("user_id", user.id)
        .neq("status", "deleted")
        .order("created_at", { ascending: false });
      
      if (games) {
        setConnectedGames(games);
      }
      
      setLoading(false);
    }
    fetchData();
  }, []);

  // Fetch Roblox games when we know user has Roblox account
  const fetchRobloxGames = useCallback(async () => {
    if (hasRobloxAccount === false) return;
    
    setLoadingRobloxGames(true);
    setRobloxError(null);
    setGroupWarning(null);
    
    try {
      const response = await fetch("/api/roblox/games");
      const data = await response.json();
      
      if (!response.ok) {
        if (data.error === "Roblox account not connected") {
          setHasRobloxAccount(false);
        } else {
          setRobloxError(data.error || "Failed to fetch games");
        }
      } else {
        setRobloxGames(data.games || []);
        if (data.warning) {
          setGroupWarning(data.warning);
        }
      }
    } catch {
      setRobloxError("Failed to fetch Roblox games");
    }
    
    setLoadingRobloxGames(false);
  }, [hasRobloxAccount]);

  useEffect(() => {
    if (hasRobloxAccount === true) {
      fetchRobloxGames();
    }
  }, [hasRobloxAccount, fetchRobloxGames]);

  // Check if a Roblox game is connected
  const isGameConnected = (robloxGameId: number) => {
    return connectedGames.some(g => g.roblox_game_id === String(robloxGameId));
  };

  // Get connected game by roblox ID
  const getConnectedGame = (robloxGameId: number) => {
    return connectedGames.find(g => g.roblox_game_id === String(robloxGameId));
  };

  // Select an already connected game
  const handleSelectConnectedGame = async (game: ConnectedGame) => {
    if (game.is_selected) return;
    
    setSelectingGameId(parseInt(game.roblox_game_id));
    setLimitError(null);
    
    try {
      const response = await fetch("/api/roblox/select-game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roblox_game_id: game.roblox_game_id,
          name: game.name,
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        const errorMessage = data.error || data.message || "Failed to select game";
        toast.error(errorMessage);
      } else if (data.game) {
        // Update local state
        setConnectedGames(connectedGames.map(g => ({
          ...g,
          is_selected: g.id === data.game.id,
        })));
        toast.success(`Selected ${game.name}`);
        router.refresh();
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to select game";
      toast.error(errorMessage);
    }
    
    setSelectingGameId(null);
  };

  // Connect a new game from Roblox list
  const handleConnectGame = async (robloxGame: RobloxGame) => {
    // Debug: immediate visual feedback
    setDebugMessage(`Clicked Connect Game: ${robloxGame.name} (ID: ${robloxGame.id})`);
    setDebugApiResponse(null);
    console.log("[v0] Connect game clicked:", robloxGame);
    
    // Set loading state
    setConnectingGameId(robloxGame.id);
    setLimitError(null);
    
    const payload = {
      roblox_game_id: String(robloxGame.id),
      name: robloxGame.name,
      rootPlaceId: robloxGame.rootPlaceId ? String(robloxGame.rootPlaceId) : null,
      source: robloxGame.source,
      groupId: robloxGame.groupId ? String(robloxGame.groupId) : null,
      groupName: robloxGame.groupName ?? null,
      roleName: robloxGame.roleName ?? null,
      roleRank: robloxGame.roleRank ?? null,
    };
    
    console.log("[v0] Request payload:", payload);
    setDebugApiResponse(`Payload: ${JSON.stringify(payload)}`);
    
    try {
      const response = await fetch("/api/roblox/select-game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      
      console.log("[v0] Response status:", response.status);
      
      const data = await response.json();
      
      console.log("[v0] Response JSON:", data);
      setDebugApiResponse(`Status: ${response.status} | Response: ${JSON.stringify(data)}`);
      
      if (response.status === 403) {
        const errorMessage = data.message || "You reached your plan limit. Upgrade to connect more games.";
        setLimitError(errorMessage);
        toast.error(errorMessage);
      } else if (!response.ok) {
        const errorMessage = data.error || data.message || "Failed to connect game";
        toast.error(errorMessage);
      } else if (data.game) {
        // Success - update local state
        if (data.action === "created") {
          // New game created - add to list and deselect others
          setConnectedGames([data.game, ...connectedGames.map(g => ({ ...g, is_selected: false }))]);
        } else if (data.action === "selected") {
          // Existing game selected - update selection
          setConnectedGames(connectedGames.map(g => ({
            ...g,
            is_selected: g.id === data.game.id,
          })));
        }
        setLimitError(null);
        toast.success("Game connected successfully!");
        router.refresh();
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to connect game";
      setDebugApiResponse(`Error: ${errorMessage}`);
      toast.error(errorMessage);
      console.log("[v0] Connect game error:", error);
    }
    
    setConnectingGameId(null);
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  // Tracking script
  const trackingScript = selectedGame ? `-- RoMonetize Analytics Tracker
-- Add this to ServerScriptService

local HttpService = game:GetService("HttpService")
local MarketplaceService = game:GetService("MarketplaceService")
local Players = game:GetService("Players")

-- Configuration
local API_KEY = "${selectedGame.api_key}"
local GAME_ID = "${selectedGame.id}"
local API_URL = "https://romonetize.com/api/events"

-- Track event function
local function trackEvent(eventType, playerId, data)
    local payload = {
        api_key = API_KEY,
        game_id = GAME_ID,
        event_type = eventType,
        player_id = tostring(playerId),
        metadata = data or {}
    }
    
    pcall(function()
        HttpService:PostAsync(API_URL, HttpService:JSONEncode(payload), Enum.HttpContentType.ApplicationJson)
    end)
end

-- Track purchases
MarketplaceService.PromptGamePassPurchaseFinished:Connect(function(player, passId, purchased)
    if purchased then
        trackEvent("purchase_success", player.UserId, {
            product_id = tostring(passId),
            product_type = "gamepass"
        })
    end
end)

MarketplaceService.PromptProductPurchaseFinished:Connect(function(userId, productId, purchased)
    if purchased then
        trackEvent("purchase_success", userId, {
            product_id = tostring(productId),
            product_type = "devproduct"
        })
    end
end)

-- Track player joins
Players.PlayerAdded:Connect(function(player)
    trackEvent("player_join", player.UserId)
end)

print("[RoMonetize] Tracker initialized!")` : "";

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">My Game</h1>
        <p className="text-muted-foreground">Connect and manage your Roblox games</p>
      </div>

      {/* Debug display box - temporary */}
      {(debugMessage || debugApiResponse) && (
        <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg space-y-2">
          <div className="text-sm font-mono">
            <span className="font-bold text-yellow-600">Debug:</span>
            {debugMessage && <p className="text-foreground">{debugMessage}</p>}
            {debugApiResponse && <p className="text-muted-foreground break-all">{debugApiResponse}</p>}
          </div>
          <button 
            type="button"
            onClick={() => { setDebugMessage(null); setDebugApiResponse(null); }}
            className="text-xs text-yellow-600 underline"
          >
            Clear debug
          </button>
        </div>
      )}

      {/* Plan limit error */}
      {limitError && (
        <div className="flex items-center gap-3 p-4 bg-destructive/10 border border-destructive/30 rounded-lg">
          <AlertCircle className="w-5 h-5 text-destructive shrink-0" />
          <div className="flex-1">
            <p className="text-sm text-foreground">{limitError}</p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href="/dashboard/billing">Upgrade Plan</Link>
          </Button>
        </div>
      )}

      {loading ? (
        <Card className="border-border bg-card">
          <CardContent className="py-8">
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              <span className="text-muted-foreground">Loading...</span>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Section 1: Connected Games */}
          <Card className="border-border bg-card">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-green-500" />
                    Connected Games ({gamesUsed} / {planLimit})
                  </CardTitle>
                  <CardDescription>Games connected to your RoMonetize account</CardDescription>
                </div>
                {isAtLimit && userPlan !== "studio" && (
                  <Button asChild size="sm" variant="outline" className="gap-2">
                    <Link href="/dashboard/billing">
                      <Crown className="w-4 h-4" />
                      Upgrade
                    </Link>
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {connectedGames.length === 0 ? (
                <div className="text-center py-8">
                  <Gamepad2 className="w-12 h-12 mx-auto mb-3 text-muted-foreground opacity-50" />
                  <p className="text-foreground font-medium mb-2">No games connected</p>
                  <p className="text-sm text-muted-foreground">
                    Connect a game below to start tracking analytics
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {connectedGames.map((game) => {
                    const isSelected = game.is_selected;
                    const isSelecting = selectingGameId === parseInt(game.roblox_game_id);
                    
                    return (
                      <div
                        key={game.id}
                        className={`p-4 rounded-lg border transition-colors ${
                          isSelected 
                            ? "bg-green-500/5 border-green-500/30" 
                            : "bg-secondary/30 border-border"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                              game.source === "group" 
                                ? "bg-purple-500/20" 
                                : isSelected 
                                  ? "bg-green-500/20" 
                                  : "bg-primary/10"
                            }`}>
                              <Gamepad2 className={`w-5 h-5 ${
                                game.source === "group" 
                                  ? "text-purple-500" 
                                  : isSelected 
                                    ? "text-green-500" 
                                    : "text-primary"
                              }`} />
                            </div>
                            <div className="min-w-0">
                              <div className="font-medium text-foreground truncate">{game.name}</div>
                              <div className="text-xs text-muted-foreground">ID: {game.roblox_game_id}</div>
                              {/* Source badge */}
                              <div className="mt-1">
                                {game.source === "group" ? (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400">
                                    Group: {game.group_name || "Unknown"}
                                    {game.role_name && (
                                      <span className="opacity-70">({game.role_name})</span>
                                    )}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400">
                                    Personal Game
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {isSelected ? (
                              <>
                                <span className="text-xs font-medium text-green-500 bg-green-500/10 px-2 py-1 rounded">
                                  Selected
                                </span>
                                <Dialog open={showTrackingModal} onOpenChange={setShowTrackingModal}>
                                  <DialogTrigger asChild>
                                    <Button variant="outline" size="sm" className="gap-2">
                                      <Code className="w-4 h-4" />
                                      Tracking Setup
                                    </Button>
                                  </DialogTrigger>
                                  <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                                    <DialogHeader>
                                      <DialogTitle>Tracking Setup for {game.name}</DialogTitle>
                                      <DialogDescription>
                                        Add this script to your Roblox game to start tracking analytics
                                      </DialogDescription>
                                    </DialogHeader>
                                    <div className="space-y-4 mt-4">
                                      {/* API Key */}
                                      <div className="space-y-2">
                                        <label className="text-sm font-medium text-foreground">API Key</label>
                                        <div className="flex gap-2">
                                          <code className="flex-1 px-3 py-2 bg-secondary/50 rounded-lg font-mono text-sm break-all">
                                            {game.api_key}
                                          </code>
                                          <Button
                                            variant="outline"
                                            size="icon"
                                            onClick={() => copyToClipboard(game.api_key, "api-key")}
                                          >
                                            {copied === "api-key" ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                                          </Button>
                                        </div>
                                      </div>

                                      {/* Game ID */}
                                      <div className="space-y-2">
                                        <label className="text-sm font-medium text-foreground">Game ID</label>
                                        <div className="flex gap-2">
                                          <code className="flex-1 px-3 py-2 bg-secondary/50 rounded-lg font-mono text-sm">
                                            {game.id}
                                          </code>
                                          <Button
                                            variant="outline"
                                            size="icon"
                                            onClick={() => copyToClipboard(game.id, "game-id")}
                                          >
                                            {copied === "game-id" ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                                          </Button>
                                        </div>
                                      </div>

                                      {/* Quick setup instructions */}
                                      <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
                                        <h4 className="font-medium text-foreground mb-2">Quick Setup</h4>
                                        <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                                          <li>Copy the script below</li>
                                          <li>Create a new Script in <code className="bg-secondary px-1 rounded">ServerScriptService</code></li>
                                          <li>Paste the code (API key and Game ID are already filled in)</li>
                                          <li>Enable HTTP Requests in Game Settings &gt; Security</li>
                                          <li>Test your game - events will appear in the dashboard!</li>
                                        </ol>
                                      </div>

                                      {/* Script */}
                                      <div className="bg-[#1e1e1e] rounded-lg border border-border overflow-hidden">
                                        <div className="flex items-center justify-between px-4 py-2 bg-[#2d2d2d] border-b border-border">
                                          <span className="text-sm font-medium text-gray-300">RoMonetizeTracker.lua</span>
                                          <Button 
                                            variant="ghost" 
                                            size="sm"
                                            className="h-7 text-xs text-gray-300 hover:text-white"
                                            onClick={() => copyToClipboard(trackingScript, "script")}
                                          >
                                            {copied === "script" ? (
                                              <><Check className="w-3 h-3 mr-1 text-green-400" /> Copied!</>
                                            ) : (
                                              <><Copy className="w-3 h-3 mr-1" /> Copy Script</>
                                            )}
                                          </Button>
                                        </div>
                                        <pre className="p-4 font-mono text-xs text-gray-300 overflow-x-auto max-h-64 overflow-y-auto">
                                          <code>{trackingScript}</code>
                                        </pre>
                                      </div>
                                    </div>
                                  </DialogContent>
                                </Dialog>
                              </>
                            ) : (
                              <Button 
                                size="sm" 
                                variant="outline"
                                onClick={() => handleSelectConnectedGame(game)}
                                disabled={isSelecting}
                              >
                                {isSelecting ? (
                                  <>
                                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                                    Selecting...
                                  </>
                                ) : (
                                  "Select"
                                )}
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              asChild
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <a 
                                href={`https://www.roblox.com/games/${game.roblox_game_id}`} 
                                target="_blank" 
                                rel="noopener noreferrer"
                              >
                                <ExternalLink className="w-4 h-4" />
                              </a>
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Section 2: Your Roblox Games */}
          <Card className="border-border bg-card">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Gamepad2 className="w-5 h-5 text-primary" />
                    Your Roblox Games
                  </CardTitle>
                  <CardDescription>Games from your Roblox account - connect them to start tracking</CardDescription>
                </div>
                {hasRobloxAccount && (
                  <Button variant="outline" size="sm" onClick={fetchRobloxGames} disabled={loadingRobloxGames}>
                    <RefreshCw className={`w-4 h-4 mr-2 ${loadingRobloxGames ? "animate-spin" : ""}`} />
                    Refresh
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {hasRobloxAccount === false ? (
                <div className="text-center py-8">
                  <Link2 className="w-12 h-12 mx-auto mb-3 text-muted-foreground opacity-50" />
                  <p className="text-foreground font-medium mb-2">Connect your Roblox account first</p>
                  <p className="text-sm text-muted-foreground mb-4">
                    Link your Roblox account to see your games here
                  </p>
                  <Button asChild>
                    <Link href="/dashboard/settings">Connect Roblox Account</Link>
                  </Button>
                </div>
              ) : loadingRobloxGames ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : robloxError ? (
                <div className="text-center py-8">
                  <p className="text-foreground font-medium mb-2">Failed to load games</p>
                  <p className="text-sm text-muted-foreground mb-4">{robloxError}</p>
                  <Button onClick={fetchRobloxGames}>Try Again</Button>
                </div>
              ) : robloxGames.length === 0 ? (
                <div className="text-center py-8">
                  <Gamepad2 className="w-12 h-12 mx-auto mb-3 text-muted-foreground opacity-50" />
                  <p className="text-foreground font-medium mb-2">No Roblox games found</p>
                  <p className="text-sm text-muted-foreground">
                    You don&apos;t have any public games on Roblox yet
                  </p>
                </div>
              ) : (
                <>
                  {groupWarning && (
                    <div className="flex items-center gap-2 p-3 mb-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-sm text-yellow-600 dark:text-yellow-400">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      {groupWarning}
                    </div>
                  )}
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {robloxGames.map((robloxGame) => {
                      const connected = isGameConnected(robloxGame.id);
                      const connectedGame = getConnectedGame(robloxGame.id);
                      const isConnecting = connectingGameId === robloxGame.id;
                      
                      return (
                        <div
                          key={robloxGame.id}
                          className={`p-4 rounded-lg border transition-colors ${
                            connected 
                              ? "bg-green-500/5 border-green-500/30" 
                              : "bg-secondary/30 border-border hover:border-primary/30"
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <div className={`w-12 h-12 rounded-lg flex items-center justify-center shrink-0 ${
                              robloxGame.source === "group" 
                                ? "bg-gradient-to-br from-purple-500/20 to-pink-400/20" 
                                : "bg-gradient-to-br from-primary/20 to-blue-400/20"
                            }`}>
                              <Gamepad2 className={`w-6 h-6 ${
                                robloxGame.source === "group" ? "text-purple-500" : "text-primary"
                              }`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-foreground truncate">{robloxGame.name}</div>
                              <div className="text-xs text-muted-foreground">ID: {robloxGame.id}</div>
                              {/* Source badge */}
                              <div className="mt-1">
                                {robloxGame.source === "group" ? (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400">
                                    Group: {robloxGame.groupName}
                                    {robloxGame.roleName && (
                                      <span className="opacity-70">({robloxGame.roleName})</span>
                                    )}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400">
                                    Personal Game
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="mt-3">
                            {connected ? (
                              <div className="flex items-center justify-center gap-2 py-1.5 text-sm text-green-500">
                                <Check className="w-4 h-4" />
                                Connected
                              </div>
                            ) : (
                              <button 
                                type="button"
                                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                                onClick={() => {
                                  console.log("[v0] Button onClick fired for:", robloxGame.name);
                                  handleConnectGame(robloxGame);
                                }}
                                disabled={isConnecting || isAtLimit}
                              >
                                {isConnecting ? (
                                  <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Connecting...
                                  </>
                                ) : isAtLimit ? (
                                  <>
                                    <Crown className="w-4 h-4" />
                                    Upgrade to Connect
                                  </>
                                ) : (
                                  <>
                                    <Link2 className="w-4 h-4" />
                                    Connect Game
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
