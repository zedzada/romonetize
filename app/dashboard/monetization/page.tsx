"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAnalytics, formatChartTime } from "@/hooks/use-analytics";
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
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { 
  RefreshCw, 
  DollarSign, 
  ShoppingCart, 
  Users, 
  TrendingUp,
  AlertCircle,
  ExternalLink,
  Coins,
  PieChartIcon,
  Package,
} from "lucide-react";
import Link from "next/link";

// Safe number formatter - prevents crashes on undefined/null
function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString();
}

function formatRobux(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `R$${value.toLocaleString()}`;
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(1)}%`;
}

export default function MonetizationPage() {
  const {
    isLoading,
    isRefreshing,
    error,
    dataHealth,
    revenueStats,
    monetizationCharts,
    hasTrackerData,
    needsTrackingScript,
    refresh,
  } = useAnalytics({ enabled: true, range: "7d" });

  // Safe defaults for revenue stats
  const safeRevenueStats = {
    totalRevenue: revenueStats?.totalRevenue ?? null,
    totalPurchases: revenueStats?.totalPurchases ?? null,
    payingUsers: revenueStats?.payingUsers ?? null,
    arppu: revenueStats?.arppu ?? null,
    arpdau: revenueStats?.arpdau ?? null,
  };

  // Handle refresh
  const handleRefresh = async () => {
    if (refresh) {
      await refresh();
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-8 w-48 mb-2" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-32" />
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
          <h1 className="text-2xl font-bold text-foreground">Monetization</h1>
          <p className="text-muted-foreground">Track revenue and purchase metrics</p>
        </div>
        <Card className="border-destructive/50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3 text-destructive">
              <AlertCircle className="w-5 h-5" />
              <p>Failed to load monetization data: {error}</p>
            </div>
            <Button onClick={handleRefresh} variant="outline" className="mt-4">
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Monetization</h1>
          <p className="text-muted-foreground">Track revenue and purchase metrics from your tracking script</p>
        </div>
        <Button 
          onClick={handleRefresh} 
          variant="outline" 
          disabled={isRefreshing}
          className="gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
          Refresh Data
        </Button>
      </div>

      {/* Data source badge */}
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px]">
          RoMonetize Tracker
        </Badge>
        {hasTrackerData && (
          <span className="text-xs text-muted-foreground">
            Revenue data from purchase_success events
          </span>
        )}
      </div>

      {/* Tracking script required banner */}
      {needsTrackingScript && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-500 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-foreground mb-1">Install tracking script to track revenue</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Monetization data requires the RoMonetize tracking script. The script captures purchase events 
                  including the robux amount, product details, and player information.
                </p>
                <Button variant="outline" size="sm" asChild>
                  <Link href="/dashboard/game/tracking-setup">
                    <ExternalLink className="w-4 h-4 mr-2" />
                    View Installation Guide
                  </Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Revenue Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {/* Revenue */}
        <Card className="border-border/50">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-4 h-4 text-green-500" />
              <span className="text-xs text-muted-foreground">Revenue</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {!hasTrackerData ? (
                <span className="text-sm text-muted-foreground font-normal">Requires tracking</span>
              ) : safeRevenueStats.totalRevenue === 0 ? (
                <span className="text-lg font-medium text-muted-foreground">R$ 0</span>
              ) : (
                formatRobux(safeRevenueStats.totalRevenue)
              )}
            </div>
            {hasTrackerData && safeRevenueStats.totalRevenue === 0 && (
              <p className="text-[10px] text-muted-foreground mt-1">No purchases tracked yet</p>
            )}
          </CardContent>
        </Card>

        {/* Purchases */}
        <Card className="border-border/50">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <ShoppingCart className="w-4 h-4 text-blue-500" />
              <span className="text-xs text-muted-foreground">Purchases</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {!hasTrackerData ? (
                <span className="text-sm text-muted-foreground font-normal">Requires tracking</span>
              ) : (
                formatNumber(safeRevenueStats.totalPurchases ?? 0)
              )}
            </div>
            {hasTrackerData && (safeRevenueStats.totalPurchases ?? 0) === 0 && (
              <p className="text-[10px] text-muted-foreground mt-1">No purchases tracked yet</p>
            )}
          </CardContent>
        </Card>

        {/* Paying Users */}
        <Card className="border-border/50">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-4 h-4 text-purple-500" />
              <span className="text-xs text-muted-foreground">Paying Users</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {!hasTrackerData ? (
                <span className="text-sm text-muted-foreground font-normal">Requires tracking</span>
              ) : (
                formatNumber(safeRevenueStats.payingUsers ?? 0)
              )}
            </div>
          </CardContent>
        </Card>

        {/* ARPPU */}
        <Card className="border-border/50">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <Coins className="w-4 h-4 text-amber-500" />
              <span className="text-xs text-muted-foreground">ARPPU</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {!hasTrackerData ? (
                <span className="text-sm text-muted-foreground font-normal">Requires tracking</span>
              ) : safeRevenueStats.arppu === null || safeRevenueStats.arppu === 0 ? (
                <span className="text-lg font-medium text-muted-foreground">—</span>
              ) : (
                formatRobux(safeRevenueStats.arppu)
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Avg Revenue Per Paying User</p>
          </CardContent>
        </Card>

        {/* ARPDAU */}
        <Card className="border-border/50">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-cyan-500" />
              <span className="text-xs text-muted-foreground">ARPDAU</span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {!hasTrackerData ? (
                <span className="text-sm text-muted-foreground font-normal">Requires tracking</span>
              ) : safeRevenueStats.arpdau === null || safeRevenueStats.arpdau === 0 ? (
                <span className="text-lg font-medium text-muted-foreground">—</span>
              ) : (
                formatRobux(safeRevenueStats.arpdau)
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Avg Revenue Per Daily Active User</p>
          </CardContent>
        </Card>
      </div>

      {/* Monetization Charts */}
      {hasTrackerData && monetizationCharts && (
        <div className="space-y-6">
          <h3 className="text-lg font-semibold text-foreground">Revenue Charts</h3>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Revenue Over Time */}
            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium">Revenue Over Time</CardTitle>
                  <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px]">
                    RoMonetize Tracker
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                {monetizationCharts.revenueOverTime.length > 0 ? (
                  <ChartContainer
                    config={{
                      revenue: { label: "Revenue (R$)", color: "hsl(var(--chart-1))" },
                    }}
                    className="h-[200px] w-full"
                  >
                    <AreaChart data={monetizationCharts.revenueOverTime}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis 
                        dataKey="date" 
                        tickFormatter={(v) => formatChartTime(v, "7d")}
                        className="text-xs"
                      />
                      <YAxis 
                        tickFormatter={(v) => `R$${v}`}
                        className="text-xs" 
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Area 
                        type="monotone" 
                        dataKey="revenue" 
                        stroke="var(--color-revenue)" 
                        fill="var(--color-revenue)" 
                        fillOpacity={0.2} 
                      />
                    </AreaChart>
                  </ChartContainer>
                ) : (
                  <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
                    No revenue data available yet
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Purchases Over Time */}
            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium">Purchases Over Time</CardTitle>
                  <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px]">
                    RoMonetize Tracker
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                {monetizationCharts.purchasesOverTime.length > 0 ? (
                  <ChartContainer
                    config={{
                      purchases: { label: "Purchases", color: "hsl(var(--chart-2))" },
                    }}
                    className="h-[200px] w-full"
                  >
                    <BarChart data={monetizationCharts.purchasesOverTime}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis 
                        dataKey="date" 
                        tickFormatter={(v) => formatChartTime(v, "7d")}
                        className="text-xs"
                      />
                      <YAxis className="text-xs" />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar 
                        dataKey="purchases" 
                        fill="var(--color-purchases)" 
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ChartContainer>
                ) : (
                  <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
                    No purchase data available yet
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Revenue by Product Type */}
            <Card className="border-border/60 bg-card/50">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base font-semibold">Revenue by Product Type</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">Gamepasses vs Developer Products</p>
                  </div>
                  <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-500 border-emerald-500/30 text-[10px]">
                    RoMonetize Tracker
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {monetizationCharts.revenueByProductType.length > 0 ? (
                  <div className="h-[220px] flex items-center justify-center gap-6">
                    <ChartContainer
                      config={{
                        gamepass: { label: "Gamepasses", color: "hsl(var(--chart-1))" },
                        devproduct: { label: "Dev Products", color: "hsl(var(--chart-2))" },
                      }}
                      className="h-[180px] w-[180px]"
                    >
                      <PieChart>
                        <Pie
                          data={monetizationCharts.revenueByProductType}
                          dataKey="revenue"
                          nameKey="productType"
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={80}
                          paddingAngle={3}
                          strokeWidth={2}
                          stroke="hsl(var(--background))"
                        >
                          {monetizationCharts.revenueByProductType.map((entry, index) => (
                            <Cell 
                              key={entry.productType} 
                              fill={index === 0 ? "hsl(var(--chart-1))" : "hsl(var(--chart-2))"} 
                            />
                          ))}
                        </Pie>
                        <ChartTooltip content={<ChartTooltipContent />} />
                      </PieChart>
                    </ChartContainer>
                    <div className="space-y-3">
                      {monetizationCharts.revenueByProductType.map((item, index) => (
                        <div key={item.productType} className="flex items-center gap-3">
                          <div 
                            className="w-4 h-4 rounded" 
                            style={{ 
                              backgroundColor: index === 0 
                                ? "hsl(var(--chart-1))" 
                                : "hsl(var(--chart-2))" 
                            }}
                          />
                          <div>
                            <p className="text-sm font-medium">{item.productType === "gamepass" ? "Game Passes" : "Dev Products"}</p>
                            <p className="text-lg font-bold text-foreground">R${item.revenue.toLocaleString()}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="h-[220px] flex flex-col items-center justify-center text-center px-4">
                    <PieChartIcon className="w-10 h-10 text-muted-foreground/40 mb-3" />
                    <p className="text-sm font-medium text-foreground mb-1">No revenue breakdown yet</p>
                    <p className="text-xs text-muted-foreground max-w-[200px]">
                      Product type breakdown appears after purchases are tracked.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Top Products */}
            <Card className="border-border/60 bg-card/50">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base font-semibold">Top Products by Revenue</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">Best performing products</p>
                  </div>
                  <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-500 border-emerald-500/30 text-[10px]">
                    RoMonetize Tracker
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {monetizationCharts.topProducts.length > 0 ? (
                  <div className="space-y-3">
                    {monetizationCharts.topProducts.slice(0, 5).map((product, index) => (
                      <div key={product.productId} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                        <div className="flex items-center gap-3">
                          <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center text-sm font-bold text-muted-foreground">
                            {index + 1}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-foreground">{product.productName}</p>
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 mt-0.5">
                              {product.productType === "gamepass" ? "Game Pass" : "Dev Product"}
                            </Badge>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-foreground">R${product.revenue.toLocaleString()}</p>
                          <p className="text-xs text-muted-foreground">{product.purchases} sales</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="h-[220px] flex flex-col items-center justify-center text-center px-4">
                    <Package className="w-10 h-10 text-muted-foreground/40 mb-3" />
                    <p className="text-sm font-medium text-foreground mb-1">No product data yet</p>
                    <p className="text-xs text-muted-foreground max-w-[200px]">
                      Top products will appear after purchases are tracked.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Data explanation */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-base">How Monetization Data Works</CardTitle>
          <CardDescription>
            Understanding the data sources for your revenue metrics
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="p-4 rounded-lg bg-secondary/30 border border-border/50">
              <h4 className="font-medium text-foreground mb-2 flex items-center gap-2">
                <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px]">
                  RoMonetize Tracker
                </Badge>
              </h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Revenue (from purchase_success robux field)</li>
                <li>• Purchases (count of purchase_success events)</li>
                <li>• Paying Users (distinct player_id from purchases)</li>
                <li>• ARPPU (revenue / paying users)</li>
                <li>• ARPDAU (revenue / unique active players)</li>
              </ul>
            </div>

            <div className="p-4 rounded-lg bg-secondary/30 border border-border/50">
              <h4 className="font-medium text-foreground mb-2">Required Event: purchase_success</h4>
              <p className="text-sm text-muted-foreground mb-2">
                Fire this event when a player completes a purchase:
              </p>
              <pre className="text-xs bg-background/50 p-2 rounded border border-border/30 overflow-x-auto">
{`RoMonetize:TrackPurchase({
  player_id = player.UserId,
  product_id = productId,
  product_name = "Sword",
  product_type = "gamepass",
  robux = 150
})`}
              </pre>
            </div>
          </div>

          <div className="p-4 rounded-lg bg-blue-500/5 border border-blue-500/20">
            <h4 className="font-medium text-foreground mb-1 text-sm">Note on Roblox Revenue API</h4>
            <p className="text-sm text-muted-foreground">
              Roblox does not provide public API access to Creator Analytics revenue data. 
              Revenue tracking requires the RoMonetize tracking script to capture purchase events directly from your game.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
