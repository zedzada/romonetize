-- Add Roblox metadata fields to games table for historical data storage
-- This allows storing data fetched from Roblox API

ALTER TABLE public.games 
ADD COLUMN IF NOT EXISTS universe_id text,
ADD COLUMN IF NOT EXISTS creator_name text,
ADD COLUMN IF NOT EXISTS creator_type text,
ADD COLUMN IF NOT EXISTS description text,
ADD COLUMN IF NOT EXISTS max_players integer,
ADD COLUMN IF NOT EXISTS genre text,
ADD COLUMN IF NOT EXISTS total_visits bigint DEFAULT 0,
ADD COLUMN IF NOT EXISTS favorites bigint DEFAULT 0,
ADD COLUMN IF NOT EXISTS likes bigint DEFAULT 0,
ADD COLUMN IF NOT EXISTS dislikes bigint DEFAULT 0,
ADD COLUMN IF NOT EXISTS current_players integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS thumbnail_url text,
ADD COLUMN IF NOT EXISTS last_roblox_sync timestamp with time zone,
ADD COLUMN IF NOT EXISTS roblox_sync_status text DEFAULT 'not_synced';

-- Add index for universe_id lookups
CREATE INDEX IF NOT EXISTS idx_games_universe_id ON public.games(universe_id);

-- Add comment explaining the sync status
COMMENT ON COLUMN public.games.roblox_sync_status IS 'Status of Roblox API sync: not_synced, syncing, synced, error';
