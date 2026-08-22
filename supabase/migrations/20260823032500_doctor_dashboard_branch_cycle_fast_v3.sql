create or replace function public.get_dashboard_workspace_v1(p_start date, p_end date, p_branch text default null)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
with filtered as materialized (
  select si.invoice_date::date sale_date,
    coalesce(nullif(btrim(si.branch),''),'غير محدد') branch,
    coalesce(nullif(si.net_total,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),nullif(si.total_amount,0),nullif(si.amount,0),0)::numeric value,
    nullif(btrim(si.customer_code),'') customer_code,
    lower(coalesce(si.customer_name,'')) customer_name_lower,
    coalesce(nullif(btrim(si.seller_name),''),nullif(btrim(si.staff_name),''),nullif(btrim(si.normalized_seller_name),'')) seller,
    public.normalize_cs_identity_name(coalesce(nullif(btrim(si.seller_name),''),nullif(btrim(si.staff_name),''),nullif(btrim(si.normalized_seller_name),''))) seller_norm
  from public.dawaa_sales_invoices_dashboard_v1 si
  where si.invoice_date>=p_start and si.invoice_date<(p_end+1)::timestamp
    and (p_branch is null or btrim(p_branch)='' or p_branch in ('كل الفروع','الكل','all') or si.branch=p_branch)
), marked as materialized (
  select *,customer_code is not null and customer_code not in ('0','-','null','NULL') and customer_name_lower not like '%غير مسجل%' linked from filtered
), summary as (
  select count(*)::bigint invoices_count,coalesce(sum(value),0)::numeric sales_total,(coalesce(sum(value),0)/nullif(count(*),0))::numeric avg_invoice,
    count(*) filter(where linked)::bigint linked_invoices,count(*) filter(where not linked)::bigint unregistered_customer_invoices,
    coalesce(sum(value) filter(where linked),0)::numeric linked_sales,coalesce(sum(value) filter(where not linked),0)::numeric unregistered_customer_sales,
    case when count(*)>0 then count(*) filter(where linked)::numeric*100/count(*) else 0 end customer_link_rate_percent,
    count(distinct customer_code) filter(where linked)::bigint linked_customers from marked
), daily as (
  select coalesce(jsonb_agg(jsonb_build_object('sale_date',sale_date,'branch',branch,'daily_sales',daily_sales,'invoices_count',invoices_count) order by sale_date,branch),'[]'::jsonb) payload
  from (select sale_date,branch,sum(value)::numeric daily_sales,count(*)::bigint invoices_count from marked group by 1,2) d
), branches as (
  select coalesce(jsonb_agg(jsonb_build_object('branch',branch,'sales_total',sales_total,'invoices_count',invoices_count,'avg_invoice',avg_invoice,'linked_customers',linked_customers) order by sales_total desc),'[]'::jsonb) payload
  from (select branch,sum(value)::numeric sales_total,count(*)::bigint invoices_count,(sum(value)/nullif(count(*),0))::numeric avg_invoice,count(distinct customer_code) filter(where linked)::bigint linked_customers from marked group by branch) b
), identity_catalog as (
  select public.normalize_cs_identity_name(s.name) norm,lower(coalesce(s.role,'')) role from public.staff s where coalesce(s.active,s.is_active,true)
  union all select public.normalize_cs_identity_name(a.alias_name),lower(coalesce(s.role,'')) from public.staff_identity_aliases a join public.staff s on s.id=a.staff_id where coalesce(a.active,true) and coalesce(s.active,s.is_active,true)
), doctor_grouped as (
  select seller,seller_norm,branch,sum(value)::numeric sales_total,count(*)::bigint invoices_count from marked where seller ~ '^\s*د([/\.\s]|$)' group by 1,2,3
), doctors as (
  select coalesce(jsonb_agg(jsonb_build_object('doctor_name',seller,'branch',branch,'sales_total',sales_total,'invoices_count',invoices_count,'avg_invoice',(sales_total/nullif(invoices_count,0))::numeric) order by sales_total desc),'[]'::jsonb) payload
  from (select g.* from doctor_grouped g where not exists(select 1 from identity_catalog i where i.norm=g.seller_norm and i.role ~ '(مساعد|assistant|inventory|مخزن|delivery|مندوب|cleaning|نظاف)') order by sales_total desc limit 50) x
)
select jsonb_build_object('summary',to_jsonb(s),'daily_sales',d.payload,'branch_distribution',b.payload,'doctor_sales',doc.payload,'audit',jsonb_build_object('clean_rows',s.invoices_count,'clean_total',round(s.sales_total,2),'audit_mode','workspace_operational_truth'))
from summary s cross join daily d cross join branches b cross join doctors doc;
$$;

create or replace function public.get_doctor_dashboard_branch_cycle_v1(p_branch text,p_start date,p_end date)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
with s as (
  select * from public.get_dashboard_sales_summary_v171(p_start,least(p_end,current_date),p_branch)
)
select jsonb_build_object(
  'branch',p_branch,'start_date',p_start,'end_date',least(p_end,current_date),
  'sales_total',coalesce(s.sales_total,0),'invoices_count',coalesce(s.invoices_count,0),
  'items_count',0,'avg_invoice',coalesce(s.avg_invoice,0)
) from s;
$$;

revoke all on function public.get_doctor_dashboard_branch_cycle_v1(text,date,date) from public;
grant execute on function public.get_doctor_dashboard_branch_cycle_v1(text,date,date) to authenticated;
