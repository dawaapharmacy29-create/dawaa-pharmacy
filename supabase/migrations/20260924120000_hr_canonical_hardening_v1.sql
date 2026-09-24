-- HR canonical hardening v1
-- Purpose:
-- 1) Make overtime V1 a compatibility wrapper over the branch-scoped V3 decision path.
-- 2) Recalculate overtime from the latest approved Attendance Truth at decision time.
-- 3) Invalidate approved overtime + financial reward immediately when Attendance Truth is reopened/changed.
-- 4) Cut pg_cron from V1 detector/sync to V2 detector/sync without deleting compatibility functions.

create or replace function public.decide_overtime_approval_v3(
  p_id uuid,
  p_decision text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
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

    v_extra_minutes:=round(
      greatest(coalesce(v_resolution.candidate_hours,0)-v_sched_hours,0)*60
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
$$;

-- Compatibility-only legacy entrypoint. All decisions now flow through V3 guards.
create or replace function public.decide_overtime_approval_v1(
  p_id uuid,
  p_decision text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
begin
  return public.decide_overtime_approval_v3(p_id,p_decision,p_note);
end;
$$;

revoke execute on function public.decide_overtime_approval_v1(uuid,text,text) from public,anon;
grant execute on function public.decide_overtime_approval_v1(uuid,text,text) to authenticated,service_role;

-- If approved Attendance Truth changes or is reopened, any approved overtime tied to it
-- must return to human review and any previously synced financial reward must be removed.
create or replace function public.hr_invalidate_overtime_on_attendance_change_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_invalidated integer:=0;
  v_cycle record;
begin
  if old.status='approved'
     and (
       new.status is distinct from 'approved'
       or row(
         old.schedule_id,
         old.scheduled_start_at,
         old.scheduled_end_at,
         old.first_in,
         old.last_out,
         old.candidate_hours,
         old.payroll_eligible_hours,
         old.late_minutes,
         old.early_leave_minutes,
         old.resolution_status,
         old.time_off_request_id
       ) is distinct from row(
         new.schedule_id,
         new.scheduled_start_at,
         new.scheduled_end_at,
         new.first_in,
         new.last_out,
         new.candidate_hours,
         new.payroll_eligible_hours,
         new.late_minutes,
         new.early_leave_minutes,
         new.resolution_status,
         new.time_off_request_id
       )
     ) then

    update public.staff_overtime_approvals o
    set
      status='pending',
      decided_at=null,
      decided_by=null,
      decided_by_name=null,
      decision_note=concat_ws(
        ' | ',
        nullif(trim(coalesce(o.decision_note,'')),''),
        'أعيدت للمراجعة تلقائيًا بسبب تغيير Attendance Truth'
      ),
      source_resolution_fingerprint=null,
      source_resolution_linked_at=null,
      decision_evidence_snapshot=jsonb_build_object(
        'evidence_available',false,
        'reason','attendance_truth_changed_after_overtime_decision',
        'previous_evidence',coalesce(o.decision_evidence_snapshot,'{}'::jsonb),
        'invalidated_at',now()
      ),
      decision_evidence_version='attendance_truth_invalidated_v1',
      updated_at=now()
    where o.source_resolution_id=new.id
      and o.status='approved';

    get diagnostics v_invalidated = row_count;

    if v_invalidated>0 then
      select * into v_cycle
      from public.dawaa_pay_cycle_bounds_v1(new.attendance_date);

      delete from public.employee_transactions et
      where et.staff_id=new.staff_id
        and et.month_cycle=v_cycle.month_cycle
        and et.source in ('attendance_overtime_v1','attendance_overtime_v2');
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_hr_invalidate_overtime_on_attendance_change_v1
  on public.attendance_daily_summary;

create trigger trg_hr_invalidate_overtime_on_attendance_change_v1
after update of
  status,
  schedule_id,
  scheduled_start_at,
  scheduled_end_at,
  first_in,
  last_out,
  candidate_hours,
  payroll_eligible_hours,
  late_minutes,
  early_leave_minutes,
  resolution_status,
  time_off_request_id
on public.attendance_daily_summary
for each row
execute function public.hr_invalidate_overtime_on_attendance_change_v1();

revoke execute on function public.hr_invalidate_overtime_on_attendance_change_v1() from public,anon,authenticated;

-- Explicit cron cutover. Compatibility V1 functions remain defined, but scheduled writes
-- now use Attendance Truth V2 only.
do $$
declare
  v_job record;
begin
  if to_regclass('cron.job') is not null then
    for v_job in
      select jobid
      from cron.job
      where command in (
        'select public.dawaa_detect_pending_overtime_v1();',
        'select public.dawaa_sync_attendance_overtime_reward_v1();'
      )
    loop
      perform cron.unschedule(v_job.jobid);
    end loop;

    perform cron.schedule(
      'dawaa-detect-pending-overtime-v2',
      '30 * * * *',
      'select public.dawaa_detect_pending_overtime_v2();'
    );

    perform cron.schedule(
      'dawaa-sync-attendance-overtime-reward-v2',
      '15 * * * *',
      'select public.dawaa_sync_attendance_overtime_reward_v2();'
    );
  end if;
end;
$$;
