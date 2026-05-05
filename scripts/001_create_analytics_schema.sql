-- RoMonetize Analytics Schema
-- Tables: games, events, products, game_snapshots

-- Games table: stores connected Roblox games for each user
CREATE TABLE IF NOT EXISTS games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  roblox_game_id TEXT NOT NULL,
  name TEXT NOT NULL,
  api_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_event_at TIMESTAMPTZ,
  UNIQUE(user_id, roblox_game_id)
);

-- Events table: stores all tracking events from Roblox games
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'player_join',
    'player_leave',
    'shop_open',
    'shop_close',
    'gamepass_click',
    'devproduct_click',
    'purchase_prompt',
    'purchase_success',
    'purchase_failed'
  )),
  player_id TEXT,
  product_id TEXT,
  product_name TEXT,
  product_type TEXT CHECK (product_type IN ('gamepass', 'devproduct', 'subscription', NULL)),
  robux INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Products table: aggregated product data
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  roblox_product_id TEXT NOT NULL,
  name TEXT NOT NULL,
  product_type TEXT NOT NULL CHECK (product_type IN ('gamepass', 'devproduct', 'subscription')),
  price_robux INTEGER NOT NULL DEFAULT 0,
  total_revenue INTEGER NOT NULL DEFAULT 0,
  total_purchases INTEGER NOT NULL DEFAULT 0,
  total_clicks INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(game_id, roblox_product_id)
);

-- Game snapshots: daily aggregated stats for historical charts
CREATE TABLE IF NOT EXISTS game_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  visits INTEGER NOT NULL DEFAULT 0,
  unique_players INTEGER NOT NULL DEFAULT 0,
  shop_opens INTEGER NOT NULL DEFAULT 0,
  total_clicks INTEGER NOT NULL DEFAULT 0,
  purchase_prompts INTEGER NOT NULL DEFAULT 0,
  purchases INTEGER NOT NULL DEFAULT 0,
  revenue INTEGER NOT NULL DEFAULT 0,
  avg_session_minutes NUMERIC(10,2) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(game_id, snapshot_date)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_games_user_id ON games(user_id);
CREATE INDEX IF NOT EXISTS idx_games_api_key ON games(api_key);
CREATE INDEX IF NOT EXISTS idx_events_game_id ON events(game_id);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_event_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_game_type_date ON events(game_id, event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_products_game_id ON products(game_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_game_date ON game_snapshots(game_id, snapshot_date);

-- Enable Row Level Security
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_snapshots ENABLE ROW LEVEL SECURITY;

-- RLS Policies for games table
CREATE POLICY "Users can view their own games" ON games
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own games" ON games
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own games" ON games
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own games" ON games
  FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for events table (via game ownership)
CREATE POLICY "Users can view events for their games" ON events
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM games WHERE games.id = events.game_id AND games.user_id = auth.uid())
  );

-- Events are inserted via API with service role, but users can view their own
CREATE POLICY "Service role can insert events" ON events
  FOR INSERT WITH CHECK (true);

-- RLS Policies for products table
CREATE POLICY "Users can view products for their games" ON products
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM games WHERE games.id = products.game_id AND games.user_id = auth.uid())
  );

CREATE POLICY "Users can manage products for their games" ON products
  FOR ALL USING (
    EXISTS (SELECT 1 FROM games WHERE games.id = products.game_id AND games.user_id = auth.uid())
  );

-- RLS Policies for game_snapshots table
CREATE POLICY "Users can view snapshots for their games" ON game_snapshots
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM games WHERE games.id = game_snapshots.game_id AND games.user_id = auth.uid())
  );

CREATE POLICY "Service role can manage snapshots" ON game_snapshots
  FOR ALL WITH CHECK (true);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
DROP TRIGGER IF EXISTS update_games_updated_at ON games;
CREATE TRIGGER update_games_updated_at
  BEFORE UPDATE ON games
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_products_updated_at ON products;
CREATE TRIGGER update_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
