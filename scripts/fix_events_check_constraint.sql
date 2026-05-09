-- Fix events event_type check constraint to allow all tracking event types
-- Run this migration on your Supabase database

-- Drop the existing constraint
ALTER TABLE public.events
DROP CONSTRAINT IF EXISTS events_event_type_check;

-- Add the updated constraint with all allowed event types
ALTER TABLE public.events
ADD CONSTRAINT events_event_type_check
CHECK (
  event_type IN (
    'script_started',
    'player_join',
    'session_start',
    'session_end',
    'session_duration',
    'shop_open',
    'product_view',
    'product_click',
    'purchase_success',
    'purchase_failed',
    'purchase_prompt',
    'gamepass_purchase',
    'devproduct_purchase',
    'custom_event'
  )
);

-- Verify the constraint was created
SELECT conname, pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conrelid = 'public.events'::regclass 
AND contype = 'c';
