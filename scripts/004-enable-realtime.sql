-- Enable Supabase Realtime on the events table
-- This allows the dashboard to receive live updates when new events are inserted

-- Add the events table to the realtime publication
-- Note: This only needs to be run once per table
alter publication supabase_realtime add table events;

-- Verify the publication includes the events table
-- SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
