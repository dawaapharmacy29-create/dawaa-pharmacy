create or replace function public.get_cs_dashboard_followups(
  p_branch text,
  p_staff_name text,
  p_cycle_start date,
  p_cycle_end date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_result jsonb;
  v_norm_name text := public.normalize_cs_name(p_staff_name);
begin
  with branch_cycle as materialized (
    select
      customer_name,
      name,
      responsible_name,
      assigned_doctor,
      request_source,
      request_type,
      category,
      followup_type,
      status,
      followup_status,
      completed_at
    from public.daily_followups
    where branch = p_branch
      and created_at >= p_cycle_start::timestamp
      and created_at < (p_cycle_end + 1)::timestamp
  ),
  my_followups as materialized (
    select
      customer_name,
      name,
      request_source,
      request_type,
      category,
      followup_type,
      status,
      followup_status,
      completed_at
    from branch_cycle
    where public.normalize_cs_name(responsible_name) = v_norm_name
  ),
  followup_breakdown as (
    select
      count(*) filter (
        where request_source in ('exceptional_followup','exceptional_quick_execution')
           or request_type ilike '%exceptional%'
           or category = 'متابعة استثنائية'
      ) as exceptional_count,
      count(*) filter (
        where followup_type = 'smart_daily'
           or category in ('عملاء مهمون','مهددون بالتوقف','متوسطون قابلون للنمو','متوقفون','بدون شراء','ترحيب العملاء الجدد')
      ) as app_assigned_count,
      count(*) filter (where request_source = 'doctor_requested_followup') as doctor_requested_count,
      count(*) filter (
        where request_source = 'unified_customer_service_workspace'
           or request_source is null
      ) as self_initiated_count,
      count(*) filter (
        where status = 'completed'
           or followup_status = 'completed'
           or completed_at is not null
      ) as completed_count,
      count(*) as total_count
    from my_followups
  ),
  top_customers as (
    select coalesce(customer_name, name) as customer_name, count(*) as followups_count
    from my_followups
    group by 1
    order by 2 desc
    limit 5
  ),
  doctor_requesters as (
    select assigned_doctor as doctor_name, count(*) as requests_count
    from branch_cycle
    where request_source = 'doctor_requested_followup'
      and coalesce(assigned_doctor,'') <> ''
      and public.normalize_cs_name(assigned_doctor) <> v_norm_name
    group by 1
    order by 2 desc
    limit 5
  )
  select jsonb_build_object(
    'my_followups', (select to_jsonb(followup_breakdown) from followup_breakdown),
    'top_followed_customers', (select coalesce(jsonb_agg(top_customers), '[]'::jsonb) from top_customers),
    'top_doctor_requesters', (select coalesce(jsonb_agg(doctor_requesters), '[]'::jsonb) from doctor_requesters)
  ) into v_result;

  return v_result;
end;
$function$;

grant execute on function public.get_cs_dashboard_followups(text,text,date,date) to anon, authenticated;
