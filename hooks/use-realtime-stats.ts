"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
    if (channelRef.current) {
      const supabase = createClient();
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    stopPolling();
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, [stopPolling]);

  // Subscribe to realtime events
  const subscribe = useCallback(() => {
    if (!isSupabaseConfigured || gameIds.length === 0 || !enabled) {
      setStatus("disconnected");
      startPolling();
      return;
    }

    setStatus("connecting");
    const supabase = createClient();

    // Clean up existing subscription
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    // Create channel with unique name
    const channelName = `events-realtime-${Date.now()}`;
    
    // Subscribe to INSERT events on public.events table for user's games
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
          // Filter by game_id if we have multiple games
          if (gameIds.length > 1 && !gameIds.includes(payload.new.game_id)) {
            return;
          }
          
          // Trigger stats refresh
          onNewEventRef.current();
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setStatus("connected");
          stopPolling();
          reconnectAttemptsRef.current = 0;
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setStatus("error");
          // Fall back to polling
          startPolling();
          
          // Attempt reconnection with exponential backoff
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
          reconnectAttemptsRef.current += 1;
          
          reconnectTimeoutRef.current = setTimeout(() => {
            subscribe();
          }, delay);
        } else if (status === "CLOSED") {
          setStatus("disconnected");
          startPolling();
        }
      });

    channelRef.current = channel;
  }, [gameIds, enabled, startPolling, stopPolling]);

  // Effect to manage subscription lifecycle
  useEffect(() => {
    if (!enabled || gameIds.length === 0) {
      cleanup();
      setStatus("disconnected");
      return;
    }

    subscribe();

    return () => {
      cleanup();
    };
  }, [gameIds.join(","), enabled, subscribe, cleanup]);

  // Manual reconnect function
  const reconnect = useCallback(() => {
    cleanup();
    reconnectAttemptsRef.current = 0;
    subscribe();
  }, [cleanup, subscribe]);

  return {
    status,
    reconnect,
    isLive: status === "connected",
  };
}
