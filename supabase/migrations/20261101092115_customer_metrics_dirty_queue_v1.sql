-- Keep sales imports fast: enqueue customer codes, then refresh only affected summaries.
-- The nightly full rebuild remains in place as a reconciliation safety net.
create table if not exists public.customer_metrics_dirty_queue_v1 (
  customer_code text primary key,
  queued_at timestamptz not null default now()
);

alter table public.customer_metrics_dirty_queue_v1 enable row level security;
revoke all on public.customer_metrics_dirty_queue_v1 from public, anon, authenticated;
grant select, insert, update, delete on public.customer_metrics_dirty_queue_v1 to service_role;

create or replace function public.queue_customer_metrics_after_sales_invoice_insert_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
begin
  insert into public.customer_metrics_dirty_queue_v1 (customer_code)
  select distinct btrim(customer_code)
  from new_rows
  where nullif(btrim(customer_code), '') is not null
  on conflict (customer_code) do nothing;
  return null;
end;
$function$;

revoke all on function public.queue_customer_metrics_after_sales_invoice_insert_v1() from public, anon, authenticated;

-- A failure rolls back the refresh and queue deletion together. Concurrent inserts
-- into an already queued code wait for its row lock; afterwards a new queue row is
-- available for the next run, so no customer change is silently lost.
create or replace function public.process_customer_metrics_dirty_queue_v1(p_limit integer default 150)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_codes text[];
  v_count integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'p_limit must be between 1 and 500';
  end if;

  select array_agg(customer_code)
  into v_codes
  from (
    select customer_code
    from public.customer_metrics_dirty_queue_v1
    order by queued_at, customer_code
    limit p_limit
    for update skip locked
  ) pending;

  v_count := coalesce(cardinality(v_codes), 0);
  if v_count = 0 then
    return 0;
  end if;

  perform public.refresh_customer_metrics_for_codes_v1(v_codes);
  delete from public.customer_metrics_dirty_queue_v1
  where customer_code = any(v_codes);
  return v_count;
end;
$function$;

revoke all on function public.process_customer_metrics_dirty_queue_v1(integer) from public, anon, authenticated;
grant execute on function public.process_customer_metrics_dirty_queue_v1(integer) to service_role;

-- Replace only the intentionally disabled INSERT trigger. UPDATE and DELETE
-- triggers keep their original immediate refresh behavior.
drop trigger if exists sales_invoices_queue_customer_metrics_insert_v1 on public.sales_invoices;
create trigger sales_invoices_queue_customer_metrics_insert_v1
after insert on public.sales_invoices
referencing new table as new_rows
for each statement execute function public.queue_customer_metrics_after_sales_invoice_insert_v1();

do $block$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if exists (select 1 from cron.job where jobname = 'dawaa-customer-metrics-dirty-queue-v1') then
      perform cron.unschedule('dawaa-customer-metrics-dirty-queue-v1');
    end if;
    perform cron.schedule(
      'dawaa-customer-metrics-dirty-queue-v1',
      -- Offset from the existing 03:30 UTC nightly reconciliation job.
      '2-59/5 * * * *',
      'select public.process_customer_metrics_dirty_queue_v1(150)'
    );
  end if;
end;
$block$;
