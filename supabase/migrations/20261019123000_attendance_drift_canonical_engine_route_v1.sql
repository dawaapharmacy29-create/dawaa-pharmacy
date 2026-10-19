-- 2026-10-19: align legacy drift readers with the canonical attendance engine router.
-- Historical drift comparison wrongly forced V2 even when approved truth came from
-- flexible V3. This created false financial alarms (e.g. V3 flexible_present
-- compared to V2 no_schedule: 15.56 -> 0 hours), and missed other mismatches.
--
-- Read-only shadow comparison, 2026-09-26 through 2026-10-18:
-- 25 old candidate-hour mismatches -> 22 using the current router
-- (5 old-only false positives, 2 newly detected). This is not a decision
-- about pay, manual overrides, or which cases to reopen.
--
-- Replace ONLY the builder call in each function. Preserve the existing
-- signatures, read scopes, actor rules, math and return shapes. Out-of-scope
-- historical rows are not a reason to invalidate previously approved truth.
-- NO data DML; NO approval replay; NO grant changes; not applied to Production.
--
-- attendance_resolution_drift_count_v1
CREATE OR REPLACE FUNCTION public.attendance_resolution_drift_count_v1(p_staff_id uuid, p_start date, p_end date)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select count(*)::integer
  from public.attendance_daily_summary a
  cross join lateral (
    select public.dawaa_build_attendance_day_resolution_current_v1(a.staff_id,a.attendance_date) as j
  ) rebuilt
  where a.staff_id=p_staff_id
    and a.attendance_date between p_start and least(p_end,(now() at time zone 'Africa/Cairo')::date-1)
    and a.status='approved'
    -- A current out-of-scope route cannot invalidate an old approved historical day.
    and coalesce(rebuilt.j->>'route','') <> 'out_of_scope'
    and (
      coalesce(a.resolution_status,'') is distinct from coalesce(rebuilt.j->>'resolution_status','')
      or coalesce(a.schedule_id::text,'') is distinct from coalesce(rebuilt.j->>'schedule_id','')
      or abs(coalesce(a.candidate_hours,0)-coalesce((rebuilt.j->>'candidate_hours')::numeric,0))>0.10
    );
$function$;

-- attendance_resolution_drift_v1
CREATE OR REPLACE FUNCTION public.attendance_resolution_drift_v1(p_start date, p_end date, p_branch text DEFAULT NULL::text)
 RETURNS TABLE(staff_id uuid, staff_name text, branch text, attendance_date date, stored_status text, rebuilt_status text, stored_hours numeric, rebuilt_hours numeric, drift_reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
    select public.dawaa_build_attendance_day_resolution_current_v1(a.staff_id,a.attendance_date) as j
  ) rebuilt
  where a.attendance_date between p_start and least(p_end,(now() at time zone 'Africa/Cairo')::date-1)
    and a.status='approved'
    -- A current out-of-scope route cannot invalidate an old approved historical day.
    and coalesce(rebuilt.j->>'route','') <> 'out_of_scope'
    and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or s.branch=p_branch)
    and public.dawaa_can_read_staff_attendance_log(s.id,s.branch)
    and (
      coalesce(a.resolution_status,'') is distinct from coalesce(rebuilt.j->>'resolution_status','')
      or coalesce(a.schedule_id::text,'') is distinct from coalesce(rebuilt.j->>'schedule_id','')
      or abs(coalesce(a.candidate_hours,0)-coalesce((rebuilt.j->>'candidate_hours')::numeric,0))>0.10
    )
  order by a.attendance_date desc,s.branch,s.name;
end;
$function$;

-- attendance_resolution_financial_drift_count_v1
CREATE OR REPLACE FUNCTION public.attendance_resolution_financial_drift_count_v1(p_staff_id uuid, p_start date, p_end date)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select count(*)::integer
  from public.attendance_daily_summary a
  cross join lateral (
    select public.dawaa_build_attendance_day_resolution_current_v1(a.staff_id,a.attendance_date) as j
  ) rebuilt
  where a.staff_id=p_staff_id
    and a.attendance_date between p_start and least(p_end,(now() at time zone 'Africa/Cairo')::date-1)
    and a.status='approved'
    -- A current out-of-scope route cannot invalidate an old approved historical day.
    and coalesce(rebuilt.j->>'route','') <> 'out_of_scope'
    and abs(coalesce(a.candidate_hours,0)-coalesce((rebuilt.j->>'candidate_hours')::numeric,0))>0.10;
$function$;

-- delivery_attendance_financial_drift_guard_v1
CREATE OR REPLACE FUNCTION public.delivery_attendance_financial_drift_guard_v1(p_staff_id uuid, p_start date, p_end date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  with drift as (
    select
      a.id,
      a.attendance_date,
      a.resolution_status,
      coalesce(a.candidate_hours,0) stored_hours,
      coalesce((rebuilt.j->>'candidate_hours')::numeric,0) rebuilt_hours,
      a.resolution_origin,
      a.approved_by_name,
      a.approval_note,
      a.time_off_request_id,
      (
        coalesce(a.resolution_origin,'') like 'manual%'
        or coalesce(a.resolution_origin,'') in ('manager_decision','manual_manager_decision')
        or coalesce(a.approval_note,'') ~ '(قرار الإدارة|قرار المدير|بإذن|بدون خصم)'
        or (
          nullif(trim(coalesce(a.approved_by_name,'')),'') is not null
          and coalesce(a.approved_by_name,'') not in ('النظام التلقائي للحضور','النظام التلقائي','النظام')
        )
        or a.time_off_request_id is not null
        or exists(
          select 1
          from public.attendance_manual_actions_audit x
          where x.target_id=a.id
        )
      ) explained_by_approved_override
    from public.attendance_daily_summary a
    cross join lateral (
      select public.dawaa_build_attendance_day_resolution_current_v1(a.staff_id,a.attendance_date) j
    ) rebuilt
    where a.staff_id=p_staff_id
      and a.attendance_date between p_start and least(p_end,(now() at time zone 'Africa/Cairo')::date-1)
      and a.status='approved'
    -- A current out-of-scope route cannot invalidate an old approved historical day.
    and coalesce(rebuilt.j->>'route','') <> 'out_of_scope'
      and abs(coalesce(a.candidate_hours,0)-coalesce((rebuilt.j->>'candidate_hours')::numeric,0))>0.10
  )
  select jsonb_build_object(
    'staff_id',p_staff_id,
    'start_date',p_start,
    'end_date',p_end,
    'total_drift_count',count(*),
    'explained_override_count',count(*) filter(where explained_by_approved_override),
    'unexplained_drift_count',count(*) filter(where not explained_by_approved_override),
    'rows',coalesce(jsonb_agg(jsonb_build_object(
      'attendance_date',attendance_date,
      'resolution_status',resolution_status,
      'stored_hours',stored_hours,
      'rebuilt_hours',rebuilt_hours,
      'resolution_origin',resolution_origin,
      'approved_by_name',approved_by_name,
      'approval_note',approval_note,
      'time_off_request_id',time_off_request_id,
      'explained_by_approved_override',explained_by_approved_override
    ) order by attendance_date),'[]'::jsonb)
  )
  from drift;
$function$;
