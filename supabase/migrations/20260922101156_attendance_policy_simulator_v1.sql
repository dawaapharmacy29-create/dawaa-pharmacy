create or replace function public.attendance_policy_simulate_v1(
  p_start date,
  p_end date,
  p_branch text default null,
  p_candidate jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_current public.attendance_policy_versions%rowtype;
  v_late_grace integer;
  v_very_late integer;
  v_early_grace integer;
  v_result jsonb;
begin
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>45 then
    raise exception 'invalid_policy_simulation_range' using errcode='22023';
  end if;
  if not public.dawaa_current_actor_can(array['view_attendance_leaves','view_schedule','manage_payroll']) then
    raise exception 'not authorized' using errcode='42501';
  end if;

  select * into v_current
  from public.attendance_policy_versions p
  where coalesce(p.active,false)=true
    and p.effective_from<=p_end
    and (p.effective_to is null or p.effective_to>=p_start)
  order by p.effective_from desc,p.created_at desc
  limit 1;

  v_late_grace:=coalesce(nullif(p_candidate->>'late_grace_minutes','')::integer,v_current.late_grace_minutes,15);
  v_very_late:=greatest(v_late_grace,coalesce(nullif(p_candidate->>'very_late_minutes','')::integer,v_current.very_late_minutes,30));
  v_early_grace:=greatest(0,coalesce(nullif(p_candidate->>'early_leave_grace_minutes','')::integer,v_current.early_leave_grace_minutes,0));

  if v_late_grace<0 or v_late_grace>240 or v_very_late<0 or v_very_late>480 or v_early_grace<0 or v_early_grace>240 then
    raise exception 'invalid_policy_simulation_values' using errcode='22023';
  end if;

  with base as (
    select
      a.staff_id,
      s.name staff_name,
      a.branch,
      a.attendance_date,
      a.resolution_status current_status,
      coalesce(a.late_minutes,0) late_minutes,
      coalesce(a.early_leave_minutes,0) early_leave_minutes,
      coalesce((a.resolution_snapshot->>'permission_attached')::boolean,false) permission_attached
    from public.attendance_daily_summary a
    join public.staff s on s.id=a.staff_id
    where a.attendance_date between p_start and p_end
      and a.status in ('approved','pending_review')
      and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or trim(a.branch)=trim(p_branch))
      and public.dawaa_can_read_staff_attendance_log(a.staff_id,a.branch)
  ), compared as (
    select *,
      case
        when current_status not in ('on_time','on_time_with_permission','late','very_late','early_leave_review') then current_status
        when early_leave_minutes>v_early_grace and not permission_attached then 'early_leave_review'
        when late_minutes>v_very_late then 'very_late'
        when late_minutes>v_late_grace then 'late'
        else case when permission_attached then 'on_time_with_permission' else 'on_time' end
      end candidate_status
    from base
  ), changed as (
    select * from compared where candidate_status is distinct from current_status
  )
  select jsonb_build_object(
    'range_start',p_start,
    'range_end',p_end,
    'branch',p_branch,
    'candidate',jsonb_build_object(
      'late_grace_minutes',v_late_grace,
      'very_late_minutes',v_very_late,
      'early_leave_grace_minutes',v_early_grace
    ),
    'evaluated_days',(select count(*) from compared),
    'changed_days',(select count(*) from changed),
    'late_to_on_time',(select count(*) from changed where current_status in ('late','very_late') and candidate_status in ('on_time','on_time_with_permission')),
    'on_time_to_late',(select count(*) from changed where current_status in ('on_time','on_time_with_permission') and candidate_status in ('late','very_late')),
    'early_leave_cleared',(select count(*) from changed where current_status='early_leave_review' and candidate_status<>'early_leave_review'),
    'early_leave_new',(select count(*) from changed where current_status<>'early_leave_review' and candidate_status='early_leave_review'),
    'samples',coalesce((
      select jsonb_agg(jsonb_build_object(
        'staff_id',x.staff_id,
        'staff_name',x.staff_name,
        'branch',x.branch,
        'attendance_date',x.attendance_date,
        'current_status',x.current_status,
        'candidate_status',x.candidate_status,
        'late_minutes',x.late_minutes,
        'early_leave_minutes',x.early_leave_minutes
      ) order by x.attendance_date desc,x.staff_name)
      from (select * from changed order by attendance_date desc,staff_name limit 30) x
    ),'[]'::jsonb),
    'generated_at',now()
  ) into v_result;

  return v_result;
end;
$function$;

revoke execute on function public.attendance_policy_simulate_v1(date,date,text,jsonb) from public;
grant execute on function public.attendance_policy_simulate_v1(date,date,text,jsonb) to anon,authenticated,service_role;
