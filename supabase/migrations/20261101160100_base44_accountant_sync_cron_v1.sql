-- Accountant book sync every 15 minutes, between the purchase and shift syncs (Production only: pg_cron
-- and pg_net are not in the local test database).
select cron.schedule('dawaa-base44-accountant-sync', '4,19,34,49 * * * *', $cron$
  select net.http_post(
    url := 'https://jkjqeqkshllustwlzzbf.supabase.co/functions/v1/base44-accountant-sync',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
$cron$);
