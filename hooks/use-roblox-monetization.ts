"use client";

import useSWR from "swr";

interface RobloxProduct {
  id: string;
  name: string;
  type: "gamepass" | "devproduct";
  price: number;
  isForSale: boolean;
  iconImageAssetId?: number;
  description?: string;
}

interface RobloxTransaction {
  id: string;
  created: string;
  isPending: boolean;
  agent: {
    id: number;
    type: string;
    name: string;
  };
  details?: {
    id?: number;
    name?: string;
    place?: {
      placeId: number;
      universeId: number;
      name: string;
    };
  };
  currency: {
    amount: number;
    type: string;
  };
}

interface MonetizationData {
  products: RobloxProduct[];
  transactions: RobloxTransaction[];
  totalRevenue: number;
  gamepassRevenue: number;
  devproductRevenue: number;
}

interface RobloxMonetizationResponse {
  success: boolean;
  data: MonetizationData;
  productsByGame: Record<string, RobloxProduct[]>;
  robloxUserId: string;
  error?: string;
  needsConnection?: boolean;
  needsReconnection?: boolean;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const data = await res.json();
  
  if (!res.ok) {
    const error = new Error(data.error || "Failed to fetch Roblox data");
    (error as Error & { info?: typeof data; status?: number }).info = data;
    (error as Error & { status?: number }).status = res.status;
    throw error;
  }
  
  return data;
};

export function useRobloxMonetization() {
  const { data, error, isLoading, mutate } = useSWR<RobloxMonetizationResponse>(
    "/api/roblox/monetization",
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 60000, // Cache for 1 minute
      errorRetryCount: 2,
    }
  );

  return {
    monetizationData: data?.data || null,
    productsByGame: data?.productsByGame || {},
    robloxUserId: data?.robloxUserId || null,
    isLoading,
    error: error?.message || data?.error || null,
    needsConnection: data?.needsConnection || (error as Error & { info?: { needsConnection?: boolean } })?.info?.needsConnection,
    needsReconnection: data?.needsReconnection || (error as Error & { info?: { needsReconnection?: boolean } })?.info?.needsReconnection,
    refresh: () => mutate(),
  };
}

// Products-specific hook
interface RobloxProductDetails {
  id: string;
  name: string;
  description?: string;
  type: "gamepass" | "devproduct";
  price: number;
  isForSale: boolean;
  iconImageAssetId?: number;
  thumbnailUrl?: string;
  created?: string;
  updated?: string;
  gameId: string;
  gameName: string;
  universeId: string;
}

interface RobloxProductsResponse {
  success: boolean;
  products: RobloxProductDetails[];
  productsByGame: Record<string, RobloxProductDetails[]>;
  summary: {
    totalProducts: number;
    totalGamepasses: number;
    totalDevProducts: number;
    activeProducts: number;
    avgGamepassPrice: number;
    avgDevProductPrice: number;
  };
  robloxUserId: string;
  error?: string;
  needsConnection?: boolean;
  needsReconnection?: boolean;
}

export function useRobloxProducts() {
  const { data, error, isLoading, mutate } = useSWR<RobloxProductsResponse>(
    "/api/roblox/products",
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 60000,
      errorRetryCount: 2,
    }
  );

  return {
    products: data?.products || [],
    productsByGame: data?.productsByGame || {},
    summary: data?.summary || null,
    robloxUserId: data?.robloxUserId || null,
    isLoading,
    error: error?.message || data?.error || null,
    needsConnection: data?.needsConnection || (error as Error & { info?: { needsConnection?: boolean } })?.info?.needsConnection,
    needsReconnection: data?.needsReconnection || (error as Error & { info?: { needsReconnection?: boolean } })?.info?.needsReconnection,
    refresh: () => mutate(),
  };
}
