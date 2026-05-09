"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Copy, Check, CheckCircle2, AlertCircle, RefreshCw, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import useSWR from "swr";

interface GameData {
  id: string;
  name: string;
  api_key: string;
  roblox_game_id: string | null;
  universe_id: string | null;
  last_event_at: string | null;
}

// Production URL for the tracking endpoint
const PRODUCTION_URL = "https://www.romonetize.com/api/events";

function generateLuaScript(apiKey: string, gameId: string | null): string {
  return `-- RoMonetize Tracking Script v1.1
-- Place this script in ServerScriptService

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local MarketplaceService = game:GetService("MarketplaceService")

-- Configuration
local API_KEY = "${apiKey}"
local ENDPOINT = "${PRODUCTION_URL}"
local ROBLOX_GAME_ID = "${gameId || "UNKNOWN"}"

-- Helper function to send events
local function sendEvent(eventData)
	eventData.apiKey = API_KEY
	eventData.robloxGameId = ROBLOX_GAME_ID
	
	local success, err = pcall(function()
		HttpService:PostAsync(
			ENDPOINT,
			HttpService:JSONEncode(eventData),
			Enum.HttpContentType.ApplicationJson
		)
	end)
	
	if not success then
		warn("[RoMonetize] Failed to send event:", err)
	end
end

-- Send script_started event on server startup
task.spawn(function()
	task.wait(2) -- Wait for server to stabilize
	sendEvent({
		eventType = "script_started",
		metadata = {
			serverStartTime = os.time(),
			placeId = game.PlaceId,
			gameId = game.GameId
		}
	})
	print("[RoMonetize] Tracking script started")
end)

-- Track player joins
Players.PlayerAdded:Connect(function(player)
	sendEvent({
		eventType = "player_join",
		playerId = tostring(player.UserId),
		metadata = {
			username = player.Name,
			displayName = player.DisplayName,
			accountAge = player.AccountAge
		}
	})
end)

-- Track player leaves (session end)
Players.PlayerRemoving:Connect(function(player)
	sendEvent({
		eventType = "session_end",
		playerId = tostring(player.UserId),
		metadata = {
			username = player.Name
		}
	})
end)

-- Track gamepass purchases
MarketplaceService.PromptGamePassPurchaseFinished:Connect(function(player, gamePassId, wasPurchased)
	if wasPurchased then
		local info = MarketplaceService:GetProductInfo(gamePassId, Enum.InfoType.GamePass)
		sendEvent({
			eventType = "gamepass_purchase",
			playerId = tostring(player.UserId),
			productId = tostring(gamePassId),
			productName = info and info.Name or "Unknown",
			productType = "gamepass",
			robux = info and info.PriceInRobux or 0,
			metadata = {
				username = player.Name
			}
		})
	end
end)

-- Track developer product purchases
-- You need to also handle ProcessReceipt for dev products
MarketplaceService.PromptProductPurchaseFinished:Connect(function(userId, productId, wasPurchased)
	if wasPurchased then
		local player = Players:GetPlayerByUserId(userId)
		local info = MarketplaceService:GetProductInfo(productId, Enum.InfoType.Product)
		sendEvent({
			eventType = "devproduct_purchase",
			playerId = tostring(userId),
			productId = tostring(productId),
			productName = info and info.Name or "Unknown",
			productType = "devproduct",
			robux = info and info.PriceInRobux or 0,
			metadata = {
				username = player and player.Name or "Unknown"
			}
		})
	end
end)

print("[RoMonetize] Tracking script loaded successfully")
`;
}

// Fetcher for SWR
const fetcher = (url: string) => fetch(url).then(res => res.json());

export default function TrackingSetupPage() {
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const [debugInfo, setDebugInfo] = useState<{
    lastEvent: { event_type: string; created_at: string } | null;
    eventCount: number;
  } | null>(null);

  // Fetch selected game via analytics API (reuses existing endpoint)
  const { data: analyticsData, isLoading: loading, mutate } = useSWR(
    "/api/dashboard/analytics",
    fetcher,
    { revalidateOnFocus: false }
  );

  // Extract game data from analytics response
  const game: GameData | null = analyticsData?.dataHealth ? {
    id: analyticsData.dataHealth.selectedGameId,
    name: analyticsData.dataHealth.gameName || "Unknown Game",
    api_key: analyticsData.dataHealth.apiKey || "",
    roblox_game_id: analyticsData.dataHealth.robloxGameId,
    universe_id: analyticsData.dataHealth.universeId || analyticsData.dataHealth.robloxGameId,
    last_event_at: analyticsData.dataHealth.lastTrackerEventAt,
  } : null;

  const handleCopy = async () => {
    if (!game) return;
    const script = generateLuaScript(game.api_key, game.roblox_game_id);
    await navigator.clipboard.writeText(script);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCheckStatus = useCallback(async () => {
    if (!game) return;
    setChecking(true);
    try {
      const res = await fetch(`/api/events/debug?gameId=${game.id}`);
      const data = await res.json();
      if (data.success) {
        setDebugInfo({
          lastEvent: data.lastEvent,
          eventCount: data.eventCount,
        });
        // Refresh analytics data to get updated last_event_at
        mutate();
      }
    } catch (error) {
      console.error("Failed to check status:", error);
    } finally {
      setChecking(false);
    }
  }, [game, mutate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!game) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" asChild>
          <Link href="/dashboard/performance">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Performance
          </Link>
        </Button>
        <Card>
          <CardContent className="py-12 text-center">
            <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">No Game Selected</h2>
            <p className="text-muted-foreground mb-4">
              Please select a game first to set up tracking.
            </p>
            <Button asChild>
              <Link href="/dashboard/game">Go to My Game</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const hasTracking = !!game.last_event_at || (debugInfo && debugInfo.eventCount > 0);
  const luaScript = generateLuaScript(game.api_key, game.roblox_game_id);

  return (
    <div className="space-y-6">
      {/* Back button */}
      <Button variant="ghost" asChild>
        <Link href="/dashboard/performance">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Performance
        </Link>
      </Button>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Tracking Setup</h1>
        <p className="text-muted-foreground">
          Install the RoMonetize tracking script to capture sessions, purchases, and revenue.
        </p>
      </div>

      {/* Game Info Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Selected Game</CardTitle>
          <CardDescription>Your tracking script will be configured for this game</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Game Name</p>
              <p className="font-medium text-foreground">{game.name}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Universe ID</p>
              <p className="font-mono text-sm text-foreground">{game.universe_id || game.roblox_game_id || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">API Key</p>
              <p className="font-mono text-sm text-foreground">{game.api_key.slice(0, 8)}...{game.api_key.slice(-4)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Tracking Status</p>
              {hasTracking ? (
                <Badge variant="default" className="bg-green-500/10 text-green-600 border-green-500/20">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Active
                </Badge>
              ) : (
                <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 border-amber-500/20">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  Waiting for first event
                </Badge>
              )}
            </div>
          </div>

          {/* Check Status Button */}
          <div className="flex items-center gap-4 pt-2">
            <Button variant="outline" size="sm" onClick={handleCheckStatus} disabled={checking}>
              <RefreshCw className={`w-4 h-4 mr-2 ${checking ? "animate-spin" : ""}`} />
              {checking ? "Checking..." : "Check Status"}
            </Button>
            {debugInfo && (
              <div className="text-sm text-muted-foreground">
                {debugInfo.eventCount > 0 ? (
                  <span className="text-green-600">
                    {debugInfo.eventCount} event(s) received. Last: {debugInfo.lastEvent?.event_type} at{" "}
                    {new Date(debugInfo.lastEvent?.created_at || "").toLocaleString()}
                  </span>
                ) : (
                  <span>No events received yet</span>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Installation Steps */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Installation Steps</CardTitle>
          <CardDescription>Follow these steps to install the tracking script in your Roblox game</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <ol className="space-y-4">
            <li className="flex gap-4">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-sm font-medium flex items-center justify-center">1</span>
              <div>
                <p className="font-medium text-foreground">Open Roblox Studio</p>
                <p className="text-sm text-muted-foreground">Launch Roblox Studio and open your game project</p>
              </div>
            </li>
            <li className="flex gap-4">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-sm font-medium flex items-center justify-center">2</span>
              <div>
                <p className="font-medium text-foreground">Go to ServerScriptService</p>
                <p className="text-sm text-muted-foreground">In the Explorer panel, find and expand ServerScriptService</p>
              </div>
            </li>
            <li className="flex gap-4">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-sm font-medium flex items-center justify-center">3</span>
              <div>
                <p className="font-medium text-foreground">Create a new Script</p>
                <p className="text-sm text-muted-foreground">Right-click ServerScriptService → Insert Object → Script. Name it <code className="px-1 py-0.5 rounded bg-muted">RoMonetizeTracker</code></p>
              </div>
            </li>
            <li className="flex gap-4">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-sm font-medium flex items-center justify-center">4</span>
              <div>
                <p className="font-medium text-foreground">Paste the script below</p>
                <p className="text-sm text-muted-foreground">Copy the entire Lua script and paste it into the new Script</p>
              </div>
            </li>
            <li className="flex gap-4">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-sm font-medium flex items-center justify-center">5</span>
              <div>
                <p className="font-medium text-foreground">Enable HTTP Requests</p>
                <p className="text-sm text-muted-foreground">
                  In Roblox Studio: Game Settings → Security → Allow HTTP Requests → Enable
                </p>
              </div>
            </li>
            <li className="flex gap-4">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-sm font-medium flex items-center justify-center">6</span>
              <div>
                <p className="font-medium text-foreground">Publish the game</p>
                <p className="text-sm text-muted-foreground">File → Publish to Roblox. The script only works in published games, not in Studio test mode.</p>
              </div>
            </li>
            <li className="flex gap-4">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-sm font-medium flex items-center justify-center">7</span>
              <div>
                <p className="font-medium text-foreground">Join the live published game</p>
                <p className="text-sm text-muted-foreground">Open Roblox and join your published game (not Studio)</p>
              </div>
            </li>
            <li className="flex gap-4">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-sm font-medium flex items-center justify-center">8</span>
              <div>
                <p className="font-medium text-foreground">Wait 30-60 seconds, then check status</p>
                <p className="text-sm text-muted-foreground">Click "Check Status" above or "Refresh Data" in the Performance page to verify events are being received</p>
              </div>
            </li>
          </ol>
        </CardContent>
      </Card>

      {/* Lua Script */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Tracking Script</CardTitle>
              <CardDescription>Copy this script into ServerScriptService</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={handleCopy}>
              {copied ? (
                <>
                  <Check className="w-4 h-4 mr-2 text-green-500" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 mr-2" />
                  Copy Script
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="bg-zinc-950 rounded-lg p-4 overflow-x-auto">
            <pre className="text-sm text-zinc-300 font-mono whitespace-pre">{luaScript}</pre>
          </div>
        </CardContent>
      </Card>

      {/* Important Notes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Important Notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-3">
            <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">HTTP Requests must be enabled</strong> in Game Settings → Security for the script to work.
            </p>
          </div>
          <div className="flex gap-3">
            <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">The script only works in published games</strong>, not in Roblox Studio test mode.
            </p>
          </div>
          <div className="flex gap-3">
            <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">Events tracked:</strong> script_started, player_join, session_end, gamepass_purchase, devproduct_purchase
            </p>
          </div>
          <div className="flex gap-3">
            <ExternalLink className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">Production endpoint:</strong>{" "}
              <code className="px-1.5 py-0.5 rounded bg-muted text-foreground">{PRODUCTION_URL}</code>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
