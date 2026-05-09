--[[
    RoMonetize Tracking Script
    ==========================
    
    This script sends analytics events to your RoMonetize dashboard.
    
    SETUP:
    1. Place this script in ServerScriptService
    2. Replace API_KEY with your key from the RoMonetize dashboard
    3. Replace GAME_ID with your Roblox Universe ID
    4. Enable HTTP Requests in Game Settings > Security
    
    TRACKED EVENTS:
    - player_join: When a player joins the game
    - player_leave: When a player leaves the game
    - shop_open: When a player opens your shop (call RoMonetize:TrackShopOpen)
    - gamepass_click: When a player clicks a gamepass (call RoMonetize:TrackGamepassClick)
    - purchase_prompt: When a purchase prompt is shown
    - purchase_success: When a purchase completes successfully
    
    For support, visit: https://romonetize.app/docs
--]]

-- ============================================
-- CONFIGURATION - UPDATE THESE VALUES
-- ============================================
local CONFIG = {
    API_KEY = "YOUR_API_KEY_HERE",      -- Get this from RoMonetize dashboard
    GAME_ID = "YOUR_GAME_ID_HERE",      -- Your Roblox Universe ID
    API_URL = "https://romonetize.app", -- API endpoint (change for local dev)
    DEBUG_MODE = false,                  -- Set to true for console logging
}

-- ============================================
-- DO NOT MODIFY BELOW THIS LINE
-- ============================================

local HttpService = game:GetService("HttpService")
local MarketplaceService = game:GetService("MarketplaceService")
local Players = game:GetService("Players")

local RoMonetize = {}
RoMonetize.__index = RoMonetize

-- Session tracking for calculating time spent
local playerSessions = {}

-- Helper function to log debug messages
local function debugLog(...)
    if CONFIG.DEBUG_MODE then
        print("[RoMonetize]", ...)
    end
end

-- Helper function to send events to the API
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
    
    local success, result = pcall(function()
        local jsonPayload = HttpService:JSONEncode(payload)
        debugLog("Sending event:", eventData.eventType, "for player:", eventData.playerId)
        
        return HttpService:PostAsync(
            CONFIG.API_URL .. "/api/events",
            jsonPayload,
            Enum.HttpContentType.ApplicationJson,
            false
        )
    end)
    
    if success then
        debugLog("Event sent successfully:", eventData.eventType)
    else
        warn("[RoMonetize] Failed to send event:", result)
    end
    
    return success
end

-- ============================================
-- AUTOMATIC TRACKING
-- ============================================

-- Track player joins
Players.PlayerAdded:Connect(function(player)
    playerSessions[player.UserId] = os.time()
    
    sendEvent({
        eventType = "player_join",
        playerId = tostring(player.UserId),
        metadata = {
            playerName = player.Name,
            accountAge = player.AccountAge,
            membershipType = tostring(player.MembershipType),
        }
    })
end)

-- Track player leaves
Players.PlayerRemoving:Connect(function(player)
    local sessionStart = playerSessions[player.UserId]
    local sessionDuration = sessionStart and (os.time() - sessionStart) or 0
    
    sendEvent({
        eventType = "player_leave",
        playerId = tostring(player.UserId),
        metadata = {
            playerName = player.Name,
            sessionDurationSeconds = sessionDuration,
        }
    })
    
    playerSessions[player.UserId] = nil
end)

-- Track gamepass purchase prompts and completions
MarketplaceService.PromptGamePassPurchaseFinished:Connect(function(player, gamePassId, wasPurchased)
    if wasPurchased then
        -- Get gamepass info for the event
        local success, gamePassInfo = pcall(function()
            return MarketplaceService:GetProductInfo(gamePassId, Enum.InfoType.GamePass)
        end)
        
        -- Fallback to "Product {ID}" if GetProductInfo fails (never "Unknown")
        local productName = success and gamePassInfo and gamePassInfo.Name or ("Product " .. tostring(gamePassId))
        local robuxPrice = success and gamePassInfo and gamePassInfo.PriceInRobux or 0
        
        sendEvent({
            eventType = "purchase_success",
            playerId = tostring(player.UserId),
            productId = tostring(gamePassId),
            productName = productName,
            productType = "gamepass",
            robux = robuxPrice,
            metadata = {
                playerName = player.Name,
                infoFetchSuccess = success,
            }
        })
        
        debugLog("Gamepass purchased:", productName, "by", player.Name)
    end
end)

-- Track developer product purchases
MarketplaceService.PromptProductPurchaseFinished:Connect(function(userId, productId, wasPurchased)
    if wasPurchased then
        local player = Players:GetPlayerByUserId(userId)
        local playerName = player and player.Name or "Unknown"
        
        -- Get product info
        local success, productInfo = pcall(function()
            return MarketplaceService:GetProductInfo(productId, Enum.InfoType.Product)
        end)
        
        -- Fallback to "Product {ID}" if GetProductInfo fails (never "Unknown Product")
        local productName = success and productInfo and productInfo.Name or ("Product " .. tostring(productId))
        local robuxPrice = success and productInfo and productInfo.PriceInRobux or 0
        
        sendEvent({
            eventType = "purchase_success",
            playerId = tostring(userId),
            productId = tostring(productId),
            productName = productName,
            productType = "devproduct",
            robux = robuxPrice,
            metadata = {
                playerName = playerName,
                infoFetchSuccess = success,
            }
        })
        
        debugLog("Developer product purchased:", productName, "by", playerName)
    end
end)

-- ============================================
-- MANUAL TRACKING FUNCTIONS
-- Call these from your game scripts
-- ============================================

--- Track when a player opens your shop/store UI
--- @param player Player - The player who opened the shop
--- @param shopName string? - Optional name of the shop
function RoMonetize:TrackShopOpen(player, shopName)
    sendEvent({
        eventType = "shop_open",
        playerId = tostring(player.UserId),
        metadata = {
            playerName = player.Name,
            shopName = shopName or "Main Shop",
        }
    })
    debugLog("Shop opened by", player.Name)
end

--- Track when a player closes your shop/store UI
--- @param player Player - The player who closed the shop
--- @param shopName string? - Optional name of the shop
function RoMonetize:TrackShopClose(player, shopName)
    sendEvent({
        eventType = "shop_close",
        playerId = tostring(player.UserId),
        metadata = {
            playerName = player.Name,
            shopName = shopName or "Main Shop",
        }
    })
    debugLog("Shop closed by", player.Name)
end

--- Track when a player clicks on a gamepass in your UI
--- @param player Player - The player who clicked
--- @param gamePassId number - The gamepass ID
--- @param gamePassName string? - Optional gamepass name
--- @param robuxPrice number? - Optional price in Robux
function RoMonetize:TrackGamepassClick(player, gamePassId, gamePassName, robuxPrice)
    local resolvedName = gamePassName or ("Product " .. tostring(gamePassId))
    sendEvent({
        eventType = "gamepass_click",
        playerId = tostring(player.UserId),
        productId = tostring(gamePassId),
        productName = resolvedName,
        productType = "gamepass",
        robux = robuxPrice or 0,
        metadata = {
            playerName = player.Name,
        }
    })
    debugLog("Gamepass clicked:", resolvedName, "by", player.Name)
end

--- Track when a player clicks on a developer product in your UI
--- @param player Player - The player who clicked
--- @param productId number - The developer product ID
--- @param productName string? - Optional product name
--- @param robuxPrice number? - Optional price in Robux
function RoMonetize:TrackDevProductClick(player, productId, productName, robuxPrice)
    local resolvedName = productName or ("Product " .. tostring(productId))
    sendEvent({
        eventType = "devproduct_click",
        playerId = tostring(player.UserId),
        productId = tostring(productId),
        productName = resolvedName,
        productType = "devproduct",
        robux = robuxPrice or 0,
        metadata = {
            playerName = player.Name,
        }
    })
    debugLog("Dev product clicked:", resolvedName, "by", player.Name)
end

--- Track when a purchase prompt is shown to a player
--- @param player Player - The player seeing the prompt
--- @param productId number - The product ID
--- @param productName string? - Optional product name
--- @param productType string - "gamepass" or "devproduct"
--- @param robuxPrice number? - Optional price in Robux
function RoMonetize:TrackPurchasePrompt(player, productId, productName, productType, robuxPrice)
    local resolvedName = productName or ("Product " .. tostring(productId))
    sendEvent({
        eventType = "purchase_prompt",
        playerId = tostring(player.UserId),
        productId = tostring(productId),
        productName = resolvedName,
        productType = productType or "gamepass",
        robux = robuxPrice or 0,
        metadata = {
            playerName = player.Name,
        }
    })
    debugLog("Purchase prompt shown for:", resolvedName, "to", player.Name)
end

--- Track a custom event (for extending tracking)
--- @param eventType string - The event type
--- @param player Player - The player
--- @param data table? - Optional additional data
function RoMonetize:TrackCustomEvent(eventType, player, data)
    data = data or {}
    sendEvent({
        eventType = eventType,
        playerId = tostring(player.UserId),
        productId = data.productId,
        productName = data.productName,
        productType = data.productType,
        robux = data.robux or 0,
        metadata = {
            playerName = player.Name,
            custom = data.metadata,
        }
    })
    debugLog("Custom event:", eventType, "by", player.Name)
end

-- ============================================
-- INITIALIZATION
-- ============================================

-- Validate configuration on startup
if CONFIG.API_KEY == "YOUR_API_KEY_HERE" then
    warn("[RoMonetize] WARNING: API_KEY not configured! Get your key from the RoMonetize dashboard.")
end

if CONFIG.GAME_ID == "YOUR_GAME_ID_HERE" then
    warn("[RoMonetize] WARNING: GAME_ID not configured! Enter your Roblox Universe ID.")
end

-- Track any players already in the game (for late script loading)
for _, player in ipairs(Players:GetPlayers()) do
    playerSessions[player.UserId] = os.time()
end

debugLog("RoMonetize Tracker initialized!")
debugLog("API URL:", CONFIG.API_URL)
debugLog("Debug Mode:", CONFIG.DEBUG_MODE and "ON" or "OFF")

-- Return the module for external use
return RoMonetize

--[[
    ============================================
    USAGE EXAMPLES
    ============================================
    
    -- In another script, require this module:
    local RoMonetize = require(game.ServerScriptService.RoMonetizeTracker)
    
    -- Track shop opens (call when player opens your shop UI):
    RoMonetize:TrackShopOpen(player, "Gem Store")
    
    -- Track gamepass clicks (call when player clicks a gamepass button):
    RoMonetize:TrackGamepassClick(player, 123456789, "VIP Pass", 499)
    
    -- Track developer product clicks:
    RoMonetize:TrackDevProductClick(player, 987654321, "100 Coins", 99)
    
    -- Track purchase prompts (call when showing MarketplaceService prompt):
    MarketplaceService:PromptGamePassPurchase(player, gamePassId)
    RoMonetize:TrackPurchasePrompt(player, gamePassId, "VIP Pass", "gamepass", 499)
    
    -- Purchases are tracked automatically when completed!
    
--]]
