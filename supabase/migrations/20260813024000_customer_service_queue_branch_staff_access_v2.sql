-- Queue-specific access scope: pharmacists and branch staff can work only their own branch.
create or replace function public.dawaa_customer_service_queue_scope_v2()
returns text language sql stable security definer set search_path=public,pg_catalog as $$
  select case
    when lower(coalesce(a.role,'')) in ('admin','owner','general_manager','executive_manager','branches_manager','manager') then 'ALL'
    when lower(coalesce(a.role,'')) in ('branch_manager','customer_service_manager','customer_service','pharmacist','shift_supervisor_morning','shift_supervisor_evening','shift_supervisor_night') then lower(btrim(coalesce(a.branch,'')))
    else '' end
  from public.staff_accounts a
  where a.id=public.dawaa_current_staff_account_id_strict() and coalesce(a.active,false) and coalesce(a.can_login,false)
  limit 1
$$;
grant execute on function public.dawaa_customer_service_queue_scope_v2() to anon,authenticated;

-- Rebind queue reads to the queue-specific scope while preserving the current-three-calendar-month definition.
create or replace function public.get_customer_service_recent_top50_v2(p_days integer default 90)
returns table(customer_rank integer,branch text,customer_code text,customer_name text,customer_phone text,recent_sales numeric,invoice_count bigint,active_months integer,avg_invoice numeric,last_purchase date,importance_score numeric)
language sql stable security definer set search_path=public,pg_catalog as $$
with scope as (select public.dawaa_customer_service_queue_scope_v2() value), base as (
 select s.branch,btrim(s.customer_code) customer_code,max(nullif(btrim(s.customer_name),'')) customer_name,max(nullif(btrim(coalesce(s.customer_phone,s.phone)),'')) customer_phone,
 sum(coalesce(s.net_amount,s.net_total,s.total_amount,s.amount,0))::numeric recent_sales,count(*)::bigint invoice_count,
 count(distinct date_trunc('month',s.invoice_date))::integer active_months,avg(coalesce(s.net_amount,s.net_total,s.total_amount,s.amount,0))::numeric avg_invoice,max(s.invoice_date)::date last_purchase
 from public.sales_invoices s cross join scope sc
 where s.invoice_date >= date_trunc('month',current_date)-interval '2 months' and s.invoice_date < (current_date+1)::timestamptz
 and s.branch in ('فرع شكري','فرع الشامي') and (sc.value='ALL' or lower(btrim(s.branch))=sc.value)
 and nullif(btrim(s.customer_code),'') is not null and btrim(s.customer_code) not in ('5','10','54','170','12820')
 and nullif(btrim(s.customer_name),'') is not null and btrim(s.customer_name) not in ('عميل الصيدلية','عميل نقدي','عميل عابر','كاش','عميل','.')
 and coalesce(s.net_amount,s.net_total,s.total_amount,s.amount,0)>0 group by s.branch,btrim(s.customer_code)),
scored as (select b.*,round((b.recent_sales*(0.70+0.10*least(b.active_months,3)))::numeric,2) importance_score from base b),
ranked as (select s.*,row_number() over(partition by s.branch order by s.importance_score desc,s.recent_sales desc,s.invoice_count desc,s.last_purchase desc,s.customer_code)::integer customer_rank from scored s)
select r.customer_rank,r.branch,r.customer_code,r.customer_name,r.customer_phone,round(r.recent_sales,2),r.invoice_count,r.active_months,round(r.avg_invoice,2),r.last_purchase,r.importance_score from ranked r where r.customer_rank<=50 order by r.branch,r.customer_rank;
$$;

create or replace function public.get_customer_service_plus500_v2(p_date date default (current_date-1))
returns table(branch text,customer_code text,customer_name text,customer_phone text,qualifying_invoice_count bigint,qualifying_total numeric,invoice_values jsonb,highest_invoice numeric)
language sql stable security definer set search_path=public,pg_catalog as $$
with scope as (select public.dawaa_customer_service_queue_scope_v2() value), eligible_invoices as (
 select s.branch,btrim(s.customer_code) customer_code,nullif(btrim(s.customer_name),'') customer_name,nullif(btrim(coalesce(s.customer_phone,s.phone)),'') customer_phone,
 coalesce(s.net_amount,s.net_total,s.total_amount,s.amount,0)::numeric invoice_value,coalesce(s.invoice_no,s.invoice_number,'') invoice_number
 from public.sales_invoices s cross join scope sc where s.sale_date=p_date and s.branch in ('فرع شكري','فرع الشامي') and (sc.value='ALL' or lower(btrim(s.branch))=sc.value)
 and nullif(btrim(s.customer_code),'') is not null and btrim(s.customer_code) not in ('5','10','54','170','12820')
 and nullif(btrim(s.customer_name),'') is not null and btrim(s.customer_name) not in ('عميل الصيدلية','عميل نقدي','عميل عابر','كاش','عميل','.')
 and coalesce(s.net_amount,s.net_total,s.total_amount,s.amount,0)>=500)
select e.branch,e.customer_code,max(e.customer_name),max(e.customer_phone),count(*)::bigint,round(sum(e.invoice_value),2),
 jsonb_agg(jsonb_build_object('invoiceNumber',e.invoice_number,'value',round(e.invoice_value,2)) order by e.invoice_value desc),round(max(e.invoice_value),2)
from eligible_invoices e group by e.branch,e.customer_code order by e.branch,sum(e.invoice_value) desc,e.customer_code;
$$;

create or replace function public.get_customer_points_daily20_v2(p_date date default current_date)
returns table(daily_order integer,branch text,customer_code text,customer_name text,customer_phone text,points_balance numeric,last_contacted_at timestamptz,ledger_entries bigint)
language sql stable security definer set search_path=public,pg_catalog as $$
with scope as (select public.dawaa_customer_service_queue_scope_v2() value), balances as (
 select l.branch,btrim(l.customer_code) customer_code,max(nullif(btrim(l.customer_name),'')) customer_name,max(nullif(btrim(l.customer_phone),'')) customer_phone,
 sum(coalesce(l.points_amount,0))::numeric points_balance,max(l.contacted_at) last_contacted_at,count(*)::bigint ledger_entries
 from public.customer_points_ledger l cross join scope sc where l.branch in ('فرع شكري','فرع الشامي') and (sc.value='ALL' or lower(btrim(l.branch))=sc.value)
 and nullif(btrim(l.customer_code),'') is not null and btrim(l.customer_code) not in ('5','10','54','170','12820')
 and nullif(btrim(l.customer_name),'') is not null and btrim(l.customer_name) not in ('عميل الصيدلية','عميل نقدي','عميل عابر','كاش','عميل','.')
 and (l.expiry_date is null or l.expiry_date>=p_date) group by l.branch,btrim(l.customer_code) having sum(coalesce(l.points_amount,0))>0),
ranked as (select b.*,row_number() over(partition by b.branch order by b.last_contacted_at asc nulls first,b.points_balance desc,b.customer_code)::integer rn from balances b)
select row_number() over(order by r.branch,r.rn)::integer,r.branch,r.customer_code,r.customer_name,r.customer_phone,round(r.points_balance,2),r.last_contacted_at,r.ledger_entries from ranked r where r.rn<=10 order by r.branch,r.rn;
$$;

create or replace function public.mark_customer_points_contacted_v2(p_branch text,p_customer_code text,p_actor_name text default null)
returns integer language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_count integer; v_scope text;
begin v_scope:=public.dawaa_customer_service_queue_scope_v2(); if v_scope='' or (v_scope<>'ALL' and v_scope<>lower(btrim(p_branch))) then raise exception 'not authorized for this branch'; end if;
 update public.customer_points_ledger set contacted=true,contacted_at=now(),contacted_by_name=coalesce(nullif(btrim(p_actor_name),''),'خدمة العملاء'),updated_at=now() where branch=p_branch and btrim(customer_code)=btrim(p_customer_code);
 get diagnostics v_count=row_count; return v_count; end;$$;

grant execute on function public.get_customer_service_recent_top50_v2(integer) to anon,authenticated;
grant execute on function public.get_customer_service_plus500_v2(date) to anon,authenticated;
grant execute on function public.get_customer_points_daily20_v2(date) to anon,authenticated;
grant execute on function public.mark_customer_points_contacted_v2(text,text,text) to anon,authenticated;

-- import_customer_service_queue_results_v2 was introduced in the preceding migration.
-- Extend its role gate and branch validation for pharmacists/branch staff through the new queue scope.
-- The production definition is applied by the matching Supabase migration in this release.
