-- Harden missing-punch workflow: a new incident can only originate from a matching
-- Attendance Truth missing-checkin/missing-checkout state.

create or replace function public.resolve_missing_punch_incident_v1(
  p_staff_id uuid,
  p_date date,
  p_missing_type text,
  p_recorded_at timestamptz default null,
  p_reason text default null,
  p_apply_deduction boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_staff public.staff%rowtype;
  v_actor public.staff_accounts%rowtype;
  v_attendance public.attendance_daily_summary%rowtype;
  v_cycle text;
  v_incident public.attendance_missing_punch_incidents%rowtype;
  v_occurrence integer;
  v_manual_id uuid;
  v_tx_id uuid;
  v_reason text:=coalesce(nullif(trim(coalesce(p_reason,'')),''),'نسيان بصمة — معالجة من صندوق مراجعة الحضور');
  v_local_date date;
  v_expected_status text;
begin
  if p_staff_id is null or p_date is null or p_missing_type not in ('check_in','check_out') then
    raise exception 'invalid_missing_punch_resolution' using errcode='22023';
  end if;

  select * into v_staff from public.staff where id=p_staff_id and coalesce(active,false)=true;
  if not found then raise exception 'staff_not_found_or_inactive' using errcode='22023'; end if;

  if not public.dawaa_can_read_staff_attendance_log(v_staff.id,v_staff.branch) then
    raise exception 'not_authorized_for_missing_punch_resolution' using errcode='42501';
  end if;

  select * into v_actor
  from public.staff_accounts sa
  where sa.id=public.dawaa_current_staff_account_id_strict();

  if v_actor.id is null then
    raise exception 'attendance_actor_not_resolved' using errcode='42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_staff_id::text||':'||p_date::text||':'||p_missing_type,0
  ));

  v_cycle:=public.dawaa_points_cycle_label_for_date_v3(p_date);
  v_expected_status:=case when p_missing_type='check_in' then 'missing_checkin' else 'missing_checkout' end;

  select * into v_incident
  from public.attendance_missing_punch_incidents
  where staff_id=p_staff_id and attendance_date=p_date and missing_type=p_missing_type
  for update;

  if v_incident.id is null then
    select * into v_attendance
    from public.attendance_daily_summary
    where staff_id=p_staff_id and attendance_date=p_date
    order by updated_at desc
    limit 1
    for update;

    if v_attendance.id is null or v_attendance.status<>'pending_review'
       or v_attendance.resolution_status<>v_expected_status then
      raise exception 'missing_punch_truth_mismatch' using errcode='55000';
    end if;

    select count(*)::int+1 into v_occurrence
    from public.attendance_missing_punch_incidents
    where staff_id=p_staff_id and month_cycle=v_cycle;

    insert into public.attendance_missing_punch_incidents(
      staff_id,staff_name,branch,attendance_date,missing_type,month_cycle,
      occurrence_no,allowance_limit,penalty_eligible,penalty_amount,
      reason,actor_id,actor_name,actor_role
    ) values (
      v_staff.id,v_staff.name,v_staff.branch,p_date,p_missing_type,v_cycle,
      v_occurrence,2,v_occurrence>2,50,
      v_reason,v_actor.id::text,coalesce(v_actor.name,v_actor.staff_name,v_actor.username),v_actor.role
    ) returning * into v_incident;
  end if;

  if p_recorded_at is not null and v_incident.manual_punch_id is null then
    if p_recorded_at>now()+interval '5 minutes' then
      raise exception 'manual_punch_time_in_future' using errcode='22023';
    end if;

    v_local_date:=(p_recorded_at at time zone 'Africa/Cairo')::date;
    if v_local_date not in (p_date,p_date+1) then
      raise exception 'manual_punch_time_outside_attendance_day_window' using errcode='22023';
    end if;

    perform set_config('dawaa.manual_attendance_target',v_staff.id::text,true);

    insert into public.staff_attendance_logs(
      staff_id,staff_name,role,branch_name,attendance_type,recorded_at,
      shift_date,biometric_verified,biometric_method,status,rejection_reason,created_by
    ) values (
      v_staff.id,v_staff.name,v_staff.role,v_staff.branch,p_missing_type,p_recorded_at,
      p_date,false,'not_checked','accepted',null,v_actor.id
    ) returning id into v_manual_id;

    update public.attendance_missing_punch_incidents
    set manual_punch_id=v_manual_id,reason=v_reason,updated_at=now()
    where id=v_incident.id
    returning * into v_incident;

    insert into public.attendance_manual_actions_audit(
      action_type,staff_id,target_id,old_value,new_value,reason,
      actor_account_id,actor_name,actor_role
    ) values (
      'manual_punch_entry',v_staff.id,v_manual_id,null,
      jsonb_build_object(
        'attendance_type',p_missing_type,
        'recorded_at',p_recorded_at,
        'attendance_date',p_date,
        'incident_id',v_incident.id,
        'occurrence_no',v_incident.occurrence_no
      ),
      v_reason,v_actor.id,coalesce(v_actor.name,v_actor.staff_name,v_actor.username),v_actor.role
    );
  end if;

  if p_apply_deduction and v_incident.deduction_transaction_id is null then
    if v_incident.occurrence_no<=v_incident.allowance_limit then
      raise exception 'missing_punch_allowance_not_exhausted' using errcode='55000';
    end if;

    insert into public.employee_transactions(
      staff_id,employee_name,branch,type,title,reason,description,amount,points,points_delta,
      source,source_id,transaction_date,month_cycle,status,employee_visible,created_by,
      approved_by,approved_at,category,metadata
    ) values (
      v_staff.id,v_staff.name,v_staff.branch,'penalty','خصم نسيان بصمة',
      'نسيان بصمة بعد استهلاك مرات السماح',
      format('خصم 50 ج.م — نسيان %s رقم %s في دورة %s. أول مرتين سماح.',
        case when p_missing_type='check_in' then 'بصمة الدخول' else 'بصمة الخروج' end,
        v_incident.occurrence_no,v_cycle),
      50,0,0,
      'attendance_missing_punch_v1',v_incident.id,p_date,v_cycle,'active',true,
      v_actor.id::text,v_actor.id::text,now(),'attendance',
      jsonb_build_object(
        'missing_punch_incident_id',v_incident.id,
        'missing_type',p_missing_type,
        'occurrence_no',v_incident.occurrence_no,
        'allowance_limit',v_incident.allowance_limit,
        'fixed_penalty_egp',50
      )
    ) returning id into v_tx_id;

    update public.attendance_missing_punch_incidents
    set deduction_transaction_id=v_tx_id,updated_at=now()
    where id=v_incident.id
    returning * into v_incident;

    insert into public.attendance_manual_actions_audit(
      action_type,staff_id,target_id,old_value,new_value,reason,
      actor_account_id,actor_name,actor_role
    ) values (
      'deduction_adjustment',v_staff.id,v_tx_id,null,
      jsonb_build_object('amount',50,'incident_id',v_incident.id,'occurrence_no',v_incident.occurrence_no),
      v_reason,v_actor.id,coalesce(v_actor.name,v_actor.staff_name,v_actor.username),v_actor.role
    );
  end if;

  if v_incident.manual_punch_id is not null then
    perform public.dawaa_materialize_attendance_day_internal_v2(v_staff.id,p_date);
  end if;

  return jsonb_build_object(
    'success',true,
    'incident_id',v_incident.id,
    'staff_id',v_staff.id,
    'staff_name',v_staff.name,
    'attendance_date',p_date,
    'missing_type',p_missing_type,
    'month_cycle',v_incident.month_cycle,
    'occurrence_no',v_incident.occurrence_no,
    'allowance_limit',v_incident.allowance_limit,
    'penalty_eligible',v_incident.penalty_eligible,
    'penalty_amount',v_incident.penalty_amount,
    'manual_punch_id',v_incident.manual_punch_id,
    'deduction_transaction_id',v_incident.deduction_transaction_id
  );
end;
$$;
