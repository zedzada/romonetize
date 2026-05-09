"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Package,
  Search,
  AlertCircle,
  RefreshCw,
  Trophy,
  Flame,
  AlertTriangle,
  Users,
  DollarSign,
  Radio,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getProductStats, type ProductStats } from "@/lib/actions/products";
import { RobuxValue } from "@/components/ui/robux-icon";
import { useStatsRefresh } from "@/hooks/use-stats-refresh";
import { useRealtimeStats } from "@/hooks/use-realtime-stats";
import { getUserGameIds } from "@/lib/actions/analytics";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PlanLock } from "@/components/dashboard/plan-lock";
import { createClient } from "@/lib/supabase/client";
import { DataStatusBanner } from "@/components/dashboard/data-status-banner";
import { useAnalytics } from "@/hooks/use-analytics";
import { ErrorBoundary } from "@/components/ui/error-boundary";

type SortField = "name" | "revenue" | "purchases";
type SortOrder = "asc" | "desc";

// Safe number formatter
function safeNumber(value: unknown): number {
  if (typeof value === "number" && !isNaN(value)) return value;
  return 0;
}

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
  const [userPlan, setUserPlan] = useState<string>("free");
  const [planLoading, setPlanLoading] = useState(true);

  // Get dataHealth for banner - safe access
  const { dataHealth, refresh: refreshAnalytics } = useAnalytics({ enabled: gameIds.length > 0 });

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPlanLoading(true);
    
    try {
      // Check user plan
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("plan")
          .eq("id", user.id)
          .single();
        setUserPlan(profile?.plan || "free");
      }
      setPlanLoading(false);
      
      const [productsResult, gameIdsResult] = await Promise.all([
        getProductStats(),
        getUserGameIds(),
      ]);
      
      if (productsResult.error) {
        setError(productsResult.error);
      } else {
        // Safe array access
        const safeProducts = Array.isArray(productsResult.products) ? productsResult.products : [];
        setProducts(safeProducts);
      }
      
      if (!gameIdsResult.error && Array.isArray(gameIdsResult.gameIds)) {
        setGameIds(gameIdsResult.gameIds);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load products");
      setPlanLoading(false);
    }
    
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // Listen for global stats refresh
  useStatsRefresh(fetchProducts);

  // Setup Supabase Realtime subscription
  const { isLive, status: realtimeStatus } = useRealtimeStats({
    gameIds,
    onNewEvent: fetchProducts,
    enabled: gameIds.length > 0,
  });

  const handleRefresh = async () => {
    await Promise.all([fetchProducts(), refreshAnalytics()]);
  };

  // Safe filter and sort
  const safeProducts = Array.isArray(products) ? products : [];
  
  const filteredProducts = safeProducts
    .filter((p) => {
      if (!p) return false;
      if (activeTab === "gamepass") return p.product_type === "gamepass";
      if (activeTab === "devproduct") return p.product_type === "devproduct";
      return true;
    })
    .filter((p) => {
      if (!p || !p.name) return false;
      return p.name.toLowerCase().includes(searchQuery.toLowerCase());
    });

  // Sort products
  const sortedProducts = [...filteredProducts].sort((a, b) => {
    if (!a || !b) return 0;
    
    let aVal: number | string = 0;
    let bVal: number | string = 0;

    switch (sortField) {
      case "name":
        aVal = (a.name || "").toLowerCase();
        bVal = (b.name || "").toLowerCase();
        break;
      case "revenue":
        aVal = safeNumber(a.revenue);
        bVal = safeNumber(b.revenue);
        break;
      case "purchases":
        aVal = safeNumber(a.purchases);
        bVal = safeNumber(b.purchases);
        break;
      default:
        aVal = safeNumber(a.revenue);
        bVal = safeNumber(b.revenue);
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

  // Calculate summary stats safely
  const totalRevenue = safeProducts.reduce((sum, p) => sum + safeNumber(p?.revenue), 0);
  const totalPurchases = safeProducts.reduce((sum, p) => sum + safeNumber(p?.purchases), 0);
  const totalUniqueBuyers = safeProducts.reduce((sum, p) => sum + safeNumber(p?.unique_buyers), 0);

  if (loading || planLoading) {
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

  // Plan lock for free users
  if (userPlan === "free") {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Products</h1>
          <p className="text-muted-foreground">Analyze performance of all your gamepasses and developer products</p>
        </div>
        <PlanLock 
          feature="Product Analytics" 
          description="Track product performance, conversion rates, and revenue per product. Available on Pro and Studio plans."
        />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Products</h1>
          <p className="text-muted-foreground">Analyze performance of all your gamepasses and developer products</p>
        </div>
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center justify-center py-8">
              <AlertCircle className="w-12 h-12 text-destructive mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">Unable to load products</h3>
              <p className="text-sm text-muted-foreground mb-4">{error}</p>
              <Button variant="outline" onClick={handleRefresh}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Empty state
  if (safeProducts.length === 0) {
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

  return (
    <ErrorBoundary fallbackTitle="Unable to load Products">
      <div className="space-y-6">
        {/* Data Status Banner - safe with null check */}
        {dataHealth && (
          <DataStatusBanner 
            dataHealth={dataHealth} 
            onSync={handleRefresh} 
          />
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
          <Button variant="outline" onClick={handleRefresh} className="gap-2">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
        </div>

        {/* Summary Stats */}
        <div className="grid gap-4 grid-cols-2 md:grid-cols-3">
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
        </div>

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
              {sortedProducts.length} product{sortedProducts.length !== 1 ? "s" : ""} tracked
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th 
                      className="text-left py-3 px-4 text-sm font-medium text-muted-foreground cursor-pointer hover:text-foreground"
                      onClick={() => handleSort("name")}
                    >
                      Product {sortField === "name" && (sortOrder === "asc" ? "↑" : "↓")}
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Type</th>
                    <th 
                      className="text-right py-3 px-4 text-sm font-medium text-muted-foreground cursor-pointer hover:text-foreground"
                      onClick={() => handleSort("revenue")}
                    >
                      Revenue {sortField === "revenue" && (sortOrder === "asc" ? "↑" : "↓")}
                    </th>
                    <th 
                      className="text-right py-3 px-4 text-sm font-medium text-muted-foreground cursor-pointer hover:text-foreground"
                      onClick={() => handleSort("purchases")}
                    >
                      Purchases {sortField === "purchases" && (sortOrder === "asc" ? "↑" : "↓")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedProducts.map((product) => (
                    <tr key={product.product_id} className="border-b border-border/50 hover:bg-secondary/20">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">{product.name || "Unknown"}</span>
                          {Array.isArray(product.badges) && product.badges.map((badge) => (
                            <ProductBadge key={badge} badge={badge} />
                          ))}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant="outline" className="capitalize">
                          {product.product_type || "unknown"}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <RobuxValue amount={safeNumber(product.revenue)} size="sm" />
                      </td>
                      <td className="py-3 px-4 text-right text-foreground">
                        {safeNumber(product.purchases).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </ErrorBoundary>
  );
}
