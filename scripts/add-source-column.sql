-- Add source column to ccu_snapshots table
-- This allows tracking whether a snapshot came from vercel_cron or roblox_api (browser)

-- Add the column if it doesn't exist
ALTER TABLE ccu_snapshots 
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'unknown';

-- Add captured_at column for explicit timestamp tracking (separate from created_at)
ALTER TABLE ccu_snapshots 
ADD COLUMN IF NOT EXISTS captured_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Create an index on source for efficient grouping queries
CREATE INDEX IF NOT EXISTS idx_ccu_snapshots_source ON ccu_snapshots(source);

-- Create an index on captured_at for time-based queries
CREATE INDEX IF NOT EXISTS idx_ccu_snapshots_captured_at ON ccu_snapshots(captured_at DESC);

-- Backfill existing rows with 'unknown' source (already done by default)
-- UPDATE ccu_snapshots SET source = 'unknown' WHERE source IS NULL;

-- Verify the changes
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'ccu_snapshots' 
ORDER BY ordinal_position;
