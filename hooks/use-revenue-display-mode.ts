"use client";

import { useState, useEffect, useCallback, useSyncExternalStore } from "react";

export type RevenueDisplayMode = "gross" | "estimated";

const STORAGE_KEY = "romonetize_revenue_display_mode";
const DEFAULT_MODE: RevenueDisplayMode = "estimated";

// Server-side safe initial state
let serverMode: RevenueDisplayMode = DEFAULT_MODE;

// Listeners for cross-tab synchronization
const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): RevenueDisplayMode {
  if (typeof window === "undefined") {
    return serverMode;
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "gross" || stored === "estimated") {
      return stored;
    }
  } catch {
    // localStorage not available
  }
  return DEFAULT_MODE;
}

function getServerSnapshot(): RevenueDisplayMode {
  return serverMode;
}

/**
 * Shared revenue display mode hook with localStorage persistence.
 * 
 * This ensures all pages show the same revenue mode (gross or estimated)
 * and persists the user's preference across sessions.
 * 
 * Default: "estimated" (70% creator payout)
 */
export function useRevenueDisplayMode() {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  
  const setMode = useCallback((newMode: RevenueDisplayMode) => {
    if (typeof window === "undefined") {
      serverMode = newMode;
      return;
    }
    
    try {
      localStorage.setItem(STORAGE_KEY, newMode);
      // Trigger storage event for other tabs
      window.dispatchEvent(new StorageEvent("storage", {
        key: STORAGE_KEY,
        newValue: newMode,
      }));
    } catch {
      // localStorage not available
    }
    
    notifyListeners();
  }, []);
  
  // Listen for storage events from other tabs
  useEffect(() => {
    if (typeof window === "undefined") return;
    
    const handleStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) {
        notifyListeners();
      }
    };
    
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);
  
  return { mode, setMode };
}

/**
 * Get the label for the current revenue mode.
 */
export function getRevenueModeLabel(mode: RevenueDisplayMode): string {
  return mode === "gross" ? "Gross Sales" : "Est. Revenue";
}

/**
 * Get the short label for the current revenue mode.
 */
export function getRevenueModeShortLabel(mode: RevenueDisplayMode): string {
  return mode === "gross" ? "Gross" : "Est.";
}

/**
 * Get the description for the current revenue mode.
 */
export function getRevenueModeDescription(mode: RevenueDisplayMode): string {
  return mode === "gross"
    ? "Gross Sales matches Roblox dashboard values. Est. Revenue applies the 70% creator payout estimate."
    : "Est. Revenue shows your estimated payout (70%) after Roblox's 30% platform fee.";
}
