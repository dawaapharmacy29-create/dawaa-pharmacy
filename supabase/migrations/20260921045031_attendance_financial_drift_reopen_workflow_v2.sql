CREATE OR REPLACE FUNCTION public.reopen_attendance_resolution_v1(p_staff_id uuid, p_attendance_date date, p_note text)
 RETURNS attendance_daily_summary
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_username text;
  v_actor_id text:=public.employee_operating_actor_id();
  v_actor_name text;
  v_actor_role text;
  v_saved public.attendance_daily_summary%rowtype;
  v_preview jsonb;
  v_old_snapshot jsonb;
  v_candidate numeric;
  v_cycle record;
  v_locked boolean:=false;
begin
  if p_staff_id is null or p_attendance_date is null then
    raise exception 'attendance_reopen_identity_or_date_missing' using errcode='22023';
  end if;
  if nullif(trim(coalesce(p_note,'')),'') is null then
    raise exception 'attendance_reopen_note_required' using errcode='22023';
  end if;

  select sa.username into v_username
  from public.staff_accounts sa
  where trim(coalesce(sa.staff_id,''))=p_staff_id::text or sa.id=p_staff_id
  order by (trim(coalesce(sa.staff_id,''))=p_staff_id::text) desc,coalesce(sa.active,true) desc
  limit 1;
  if v_username is null then raise exception 'attendance_resolution_staff_identity_missing'; end if;
  if not public.dawaa_can_manage_payroll_staff_v1(v_username) then
    raise exception 'not_authorized_for_attendance_resolution' using errcode='42501';
  end if;

  select a.* into v_saved
  from public.attendance_daily_summary a
  where a.staff_id=p_staff_id
    and a.attendance_date=p_attendance_date
    and a.status='approved'
  order by a.updated_at desc nulls last,a.created_at desc
  limit 1
  for update;

  if v_saved.id is null then
    raise exception 'attendance_resolution_not_approved' using errcode='22023';
  end if;

  select * into v_cycle from public.dawaa_pay_cycle_bounds_v1(p_attendance_date);

  select exists(
    select 1 from public.staff_payroll_monthly_v13 p
    where p.staff_id=p_staff_id
      and (
        (p.cycle_start=v_cycle.cycle_start and p.cycle_end=v_cycle.cycle_end)
        or p.payroll_month=v_cycle.cycle_end
      )
      and (
        coalesce(p.status,'') in ('approved','paid','locked','closed')
        or p.approved_at is not null
        or p.paid_at is not null
      )
  ) into v_locked;

  if v_locked then
    raise exception 'attendance_resolution_payroll_cycle_locked' using errcode='22023';
  end if;

  v_preview:=public.dawaa_build_attendance_day_resolution_v2(p_staff_id,p_attendance_date);
  v_candidate:=coalesce((v_preview->>'candidate_hours')::numeric,0);

  if abs(coalesce(v_saved.candidate_hours,0)-v_candidate)<=0.10 then
    raise exception 'attendance_resolution_no_financial_drift' using errcode='22023';
  end if;

  select coalesce(sa.name,sa.staff_name,sa.username),coalesce(sa.role,'')
    into v_actor_name,v_actor_role
  from public.staff_accounts sa
  where sa.id::text=v_actor_id
  limit 1;

  v_old_snapshot:=to_jsonb(v_saved);

  insert into public.attendance_resolution_audit(
    resolution_id,staff_id,attendance_date,action,actor_id,actor_name,actor_role,note,snapshot
  ) values(
    v_saved.id,p_staff_id,p_attendance_date,'manager_reopened_financial_drift',
    v_actor_id,v_actor_name,v_actor_role,trim(p_note),
    jsonb_build_object('stored',v_old_snapshot,'rebuilt',v_preview)
  );

  update public.attendance_impact_ledger
  set impact_status='superseded'
  where source_resolution_id=v_saved.id
    and impact_status is distinct from 'superseded';

  update public.attendance_daily_summary
  set
    branch=coalesce(v_preview->>'branch',branch),
    first_in=nullif(v_preview->>'first_in','')::timestamptz,
    last_out=nullif(v_preview->>'last_out','')::timestamptz,
    total_hours=v_candidate,
    late_minutes=coalesce((v_preview->>'late_minutes')::integer,0),
    early_leave_minutes=coalesce((v_preview->>'early_leave_minutes')::integer,0),
    missing_punch=coalesce((v_preview->>'review_required')::boolean,true),
    status='pending_review',
    source='attendance_resolution_v2_reopened',
    schedule_id=nullif(v_preview->>'schedule_id','')::uuid,
    scheduled_start_at=nullif(v_preview->>'scheduled_start_at','')::timestamptz,
    scheduled_end_at=nullif(v_preview->>'scheduled_end_at','')::timestamptz,
    candidate_hours=v_candidate,
    payroll_eligible_hours=null,
    resolution_status=v_preview->>'resolution_status',
    resolution_version=2,
    resolution_snapshot=v_preview||jsonb_build_object(
      'reopened_from_approved',true,
      'previous_approved_snapshot',v_old_snapshot,
      'reopen_note',trim(p_note)
    ),
    approved_at=null,
    approved_by=null,
    approved_by_name=null,
    approval_note=null,
    updated_at=now(),
    resolution_origin='reopened',
    review_required=true,
    resolved_at=null,
    time_off_request_id=nullif(v_preview->>'time_off_request_id','')::uuid,
    policy_version=v_preview->>'policy_version',
    sync_complete_through=nullif(v_preview->>'sync_complete_through','')::timestamptz
  where id=v_saved.id
  returning * into v_saved;

  return v_saved;
end;
$function$


revoke all on function public.reopen_attendance_resolution_v1(uuid,date,text) from public;
grant execute on function public.reopen_attendance_resolution_v1(uuid,date,text) to anon,authenticated,service_role;
