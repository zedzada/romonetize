import { NextResponse } from "next/server";

/**
 * GET /api/roblox/analytics-capabilities
 * 
 * Returns a report of what Roblox analytics metrics are available via official APIs
 * vs what requires the RoMonetize tracking script or is simply unavailable.
 * 
 * This endpoint is for developer debugging and transparency about data sources.
 */

interface MetricCapability {
  metric: string;
  description: string;
  endpoint?: string;
  scope?: string;
  implemented: boolean;
  source: "roblox_public_api" | "roblox_oauth_api" | "romonetize_tracker" | "unavailable";
  notes?: string;
}

interface CapabilitiesReport {
  availableViaApi: MetricCapability[];
  availableViaTracker: MetricCapability[];
  notAvailable: MetricCapability[];
  summary: {
    totalMetrics: number;
    implementedViaApi: number;
    implementedViaTracker: number;
    unavailable: number;
  };
  notes: string[];
  lastUpdated: string;
}

export async function GET() {
  // Metrics available via Roblox public APIs (no auth required)
  const publicApiMetrics: MetricCapability[] = [
    {
      metric: "current_ccu",
      description: "Current concurrent users playing the game",
      endpoint: "https://games.roblox.com/v1/games?universeIds={id}",
      scope: "none (public)",
      implemented: true,
      source: "roblox_public_api",
    },
    {
      metric: "total_visits",
      description: "Total lifetime visits to the game",
      endpoint: "https://games.roblox.com/v1/games?universeIds={id}",
      scope: "none (public)",
      implemented: true,
      source: "roblox_public_api",
    },
    {
      metric: "favorites",
      description: "Total number of users who favorited the game",
      endpoint: "https://games.roblox.com/v1/games?universeIds={id}",
      scope: "none (public)",
      implemented: true,
      source: "roblox_public_api",
    },
    {
      metric: "likes",
      description: "Total thumbs up votes",
      endpoint: "https://games.roblox.com/v1/games/{universeId}/votes",
      scope: "none (public)",
      implemented: true,
      source: "roblox_public_api",
    },
    {
      metric: "dislikes",
      description: "Total thumbs down votes",
      endpoint: "https://games.roblox.com/v1/games/{universeId}/votes",
      scope: "none (public)",
      implemented: true,
      source: "roblox_public_api",
    },
    {
      metric: "like_ratio",
      description: "Percentage of likes vs total votes",
      endpoint: "https://games.roblox.com/v1/games/{universeId}/votes",
      scope: "none (public)",
      implemented: true,
      source: "roblox_public_api",
      notes: "Calculated from likes/(likes+dislikes)",
    },
  ];

  // Metrics available via Roblox OAuth APIs (requires connected account)
  const oauthApiMetrics: MetricCapability[] = [
    {
      metric: "gamepasses",
      description: "List of game passes with prices",
      endpoint: "https://develop.roblox.com/v1/universes/{universeId}/passes",
      scope: "openid profile",
      implemented: true,
      source: "roblox_oauth_api",
    },
    {
      metric: "developer_products",
      description: "List of developer products with prices",
      endpoint: "https://develop.roblox.com/v1/universes/{universeId}/developerproducts",
      scope: "openid profile",
      implemented: true,
      source: "roblox_oauth_api",
    },
    {
      metric: "user_transactions",
      description: "Recent transaction history (sales)",
      endpoint: "https://economy.roblox.com/v2/users/{userId}/transactions",
      scope: "openid profile",
      implemented: true,
      source: "roblox_oauth_api",
      notes: "Limited to user's own transactions, not per-game breakdown",
    },
    {
      metric: "user_universes",
      description: "List of games owned by connected user",
      endpoint: "https://apis.roblox.com/cloud/v2/users/me/universes",
      scope: "openid profile",
      implemented: true,
      source: "roblox_oauth_api",
    },
  ];

  // Metrics available via RoMonetize tracking script
  const trackerMetrics: MetricCapability[] = [
    {
      metric: "session_duration",
      description: "How long players spend in-game per session",
      implemented: true,
      source: "romonetize_tracker",
      notes: "Requires RoMonetize Lua tracking script installed in your game",
    },
    {
      metric: "session_count",
      description: "Number of play sessions",
      implemented: true,
      source: "romonetize_tracker",
    },
    {
      metric: "unique_players",
      description: "Count of unique players tracked",
      implemented: true,
      source: "romonetize_tracker",
    },
    {
      metric: "new_vs_returning",
      description: "Breakdown of new vs returning players",
      implemented: true,
      source: "romonetize_tracker",
    },
    {
      metric: "purchase_events",
      description: "In-game purchase tracking with product details",
      implemented: true,
      source: "romonetize_tracker",
      notes: "Tracks purchases through MarketplaceService callbacks",
    },
    {
      metric: "product_views",
      description: "Which products players view in your shop",
      implemented: true,
      source: "romonetize_tracker",
    },
    {
      metric: "custom_events",
      description: "Custom analytics events you define",
      implemented: true,
      source: "romonetize_tracker",
    },
  ];

  // Metrics NOT available via any official API (Creator Dashboard only)
  const unavailableMetrics: MetricCapability[] = [
    {
      metric: "d1_retention",
      description: "Day 1 retention rate",
      implemented: false,
      source: "unavailable",
      notes: "Only visible in Roblox Creator Dashboard. No official API endpoint exists.",
    },
    {
      metric: "d7_retention",
      description: "Day 7 retention rate",
      implemented: false,
      source: "unavailable",
      notes: "Only visible in Roblox Creator Dashboard. No official API endpoint exists.",
    },
    {
      metric: "d30_retention",
      description: "Day 30 retention rate",
      implemented: false,
      source: "unavailable",
      notes: "Only visible in Roblox Creator Dashboard. No official API endpoint exists.",
    },
    {
      metric: "playtime_history",
      description: "Historical average session time over time",
      implemented: false,
      source: "unavailable",
      notes: "Only visible in Roblox Creator Dashboard. No official API endpoint exists.",
    },
    {
      metric: "72h_revenue",
      description: "Revenue from last 72 hours",
      implemented: false,
      source: "unavailable",
      notes: "Only visible in Roblox Creator Dashboard. No official API endpoint exists.",
    },
    {
      metric: "revenue_history",
      description: "Historical revenue time series",
      implemented: false,
      source: "unavailable",
      notes: "Only visible in Roblox Creator Dashboard. No official API endpoint exists.",
    },
    {
      metric: "product_sales_breakdown",
      description: "Revenue breakdown by individual product",
      implemented: false,
      source: "unavailable",
      notes: "Only visible in Roblox Creator Dashboard. No official API endpoint exists.",
    },
    {
      metric: "arppu",
      description: "Average Revenue Per Paying User",
      implemented: false,
      source: "unavailable",
      notes: "Only visible in Roblox Creator Dashboard. No official API endpoint exists.",
    },
    {
      metric: "arpdau",
      description: "Average Revenue Per Daily Active User",
      implemented: false,
      source: "unavailable",
      notes: "Only visible in Roblox Creator Dashboard. No official API endpoint exists.",
    },
    {
      metric: "payer_conversion_rate",
      description: "Percent of DAU who are paying users",
      implemented: false,
      source: "unavailable",
      notes: "Only visible in Roblox Creator Dashboard. No official API endpoint exists.",
    },
    {
      metric: "dau",
      description: "Daily Active Users count",
      implemented: false,
      source: "unavailable",
      notes: "Only visible in Roblox Creator Dashboard. No official API endpoint exists.",
    },
    {
      metric: "new_users",
      description: "Count of first-time players per day",
      implemented: false,
      source: "unavailable",
      notes: "Only visible in Roblox Creator Dashboard. No official API endpoint exists.",
    },
    {
      metric: "qualified_play_rate",
      description: "Conversion from discovery to meaningful play",
      implemented: false,
      source: "unavailable",
      notes: "Only visible in Roblox Creator Dashboard. No official API endpoint exists.",
    },
    {
      metric: "acquisition_sources",
      description: "Where new users come from",
      implemented: false,
      source: "unavailable",
      notes: "Only visible in Roblox Creator Dashboard. No official API endpoint exists.",
    },
  ];

  const allApiMetrics = [...publicApiMetrics, ...oauthApiMetrics];
  
  const report: CapabilitiesReport = {
    availableViaApi: allApiMetrics,
    availableViaTracker: trackerMetrics,
    notAvailable: unavailableMetrics,
    summary: {
      totalMetrics: allApiMetrics.length + trackerMetrics.length + unavailableMetrics.length,
      implementedViaApi: allApiMetrics.filter(m => m.implemented).length,
      implementedViaTracker: trackerMetrics.filter(m => m.implemented).length,
      unavailable: unavailableMetrics.length,
    },
    notes: [
      "Roblox Creator Analytics (retention, engagement, monetization KPIs) are only accessible through the Creator Dashboard web interface.",
      "There are NO official Open Cloud API endpoints for Creator Analytics data.",
      "Roblox OAuth scopes (openid, profile, email, etc.) do not include any analytics-related permissions.",
      "The OpenAPI specification at create.roblox.com/docs/cloud/reference/openapi does not include analytics endpoints.",
      "RoMonetize tracking script provides session/engagement data for games that install it.",
      "Public game stats (CCU, visits, favorites, likes) are available without authentication.",
      "This report was generated based on official Roblox documentation as of 2026.",
    ],
    lastUpdated: new Date().toISOString(),
  };

  return NextResponse.json(report);
}
