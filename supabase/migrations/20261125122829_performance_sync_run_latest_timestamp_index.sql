SET LOCAL lock_timeout = '2s';
CREATE INDEX IF NOT EXISTS idx_base44_sync_run_log_ran_at_v1 ON public.base44_sync_run_log (ran_at);
