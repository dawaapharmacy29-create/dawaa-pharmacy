create or replace function public.attendance_resolution_drift_count_v1(
  p_staff_id uuid,
  p_start date,
  p_end date
)
returns integer
language sql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
  select count(*)::integer
  from public.attendance_daily_summary a
  cross join lateral (
    select public.dawaa_build_attendance_day_resolution_v2(a.staff_id,a.attendance_date) as j
  ) rebuilt
  where a.staff_id=p_staff_id
    and a.attendance_date between p_start and least(p_end,(now() at time zone 'Africa/Cairo')::date-1)
    and a.status='approved'
    and (
      coalesce(a.resolution_status,'') is distinct from coalesce(rebuilt.j->>'resolution_status','')
      or coalesce(a.schedule_id::text,'') is distinct from coalesce(rebuilt.j->>'schedule_id','')
      or abs(coalesce(a.candidate_hours,0)-coalesce((rebuilt.j->>'candidate_hours')::numeric,0))>0.10
    );
$$;

revoke all on function public.attendance_resolution_drift_count_v1(uuid,date,date) from public,anon,authenticated;
grant execute on function public.attendance_resolution_drift_count_v1(uuid,date,date) to service_role,postgres;

create or replace function public.attendance_resolution_drift_v1(
  p_start date,
  p_end date,
  p_branch text default null
)
returns table(
  staff_id uuid,
  staff_name text,
  branch text,
  attendance_date date,
  stored_status text,
  rebuilt_status text,
  stored_hours numeric,
  rebuilt_hours numeric,
  drift_reason text
)
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare v_actor uuid;
begin
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>45 then
    raise exception 'invalid_attendance_drift_range' using errcode='22023';
  end if;
  v_actor:=public.dawaa_current_staff_account_id_strict();
  if v_actor is null then raise exception 'active staff actor required' using errcode='42501'; end if;

  return query
  select
    a.staff_id,s.name,s.branch,a.attendance_date,
    a.resolution_status,
    rebuilt.j->>'resolution_status',
    coalesce(a.candidate_hours,0),
    coalesce((rebuilt.j->>'candidate_hours')::numeric,0),
    concat_ws(',',
      case when coalesce(a.resolution_status,'') is distinct from coalesce(rebuilt.j->>'resolution_status','') then 'status_changed' end,
      case when coalesce(a.schedule_id::text,'') is distinct from coalesce(rebuilt.j->>'schedule_id','') then 'schedule_changed' end,
      case when abs(coalesce(a.candidate_hours,0)-coalesce((rebuilt.j->>'candidate_hours')::numeric,0))>0.10 then 'hours_changed' end
    )
  from public.attendance_daily_summary a
  join public.staff s on s.id=a.staff_id
  cross join lateral (
    select public.dawaa_build_attendance_day_resolution_v2(a.staff_id,a.attendance_date) as j
  ) rebuilt
  where a.attendance_date between p_start and least(p_end,(now() at time zone 'Africa/Cairo')::date-1)
    and a.status='approved'
    and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or s.branch=p_branch)
    and public.dawaa_can_read_staff_attendance_log(s.id,s.branch)
    and (
      coalesce(a.resolution_status,'') is distinct from coalesce(rebuilt.j->>'resolution_status','')
      or coalesce(a.schedule_id::text,'') is distinct from coalesce(rebuilt.j->>'schedule_id','')
      or abs(coalesce(a.candidate_hours,0)-coalesce((rebuilt.j->>'candidate_hours')::numeric,0))>0.10
    )
  order by a.attendance_date desc,s.branch,s.name;
end;
$$;

revoke all on function public.attendance_resolution_drift_v1(date,date,text) from public,anon;
grant execute on function public.attendance_resolution_drift_v1(date,date,text) to authenticated,service_role;

-- The core engine was renamed live before this migration file was recorded.
-- Keep migration replay-safe by renaming only when the core name does not already exist.
do $$
begin
  if to_regprocedure('public.attendance_payroll_engine_core_v2(uuid,text)') is null
     and to_regprocedure('public.attendance_payroll_engine_v2(uuid,text)') is not null then
    alter function public.attendance_payroll_engine_v2(uuid,text) rename to attendance_payroll_engine_core_v2;
  end if;
end $$;

create or replace function public.attendance_payroll_engine_v2(
  p_staff_id uuid,
  p_month_cycle text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  j jsonb;
  v_start date;
  v_end date;
  v_drift integer:=0;
begin
  j:=public.attendance_payroll_engine_core_v2(p_staff_id,p_month_cycle);
  if coalesce((j->>'ready')::boolean,false) is not true then return j; end if;

  v_start:=(j->>'cycle_start')::date;
  v_end:=(j->>'cycle_end')::date;
  v_drift:=public.attendance_resolution_drift_count_v1(p_staff_id,v_start,v_end);

  return j || jsonb_build_object(
    'resolution_drift_days',v_drift,
    'ready_for_final',
      coalesce((j->>'ready_for_final')::boolean,false) and v_drift=0
  );
end;
$$;

revoke all on function public.attendance_payroll_engine_v2(uuid,text) from public,anon;
grant execute on function public.attendance_payroll_engine_v2(uuid,text) to authenticated,service_role;

create or replace function public.dawaa_assert_payroll_profile_ready_v18(p_staff_id uuid,p_month_cycle text)
returns void
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  j jsonb;
  e jsonb;
begin
  j:=public.dawaa_payroll_profile_readiness_v18(p_staff_id,p_month_cycle);
  if coalesce((j->>'ready_for_approval')::boolean,false) is not true then
    raise exception 'payroll_profile_not_ready_for_approval: %',coalesce(j->'missing_fields','[]'::jsonb)::text
      using errcode='22023';
  end if;

  if coalesce(j->>'salary_calculation_mode','')='attendance_hours_v1' then
    e:=public.attendance_payroll_engine_v2(p_staff_id,p_month_cycle);
    if coalesce((e->>'ready_for_final')::boolean,false) is not true then
      raise exception 'attendance_payroll_not_ready_for_final: pending_review=% pending_ot=% drift=% cycle_closed=%',
        coalesce(e->>'pending_review_days','0'),
        coalesce(e->>'pending_overtime_hours','0'),
        coalesce(e->>'resolution_drift_days','0'),
        coalesce(e->>'cycle_closed','false')
        using errcode='22023';
    end if;
  end if;
end;
$$;
