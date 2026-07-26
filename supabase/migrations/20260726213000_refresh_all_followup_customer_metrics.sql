-- Keep customer activity, last purchase and purchase frequency accurate in daily_followups.
-- The follow-up UI reads these denormalized columns, so refresh them from the
-- canonical customer_metrics_summary view for every customer and after new sales.

create or replace function public.normalize_followup_branch(value text)
returns text
language sql
immutable
as $$
  select trim(
    regexp_replace(
      regexp_replace(lower(coalesce(value, '')), '^(الفرعية|الادارة|الإدارة)\s*', '', 'g'),
      '^فرع\s*',
      '',
      'g'
    )
  );
$$;

create or replace function public.refresh_daily_followup_customer_metrics(
  p_customer_code text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer := 0;
begin
  if to_regclass('public.daily_followups') is null
     or to_regclass('public.customer_metrics_summary') is null then
    return 0;
  end if;

  with matched_metrics as (
    select distinct on (df.id)
      df.id as followup_id,
      cms.customer_id,
      cms.customer_code,
      cms.customer_name,
      cms.customer_phone,
      cms.branch,
      coalesce(cms.invoices_count, 0)::numeric as invoices_count,
      coalesce(cms.total_spent, 0)::numeric as total_spent,
      coalesce(cms.avg_invoice, 0)::numeric as avg_invoice,
      cms.first_purchase,
      cms.last_purchase,
      greatest(coalesce(cms.active_months, 0), 1)::numeric as active_months,
      coalesce(cms.avg_monthly, 0)::numeric as avg_monthly,
      cms.segment,
      cms.customer_status
    from public.daily_followups df
    join public.customer_metrics_summary cms
      on nullif(trim(cms.customer_code::text), '') = nullif(trim(df.customer_code::text), '')
     and (
       public.normalize_followup_branch(df.branch) = public.normalize_followup_branch(cms.branch)
       or nullif(public.normalize_followup_branch(df.branch), '') is null
       or nullif(public.normalize_followup_branch(cms.branch), '') is null
     )
    where p_customer_code is null
       or trim(df.customer_code::text) = trim(p_customer_code)
    order by
      df.id,
      case when public.normalize_followup_branch(df.branch) = public.normalize_followup_branch(cms.branch) then 0 else 1 end,
      cms.last_purchase desc nulls last
  )
  update public.daily_followups df
  set
    customer_id = coalesce(df.customer_id, mm.customer_id),
    customer_name = coalesce(nullif(mm.customer_name, ''), df.customer_name, df.name),
    customer_phone = coalesce(nullif(mm.customer_phone, ''), df.customer_phone, df.phone),
    branch = coalesce(nullif(mm.branch, ''), df.branch),
    total_spent = mm.total_spent,
    last_purchase_date = mm.last_purchase,
    average_monthly_purchase_count = round(mm.invoices_count / mm.active_months, 2),
    segment = coalesce(nullif(mm.segment, ''), df.segment),
    customer_status = coalesce(nullif(mm.customer_status, ''), df.customer_status),
    customer_metrics = coalesce(df.customer_metrics, '{}'::jsonb) || jsonb_build_object(
      'customer_id', mm.customer_id,
      'customer_code', mm.customer_code,
      'customer_name', mm.customer_name,
      'customer_phone', mm.customer_phone,
      'branch', mm.branch,
      'invoices_count', mm.invoices_count,
      'total_spent', mm.total_spent,
      'avg_invoice', mm.avg_invoice,
      'first_purchase', mm.first_purchase,
      'last_purchase', mm.last_purchase,
      'active_months', mm.active_months,
      'avg_monthly', mm.avg_monthly,
      'segment', mm.segment,
      'customer_status', mm.customer_status,
      'average_monthly_purchase_count', round(mm.invoices_count / mm.active_months, 2)
    ),
    updated_at = now()
  from matched_metrics mm
  where df.id = mm.followup_id
    and (
      df.last_purchase_date is distinct from mm.last_purchase
      or coalesce(df.total_spent, 0) is distinct from mm.total_spent
      or coalesce(df.average_monthly_purchase_count, 0) is distinct from round(mm.invoices_count / mm.active_months, 2)
      or coalesce(df.customer_status, '') is distinct from coalesce(mm.customer_status, '')
      or coalesce(df.segment, '') is distinct from coalesce(mm.segment, '')
      or df.customer_metrics is null
      or coalesce((df.customer_metrics ->> 'invoices_count')::numeric, -1) is distinct from mm.invoices_count
    );

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

comment on function public.refresh_daily_followup_customer_metrics(text) is
  'Refreshes activity status, last purchase, total purchases and average purchase frequency for all or one customer in daily_followups.';

grant execute on function public.refresh_daily_followup_customer_metrics(text) to authenticated;

-- Enrich every newly created follow-up immediately.
create or replace function public.refresh_new_daily_followup_metrics()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(trim(new.customer_code::text), '') is not null then
    perform public.refresh_daily_followup_customer_metrics(new.customer_code::text);
  end if;
  return new;
end;
$$;

drop trigger if exists daily_followups_refresh_customer_metrics_after_insert on public.daily_followups;
create trigger daily_followups_refresh_customer_metrics_after_insert
after insert on public.daily_followups
for each row execute function public.refresh_new_daily_followup_metrics();

-- Refresh the affected customer after imported, edited or deleted invoices.
create or replace function public.refresh_followup_metrics_after_sales_invoice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if tg_op = 'DELETE' then
    v_code := old.customer_code::text;
  else
    v_code := new.customer_code::text;
  end if;

  if nullif(trim(v_code), '') is not null then
    perform public.refresh_daily_followup_customer_metrics(v_code);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.sales_invoices') is not null then
    execute 'drop trigger if exists sales_invoices_refresh_followup_metrics_insert on public.sales_invoices';
    execute 'drop trigger if exists sales_invoices_refresh_followup_metrics_update on public.sales_invoices';
    execute 'drop trigger if exists sales_invoices_refresh_followup_metrics_delete on public.sales_invoices';

    execute 'create trigger sales_invoices_refresh_followup_metrics_insert
      after insert on public.sales_invoices
      for each row execute function public.refresh_followup_metrics_after_sales_invoice()';

    execute 'create trigger sales_invoices_refresh_followup_metrics_update
      after update on public.sales_invoices
      for each row execute function public.refresh_followup_metrics_after_sales_invoice()';

    execute 'create trigger sales_invoices_refresh_followup_metrics_delete
      after delete on public.sales_invoices
      for each row execute function public.refresh_followup_metrics_after_sales_invoice()';
  end if;
end;
$$;

-- Repair all existing open and historical follow-ups now.
select public.refresh_daily_followup_customer_metrics(null);
