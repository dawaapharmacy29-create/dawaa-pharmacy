CREATE OR REPLACE FUNCTION public.dawaa_detect_pending_overtime_v2(p_lookback_days integer DEFAULT 3)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_day record; v_comp public.employee_compensation_profiles%rowtype;
  v_sched_hours numeric; v_extra_minutes integer; v_deviation jsonb; v_overtime_minutes integer;
  v_true_hourly_rate numeric; v_fingerprint text; v_inserted integer:=0; v_skipped_unapproved integer:=0;
  v_today date:=(now() at time zone 'Africa/Cairo')::date;
begin
  if p_lookback_days is null or p_lookback_days<1 or p_lookback_days>31 then
    raise exception 'invalid_overtime_lookback' using errcode='22023';
  end if;
  for v_day in
    select a.*,s.name staff_name,s.branch staff_branch,s.role staff_role
    from public.attendance_daily_summary a join public.staff s on s.id=a.staff_id
    where a.attendance_date between v_today-p_lookback_days and v_today-1
      and a.status='approved' and coalesce(a.resolution_version,0)>=2
      and coalesce(a.resolution_status,'') in ('on_time','late','very_late','on_time_with_permission','worked_on_off')
      and coalesce(a.candidate_hours,0)>0
      and not exists(select 1 from public.staff_overtime_approvals o where o.staff_id=a.staff_id and o.attendance_date=a.attendance_date)
  loop
    select * into v_comp from public.employee_compensation_profiles p
    where p.staff_id=v_day.staff_id::text and coalesce(p.active,true)
      and (p.effective_from is null or p.effective_from<=v_day.attendance_date)
    order by p.effective_from desc nulls last,p.updated_at desc nulls last,p.created_at desc nulls last limit 1;
    if coalesce(v_comp.exempt_from_lateness_deduction,false) then continue; end if;
    v_sched_hours:=case when v_day.scheduled_start_at is not null and v_day.scheduled_end_at is not null
      then greatest(extract(epoch from(v_day.scheduled_end_at-v_day.scheduled_start_at))/3600.0,0) else null end;
    if v_sched_hours is null or v_sched_hours<=0 then v_skipped_unapproved:=v_skipped_unapproved+1; continue; end if;
    v_extra_minutes:=floor(greatest(coalesce(extract(epoch from (v_day.last_out-v_day.scheduled_end_at))/60.0,0),0))::int;
    v_deviation:=public.dawaa_net_attendance_deviation_v1(coalesce(v_day.late_minutes,0),v_extra_minutes,v_day.staff_role,false);
    v_overtime_minutes:=coalesce((v_deviation->>'overtime_minutes')::int,0);
    if v_overtime_minutes<10 then continue; end if;
    v_true_hourly_rate:=case when coalesce(v_comp.hourly_rate,0)>0 then round(v_comp.hourly_rate/26.0,4) else null end;
    v_fingerprint:=public.attendance_resolution_fingerprint_v2(v_day.id);
    insert into public.staff_overtime_approvals(
      staff_id,staff_name,branch,attendance_date,overtime_hours,hourly_rate,overtime_amount,status,
      decision_note,source_resolution_id,source_resolution_fingerprint,source_resolution_linked_at
    ) values(
      v_day.staff_id,v_day.staff_name,v_day.staff_branch,v_day.attendance_date,round(v_overtime_minutes/60.0,2),
      v_true_hourly_rate,case when v_true_hourly_rate is not null then round((v_overtime_minutes/60.0)*v_true_hourly_rate*1.5,2) else null end,
      'pending',case when v_overtime_minutes>360 then 'تنبيه: ساعات إضافية كبيرة — راجع اليوم قبل الاعتماد.' else null end,
      v_day.id,v_fingerprint,now()
    ) on conflict(staff_id,attendance_date) do nothing;
    if found then v_inserted:=v_inserted+1; end if;
  end loop;
  return jsonb_build_object('queued',v_inserted,'skipped_without_valid_schedule_hours',v_skipped_unapproved,
    'source','approved_attendance_truth_v2','lookback_days',p_lookback_days);
end; $function$;

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
$function$;

CREATE OR REPLACE FUNCTION public.get_staff_attendance_detail_v1(p_staff_id uuid, p_start date, p_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_can boolean;
  v_is_self boolean := false;
  v_actor_account_id uuid;
  v_actor_staff_id uuid;
  v_staff record;
  v_comp record;
  v_days jsonb := '[]'::jsonb;
  v_d date;
  v_r jsonb;
  v_ot_row record;
  v_extra_minutes int;
  v_scheduled_hours numeric;
  v_summary jsonb;
  v_total_late int := 0; v_total_early int := 0; v_total_hours numeric := 0;
  v_total_ot_worked numeric := 0; v_total_ot_approved numeric := 0; v_total_ot_pending numeric := 0;
  v_late_days int := 0; v_absence_days int := 0; v_off_days int := 0; v_leave_days int := 0; v_review_days int := 0;
  v_absence_hours numeric := 0;
  v_overtime_rate numeric;
  v_true_hourly_rate numeric;
  v_late_penalty_minutes int := 0;
  v_day_late int; v_day_penalty int; v_day_overtime_minutes int; v_deviation jsonb;
  v_exempt boolean;
begin
  if p_end - p_start > 62 then raise exception 'range_too_large'; end if;

  v_actor_account_id := public.dawaa_current_staff_account_id_strict();
  if v_actor_account_id is not null then
    select staff_id::uuid into v_actor_staff_id from public.staff_accounts where id = v_actor_account_id and staff_id ~* '^[0-9a-f]{8}-';
  end if;
  v_is_self := (v_actor_staff_id is not null and v_actor_staff_id = p_staff_id);

  v_can := v_is_self or public.dawaa_current_actor_can(array['view_staff_details','view_hr_compliance','view_team','manage_payroll']);
  if not v_can then raise exception 'not_authorized'; end if;

  select id, name, role, branch into v_staff from public.staff where id = p_staff_id;
  if not found then raise exception 'staff_not_found'; end if;
  if not v_is_self and not public.current_user_branch_access_v1(v_staff.branch, true) then raise exception 'branch_scope_denied'; end if;

  select * into v_comp from public.employee_compensation_profiles
  where staff_id = p_staff_id::text and active = true
  order by effective_from desc nulls last limit 1;

  v_true_hourly_rate := case when v_comp.hourly_rate is not null and v_comp.hourly_rate > 0 then round(v_comp.hourly_rate / 26.0, 4) else null end;
  v_overtime_rate := case when v_true_hourly_rate is not null then v_true_hourly_rate * 1.5 else null end;
  v_exempt := coalesce(v_comp.exempt_from_lateness_deduction, false);

  for v_d in select generate_series(p_start, p_end, interval '1 day')::date loop
    v_r := public.dawaa_build_attendance_day_resolution_v2(p_staff_id, v_d);
    v_scheduled_hours := case when (v_r->>'scheduled_start_at') is not null and (v_r->>'scheduled_end_at') is not null
      then extract(epoch from ((v_r->>'scheduled_end_at')::timestamptz - (v_r->>'scheduled_start_at')::timestamptz))/3600.0
      else null end;

    select status into v_ot_row from public.staff_overtime_approvals where staff_id = p_staff_id and attendance_date = v_d;

    v_day_late := coalesce((v_r->>'late_minutes')::int,0);

    if (v_r->>'resolution_status') in ('on_time','late','very_late','on_time_with_permission','worked_on_off') then
      v_extra_minutes := floor(greatest(coalesce(extract(epoch from (((v_r->>'last_out')::timestamptz)-((v_r->>'scheduled_end_at')::timestamptz)))/60.0,0),0))::int;
    else
      v_extra_minutes := 0;
    end if;

    -- (تم الإصلاح) خصم موحّد يراعي المقاصة، وأوفرتايم صافٍ بعد خصم ما عوّض التأخير
    v_deviation := public.dawaa_net_attendance_deviation_v1(v_day_late, v_extra_minutes, v_staff.role, false);
    v_day_penalty := case when v_exempt then 0 else coalesce((v_deviation->>'deduction_minutes')::int, 0) end;
    v_day_overtime_minutes := coalesce((v_deviation->>'overtime_minutes')::int, 0);
    v_late_penalty_minutes := v_late_penalty_minutes + v_day_penalty;

    v_total_late := v_total_late + v_day_late;
    v_total_early := v_total_early + coalesce((v_r->>'early_leave_minutes')::int,0);
    v_total_hours := v_total_hours + coalesce((v_r->>'candidate_hours')::numeric,0);
    v_total_ot_worked := v_total_ot_worked + (v_day_overtime_minutes/60.0);
    if v_ot_row.status = 'approved' then v_total_ot_approved := v_total_ot_approved + (v_day_overtime_minutes/60.0);
    elsif v_ot_row.status = 'pending' or (v_day_overtime_minutes > 0 and v_ot_row.status is null) then v_total_ot_pending := v_total_ot_pending + (v_day_overtime_minutes/60.0);
    end if;

    if (v_r->>'resolution_status') in ('late','very_late') then v_late_days := v_late_days + 1; end if;
    if (v_r->>'resolution_status') in ('absence_review') then
      v_absence_days := v_absence_days + 1;
      v_absence_hours := v_absence_hours + coalesce(v_scheduled_hours, 0);
    end if;
    if (v_r->>'resolution_status') = 'off_day' then v_off_days := v_off_days + 1; end if;
    if (v_r->>'resolution_status') = 'approved_time_off' then v_leave_days := v_leave_days + 1; end if;
    if (v_r->>'resolution_status') in ('no_schedule','needs_event_review','schedule_conflict','time_off_conflict','invalid_schedule_time','shift_swap_requires_schedule','time_off_with_events','invalid_duration','missing_checkin','missing_checkout') then v_review_days := v_review_days + 1; end if;

    v_days := v_days || jsonb_build_object(
      'attendance_date', v_d,
      'day_name', v_r->>'day_name',
      'resolution_status', v_r->>'resolution_status',
      'is_off_day', (v_r->>'is_off_day')::boolean,
      'first_in', v_r->'first_in',
      'last_out', v_r->'last_out',
      'candidate_hours', v_r->>'candidate_hours',
      'scheduled_hours', v_scheduled_hours,
      'overtime_hours', round(v_day_overtime_minutes/60.0,2),
      'overtime_approval_status', coalesce(v_ot_row.status, case when v_day_overtime_minutes > 0 then 'pending' else null end),
      'late_minutes', v_day_late,
      'late_penalty_minutes', v_day_penalty,
      'late_compensated', v_exempt or (v_day_late > 0 and v_day_penalty < v_day_late * 2 and v_day_penalty > 0) or (v_day_late > 0 and v_day_penalty = 0 and v_day_late<=20),
      'early_leave_minutes', v_r->>'early_leave_minutes',
      'time_off_kind', v_r->>'time_off_kind',
      'permission_attached', v_r->'permission_attached',
      'reason', v_r->>'reason'
    );
  end loop;

  v_summary := jsonb_build_object(
    'period_days', (p_end - p_start + 1),
    'off_days', v_off_days,
    'approved_leave_days', v_leave_days,
    'late_days', v_late_days,
    'absence_review_days', v_absence_days,
    'needs_review_days', v_review_days,
    'total_late_minutes', v_total_late,
    'late_penalty_minutes', v_late_penalty_minutes,
    'total_early_leave_minutes', v_total_early,
    'total_worked_hours', round(v_total_hours,2),
    'total_overtime_hours_worked', round(v_total_ot_worked,2),
    'total_overtime_hours_approved', round(v_total_ot_approved,2),
    'total_overtime_hours_pending', round(v_total_ot_pending,2),
    'hourly_rate', v_comp.hourly_rate,
    'true_hourly_rate', v_true_hourly_rate,
    'exempt_from_lateness_deduction', v_exempt,
    'overtime_hour_rate', v_overtime_rate,
    'monthly_base_salary', nullif(v_comp.monthly_base_salary, 0),
    'late_deduction_amount', case when v_exempt then 0 when v_true_hourly_rate is not null then round((v_late_penalty_minutes/60.0) * v_true_hourly_rate, 2) else null end,
    'early_leave_deduction_amount', case when v_exempt then 0 when v_true_hourly_rate is not null then round((v_total_early/60.0) * v_true_hourly_rate, 2) else null end,
    'absence_deduction_amount', case when v_true_hourly_rate is not null then round(v_absence_hours * v_true_hourly_rate, 2) else null end,
    'overtime_amount_approved', case when v_overtime_rate is not null then round(v_total_ot_approved * v_overtime_rate, 2) else null end,
    'overtime_amount_pending_estimate', case when v_overtime_rate is not null then round(v_total_ot_pending * v_overtime_rate, 2) else null end,
    'compensation_profile_complete', (v_comp.hourly_rate is not null and v_comp.hourly_rate > 0)
  );

  return jsonb_build_object(
    'staff', jsonb_build_object('id', v_staff.id, 'name', v_staff.name, 'role', v_staff.role, 'branch', v_staff.branch),
    'days', v_days,
    'summary', v_summary
  );
end;
$function$;

with current_truth as (
  select distinct on (a.staff_id, a.attendance_date)
    a.staff_id,
    a.attendance_date,
    greatest(
      floor(greatest(coalesce(extract(epoch from (a.last_out-a.scheduled_end_at))/60.0,0),0))::int,
      0
    ) as raw_after_shift_minutes
  from public.attendance_daily_summary a
  where a.status='approved'
    and coalesce(a.resolution_version,0) >= 2
    and a.last_out is not null
    and a.scheduled_end_at is not null
  order by a.staff_id,a.attendance_date,
    coalesce(a.resolution_version,0) desc,
    a.updated_at desc nulls last,
    a.created_at desc
)
update public.staff_overtime_approvals o
set
  overtime_hours=round((case when ct.raw_after_shift_minutes>20 then ct.raw_after_shift_minutes else 0 end)/60.0,2),
  overtime_amount=case when o.hourly_rate is not null and o.hourly_rate>0
    then round(((case when ct.raw_after_shift_minutes>20 then ct.raw_after_shift_minutes else 0 end)/60.0)*o.hourly_rate*1.5,2)
    else null end,
  updated_at=now()
from current_truth ct
where o.status='pending'
  and o.staff_id=ct.staff_id
  and o.attendance_date=ct.attendance_date
  and ct.raw_after_shift_minutes>20;
