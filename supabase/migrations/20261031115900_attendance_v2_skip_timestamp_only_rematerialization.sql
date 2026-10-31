-- V2 is the dominant source of timestamp-only attendance churn.
-- Guard every substantive/evidentiary column, excluding only two regenerated
-- bookkeeping timestamps. This never deletes or rewrites historical audits.
create or replace function public.dawaa_materialize_attendance_day_internal_v2(p_staff_id uuid,p_attendance_date date)
returns public.attendance_daily_summary
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_preview jsonb;
  v_saved public.attendance_daily_summary%rowtype;
  v_system boolean;
  v_finalizable boolean;
  v_hours numeric;
  v_resolution_status text;
  v_action text;
begin
  select * into v_saved
  from public.attendance_daily_summary
  where staff_id=p_staff_id and attendance_date=p_attendance_date
    and status='approved' and coalesce(resolution_version,0)>=2
  limit 1;
  if found then return v_saved; end if;

  v_preview:=public.dawaa_build_attendance_day_resolution_v2(p_staff_id,p_attendance_date);
  v_system:=coalesce((v_preview->>'system_resolvable')::boolean,false);
  v_finalizable:=coalesce((v_preview->>'finalizable')::boolean,false);
  v_resolution_status:=v_preview->>'resolution_status';

  if not v_finalizable then
    select * into v_saved from public.attendance_daily_summary
    where staff_id=p_staff_id and attendance_date=p_attendance_date limit 1;
    return v_saved;
  end if;

  v_hours:=case when v_resolution_status in ('off_day','approved_time_off') then 0
    else coalesce((v_preview->>'candidate_hours')::numeric,0) end;

  insert into public.attendance_daily_summary(
    staff_id,attendance_date,branch,first_in,last_out,total_hours,late_minutes,early_leave_minutes,
    missing_punch,status,source,schedule_id,scheduled_start_at,scheduled_end_at,candidate_hours,
    payroll_eligible_hours,resolution_status,resolution_version,resolution_snapshot,
    approved_at,approved_by,approved_by_name,approval_note,updated_at,
    resolution_origin,review_required,resolved_at,time_off_request_id,policy_version,sync_complete_through
  ) values(
    p_staff_id,p_attendance_date,v_preview->>'branch',
    nullif(v_preview->>'first_in','')::timestamptz,
    nullif(v_preview->>'last_out','')::timestamptz,
    coalesce((v_preview->>'candidate_hours')::numeric,0),
    coalesce((v_preview->>'late_minutes')::integer,0),
    coalesce((v_preview->>'early_leave_minutes')::integer,0),
    not v_system,
    case when v_system then 'approved' else 'pending_review' end,
    'attendance_resolution_v2',
    nullif(v_preview->>'schedule_id','')::uuid,
    nullif(v_preview->>'scheduled_start_at','')::timestamptz,
    nullif(v_preview->>'scheduled_end_at','')::timestamptz,
    coalesce((v_preview->>'candidate_hours')::numeric,0),
    case when v_system then v_hours else null end,
    v_resolution_status,2,v_preview,
    case when v_system then now() else null end,
    case when v_system then 'system:auto-attendance-v2' else null end,
    case when v_system then 'النظام التلقائي للحضور' else null end,
    null,now(),
    case when v_system then 'system' else 'review_queue' end,
    not v_system,now(),
    nullif(v_preview->>'time_off_request_id','')::uuid,
    v_preview->>'policy_version',
    nullif(v_preview->>'sync_complete_through','')::timestamptz
  )
  on conflict(staff_id,attendance_date) where staff_id is not null and attendance_date is not null
  do update set
    branch=excluded.branch,first_in=excluded.first_in,last_out=excluded.last_out,total_hours=excluded.total_hours,
    late_minutes=excluded.late_minutes,early_leave_minutes=excluded.early_leave_minutes,missing_punch=excluded.missing_punch,
    status=excluded.status,source=excluded.source,schedule_id=excluded.schedule_id,scheduled_start_at=excluded.scheduled_start_at,
    scheduled_end_at=excluded.scheduled_end_at,candidate_hours=excluded.candidate_hours,payroll_eligible_hours=excluded.payroll_eligible_hours,
    resolution_status=excluded.resolution_status,resolution_version=excluded.resolution_version,resolution_snapshot=excluded.resolution_snapshot,
    approved_at=excluded.approved_at,approved_by=excluded.approved_by,approved_by_name=excluded.approved_by_name,
    approval_note=excluded.approval_note,updated_at=excluded.updated_at,resolution_origin=excluded.resolution_origin,
    review_required=excluded.review_required,resolved_at=excluded.resolved_at,time_off_request_id=excluded.time_off_request_id,
    policy_version=excluded.policy_version,sync_complete_through=excluded.sync_complete_through
  where public.attendance_daily_summary.status is distinct from 'approved'
    and row(
      public.attendance_daily_summary.branch,public.attendance_daily_summary.first_in,
      public.attendance_daily_summary.last_out,public.attendance_daily_summary.total_hours,
      public.attendance_daily_summary.late_minutes,public.attendance_daily_summary.early_leave_minutes,
      public.attendance_daily_summary.missing_punch,public.attendance_daily_summary.status,
      public.attendance_daily_summary.source,public.attendance_daily_summary.schedule_id,
      public.attendance_daily_summary.scheduled_start_at,public.attendance_daily_summary.scheduled_end_at,
      public.attendance_daily_summary.candidate_hours,public.attendance_daily_summary.payroll_eligible_hours,
      public.attendance_daily_summary.resolution_status,public.attendance_daily_summary.resolution_version,
      public.attendance_daily_summary.resolution_snapshot,public.attendance_daily_summary.approved_at,
      public.attendance_daily_summary.approved_by,public.attendance_daily_summary.approved_by_name,
      public.attendance_daily_summary.approval_note,public.attendance_daily_summary.resolution_origin,
      public.attendance_daily_summary.review_required,public.attendance_daily_summary.time_off_request_id,
      public.attendance_daily_summary.policy_version,public.attendance_daily_summary.sync_complete_through
    ) is distinct from row(
      excluded.branch,excluded.first_in,excluded.last_out,excluded.total_hours,
      excluded.late_minutes,excluded.early_leave_minutes,excluded.missing_punch,excluded.status,
      excluded.source,excluded.schedule_id,excluded.scheduled_start_at,excluded.scheduled_end_at,
      excluded.candidate_hours,excluded.payroll_eligible_hours,excluded.resolution_status,
      excluded.resolution_version,excluded.resolution_snapshot,excluded.approved_at,
      excluded.approved_by,excluded.approved_by_name,excluded.approval_note,
      excluded.resolution_origin,excluded.review_required,excluded.time_off_request_id,
      excluded.policy_version,excluded.sync_complete_through
    )
  returning * into v_saved;

  if v_saved.id is null then
    select * into v_saved from public.attendance_daily_summary
    where staff_id=p_staff_id and attendance_date=p_attendance_date limit 1;
  end if;

  if v_saved.id is not null then
    v_action:=case when v_saved.status='approved' then 'system_resolved' else 'review_queued' end;
    insert into public.attendance_resolution_audit(resolution_id,staff_id,attendance_date,action,actor_id,actor_name,note,snapshot)
    select v_saved.id,p_staff_id,p_attendance_date,v_action,'system:auto-attendance-v2','النظام التلقائي للحضور',v_preview->>'reason',v_preview
    where not exists(
      select 1 from public.attendance_resolution_audit a
      where a.resolution_id=v_saved.id and a.action=v_action and a.snapshot=v_preview
    );
    if v_saved.status='approved' then perform public.dawaa_sync_attendance_impact_for_resolution_v2(v_saved.id); end if;
  end if;

  return v_saved;
end;
$function$;

revoke all on function public.dawaa_materialize_attendance_day_internal_v2(uuid,date)
  from public,anon,authenticated;
grant execute on function public.dawaa_materialize_attendance_day_internal_v2(uuid,date)
  to service_role;
