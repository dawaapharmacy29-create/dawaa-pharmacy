create or replace function public.get_quarterly_staff_sales_metrics_v1(
  p_start date,
  p_end date
)
returns table(
  staff_id uuid,
  doctor_name text,
  branch text,
  sales numeric,
  invoices bigint,
  avg_invoice numeric,
  customers_count bigint,
  data_quality numeric,
  top_customer_name text,
  top_customer_value numeric
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
with identity_catalog as (
  select
    s.id as staff_id,
    s.name as staff_name,
    s.branch as staff_branch,
    public.normalize_cs_identity_name(s.name) as norm,
    1000 as priority
  from public.staff s
  where coalesce(s.active,s.is_active,true)
  union all
  select
    s.id,
    s.name,
    s.branch,
    public.normalize_cs_identity_name(a.alias_name),
    coalesce(a.priority,0)
  from public.staff_identity_aliases a
  join public.staff s on s.id=a.staff_id
  where coalesce(a.active,true) and coalesce(s.active,s.is_active,true)
), invoice_base as (
  select
    public.normalize_cs_identity_name(
      coalesce(nullif(btrim(si.seller_name),''),nullif(btrim(si.staff_name),''),nullif(btrim(si.normalized_seller_name),''))
    ) as seller_norm,
    coalesce(nullif(btrim(si.seller_name),''),nullif(btrim(si.staff_name),''),nullif(btrim(si.normalized_seller_name),''),'غير محدد') as seller_name,
    coalesce(nullif(btrim(si.branch),''),'غير محدد') as invoice_branch,
    coalesce(nullif(si.net_total,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),nullif(si.total_amount,0),nullif(si.amount,0),0)::numeric as amount,
    coalesce(
      nullif(btrim(si.customer_code),''),
      nullif(btrim(si.customer_phone),''),
      nullif(btrim(si.customer_name),'')
    ) as customer_key,
    coalesce(nullif(btrim(si.customer_name),''),nullif(btrim(si.customer_code),''),nullif(btrim(si.customer_phone),''),'عميل غير محدد') as customer_name
  from public.dawaa_sales_invoices_dashboard_v1 si
  where si.invoice_date >= p_start
    and si.invoice_date < (p_end + 1)::timestamp
), resolved as (
  select
    coalesce(ic.staff_id, null::uuid) as staff_id,
    coalesce(ic.staff_name, ib.seller_name) as doctor_name,
    case when ic.staff_branch in ('فرع الشامي','فرع شكري') then ic.staff_branch else ib.invoice_branch end as branch,
    ib.amount,
    ib.customer_key,
    ib.customer_name,
    ib.seller_norm
  from invoice_base ib
  left join lateral (
    select i.staff_id,i.staff_name,i.staff_branch
    from identity_catalog i
    where i.norm=ib.seller_norm
    order by
      case when i.staff_branch=ib.invoice_branch then 0 else 1 end,
      i.priority desc,
      i.staff_name
    limit 1
  ) ic on true
), customer_totals as (
  select staff_id,doctor_name,branch,customer_key,max(customer_name) as customer_name,sum(amount)::numeric as customer_sales
  from resolved
  where customer_key is not null
  group by staff_id,doctor_name,branch,customer_key
), ranked_customers as (
  select c.*, row_number() over(partition by staff_id,doctor_name,branch order by customer_sales desc,customer_name) as rn
  from customer_totals c
), agg as (
  select
    r.staff_id,
    r.doctor_name,
    r.branch,
    sum(r.amount)::numeric as sales,
    count(*)::bigint as invoices,
    count(distinct r.customer_key)::bigint as customers_count,
    count(*) filter(where r.customer_key is not null and r.seller_norm <> '')::numeric / nullif(count(*),0) as data_quality
  from resolved r
  group by r.staff_id,r.doctor_name,r.branch
)
select
  a.staff_id,
  a.doctor_name,
  a.branch,
  a.sales,
  a.invoices,
  case when a.invoices>0 then a.sales/a.invoices else 0 end::numeric as avg_invoice,
  a.customers_count,
  coalesce(a.data_quality,0)::numeric as data_quality,
  rc.customer_name as top_customer_name,
  rc.customer_sales as top_customer_value
from agg a
left join ranked_customers rc
  on rc.rn=1
 and rc.doctor_name=a.doctor_name
 and rc.branch=a.branch
 and rc.staff_id is not distinct from a.staff_id
order by a.sales desc;
$function$;

grant execute on function public.get_quarterly_staff_sales_metrics_v1(date,date) to authenticated, anon;
