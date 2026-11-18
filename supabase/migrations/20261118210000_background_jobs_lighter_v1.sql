-- Background jobs: lighter, spread out, and no more silent failures (owner request 2026-11-18).
--
-- Measured on 2026-11-18 (cron.job_run_details, last 24 h, and pg_stat_statements since 17/10):
-- * Up to ten jobs started on the same minute (:00 :15 :30 :45). The database has a small worker
--   budget, so jobs failed with "job startup timeout" and the ones that did start ran 5–30x slower
--   than alone (sync alerts: 1.2 s average in the crowd, 33 ms alone; purchase promotion 2.7 s vs
--   0.2 s; competition cache warm-up 3.5 s vs 0.16 s).
-- * dawaa-refresh-customer-monthly-performance takes 78–120 s and the global 120 s statement
--   timeout cancelled it repeatedly (four times in a row on 16/11). The refresh sets a 300 s limit
--   for itself, but a limit set inside a running statement does not extend that statement, so it
--   never applied. Each cancelled run left the flag pending and the next run started over.
-- * refresh_app_data_health_v2 (every 30 min, 17 s average, 10.6% of all database time) read
--   sales_invoices six times, the customer requests five times, and two views twice each.
-- * customers (869 rows) carries 80 MB of indexes and customer_metrics_summary (rebuilt nightly)
--   50 MB; 27 of those indexes were not used once in a month.
--
-- 1. compute_app_data_health_v2: one pass per source, the same 27 keys and the same counts
--    (checked side by side against the current function on production, identical).
-- 2. The monthly-performance check gets its own 6 min statement limit from the cron command, where
--    it takes effect (each statement of a cron command gets its own timeout since PostgreSQL 13).
-- 3. The frequent jobs move off the shared minutes, so no more than two start together.
-- 4. Indexes with no use in a month are dropped (unique and primary keys are kept, and so is
--    idx_customers_access_branch_v4, which the access checks read). Their definitions are below to
--    re-create any of them if needed.

-- 1. Data health: one pass per table ------------------------------------------------------------
create or replace function public.compute_app_data_health_v2()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v jsonb;
  v_cycle_start date;
  v_cycle_end date;
begin
  v_cycle_start := case when extract(day from current_date) >= 26
    then make_date(extract(year from current_date)::int, extract(month from current_date)::int, 26)
    else (date_trunc('month', current_date)::date - interval '1 month')::date + 25
  end;
  v_cycle_end := (v_cycle_start + interval '1 month' - interval '1 day')::date;

  with si as (
    select
      count(*) filter (where coalesce(trim(customer_code),'')='' and coalesce(trim(customer_phone),'')='' and coalesce(trim(customer_name),'')='') as invoices_without_customer,
      count(*) filter (where customer_name ilike '%عميل غير مسجل%') as unregistered_customer_invoices,
      count(*) filter (where customer_name ilike '%عميل الصيدلية%') as pharmacy_customer_invoices,
      count(*) filter (where coalesce(trim(seller_name),'')='') as invoices_without_doctor,
      count(*) filter (where coalesce(trim(branch),'')='') as invoices_without_branch,
      count(*) filter (where invoice_no is not null or invoice_number is not null) as invoice_volume
    from sales_invoices
  ), dash as (
    select count(*) as cycle_invoice_volume,
           count(*) filter (where coalesce(trim(seller_name),'')='') as cycle_invoices_without_doctor
    from dawaa_sales_invoices_dashboard_v1
    where invoice_date >= v_cycle_start::timestamp and invoice_date < (least(v_cycle_end,current_date) + 1)::timestamp
  ), dups as (
    select count(*) as duplicate_invoice_groups from (
      select 1 from sales_invoices
      where coalesce(nullif(trim(invoice_no),''),nullif(trim(invoice_number),'')) is not null
      group by branch, invoice_date::date, coalesce(nullif(trim(invoice_no),''),nullif(trim(invoice_number),''))
      having count(*)>1
    ) d
  ), cm as (
    select count(*) filter (where coalesce(trim(customer_phone),'')='' or customer_phone ilike 'code:%') as invalid_customer_phones,
           count(*) filter (where coalesce(trim(branch),'')='') as customers_without_branch,
           count(*) filter (where coalesce(trim(customer_phone),'')='') as customers_without_phone
    from dawaa_customer_metrics_app_view
  ), cu as (
    select count(*) filter (where coalesce(trim(branch),'')='') as master_customers_without_branch,
           count(*) filter (where coalesce(trim(phone),'')='') as master_customers_without_phone
    from customers
  ), cr as (
    select count(*) as open_customer_requests,
           count(*) filter (where coalesce(due_date,needed_by_date) < current_date) as overdue_customer_requests,
           count(*) filter (where assigned_to is null and primary_responsible_id is null) as unassigned_customer_requests,
           count(*) filter (where coalesce(trim(branch),'')='') as customer_requests_without_branch,
           count(*) filter (where coalesce(sync_conflict,false)=true
                              and sync_conflict_reason='branch_unresolved_after_customer_match') as unresolved_request_sync_conflicts
    from customer_requests
    where lower(coalesce(status,'new')) not in ('closed','delivered','cancelled','not_available')
  ), rv as (
    select count(*) filter (where not exists (select 1 from employee_transactions et where et.source_id=r.id)) as reviews_without_points,
           count(*) filter (where exists (select 1 from employee_transactions et
                                          where et.source_id=r.id and coalesce(et.status,'pending')='pending')) as pending_review_approvals
    from conversation_sales_reviews r
    where r.impact_status='pending'
  )
  select jsonb_build_object(
    'invoices_without_customer', si.invoices_without_customer,
    'unregistered_customer_invoices', si.unregistered_customer_invoices,
    'pharmacy_customer_invoices', si.pharmacy_customer_invoices,
    'invoices_without_doctor', si.invoices_without_doctor,
    'cycle_invoices_without_doctor', dash.cycle_invoices_without_doctor,
    'invoices_without_branch', si.invoices_without_branch,
    'invoice_volume', si.invoice_volume,
    'cycle_invoice_volume', dash.cycle_invoice_volume,
    'duplicate_invoice_groups', dups.duplicate_invoice_groups,
    'invalid_customer_phones', cm.invalid_customer_phones,
    'customers_without_branch', cm.customers_without_branch,
    'master_customers_without_branch', cu.master_customers_without_branch,
    'customers_without_phone', cm.customers_without_phone,
    'master_customers_without_phone', cu.master_customers_without_phone,
    'inactive_staff', (select count(*) from staff where coalesce(active,is_active,true)=false),
    'points_without_staff', (select count(*) from employee_transactions where staff_id is null),
    'accounts_without_staff', (
      select count(*) from staff_accounts sa
      where coalesce(sa.active,false)=true and coalesce(sa.can_login,false)=true
        and coalesce(sa.role,'') not in ('general_manager','delivery')
        and (coalesce(trim(sa.staff_id),'')='' or not exists (select 1 from staff s where s.id::text=trim(sa.staff_id)))
    ),
    'legacy_inactive_accounts', (
      select count(*) from staff_accounts sa
      where coalesce(sa.active,false)=false and coalesce(sa.can_login,false)=false
        and (coalesce(trim(sa.staff_id),'')='' or not exists (select 1 from staff s where s.id::text=trim(sa.staff_id)))
    ),
    'reviews_without_points', rv.reviews_without_points,
    'pending_review_approvals', rv.pending_review_approvals,
    'open_customer_requests', cr.open_customer_requests,
    'overdue_customer_requests', cr.overdue_customer_requests,
    'unassigned_customer_requests', cr.unassigned_customer_requests,
    'customer_requests_without_branch', cr.customer_requests_without_branch,
    'unresolved_request_sync_conflicts', cr.unresolved_request_sync_conflicts,
    'public_tables_without_rls', (
      select count(*) from pg_class c
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r' and not c.relrowsecurity
    ),
    'checked_at', now()
  ) into v
  from si, dash, dups, cm, cu, cr, rv;
  return v;
end
$function$;

-- 2 + 3. Cron: own time limit for the monthly refresh, and spread-out minutes ----------------------
do $cron$
declare
  r record;
  v_id bigint;
begin
  if to_regclass('cron.job') is null then
    return;
  end if;
  for r in
    select * from (values
      ('dawaa-refresh-customer-monthly-performance', '3-58/5 * * * *',
        $c$set statement_timeout = '6min'; select public.check_and_run_pending_monthly_refresh();$c$),
      ('dawaa_integration_sync_alerts_v1',           '1-56/5 * * * *', null),
      ('dawaa-customer-metrics-dirty-queue-v1',      '4-59/5 * * * *', null),
      ('dawaa-promote-matched-purchase-invoices',    '6,21,36,51 * * * *', null),
      ('dawaa-operational-notification-rules-v1',    '9,24,39,54 * * * *', null),
      ('dawaa-task-escalation-v2',                   '12,27,42,57 * * * *', null),
      ('dawaa-warm-doctor-competition-cache',        '14,34,54 6-23 * * *', null),
      ('refresh-app-data-health-v2',                 '10,40 * * * *', null)
    ) as t(jobname, schedule, command)
  loop
    select j.jobid into v_id from cron.job j where j.jobname = r.jobname;
    if v_id is null then
      raise notice 'cron job % not found, skipped', r.jobname;
      continue;
    end if;
    if r.command is null then
      perform cron.alter_job(v_id, schedule => r.schedule);
    else
      perform cron.alter_job(v_id, schedule => r.schedule, command => r.command);
    end if;
  end loop;
end
$cron$;

-- 4. Unused indexes (no scan between 17/10 and 18/11/2026) ---------------------------------------
-- To restore one, run its line from this list:
--   create index customer_metrics_summary_avg_monthly_idx on public.customer_metrics_summary (avg_monthly desc);
--   create index customer_metrics_summary_branch_avg_monthly_idx on public.customer_metrics_summary (branch, avg_monthly desc nulls last, total_spent desc nulls last);
--   create index customer_metrics_summary_branch_status_last_purchase_idx on public.customer_metrics_summary (branch, customer_status, last_purchase desc nulls last);
--   create index customer_metrics_summary_customer_code_trim_idx on public.customer_metrics_summary (trim(customer_code)) where nullif(trim(customer_code), '') is not null;
--   create index customer_metrics_summary_last_purchase_idx on public.customer_metrics_summary (last_purchase desc);
--   create index customer_metrics_summary_phone_idx on public.customer_metrics_summary (customer_phone);
--   create index customer_metrics_summary_status_avg_monthly_idx on public.customer_metrics_summary (customer_status, avg_monthly desc nulls last, total_spent desc nulls last);
--   create index idx_cms_customer_id on public.customer_metrics_summary (customer_id);
--   create index idx_cms_first_purchase_v1 on public.customer_metrics_summary (first_purchase);
--   create index idx_cms_sort_cols on public.customer_metrics_summary (avg_monthly desc nulls last, total_spent desc nulls last, last_purchase desc nulls last);
--   create index customers_avg_monthly_idx on public.customers (avg_monthly desc);
--   create index customers_data_quality_status_idx on public.customers (data_quality_status, is_duplicate);
--   create index customers_last_purchase_idx on public.customers (last_purchase desc);
--   create index customers_merged_into_idx on public.customers (merged_into_customer_id) where merged_into_customer_id is not null;
--   create index customers_normalized_name_idx on public.customers (normalized_name);
--   create index customers_phone_digits_idx on public.customers (regexp_replace(coalesce(phone, mobile, whatsapp, ''), '\D', '', 'g'));
--   create index customers_segment_idx on public.customers (segment);
--   create index customers_status_idx on public.customers (status);
--   create index customers_total_purchases_idx on public.customers (total_purchases desc);
--   create index customers_total_spent_idx on public.customers (total_spent desc);
--   create index idx_customers_customer_flags_gin on public.customers using gin (customer_flags);
--   create index idx_customers_customer_phone_20260607 on public.customers (customer_phone) where customer_phone is not null and customer_phone <> '';
--   create index idx_customers_name_fast on public.customers (coalesce(customer_name, name));
--   create index idx_customers_name_trgm on public.customers using gin (coalesce(customer_name, name, '') gin_trgm_ops);
--   create index idx_customers_phone_alt_single on public.customers (phone_alt);
--   create index idx_customers_phone_ilike_trgm on public.customers using gin (phone gin_trgm_ops);
--   create index idx_customers_phone_trgm on public.customers using gin (coalesce(customer_phone, phone, whatsapp_phone, '') gin_trgm_ops);
drop index if exists public.customer_metrics_summary_avg_monthly_idx;
drop index if exists public.customer_metrics_summary_branch_avg_monthly_idx;
drop index if exists public.customer_metrics_summary_branch_status_last_purchase_idx;
drop index if exists public.customer_metrics_summary_customer_code_trim_idx;
drop index if exists public.customer_metrics_summary_last_purchase_idx;
drop index if exists public.customer_metrics_summary_phone_idx;
drop index if exists public.customer_metrics_summary_status_avg_monthly_idx;
drop index if exists public.idx_cms_customer_id;
drop index if exists public.idx_cms_first_purchase_v1;
drop index if exists public.idx_cms_sort_cols;
drop index if exists public.customers_avg_monthly_idx;
drop index if exists public.customers_data_quality_status_idx;
drop index if exists public.customers_last_purchase_idx;
drop index if exists public.customers_merged_into_idx;
drop index if exists public.customers_normalized_name_idx;
drop index if exists public.customers_phone_digits_idx;
drop index if exists public.customers_segment_idx;
drop index if exists public.customers_status_idx;
drop index if exists public.customers_total_purchases_idx;
drop index if exists public.customers_total_spent_idx;
drop index if exists public.idx_customers_customer_flags_gin;
drop index if exists public.idx_customers_customer_phone_20260607;
drop index if exists public.idx_customers_name_fast;
drop index if exists public.idx_customers_name_trgm;
drop index if exists public.idx_customers_phone_alt_single;
drop index if exists public.idx_customers_phone_ilike_trgm;
drop index if exists public.idx_customers_phone_trgm;
