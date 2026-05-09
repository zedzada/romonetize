"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAnalytics, formatChartTime } from "@/hooks/use-analytics";
import { ChartCard, chartAxisStyle, chartGridStyle } from "@/components/dashboard/chart-card";
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
  ResponsiveContainer,
  Tooltip,
  LabelList,
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
            <ChartCard
              title="Revenue Over Time"
              subtitle="Total Robux earned from purchases"
              source="tracker"
              summary={monetizationCharts.revenueOverTime?.length ? `Total: R$${monetizationCharts.revenueOverTime.reduce((sum, d) => sum + (d.revenue ?? 0), 0).toLocaleString()}` : undefined}
              isEmpty={!monetizationCharts.revenueOverTime?.length}
              emptyTitle="No revenue yet"
              emptyMessage="Revenue appears after tracked purchase_success events with a Robux amount."
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monetizationCharts.revenueOverTime ?? []} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0.05}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...chartGridStyle} />
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={(v) => formatChartTime(v, "7d")}
                    {...chartAxisStyle}
                  />
                  <YAxis 
                    tickFormatter={(v) => `R$${Number(v).toLocaleString()}`}
                    allowDecimals={false}
                    {...chartAxisStyle}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                    labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
                    formatter={(value: number) => [`R$${value.toLocaleString()}`, "Revenue"]}
                    labelFormatter={(label) => formatChartTime(label, "7d")}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="revenue" 
                    stroke="hsl(var(--chart-1))"
                    strokeWidth={3}
                    fill="url(#revenueGradient)"
                    dot={{ r: 4, fill: "hsl(var(--chart-1))", strokeWidth: 0 }}
                    activeDot={{ r: 6, fill: "hsl(var(--chart-1))", strokeWidth: 2, stroke: "hsl(var(--background))" }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* Purchases Over Time */}
            <ChartCard
              title="Purchases Over Time"
              subtitle="Number of successful transactions"
              source="tracker"
              summary={monetizationCharts.purchasesOverTime?.length ? `Total: ${monetizationCharts.purchasesOverTime.reduce((sum, d) => sum + (d.purchases ?? 0), 0).toLocaleString()}` : undefined}
              isEmpty={!monetizationCharts.purchasesOverTime?.length}
              emptyTitle="No purchases yet"
              emptyMessage="Purchases will appear after purchase_success events are tracked."
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monetizationCharts.purchasesOverTime ?? []} margin={{ top: 20, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid {...chartGridStyle} />
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={(v) => formatChartTime(v, "7d")}
                    {...chartAxisStyle}
                  />
                  <YAxis 
                    allowDecimals={false}
                    {...chartAxisStyle}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                    labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
                    formatter={(value: number) => [value.toLocaleString(), "Purchases"]}
                    labelFormatter={(label) => formatChartTime(label, "7d")}
                  />
                  <Bar 
                    dataKey="purchases" 
                    fill="hsl(var(--chart-2))"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={50}
                  >
                    {(monetizationCharts.purchasesOverTime?.length ?? 0) <= 3 && (
                      <LabelList dataKey="purchases" position="top" fill="hsl(var(--foreground))" fontSize={12} fontWeight={600} />
                    )}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* Revenue by Product Type */}
            <ChartCard
              title="Revenue by Product Type"
              subtitle="Gamepasses vs Developer Products"
              source="tracker"
              summary={monetizationCharts.revenueByProductType?.length ? `R$${monetizationCharts.revenueByProductType.reduce((sum, d) => sum + (d.revenue ?? 0), 0).toLocaleString()}` : undefined}
              isEmpty={!monetizationCharts.revenueByProductType?.length}
              emptyIcon={<PieChartIcon className="w-12 h-12" />}
              emptyTitle="No revenue breakdown yet"
              emptyMessage="Product type breakdown appears after purchases are tracked."
            >
              <div className="h-full flex items-center justify-center gap-8">
                <ResponsiveContainer width={200} height={200}>
                  <PieChart>
                    <Pie
                      data={monetizationCharts.revenueByProductType}
                      dataKey="revenue"
                      nameKey="productType"
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={4}
                      strokeWidth={3}
                      stroke="hsl(var(--background))"
                    >
                      {monetizationCharts.revenueByProductType.map((entry, index) => (
                        <Cell 
                          key={entry.productType} 
                          fill={index === 0 ? "hsl(var(--chart-1))" : "hsl(var(--chart-2))"} 
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--popover))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                      }}
                      formatter={(value: number) => [`R$${value.toLocaleString()}`, ""]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-4">
                  {monetizationCharts.revenueByProductType.map((item, index) => (
                    <div key={item.productType} className="flex items-center gap-3">
                      <div 
                        className="w-5 h-5 rounded-md shadow-sm" 
                        style={{ 
                          backgroundColor: index === 0 
                            ? "hsl(var(--chart-1))" 
                            : "hsl(var(--chart-2))" 
                        }}
                      />
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">{item.productType === "gamepass" ? "Game Passes" : "Dev Products"}</p>
                        <p className="text-xl font-bold text-foreground">R${item.revenue.toLocaleString()}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </ChartCard>

            {/* Top Products */}
            <ChartCard
              title="Top Products by Revenue"
              subtitle="Best performing products"
              source="tracker"
              summary={monetizationCharts.topProducts?.length ? `${monetizationCharts.topProducts.length} products` : undefined}
              isEmpty={!monetizationCharts.topProducts?.length}
              emptyIcon={<Package className="w-12 h-12" />}
              emptyTitle="No product data yet"
              emptyMessage="Top products will appear after purchases are tracked."
            >
              <div className="h-full overflow-auto py-2 px-1">
                <div className="space-y-2">
                  {monetizationCharts.topProducts.slice(0, 6).map((product, index) => {
                    const maxRevenue = Math.max(...monetizationCharts.topProducts.map(p => p.revenue));
                    const barWidth = maxRevenue > 0 ? (product.revenue / maxRevenue) * 100 : 0;
                    
                    return (
                      <div key={product.productId} className="relative group">
                        {/* Progress bar background */}
                        <div 
                          className="absolute inset-0 rounded-lg opacity-20 transition-opacity group-hover:opacity-30"
                          style={{ 
                            width: `${barWidth}%`,
                            backgroundColor: "hsl(var(--chart-1))"
                          }}
                        />
                        <div className="relative flex items-center justify-between py-3 px-3">
                          <div className="flex items-center gap-3">
                            <div className="w-7 h-7 rounded-lg bg-neutral-800 flex items-center justify-center text-sm font-bold text-neutral-300 shrink-0">
                              {index + 1}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground truncate">{product.productName}</p>
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 mt-0.5 border-neutral-700 text-neutral-400">
                                {product.productType === "gamepass" ? "Game Pass" : "Dev Product"}
                              </Badge>
                            </div>
                          </div>
                          <div className="text-right shrink-0 ml-4">
                            <p className="text-sm font-bold text-foreground">R${product.revenue.toLocaleString()}</p>
                            <p className="text-xs text-muted-foreground">{product.purchases} sales</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </ChartCard>
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
