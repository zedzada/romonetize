"use client";

import { useCallback, useMemo } from "react";
import { useAnalytics, type DateRange } from "./use-analytics";
import { useRevenueDisplayMode, type RevenueDisplayMode } from "./use-revenue-display-mode";

// Roblox takes 30%, creators get 70%
export const CREATOR_REVENUE_RATE = 0.7;

// Range definitions used across all monetization pages
export type MonetizationRange = "1h" | "6h" | "24h" | "72h" | "7d" | "28d" | "90d";

// Map monetization range to analytics API range
export function toAnalyticsRange(range: MonetizationRange): DateRange {
  switch (range) {
    case "1h":
    case "6h":
    case "24h":
      return "1d";
    case "72h":
    case "7d":
      return "7d";
    case "28d":
      return "30d";
    case "90d":
      return "90d";
    default:
      return "7d";
  }
}

// Unified monetization metrics interface
export interface UnifiedMonetizationMetrics {
  // Revenue values (based on selected display mode)
  grossRevenue: number;
  estimatedRevenue: number;
  selectedRevenue: number;
  
  // 72h revenue (based on selected display mode)
  grossRevenue72h: number;
  estimatedRevenue72h: number;
  selectedRevenue72h: number;
  
  // Revenue by product type (based on selected display mode)
  grossGamepassRevenue: number;
  estimatedGamepassRevenue: number;
  selectedGamepassRevenue: number;
  
  grossDevProductRevenue: number;
  estimatedDevProductRevenue: number;
  selectedDevProductRevenue: number;
  
  // Per-user metrics (based on selected display mode)
  grossArppu: number;
  estimatedArppu: number;
  selectedArppu: number;
  
  grossArpdau: number;
  estimatedArpdau: number;
  selectedArpdau: number;
  
  // Non-revenue metrics (same regardless of mode)
  purchases: number;
  payingUsers: number;
  conversionRate: number | null;
  purchaseRate: number | null;
  averageDau: number;
  
  // Display mode
  revenueMode: RevenueDisplayMode;
  setRevenueMode: (mode: RevenueDisplayMode) => void;
  
  // Range info
  rangeStart: string | null;
  rangeEnd: string | null;
  
  // Selected game info
  selectedGameId: string | null;
  selectedGameName: string | null;
  
  // Data state
  hasTrackerData: boolean;
  monetizationLocked: boolean;
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  
  // Refresh function
  refresh: () => Promise<void>;
}

// Product with unified metrics
export interface UnifiedProduct {
  id: string;
  name: string;
  productType: string;
  priceRobux: number;
  
  // Revenue (based on selected display mode)
  grossRevenue: number;
  estimatedRevenue: number;
  selectedRevenue: number;
  
  // Per-buyer revenue
  grossRevenuePerBuyer: number;
  estimatedRevenuePerBuyer: number;
  selectedRevenuePerBuyer: number;
  
  // Non-revenue metrics
  purchases: number;
  buyers: number;
  clicks: number;
  conversionRate: number | null;
}

interface UseMonetizationOptions {
  enabled?: boolean;
  range?: MonetizationRange;
}

/**
 * Unified monetization hook that provides consistent metrics across all pages.
 * 
 * Key guarantees:
 * 1. Same selected game filter everywhere
 * 2. Same date range calculations everywhere
 * 3. Same revenue mode (gross/estimated) consistency
 * 4. Same ARPPU/ARPDAU formulas everywhere
 */
export function useMonetization(options: UseMonetizationOptions = {}) {
  const { enabled = true, range = "72h" } = options;
  
  // Get shared revenue display mode (persisted to localStorage)
  const { mode: revenueMode, setMode: setRevenueMode } = useRevenueDisplayMode();
  
  // Get analytics data from the central hook
  const analyticsRange = toAnalyticsRange(range);
  const {
    isLoading,
    isRefreshing,
    error,
    selectedGameId,
    selectedGameName,
    revenueStats,
    productStats,
    productAnalytics,
    monetizationCharts,
    trackerStats,
    hasTrackerData,
    monetizationLocked,
    refresh,
  } = useAnalytics({ enabled, range: analyticsRange });
  
  // Calculate unified metrics
  const metrics: UnifiedMonetizationMetrics = useMemo(() => {
    // Safe defaults for revenue stats
    const safe = {
      grossRevenue: revenueStats?.grossRevenue ?? 0,
      grossRevenue72h: revenueStats?.grossRevenue72h ?? 0,
      grossArppu: revenueStats?.grossArppu ?? 0,
      grossArpdau: revenueStats?.grossArpdau ?? 0,
      estimatedRevenue: revenueStats?.estimatedRevenue ?? 0,
      estimatedRevenue72h: revenueStats?.estimatedRevenue72h ?? 0,
      estimatedArppu: revenueStats?.estimatedArppu ?? 0,
      estimatedArpdau: revenueStats?.estimatedArpdau ?? 0,
      totalPurchases: revenueStats?.totalPurchases ?? 0,
      payingUsers: revenueStats?.payingUsers ?? 0,
      conversionRate: revenueStats?.conversionRate ?? null,
      gamepassRevenue: revenueStats?.gamepassRevenue ?? 0,
      devproductRevenue: revenueStats?.devproductRevenue ?? 0,
      averageDau: (revenueStats as unknown as { averageDau?: number })?.averageDau ?? 0,
    };
    
    // Calculate estimated values for product type breakdowns
    const estimatedGamepassRevenue = Math.round(safe.gamepassRevenue * CREATOR_REVENUE_RATE);
    const estimatedDevProductRevenue = Math.round(safe.devproductRevenue * CREATOR_REVENUE_RATE);
    
    // Calculate selected values based on mode
    const isGross = revenueMode === "gross";
    
    return {
      // Revenue
      grossRevenue: safe.grossRevenue,
      estimatedRevenue: safe.estimatedRevenue,
      selectedRevenue: isGross ? safe.grossRevenue : safe.estimatedRevenue,
      
      // 72h revenue
      grossRevenue72h: safe.grossRevenue72h,
      estimatedRevenue72h: safe.estimatedRevenue72h,
      selectedRevenue72h: isGross ? safe.grossRevenue72h : safe.estimatedRevenue72h,
      
      // Gamepass revenue
      grossGamepassRevenue: safe.gamepassRevenue,
      estimatedGamepassRevenue,
      selectedGamepassRevenue: isGross ? safe.gamepassRevenue : estimatedGamepassRevenue,
      
      // Dev product revenue
      grossDevProductRevenue: safe.devproductRevenue,
      estimatedDevProductRevenue,
      selectedDevProductRevenue: isGross ? safe.devproductRevenue : estimatedDevProductRevenue,
      
      // ARPPU
      grossArppu: safe.grossArppu,
      estimatedArppu: safe.estimatedArppu,
      selectedArppu: isGross ? safe.grossArppu : safe.estimatedArppu,
      
      // ARPDAU
      grossArpdau: safe.grossArpdau,
      estimatedArpdau: safe.estimatedArpdau,
      selectedArpdau: isGross ? safe.grossArpdau : safe.estimatedArpdau,
      
      // Non-revenue metrics
      purchases: safe.totalPurchases,
      payingUsers: safe.payingUsers,
      conversionRate: safe.conversionRate,
      purchaseRate: null, // TODO: add if needed
      averageDau: safe.averageDau,
      
      // Display mode
      revenueMode,
      setRevenueMode,
      
      // Range info
      rangeStart: trackerStats?.rangeStart ?? null,
      rangeEnd: trackerStats?.rangeEnd ?? null,
      
      // Selected game info
      selectedGameId,
      selectedGameName,
      
      // Data state
      hasTrackerData,
      monetizationLocked,
      isLoading,
      isRefreshing,
      error: error || null,
      
      // Refresh
      refresh,
    };
  }, [
    revenueStats,
    revenueMode,
    setRevenueMode,
    trackerStats,
    selectedGameId,
    selectedGameName,
    hasTrackerData,
    monetizationLocked,
    isLoading,
    isRefreshing,
    error,
    refresh,
  ]);
  
  // Calculate unified products
  const products: UnifiedProduct[] = useMemo(() => {
    const sourceProducts = productAnalytics?.products ?? productStats?.products ?? [];
    const isGross = revenueMode === "gross";
    
    return sourceProducts.map((p: {
      productId?: string;
      id?: string;
      productName?: string;
      name?: string;
      productType?: string;
      type?: string;
      priceRobux?: number;
      grossRevenue?: number;
      revenue?: number;
      grossRevenuePerBuyer?: number;
      revenuePerBuyer?: number;
      revPerBuyer?: number;
      estimatedRevenue?: number;
      estimatedRevenuePerBuyer?: number;
      purchases?: number;
      buyers?: number;
      uniqueBuyers?: number;
      clicks?: number;
      conversionRate?: number | null;
    }) => {
      const grossRevenue = p.grossRevenue ?? p.revenue ?? 0;
      const estimatedRevenue = p.estimatedRevenue ?? Math.round(grossRevenue * CREATOR_REVENUE_RATE);
      const buyers = p.buyers ?? p.uniqueBuyers ?? 0;
      const grossRevenuePerBuyer = p.grossRevenuePerBuyer ?? p.revenuePerBuyer ?? p.revPerBuyer ?? 
        (buyers > 0 ? grossRevenue / buyers : 0);
      const estimatedRevenuePerBuyer = p.estimatedRevenuePerBuyer ?? 
        (buyers > 0 ? estimatedRevenue / buyers : 0);
      
      return {
        id: p.productId ?? p.id ?? "",
        name: p.productName ?? p.name ?? "Unknown Product",
        productType: p.productType ?? p.type ?? "unknown",
        priceRobux: p.priceRobux ?? 0,
        
        grossRevenue,
        estimatedRevenue,
        selectedRevenue: isGross ? grossRevenue : estimatedRevenue,
        
        grossRevenuePerBuyer,
        estimatedRevenuePerBuyer,
        selectedRevenuePerBuyer: isGross ? grossRevenuePerBuyer : estimatedRevenuePerBuyer,
        
        purchases: p.purchases ?? 0,
        buyers,
        clicks: p.clicks ?? 0,
        conversionRate: p.conversionRate ?? null,
      };
    });
  }, [productAnalytics, productStats, revenueMode]);
  
  // Calculate totals from products for consistency check
  const productTotals = useMemo(() => {
    return products.reduce(
      (acc, p) => ({
        grossRevenue: acc.grossRevenue + p.grossRevenue,
        estimatedRevenue: acc.estimatedRevenue + p.estimatedRevenue,
        selectedRevenue: acc.selectedRevenue + p.selectedRevenue,
        purchases: acc.purchases + p.purchases,
        buyers: acc.buyers + p.buyers,
      }),
      { grossRevenue: 0, estimatedRevenue: 0, selectedRevenue: 0, purchases: 0, buyers: 0 }
    );
  }, [products]);
  
  // Get chart data (already filtered by range and game)
  const chartData = useMemo(() => {
    const hourlyData = monetizationCharts?.hourlyMonetization ?? [];
    const minuteData = monetizationCharts?.minuteMonetization ?? [];
    const isGross = revenueMode === "gross";
    const multiplier = isGross ? 1 : CREATOR_REVENUE_RATE;
    
    // Process and apply revenue mode
    const processPoint = (point: {
      time: string;
      totalRevenue: number;
      devproductRevenue: number;
      gamepassRevenue: number;
      purchases: number;
    }) => ({
      time: point.time,
      totalRevenue: Math.round(Number(point.totalRevenue ?? 0) * multiplier),
      devproductRevenue: Math.round(Number(point.devproductRevenue ?? 0) * multiplier),
      gamepassRevenue: Math.round(Number(point.gamepassRevenue ?? 0) * multiplier),
      purchases: Number(point.purchases ?? 0),
    });
    
    return {
      hourly: hourlyData.map(processPoint),
      minute: minuteData.map(processPoint),
    };
  }, [monetizationCharts, revenueMode]);
  
  // Revenue by product type for pie charts
  const revenueByType = useMemo(() => {
    const isGross = revenueMode === "gross";
    return [
      {
        type: "Gamepasses",
        revenue: isGross ? metrics.grossGamepassRevenue : metrics.estimatedGamepassRevenue,
      },
      {
        type: "Dev Products",
        revenue: isGross ? metrics.grossDevProductRevenue : metrics.estimatedDevProductRevenue,
      },
    ].filter((item) => item.revenue > 0);
  }, [metrics, revenueMode]);
  
  // Label based on mode
  const revenueLabel = revenueMode === "gross" ? "Gross Sales" : "Est. Revenue";
  const shortLabel = revenueMode === "gross" ? "Gross" : "Est.";
  
  return {
    // Unified metrics
    metrics,
    
    // Products with unified revenue
    products,
    productTotals,
    
    // Chart data
    chartData,
    
    // Revenue breakdown
    revenueByType,
    
    // Labels
    revenueLabel,
    shortLabel,
    
    // Convenience aliases
    isLoading,
    isRefreshing,
    error,
    hasTrackerData,
    monetizationLocked,
    selectedGameId,
    selectedGameName,
    revenueMode,
    setRevenueMode,
    refresh,
  };
}
