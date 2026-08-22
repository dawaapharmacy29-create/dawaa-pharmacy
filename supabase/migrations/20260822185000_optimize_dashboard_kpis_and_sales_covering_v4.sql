-- Complete the sales dashboard covering index so the core analytics and KPI
-- RPCs stay index-only for cycle reads.
create index if not exists idx_sales_invoices_kpi_covering_v4
on public.sales_invoices (invoice_date)
include (
  sale_date,
  net_total,
  net_amount,
  discounted_amount,
  total_amount,
  amount,
  gross_total,
  gross_amount,
  discount_amount,
  branch,
  branch_name,
  seller_name,
  normalized_seller_name,
  staff_name,
  delivery_staff,
  customer_code,
  customer_phone,
  customer_name,
  customer_id,
  save_status,
  invoice_type
);

-- v4 is a strict superset of the older dashboard covering indexes.
drop index if exists public.idx_sales_invoices_kpi_covering_v3;
drop index if exists public.idx_sales_invoices_kpi_covering_v2;

-- Preserve the existing KPI contract while avoiding select si.* and the heap-heavy
-- materialization it caused. All calculations and branch semantics remain unchanged.
create or replace function public.get_dashboard_kpis(
  p_start_date date,
  p_end_date date,
  p_branch text default null
)
returns table(
  sales_net_total numeric,
  gross_total numeric,
  discount_total numeric,
  invoices_count bigint,
  avg_invoice numeric,
  unique_customers bigint,
  approximate_unique_customers bigint,
  doctors_count bigint,
  delivery_count bigint,
  followups_due bigint,
  followups_completed bigint,
  followups_overdue bigint,
  open_requests bigint,
  open_complaints bigint,
  urgent_alerts_count bigint
)
language plpgsql
stable
set plan_cache_mode to 'force_custom_plan'
as $function$
begin
  return query
  with scoped as materialized (
    select
      coalesce(
        nullif(si.net_total, 0),
        nullif(si.net_amount, 0),
        nullif(si.discounted_amount, 0),
        nullif(si.total_amount, 0),
        nullif(si.amount, 0),
        0
      )::numeric as truth_value,
      coalesce(
        nullif(si.gross_total, 0),
        nullif(si.gross_amount, 0),
        nullif(si.total_amount, 0),
        nullif(si.amount, 0),
        nullif(si.net_total, 0),
        nullif(si.net_amount, 0),
        0
      )::numeric as truth_gross,
      coalesce(si.discount_amount, 0)::numeric as discount_value,
      coalesce(
        nullif(btrim(si.customer_code), ''),
        si.customer_id::text,
        nullif(regexp_replace(coalesce(si.customer_phone, ''), '[^0-9]', '', 'g'), ''),
        nullif(btrim(si.customer_name), '')
      ) as customer_key,
      coalesce(
        nullif(btrim(si.seller_name), ''),
        nullif(btrim(si.staff_name), ''),
        nullif(btrim(si.normalized_seller_name), '')
      ) as raw_doctor_name,
      public.normalize_cs_identity_name(
        coalesce(
          nullif(btrim(si.seller_name), ''),
          nullif(btrim(si.staff_name), ''),
          nullif(btrim(si.normalized_seller_name), '')
        )
      ) as doctor_key,
      nullif(btrim(si.delivery_staff), '') as delivery_staff
    from public.dawaa_sales_invoices_dashboard_v1 si
    where si.invoice_date >= p_start_date::timestamp
      and si.invoice_date < (p_end_date + 1)::timestamp
      and (
        p_branch is null
        or p_branch in ('كل الفروع', 'الكل')
        or si.branch = p_branch
      )
  ),
  identity_catalog as (
    select
      public.normalize_cs_identity_name(s.name) as norm,
      lower(coalesce(s.role, '')) as role
    from public.staff s
    where coalesce(s.active, s.is_active, true)
    union all
    select
      public.normalize_cs_identity_name(a.alias_name),
      lower(coalesce(s.role, ''))
    from public.staff_identity_aliases a
    join public.staff s on s.id = a.staff_id
    where coalesce(a.active, true)
      and coalesce(s.active, s.is_active, true)
  ),
  sales_kpis as (
    select
      coalesce(sum(truth_value), 0)::numeric as sales_net_total_value,
      coalesce(sum(truth_gross), 0)::numeric as gross_total_value,
      coalesce(sum(discount_value), 0)::numeric as discount_total_value,
      count(*)::bigint as invoices_count_value,
      case
        when count(*) > 0 then coalesce(sum(truth_value), 0) / count(*)
        else 0
      end::numeric as avg_invoice_value,
      count(distinct customer_key) filter (where customer_key is not null)::bigint as unique_customers_value
    from scoped
  ),
  doctor_groups as (
    select doctor_key
    from scoped
    where coalesce(raw_doctor_name, '') ~ '^\s*د([/\.\s]|$)'
    group by doctor_key
  ),
  doctors as (
    select count(*)::bigint as c
    from doctor_groups g
    where not exists (
      select 1
      from identity_catalog i
      where i.norm = g.doctor_key
        and i.role ~ '(مساعد|assistant|inventory|مخزن|delivery|مندوب|cleaning|نظاف)'
    )
  ),
  delivery as (
    select count(distinct delivery_staff)::bigint as c
    from scoped
  ),
  followups as (
    select
      coalesce(sum(fp.assigned_count), 0)::bigint as due,
      coalesce(sum(fp.completed_count), 0)::bigint as completed,
      coalesce(sum(fp.overdue_count), 0)::bigint as overdue
    from public.followup_performance_summary fp
    where fp.followup_date between p_start_date and p_end_date
      and (
        p_branch is null
        or p_branch = 'كل الفروع'
        or fp.branch = p_branch
      )
  )
  select
    s.sales_net_total_value,
    s.gross_total_value,
    s.discount_total_value,
    s.invoices_count_value,
    s.avg_invoice_value,
    s.unique_customers_value,
    s.unique_customers_value,
    d.c,
    dl.c,
    f.due,
    f.completed,
    f.overdue,
    0::bigint,
    0::bigint,
    0::bigint
  from sales_kpis s
  cross join doctors d
  cross join delivery dl
  cross join followups f;
end;
$function$;
