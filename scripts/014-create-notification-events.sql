-- Migration: Create notification_events table for deduplication
-- Run this in your Supabase SQL editor

-- Create notification_events table
CREATE TABLE IF NOT EXISTS notification_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  game_id UUID REFERENCES games(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}',
  
  -- Unique constraint on fingerprint to prevent duplicate alerts
  CONSTRAINT notification_events_fingerprint_unique UNIQUE (fingerprint)
);

-- Add index for querying by user
CREATE INDEX IF NOT EXISTS idx_notification_events_user_id ON notification_events(user_id);

-- Add index for querying by type
CREATE INDEX IF NOT EXISTS idx_notification_events_type ON notification_events(type);

-- Add index for cleanup queries (older than X days)
CREATE INDEX IF NOT EXISTS idx_notification_events_sent_at ON notification_events(sent_at);

-- Enable RLS
ALTER TABLE notification_events ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Service role can manage all records (for cron)
CREATE POLICY "Service role can manage notification events"
  ON notification_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- RLS Policy: Users can view their own notification history
CREATE POLICY "Users can view own notification events"
  ON notification_events
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Add missing columns to user_notification_settings if they don't exist
-- These columns control which notification types the user receives

-- Add tracking_inactive_alerts column (for tracker inactive alerts)
ALTER TABLE user_notification_settings 
ADD COLUMN IF NOT EXISTS tracking_inactive_alerts BOOLEAN DEFAULT true;

-- Add ccu_stopped_alerts column (for CCU heartbeat stopped alerts)  
ALTER TABLE user_notification_settings
ADD COLUMN IF NOT EXISTS ccu_stopped_alerts BOOLEAN DEFAULT true;

-- Add purchase_spike_alerts column (for purchase spike notifications)
ALTER TABLE user_notification_settings
ADD COLUMN IF NOT EXISTS purchase_spike_alerts BOOLEAN DEFAULT true;

-- Add low_credits_alerts column (for AI credit warnings)
ALTER TABLE user_notification_settings
ADD COLUMN IF NOT EXISTS low_credits_alerts BOOLEAN DEFAULT true;

-- Add threshold settings
ALTER TABLE user_notification_settings
ADD COLUMN IF NOT EXISTS tracking_inactive_hours INTEGER DEFAULT 6;

ALTER TABLE user_notification_settings
ADD COLUMN IF NOT EXISTS ccu_stopped_minutes INTEGER DEFAULT 10;

COMMENT ON TABLE notification_events IS 'Stores sent notification events to prevent duplicate alerts';
COMMENT ON COLUMN notification_events.fingerprint IS 'Unique identifier to prevent duplicate alerts, e.g. userId:gameId:type:dateHour';
COMMENT ON COLUMN notification_events.type IS 'Alert type: tracking_inactive, ccu_stopped, purchase_spike, revenue_drop, low_credits';
