-- Shift handover sync every 15 minutes, eight minutes after the purchase sync (Production only: pg_cron
-- and pg_net are not in the local test database).
select cron.schedule('dawaa-base44-shift-delivery-sync', '8,23,38,53 * * * *', $cron$
  select net.http_post(
    url := 'https://jkjqeqkshllustwlzzbf.supabase.co/functions/v1/base44-shift-delivery-sync',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
$cron$);
