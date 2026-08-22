create or replace function public.get_dashboard_sales_truth_audit_v1(
  p_start date,
  p_end date,
  p_branch text default null::text
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
with flags as materialized (
  select distinct btrim(customer_code) customer_code
  from public.customer_flags
  where flag_key in ('wholesale_b2b','system_generic_code')
    and coalesce(is_active,false)
), raw as materialized (
  select
    si.id,
    si.branch,
    si.branch_name,
    si.invoice_number,
    si.invoice_no,
    si.invoice_date,
    si.sale_date,
    si.created_at,
    si.updated_at,
    coalesce(nullif(si.net_total,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),nullif(si.total_amount,0),nullif(si.amount,0),0)::numeric truth_value,
    (f.customer_code is not null) excluded_code,
    (
      lower(coalesce(si.save_status,'')) ~ '(معلق|قيد|pending|draft|غير محفوظ)'
      or lower(coalesce(si.invoice_type,'')) ~ '(معلق|pending|draft)'
    ) nonfinal
  from public.sales_invoices si
  left join flags f on f.customer_code = btrim(coalesce(si.customer_code,''))
  where si.invoice_date >= p_start
    and si.invoice_date < (p_end + 1)::timestamp
    and (
      p_branch is null
      or p_branch = ''
      or lower(p_branch) = 'all'
      or p_branch like '%كل%'
      or coalesce(nullif(btrim(si.branch),''),nullif(btrim(si.branch_name),'')) = p_branch
    )
), ranked as materialized (
  select
    r.*,
    row_number() over (
      partition by
        coalesce(nullif(btrim(r.branch),''),nullif(btrim(r.branch_name),''),'غير محدد'),
        case
          when nullif(btrim(coalesce(r.invoice_number,r.invoice_no)),'') is not null
            then btrim(coalesce(r.invoice_number,r.invoice_no))
          else concat('__row__',r.id)
        end,
        r.invoice_date::date
      order by
        coalesce(r.updated_at,r.created_at) desc nulls last,
        r.created_at desc nulls last,
        r.id desc
    ) truth_rank
  from raw r
  where not r.excluded_code and not r.nonfinal
), raw_agg as (
  select
    count(*)::bigint raw_rows,
    round(coalesce(sum(truth_value),0),2) raw_total,
    count(*) filter (where excluded_code)::bigint excluded_internal_rows,
    round(coalesce(sum(truth_value) filter (where excluded_code),0),2) excluded_internal_value,
    count(*) filter (where nonfinal and not excluded_code)::bigint nonfinal_rows,
    round(coalesce(sum(truth_value) filter (where nonfinal and not excluded_code),0),2) nonfinal_value
  from raw
), ranked_agg as (
  select
    count(*) filter (where truth_rank > 1)::bigint duplicate_rows,
    round(coalesce(sum(truth_value) filter (where truth_rank > 1),0),2) duplicate_value,
    count(*) filter (where truth_rank = 1)::bigint clean_rows,
    round(coalesce(sum(truth_value) filter (where truth_rank = 1),0),2) clean_total
  from ranked
)
select jsonb_build_object(
  'raw_rows', r.raw_rows,
  'raw_total', r.raw_total,
  'excluded_internal_rows', r.excluded_internal_rows,
  'excluded_internal_value', r.excluded_internal_value,
  'nonfinal_rows', r.nonfinal_rows,
  'nonfinal_value', r.nonfinal_value,
  'duplicate_rows', g.duplicate_rows,
  'duplicate_value', g.duplicate_value,
  'clean_rows', g.clean_rows,
  'clean_total', g.clean_total,
  'adjustment_value', r.raw_total - g.clean_total
)
from raw_agg r
cross join ranked_agg g;
$function$;
