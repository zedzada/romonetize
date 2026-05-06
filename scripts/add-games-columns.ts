/**
 * Migration script to add missing columns to public.games table
 * 
 * Run with: npx tsx scripts/add-games-columns.ts
 * 
 * Or run the SQL directly in Supabase Dashboard > SQL Editor:
 * 
 * ALTER TABLE public.games ADD COLUMN IF NOT EXISTS is_selected boolean DEFAULT false;
 * ALTER TABLE public.games ADD COLUMN IF NOT EXISTS root_place_id text;
 * ALTER TABLE public.games ADD COLUMN IF NOT EXISTS source text DEFAULT 'user';
 * ALTER TABLE public.games ADD COLUMN IF NOT EXISTS group_id text;
 * ALTER TABLE public.games ADD COLUMN IF NOT EXISTS group_name text;
 * 
 * CREATE UNIQUE INDEX IF NOT EXISTS games_user_roblox_game_unique 
 * ON public.games(user_id, roblox_game_id);
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function runMigration() {
  console.log("Running migration to add missing columns to public.games...\n");

  // Test if is_selected column exists
  const { data, error } = await supabase
    .from("games")
    .select("is_selected")
    .limit(1);

  if (error && error.message.includes("is_selected")) {
    console.log("Column 'is_selected' does not exist in public.games");
    console.log("\nPlease run the following SQL in Supabase Dashboard > SQL Editor:\n");
    console.log(`
-- Add missing columns to games table
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS is_selected boolean DEFAULT false;
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS root_place_id text;
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS source text DEFAULT 'user';
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS group_id text;
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS group_name text;

-- Add unique constraint to prevent duplicate games per user
CREATE UNIQUE INDEX IF NOT EXISTS games_user_roblox_game_unique 
ON public.games(user_id, roblox_game_id);

-- Update RLS policies if needed (these should already exist)
-- Users can view their own games
-- Users can insert their own games  
-- Users can update their own games
-- Users can delete their own games
    `);
  } else if (data !== null) {
    console.log("Column 'is_selected' already exists. Migration not needed.");
  } else {
    console.log("Unexpected error:", error);
  }
}

runMigration().catch(console.error);
