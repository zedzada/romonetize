"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Copy, Check, CheckCircle2, AlertCircle, RefreshCw, ExternalLink, Play, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import useSWR from "swr";

interface TrackerDebugData {
  success: boolean;
  selectedGame: {
    id: string;
    name: string;
    roblox_game_id: string | null;
    universe_id: string | null;
    api_key_prefix: string | null;
    last_event_at: string | null;
    status: string;
  } | null;
  eventCountForGame: number;
  lastEvent: {
    event_type: string;
    player_id: string | null;
    created_at: string;
  } | null;
  recentEvents: Array<{
    event_type: string;
    player_id: string | null;
    created_at: string;
  }>;
  trackingActive: boolean;
  reason: string;
}

// Production URL for the tracking endpoint
const PRODUCTION_URL = "https://www.romonetize.com/api/events";

function generateLuaScript(apiKey: string, universeId: string | null): string {
  return `-- RoMonetize Tracking Script v1.2
-- Place this script in ServerScriptService

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local MarketplaceService = game:GetService("MarketplaceService")

-- Configuration (DO NOT SHARE THIS API KEY)
local API_URL = "${PRODUCTION_URL}"
local API_KEY = "${apiKey}"

-- Helper function to send events to RoMonetize
local function sendEvent(eventType, payload)
    local body = {
        api_key = API_KEY,
        event_type = eventType,
        player_id = payload.player_id,
        session_id = payload.session_id,
        metadata = payload.metadata or {}
    }

    local success, result = pcall(function()
        return HttpService:PostAsync(
            API_URL,
            HttpService:JSONEncode(body),
            Enum.HttpContentType.ApplicationJson
        )
    end)

    if success then
        print("[RoMonetize] Event sent:", eventType, result)
    else
        warn("[RoMonetize] Failed to send event:", eventType, result)
    end
end

-- Send script_started event on server startup
sendEvent("script_started", {
    player_id = "server",
    session_id = game.JobId,
    metadata = {
        place_id = game.PlaceId,
        job_id = game.JobId,
        universe_id = "${universeId || "unknown"}"
    }
})

print("[RoMonetize] Tracking script initialized for universe ${universeId || "unknown"}")

-- Track player joins
Players.PlayerAdded:Connect(function(player)
    sendEvent("player_join", {
        player_id = tostring(player.UserId),
        session_id = game.JobId .. "-" .. player.UserId,
        metadata = {
            username = player.Name,
            display_name = player.DisplayName,
            place_id = game.PlaceId,
            job_id = game.JobId
        }
    })
end)

-- Track player leaves (session end)
Players.PlayerRemoving:Connect(function(player)
    sendEvent("session_end", {
        player_id = tostring(player.UserId),
        session_id = game.JobId .. "-" .. player.UserId,
        metadata = {
            username = player.Name
        }
    })
end)

-- Track gamepass purchases
MarketplaceService.PromptGamePassPurchaseFinished:Connect(function(player, gamePassId, wasPurchased)
    if wasPurchased then
        local info = MarketplaceService:GetProductInfo(gamePassId, Enum.InfoType.GamePass)
        sendEvent("gamepass_purchase", {
            player_id = tostring(player.UserId),
            session_id = game.JobId .. "-" .. player.UserId,
            metadata = {
                product_id = tostring(gamePassId),
                product_name = info and info.Name or "Unknown",
                product_type = "gamepass",
                robux = info and info.PriceInRobux or 0,
                username = player.Name
            }
        })
    end
end)

-- Track developer product purchases
MarketplaceService.PromptProductPurchaseFinished:Connect(function(userId, productId, wasPurchased)
    if wasPurchased then
        local player = Players:GetPlayerByUserId(userId)
        local info = MarketplaceService:GetProductInfo(productId, Enum.InfoType.Product)
        sendEvent("devproduct_purchase", {
            player_id = tostring(userId),
            session_id = game.JobId .. "-" .. userId,
            metadata = {
                product_id = tostring(productId),
                product_name = info and info.Name or "Unknown",
                product_type = "devproduct",
                robux = info and info.PriceInRobux or 0,
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
  const [sendingTestEvent, setSendingTestEvent] = useState(false);
  const [testEventResult, setTestEventResult] = useState<{ success: boolean; message: string } | null>(null);

  // Fetch tracker debug data
  const { data: debugData, isLoading: loading, mutate } = useSWR<TrackerDebugData>(
    "/api/tracker/debug",
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 0 }
  );

  // Also fetch the full API key from analytics endpoint
  const { data: analyticsData } = useSWR(
    "/api/dashboard/analytics",
    fetcher,
    { revalidateOnFocus: false }
  );

  const game = debugData?.selectedGame;
  const fullApiKey = analyticsData?.dataHealth?.apiKey || "";

  const handleCopy = async () => {
    if (!fullApiKey) return;
    const universeId = game?.universe_id || game?.roblox_game_id;
    const script = generateLuaScript(fullApiKey, universeId);
    await navigator.clipboard.writeText(script);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCheckStatus = useCallback(async () => {
    await mutate();
  }, [mutate]);

  const handleSendTestEvent = async () => {
    setSendingTestEvent(true);
    setTestEventResult(null);
    try {
      const res = await fetch("/api/tracker/test-event", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setTestEventResult({ success: true, message: "Test event inserted successfully! Refresh status to verify." });
        // Refresh debug data
        await mutate();
      } else {
        setTestEventResult({ success: false, message: data.error || "Failed to send test event" });
      }
    } catch (error) {
      setTestEventResult({ success: false, message: "Network error: " + (error instanceof Error ? error.message : String(error)) });
    } finally {
      setSendingTestEvent(false);
    }
  };

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
              Please connect a game first to set up tracking.
            </p>
            <Button asChild>
              <Link href="/dashboard/game">Go to My Game</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const hasTracking = debugData?.trackingActive || false;
  const eventCount = debugData?.eventCountForGame || 0;
  const lastEvent = debugData?.lastEvent;
  const universeId = game.universe_id || game.roblox_game_id;
  const luaScript = generateLuaScript(fullApiKey, universeId);

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

      {/* Game Info & Debug Card */}
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
              <p className="font-mono text-sm text-foreground">{universeId || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">API Key</p>
              <p className="font-mono text-sm text-foreground">{game.api_key_prefix || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Tracking Status</p>
              {hasTracking ? (
                <Badge variant="default" className="bg-green-500/10 text-green-600 border-green-500/20">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Active ({eventCount} events)
                </Badge>
              ) : (
                <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 border-amber-500/20">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  Waiting for first event
                </Badge>
              )}
            </div>
          </div>

          {/* Event Info */}
          <div className="bg-muted/30 rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Events received:</span>
              <span className="font-mono text-sm">{eventCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Last event:</span>
              <span className="font-mono text-sm">
                {lastEvent ? (
                  <>
                    {lastEvent.event_type} at {new Date(lastEvent.created_at).toLocaleString()}
                  </>
                ) : (
                  "None"
                )}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Production endpoint:</span>
              <code className="font-mono text-xs bg-muted px-2 py-1 rounded">{PRODUCTION_URL}</code>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button variant="outline" size="sm" onClick={handleCheckStatus}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh Status
            </Button>
            <Button 
              variant="default" 
              size="sm" 
              onClick={handleSendTestEvent} 
              disabled={sendingTestEvent}
            >
              <Play className={`w-4 h-4 mr-2 ${sendingTestEvent ? "animate-pulse" : ""}`} />
              {sendingTestEvent ? "Sending..." : "Send Server Test Event"}
            </Button>
          </div>

          {/* Test Event Result */}
          {testEventResult && (
            <div className={`p-3 rounded-lg text-sm ${testEventResult.success ? "bg-green-500/10 text-green-700 border border-green-500/20" : "bg-red-500/10 text-red-700 border border-red-500/20"}`}>
              {testEventResult.success ? (
                <CheckCircle2 className="w-4 h-4 inline mr-2" />
              ) : (
                <AlertCircle className="w-4 h-4 inline mr-2" />
              )}
              {testEventResult.message}
            </div>
          )}
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
                <p className="font-medium text-foreground">Enable HTTP Requests</p>
                <p className="text-sm text-muted-foreground">
                  Game Settings → Security → Allow HTTP Requests → <strong>Enable</strong>
                </p>
              </div>
            </li>
            <li className="flex gap-4">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-sm font-medium flex items-center justify-center">3</span>
              <div>
                <p className="font-medium text-foreground">Create a Script in ServerScriptService</p>
                <p className="text-sm text-muted-foreground">
                  In Explorer, right-click ServerScriptService → Insert Object → Script. Name it <code className="px-1 py-0.5 rounded bg-muted">RoMonetizeTracker</code>
                </p>
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
                <p className="font-medium text-foreground">Publish the game</p>
                <p className="text-sm text-muted-foreground">File → Publish to Roblox. The script only runs in published games.</p>
              </div>
            </li>
            <li className="flex gap-4">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-sm font-medium flex items-center justify-center">6</span>
              <div>
                <p className="font-medium text-foreground">Join the live published game</p>
                <p className="text-sm text-muted-foreground">Open Roblox app and join your published game (not Studio Play Solo)</p>
              </div>
            </li>
            <li className="flex gap-4">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-sm font-medium flex items-center justify-center">7</span>
              <div>
                <p className="font-medium text-foreground">Wait 30-60 seconds</p>
                <p className="text-sm text-muted-foreground">The script_started event is sent when the server starts</p>
              </div>
            </li>
            <li className="flex gap-4">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-sm font-medium flex items-center justify-center">8</span>
              <div>
                <p className="font-medium text-foreground">Click Refresh Status above</p>
                <p className="text-sm text-muted-foreground">Verify events are being received</p>
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
            <Button variant="outline" size="sm" onClick={handleCopy} disabled={!fullApiKey}>
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
          <div className="bg-zinc-950 rounded-lg p-4 overflow-x-auto max-h-96">
            <pre className="text-sm text-zinc-300 font-mono whitespace-pre">{luaScript}</pre>
          </div>
        </CardContent>
      </Card>

      {/* Troubleshooting */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            Troubleshooting
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
            <li>
              <strong className="text-foreground">Roblox Studio → Game Settings → Security → Enable HTTP Requests</strong> must be ON.
            </li>
            <li>
              <strong className="text-foreground">Script must be in ServerScriptService</strong>, not StarterPlayerScripts or other locations.
            </li>
            <li>
              <strong className="text-foreground">You must publish the game</strong> after adding the script. File → Publish to Roblox.
            </li>
            <li>
              <strong className="text-foreground">You must join the live published game</strong>, not just Studio Play Solo.
            </li>
            <li>
              <strong className="text-foreground">Check Roblox server Output</strong> for &quot;[RoMonetize] Event sent&quot; or error messages.
            </li>
            <li>
              If you see <code className="px-1 py-0.5 rounded bg-muted">&quot;HTTP requests are not enabled&quot;</code>, enable HTTP Requests in Game Settings.
            </li>
            <li>
              If you see <code className="px-1 py-0.5 rounded bg-muted">401</code> or <code className="px-1 py-0.5 rounded bg-muted">403</code> errors, copy the latest script again because the API key may be wrong.
            </li>
          </ol>
          <div className="pt-4 border-t border-border">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">Still not working?</strong> Click &quot;Send Server Test Event&quot; above. If it succeeds but Roblox events do not appear, the issue is in your Roblox script.
            </p>
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
              <strong className="text-foreground">Keep your API key secret.</strong> Never share it publicly or commit it to public repositories.
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
