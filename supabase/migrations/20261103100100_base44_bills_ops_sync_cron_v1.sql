-- Every 15 minutes, between the other Base44 syncs: the Dawaa Bills settlement ledger and riders' trips.
select cron.unschedule(jobid) from cron.job where jobname = 'dawaa-base44-bills-ops-sync';
select cron.schedule('dawaa-base44-bills-ops-sync', '11,26,41,56 * * * *', $$
  select net.http_post(
    url := 'https://jkjqeqkshllustwlzzbf.supabase.co/functions/v1/base44-bills-ops-sync',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
$$);
