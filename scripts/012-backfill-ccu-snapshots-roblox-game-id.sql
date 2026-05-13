-- Migration: Backfill ccu_snapshots.roblox_game_id from games table
-- This fixes existing NULL roblox_game_id values

-- Step 1: Backfill roblox_game_id from games table where missing
UPDATE public.ccu_snapshots cs
SET roblox_game_id = g.roblox_game_id
FROM public.games g
WHERE cs.game_id = g.id
  AND cs.roblox_game_id IS NULL
  AND g.roblox_game_id IS NOT NULL;

-- Step 2: Verify the fix (run this to check results)
-- SELECT game_id, roblox_game_id, COUNT(*)
-- FROM public.ccu_snapshots
-- GROUP BY game_id, roblox_game_id
-- ORDER BY game_id, COUNT(*) DESC;

-- Step 3: Optional - Delete orphaned snapshots that still have NULL roblox_game_id
-- (only if the game itself has no roblox_game_id - these are unusable)
-- DELETE FROM public.ccu_snapshots
-- WHERE roblox_game_id IS NULL;

-- Note: After running this migration, all new inserts are guarded in code
-- to never insert with roblox_game_id = NULL
