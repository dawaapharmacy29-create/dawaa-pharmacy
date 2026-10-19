-- RECOVERY ONLY, NOT A FORWARD MIGRATION. Captured from Production before attendance rollout on 2026-10-19.
-- These five original function definitions can restore the prior read/diagnostic behavior if needed.
-- DDL only. Does not roll back historical payroll data, approvals, or manual interventions.
-- Run as a single transaction ONLY after diagnosing and explicitly authorizing a rollback.
-- File lives under supabase/rollbacks, not supabase/migrations; do not auto-apply it.
BEGIN;

-- Restore public.attendance_resolution_drift_count_v1
CREATE OR REPLACE FUNCTION public.attendance_resolution_drift_count_v1(p_staff_id uuid, p_start date, p_end date)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
$function$;

-- Restore public.attendance_resolution_drift_v1
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
$function$;

-- Restore public.attendance_resolution_financial_drift_count_v1
CREATE OR REPLACE FUNCTION public.attendance_resolution_financial_drift_count_v1(p_staff_id uuid, p_start date, p_end date)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select count(*)::integer
  from public.attendance_daily_summary a
  cross join lateral (
    select public.dawaa_build_attendance_day_resolution_v2(a.staff_id,a.attendance_date) as j
  ) rebuilt
  where a.staff_id=p_staff_id
    and a.attendance_date between p_start and least(p_end,(now() at time zone 'Africa/Cairo')::date-1)
    and a.status='approved'
    and abs(coalesce(a.candidate_hours,0)-coalesce((rebuilt.j->>'candidate_hours')::numeric,0))>0.10;
$function$;

-- Restore public.attendance_truth_cycle_v2
CREATE OR REPLACE FUNCTION public.attendance_truth_cycle_v2(p_start date, p_end date, p_branch text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_result jsonb;
begin
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>62 then
    raise exception 'invalid_attendance_truth_range' using errcode='22023';
  end if;
  if not public.dawaa_current_actor_can(array['view_attendance_leaves','view_schedule','manage_payroll']) then
    raise exception 'not_authorized_for_attendance_truth' using errcode='42501';
  end if;

  with eligible as (
    select s.id,s.name,s.role,s.branch
    from public.staff s
    where coalesce(s.active,s.is_active,true)
      and coalesce(s.visible_in_schedule,true)
      and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or trim(s.branch)=trim(p_branch))
      and ((select attn_scope.read_mode from public.dawaa_staff_attendance_log_read_scope_v1() attn_scope) = 'all' or ((select attn_scope.read_mode from public.dawaa_staff_attendance_log_read_scope_v1() attn_scope) = 'scoped' and ((s.id is not null and s.id = (select attn_scope.subject_id from public.dawaa_staff_attendance_log_read_scope_v1() attn_scope)) or trim(coalesce(s.branch,'')) = (select attn_scope.branch_scope from public.dawaa_staff_attendance_log_read_scope_v1() attn_scope))))
  ),
  attendance as (
    select a.staff_id,
      count(*) filter(where a.status='approved')::int approved_days,
      count(*) filter(where a.status='pending_review')::int pending_days,
      count(*) filter(where a.status='approved' and coalesce(a.candidate_hours,0)>0
        and coalesce(a.resolution_status,'') not in ('off_day','approved_time_off','absence_review'))::int worked_days,
      round(coalesce(sum(a.candidate_hours) filter(where a.status='approved'
        and coalesce(a.candidate_hours,0)>0
        and coalesce(a.resolution_status,'') not in ('off_day','approved_time_off','absence_review')),0),2) worked_hours,
      count(*) filter(where a.status='approved' and a.resolution_status='off_day')::int off_days,
      count(*) filter(where a.status='approved' and a.resolution_status='approved_time_off')::int leave_days,
      count(*) filter(where a.status='approved' and a.resolution_status='absence_review')::int absence_days,
      count(*) filter(where a.status='approved' and a.resolution_status='worked_on_off')::int worked_on_off_days
    from public.attendance_daily_summary a
    where a.attendance_date between p_start and p_end
    group by a.staff_id
  ),
  overtime as (
    select o.staff_id,
      round(coalesce(sum(o.overtime_hours) filter(where o.status='approved'),0),2) approved_ot_hours,
      round(coalesce(sum(o.overtime_hours) filter(where o.status='pending'),0),2) pending_ot_hours,
      count(*) filter(where o.status='pending')::int pending_ot_count,
      count(*) filter(where o.status='approved' and (
        o.source_resolution_id is null or not exists(
          select 1 from public.attendance_daily_summary a
          where a.id=o.source_resolution_id and a.status='approved'
            and public.attendance_resolution_fingerprint_v2(a.id)=o.source_resolution_fingerprint
        )
      ))::int stale_approved_ot
    from public.staff_overtime_approvals o
    where o.attendance_date between p_start and p_end
    group by o.staff_id
  ),
  corrections as (
    select r.staff_id,count(*) filter(where r.status='pending')::int pending_corrections
    from public.attendance_manual_requests r
    where coalesce(r.attendance_date,(r.requested_time at time zone 'Africa/Cairo')::date) between p_start and p_end
    group by r.staff_id
  ),
  timeoff as (
    select r.staff_id,count(*) filter(where r.status='pending')::int pending_timeoff
    from public.staff_time_off_requests r
    where r.start_date<=p_end and r.end_date>=p_start
    group by r.staff_id
  ),
  rows as (
    select e.*,
      coalesce(a.approved_days,0) approved_days,coalesce(a.pending_days,0) pending_days,
      coalesce(a.worked_days,0) worked_days,coalesce(a.worked_hours,0) worked_hours,
      coalesce(a.off_days,0) off_days,coalesce(a.leave_days,0) leave_days,
      coalesce(a.absence_days,0) absence_days,coalesce(a.worked_on_off_days,0) worked_on_off_days,
      coalesce(o.approved_ot_hours,0) approved_ot_hours,coalesce(o.pending_ot_hours,0) pending_ot_hours,
      coalesce(o.pending_ot_count,0) pending_ot_count,coalesce(o.stale_approved_ot,0) stale_approved_ot,
      coalesce(c.pending_corrections,0) pending_corrections,coalesce(t.pending_timeoff,0) pending_timeoff
    from eligible e
    left join attendance a on a.staff_id=e.id
    left join overtime o on o.staff_id=e.id
    left join corrections c on c.staff_id=e.id
    left join timeoff t on t.staff_id=e.id
  )
  select jsonb_build_object(
    'range_start',p_start,'range_end',p_end,'branch',p_branch,
    'summary',jsonb_build_object(
      'staff_count',(select count(*) from rows),
      'approved_days',(select coalesce(sum(approved_days),0) from rows),
      'pending_attendance_days',(select coalesce(sum(pending_days),0) from rows),
      'worked_days',(select coalesce(sum(worked_days),0) from rows),
      'worked_hours',(select coalesce(sum(worked_hours),0) from rows),
      'approved_overtime_hours',(select coalesce(sum(approved_ot_hours),0) from rows),
      'pending_overtime_hours',(select coalesce(sum(pending_ot_hours),0) from rows),
      'pending_corrections',(select coalesce(sum(pending_corrections),0) from rows),
      'pending_timeoff',(select coalesce(sum(pending_timeoff),0) from rows),
      'stale_approved_overtime',(select coalesce(sum(stale_approved_ot),0) from rows),
      'ready_for_payroll_truth',(select coalesce(sum(pending_days),0)=0
        and coalesce(sum(pending_ot_count),0)=0
        and coalesce(sum(stale_approved_ot),0)=0 from rows)
    ),
    'rows',coalesce((
      select jsonb_agg(jsonb_build_object(
        'staff_id',id,'staff_name',name,'role',role,'branch',branch,
        'approved_days',approved_days,'pending_attendance_days',pending_days,
        'worked_days',worked_days,'worked_hours',worked_hours,'off_days',off_days,
        'approved_leave_days',leave_days,'absence_days',absence_days,'worked_on_off_days',worked_on_off_days,
        'approved_overtime_hours',approved_ot_hours,'pending_overtime_hours',pending_ot_hours,
        'pending_overtime_count',pending_ot_count,'stale_approved_overtime',stale_approved_ot,
        'pending_corrections',pending_corrections,'pending_timeoff',pending_timeoff,
        'truth_ready',(pending_days=0 and pending_ot_count=0 and stale_approved_ot=0)
      ) order by branch,name) from rows
    ),'[]'::jsonb),
    'generated_at',now()
  ) into v_result;
  return v_result;
end; $function$;

-- Restore public.delivery_attendance_financial_drift_guard_v1
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
      select public.dawaa_build_attendance_day_resolution_v2(a.staff_id,a.attendance_date) j
    ) rebuilt
    where a.staff_id=p_staff_id
      and a.attendance_date between p_start and least(p_end,(now() at time zone 'Africa/Cairo')::date-1)
      and a.status='approved'
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

COMMIT;
