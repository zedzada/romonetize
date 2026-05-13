-- Migration: Fix ccu_snapshots table schema
-- Adds missing columns for proper CCU tracking

-- Add missing columns (safe - only adds if not exists)
DO $$
BEGIN
  -- Add user_id column if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'ccu_snapshots' 
    AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.ccu_snapshots ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
  
  -- Add roblox_game_id column if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'ccu_snapshots' 
    AND column_name = 'roblox_game_id'
  ) THEN
    ALTER TABLE public.ccu_snapshots ADD COLUMN roblox_game_id text;
  END IF;
  
  -- Add captured_at column if missing (prefer this over created_at for explicit capture time)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'ccu_snapshots' 
    AND column_name = 'captured_at'
  ) THEN
    ALTER TABLE public.ccu_snapshots ADD COLUMN captured_at timestamptz NOT NULL DEFAULT now();
    -- Backfill captured_at from created_at if it exists
    UPDATE public.ccu_snapshots SET captured_at = created_at WHERE captured_at IS NULL AND created_at IS NOT NULL;
  END IF;
  
  -- Add source column if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'ccu_snapshots' 
    AND column_name = 'source'
  ) THEN
    ALTER TABLE public.ccu_snapshots ADD COLUMN source text DEFAULT 'roblox_api';
  END IF;
END $$;

-- Backfill user_id from games table where missing
UPDATE public.ccu_snapshots cs
SET user_id = g.user_id
FROM public.games g
WHERE cs.game_id = g.id AND cs.user_id IS NULL;

-- Backfill roblox_game_id from games table where missing
UPDATE public.ccu_snapshots cs
SET roblox_game_id = g.roblox_game_id
FROM public.games g
WHERE cs.game_id = g.id AND cs.roblox_game_id IS NULL;

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_ccu_snapshots_game_captured
ON public.ccu_snapshots(game_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_ccu_snapshots_user_game_captured
ON public.ccu_snapshots(user_id, game_id, captured_at DESC);

-- Drop old RLS policies if they exist and recreate properly
DO $$
BEGIN
  -- Drop old policies
  DROP POLICY IF EXISTS "Users can view ccu_snapshots for their games" ON public.ccu_snapshots;
  DROP POLICY IF EXISTS "Service role can delete ccu_snapshots" ON public.ccu_snapshots;
  DROP POLICY IF EXISTS "Service role can insert ccu_snapshots" ON public.ccu_snapshots;
  DROP POLICY IF EXISTS "Users can read own ccu snapshots" ON public.ccu_snapshots;
  DROP POLICY IF EXISTS "Users can insert own ccu snapshots" ON public.ccu_snapshots;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

-- Enable RLS
ALTER TABLE public.ccu_snapshots ENABLE ROW LEVEL SECURITY;

-- Users can read their own snapshots (via user_id or via game ownership)
CREATE POLICY "Users can read own ccu snapshots"
ON public.ccu_snapshots
FOR SELECT
USING (
  auth.uid() = user_id 
  OR game_id IN (SELECT id FROM public.games WHERE user_id = auth.uid())
);

-- Users can insert their own snapshots
CREATE POLICY "Users can insert own ccu snapshots"
ON public.ccu_snapshots
FOR INSERT
WITH CHECK (
  auth.uid() = user_id 
  OR game_id IN (SELECT id FROM public.games WHERE user_id = auth.uid())
);

-- Service role can do anything (for cron jobs and server-side inserts)
CREATE POLICY "Service role can manage ccu snapshots"
ON public.ccu_snapshots
FOR ALL
USING (auth.jwt()->>'role' = 'service_role')
WITH CHECK (auth.jwt()->>'role' = 'service_role');
