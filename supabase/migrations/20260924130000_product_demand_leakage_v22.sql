-- Product Demand + Sales Leakage Intelligence V22
-- Canonical-product demand only. Unresolved phrases are tracked separately and never pollute product rankings.

drop view if exists public.whatsapp_product_demand_monthly_v22;
create view public.whatsapp_product_demand_monthly_v22 as
select
  dawaa_cycle_start_26(coalesce(opened_at::date, created_at::date)) as cycle_start,
  dawaa_cycle_end_25(coalesce(opened_at::date, created_at::date)) as cycle_end,
  branch,
  product_id,
  product_code,
  product_name,
  count(*) as inquiry_opportunities,
  count(distinct customer_id) filter (where customer_id is not null) as unique_customers,
  count(*) filter (where current_stage = 'unavailable') as unavailable_count,
  count(*) filter (where current_stage in ('alternative_offered','recommended')) as recommendation_or_alternative_count,
  count(*) filter (where current_stage in ('accepted','order_confirmed','awaiting_invoice','verified_sale','needs_followup')) as accepted_or_later_count,
  count(*) filter (where sale_verified_scope in ('conversation','product')) as conversation_verified_count,
  count(*) filter (where sale_verified_scope = 'product') as product_verified_count,
  round(100.0 * count(*) filter (where current_stage in ('accepted','order_confirmed','awaiting_invoice','verified_sale','needs_followup')) / nullif(count(*),0),1) as acceptance_rate,
  round(100.0 * count(*) filter (where sale_verified_scope in ('conversation','product')) / nullif(count(*),0),1) as conversation_conversion_rate,
  max(updated_at) as last_seen_at
from public.whatsapp_sales_opportunities_v17
where product_id is not null
  and product_code is not null
  and product_name is not null
group by
  dawaa_cycle_start_26(coalesce(opened_at::date, created_at::date)),
  dawaa_cycle_end_25(coalesce(opened_at::date, created_at::date)),
  branch, product_id, product_code, product_name;

drop view if exists public.whatsapp_product_demand_unresolved_v22;
create view public.whatsapp_product_demand_unresolved_v22 as
select
  dawaa_cycle_start_26(coalesce(opened_at::date, created_at::date)) as cycle_start,
  dawaa_cycle_end_25(coalesce(opened_at::date, created_at::date)) as cycle_end,
  branch,
  count(*) as unresolved_mentions,
  count(distinct root_source_id) as conversations_affected,
  count(distinct customer_id) filter (where customer_id is not null) as unique_customers
from public.whatsapp_sales_opportunities_v17
where product_id is null
group by
  dawaa_cycle_start_26(coalesce(opened_at::date, created_at::date)),
  dawaa_cycle_end_25(coalesce(opened_at::date, created_at::date)),
  branch;

create or replace view public.whatsapp_sales_leakage_monthly_v22 as
with base as (
  select
    dawaa_cycle_start_26(coalesce(opened_at::date, created_at::date)) as cycle_start,
    dawaa_cycle_end_25(coalesce(opened_at::date, created_at::date)) as cycle_end,
    branch,
    attributed_staff_id,
    attributed_staff_name,
    product_id,
    product_code,
    product_name,
    customer_id,
    root_source_id,
    current_stage,
    status,
    sale_verified_scope,
    leakage_reason,
    coalesce(
      nullif(evidence_json->>'leakageCode',''),
      case
        when current_stage = 'unavailable' then 'stock_unavailable'
        when leakage_reason ilike '%بديل%' then 'recommendation_pending'
        when leakage_reason ilike '%سعر%' or leakage_reason ilike '%غالي%' then 'price_objection'
        when leakage_reason ilike '%تأخر%' or leakage_reason ilike '%دقيقة%' then 'response_delay'
        when leakage_reason ilike '%إغلاق%' or leakage_reason ilike '%اغلاق%' then 'closing_gap'
        when leakage_reason ilike '%لم يظهر رد%' then 'customer_no_reply'
        when current_stage = 'rejected' or status = 'lost' then 'customer_rejected'
        when current_stage in ('alternative_offered','recommended') then 'recommendation_pending'
        else 'unknown'
      end
    ) as leakage_code
  from public.whatsapp_sales_opportunities_v17
  where analysis_version='product-demand-v22'
    and (status <> 'won' or sale_verified_scope <> 'product')
)
select
  cycle_start,cycle_end,branch,leakage_code,
  count(*) as cases_count,
  count(distinct customer_id) filter (where customer_id is not null) as unique_customers,
  count(distinct product_id) filter (where product_id is not null) as unique_products,
  count(*) filter (where attributed_staff_id is not null) as staff_attributed_cases
from base
where leakage_code is not null
group by cycle_start,cycle_end,branch,leakage_code;
