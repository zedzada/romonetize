-- Migration: Add group metadata columns to public.games
-- Run this in Supabase Dashboard > SQL Editor

-- Add is_selected column for tracking which game is currently active
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS is_selected boolean DEFAULT false;

-- Add source column to track if game is personal or from a group
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS source text DEFAULT 'user';

-- Add group metadata columns
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS group_id text NULL;
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS group_name text NULL;
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS root_place_id text NULL;
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS role_name text NULL;
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS role_rank integer NULL;

-- Create unique index to prevent duplicate game connections
CREATE UNIQUE INDEX IF NOT EXISTS games_user_roblox_game_unique 
ON public.games(user_id, roblox_game_id);

-- Verify columns were added
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_schema = 'public' AND table_name = 'games'
ORDER BY ordinal_position;
