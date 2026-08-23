create or replace function public.get_cs_dashboard_ops(p_branch text,p_staff_name text,p_cycle_start date,p_cycle_end date)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
with params as (
  select public.normalize_cs_identity_name(p_staff_name) norm_name,
    p_cycle_start::timestamp cycle_from,
    (least(p_cycle_end,current_date)+1)::timestamp cycle_to,
    (current_date-interval '6 months') active_from,
    (current_date-interval '3 months') active_mid
), cycle_sales as materialized (
  select * from public.get_dashboard_sales_summary_v171(p_cycle_start,least(p_cycle_end,current_date),p_branch)
), active_stats as materialized (
  select
    count(distinct si.customer_code) filter(where si.invoice_date>=p.active_mid)::int active_last3,
    count(distinct si.customer_code) filter(where si.invoice_date>=p.active_from and si.invoice_date<p.active_mid)::int active_prev3
  from public.sales_invoices si cross join params p
  where si.branch=p_branch
    and si.invoice_date>=p.active_from
    and si.invoice_date<current_date+interval '1 day'
    and nullif(btrim(si.customer_code),'') is not null
    and lower(coalesce(si.save_status,'')) !~ '(معلق|قيد|pending|draft|غير محفوظ)'
    and lower(coalesce(si.invoice_type,'')) !~ '(معلق|pending|draft)'
    and not exists(
      select 1 from public.customer_flags cf
      where cf.flag_key in ('wholesale_b2b','system_generic_code')
        and coalesce(cf.is_active,false)
        and cf.customer_code=btrim(coalesce(si.customer_code,''))
    )
), points_summary as (
  select coalesce(round(sum(l.points_amount) filter(where l.points_amount>0),0),0) points_earned,
    coalesce(round(sum(l.points_amount) filter(where l.points_amount<0),0),0) points_redeemed
  from public.customer_points_ledger l cross join params p
  where l.branch=p_branch and l.created_at>=p.cycle_from and l.created_at<p.cycle_to
), welcome as (
  select count(*) sent_count,count(*) filter(where w.status='sent') delivered_count
  from public.customer_welcome_message_logs w cross join params p
  where w.branch=p_branch
    and public.normalize_cs_identity_name(w.sent_by_name)=p.norm_name
    and w.created_at>=p.cycle_from and w.created_at<p.cycle_to
), requests as (
  select count(*) logged_count,
    count(*) filter(where r.status not in ('delivered','closed','resolved','completed')) open_count
  from public.customer_requests r cross join params p
  where r.branch=p_branch
    and public.normalize_cs_identity_name(r.created_by_name)=p.norm_name
    and r.created_at>=p.cycle_from and r.created_at<p.cycle_to
), shifts as (
  select coalesce(s.shift_date,s.date) shift_date,s.day_name,s.shift_name,s.start_time,s.end_time
  from public.shift_schedules s cross join params p
  where s.branch=p_branch
    and public.normalize_cs_identity_name(s.staff_name)=p.norm_name
    and coalesce(s.is_off,s.is_day_off,false)=false
    and coalesce(s.shift_date,s.date)>=current_date
  order by 1 limit 7
)
select jsonb_build_object(
  'branch_sales',jsonb_build_object('invoices',coalesce(cs.invoices_count,0),'total_sales',round(coalesce(cs.sales_total,0),2)),
  'points_summary',coalesce((select to_jsonb(x) from points_summary x),'{}'::jsonb),
  'my_welcome_messages',coalesce((select to_jsonb(x) from welcome x),'{}'::jsonb),
  'my_customer_requests',coalesce((select to_jsonb(x) from requests x),'{}'::jsonb),
  'my_upcoming_shifts',coalesce((select jsonb_agg(to_jsonb(x)) from shifts x),'[]'::jsonb),
  'active_customers',jsonb_build_object(
    'last_3_months',a.active_last3,
    'previous_3_months',a.active_prev3,
    'trend',case when a.active_prev3=0 then null else round(((a.active_last3-a.active_prev3)::numeric/a.active_prev3)*100,1) end
  )
)
from cycle_sales cs cross join active_stats a;
$$;

revoke all on function public.get_cs_dashboard_ops(text,text,date,date) from public;
grant execute on function public.get_cs_dashboard_ops(text,text,date,date) to authenticated;
