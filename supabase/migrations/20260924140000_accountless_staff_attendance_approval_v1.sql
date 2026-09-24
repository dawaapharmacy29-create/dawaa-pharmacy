-- Preserve approval authorization for staff without login accounts.
create or replace function public.approve_attendance_day_resolution_v2(
  p_staff_id uuid,
  p_attendance_date date,
  p_payroll_eligible_hours numeric default null,
  p_note text default null
)
returns public.attendance_daily_summary
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_username text;
  v_staff_exists boolean;
  v_actor_id text:=public.employee_operating_actor_id();
  v_actor_name text;
  v_actor_role text;
  v_preview jsonb;
  v_saved public.attendance_daily_summary%rowtype;
  v_candidate numeric;
  v_hours numeric;
  v_system boolean;
begin
  select sa.username into v_username
  from public.staff_accounts sa
  where trim(coalesce(sa.staff_id,''))=p_staff_id::text or sa.id=p_staff_id
  order by (trim(coalesce(sa.staff_id,''))=p_staff_id::text) desc,coalesce(sa.active,true) desc limit 1;

  -- Attendance identity is staff.id; a login account is optional for a staff member.
  select exists(select 1 from public.staff s where s.id=p_staff_id) into v_staff_exists;
  if not v_staff_exists then
    raise exception 'attendance_resolution_staff_identity_missing' using errcode='22023';
  end if;
  if v_username is not null then
    if not public.dawaa_can_manage_payroll_staff_v1(v_username) then
      raise exception 'not_authorized_for_attendance_resolution' using errcode='42501';
    end if;
  else
    -- The existing username-based branch scope cannot authorize accountless staff.
    -- Require an active senior manager with the explicit payroll permission.
    if public.dawaa_current_staff_account_id_strict() is null
       or not public.dawaa_actor_is_top_management_v1()
       or coalesce((public.get_user_permissions(public.dawaa_current_staff_account_id_strict())->>'manage_payroll')::boolean,false) is not true then
      raise exception 'not_authorized_for_attendance_resolution' using errcode='42501';
    end if;
  end if;

  select * into v_saved from public.attendance_daily_summary
  where staff_id=p_staff_id and attendance_date=p_attendance_date
    and status='approved' and coalesce(resolution_version,0)>=2
  for update;
  if found then return v_saved; end if;

  v_preview:=public.dawaa_build_attendance_day_resolution_v2(p_staff_id,p_attendance_date);
  if not coalesce((v_preview->>'finalizable')::boolean,false) then
    raise exception 'attendance_resolution_not_finalizable_yet' using errcode='22023';
  end if;

  v_candidate:=coalesce((v_preview->>'candidate_hours')::numeric,0);
  v_system:=coalesce((v_preview->>'system_resolvable')::boolean,false);
  v_hours:=coalesce(p_payroll_eligible_hours,case when v_preview->>'resolution_status' in ('off_day','approved_time_off') then 0 else v_candidate end);

  if v_hours<0 or v_hours>18 then raise exception 'attendance_resolution_hours_out_of_range' using errcode='22023'; end if;
  if not v_system and nullif(trim(coalesce(p_note,'')),'') is null then
    raise exception 'attendance_resolution_review_requires_note' using errcode='22023';
  end if;
  if abs(v_hours-v_candidate)>0.01
     and v_preview->>'resolution_status' not in ('off_day','approved_time_off')
     and nullif(trim(coalesce(p_note,'')),'') is null then
    raise exception 'attendance_resolution_changed_hours_require_note' using errcode='22023';
  end if;

  select coalesce(sa.name,sa.staff_name,sa.username),coalesce(sa.role,'')
    into v_actor_name,v_actor_role
  from public.staff_accounts sa where sa.id::text=v_actor_id limit 1;

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
    v_candidate,
    coalesce((v_preview->>'late_minutes')::integer,0),
    coalesce((v_preview->>'early_leave_minutes')::integer,0),
    not v_system,'approved','attendance_resolution_v2',
    nullif(v_preview->>'schedule_id','')::uuid,
    nullif(v_preview->>'scheduled_start_at','')::timestamptz,
    nullif(v_preview->>'scheduled_end_at','')::timestamptz,
    v_candidate,v_hours,
    v_preview->>'resolution_status',2,
    v_preview||jsonb_build_object('manager_approved_payroll_eligible_hours',v_hours,'manager_approval_note',nullif(trim(coalesce(p_note,'')),'')),
    now(),v_actor_id,v_actor_name,nullif(trim(coalesce(p_note,'')),''),now(),
    'manager',false,now(),
    nullif(v_preview->>'time_off_request_id','')::uuid,
    v_preview->>'policy_version',
    nullif(v_preview->>'sync_complete_through','')::timestamptz
  )
  on conflict(staff_id,attendance_date) where staff_id is not null and attendance_date is not null
  do update set
    branch=excluded.branch,first_in=excluded.first_in,last_out=excluded.last_out,total_hours=excluded.total_hours,
    late_minutes=excluded.late_minutes,early_leave_minutes=excluded.early_leave_minutes,missing_punch=excluded.missing_punch,
    status='approved',source=excluded.source,schedule_id=excluded.schedule_id,scheduled_start_at=excluded.scheduled_start_at,
    scheduled_end_at=excluded.scheduled_end_at,candidate_hours=excluded.candidate_hours,payroll_eligible_hours=excluded.payroll_eligible_hours,
    resolution_status=excluded.resolution_status,resolution_version=2,resolution_snapshot=excluded.resolution_snapshot,
    approved_at=excluded.approved_at,approved_by=excluded.approved_by,approved_by_name=excluded.approved_by_name,
    approval_note=excluded.approval_note,updated_at=excluded.updated_at,resolution_origin='manager',review_required=false,
    resolved_at=excluded.resolved_at,time_off_request_id=excluded.time_off_request_id,policy_version=excluded.policy_version,
    sync_complete_through=excluded.sync_complete_through
  where public.attendance_daily_summary.status is distinct from 'approved'
  returning * into v_saved;

  if v_saved.id is null then
    select * into v_saved from public.attendance_daily_summary where staff_id=p_staff_id and attendance_date=p_attendance_date limit 1;
  end if;

  insert into public.attendance_resolution_audit(
    resolution_id,staff_id,attendance_date,action,actor_id,actor_name,actor_role,note,snapshot
  ) values(
    v_saved.id,p_staff_id,p_attendance_date,'manager_approved',v_actor_id,v_actor_name,v_actor_role,
    nullif(trim(coalesce(p_note,'')),''),v_saved.resolution_snapshot
  );

  perform public.dawaa_sync_attendance_impact_for_resolution_v2(v_saved.id);
  return v_saved;
end;
$function$;

revoke all on function public.approve_attendance_day_resolution_v2(uuid,date,numeric,text) from public,anon;
grant execute on function public.approve_attendance_day_resolution_v2(uuid,date,numeric,text) to authenticated,service_role;

