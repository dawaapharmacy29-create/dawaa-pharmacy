-- Canonical internal/system customer codes are controlled by customer_flags.
-- These codes are saved in raw sales_invoices for audit, but MUST NEVER enter sales/doctor analytics.
insert into public.customer_flags (customer_code,flag_key,flag_label,is_active,notes,created_by,updated_at)
select x.code,'system_generic_code','كود داخلي مستبعد من تحليلات المبيعات',true,'بيع داخلي/تسوية/عجز/توالف - لا يدخل التارجت أو مسابقات الدكاترة أو مؤشرات الأداء','chatgpt_v27',now()
from (values ('5'),('54'),('170'),('10'),('12820'),('20'),('4902')) x(code)
where not exists (select 1 from public.customer_flags f where f.flag_key='system_generic_code' and btrim(coalesce(f.customer_code,''))=x.code);
update public.customer_flags set is_active=true,updated_at=now(),notes=coalesce(notes,'') || case when coalesce(notes,'') ilike '%تحليلات المبيعات%' then '' else ' | مستبعد من كل تحليلات المبيعات' end
where flag_key='system_generic_code' and btrim(coalesce(customer_code,'')) in ('5','54','170','10','12820','20','4902');

create or replace view public.dawaa_sales_analysis_audit_v2 as
with raw as (
  select coalesce(invoice_date::date,sale_date,created_at::date) sale_date,
         coalesce(nullif(btrim(branch),''),nullif(btrim(branch_name),''),'غير محدد') branch,
         count(*) raw_invoices,
         sum(coalesce(net_total,net_amount,discounted_amount,total_amount,amount,0)) raw_sales,
         sum(coalesce(line_items_count,0)) raw_items,
         count(*) filter (where public.dawaa_is_sales_target_excluded_customer_v1(branch,customer_code)) excluded_invoices,
         sum(coalesce(net_total,net_amount,discounted_amount,total_amount,amount,0)) filter (where public.dawaa_is_sales_target_excluded_customer_v1(branch,customer_code)) excluded_sales,
         sum(coalesce(line_items_count,0)) filter (where public.dawaa_is_sales_target_excluded_customer_v1(branch,customer_code)) excluded_items,
         count(*) filter (where lower(coalesce(save_status,'')) ~ '(معلق|قيد|pending|draft|غير محفوظ)' or lower(coalesce(invoice_type,'')) ~ '(معلق|pending|draft)') pending_invoices
  from public.sales_invoices group by 1,2
), clean as (
  select coalesce(invoice_date::date,sale_date,created_at::date) sale_date,
         coalesce(nullif(btrim(branch),''),nullif(btrim(branch_name),''),'غير محدد') branch,
         count(*) clean_invoices,
         sum(coalesce(net_total,net_amount,discounted_amount,total_amount,amount,0)) clean_sales,
         sum(coalesce(line_items_count,0)) clean_items
  from public.dawaa_sales_invoices_dashboard_v1 group by 1,2
)
select r.sale_date,r.branch,r.raw_invoices,r.raw_sales,r.raw_items,
       coalesce(r.excluded_invoices,0) excluded_invoices,coalesce(r.excluded_sales,0) excluded_sales,coalesce(r.excluded_items,0) excluded_items,
       coalesce(r.pending_invoices,0) pending_invoices,
       coalesce(c.clean_invoices,0) clean_invoices,coalesce(c.clean_sales,0) clean_sales,coalesce(c.clean_items,0) clean_items
from raw r left join clean c using(sale_date,branch);

create or replace function public.sum_branch_sales_since(p_branch text,p_since date)
returns table(total numeric)
language sql stable set search_path='public','pg_catalog' as $$
 select coalesce(sum(coalesce(net_total,net_amount,discounted_amount,total_amount,amount,0)),0)
 from public.dawaa_sales_invoices_dashboard_v1
 where branch=p_branch and coalesce(sale_date,invoice_date::date,created_at::date)>=p_since;
$$;

create or replace function public.get_dashboard_daily_sales_v171(p_start date,p_end date,p_branch text default null)
returns table(sale_date date,branch text,daily_sales numeric,invoices_count bigint)
language sql stable security definer set search_path='public' as $$
 select coalesce(si.invoice_date::date,si.sale_date),coalesce(nullif(btrim(si.branch),''),'غير محدد'),
        coalesce(sum(coalesce(si.net_total,si.net_amount,si.discounted_amount,si.total_amount,si.amount,0)),0)::numeric,count(*)::bigint
 from public.dawaa_sales_invoices_dashboard_v1 si
 where coalesce(si.invoice_date::date,si.sale_date) between p_start and p_end
   and (p_branch is null or btrim(p_branch)='' or p_branch in ('كل الفروع','الكل') or si.branch=p_branch)
 group by 1,2 order by 1,2;
$$;

create or replace function public.get_dashboard_branch_distribution_v171(p_start date,p_end date,p_branch text default null)
returns table(branch text,sales_total numeric,invoices_count bigint,avg_invoice numeric,linked_customers bigint)
language sql stable security definer set search_path='public' as $$
 with s as (
   select coalesce(nullif(btrim(si.branch),''),'غير محدد') b,
          coalesce(si.net_total,si.net_amount,si.discounted_amount,si.total_amount,si.amount,0) v,
          nullif(btrim(si.customer_code),'') code,lower(coalesce(si.customer_name,'')) nm
   from public.dawaa_sales_invoices_dashboard_v1 si
   where coalesce(si.invoice_date::date,si.sale_date) between p_start and p_end
     and (p_branch is null or btrim(p_branch)='' or p_branch in ('كل الفروع','الكل') or si.branch=p_branch)
 )
 select b,sum(v)::numeric,count(*)::bigint,(sum(v)/nullif(count(*),0))::numeric,
        count(distinct code) filter(where code is not null and code not in ('0','-','null','NULL') and nm not like '%غير مسجل%')::bigint
 from s group by b order by 2 desc;
$$;

create or replace function public.get_dashboard_doctor_sales_v171(p_start date,p_end date,p_branch text default null)
returns table(doctor_name text,branch text,sales_total numeric,invoices_count bigint,avg_invoice numeric)
language sql stable security definer set search_path='public' as $$
 select coalesce(nullif(btrim(si.seller_name),''),nullif(btrim(si.staff_name),''),'غير مربوط') doctor_name,
        coalesce(nullif(btrim(si.branch),''),'غير محدد') branch,
        sum(coalesce(si.net_total,si.net_amount,si.discounted_amount,si.total_amount,si.amount,0))::numeric sales_total,
        count(*)::bigint invoices_count,
        (sum(coalesce(si.net_total,si.net_amount,si.discounted_amount,si.total_amount,si.amount,0))/nullif(count(*),0))::numeric avg_invoice
 from public.dawaa_sales_invoices_dashboard_v1 si
 where coalesce(si.invoice_date::date,si.sale_date) between p_start and p_end
   and (p_branch is null or btrim(p_branch)='' or p_branch in ('كل الفروع','الكل') or si.branch=p_branch)
   and coalesce(si.seller_name,si.staff_name,'') !~* '(delivery|courier|rider|دليفري|توصيل|مندوب)'
   and coalesce(nullif(btrim(si.seller_name),''),nullif(btrim(si.staff_name),''),'غير مربوط') not in ('غير مربوط','غير محدد')
 group by 1,2 order by 3 desc limit 50;
$$;

create or replace function public.get_dashboard_sales_summary_v171(p_start date,p_end date,p_branch text default null)
returns table(invoices_count bigint,sales_total numeric,avg_invoice numeric,linked_invoices bigint,unregistered_customer_invoices bigint,linked_sales numeric,unregistered_customer_sales numeric,customer_link_rate_percent numeric,linked_customers bigint)
language sql stable security definer set search_path='public' as $$
 with s as (
  select coalesce(si.net_total,si.net_amount,si.discounted_amount,si.total_amount,si.amount,0) v,
         nullif(btrim(si.customer_code),'') code,lower(coalesce(si.customer_name,'')) nm
  from public.dawaa_sales_invoices_dashboard_v1 si
  where coalesce(si.invoice_date::date,si.sale_date) between p_start and p_end
    and (p_branch is null or btrim(p_branch)='' or p_branch in ('كل الفروع','الكل') or si.branch=p_branch)
 ),m as (select *,code is not null and code not in ('0','-','null','NULL') and nm not like '%غير مسجل%' linked from s)
 select count(*)::bigint,coalesce(sum(v),0)::numeric,(coalesce(sum(v),0)/nullif(count(*),0))::numeric,
        count(*) filter(where linked)::bigint,count(*) filter(where not linked)::bigint,
        coalesce(sum(v) filter(where linked),0)::numeric,coalesce(sum(v) filter(where not linked),0)::numeric,
        case when count(*)>0 then count(*) filter(where linked)::numeric*100/count(*) else 0 end,
        count(distinct code) filter(where linked)::bigint from m;
$$;

create or replace function public.get_dashboard_monthly_sales_v171(p_end date,p_branch text default null,p_months integer default 6)
returns table(month_start date,month_label text,branch text,sales_total numeric,invoices_count bigint,avg_invoice numeric)
language sql stable security definer set search_path='public' as $$
 with s as (
  select date_trunc('month',coalesce(si.invoice_date,si.sale_date::timestamp))::date m,
         coalesce(nullif(btrim(si.branch),''),'غير محدد') b,
         coalesce(si.net_total,si.net_amount,si.discounted_amount,si.total_amount,si.amount,0) v
  from public.dawaa_sales_invoices_dashboard_v1 si
  where coalesce(si.invoice_date::date,si.sale_date) >= (date_trunc('month',p_end)::date - ((greatest(coalesce(p_months,6),1)-1)*interval '1 month'))::date
    and coalesce(si.invoice_date::date,si.sale_date) < (date_trunc('month',p_end)::date + interval '1 month')
    and (p_branch is null or btrim(p_branch)='' or p_branch in ('كل الفروع','الكل') or si.branch=p_branch)
 )
 select m,to_char(m,'YYYY-MM'),b,sum(v)::numeric,count(*)::bigint,(sum(v)/nullif(count(*),0))::numeric from s group by m,b order by m,b;
$$;

create or replace function public.get_doctor_invoice_quality_metrics(p_branch text,p_doctor_name text,p_cycle_start date,p_cycle_end date)
returns jsonb language plpgsql stable security definer set search_path='public' as $$
declare v_result jsonb; v_norm_name text:=normalize_cs_name(p_doctor_name);
begin
 with scoped as materialized (
   select normalize_cs_name(coalesce(nullif(btrim(si.normalized_seller_name),''),si.seller_name,si.staff_name)) doctor_key,
          coalesce(nullif(btrim(si.normalized_seller_name),''),si.seller_name,si.staff_name) doctor_display,
          si.customer_code,coalesce(si.net_total,si.net_amount,si.discounted_amount,si.total_amount,si.amount,0) net_value,
          coalesce(si.line_items_count,0) items_count
   from public.dawaa_sales_invoices_dashboard_v1 si
   where si.branch=p_branch and coalesce(si.invoice_date::date,si.sale_date) between p_cycle_start and p_cycle_end
     and coalesce(nullif(btrim(si.normalized_seller_name),''),si.seller_name,si.staff_name) is not null
 ), per_doctor as (
   select doctor_key,(array_agg(doctor_display order by doctor_display))[1] doctor_display,count(*) invoices,
          round(avg(net_value),0) avg_invoice,round(avg(nullif(items_count,0)),2) avg_items,count(distinct nullif(customer_code,'')) unique_customers
   from scoped group by doctor_key having count(*)>=3
 ), ranked as (
   select p.*,rank() over(order by avg_items desc nulls last) items_rank,rank() over(order by avg_invoice desc nulls last) invoice_rank,rank() over(order by unique_customers desc nulls last) customers_rank from per_doctor p
 ), d as (
   select coalesce(max(avg_invoice) filter(where doctor_key=v_norm_name),0) my_avg_invoice,
          coalesce(max(avg_items) filter(where doctor_key=v_norm_name),0) my_avg_items,
          coalesce(max(unique_customers) filter(where doctor_key=v_norm_name),0) my_unique_customers,
          coalesce(max(invoices) filter(where doctor_key=v_norm_name),0) my_invoices,
          max(items_rank) filter(where doctor_key=v_norm_name) my_items_rank,max(invoice_rank) filter(where doctor_key=v_norm_name) my_invoice_rank,max(customers_rank) filter(where doctor_key=v_norm_name) my_customers_rank,
          count(*) doctor_count,round(avg(unique_customers),1) branch_avg_customers,
          (array_agg(doctor_display order by items_rank,doctor_display))[1] top_items_name,(array_agg(avg_items order by items_rank,doctor_display))[1] top_items_value,(array_agg(doctor_key order by items_rank,doctor_display))[1] top_items_key,
          (array_agg(doctor_display order by invoice_rank,doctor_display))[1] top_invoice_name,(array_agg(avg_invoice order by invoice_rank,doctor_display))[1] top_invoice_value,(array_agg(doctor_key order by invoice_rank,doctor_display))[1] top_invoice_key,
          (array_agg(doctor_display order by customers_rank,doctor_display))[1] top_customers_name,(array_agg(unique_customers order by customers_rank,doctor_display))[1] top_customers_value,(array_agg(doctor_key order by customers_rank,doctor_display))[1] top_customers_key
   from ranked
 ), b as (select round(avg(net_value),0) branch_avg_invoice,round(avg(nullif(items_count,0)),2) branch_avg_items from scoped)
 select jsonb_build_object('my_metrics',jsonb_build_object('avg_invoice',d.my_avg_invoice,'avg_items_per_invoice',d.my_avg_items,'unique_customers',d.my_unique_customers,'invoices',d.my_invoices,'items_rank',d.my_items_rank,'invoice_rank',d.my_invoice_rank,'customers_rank',d.my_customers_rank,'branch_doctor_count',d.doctor_count),'branch_avg',jsonb_build_object('avg_invoice',coalesce(b.branch_avg_invoice,0),'avg_items_per_invoice',coalesce(b.branch_avg_items,0),'unique_customers',coalesce(d.branch_avg_customers,0)),'top',jsonb_build_object('items',jsonb_build_object('name',d.top_items_name,'value',coalesce(d.top_items_value,0),'is_me',d.top_items_key=v_norm_name),'invoice',jsonb_build_object('name',d.top_invoice_name,'value',coalesce(d.top_invoice_value,0),'is_me',d.top_invoice_key=v_norm_name),'customers',jsonb_build_object('name',d.top_customers_name,'value',coalesce(d.top_customers_value,0),'is_me',d.top_customers_key=v_norm_name))) into v_result from d cross join b;
 return coalesce(v_result,'{}'::jsonb);
end; $$;

refresh materialized view public.staff_sales_summary;
select pg_notify('pgrst','reload schema');
