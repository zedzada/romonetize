"use client";

import useSWR from "swr";
import { useCallback, useEffect } from "react";

interface CreditBalance {
  monthlyCredits: number;
  extraCredits: number;
  totalCredits: number;
  monthlyCreditsResetAt: string | null;
}

interface CreditPackage {
  id: string;
  credits: number;
  price: number;
  priceFormatted: string;
}

const fetcher = async (url: string) => {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch");
  return res.json();
};

export function useCredits() {
  const { data, error, isLoading, mutate } = useSWR<CreditBalance>(
    "/api/credits/balance",
    fetcher,
    {
      refreshInterval: 0, // Don't auto-refresh
      revalidateOnFocus: true,
      dedupingInterval: 1000,
    }
  );

  // Listen for credits-updated event to refresh
  useEffect(() => {
    const handleCreditsUpdated = () => {
      mutate();
    };

    window.addEventListener("credits-updated", handleCreditsUpdated);
    return () => {
      window.removeEventListener("credits-updated", handleCreditsUpdated);
    };
  }, [mutate]);

  const refresh = useCallback(() => {
    mutate();
    // Dispatch event so other components can update
    window.dispatchEvent(new CustomEvent("credits-updated"));
  }, [mutate]);

  const consumeCredits = useCallback(async (type: "text" | "image" | "textImage") => {
    try {
      const res = await fetch("/api/credits/consume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });

      const result = await res.json();

      if (!res.ok) {
        return { success: false, error: result.error, ...result };
      }

      // Refresh balance after consumption
      refresh();
      return { success: true, ...result };
    } catch (error) {
      return { success: false, error: "Failed to consume credits" };
    }
  }, [refresh]);

  const refundCredits = useCallback(async (type: "text" | "image" | "textImage", reason?: string) => {
    try {
      const res = await fetch("/api/credits/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, reason }),
      });

      const result = await res.json();

      if (!res.ok) {
        return { success: false, error: result.error };
      }

      // Refresh balance after refund
      refresh();
      return { success: true, ...result };
    } catch (error) {
      return { success: false, error: "Failed to refund credits" };
    }
  }, [refresh]);

  return {
    balance: data,
    monthlyCredits: data?.monthlyCredits || 0,
    extraCredits: data?.extraCredits || 0,
    totalCredits: data?.totalCredits || 0,
    isLoading,
    error,
    refresh,
    consumeCredits,
    refundCredits,
  };
}

export function useCreditPackages() {
  const { data, error, isLoading } = useSWR<{ packages: CreditPackage[] }>(
    "/api/credits/purchase",
    fetcher
  );

  const purchaseCredits = useCallback(async (packageId: string) => {
    try {
      const res = await fetch("/api/credits/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageId }),
      });

      const result = await res.json();

      if (!res.ok) {
        return { success: false, error: result.error };
      }

      // Redirect to checkout
      if (result.url) {
        window.location.href = result.url;
      }

      return { success: true, url: result.url };
    } catch (error) {
      return { success: false, error: "Failed to start purchase" };
    }
  }, []);

  return {
    packages: data?.packages || [],
    isLoading,
    error,
    purchaseCredits,
  };
}
