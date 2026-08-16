-- Canonical clean sales truth for the executive dashboard.
-- Raw invoices stay untouched for audit/returns. Dashboard truth excludes:
-- 1) internal/system generic customer codes,
-- 2) explicitly non-final/pending invoices,
-- 3) duplicate invoice versions for the same branch + invoice number + day.
-- For duplicate versions, keep the newest updated/created row so returns/corrections win.

create or replace view public.dawaa_sales_invoices_dashboard_v1
with (security_invoker = true)
as
with ranked as (
  select
    si.*,
    row_number() over (
      partition by
        coalesce(nullif(btrim(si.branch),''), nullif(btrim(si.branch_name),''), 'غير محدد'),
        case
          when nullif(btrim(coalesce(si.invoice_number, si.invoice_no)), '') is not null
            then btrim(coalesce(si.invoice_number, si.invoice_no))
          else concat('__row__', si.id)
        end,
        coalesce(si.invoice_date::date, si.sale_date, si.created_at::date)
      order by coalesce(si.updated_at, si.created_at) desc nulls last, si.created_at desc nulls last, si.id desc
    ) as truth_rank
  from public.sales_invoices si
  where not public.dawaa_is_sales_target_excluded_customer_v1(si.branch, si.customer_code)
    and not (
      lower(coalesce(si.save_status,'')) ~ '(معلق|قيد|pending|draft|غير محفوظ)'
      or lower(coalesce(si.invoice_type,'')) ~ '(معلق|pending|draft)'
    )
)
select *
from ranked
where truth_rank = 1;

grant select on public.dawaa_sales_invoices_dashboard_v1 to anon, authenticated;

create or replace function public.get_dashboard_sales_truth_audit_v1(
  p_start date,
  p_end date,
  p_branch text default null
) returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
with raw as (
  select
    si.*,
    coalesce(si.net_amount,si.net_total,si.amount,si.total_amount,si.discounted_amount,si.gross_amount,0)::numeric as truth_value,
    public.dawaa_is_sales_target_excluded_customer_v1(si.branch,si.customer_code) as excluded_code,
    (
      lower(coalesce(si.save_status,'')) ~ '(معلق|قيد|pending|draft|غير محفوظ)'
      or lower(coalesce(si.invoice_type,'')) ~ '(معلق|pending|draft)'
    ) as nonfinal
  from public.sales_invoices si
  where si.invoice_date >= p_start::timestamp
    and si.invoice_date < (p_end + 1)::timestamp
    and (
      p_branch is null or p_branch='' or lower(p_branch)='all' or p_branch like '%كل%'
      or coalesce(nullif(btrim(si.branch),''), nullif(btrim(si.branch_name),'')) = p_branch
    )
), eligible_ranked as (
  select
    r.*,
    row_number() over (
      partition by
        coalesce(nullif(btrim(r.branch),''), nullif(btrim(r.branch_name),''), 'غير محدد'),
        case
          when nullif(btrim(coalesce(r.invoice_number,r.invoice_no)), '') is not null
            then btrim(coalesce(r.invoice_number,r.invoice_no))
          else concat('__row__',r.id)
        end,
        coalesce(r.invoice_date::date,r.sale_date,r.created_at::date)
      order by coalesce(r.updated_at,r.created_at) desc nulls last,r.created_at desc nulls last,r.id desc
    ) truth_rank
  from raw r
  where not r.excluded_code and not r.nonfinal
), clean as (
  select * from eligible_ranked where truth_rank=1
)
select jsonb_build_object(
  'raw_rows',(select count(*) from raw),
  'raw_total',(select round(coalesce(sum(truth_value),0),2) from raw),
  'excluded_internal_rows',(select count(*) from raw where excluded_code),
  'excluded_internal_value',(select round(coalesce(sum(truth_value),0),2) from raw where excluded_code),
  'nonfinal_rows',(select count(*) from raw where nonfinal and not excluded_code),
  'nonfinal_value',(select round(coalesce(sum(truth_value),0),2) from raw where nonfinal and not excluded_code),
  'duplicate_rows',(select count(*) from eligible_ranked where truth_rank>1),
  'duplicate_value',(select round(coalesce(sum(truth_value),0),2) from eligible_ranked where truth_rank>1),
  'clean_rows',(select count(*) from clean),
  'clean_total',(select round(coalesce(sum(truth_value),0),2) from clean),
  'adjustment_value',(
    (select round(coalesce(sum(truth_value),0),2) from raw)
    - (select round(coalesce(sum(truth_value),0),2) from clean)
  )
);
$$;

grant execute on function public.get_dashboard_sales_truth_audit_v1(date,date,text) to authenticated, service_role;
