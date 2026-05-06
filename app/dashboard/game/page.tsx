"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import {
  Gamepad2,
  Copy,
  Check,
  Trash2,
  ExternalLink,
  RefreshCw,
  Eye,
  EyeOff,
  AlertCircle,
  Pause,
  Play,
  Download,
  Code,
  ChevronDown,
  ChevronUp,
  Cloud,
  Users,
  Heart,
  ThumbsUp,
  ThumbsDown,
  Key,
  Save,
  Link2,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  getUserGames, 
  deleteGame, 
  updateGame,
  regenerateApiKey,
  updateRobloxApiKey,
  type Game 
} from "@/lib/actions/games";
import { syncRobloxData } from "@/lib/actions/roblox-sync";
import { getPlanLimits } from "@/lib/products";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { createClient } from "@/lib/supabase/client";

// Roblox game from API
interface RobloxGame {
  id: number;
  name: string;
  rootPlaceId: number;
}

export default function GamePage() {
  // Connected games state
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Roblox games state
  const [robloxGames, setRobloxGames] = useState<RobloxGame[]>([]);
  const [loadingRobloxGames, setLoadingRobloxGames] = useState(false);
  const [robloxError, setRobloxError] = useState<string | null>(null);
  const [hasRobloxAccount, setHasRobloxAccount] = useState<boolean | null>(null);
  
  // Connect game state
  const [connectingGameId, setConnectingGameId] = useState<number | null>(null);
  
  // Plan limits
  const [planLimit, setPlanLimit] = useState(1);
  
  // UI state
  const [copied, setCopied] = useState<string | null>(null);
  const [visibleApiKeys, setVisibleApiKeys] = useState<Set<string>>(new Set());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [gameToDelete, setGameToDelete] = useState<Game | null>(null);
  const [regeneratingKey, setRegeneratingKey] = useState<string | null>(null);
  const [showFullScript, setShowFullScript] = useState(false);
  const [syncingGame, setSyncingGame] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [robloxApiKeyInputs, setRobloxApiKeyInputs] = useState<Record<string, string>>({});
  const [savingRobloxKey, setSavingRobloxKey] = useState<string | null>(null);
  const [visibleRobloxKeys, setVisibleRobloxKeys] = useState<Set<string>>(new Set());
  const [robloxKeyStatus, setRobloxKeyStatus] = useState<Record<string, { 
    status: "saving" | "testing" | "connected" | "error" | "cleared"; 
    message?: string 
  }>>({});

  // Fetch connected games and user plan
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      
      // Fetch connected games
      const { games: fetchedGames, error: fetchError } = await getUserGames();
      if (fetchError) {
        setError(fetchError);
      } else {
        setGames(fetchedGames);
      }
      
      // Fetch user plan to get limits
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("plan, roblox_user_id")
          .eq("id", user.id)
          .single();
        
        if (profile) {
          const limits = getPlanLimits(profile.plan || "free");
          setPlanLimit(limits.games);
          setHasRobloxAccount(!!profile.roblox_user_id);
        }
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
      }
    } catch (err) {
      setRobloxError("Failed to fetch Roblox games");
    }
    
    setLoadingRobloxGames(false);
  }, [hasRobloxAccount]);

  useEffect(() => {
    if (hasRobloxAccount === true) {
      fetchRobloxGames();
    }
  }, [hasRobloxAccount, fetchRobloxGames]);

  // Check if a Roblox game is already connected
  const isGameConnected = (robloxGameId: number) => {
    return games.some(g => g.roblox_game_id === String(robloxGameId));
  };

  // Connect a Roblox game
  const handleConnectGame = async (robloxGame: RobloxGame) => {
    if (games.length >= planLimit) {
      setError(`Plan limit reached. Upgrade to connect more games.`);
      return;
    }
    
    setConnectingGameId(robloxGame.id);
    setError(null);
    
    try {
      const response = await fetch("/api/roblox/connect-game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roblox_game_id: String(robloxGame.id),
          name: robloxGame.name,
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        setError(data.error || "Failed to connect game");
      } else if (data.game) {
        setGames([data.game, ...games]);
      }
    } catch (err) {
      setError("Failed to connect game");
    }
    
    setConnectingGameId(null);
  };

  const handleDeleteGame = async () => {
    if (!gameToDelete) return;
    
    const { error: deleteError } = await deleteGame(gameToDelete.id);
    
    if (deleteError) {
      setError(deleteError);
    } else {
      setGames(games.filter(g => g.id !== gameToDelete.id));
    }
    
    setDeleteDialogOpen(false);
    setGameToDelete(null);
  };

  const handleToggleStatus = async (game: Game) => {
    const newStatus = game.status === "active" ? "paused" : "active";
    const { error: updateError } = await updateGame(game.id, { status: newStatus });
    
    if (updateError) {
      setError(updateError);
    } else {
      setGames(games.map(g => g.id === game.id ? { ...g, status: newStatus } : g));
    }
  };

  const handleRegenerateKey = async (game: Game) => {
    setRegeneratingKey(game.id);
    const { apiKey, error: regenError } = await regenerateApiKey(game.id);
    
    if (regenError) {
      setError(regenError);
    } else if (apiKey) {
      setGames(games.map(g => g.id === game.id ? { ...g, api_key: apiKey } : g));
      setVisibleApiKeys(new Set([...visibleApiKeys, game.id]));
    }
    setRegeneratingKey(null);
  };

  const handleSyncRoblox = async (game: Game) => {
    setSyncingGame(game.id);
    setSyncError(null);
    
    const result = await syncRobloxData(game.id);
    
    if (!result.success) {
      setSyncError(result.error || "Failed to sync");
    } else if (result.data) {
      setGames(games.map(g => g.id === game.id ? { 
        ...g, 
        universe_id: result.data!.universeId,
        current_players: result.data!.currentPlayers,
        total_visits: result.data!.totalVisits,
        favorites: result.data!.favorites,
        likes: result.data!.likes,
        dislikes: result.data!.dislikes,
        thumbnail_url: result.data!.thumbnailUrl,
        last_roblox_sync: new Date().toISOString(),
        roblox_sync_status: "synced",
      } : g));
    }
    setSyncingGame(null);
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const toggleApiKeyVisibility = (gameId: string) => {
    const newVisible = new Set(visibleApiKeys);
    if (newVisible.has(gameId)) {
      newVisible.delete(gameId);
    } else {
      newVisible.add(gameId);
    }
    setVisibleApiKeys(newVisible);
  };

  const toggleRobloxKeyVisibility = (gameId: string) => {
    const newVisible = new Set(visibleRobloxKeys);
    if (newVisible.has(gameId)) {
      newVisible.delete(gameId);
    } else {
      newVisible.add(gameId);
    }
    setVisibleRobloxKeys(newVisible);
  };

  const handleSaveRobloxApiKey = async (game: Game) => {
    setSavingRobloxKey(game.id);
    setRobloxKeyStatus(prev => ({ ...prev, [game.id]: { status: "saving" } }));
    const keyValue = robloxApiKeyInputs[game.id] ?? game.roblox_api_key ?? "";
    
    const { success, error: saveError } = await updateRobloxApiKey(
      game.id, 
      keyValue.trim() || null
    );
    
    if (saveError) {
      setError(saveError);
      setRobloxKeyStatus(prev => ({ ...prev, [game.id]: { status: "error", message: saveError } }));
      setSavingRobloxKey(null);
      return;
    }
    
    setGames(games.map(g => g.id === game.id ? { 
      ...g, 
      roblox_api_key: keyValue.trim() || null 
    } : g));

    if (!keyValue.trim()) {
      setRobloxKeyStatus(prev => ({ ...prev, [game.id]: { status: "cleared" } }));
      setSavingRobloxKey(null);
      return;
    }

    setRobloxKeyStatus(prev => ({ ...prev, [game.id]: { status: "testing" } }));
    
    try {
      const response = await fetch(`/api/roblox-stats?gameId=${game.id}&testKey=true`);
      const data = await response.json();
      
      if (data.success) {
        setRobloxKeyStatus(prev => ({ ...prev, [game.id]: { status: "connected" } }));
        if (data.data) {
          setGames(games.map(g => g.id === game.id ? { 
            ...g, 
            roblox_api_key: keyValue.trim(),
            current_players: data.data.currentPlayers,
            total_visits: data.data.totalVisits,
            favorites: data.data.favorites,
            likes: data.data.likes,
            dislikes: data.data.dislikes,
            thumbnail_url: data.data.thumbnailUrl,
            last_roblox_sync: data.data.lastFetched,
            roblox_sync_status: "synced",
          } : g));
        }
      } else {
        setRobloxKeyStatus(prev => ({ 
          ...prev, 
          [game.id]: { status: "error", message: data.error || "Connection failed" } 
        }));
      }
    } catch (err) {
      setRobloxKeyStatus(prev => ({ 
        ...prev, 
        [game.id]: { status: "error", message: "Failed to test connection" } 
      }));
    }
    
    setSavingRobloxKey(null);
  };

  const formatLastEvent = (lastEventAt: string | null) => {
    if (!lastEventAt) return "No events yet";
    
    const diff = Date.now() - new Date(lastEventAt).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes} min ago`;
    if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
    return `${days} day${days > 1 ? "s" : ""} ago`;
  };

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">My Game</h1>
        <p className="text-muted-foreground">Manage your connected Roblox games</p>
      </div>

      {/* Connected Games count */}
      <Card className="border-border bg-card">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Gamepad2 className="w-5 h-5 text-primary" />
              </div>
              <div>
                <div className="font-medium text-foreground">Connected Games</div>
                <div className="text-sm text-muted-foreground">
                  {loading ? "Loading..." : `${games.length} / ${planLimit}`}
                </div>
              </div>
            </div>
            {games.length >= planLimit && (
              <Button variant="outline" size="sm" asChild>
                <a href="/dashboard/billing">Upgrade Plan</a>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Error display */}
      {error && (
        <div className="flex items-center gap-2 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive">
          <AlertCircle className="w-5 h-5" />
          <span>{error}</span>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => setError(null)}
            className="ml-auto"
          >
            Dismiss
          </Button>
        </div>
      )}

      {/* Your Roblox Games */}
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Gamepad2 className="w-5 h-5 text-primary" />
            Your Roblox Games
          </CardTitle>
          <CardDescription>Select a game to connect to RoMonetize</CardDescription>
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
                <a href="/dashboard/settings">Connect Roblox Account</a>
              </Button>
            </div>
          ) : loadingRobloxGames ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : robloxError ? (
            <div className="text-center py-8">
              <AlertCircle className="w-12 h-12 mx-auto mb-3 text-destructive opacity-50" />
              <p className="text-foreground font-medium mb-2">Failed to load games</p>
              <p className="text-sm text-muted-foreground mb-4">{robloxError}</p>
              <Button onClick={fetchRobloxGames}>Try Again</Button>
            </div>
          ) : robloxGames.length === 0 ? (
            <div className="text-center py-8">
              <Gamepad2 className="w-12 h-12 mx-auto mb-3 text-muted-foreground opacity-50" />
              <p className="text-foreground font-medium mb-2">No games found</p>
              <p className="text-sm text-muted-foreground">
                You don&apos;t have any public games on Roblox yet
              </p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {robloxGames.map((robloxGame) => {
                const connected = isGameConnected(robloxGame.id);
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
                      <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-primary/20 to-blue-400/20 flex items-center justify-center shrink-0">
                        <Gamepad2 className="w-6 h-6 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-foreground truncate">{robloxGame.name}</div>
                        <div className="text-xs text-muted-foreground">ID: {robloxGame.id}</div>
                      </div>
                    </div>
                    <div className="mt-3">
                      {connected ? (
                        <Button variant="outline" size="sm" className="w-full gap-2" disabled>
                          <Check className="w-4 h-4 text-green-500" />
                          Connected
                        </Button>
                      ) : (
                        <Button 
                          size="sm" 
                          className="w-full gap-2"
                          onClick={() => handleConnectGame(robloxGame)}
                          disabled={isConnecting || games.length >= planLimit}
                        >
                          {isConnecting ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Connecting...
                            </>
                          ) : (
                            <>
                              <Link2 className="w-4 h-4" />
                              Connect Game
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Installation script */}
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Code className="w-5 h-5 text-primary" />
            Roblox Tracking Script
          </CardTitle>
          <CardDescription>
            Add this script to ServerScriptService in your Roblox game to start tracking
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Quick setup instructions */}
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
            <h4 className="font-medium text-foreground mb-2">Quick Setup</h4>
            <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
              <li>Download the script below or copy the full code</li>
              <li>Create a new Script in <code className="bg-secondary px-1 rounded">ServerScriptService</code></li>
              <li>Paste the code and update <code className="bg-secondary px-1 rounded">API_KEY</code> and <code className="bg-secondary px-1 rounded">GAME_ID</code></li>
              <li>Enable HTTP Requests in Game Settings &gt; Security</li>
              <li>Test your game - events will appear in the dashboard!</li>
            </ol>
          </div>

          {/* Script preview */}
          <div className="bg-[#1e1e1e] rounded-lg border border-border overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 bg-[#2d2d2d] border-b border-border">
              <span className="text-sm font-medium text-gray-300">RoMonetizeTracker.lua</span>
              <div className="flex gap-2">
                <Button 
                  variant="ghost" 
                  size="sm"
                  className="h-7 text-xs text-gray-300 hover:text-white"
                  onClick={() => setShowFullScript(!showFullScript)}
                >
                  {showFullScript ? (
                    <><ChevronUp className="w-3 h-3 mr-1" /> Collapse</>
                  ) : (
                    <><ChevronDown className="w-3 h-3 mr-1" /> Expand</>
                  )}
                </Button>
              </div>
            </div>
            <div className={`p-4 font-mono text-sm overflow-x-auto ${showFullScript ? 'max-h-96' : 'max-h-48'} overflow-y-auto`}>
              <pre className="text-gray-300">
                <code>
{`-- ============================================
-- CONFIGURATION - UPDATE THESE VALUES
-- ============================================
local CONFIG = {
    API_KEY = "YOUR_API_KEY_HERE",      -- Get this from RoMonetize dashboard
    GAME_ID = "YOUR_GAME_ID_HERE",      -- Your Roblox Universe ID
    API_URL = "${typeof window !== 'undefined' ? window.location.origin : 'https://romonetize.app'}",
    DEBUG_MODE = false,
}

-- ============================================
-- DO NOT MODIFY BELOW THIS LINE
-- ============================================

local HttpService = game:GetService("HttpService")
local MarketplaceService = game:GetService("MarketplaceService")
local Players = game:GetService("Players")

-- Session tracking
local playerSessions = {}
local RoMonetize = {}

-- Send events to API
local function sendEvent(eventData)
    local payload = {
        apiKey = CONFIG.API_KEY,
        gameId = CONFIG.GAME_ID,
        eventType = eventData.eventType,
        playerId = eventData.playerId,
        productId = eventData.productId,
        productName = eventData.productName,
        productType = eventData.productType,
        robux = eventData.robux or 0,
        metadata = eventData.metadata or {},
    }
    
    pcall(function()
        HttpService:PostAsync(
            CONFIG.API_URL .. "/api/events",
            HttpService:JSONEncode(payload),
            Enum.HttpContentType.ApplicationJson
        )
    end)
end

-- Track player joins
Players.PlayerAdded:Connect(function(player)
    playerSessions[player.UserId] = os.time()
    sendEvent({
        eventType = "player_join",
        playerId = tostring(player.UserId),
        metadata = { playerName = player.Name }
    })
end)

-- Track player leaves  
Players.PlayerRemoving:Connect(function(player)
    local duration = playerSessions[player.UserId] 
        and (os.time() - playerSessions[player.UserId]) or 0
    sendEvent({
        eventType = "player_leave",
        playerId = tostring(player.UserId),
        metadata = { sessionDuration = duration }
    })
end)

-- Track gamepass purchases
MarketplaceService.PromptGamePassPurchaseFinished:Connect(function(player, passId, purchased)
    if purchased then
        local info = MarketplaceService:GetProductInfo(passId, Enum.InfoType.GamePass)
        sendEvent({
            eventType = "purchase_success",
            playerId = tostring(player.UserId),
            productId = tostring(passId),
            productName = info.Name,
            productType = "gamepass",
            robux = info.PriceInRobux
        })
    end
end)

-- Track dev product purchases
MarketplaceService.PromptProductPurchaseFinished:Connect(function(userId, productId, purchased)
    if purchased then
        local info = MarketplaceService:GetProductInfo(productId, Enum.InfoType.Product)
        sendEvent({
            eventType = "purchase_success",
            playerId = tostring(userId),
            productId = tostring(productId),
            productName = info.Name,
            productType = "devproduct",
            robux = info.PriceInRobux
        })
    end
end)

-- Manual tracking functions
function RoMonetize:TrackShopOpen(player)
    sendEvent({ eventType = "shop_open", playerId = tostring(player.UserId) })
end

function RoMonetize:TrackGamepassClick(player, passId, name, price)
    sendEvent({
        eventType = "gamepass_click",
        playerId = tostring(player.UserId),
        productId = tostring(passId),
        productName = name,
        productType = "gamepass",
        robux = price
    })
end

print("[RoMonetize] Tracker initialized!")
return RoMonetize`}
                </code>
              </pre>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-3">
            <Button 
              variant="default" 
              onClick={() => {
                const link = document.createElement('a');
                link.href = '/scripts/RoMonetizeTracker.lua';
                link.download = 'RoMonetizeTracker.lua';
                link.click();
              }}
              className="gap-2"
            >
              <Download className="w-4 h-4" />
              Download Full Script
            </Button>
            <Button 
              variant="outline" 
              onClick={() => {
                const script = document.querySelector('pre code')?.textContent || '';
                copyToClipboard(script, 'script');
              }} 
              className="gap-2"
            >
              {copied === 'script' ? (
                <>
                  <Check className="w-4 h-4 text-green-500" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  Copy Code
                </>
              )}
            </Button>
            <Button variant="outline" className="gap-2" asChild>
              <a href="https://create.roblox.com/docs/cloud-services/HttpService" target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-4 h-4" />
                Roblox HTTP Docs
              </a>
            </Button>
          </div>

          {/* Tracked events info */}
          <div className="border-t border-border pt-4 mt-4">
            <h4 className="font-medium text-foreground mb-3">Automatically Tracked Events</h4>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {[
                { event: "player_join", desc: "When players join" },
                { event: "player_leave", desc: "When players leave" },
                { event: "purchase_success", desc: "Successful purchases" },
                { event: "shop_open", desc: "Shop UI opened (manual)" },
                { event: "gamepass_click", desc: "Gamepass clicked (manual)" },
                { event: "devproduct_click", desc: "Product clicked (manual)" },
              ].map((item) => (
                <div key={item.event} className="flex items-center gap-2 text-sm">
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  <code className="bg-secondary px-1.5 py-0.5 rounded text-xs">{item.event}</code>
                  <span className="text-muted-foreground">{item.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Connected games list */}
      {games.length > 0 && (
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-lg">Connected Games</CardTitle>
            <CardDescription>
              {`${games.length} game${games.length !== 1 ? "s" : ""} connected`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {games.map((game) => (
                <div
                  key={game.id}
                  className="p-4 rounded-lg bg-secondary/30 border border-border hover:border-primary/30 transition-colors"
                >
                  {/* Game header */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-primary/20 to-blue-400/20 flex items-center justify-center">
                        {game.thumbnail_url ? (
                          <Image 
                            src={game.thumbnail_url} 
                            alt={game.name}
                            width={48}
                            height={48}
                            className="w-full h-full object-cover rounded-lg"
                          />
                        ) : (
                          <Gamepad2 className="w-6 h-6 text-primary" />
                        )}
                      </div>
                      <div>
                        <div className="font-medium text-foreground">{game.name}</div>
                        <div className="text-sm text-muted-foreground">
                          Game ID: {game.roblox_game_id}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right hidden sm:block">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${game.status === "active" ? "bg-green-500" : "bg-yellow-500"}`} />
                          <span className="text-sm text-foreground capitalize">{game.status}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Last event: {formatLastEvent(game.last_event_at)}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8"
                          onClick={() => handleSyncRoblox(game)}
                          disabled={syncingGame === game.id}
                          title="Sync Roblox data"
                        >
                          <Cloud className={`w-4 h-4 ${syncingGame === game.id ? "animate-pulse" : ""}`} />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8"
                          onClick={() => handleToggleStatus(game)}
                          title={game.status === "active" ? "Pause tracking" : "Resume tracking"}
                        >
                          {game.status === "active" ? (
                            <Pause className="w-4 h-4" />
                          ) : (
                            <Play className="w-4 h-4" />
                          )}
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => {
                            setGameToDelete(game);
                            setDeleteDialogOpen(true);
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Roblox Stats (if synced) */}
                  {game.last_roblox_sync && (
                    <div className="mb-4 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Cloud className="w-4 h-4 text-blue-500" />
                          <span className="text-sm font-medium text-foreground">Roblox Stats</span>
                          <span className="text-[10px] text-blue-500 bg-blue-500/10 px-1.5 py-0.5 rounded">
                            Roblox API
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          Last sync: {new Date(game.last_roblox_sync).toLocaleString()}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                        <div className="text-center p-2 rounded bg-background/50">
                          <Users className="w-4 h-4 mx-auto mb-1 text-green-500" />
                          <div className="text-lg font-bold text-foreground">
                            {(game.current_players ?? 0).toLocaleString()}
                          </div>
                          <div className="text-[10px] text-muted-foreground">Playing</div>
                        </div>
                        <div className="text-center p-2 rounded bg-background/50">
                          <Eye className="w-4 h-4 mx-auto mb-1 text-blue-500" />
                          <div className="text-lg font-bold text-foreground">
                            {(game.total_visits ?? 0).toLocaleString()}
                          </div>
                          <div className="text-[10px] text-muted-foreground">Visits</div>
                        </div>
                        <div className="text-center p-2 rounded bg-background/50">
                          <Heart className="w-4 h-4 mx-auto mb-1 text-pink-500" />
                          <div className="text-lg font-bold text-foreground">
                            {(game.favorites ?? 0).toLocaleString()}
                          </div>
                          <div className="text-[10px] text-muted-foreground">Favorites</div>
                        </div>
                        <div className="text-center p-2 rounded bg-background/50">
                          <ThumbsUp className="w-4 h-4 mx-auto mb-1 text-green-500" />
                          <div className="text-lg font-bold text-foreground">
                            {(game.likes ?? 0).toLocaleString()}
                          </div>
                          <div className="text-[10px] text-muted-foreground">Likes</div>
                        </div>
                        <div className="text-center p-2 rounded bg-background/50">
                          <ThumbsDown className="w-4 h-4 mx-auto mb-1 text-red-500" />
                          <div className="text-lg font-bold text-foreground">
                            {(game.dislikes ?? 0).toLocaleString()}
                          </div>
                          <div className="text-[10px] text-muted-foreground">Dislikes</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Sync error message */}
                  {syncError && syncingGame === null && (
                    <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-500">
                      {syncError}
                    </div>
                  )}

                  {/* Roblox Open Cloud API Key section */}
                  <div className="mb-4 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                    <div className="flex items-center gap-2 mb-2">
                      <Key className="w-4 h-4 text-amber-500" />
                      <span className="text-sm font-medium text-foreground">Roblox Open Cloud API Key</span>
                      <span className="text-[10px] text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded">
                        Optional
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">
                      Add your Roblox Open Cloud API key to enable enhanced analytics. 
                      <a 
                        href="https://create.roblox.com/dashboard/credentials" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-amber-500 hover:underline ml-1"
                      >
                        Get your API key
                      </a>
                    </p>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input
                          type={visibleRobloxKeys.has(game.id) ? "text" : "password"}
                          placeholder="Enter your Roblox Open Cloud API key"
                          value={robloxApiKeyInputs[game.id] ?? game.roblox_api_key ?? ""}
                          onChange={(e) => setRobloxApiKeyInputs({
                            ...robloxApiKeyInputs,
                            [game.id]: e.target.value
                          })}
                          className="pr-10 font-mono text-xs"
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                          onClick={() => toggleRobloxKeyVisibility(game.id)}
                        >
                          {visibleRobloxKeys.has(game.id) ? (
                            <EyeOff className="w-3.5 h-3.5" />
                          ) : (
                            <Eye className="w-3.5 h-3.5" />
                          )}
                        </Button>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSaveRobloxApiKey(game)}
                        disabled={savingRobloxKey === game.id}
                        className="gap-1.5"
                      >
                        {savingRobloxKey === game.id ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Save className="w-3.5 h-3.5" />
                        )}
                        Save
                      </Button>
                    </div>
                    {/* Connection status */}
                    {robloxKeyStatus[game.id]?.status === "saving" && (
                      <p className="text-[10px] text-muted-foreground mt-2 flex items-center gap-1">
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        Saving API key...
                      </p>
                    )}
                    {robloxKeyStatus[game.id]?.status === "testing" && (
                      <p className="text-[10px] text-amber-500 mt-2 flex items-center gap-1">
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        Testing connection to Roblox...
                      </p>
                    )}
                    {robloxKeyStatus[game.id]?.status === "connected" && (
                      <p className="text-[10px] text-green-500 mt-2 flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        Connected - API key validated successfully
                      </p>
                    )}
                    {robloxKeyStatus[game.id]?.status === "error" && (
                      <p className="text-[10px] text-red-500 mt-2 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        {robloxKeyStatus[game.id]?.message || "Connection failed"}
                      </p>
                    )}
                    {!robloxKeyStatus[game.id] && game.roblox_api_key && game.roblox_sync_status === "synced" && (
                      <p className="text-[10px] text-green-500 mt-2 flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        Connected - Last sync: {game.last_roblox_sync ? new Date(game.last_roblox_sync).toLocaleString() : "Unknown"}
                      </p>
                    )}
                    {!robloxKeyStatus[game.id] && game.roblox_api_key && game.roblox_sync_status !== "synced" && (
                      <p className="text-[10px] text-amber-500 mt-2 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        API key saved - click Save to test connection
                      </p>
                    )}
                  </div>

                  {/* API Key section */}
                  <div className="bg-background/50 rounded-lg p-3 border border-border">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-foreground">API Key</span>
                      <div className="flex gap-2">
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-7 text-xs"
                          onClick={() => toggleApiKeyVisibility(game.id)}
                        >
                          {visibleApiKeys.has(game.id) ? (
                            <><EyeOff className="w-3 h-3 mr-1" /> Hide</>
                          ) : (
                            <><Eye className="w-3 h-3 mr-1" /> Show</>
                          )}
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-7 text-xs"
                          onClick={() => copyToClipboard(game.api_key, `key-${game.id}`)}
                        >
                          {copied === `key-${game.id}` ? (
                            <><Check className="w-3 h-3 mr-1 text-green-500" /> Copied</>
                          ) : (
                            <><Copy className="w-3 h-3 mr-1" /> Copy</>
                          )}
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-7 text-xs"
                          onClick={() => handleRegenerateKey(game)}
                          disabled={regeneratingKey === game.id}
                        >
                          <RefreshCw className={`w-3 h-3 mr-1 ${regeneratingKey === game.id ? "animate-spin" : ""}`} />
                          Regenerate
                        </Button>
                      </div>
                    </div>
                    <code className="text-sm font-mono text-muted-foreground">
                      {visibleApiKeys.has(game.id) ? game.api_key : "••••••••••••••••••••••••••••••••"}
                    </code>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Game</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{gameToDelete?.name}&quot;? This will stop all tracking 
              and remove all associated data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDeleteGame}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete Game
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
