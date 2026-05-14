-- Create cron_runs table for logging cron job executions
-- This helps diagnose gaps in CCU data

CREATE TABLE IF NOT EXISTS public.cron_runs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  job_name text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  ok boolean DEFAULT false,
  games_processed integer DEFAULT 0,
  snapshots_inserted integer DEFAULT 0,
  error text
);

-- Index for querying recent runs
CREATE INDEX IF NOT EXISTS idx_cron_runs_started_at ON public.cron_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_runs_job_name ON public.cron_runs (job_name);

-- Enable RLS
ALTER TABLE public.cron_runs ENABLE ROW LEVEL SECURITY;

-- Service role can manage all cron runs
CREATE POLICY "Service role can manage cron_runs" ON public.cron_runs
  FOR ALL
  USING (true)
  WITH CHECK (true);
