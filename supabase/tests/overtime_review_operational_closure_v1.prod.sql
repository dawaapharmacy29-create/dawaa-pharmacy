-- Exact Production definitions (pg_get_functiondef, 2026-10-16) used by overtime_review_operational_closure_v1.fixture.sql.

CREATE OR REPLACE FUNCTION public.dawaa_can_manage_payroll_staff_id_v1(p_staff_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_actor_id uuid; v_actor_role text; v_actor_branch text; v_target_branch text; v_permissions jsonb;
begin
if p_staff_id is null then return false; end if; v_actor_id:=public.dawaa_current_staff_account_id_strict(); if v_actor_id is null then return false; end if;
select lower(trim(coalesce(role,''))),nullif(trim(coalesce(branch,'')),'') into v_actor_role,v_actor_branch from public.staff_accounts where id=v_actor_id and coalesce(active,false) and coalesce(can_login,false) limit 1;
if v_actor_role is null then return false; end if; v_permissions:=public.get_user_permissions(v_actor_id); if coalesce((v_permissions->>'manage_payroll')::boolean,false) is not true then return false; end if;
if v_actor_role in ('general_manager','executive_manager','branches_manager','admin','manager') then return true; end if; if v_actor_role<>'branch_manager' then return false; end if;
select nullif(trim(coalesce(branch,'')),'') into v_target_branch from public.staff where id=p_staff_id limit 1; return v_target_branch is not null and v_actor_branch is not null and v_target_branch=v_actor_branch;
end;$function$
;

CREATE OR REPLACE FUNCTION public.dawaa_overtime_multiplier_from_approval_v1(p_snapshot jsonb, p_note text)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select case
    when nullif(p_snapshot->>'multiplier','') is not null
      then nullif(p_snapshot->>'multiplier','')::numeric
    when coalesce(p_note,'') ~ '(×|x|X)\s*1[\.,]5' then 1.5::numeric
    when coalesce(p_note,'') ~ '×\s*2([^0-9]|$)' then 2::numeric
    when coalesce(p_note,'') ~ '×\s*1([^0-9]|$)' then 1::numeric
    when lower(coalesce(p_note,'')) like '%معامل 1.5%' then 1.5::numeric
    when lower(coalesce(p_note,'')) like '%معامل 2%' then 2::numeric
    when lower(coalesce(p_note,'')) like '%معامل 1%' then 1::numeric
    else null::numeric
  end;
$function$
;

CREATE OR REPLACE FUNCTION public.dawaa_overtime_multiplier_from_approval_v1(p_approval_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select public.dawaa_overtime_multiplier_from_approval_v1(o.decision_evidence_snapshot,o.decision_note)
  from public.staff_overtime_approvals o
  where o.id=p_approval_id
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.payroll_finalization_gate_current_v1(p_staff_id uuid, p_month_cycle text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_class jsonb;
  v_is_delivery boolean:=false;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_payroll_finalization_current_input' using errcode='22023';
  end if;
  if not public.dawaa_can_manage_payroll_staff_id_v1(p_staff_id) then
    raise exception 'not_authorized_for_payroll_finalization_current' using errcode='42501';
  end if;
  begin
    v_class:=public.dawaa_delivery_payroll_classification_v1(p_staff_id,p_month_cycle);
    v_is_delivery:=coalesce((v_class->>'payroll_eligible')::boolean,false);
  exception when others then
    v_is_delivery:=false;
  end;
  if v_is_delivery then
    return public.payroll_finalization_gate_v2(p_staff_id,p_month_cycle)
      || jsonb_build_object('schema','payroll_finalization_gate_current_v1','route','delivery_v2');
  end if;
  return public.payroll_finalization_gate_v1(p_staff_id,p_month_cycle)
    || jsonb_build_object('schema','payroll_finalization_gate_current_v1','route','standard_v1');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.decide_overtime_approval_v3(p_id uuid, p_decision text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_actor public.staff_accounts%rowtype;
  v_ot public.staff_overtime_approvals%rowtype;
  v_resolution public.attendance_daily_summary%rowtype;
  v_comp public.employee_compensation_profiles%rowtype;
  v_target_username text;
  v_fingerprint text;
  v_decision text:=lower(trim(coalesce(p_decision,'')));
  v_evidence jsonb;
  v_sched_hours numeric;
  v_extra_minutes integer;
  v_deviation jsonb;
  v_overtime_minutes integer;
  v_true_hourly_rate numeric;
  v_recalculated_hours numeric;
  v_recalculated_amount numeric;
begin
  if v_decision not in ('approved','rejected') then
    raise exception 'invalid_overtime_decision' using errcode='22023';
  end if;

  select * into v_actor
  from public.staff_accounts
  where id=public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false)=true
    and coalesce(can_login,false)=true;

  if not found or not public.dawaa_current_actor_can(array['manage_payroll']) then
    raise exception 'not_authorized_for_overtime_decision' using errcode='42501';
  end if;

  select * into v_ot
  from public.staff_overtime_approvals
  where id=p_id
  for update;

  if not found or v_ot.status<>'pending' then
    raise exception 'overtime_not_found_or_already_decided' using errcode='22023';
  end if;

  select sa.username into v_target_username
  from public.staff_accounts sa
  where trim(coalesce(sa.staff_id,''))=v_ot.staff_id::text
     or sa.id=v_ot.staff_id
  order by
    (trim(coalesce(sa.staff_id,''))=v_ot.staff_id::text) desc,
    coalesce(sa.active,true) desc,
    sa.updated_at desc nulls last
  limit 1;

  if v_target_username is null
     or not public.dawaa_can_manage_payroll_staff_v1(v_target_username) then
    raise exception 'not_authorized_for_overtime_staff' using errcode='42501';
  end if;

  select * into v_resolution
  from public.attendance_daily_summary a
  where a.staff_id=v_ot.staff_id
    and a.attendance_date=v_ot.attendance_date
  order by
    (a.status='approved') desc,
    coalesce(a.resolution_version,0) desc,
    a.updated_at desc nulls last,
    a.created_at desc
  limit 1;

  if v_decision='approved' then
    if not found
       or v_resolution.status<>'approved'
       or coalesce(v_resolution.resolution_version,0)<2
       or coalesce(v_resolution.resolution_status,'') not in
          ('on_time','late','very_late','on_time_with_permission','worked_on_off') then
      raise exception 'overtime_requires_approved_attendance_truth' using errcode='55000';
    end if;

    v_fingerprint:=public.attendance_resolution_fingerprint_v2(v_resolution.id);

    if v_ot.source_resolution_id is not null
       and v_ot.source_resolution_id<>v_resolution.id then
      raise exception 'overtime_source_resolution_changed' using errcode='55000';
    end if;

    if v_ot.source_resolution_fingerprint is not null
       and v_ot.source_resolution_fingerprint<>v_fingerprint then
      raise exception 'overtime_source_resolution_drifted' using errcode='55000';
    end if;

    if v_resolution.scheduled_start_at is null
       or v_resolution.scheduled_end_at is null then
      raise exception 'overtime_schedule_hours_missing' using errcode='55000';
    end if;

    v_sched_hours:=greatest(
      extract(epoch from(v_resolution.scheduled_end_at-v_resolution.scheduled_start_at))/3600.0,
      0
    );

    if v_sched_hours<=0 then
      raise exception 'overtime_schedule_hours_invalid' using errcode='55000';
    end if;

    select * into v_comp
    from public.employee_compensation_profiles p
    where p.staff_id=v_ot.staff_id::text
      and coalesce(p.active,true)
      and (p.effective_from is null or p.effective_from<=v_ot.attendance_date)
    order by
      p.effective_from desc nulls last,
      p.updated_at desc nulls last,
      p.created_at desc nulls last
    limit 1;

    if not found
       or coalesce(v_comp.exempt_from_lateness_deduction,false)
       or coalesce(v_comp.hourly_rate,0)<=0 then
      raise exception 'overtime_compensation_profile_not_eligible' using errcode='55000';
    end if;

    v_extra_minutes:=floor(
      greatest(coalesce(extract(epoch from (v_resolution.last_out-v_resolution.scheduled_end_at))/60.0,0),0)
    )::int;

    v_deviation:=public.dawaa_net_attendance_deviation_v1(
      coalesce(v_resolution.late_minutes,0),
      v_extra_minutes,
      (select s.role from public.staff s where s.id=v_ot.staff_id),
      false
    );
    v_overtime_minutes:=coalesce((v_deviation->>'overtime_minutes')::int,0);

    if v_overtime_minutes<10 then
      raise exception 'overtime_no_longer_eligible' using errcode='55000';
    end if;

    v_true_hourly_rate:=round(v_comp.hourly_rate/26.0,4);
    v_recalculated_hours:=round(v_overtime_minutes/60.0,2);
    v_recalculated_amount:=round(v_recalculated_hours*v_true_hourly_rate*1.5,2);
  end if;

  begin
    v_evidence:=public.overtime_decision_evidence_v3(p_id);
  exception when others then
    v_evidence:=jsonb_build_object(
      'evidence_available',false,
      'reason','evidence_snapshot_failed',
      'error',sqlerrm,
      'generated_at',now()
    );
  end;

  if v_decision='approved' then
    update public.staff_overtime_approvals
    set
      source_resolution_id=v_resolution.id,
      source_resolution_fingerprint=v_fingerprint,
      source_resolution_linked_at=now(),
      overtime_hours=v_recalculated_hours,
      hourly_rate=v_true_hourly_rate,
      overtime_amount=v_recalculated_amount,
      status='approved',
      decided_at=now(),
      decided_by=v_actor.id::text,
      decided_by_name=coalesce(v_actor.name,v_actor.username),
      decision_note=nullif(trim(coalesce(p_note,'')),''),
      decision_evidence_snapshot=v_evidence,
      decision_evidence_version='overtime_evidence_v3',
      updated_at=now()
    where id=p_id;
  else
    update public.staff_overtime_approvals
    set
      status='rejected',
      decided_at=now(),
      decided_by=v_actor.id::text,
      decided_by_name=coalesce(v_actor.name,v_actor.username),
      decision_note=nullif(trim(coalesce(p_note,'')),''),
      decision_evidence_snapshot=v_evidence,
      decision_evidence_version='overtime_evidence_v3',
      updated_at=now()
    where id=p_id;
  end if;

  return jsonb_build_object(
    'success',true,
    'id',p_id,
    'status',v_decision,
    'attendance_resolution_id',
      case when v_decision='approved' then v_resolution.id else v_ot.source_resolution_id end,
    'truth_validated',v_decision='approved',
    'recalculated_from_current_truth',v_decision='approved',
    'overtime_hours',case when v_decision='approved' then v_recalculated_hours else v_ot.overtime_hours end,
    'overtime_amount',case when v_decision='approved' then v_recalculated_amount else v_ot.overtime_amount end,
    'evidence_version','overtime_evidence_v3',
    'evidence_available',coalesce((v_evidence->>'evidence_available')::boolean,false)
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.dawaa_net_attendance_deviation_v1(p_late_minutes integer, p_extra_minutes integer, p_role text, p_is_compensated boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  v_is_delivery boolean := coalesce(p_role, '') ilike '%توصيل%';
  v_late int := greatest(coalesce(p_late_minutes,0), 0);
  v_extra int := greatest(coalesce(p_extra_minutes,0), 0);
  v_deduction int := 0;
  v_overtime int := 0;
begin
  if v_is_delivery then
    if v_late <= 0 then
      v_deduction := 0;
    elsif v_late < 30 then
      v_deduction := case when coalesce(p_is_compensated,false) then 0 else v_late end;
    else
      v_deduction := v_late * 2;
    end if;

    v_overtime := case when v_extra > 20 then v_extra else 0 end;

    return jsonb_build_object(
      'deduction_minutes', v_deduction,
      'overtime_minutes', v_overtime
    );
  end if;

  -- Lateness compensation affects lateness deduction only.
  -- It must never consume minutes worked after the scheduled shift end.
  if v_extra >= v_late and v_late > 0 then
    if v_late <= 20 then
      v_deduction := 0;
    else
      v_deduction := v_late;
    end if;
  else
    if v_late <= 20 then
      v_deduction := 0;
    elsif v_late <= 60 then
      v_deduction := v_late * 2;
    else
      v_deduction := v_late * 4;
    end if;
  end if;

  -- Overtime is the raw time after scheduled_end, independent from late penalty.
  v_overtime := case when v_extra > 20 then v_extra else 0 end;

  return jsonb_build_object(
    'deduction_minutes', v_deduction,
    'overtime_minutes', v_overtime
  );
end;
$function$
;
