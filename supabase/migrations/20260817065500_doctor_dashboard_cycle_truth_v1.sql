-- Keep doctor dashboard review and invoice-quality metrics on the same live pharmacy cycle truth.

create or replace function public.get_doctor_cycle_reviews_v1(
  p_staff_id text,
  p_doctor_name text,
  p_start date,
  p_end date
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
with bounds as (
  select p_start as start_date, least(p_end,current_date) as end_date,
         nullif(trim(coalesce(p_staff_id,'')),'') as staff_key,
         public.normalize_cs_identity_name(p_doctor_name) as doctor_key
), scoped as (
  select r.*
  from public.conversation_sales_reviews r cross join bounds b
  where coalesce(
          (r.conversation_date at time zone 'Africa/Cairo')::date,
          r.review_date,
          (r.created_at at time zone 'Africa/Cairo')::date
        ) between b.start_date and b.end_date
    and (
      (b.staff_key is not null and (r.staff_id::text=b.staff_key or r.doctor_id::text=b.staff_key))
      or (
        r.staff_id is null and r.doctor_id is null
        and public.normalize_cs_identity_name(coalesce(nullif(r.doctor_name,''),r.staff_name))=b.doctor_key
      )
    )
)
select coalesce(jsonb_agg(to_jsonb(s) order by coalesce(s.conversation_date,s.created_at) desc, s.id desc),'[]'::jsonb)
from scoped s;
$function$;

grant execute on function public.get_doctor_cycle_reviews_v1(text,text,date,date) to anon, authenticated;

create or replace function public.get_doctor_invoice_quality_metrics(
  p_branch text,
  p_doctor_name text,
  p_cycle_start date,
  p_cycle_end date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_result jsonb;
  v_norm_name text := public.normalize_cs_identity_name(p_doctor_name);
begin
  with bounds as (
    select p_cycle_start as start_date, least(p_cycle_end,current_date) as end_date
  ), scoped as materialized (
    select
      public.normalize_cs_identity_name(coalesce(nullif(btrim(si.normalized_seller_name),''),si.seller_name,si.staff_name)) doctor_key,
      coalesce(nullif(btrim(si.normalized_seller_name),''),si.seller_name,si.staff_name) doctor_display,
      si.customer_code,
      coalesce(si.net_amount,si.discounted_amount,si.total_amount,si.amount,si.gross_amount,si.net_total,0) net_value,
      coalesce(si.line_items_count,0) items_count
    from public.dawaa_sales_invoices_dashboard_v1 si cross join bounds b
    where si.branch=p_branch
      and si.invoice_date>=b.start_date
      and si.invoice_date<(b.end_date+1)
      and coalesce(nullif(btrim(si.normalized_seller_name),''),si.seller_name,si.staff_name) is not null
  ), per_doctor as (
    select
      doctor_key,
      (array_agg(doctor_display order by doctor_display))[1] doctor_display,
      count(*) invoices,
      round(avg(net_value),0) avg_invoice,
      round(avg(nullif(items_count,0)),2) avg_items,
      count(distinct nullif(customer_code,'')) unique_customers
    from scoped
    group by doctor_key
    having count(*)>=3
  ), ranked as (
    select p.*,
      rank() over(order by avg_items desc nulls last) items_rank,
      rank() over(order by avg_invoice desc nulls last) invoice_rank,
      rank() over(order by unique_customers desc nulls last) customers_rank
    from per_doctor p
  ), d as (
    select
      coalesce(max(avg_invoice) filter(where doctor_key=v_norm_name),0) my_avg_invoice,
      coalesce(max(avg_items) filter(where doctor_key=v_norm_name),0) my_avg_items,
      coalesce(max(unique_customers) filter(where doctor_key=v_norm_name),0) my_unique_customers,
      coalesce(max(invoices) filter(where doctor_key=v_norm_name),0) my_invoices,
      max(items_rank) filter(where doctor_key=v_norm_name) my_items_rank,
      max(invoice_rank) filter(where doctor_key=v_norm_name) my_invoice_rank,
      max(customers_rank) filter(where doctor_key=v_norm_name) my_customers_rank,
      count(*) doctor_count,
      round(avg(unique_customers),1) branch_avg_customers,
      (array_agg(doctor_display order by items_rank,doctor_display))[1] top_items_name,
      (array_agg(avg_items order by items_rank,doctor_display))[1] top_items_value,
      (array_agg(doctor_key order by items_rank,doctor_display))[1] top_items_key,
      (array_agg(doctor_display order by invoice_rank,doctor_display))[1] top_invoice_name,
      (array_agg(avg_invoice order by invoice_rank,doctor_display))[1] top_invoice_value,
      (array_agg(doctor_key order by invoice_rank,doctor_display))[1] top_invoice_key,
      (array_agg(doctor_display order by customers_rank,doctor_display))[1] top_customers_name,
      (array_agg(unique_customers order by customers_rank,doctor_display))[1] top_customers_value,
      (array_agg(doctor_key order by customers_rank,doctor_display))[1] top_customers_key
    from ranked
  ), b as (
    select round(avg(net_value),0) branch_avg_invoice,
           round(avg(nullif(items_count,0)),2) branch_avg_items
    from scoped
  )
  select jsonb_build_object(
    'my_metrics',jsonb_build_object(
      'avg_invoice',d.my_avg_invoice,
      'avg_items_per_invoice',d.my_avg_items,
      'unique_customers',d.my_unique_customers,
      'invoices',d.my_invoices,
      'items_rank',d.my_items_rank,
      'invoice_rank',d.my_invoice_rank,
      'customers_rank',d.my_customers_rank,
      'branch_doctor_count',d.doctor_count
    ),
    'branch_avg',jsonb_build_object(
      'avg_invoice',coalesce(b.branch_avg_invoice,0),
      'avg_items_per_invoice',coalesce(b.branch_avg_items,0),
      'unique_customers',coalesce(d.branch_avg_customers,0)
    ),
    'top',jsonb_build_object(
      'items',jsonb_build_object('name',d.top_items_name,'value',coalesce(d.top_items_value,0),'is_me',d.top_items_key=v_norm_name),
      'invoice',jsonb_build_object('name',d.top_invoice_name,'value',coalesce(d.top_invoice_value,0),'is_me',d.top_invoice_key=v_norm_name),
      'customers',jsonb_build_object('name',d.top_customers_name,'value',coalesce(d.top_customers_value,0),'is_me',d.top_customers_key=v_norm_name)
    )
  ) into v_result
  from d cross join b;
  return coalesce(v_result,'{}'::jsonb);
end;
$function$;

grant execute on function public.get_doctor_invoice_quality_metrics(text,text,date,date) to anon, authenticated;
