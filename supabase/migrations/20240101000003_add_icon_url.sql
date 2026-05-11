-- Add icon_url column to games table
-- This replaces the previous thumbnail_url column

ALTER TABLE public.games
ADD COLUMN IF NOT EXISTS icon_url text;

-- Add comment for documentation
COMMENT ON COLUMN public.games.icon_url IS 'URL to the game icon/thumbnail from Roblox';
