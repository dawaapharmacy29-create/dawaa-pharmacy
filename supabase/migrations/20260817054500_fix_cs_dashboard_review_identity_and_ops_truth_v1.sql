create or replace function public.get_cs_dashboard_reviews(
  p_branch text,
  p_staff_name text,
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
  v_norm_name text := public.normalize_cs_name(p_staff_name);
  v_end date := least(p_cycle_end, current_date);
begin
  with review_rows as materialized (
    select
      coalesce(csr.staff_id, csr.doctor_id) as person_id,
      coalesce(nullif(trim(csr.staff_name), ''), nullif(trim(csr.doctor_name), '')) as raw_doctor_name,
      csr.reviewer_name,
      csr.final_score,
      csr.doctor_points_impact
    from public.conversation_sales_reviews csr
    where csr.branch = p_branch
      and csr.conversation_date >= p_cycle_start::timestamp
      and csr.conversation_date < (v_end + 1)::timestamp
  ),
  staff_names as materialized (
    select sa.staff_id, max(nullif(trim(sa.name), '')) as canonical_name
    from public.staff_accounts sa
    where sa.staff_id is not null
    group by sa.staff_id
  ),
  reviews_this_cycle as (
    select count(*) as review_count, round(avg(final_score), 1) as avg_score_given
    from review_rows
    where public.normalize_cs_name(reviewer_name) = v_norm_name
  ),
  doctor_ratings as (
    select
      coalesce(sn.canonical_name, min(rr.raw_doctor_name), 'غير محدد') as doctor_name,
      round(avg(rr.final_score), 1) as avg_score,
      count(*) as review_count,
      round(sum(coalesce(rr.doctor_points_impact, 0)), 1) as total_incentive_impact
    from review_rows rr
    left join staff_names sn on sn.staff_id = rr.person_id
    where coalesce(rr.raw_doctor_name, '') <> '' or rr.person_id is not null
    group by rr.person_id,
             case when rr.person_id is null then public.normalize_cs_name(rr.raw_doctor_name) else null end,
             sn.canonical_name
    order by avg_score desc, review_count desc
  ),
  branch_reviews as (
    select round(avg(final_score), 1) as branch_avg_score, count(*) as branch_review_count
    from review_rows
  ),
  team_ranking as (
    select public.normalize_cs_name(reviewer_name) as rep_name,
           count(*) as review_count,
           round(avg(final_score), 1) as avg_score_given
    from review_rows
    where coalesce(reviewer_name, '') <> ''
    group by public.normalize_cs_name(reviewer_name)
    order by review_count desc
  )
  select jsonb_build_object(
    'my_reviews_this_cycle', (select to_jsonb(x) from reviews_this_cycle x),
    'doctor_ratings', (select coalesce(jsonb_agg(x), '[]'::jsonb) from doctor_ratings x),
    'branch_reviews', (select to_jsonb(x) from branch_reviews x),
    'team_ranking', (select coalesce(jsonb_agg(x), '[]'::jsonb) from team_ranking x),
    'recovery_stats', public.get_followup_recovery_stats(p_branch, p_staff_name, p_cycle_start, v_end)
  ) into v_result;
  return v_result;
end;
$function$;

grant execute on function public.get_cs_dashboard_reviews(text,text,date,date) to anon, authenticated;

create or replace function public.get_cs_dashboard_ops(
  p_branch text,
  p_staff_name text,
  p_cycle_start date,
  p_cycle_end date
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
with params as (
  select public.normalize_cs_name(p_staff_name) as norm_name,
         p_cycle_start::timestamp as cycle_from,
         (least(p_cycle_end, current_date) + 1)::timestamp as cycle_to,
         (current_date - interval '6 months') as active_from,
         (current_date - interval '3 months') as active_mid
),
sales_stats as materialized (
  select
    count(distinct si.customer_code) filter (
      where coalesce(si.customer_code,'') <> '' and si.invoice_date >= p.active_mid
    )::int as active_last3,
    count(distinct si.customer_code) filter (
      where coalesce(si.customer_code,'') <> '' and si.invoice_date >= p.active_from and si.invoice_date < p.active_mid
    )::int as active_prev3,
    count(*) filter (
      where si.invoice_date >= p.cycle_from and si.invoice_date < p.cycle_to
    )::bigint as invoices,
    round(coalesce(sum(coalesce(si.net_amount,si.discounted_amount,si.total_amount,si.amount,si.gross_amount,si.net_total,0)) filter (
      where si.invoice_date >= p.cycle_from and si.invoice_date < p.cycle_to
    ),0),2) as total_sales
  from public.dawaa_sales_invoices_dashboard_v1 si cross join params p
  where si.branch = p_branch
    and si.invoice_date >= least(p.cycle_from,p.active_from)
    and si.invoice_date < greatest(p.cycle_to,current_date + interval '1 day')
),
points_summary as (
  select coalesce(round(sum(l.points_amount) filter (where l.points_amount > 0),0),0) as points_earned,
         coalesce(round(sum(l.points_amount) filter (where l.points_amount < 0),0),0) as points_redeemed
  from public.customer_points_ledger l cross join params p
  where l.branch = p_branch and l.created_at >= p.cycle_from and l.created_at < p.cycle_to
),
welcome as (
  select count(*) as sent_count, count(*) filter (where w.status='sent') as delivered_count
  from public.customer_welcome_message_logs w cross join params p
  where w.branch=p_branch and public.normalize_cs_name(w.sent_by_name)=p.norm_name
    and w.created_at>=p.cycle_from and w.created_at<p.cycle_to
),
requests as (
  select count(*) as logged_count,
         count(*) filter (where r.status not in ('delivered','closed','resolved','completed')) as open_count
  from public.customer_requests r cross join params p
  where r.branch=p_branch and public.normalize_cs_name(r.created_by_name)=p.norm_name
    and r.created_at>=p.cycle_from and r.created_at<p.cycle_to
),
shifts as (
  select coalesce(s.shift_date,s.date) as shift_date,s.day_name,s.shift_name,s.start_time,s.end_time
  from public.shift_schedules s cross join params p
  where s.branch=p_branch and public.normalize_cs_name(s.staff_name)=p.norm_name
    and coalesce(s.is_off,s.is_day_off,false)=false
    and coalesce(s.shift_date,s.date)>=current_date
  order by 1 limit 7
)
select jsonb_build_object(
  'branch_sales', jsonb_build_object('invoices',ss.invoices,'total_sales',ss.total_sales),
  'points_summary', coalesce((select to_jsonb(x) from points_summary x),'{}'::jsonb),
  'my_welcome_messages', coalesce((select to_jsonb(x) from welcome x),'{}'::jsonb),
  'my_customer_requests', coalesce((select to_jsonb(x) from requests x),'{}'::jsonb),
  'my_upcoming_shifts', coalesce((select jsonb_agg(to_jsonb(x)) from shifts x),'[]'::jsonb),
  'active_customers', jsonb_build_object(
    'last_3_months',ss.active_last3,
    'previous_3_months',ss.active_prev3,
    'trend',case when ss.active_prev3=0 then null else round(((ss.active_last3-ss.active_prev3)::numeric/ss.active_prev3)*100,1) end
  )
)
from sales_stats ss;
$function$;

grant execute on function public.get_cs_dashboard_ops(text,text,date,date) to anon, authenticated;
