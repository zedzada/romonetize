"use client";

import { useState, useEffect, useCallback } from "react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

// Roblox game from API
interface RobloxGame {
  id: number;
  name: string;
  rootPlaceId: number;
}

// Game from database
interface ConnectedGame {
  id: string;
  roblox_game_id: string;
  name: string;
  api_key: string;
  is_selected: boolean;
}

export default function GamePage() {
  // Connected/Selected game state
  const [selectedGame, setSelectedGame] = useState<ConnectedGame | null>(null);
  const [connectedGames, setConnectedGames] = useState<ConnectedGame[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Roblox games state
  const [robloxGames, setRobloxGames] = useState<RobloxGame[]>([]);
  const [loadingRobloxGames, setLoadingRobloxGames] = useState(false);
  const [robloxError, setRobloxError] = useState<string | null>(null);
  const [hasRobloxAccount, setHasRobloxAccount] = useState<boolean | null>(null);
  
  // Selection state
  const [selectingGameId, setSelectingGameId] = useState<number | null>(null);
  
  // UI state
  const [copied, setCopied] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showFullScript, setShowFullScript] = useState(false);

  // Fetch connected games and selected game
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setLoading(false);
        return;
      }
      
      // Check if user has Roblox account
      const { data: profile } = await supabase
        .from("profiles")
        .select("roblox_user_id")
        .eq("id", user.id)
        .single();
      
      setHasRobloxAccount(!!profile?.roblox_user_id);
      
      // Fetch connected games
      const { data: games } = await supabase
        .from("games")
        .select("id, roblox_game_id, name, api_key, is_selected")
        .eq("user_id", user.id)
        .neq("status", "deleted")
        .order("created_at", { ascending: false });
      
      if (games) {
        setConnectedGames(games);
        const selected = games.find(g => g.is_selected);
        setSelectedGame(selected || null);
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

  // Check if a Roblox game is the selected one
  const isGameSelected = (robloxGameId: number) => {
    return selectedGame?.roblox_game_id === String(robloxGameId);
  };

  // Select a game
  const handleSelectGame = async (robloxGame: RobloxGame) => {
    setSelectingGameId(robloxGame.id);
    
    try {
      const response = await fetch("/api/roblox/select-game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roblox_game_id: String(robloxGame.id),
          name: robloxGame.name,
        }),
      });
      
      const data = await response.json();
      
      if (response.ok && data.game) {
        // Update local state
        setSelectedGame(data.game);
        
        // Update connected games list
        if (data.action === "created") {
          setConnectedGames([data.game, ...connectedGames.map(g => ({ ...g, is_selected: false }))]);
        } else {
          setConnectedGames(connectedGames.map(g => ({
            ...g,
            is_selected: g.roblox_game_id === String(robloxGame.id),
          })));
        }
      }
    } catch {
      // Error handled silently
    }
    
    setSelectingGameId(null);
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  // Tracking script
  const trackingScript = `-- RoMonetize Analytics Tracker
-- Add this to ServerScriptService

local HttpService = game:GetService("HttpService")
local MarketplaceService = game:GetService("MarketplaceService")
local Players = game:GetService("Players")

-- Configuration
local API_KEY = "${selectedGame?.api_key || "YOUR_API_KEY"}"
local GAME_ID = "${selectedGame?.id || "YOUR_GAME_ID"}"
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

print("[RoMonetize] Tracker initialized!")`;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">My Game</h1>
        <p className="text-muted-foreground">Select and manage your Roblox game</p>
      </div>

      {/* Selected Game Card */}
      {loading ? (
        <Card className="border-border bg-card">
          <CardContent className="py-8">
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              <span className="text-muted-foreground">Loading...</span>
            </div>
          </CardContent>
        </Card>
      ) : selectedGame ? (
        <Card className="border-green-500/30 bg-green-500/5">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-500" />
              Selected Game: {selectedGame.name}
            </CardTitle>
            <CardDescription>
              This game is currently active for tracking analytics
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* API Key */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">API Key</label>
              <div className="flex gap-2">
                <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-secondary/50 rounded-lg font-mono text-sm">
                  {showApiKey ? selectedGame.api_key : "rm_" + "•".repeat(40)}
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setShowApiKey(!showApiKey)}
                >
                  {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copyToClipboard(selectedGame.api_key, "api-key")}
                >
                  {copied === "api-key" ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            </div>

            {/* Game ID */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Game ID</label>
              <div className="flex gap-2">
                <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-secondary/50 rounded-lg font-mono text-sm">
                  {selectedGame.id}
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copyToClipboard(selectedGame.id, "game-id")}
                >
                  {copied === "game-id" ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            </div>

            {/* View on Roblox */}
            <Button variant="outline" asChild className="gap-2">
              <a 
                href={`https://www.roblox.com/games/${selectedGame.roblox_game_id}`} 
                target="_blank" 
                rel="noopener noreferrer"
              >
                <ExternalLink className="w-4 h-4" />
                View on Roblox
              </a>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="py-8">
            <div className="text-center">
              <Gamepad2 className="w-12 h-12 mx-auto mb-3 text-amber-500 opacity-70" />
              <h3 className="font-medium text-foreground mb-1">No game selected</h3>
              <p className="text-sm text-muted-foreground">
                Select a game below to start tracking analytics
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Your Roblox Games */}
      <Card className="border-border bg-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Gamepad2 className="w-5 h-5 text-primary" />
                Your Roblox Games
              </CardTitle>
              <CardDescription>Select a game to track with RoMonetize</CardDescription>
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
                <a href="/dashboard/settings">Connect Roblox Account</a>
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
              <p className="text-foreground font-medium mb-2">No games found</p>
              <p className="text-sm text-muted-foreground">
                You don&apos;t have any public games on Roblox yet
              </p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {robloxGames.map((robloxGame) => {
                const selected = isGameSelected(robloxGame.id);
                const isSelecting = selectingGameId === robloxGame.id;
                
                return (
                  <div
                    key={robloxGame.id}
                    className={`p-4 rounded-lg border transition-colors ${
                      selected 
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
                      {selected ? (
                        <Button variant="outline" size="sm" className="w-full gap-2" disabled>
                          <Check className="w-4 h-4 text-green-500" />
                          Selected
                        </Button>
                      ) : (
                        <Button 
                          size="sm" 
                          className="w-full gap-2"
                          onClick={() => handleSelectGame(robloxGame)}
                          disabled={isSelecting}
                        >
                          {isSelecting ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Selecting...
                            </>
                          ) : (
                            <>
                              <Gamepad2 className="w-4 h-4" />
                              Select Game
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

      {/* Installation script - only show when game is selected */}
      {selectedGame && (
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
                <li>Copy the script below</li>
                <li>Create a new Script in <code className="bg-secondary px-1 rounded">ServerScriptService</code></li>
                <li>Paste the code (API key and Game ID are already filled in)</li>
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
                  <Button 
                    variant="ghost" 
                    size="sm"
                    className="h-7 text-xs text-gray-300 hover:text-white"
                    onClick={() => copyToClipboard(trackingScript, "script")}
                  >
                    {copied === "script" ? (
                      <><Check className="w-3 h-3 mr-1 text-green-400" /> Copied!</>
                    ) : (
                      <><Copy className="w-3 h-3 mr-1" /> Copy</>
                    )}
                  </Button>
                </div>
              </div>
              <pre className={`p-4 font-mono text-xs text-gray-300 overflow-x-auto ${showFullScript ? "max-h-96" : "max-h-32"} overflow-y-auto`}>
                <code>{trackingScript}</code>
              </pre>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
