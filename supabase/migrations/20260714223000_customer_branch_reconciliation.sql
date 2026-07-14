-- Safe diagnostic layer for customers whose stored branch may not match invoice history.
-- This migration never updates customers automatically.

create or replace view public.customer_branch_reconciliation_v1 as
with invoice_base as (
  select
    nullif(trim(si.customer_code::text), '') as customer_code,
    case
      when lower(coalesce(si.branch::text, '')) ~ 'شامي|shamy|shami' then 'فرع الشامي'
      when lower(coalesce(si.branch::text, '')) ~ 'شكري|شكرى|shokry|shoukry' then 'فرع شكري'
      else nullif(trim(si.branch::text), '')
    end as invoice_branch,
    si.invoice_date::date as invoice_date
  from public.sales_invoices si
  where nullif(trim(si.customer_code::text), '') is not null
),
branch_counts as (
  select
    customer_code,
    invoice_branch,
    count(*)::bigint as invoices_count,
    max(invoice_date) as last_invoice_date
  from invoice_base
  where invoice_branch is not null
  group by customer_code, invoice_branch
),
ranked as (
  select
    bc.*,
    sum(bc.invoices_count) over (partition by bc.customer_code)::bigint as total_invoices,
    row_number() over (
      partition by bc.customer_code
      order by bc.invoices_count desc, bc.last_invoice_date desc, bc.invoice_branch
    ) as branch_rank
  from branch_counts bc
),
latest as (
  select distinct on (customer_code)
    customer_code,
    invoice_branch as latest_invoice_branch,
    invoice_date as latest_invoice_date
  from invoice_base
  where invoice_branch is not null
  order by customer_code, invoice_date desc nulls last
),
master as (
  select
    c.id as customer_id,
    nullif(trim(c.customer_code::text), '') as customer_code,
    c.name as customer_name,
    case
      when lower(coalesce(c.branch::text, '')) ~ 'شامي|shamy|shami' then 'فرع الشامي'
      when lower(coalesce(c.branch::text, '')) ~ 'شكري|شكرى|shokry|shoukry' then 'فرع شكري'
      else nullif(trim(c.branch::text), '')
    end as current_branch
  from public.customers c
)
select
  m.customer_id,
  m.customer_code,
  m.customer_name,
  m.current_branch,
  r.invoice_branch as dominant_invoice_branch,
  l.latest_invoice_branch,
  r.invoices_count as dominant_branch_invoices,
  r.total_invoices,
  case
    when coalesce(r.total_invoices, 0) = 0 then 0::numeric
    else round((r.invoices_count::numeric / r.total_invoices::numeric) * 100, 2)
  end as confidence_percent,
  case
    when r.total_invoices is null then null
    when r.total_invoices < 3 then null
    when (r.invoices_count::numeric / nullif(r.total_invoices, 0)) >= 0.80 then r.invoice_branch
    else null
  end as suggested_branch,
  case
    when r.total_invoices is null then 'no_invoice_history'
    when r.total_invoices < 3 then 'insufficient_history'
    when (r.invoices_count::numeric / nullif(r.total_invoices, 0)) < 0.80 then 'mixed_branch_history'
    when m.current_branch is null then 'missing_current_branch'
    when m.current_branch is distinct from r.invoice_branch then 'dominant_branch_mismatch'
    else 'branch_consistent'
  end as review_reason,
  case
    when r.total_invoices is null then false
    when r.total_invoices < 3 then true
    when (r.invoices_count::numeric / nullif(r.total_invoices, 0)) < 0.80 then true
    when m.current_branch is distinct from r.invoice_branch then true
    else false
  end as needs_manual_review,
  l.latest_invoice_date
from master m
left join ranked r
  on r.customer_code = m.customer_code
 and r.branch_rank = 1
left join latest l
  on l.customer_code = m.customer_code;

comment on view public.customer_branch_reconciliation_v1 is
'Safe read-only review of stored customer branch versus dominant/latest invoice branches. No automatic customer updates.';

grant select on public.customer_branch_reconciliation_v1 to authenticated;

create index if not exists idx_sales_invoices_customer_code_invoice_date
  on public.sales_invoices (customer_code, invoice_date desc);

create index if not exists idx_sales_invoices_customer_code_branch
  on public.sales_invoices (customer_code, branch);

create index if not exists idx_customers_customer_code
  on public.customers (customer_code);
