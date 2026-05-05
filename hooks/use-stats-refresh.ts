"use client";

import { useEffect, useCallback } from "react";

const STATS_REFRESH_EVENT = "romonetize:stats-refresh";

/**
 * Hook to listen for global stats refresh events
 * Call the callback whenever stats should be refreshed (e.g., after test event)
 */
export function useStatsRefresh(callback: () => void) {
  useEffect(() => {
    const handleRefresh = () => {
      callback();
    };

    window.addEventListener(STATS_REFRESH_EVENT, handleRefresh);
    return () => {
      window.removeEventListener(STATS_REFRESH_EVENT, handleRefresh);
    };
  }, [callback]);
}

/**
 * Trigger a global stats refresh across all listening components
 */
export function triggerStatsRefresh() {
  window.dispatchEvent(new CustomEvent(STATS_REFRESH_EVENT));
}
