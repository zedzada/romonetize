"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Package,
  TrendingUp,
  TrendingDown,
  ArrowUpDown,
  Search,
  AlertCircle,
  RefreshCw,
  Trophy,
  Flame,
  AlertTriangle,
  Users,
  DollarSign,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getProductStats, type ProductStats } from "@/lib/actions/products";
import { RobuxValue } from "@/components/ui/robux-icon";
import { useStatsRefresh } from "@/hooks/use-stats-refresh";
import { useRealtimeStats } from "@/hooks/use-realtime-stats";
import { useRobloxProducts } from "@/hooks/use-roblox-monetization";
import { getUserGameIds } from "@/lib/actions/analytics";
import { Radio, Gamepad2, ExternalLink } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Alert, AlertDescription } from "@/components/ui/alert";

type SortField = "name" | "revenue" | "purchases" | "clicks" | "conversion" | "revenue_per_player";
type SortOrder = "asc" | "desc";

// Badge rendering helper
function ProductBadge({ badge }: { badge: "best_seller" | "high_conversion" | "low_performer" }) {
  switch (badge) {
    case "best_seller":
      return (
        <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/20 gap-1">
          <Trophy className="w-3 h-3" />
          Best Seller
        </Badge>
      );
    case "high_conversion":
      return (
        <Badge className="bg-green-500/10 text-green-500 border-green-500/20 gap-1">
          <Flame className="w-3 h-3" />
          High Conversion
        </Badge>
      );
    case "low_performer":
      return (
        <Badge className="bg-red-500/10 text-red-500 border-red-500/20 gap-1">
          <AlertTriangle className="w-3 h-3" />
          Low Performer
        </Badge>
      );
  }
}

export default function ProductsPage() {
  const [products, setProducts] = useState<ProductStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("revenue");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [activeTab, setActiveTab] = useState<"all" | "gamepass" | "devproduct">("all");
  const [gameIds, setGameIds] = useState<string[]>([]);

  // Fetch real Roblox products data
  const {
    products: robloxProducts,
    summary: robloxSummary,
    isLoading: robloxLoading,
    needsConnection: robloxNeedsConnection,
    refresh: refreshRobloxProducts
  } = useRobloxProducts();

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [productsResult, gameIdsResult] = await Promise.all([
      getProductStats(),
      getUserGameIds(),
    ]);
    if (productsResult.error) {
      setError(productsResult.error);
    } else {
      setProducts(productsResult.products || []);
    }
    if (!gameIdsResult.error) {
      setGameIds(gameIdsResult.gameIds);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // Listen for global stats refresh (e.g., after test event)
  useStatsRefresh(fetchProducts);

  // Setup Supabase Realtime subscription
  const { isLive, status: realtimeStatus } = useRealtimeStats({
    gameIds,
    onNewEvent: fetchProducts,
    enabled: gameIds.length > 0,
  });

  // Filter by tab and search
  const filteredProducts = products
    .filter((p) => {
      if (activeTab === "gamepass") return p.product_type === "gamepass";
      if (activeTab === "devproduct") return p.product_type === "devproduct";
      return true;
    })
    .filter((p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

  // Sort products
  const sortedProducts = [...filteredProducts].sort((a, b) => {
    let aVal: number | string;
    let bVal: number | string;

    switch (sortField) {
      case "name":
        aVal = a.name.toLowerCase();
        bVal = b.name.toLowerCase();
        break;
      case "revenue":
        aVal = a.revenue;
        bVal = b.revenue;
        break;
      case "purchases":
        aVal = a.purchases;
        bVal = b.purchases;
        break;
      case "clicks":
        aVal = a.clicks;
        bVal = b.clicks;
        break;
      case "conversion":
        aVal = a.conversion_rate;
        bVal = b.conversion_rate;
        break;
      case "revenue_per_player":
        aVal = a.revenue_per_player;
        bVal = b.revenue_per_player;
        break;
      default:
        aVal = a.revenue;
        bVal = b.revenue;
    }

    if (typeof aVal === "string" && typeof bVal === "string") {
      return sortOrder === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    return sortOrder === "asc" ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
  });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
  };

  // Calculate summary stats
  const totalRevenue = products.reduce((sum, p) => sum + p.revenue, 0);
  const totalPurchases = products.reduce((sum, p) => sum + p.purchases, 0);
  const totalUniqueBuyers = products.reduce((sum, p) => sum + p.unique_buyers, 0);
  const avgConversion = products.filter(p => p.clicks > 0).reduce((sum, p) => sum + p.conversion_rate, 0) / 
    (products.filter(p => p.clicks > 0).length || 1);
  
  // Products with badges
  const bestSellers = products.filter((p) => p.badges.includes("best_seller"));
  const highConverters = products.filter((p) => p.badges.includes("high_conversion"));
  const lowPerformers = products.filter((p) => p.badges.includes("low_performer"));

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Products</h1>
          <p className="text-muted-foreground">Analyze performance of all your gamepasses and developer products</p>
        </div>
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Loading products...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Products</h1>
          <p className="text-muted-foreground">Analyze performance of all your gamepasses and developer products</p>
        </div>
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="w-5 h-5" />
              <span>{error}</span>
            </div>
            <Button variant="outline" className="mt-4" onClick={fetchProducts}>
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Products</h1>
          <p className="text-muted-foreground">Analyze performance of all your gamepasses and developer products</p>
        </div>
        <Card className="border-border bg-card">
          <CardContent className="pt-6">
            <div className="text-center py-12">
              <Package className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">No products tracked yet</h3>
              <p className="text-muted-foreground max-w-md mx-auto">
                Product data will appear after purchase or click events are received from your Roblox game.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Check if we have Roblox products data
  const hasRobloxProducts = robloxProducts && robloxProducts.length > 0;

  return (
    <div className="space-y-6">
      {/* Roblox Connection Banner */}
      {robloxNeedsConnection && (
        <Alert className="border-blue-500/30 bg-blue-500/5">
          <Gamepad2 className="h-4 w-4 text-blue-500" />
          <AlertDescription className="flex items-center justify-between">
            <span className="text-blue-700 dark:text-blue-300">
              Connect your Roblox account to see your gamepasses and developer products directly from Roblox.
            </span>
            <Button variant="outline" size="sm" className="ml-4 gap-2" asChild>
              <a href="/dashboard/settings">
                Connect Roblox
                <ExternalLink className="w-3 h-3" />
              </a>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Roblox Products Available Banner */}
      {hasRobloxProducts && (
        <Alert className="border-green-500/30 bg-green-500/5">
          <Gamepad2 className="h-4 w-4 text-green-500" />
          <AlertDescription className="text-green-700 dark:text-green-300">
            Found <strong>{robloxSummary?.totalGamepasses || 0} gamepasses</strong> and <strong>{robloxSummary?.totalDevProducts || 0} developer products</strong> from Roblox API.
          </AlertDescription>
        </Alert>
      )}

      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-foreground">Products</h1>
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
          <p className="text-muted-foreground">Analyze performance of all your gamepasses and developer products</p>
        </div>
        <Button variant="outline" onClick={() => { fetchProducts(); refreshRobloxProducts(); }} className="gap-2">
          <RefreshCw className="w-4 h-4" />
          Refresh
        </Button>
      </div>

      {/* Summary Stats */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <Card className="border-border bg-card">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center">
                <DollarSign className="w-4 h-4 text-green-500" />
              </div>
            </div>
            <div className="text-2xl font-bold text-foreground">
              <RobuxValue amount={totalRevenue} size="sm" />
            </div>
            <div className="text-xs text-muted-foreground">Total Product Revenue</div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Package className="w-4 h-4 text-blue-500" />
              </div>
            </div>
            <div className="text-2xl font-bold text-foreground">{totalPurchases.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">Total Purchases</div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <Users className="w-4 h-4 text-purple-500" />
              </div>
            </div>
            <div className="text-2xl font-bold text-foreground">{totalUniqueBuyers.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">Unique Buyers</div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-amber-500" />
              </div>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {products.some(p => p.clicks > 0) ? `${avgConversion.toFixed(1)}%` : "Needs tracking"}
            </div>
            <div className="text-xs text-muted-foreground">Avg Conversion Rate</div>
          </CardContent>
        </Card>
      </div>

      {/* Badge Summary */}
      {(bestSellers.length > 0 || highConverters.length > 0 || lowPerformers.length > 0) && (
        <div className="grid gap-4 md:grid-cols-3">
          {bestSellers.length > 0 && (
            <Card className="border-amber-500/20 bg-amber-500/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-amber-500">
                  <Trophy className="w-4 h-4" />
                  Best Sellers ({bestSellers.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {bestSellers.slice(0, 3).map((p) => (
                  <div key={p.product_id} className="flex items-center justify-between">
                    <span className="text-sm text-foreground truncate max-w-[150px]">{p.name}</span>
                    <RobuxValue amount={p.revenue} size="sm" />
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {highConverters.length > 0 && (
            <Card className="border-green-500/20 bg-green-500/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-green-500">
                  <Flame className="w-4 h-4" />
                  High Conversion ({highConverters.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {highConverters.slice(0, 3).map((p) => (
                  <div key={p.product_id} className="flex items-center justify-between">
                    <span className="text-sm text-foreground truncate max-w-[150px]">{p.name}</span>
                    <span className="text-sm font-medium text-green-500">{p.conversion_rate.toFixed(1)}%</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {lowPerformers.length > 0 && (
            <Card className="border-red-500/20 bg-red-500/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-red-500">
                  <AlertTriangle className="w-4 h-4" />
                  Low Performers ({lowPerformers.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {lowPerformers.slice(0, 3).map((p) => (
                  <div key={p.product_id} className="flex items-center justify-between">
                    <span className="text-sm text-foreground truncate max-w-[150px]">{p.name}</span>
                    <span className="text-sm font-medium text-red-500">{p.conversion_rate.toFixed(1)}%</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Tabs and search */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between">
        <div className="flex gap-2">
          <Button
            variant={activeTab === "all" ? "default" : "outline"}
            onClick={() => setActiveTab("all")}
          >
            All Products
          </Button>
          <Button
            variant={activeTab === "gamepass" ? "default" : "outline"}
            onClick={() => setActiveTab("gamepass")}
          >
            Gamepasses
          </Button>
          <Button
            variant={activeTab === "devproduct" ? "default" : "outline"}
            onClick={() => setActiveTab("devproduct")}
          >
            Dev Products
          </Button>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search products..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-secondary/30"
          />
        </div>
      </div>

      {/* Products Table */}
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Package className="w-5 h-5 text-primary" />
            Product Performance
          </CardTitle>
          <CardDescription>
            {sortedProducts.length} product{sortedProducts.length !== 1 ? "s" : ""} found
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">
                    <button
                      className="flex items-center gap-1 hover:text-foreground"
                      onClick={() => handleSort("name")}
                    >
                      Product <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                    <button
                      className="flex items-center gap-1 ml-auto hover:text-foreground"
                      onClick={() => handleSort("revenue")}
                    >
                      Revenue <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground hidden sm:table-cell">
                    <button
                      className="flex items-center gap-1 ml-auto hover:text-foreground"
                      onClick={() => handleSort("purchases")}
                    >
                      Purchases <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground hidden lg:table-cell">
                    Unique Buyers
                  </th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground hidden md:table-cell">
                    <button
                      className="flex items-center gap-1 ml-auto hover:text-foreground"
                      onClick={() => handleSort("conversion")}
                    >
                      Conv. Rate <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground hidden xl:table-cell">
                    <button
                      className="flex items-center gap-1 ml-auto hover:text-foreground"
                      onClick={() => handleSort("revenue_per_player")}
                    >
                      Rev/Buyer <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedProducts.map((product) => (
                  <tr
                    key={product.product_id}
                    className="border-b border-border/50 hover:bg-secondary/30 transition-colors"
                  >
                    <td className="py-3 px-4">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">{product.name}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full hidden sm:inline-block ${
                            product.product_type === "gamepass" 
                              ? "bg-primary/10 text-primary" 
                              : "bg-teal-500/10 text-teal-500"
                          }`}>
                            {product.product_type}
                          </span>
                        </div>
                        {product.badges.length > 0 && (
                          <div className="flex gap-1 flex-wrap">
                            {product.badges.map((badge) => (
                              <ProductBadge key={badge} badge={badge} />
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <RobuxValue amount={product.revenue} size="sm" />
                    </td>
                    <td className="py-3 px-4 text-right text-muted-foreground hidden sm:table-cell">
                      {product.purchases.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-right text-muted-foreground hidden lg:table-cell">
                      {product.unique_buyers.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-right hidden md:table-cell">
                      <span className={`font-medium ${
                        product.conversion_rate >= 15 
                          ? "text-green-500" 
                          : product.conversion_rate >= 5 
                            ? "text-yellow-500" 
                            : product.clicks > 0 ? "text-red-500" : "text-muted-foreground"
                      }`}>
                        {product.clicks > 0 ? `${product.conversion_rate.toFixed(1)}%` : "Needs tracking"}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right hidden xl:table-cell">
                      <RobuxValue amount={product.unique_buyers > 0 ? Math.round(product.revenue / product.unique_buyers) : 0} size="sm" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
