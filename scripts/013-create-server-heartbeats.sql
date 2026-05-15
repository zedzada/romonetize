-- Migration: Create server_heartbeats table for multi-server CCU tracking
-- This table tracks individual Roblox server heartbeats for accurate total CCU calculation

-- Create server_heartbeats table
CREATE TABLE IF NOT EXISTS public.server_heartbeats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  server_id text NOT NULL,  -- Roblox JobId
  place_id text,            -- Roblox PlaceId
  universe_id text,         -- Roblox GameId/UniverseId
  ccu integer NOT NULL DEFAULT 0,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  
  -- Unique constraint: one row per game+server combination
  UNIQUE(game_id, server_id)
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_server_heartbeats_game_last_seen
ON public.server_heartbeats(game_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_server_heartbeats_user_game
ON public.server_heartbeats(user_id, game_id);

-- Enable RLS
ALTER TABLE public.server_heartbeats ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can read their own server heartbeats
CREATE POLICY "Users can read own server heartbeats"
ON public.server_heartbeats
FOR SELECT
USING (
  auth.uid() = user_id
  OR game_id IN (SELECT id FROM public.games WHERE user_id = auth.uid())
);

-- Service role can do anything (for API endpoints)
CREATE POLICY "Service role can manage server heartbeats"
ON public.server_heartbeats
FOR ALL
USING (auth.jwt()->>'role' = 'service_role')
WITH CHECK (auth.jwt()->>'role' = 'service_role');

-- Add source column to ccu_snapshots if not exists (for tracker vs API distinction)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'ccu_snapshots' 
    AND column_name = 'source'
  ) THEN
    ALTER TABLE public.ccu_snapshots ADD COLUMN source text DEFAULT 'roblox_api';
  END IF;

  -- Add server_id column to ccu_snapshots if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'ccu_snapshots' 
    AND column_name = 'server_id'
  ) THEN
    ALTER TABLE public.ccu_snapshots ADD COLUMN server_id text;
  END IF;
END $$;
