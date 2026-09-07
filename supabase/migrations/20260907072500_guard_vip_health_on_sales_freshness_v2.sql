-- Prevent false VIP decline alerts when the current sales import has not reached today.
-- We require both pharmacy branches to have sales data through yesterday before running VIP health.

create or replace function public.notify_vip_same_period_customer_health_guarded_v2()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_shokry_latest date;
  v_shamy_latest date;
begin
  select max(coalesce(si.sale_date, si.invoice_date::date))
    into v_shokry_latest
  from public.sales_invoices si
  where coalesce(si.branch_name, si.branch) = 'فرع شكري';

  select max(coalesce(si.sale_date, si.invoice_date::date))
    into v_shamy_latest
  from public.sales_invoices si
  where coalesce(si.branch_name, si.branch) = 'فرع الشامي';

  if v_shokry_latest is null or v_shamy_latest is null then
    return 0;
  end if;

  -- Using yesterday allows the normal overnight import window without raising false customer alerts.
  if v_shokry_latest < current_date - 1 or v_shamy_latest < current_date - 1 then
    return 0;
  end if;

  return public.notify_vip_same_period_customer_health_v1();
end;
$$;

do $$
declare v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'dawaa-vip-same-period-health-digest'
  limit 1;

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'dawaa-vip-same-period-health-digest',
    '15 8 * * *',
    'select public.notify_vip_same_period_customer_health_guarded_v2();'
  );
end;
$$;
