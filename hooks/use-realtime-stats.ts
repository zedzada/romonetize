"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type RealtimeStatus = "connecting" | "connected" | "disconnected" | "error";

interface UseRealtimeStatsOptions {
  gameIds: string[];
  onNewEvent: () => void;
  enabled?: boolean;
}

/**
 * Hook to subscribe to Supabase Realtime for events table changes
 * Falls back to polling if realtime connection fails
 * 
 * IMPORTANT: Channel must be setup with .on() BEFORE .subscribe()
 * Never call .on() after .subscribe() - this causes the error:
 * "cannot add `postgres_changes` callbacks after `subscribe()`"
 */
export function useRealtimeStats({
  gameIds,
  onNewEvent,
  enabled = true,
}: UseRealtimeStatsOptions) {
  const [status, setStatus] = useState<RealtimeStatus>("disconnected");
  const channelRef = useRef<RealtimeChannel | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const isSubscribingRef = useRef(false);

  // Stable game ID string for dependency tracking
  const gameIdKey = useMemo(() => gameIds.sort().join(","), [gameIds]);

  // Stable callback ref to avoid re-subscriptions
  const onNewEventRef = useRef(onNewEvent);
  useEffect(() => {
    onNewEventRef.current = onNewEvent;
  }, [onNewEvent]);

  // Start fallback polling (15 second intervals)
  const startPolling = useCallback(() => {
    if (pollingIntervalRef.current) return;
    
    pollingIntervalRef.current = setInterval(() => {
      onNewEventRef.current();
    }, 15000);
  }, []);

  // Stop fallback polling
  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  // Cleanup function
  const cleanup = useCallback(() => {
    try {
      if (channelRef.current) {
        const supabase = createClient();
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    } catch (err) {
      console.warn("[useRealtimeStats] Error during cleanup:", err);
    }
    stopPolling();
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    isSubscribingRef.current = false;
  }, [stopPolling]);

  // Effect to manage subscription lifecycle
  useEffect(() => {
    // Early exit conditions
    if (!enabled || gameIds.length === 0) {
      cleanup();
      setStatus("disconnected");
      return;
    }

    if (!isSupabaseConfigured) {
      setStatus("disconnected");
      startPolling();
      return;
    }

    // Prevent duplicate subscriptions
    if (isSubscribingRef.current) {
      return;
    }

    isSubscribingRef.current = true;
    setStatus("connecting");

    let isMounted = true;
    const supabase = createClient();

    // Clean up existing subscription before creating new one
    if (channelRef.current) {
      try {
        supabase.removeChannel(channelRef.current);
      } catch (err) {
        console.warn("[useRealtimeStats] Error removing old channel:", err);
      }
      channelRef.current = null;
    }

    // Create channel with stable unique name based on game IDs
    const channelName = `events-realtime-${gameIdKey}`;

    try {
      // CRITICAL: Setup .on() BEFORE .subscribe()
      // This is the correct order - never reverse this
      const channel = supabase
        .channel(channelName)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "events",
            filter: gameIds.length === 1 
              ? `game_id=eq.${gameIds[0]}`
              : undefined, // Can't filter multiple game_ids with realtime, we'll filter client-side
          },
          (payload) => {
            if (!isMounted) return;
            
            // Filter by game_id if we have multiple games
            if (gameIds.length > 1 && !gameIds.includes(payload.new.game_id)) {
              return;
            }
            
            // Trigger stats refresh
            onNewEventRef.current();
          }
        )
        .subscribe((subscribeStatus) => {
          if (!isMounted) return;
          
          if (subscribeStatus === "SUBSCRIBED") {
            setStatus("connected");
            stopPolling();
            reconnectAttemptsRef.current = 0;
          } else if (subscribeStatus === "CHANNEL_ERROR" || subscribeStatus === "TIMED_OUT") {
            setStatus("error");
            // Fall back to polling
            startPolling();
            
            // Attempt reconnection with exponential backoff (max 30s)
            const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
            reconnectAttemptsRef.current += 1;
            
            // Don't reconnect indefinitely - stop after 5 attempts
            if (reconnectAttemptsRef.current <= 5) {
              reconnectTimeoutRef.current = setTimeout(() => {
                if (isMounted) {
                  isSubscribingRef.current = false;
                  // Trigger re-render to retry subscription
                  setStatus("connecting");
                }
              }, delay);
            }
          } else if (subscribeStatus === "CLOSED") {
            setStatus("disconnected");
            startPolling();
          }
        });

      channelRef.current = channel;
    } catch (err) {
      // Catch any errors during channel setup to prevent crashes
      console.error("[useRealtimeStats] Error setting up realtime channel:", err);
      setStatus("error");
      startPolling();
      isSubscribingRef.current = false;
    }

    return () => {
      isMounted = false;
      cleanup();
    };
  }, [gameIdKey, enabled, cleanup, startPolling, stopPolling, gameIds]);

  // Manual reconnect function
  const reconnect = useCallback(() => {
    cleanup();
    reconnectAttemptsRef.current = 0;
    isSubscribingRef.current = false;
    // Trigger re-subscription by changing status
    setStatus("connecting");
  }, [cleanup]);

  return {
    status,
    reconnect,
    isLive: status === "connected",
  };
}
