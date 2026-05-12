-- Add username, discord_username, and roblox_username columns to profiles table
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS username TEXT,
ADD COLUMN IF NOT EXISTS discord_username TEXT,
ADD COLUMN IF NOT EXISTS roblox_username TEXT,
ADD COLUMN IF NOT EXISTS roblox_user_id TEXT,
ADD COLUMN IF NOT EXISTS roblox_access_token TEXT,
ADD COLUMN IF NOT EXISTS roblox_refresh_token TEXT,
ADD COLUMN IF NOT EXISTS roblox_token_expires_at TIMESTAMP WITH TIME ZONE;
