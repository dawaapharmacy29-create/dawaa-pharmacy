-- Final sales truth contract after the 2026-08-21 invoice recovery.
-- Code 5,10,54,170,12820 are the ONLY sales-performance exclusions.
-- wholesale_b2b remains a customer-segmentation concern and must not alter sales KPIs.

create or replace function public.dawaa_is_sales_target_excluded_customer_v1(p_branch text,p_customer_code text)
returns boolean language sql stable set search_path to 'public','pg_catalog' as $$
  select btrim(coalesce(p_customer_code,'')) in ('5','10','54','170','12820');
$$;

create or replace view public.dawaa_sales_invoices_dashboard_v1 as
select si.*,1::bigint truth_rank
from public.sales_invoices si
where not public.dawaa_is_sales_target_excluded_customer_v1(si.branch,si.customer_code)
  and not (
    lower(coalesce(si.save_status,'')) ~ '(معلق|قيد|pending|draft|غير محفوظ)'
    or lower(coalesce(si.invoice_type,'')) ~ '(معلق|pending|draft)'
  );

create or replace function public.get_dashboard_sales_summary_v171(p_start date,p_end date,p_branch text default null)
returns table(invoices_count bigint,sales_total numeric,avg_invoice numeric,linked_invoices bigint,unregistered_customer_invoices bigint,linked_sales numeric,unregistered_customer_sales numeric,customer_link_rate_percent numeric,linked_customers bigint)
language sql stable security definer set search_path to 'public' as $$
with s as (
  select coalesce(nullif(si.net_total,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),nullif(si.total_amount,0),nullif(si.amount,0),0)::numeric v,
    nullif(btrim(si.customer_code),'') code,lower(coalesce(si.customer_name,'')) nm
  from public.dawaa_sales_invoices_dashboard_v1 si
  where si.invoice_date>=p_start and si.invoice_date<(p_end+1)::timestamp
    and (p_branch is null or btrim(p_branch)='' or p_branch in ('كل الفروع','الكل') or si.branch=p_branch)
), m as (
  select *,code is not null and code not in ('0','-','null','NULL') and nm not like '%غير مسجل%' linked from s
)
select count(*)::bigint,coalesce(sum(v),0)::numeric,(coalesce(sum(v),0)/nullif(count(*),0))::numeric,
  count(*) filter(where linked)::bigint,count(*) filter(where not linked)::bigint,
  coalesce(sum(v) filter(where linked),0)::numeric,coalesce(sum(v) filter(where not linked),0)::numeric,
  case when count(*)>0 then count(*) filter(where linked)::numeric*100/count(*) else 0 end,
  count(distinct code) filter(where linked)::bigint
from m;
$$;

create or replace function public.get_dashboard_daily_sales_v171(p_start date,p_end date,p_branch text default null)
returns table(sale_date date,branch text,daily_sales numeric,invoices_count bigint)
language sql stable security definer set search_path to 'public' as $$
select si.invoice_date::date,coalesce(nullif(btrim(si.branch),''),'غير محدد'),
  sum(coalesce(nullif(si.net_total,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),nullif(si.total_amount,0),nullif(si.amount,0),0))::numeric,
  count(*)::bigint
from public.dawaa_sales_invoices_dashboard_v1 si
where si.invoice_date>=p_start and si.invoice_date<(p_end+1)::timestamp
  and (p_branch is null or btrim(p_branch)='' or p_branch in ('كل الفروع','الكل') or si.branch=p_branch)
group by 1,2 order by 1,2;
$$;

create or replace function public.get_dashboard_branch_distribution_v171(p_start date,p_end date,p_branch text default null)
returns table(branch text,sales_total numeric,invoices_count bigint,avg_invoice numeric,linked_customers bigint)
language sql stable security definer set search_path to 'public' as $$
with s as (
  select coalesce(nullif(btrim(si.branch),''),'غير محدد') b,
    coalesce(nullif(si.net_total,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),nullif(si.total_amount,0),nullif(si.amount,0),0)::numeric v,
    nullif(btrim(si.customer_code),'') code,lower(coalesce(si.customer_name,'')) nm
  from public.dawaa_sales_invoices_dashboard_v1 si
  where si.invoice_date>=p_start and si.invoice_date<(p_end+1)::timestamp
    and (p_branch is null or btrim(p_branch)='' or p_branch in ('كل الفروع','الكل') or si.branch=p_branch)
)
select b,sum(v)::numeric,count(*)::bigint,(sum(v)/nullif(count(*),0))::numeric,
  count(distinct code) filter(where code is not null and code not in ('0','-','null','NULL') and nm not like '%غير مسجل%')::bigint
from s group by b order by 2 desc;
$$;

create or replace function public.get_dashboard_monthly_sales_v171(p_end date,p_branch text default null,p_months integer default 6)
returns table(month_start date,month_label text,branch text,sales_total numeric,invoices_count bigint,avg_invoice numeric)
language sql stable security definer set search_path to 'public' as $$
with bounds as (
  select (date_trunc('month',p_end)::date-((greatest(coalesce(p_months,6),1)-1)*interval '1 month'))::date start_date,
         (date_trunc('month',p_end)::date+interval '1 month')::date end_date
), s as (
  select date_trunc('month',si.invoice_date)::date m,coalesce(nullif(btrim(si.branch),''),'غير محدد') b,
    coalesce(nullif(si.net_total,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),nullif(si.total_amount,0),nullif(si.amount,0),0)::numeric v
  from public.dawaa_sales_invoices_dashboard_v1 si,bounds x
  where si.invoice_date>=x.start_date and si.invoice_date<x.end_date
    and (p_branch is null or btrim(p_branch)='' or p_branch in ('كل الفروع','الكل') or si.branch=p_branch)
)
select m,to_char(m,'YYYY-MM'),b,sum(v)::numeric,count(*)::bigint,(sum(v)/nullif(count(*),0))::numeric
from s group by m,b order by m,b;
$$;

create or replace function public.get_dashboard_sales_truth_audit_v1(p_start date,p_end date,p_branch text default null)
returns jsonb language sql stable security definer set search_path to 'public' as $$
with raw as (
 select si.id,si.branch,si.branch_name,si.invoice_number,si.invoice_no,si.invoice_date,si.sale_date,si.created_at,si.updated_at,
   coalesce(nullif(si.net_total,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),nullif(si.total_amount,0),nullif(si.amount,0),0)::numeric truth_value,
   public.dawaa_is_sales_target_excluded_customer_v1(si.branch,si.customer_code) excluded_code,
   (lower(coalesce(si.save_status,'')) ~ '(معلق|قيد|pending|draft|غير محفوظ)' or lower(coalesce(si.invoice_type,'')) ~ '(معلق|pending|draft)') nonfinal
 from public.sales_invoices si
 where si.invoice_date>=p_start and si.invoice_date<(p_end+1)::timestamp
   and (p_branch is null or p_branch='' or lower(p_branch)='all' or p_branch like '%كل%' or coalesce(nullif(btrim(si.branch),''),nullif(btrim(si.branch_name),''))=p_branch)
), eligible_ranked as (
 select r.*,row_number() over(partition by coalesce(nullif(btrim(r.branch),''),nullif(btrim(r.branch_name),''),'غير محدد'),
   case when nullif(btrim(coalesce(r.invoice_number,r.invoice_no)),'') is not null then btrim(coalesce(r.invoice_number,r.invoice_no)) else concat('__row__',r.id) end,
   r.invoice_date::date order by coalesce(r.updated_at,r.created_at) desc nulls last,r.created_at desc nulls last,r.id desc) truth_rank
 from raw r where not r.excluded_code and not r.nonfinal
), clean as (select * from eligible_ranked where truth_rank=1)
select jsonb_build_object(
 'raw_rows',(select count(*) from raw),'raw_total',(select round(coalesce(sum(truth_value),0),2) from raw),
 'excluded_internal_rows',(select count(*) from raw where excluded_code),'excluded_internal_value',(select round(coalesce(sum(truth_value),0),2) from raw where excluded_code),
 'nonfinal_rows',(select count(*) from raw where nonfinal and not excluded_code),'nonfinal_value',(select round(coalesce(sum(truth_value),0),2) from raw where nonfinal and not excluded_code),
 'duplicate_rows',(select count(*) from eligible_ranked where truth_rank>1),'duplicate_value',(select round(coalesce(sum(truth_value),0),2) from eligible_ranked where truth_rank>1),
 'clean_rows',(select count(*) from clean),'clean_total',(select round(coalesce(sum(truth_value),0),2) from clean),
 'adjustment_value',((select round(coalesce(sum(truth_value),0),2) from raw)-(select round(coalesce(sum(truth_value),0),2) from clean))
);
$$;

create or replace function public.calculate_manager_cycle_sales_target_v1(p_evaluation_type text,p_branch text,p_cycle_start date,p_as_of date)
returns jsonb language plpgsql stable set search_path to 'public','pg_catalog' as $$
declare v_sales numeric:=0; v_count integer:=0; v_target numeric:=0;
begin
 if p_cycle_start is null or p_as_of is null or p_as_of<p_cycle_start then raise exception 'invalid manager cycle period'; end if;
 if p_evaluation_type not in ('branch_manager','branches_manager','customer_service') then raise exception 'invalid evaluation type'; end if;
 select coalesce(sum(coalesce(nullif(net_total,0),nullif(net_amount,0),nullif(discounted_amount,0),nullif(total_amount,0),nullif(amount,0),0)),0),count(*)
 into v_sales,v_count from public.dawaa_sales_invoices_dashboard_v1
 where invoice_date>=p_cycle_start and invoice_date<(p_as_of+1)::timestamp
   and (p_branch is null or btrim(p_branch)='' or p_branch in ('الكل','كل الفروع') or branch=p_branch);
 select coalesce(sum(target_amount),0) into v_target from public.branch_sales_targets
 where coalesce(active,true) and target_amount>0
   and (p_branch is null or btrim(p_branch)='' or p_branch in ('الكل','كل الفروع') or branch_name=p_branch);
 return jsonb_build_object('sales_total',round(v_sales,2),'sales_invoices_count',v_count,'sales_target_amount',round(v_target,2),'sales_target_achievement_rate',case when v_target>0 then round(v_sales/v_target*100,1) else null end);
end; $$;

create or replace function public.get_doctor_dashboard_branch_cycle_v1(p_branch text,p_start date,p_end date)
returns jsonb language sql stable security definer set search_path to 'public','pg_catalog' as $$
with b as (select p_start start_date,least(p_end,current_date) end_date), t as (
 select count(*)::bigint n,coalesce(sum(coalesce(nullif(net_total,0),nullif(net_amount,0),nullif(discounted_amount,0),nullif(total_amount,0),nullif(amount,0),0)),0) sales,
   coalesce(sum(coalesce(line_items_count,0)),0) items
 from public.dawaa_sales_invoices_dashboard_v1,b
 where branch=p_branch and invoice_date>=b.start_date and invoice_date<(b.end_date+1)
)
select jsonb_build_object('branch',p_branch,'start_date',b.start_date,'end_date',b.end_date,'sales_total',t.sales,'invoices_count',t.n,'items_count',t.items,'avg_invoice',case when t.n>0 then t.sales/t.n else 0 end) from b cross join t;
$$;

create or replace function public.get_dashboard_doctor_sales_v171(p_start date,p_end date,p_branch text default null)
returns table(doctor_name text,branch text,sales_total numeric,invoices_count bigint,avg_invoice numeric)
language sql stable security definer set search_path to 'public','pg_catalog' as $$
with identity_catalog as (
  select public.normalize_cs_identity_name(s.name) norm,lower(coalesce(s.role,'')) role from public.staff s where coalesce(s.active,s.is_active,true)
  union all
  select public.normalize_cs_identity_name(a.alias_name),lower(coalesce(s.role,'')) from public.staff_identity_aliases a join public.staff s on s.id=a.staff_id where coalesce(a.active,true) and coalesce(s.active,s.is_active,true)
), grouped as (
 select coalesce(nullif(btrim(si.seller_name),''),nullif(btrim(si.staff_name),''),nullif(btrim(si.normalized_seller_name),'')) seller,
   public.normalize_cs_identity_name(coalesce(nullif(btrim(si.seller_name),''),nullif(btrim(si.staff_name),''),nullif(btrim(si.normalized_seller_name),''))) seller_norm,
   coalesce(nullif(btrim(si.branch),''),'غير محدد') branch,
   sum(coalesce(nullif(si.net_total,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),nullif(si.total_amount,0),nullif(si.amount,0),0))::numeric sales_total,count(*)::bigint invoices_count
 from public.dawaa_sales_invoices_dashboard_v1 si
 where si.invoice_date>=p_start and si.invoice_date<(p_end+1)::timestamp
   and (p_branch is null or btrim(p_branch)='' or p_branch in ('الكل','كل الفروع') or si.branch=p_branch)
   and coalesce(nullif(btrim(si.seller_name),''),nullif(btrim(si.staff_name),''),nullif(btrim(si.normalized_seller_name),'')) ~ '^\s*د([/\.\s]|$)'
 group by 1,2,3
), eligible as (
 select g.* from grouped g where not exists(select 1 from identity_catalog i where i.norm=g.seller_norm and i.role ~ '(مساعد|assistant|inventory|مخزن|delivery|مندوب|cleaning|نظاف)')
)
select seller,branch,sales_total,invoices_count,(sales_total/nullif(invoices_count,0))::numeric from eligible order by sales_total desc limit 50;
$$;

-- The UI consumes this view through get_dashboard_branch_targets_v171.
create or replace view public.dawaa_branch_target_progress_v13 as
with active_targets as (
 select bst.id target_id,bst.branch_name branch,
   case when extract(day from current_date)::int>=coalesce(bst.cycle_start_day,26)
     then make_date(extract(year from current_date)::int,extract(month from current_date)::int,coalesce(bst.cycle_start_day,26))
     else (make_date(extract(year from current_date)::int,extract(month from current_date)::int,coalesce(bst.cycle_start_day,26))-interval '1 month')::date end cycle_start,
   bst.target_amount from public.branch_sales_targets bst where coalesce(bst.active,false)
), targets as (select *, (cycle_start+interval '1 month - 1 day')::date cycle_end from active_targets),
invoice_rows as (
 select case when branch in ('فرع الشامي','الشامي') then 'فرع الشامي' when branch in ('فرع شكري','شكري') then 'فرع شكري' else coalesce(branch,'غير محدد') end branch,
   coalesce(invoice_date::date,sale_date,created_at::date) invoice_date,
   coalesce(nullif(net_total,0),nullif(net_amount,0),nullif(discounted_amount,0),nullif(total_amount,0),nullif(amount,0),0) amount
 from public.dawaa_sales_invoices_dashboard_v1
), sales as (
 select t.target_id,t.branch,t.cycle_start,t.cycle_end,t.target_amount,count(i.*)::integer invoices_count,coalesce(sum(i.amount),0) sales_total
 from targets t left join invoice_rows i on i.branch=t.branch and i.invoice_date between t.cycle_start and t.cycle_end group by 1,2,3,4,5
), p as (
 select s.*,greatest(least(current_date,s.cycle_end)-s.cycle_start+1,1) elapsed_days,greatest(s.cycle_end-s.cycle_start+1,1) total_days,
   round(s.sales_total/nullif(s.target_amount,0)*100,2) achievement_percent,
   round(s.sales_total/greatest(least(current_date,s.cycle_end)-s.cycle_start+1,1)::numeric,2) avg_daily_sales,
   round(greatest(s.target_amount-s.sales_total,0),2) remaining_amount from sales s
)
select target_id,branch,cycle_start,cycle_end,target_amount,invoices_count,sales_total,elapsed_days,total_days,achievement_percent,avg_daily_sales,remaining_amount,
 round(target_amount/total_days::numeric,2) required_daily_sales,
 round(remaining_amount/greatest(cycle_end-current_date+1,1)::numeric,2) required_daily_remaining,
 round(avg_daily_sales*total_days::numeric,2) projected_sales,
 round(avg_daily_sales*total_days::numeric/nullif(target_amount,0)*100,2) projected_achievement_percent,
 case when sales_total>=target_amount then 'تم تحقيق التارجت' when avg_daily_sales*total_days/nullif(target_amount,0)>=1 then 'على المسار الصحيح' when avg_daily_sales*total_days/nullif(target_amount,0)>=0.85 then 'قريب لكن يحتاج متابعة يومية' else 'خطر عدم تحقيق التارجت' end target_status,
 case when sales_total>=target_amount then 'حافظ على نفس الأداء وركز على جودة الخدمة وعدم فقد العملاء.' when avg_daily_sales*total_days/nullif(target_amount,0)>=1 then 'الأداء جيد. ركز على العملاء المهمين وزيادة متوسط الفاتورة.' when avg_daily_sales*total_days/nullif(target_amount,0)>=0.85 then 'راجع الشيفت الأقل مبيعًا، فعّل متابعة العملاء المهمين، واطلب من الفريق عروض مكملة مع كل فاتورة.' else 'اجتماع عاجل مع مدير الفرع: متابعة العملاء المتوقفين، مراجعة الرواكد، تفعيل عروض يومية، ومراقبة متوسط الفاتورة لكل شيفت.' end manager_advice
from p order by branch,cycle_start desc;
