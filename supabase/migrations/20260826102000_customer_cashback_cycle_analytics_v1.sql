-- Canonical 3-month customer cashback analytics snapshots.
-- Keeps operational settlement cycles separate from fair cycle-over-cycle analytics.

update public.customer_cashback_periods
set period_type='legacy', updated_at=now()
where period_end=date '2026-07-30';

create table if not exists public.customer_cashback_analytics_snapshots (
  id uuid primary key default gen_random_uuid(),
  branch text not null,
  customer_code text not null,
  customer_name text,
  customer_phone text,
  period_start date not null,
  period_end date not null,
  total_purchases numeric not null default 0,
  invoice_count integer not null default 0,
  cashback_rate numeric not null default 0,
  points_earned numeric not null default 0,
  calculation_version text not null default 'customer_analytics_snapshot_v1',
  calculated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_customer_cashback_analytics_snapshot unique(branch,customer_code,period_start,period_end)
);

create index if not exists idx_cashback_analytics_period_branch_points
  on public.customer_cashback_analytics_snapshots(period_start,period_end,branch,points_earned desc);
create index if not exists idx_cashback_analytics_customer_period
  on public.customer_cashback_analytics_snapshots(branch,customer_code,period_end desc);

alter table public.customer_cashback_analytics_snapshots enable row level security;
drop policy if exists cashback_analytics_snapshot_read_branch on public.customer_cashback_analytics_snapshots;
create policy cashback_analytics_snapshot_read_branch
on public.customer_cashback_analytics_snapshots for select to anon,authenticated
using (branch = any(public.dawaa_customer_points_allowed_branches_v1(false)));
revoke all on public.customer_cashback_analytics_snapshots from public;
grant select on public.customer_cashback_analytics_snapshots to anon,authenticated;

create or replace function public.dawaa_refresh_customer_cashback_analytics_period_v1(p_period_start date,p_period_end date,p_branch text)
returns jsonb language plpgsql security definer set search_path='public','pg_catalog' as $$
declare v_count int:=0; v_points numeric:=0; v_purchases numeric:=0;
begin
 if p_period_start is null or p_period_end is null or p_period_end<p_period_start then raise exception 'invalid cashback analytics period'; end if;
 if nullif(trim(p_branch),'') is null then raise exception 'branch is required'; end if;
 with invoice_base as (
  select nullif(trim(si.customer_code),'') customer_code,
   max(nullif(trim(coalesce(si.customer_name,si.name)),'')) customer_name,
   max(nullif(trim(coalesce(si.customer_phone,si.phone,si.whatsapp_phone)),'')) customer_phone,
   count(*)::int invoice_count,
   round(sum(coalesce(nullif(si.net_total,0),nullif(si.total_amount,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),nullif(si.amount,0),0))::numeric,2) total_purchases
  from public.dawaa_customer_sales_analytics_v1 si
  where coalesce(si.sale_date,si.invoice_date::date,si.invoice_datetime::date) between p_period_start and p_period_end
    and nullif(trim(coalesce(si.branch_name,si.branch)),'')=p_branch
    and nullif(trim(si.customer_code),'') is not null
  group by nullif(trim(si.customer_code),'')
  having sum(coalesce(nullif(si.net_total,0),nullif(si.total_amount,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),nullif(si.amount,0),0))>0
 ), calc as (
  select b.*,
   case when coalesce(a.cashback_enabled,true) then coalesce(a.cashback_rate,5) else 0 end::numeric rate,
   case when coalesce(a.cashback_enabled,true)
    then round((b.total_purchases*coalesce(a.cashback_rate,5)/100*coalesce(a.cashback_multiplier,1))+coalesce(a.voucher_value,0),2)
    else 0 end::numeric points
  from invoice_base b
  left join lateral (
   select ca.* from public.customer_cashback_accounts ca
   where trim(coalesce(ca.customer_code,''))=b.customer_code
    and (trim(coalesce(ca.branch,''))=p_branch or nullif(trim(coalesce(ca.branch,'')),'') is null)
   order by (trim(coalesce(ca.branch,''))=p_branch) desc,ca.updated_at desc limit 1
  ) a on true
 ), upserted as (
  insert into public.customer_cashback_analytics_snapshots(branch,customer_code,customer_name,customer_phone,period_start,period_end,total_purchases,invoice_count,cashback_rate,points_earned,calculation_version,calculated_at,updated_at)
  select p_branch,customer_code,customer_name,customer_phone,p_period_start,p_period_end,total_purchases,invoice_count,rate,points,'customer_analytics_snapshot_v1',now(),now() from calc
  on conflict(branch,customer_code,period_start,period_end) do update set
   customer_name=excluded.customer_name,customer_phone=excluded.customer_phone,total_purchases=excluded.total_purchases,
   invoice_count=excluded.invoice_count,cashback_rate=excluded.cashback_rate,points_earned=excluded.points_earned,
   calculation_version=excluded.calculation_version,calculated_at=now(),updated_at=now()
  returning total_purchases,points_earned
 ) select count(*),coalesce(sum(points_earned),0),coalesce(sum(total_purchases),0) into v_count,v_points,v_purchases from upserted;
 delete from public.customer_cashback_analytics_snapshots s
 where s.branch=p_branch and s.period_start=p_period_start and s.period_end=p_period_end
  and not exists(select 1 from public.dawaa_customer_sales_analytics_v1 si where nullif(trim(si.customer_code),'')=s.customer_code and nullif(trim(coalesce(si.branch_name,si.branch)),'')=p_branch and coalesce(si.sale_date,si.invoice_date::date,si.invoice_datetime::date) between p_period_start and p_period_end);
 return jsonb_build_object('branch',p_branch,'period_start',p_period_start,'period_end',p_period_end,'customers',v_count,'total_purchases',v_purchases,'total_points',v_points);
end $$;
revoke all on function public.dawaa_refresh_customer_cashback_analytics_period_v1(date,date,text) from public,anon,authenticated;

create or replace function public.dawaa_customer_cashback_cycle_comparison_v1(p_reference_date date default current_date,p_branch text default null,p_search text default null,p_limit integer default 100,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='public','pg_catalog' as $$
declare v_current_start date;v_current_end date;v_previous_start date;v_previous_end date;v_allowed text[];v_branches text[];v_result jsonb;
begin
 select period_start,period_end into v_current_start,v_current_end from public.get_cashback_quarter_bounds(coalesce(p_reference_date,current_date));
 v_previous_start:=(v_current_start-interval '3 months')::date; v_previous_end:=(v_current_start-interval '1 day')::date;
 v_allowed:=public.dawaa_customer_points_allowed_branches_v1(false);
 if coalesce(array_length(v_allowed,1),0)=0 then raise exception 'permission denied'; end if;
 if nullif(trim(p_branch),'') is not null then
  if not(trim(p_branch)=any(v_allowed)) then raise exception 'permission denied for branch'; end if;
  v_branches:=array[trim(p_branch)];
 else v_branches:=v_allowed; end if;
 with current_rows as(select * from public.customer_cashback_analytics_snapshots where period_start=v_current_start and period_end=v_current_end and branch=any(v_branches)),
 previous_rows as(select * from public.customer_cashback_analytics_snapshots where period_start=v_previous_start and period_end=v_previous_end and branch=any(v_branches)),
 joined as(
  select coalesce(c.branch,p.branch) branch,coalesce(c.customer_code,p.customer_code) customer_code,coalesce(c.customer_name,p.customer_name) customer_name,coalesce(c.customer_phone,p.customer_phone) customer_phone,
   coalesce(c.total_purchases,0)::numeric current_purchases,coalesce(p.total_purchases,0)::numeric previous_purchases,
   coalesce(c.invoice_count,0)::int current_invoices,coalesce(p.invoice_count,0)::int previous_invoices,
   coalesce(c.cashback_rate,p.cashback_rate,0)::numeric cashback_rate,coalesce(c.points_earned,0)::numeric current_points,coalesce(p.points_earned,0)::numeric previous_points
  from current_rows c full outer join previous_rows p on p.branch=c.branch and p.customer_code=c.customer_code
 ), enriched as(
  select j.*,round(current_points-previous_points,2) points_change,
   case when previous_points>0 then round(((current_points-previous_points)/previous_points*100)::numeric,2) else null end points_growth_pct,
   round(current_purchases-previous_purchases,2) purchases_change,
   case when previous_purchases>0 then round(((current_purchases-previous_purchases)/previous_purchases*100)::numeric,2) else null end purchases_growth_pct,
   case when previous_points=0 and current_points>0 then 'new' when previous_points>0 and current_points=0 then 'inactive'
    when previous_points>0 and ((current_points-previous_points)/previous_points*100)>=10 then 'growing'
    when previous_points>0 and ((current_points-previous_points)/previous_points*100)<=-10 then 'declining' else 'stable' end trend
  from joined j
 ), filtered as(select * from enriched where nullif(trim(coalesce(p_search,'')),'') is null or coalesce(customer_code,'') ilike '%'||trim(p_search)||'%' or coalesce(customer_name,'') ilike '%'||trim(p_search)||'%' or coalesce(customer_phone,'') ilike '%'||trim(p_search)||'%'),
 summary as(select count(*) total_customers,count(*) filter(where trend='new') new_customers,count(*) filter(where trend='growing') growing_customers,count(*) filter(where trend='stable') stable_customers,count(*) filter(where trend='declining') declining_customers,count(*) filter(where trend='inactive') inactive_customers,coalesce(sum(current_points),0) current_points,coalesce(sum(previous_points),0) previous_points,coalesce(sum(current_purchases),0) current_purchases,coalesce(sum(previous_purchases),0) previous_purchases from enriched),
 branch_summary as(select branch,count(*) customers,coalesce(sum(current_points),0) current_points,coalesce(sum(previous_points),0) previous_points,coalesce(sum(current_purchases),0) current_purchases,coalesce(sum(previous_purchases),0) previous_purchases from enriched group by branch order by branch),
 page_rows as(select * from filtered order by abs(points_change) desc,current_points desc,customer_code limit greatest(1,least(coalesce(p_limit,100),500)) offset greatest(coalesce(p_offset,0),0))
 select jsonb_build_object('periods',jsonb_build_object('current_start',v_current_start,'current_end',v_current_end,'previous_start',v_previous_start,'previous_end',v_previous_end),
  'summary',jsonb_build_object('total_customers',s.total_customers,'new_customers',s.new_customers,'growing_customers',s.growing_customers,'stable_customers',s.stable_customers,'declining_customers',s.declining_customers,'inactive_customers',s.inactive_customers,'current_points',s.current_points,'previous_points',s.previous_points,'points_growth_pct',case when s.previous_points>0 then round(((s.current_points-s.previous_points)/s.previous_points*100)::numeric,2) else null end,'current_purchases',s.current_purchases,'previous_purchases',s.previous_purchases,'purchases_growth_pct',case when s.previous_purchases>0 then round(((s.current_purchases-s.previous_purchases)/s.previous_purchases*100)::numeric,2) else null end),
  'branch_summary',(select coalesce(jsonb_agg(to_jsonb(bs)),'[]'::jsonb) from branch_summary bs),
  'filtered_count',(select count(*) from filtered),'rows',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from page_rows r),
  'limit',greatest(1,least(coalesce(p_limit,100),500)),'offset',greatest(coalesce(p_offset,0),0)) into v_result from summary s;
 return v_result;
end $$;
revoke all on function public.dawaa_customer_cashback_cycle_comparison_v1(date,text,text,integer,integer) from public;
grant execute on function public.dawaa_customer_cashback_cycle_comparison_v1(date,text,text,integer,integer) to anon,authenticated;

create or replace function public.run_quarterly_cashback_batch(p_period_start date default null,p_period_end date default null,p_reward_rate numeric default 0.05,p_actor_name text default 'النظام (تلقائي)')
returns jsonb language plpgsql security definer set search_path='public','pg_catalog' as $$
declare v_start date;v_end date;v_branch text;v_results jsonb:='[]'::jsonb;v_result jsonb;v_analytics jsonb;
begin
 if p_period_start is null then select period_start,period_end into v_start,v_end from public.get_cashback_quarter_bounds(); else v_start:=p_period_start;v_end:=p_period_end; end if;
 foreach v_branch in array array['فرع الشامي','فرع شكري'] loop
  v_result:=public.run_quarterly_cashback_batch_for_branch_v1(v_branch,v_start,v_end,p_reward_rate,p_actor_name);
  v_analytics:=public.dawaa_refresh_customer_cashback_analytics_period_v1(v_start,v_end,v_branch);
  v_results:=v_results||jsonb_build_array(v_result||jsonb_build_object('analytics',v_analytics));
 end loop;
 return jsonb_build_object('period_start',v_start,'period_end',v_end,'branches',v_results,'source','customer_cashback_cycles_snapshot_v4');
end $$;

select public.dawaa_refresh_customer_cashback_analytics_period_v1(date '2026-02-01',date '2026-04-30','فرع الشامي');
select public.dawaa_refresh_customer_cashback_analytics_period_v1(date '2026-05-01',date '2026-07-31','فرع الشامي');
select public.dawaa_refresh_customer_cashback_analytics_period_v1(date '2026-02-01',date '2026-04-30','فرع شكري');
select public.dawaa_refresh_customer_cashback_analytics_period_v1(date '2026-05-01',date '2026-07-31','فرع شكري');
