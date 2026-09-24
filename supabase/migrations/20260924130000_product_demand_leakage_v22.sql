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
  and analysis_version='product-demand-v22'
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
        else null
      end
    ) as leakage_code
  from public.whatsapp_sales_opportunities_v17
  where analysis_version='product-demand-v22'
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


create or replace view public.whatsapp_product_demand_backfill_status_v22 as
select
  count(*) filter (where raw_text is not null and length(trim(raw_text)) > 0) as analyzable_sources,
  count(*) filter (
    where raw_text is not null and length(trim(raw_text)) > 0
      and coalesce(analysis_json->>'productDemandVersion','') = 'product-demand-v22'
  ) as analyzed_v22,
  count(*) filter (
    where raw_text is not null and length(trim(raw_text)) > 0
      and coalesce(analysis_json->>'productDemandVersion','') <> 'product-demand-v22'
  ) as remaining_sources,
  round(
    100.0 * count(*) filter (
      where raw_text is not null and length(trim(raw_text)) > 0
        and coalesce(analysis_json->>'productDemandVersion','') = 'product-demand-v22'
    ) / nullif(count(*) filter (where raw_text is not null and length(trim(raw_text)) > 0),0),
    1
  ) as completion_percent
from public.whatsapp_review_sources;


create or replace view public.whatsapp_product_demand_detail_v22 as
select
  o.id as opportunity_id,
  o.root_source_id as source_id,
  o.branch,
  dawaa_cycle_start_26(coalesce(o.opened_at::date, o.created_at::date)) as cycle_start,
  dawaa_cycle_end_25(coalesce(o.opened_at::date, o.created_at::date)) as cycle_end,
  o.customer_id,
  o.customer_code,
  o.customer_name,
  o.customer_phone,
  o.attributed_staff_id,
  o.attributed_staff_name,
  o.product_id,
  o.product_code,
  o.product_name,
  o.quantity,
  o.current_stage,
  o.status,
  o.confidence,
  o.sale_verified_scope,
  o.matched_invoice_id,
  o.matched_invoice_number,
  o.matched_invoice_value,
  o.leakage_reason,
  nullif(o.evidence_json->>'leakageCode','') as leakage_code,
  o.opened_at,
  o.last_stage_at,
  o.updated_at
from public.whatsapp_sales_opportunities_v17 o
where o.analysis_version='product-demand-v22';

create or replace view public.whatsapp_product_demand_cycle_summary_v22 as
select
  cycle_start,
  cycle_end,
  count(*) as opportunities,
  count(distinct product_id) filter (where product_id is not null) as canonical_products,
  count(distinct customer_id) filter (where customer_id is not null) as unique_customers,
  count(*) filter (where product_id is null) as unresolved_mentions,
  count(*) filter (where current_stage='unavailable') as unavailable_cases,
  count(*) filter (where leakage_code='price_objection') as price_objections,
  count(*) filter (where leakage_code='response_delay') as response_delay_cases,
  count(*) filter (where leakage_code='closing_gap') as closing_gap_cases,
  count(*) filter (where current_stage in ('accepted','order_confirmed','awaiting_invoice','verified_sale','needs_followup')) as accepted_or_later_count
from public.whatsapp_product_demand_detail_v22
group by cycle_start,cycle_end
order by cycle_start desc;
