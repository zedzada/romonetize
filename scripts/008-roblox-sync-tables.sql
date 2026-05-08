-- Migration: Create Roblox sync tables
-- These tables store synced Roblox dashboard data separately from tracker events

-- Table: roblox_game_syncs
-- Stores snapshots of Roblox public stats for each sync
CREATE TABLE IF NOT EXISTS public.roblox_game_syncs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid REFERENCES public.games(id) ON DELETE CASCADE NOT NULL,
  roblox_game_id text NOT NULL,
  root_place_id text,
  name text,
  ccu integer,
  visits bigint,
  favorites bigint,
  likes bigint,
  dislikes bigint,
  max_players integer,
  genre text,
  description text,
  thumbnail_url text,
  raw jsonb DEFAULT '{}'::jsonb,
  synced_at timestamptz DEFAULT now() NOT NULL
);

-- Index for querying sync history by game
CREATE INDEX IF NOT EXISTS idx_roblox_game_syncs_game_id ON public.roblox_game_syncs(game_id);
CREATE INDEX IF NOT EXISTS idx_roblox_game_syncs_synced_at ON public.roblox_game_syncs(synced_at DESC);

-- Table: roblox_products
-- Stores products fetched from Roblox API (gamepasses, dev products)
CREATE TABLE IF NOT EXISTS public.roblox_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid REFERENCES public.games(id) ON DELETE CASCADE NOT NULL,
  roblox_product_id text NOT NULL,
  name text NOT NULL,
  product_type text NOT NULL, -- 'gamepass' or 'devproduct'
  price_robux integer DEFAULT 0,
  is_for_sale boolean DEFAULT true,
  icon_url text,
  description text,
  raw jsonb DEFAULT '{}'::jsonb,
  synced_at timestamptz DEFAULT now() NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Unique constraint: one entry per product per game
CREATE UNIQUE INDEX IF NOT EXISTS idx_roblox_products_unique 
  ON public.roblox_products(game_id, roblox_product_id, product_type);

-- Index for querying products by game
CREATE INDEX IF NOT EXISTS idx_roblox_products_game_id ON public.roblox_products(game_id);

-- Enable RLS on both tables
ALTER TABLE public.roblox_game_syncs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roblox_products ENABLE ROW LEVEL SECURITY;

-- RLS Policies for roblox_game_syncs
CREATE POLICY "Users can view syncs for their games" ON public.roblox_game_syncs
  FOR SELECT
  USING (
    game_id IN (
      SELECT id FROM public.games WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Service role can insert syncs" ON public.roblox_game_syncs
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service role can delete syncs" ON public.roblox_game_syncs
  FOR DELETE
  USING (true);

-- RLS Policies for roblox_products
CREATE POLICY "Users can view products for their games" ON public.roblox_products
  FOR SELECT
  USING (
    game_id IN (
      SELECT id FROM public.games WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Service role can manage products" ON public.roblox_products
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Add column to games table to track last product sync
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS last_products_sync timestamptz;
