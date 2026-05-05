-- Add Roblox Open Cloud API key column to games table
-- This allows users to store their own Roblox API key per game
-- for enhanced analytics and authenticated API access

ALTER TABLE public.games ADD COLUMN IF NOT EXISTS roblox_api_key text;

-- Note: The API key is stored encrypted at rest by Supabase
-- Users can generate API keys at https://create.roblox.com/dashboard/credentials
