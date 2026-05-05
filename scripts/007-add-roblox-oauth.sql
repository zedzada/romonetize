-- Add Roblox OAuth columns to profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS roblox_user_id TEXT,
ADD COLUMN IF NOT EXISTS roblox_username TEXT,
ADD COLUMN IF NOT EXISTS roblox_access_token TEXT,
ADD COLUMN IF NOT EXISTS roblox_refresh_token TEXT,
ADD COLUMN IF NOT EXISTS roblox_token_expires_at TIMESTAMP WITH TIME ZONE;

-- Create an index on roblox_user_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_profiles_roblox_user_id ON public.profiles(roblox_user_id);

COMMENT ON COLUMN public.profiles.roblox_user_id IS 'Roblox user ID from OAuth';
COMMENT ON COLUMN public.profiles.roblox_username IS 'Roblox username from OAuth';
COMMENT ON COLUMN public.profiles.roblox_access_token IS 'Roblox OAuth access token';
COMMENT ON COLUMN public.profiles.roblox_refresh_token IS 'Roblox OAuth refresh token';
COMMENT ON COLUMN public.profiles.roblox_token_expires_at IS 'When the Roblox access token expires';
