-- Local staging parity for the V22 Opportunity Center read models.
-- This file defines schema only; it does not seed or copy business rows.

alter table public.whatsapp_sales_opportunities_v17
  add column if not exists customer_name text,
  add column if not exists customer_phone text,
  add column if not exists attributed_staff_id uuid,
  add column if not exists attributed_staff_name text,
  add column if not exists attributed_staff_role text,
  add column if not exists quantity numeric,
  add column if not exists status text,
  add column if not exists confidence numeric,
  add column if not exists sale_verified_scope text,
  add column if not exists matched_invoice_value numeric,
  add column if not exists leakage_reason text,
  add column if not exists next_action text,
  add column if not exists evidence_json jsonb,
  add column if not exists analysis_version text;

create or replace function public.dawaa_cycle_start_26(p_date date)
returns date
language sql
immutable
parallel safe
as $$
  select case
    when p_date is null then null
    when extract(day from p_date) >= 26
      then date_trunc('month', p_date)::date + 25
    else (date_trunc('month', p_date)::date - interval '1 month')::date + 25
  end;
$$;

create or replace function public.dawaa_cycle_end_25(p_date date)
returns date
language sql
immutable
parallel safe
as $$
  select case
    when p_date is null then null
    else (public.dawaa_cycle_start_26(p_date) + interval '1 month - 1 day')::date
  end;
$$;

create or replace view public.whatsapp_product_demand_monthly_v22
with (security_invoker = true)
as
select
  public.dawaa_cycle_start_26(o.opened_at::date) as cycle_start,
  public.dawaa_cycle_end_25(o.opened_at::date) as cycle_end,
  o.branch,
  o.product_id,
  o.product_code,
  o.product_name,
  count(*)::bigint as inquiry_opportunities,
  count(distinct coalesce(o.customer_id::text, nullif(trim(o.customer_code), '')))::bigint as unique_customers,
  count(*) filter (where o.current_stage = 'unavailable')::bigint as unavailable_count,
  count(*) filter (
    where o.current_stage in ('accepted', 'order_confirmed', 'awaiting_invoice', 'verified_sale')
  )::bigint as accepted_or_later_count,
  round(
    count(*) filter (
      where o.current_stage in ('accepted', 'order_confirmed', 'awaiting_invoice', 'verified_sale')
    )::numeric * 100 / nullif(count(*), 0),
    2
  ) as acceptance_rate,
  count(distinct o.root_source_id) filter (
    where o.sale_verified_scope = 'product_invoice_item'
  )::bigint as conversation_verified_count
from public.whatsapp_sales_opportunities_v17 o
where o.product_id is not null
  and nullif(trim(o.product_code), '') is not null
  and o.opened_at is not null
group by
  public.dawaa_cycle_start_26(o.opened_at::date),
  public.dawaa_cycle_end_25(o.opened_at::date),
  o.branch,
  o.product_id,
  o.product_code,
  o.product_name;

create or replace view public.whatsapp_sales_leakage_monthly_v22
with (security_invoker = true)
as
select
  public.dawaa_cycle_start_26(o.opened_at::date) as cycle_start,
  public.dawaa_cycle_end_25(o.opened_at::date) as cycle_end,
  o.branch,
  coalesce(nullif(trim(o.evidence_json ->> 'leakageCode'), ''), 'unknown') as leakage_code,
  count(distinct o.root_source_id)::bigint as cases_count,
  count(distinct coalesce(o.customer_id::text, nullif(trim(o.customer_code), '')))::bigint as unique_customers,
  count(distinct coalesce(o.product_id::text, nullif(trim(o.product_code), '')))::bigint as unique_products,
  count(distinct o.root_source_id) filter (
    where o.attributed_staff_id is not null or nullif(trim(o.attributed_staff_name), '') is not null
  )::bigint as staff_attributed_cases
from public.whatsapp_sales_opportunities_v17 o
where o.opened_at is not null
  and o.current_stage not in ('accepted', 'order_confirmed', 'awaiting_invoice', 'verified_sale', 'rejected')
  and (
    nullif(trim(o.evidence_json ->> 'leakageCode'), '') is not null
    or o.current_stage in ('unavailable', 'needs_followup')
  )
group by
  public.dawaa_cycle_start_26(o.opened_at::date),
  public.dawaa_cycle_end_25(o.opened_at::date),
  o.branch,
  coalesce(nullif(trim(o.evidence_json ->> 'leakageCode'), ''), 'unknown');

create or replace view public.whatsapp_product_demand_unresolved_detail_v22
with (security_invoker = true)
as
select
  public.dawaa_cycle_start_26(s.conversation_started_at::date) as cycle_start,
  public.dawaa_cycle_end_25(s.conversation_started_at::date) as cycle_end,
  s.branch,
  coalesce(nullif(product.signal ->> 'unresolvedType', ''), 'named_product_unresolved') as unresolved_type,
  count(*)::bigint as unresolved_mentions,
  count(distinct s.id)::bigint as conversations_affected
from public.whatsapp_review_sources s
join public.whatsapp_operational_canonical_sources_v1 c on c.source_id = s.id
cross join lateral jsonb_array_elements(
  case
    when jsonb_typeof(s.analysis_json #> '{operational,products}') = 'array'
      then s.analysis_json #> '{operational,products}'
    else '[]'::jsonb
  end
) as product(signal)
where s.conversation_started_at is not null
  and coalesce(product.signal ->> 'requestProven', 'false') = 'true'
  and (
    nullif(trim(product.signal ->> 'productId'), '') is null
    or nullif(trim(product.signal ->> 'productCode'), '') is null
  )
group by
  public.dawaa_cycle_start_26(s.conversation_started_at::date),
  public.dawaa_cycle_end_25(s.conversation_started_at::date),
  s.branch,
  coalesce(nullif(product.signal ->> 'unresolvedType', ''), 'named_product_unresolved');

create or replace view public.whatsapp_product_demand_unresolved_v22
with (security_invoker = true)
as
select
  cycle_start,
  cycle_end,
  branch,
  unresolved_type,
  sum(unresolved_mentions)::bigint as unresolved_mentions,
  sum(conversations_affected)::bigint as conversations_affected
from public.whatsapp_product_demand_unresolved_detail_v22
group by cycle_start, cycle_end, branch, unresolved_type;

grant select on public.whatsapp_product_demand_monthly_v22 to anon, authenticated, service_role;
grant select on public.whatsapp_sales_leakage_monthly_v22 to anon, authenticated, service_role;
grant select on public.whatsapp_product_demand_unresolved_detail_v22 to anon, authenticated, service_role;
grant select on public.whatsapp_product_demand_unresolved_v22 to anon, authenticated, service_role;
