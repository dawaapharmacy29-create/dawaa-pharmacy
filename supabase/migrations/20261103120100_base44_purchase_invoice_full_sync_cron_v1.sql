-- Once a day, a full read of DawaaWael's invoices marks the ones deleted there (20261103120000).
select cron.unschedule(jobid) from cron.job where jobname = 'dawaa-base44-purchase-invoice-full-sync';
select cron.schedule('dawaa-base44-purchase-invoice-full-sync', '41 2 * * *', $$
  select net.http_post(
    url := 'https://jkjqeqkshllustwlzzbf.supabase.co/functions/v1/base44-purchase-invoice-sync',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"full": true}'::jsonb
  );
$$);
