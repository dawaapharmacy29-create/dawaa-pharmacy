create or replace function public.dawaa_enqueue_attendance_materialization_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_staff_id uuid;
  v_date date;
begin
  if tg_op='INSERT' then
    v_staff_id:=new.staff_id;
    v_date:=new.shift_date;
    if v_staff_id is not null and v_date is not null and exists(
      select 1 from public.staff s
      where s.id=v_staff_id and coalesce(s.active,false)=true and s.branch in ('فرع الشامي','فرع شكري')
    ) then
      insert into public.attendance_materialization_dirty_queue_v1(
        staff_id,attendance_date,dirty_reason,first_seen_at,last_seen_at,next_attempt_at,processed_at,last_error
      ) values(v_staff_id,v_date,'staff_attendance_log_insert',now(),now(),now(),null,null)
      on conflict (staff_id,attendance_date) do update set
        dirty_reason=excluded.dirty_reason,last_seen_at=now(),next_attempt_at=now(),processed_at=null,last_error=null;
    end if;
    return null;
  end if;

  if tg_op='UPDATE' then
    if new.staff_id is not null and new.shift_date is not null and exists(
      select 1 from public.staff s
      where s.id=new.staff_id and coalesce(s.active,false)=true and s.branch in ('فرع الشامي','فرع شكري')
    ) then
      insert into public.attendance_materialization_dirty_queue_v1(
        staff_id,attendance_date,dirty_reason,first_seen_at,last_seen_at,next_attempt_at,processed_at,last_error
      ) values(new.staff_id,new.shift_date,'staff_attendance_log_update',now(),now(),now(),null,null)
      on conflict (staff_id,attendance_date) do update set
        dirty_reason=excluded.dirty_reason,last_seen_at=now(),next_attempt_at=now(),processed_at=null,last_error=null;
    end if;

    if old.staff_id is not null and old.shift_date is not null
       and (old.staff_id is distinct from new.staff_id or old.shift_date is distinct from new.shift_date)
       and exists(
         select 1 from public.staff s
         where s.id=old.staff_id and coalesce(s.active,false)=true and s.branch in ('فرع الشامي','فرع شكري')
       ) then
      insert into public.attendance_materialization_dirty_queue_v1(
        staff_id,attendance_date,dirty_reason,first_seen_at,last_seen_at,next_attempt_at,processed_at,last_error
      ) values(old.staff_id,old.shift_date,'staff_attendance_log_update_old_identity',now(),now(),now(),null,null)
      on conflict (staff_id,attendance_date) do update set
        dirty_reason=excluded.dirty_reason,last_seen_at=now(),next_attempt_at=now(),processed_at=null,last_error=null;
    end if;
    return null;
  end if;

  if tg_op='DELETE' then
    v_staff_id:=old.staff_id;
    v_date:=old.shift_date;
    if v_staff_id is not null and v_date is not null and exists(
      select 1 from public.staff s
      where s.id=v_staff_id and coalesce(s.active,false)=true and s.branch in ('فرع الشامي','فرع شكري')
    ) then
      insert into public.attendance_materialization_dirty_queue_v1(
        staff_id,attendance_date,dirty_reason,first_seen_at,last_seen_at,next_attempt_at,processed_at,last_error
      ) values(v_staff_id,v_date,'staff_attendance_log_delete',now(),now(),now(),null,null)
      on conflict (staff_id,attendance_date) do update set
        dirty_reason=excluded.dirty_reason,last_seen_at=now(),next_attempt_at=now(),processed_at=null,last_error=null;
    end if;
    return null;
  end if;

  return null;
end;
$$;

create or replace function public.dawaa_reconcile_attendance_dirty_day_v1(
  p_staff_id uuid,
  p_attendance_date date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_saved public.attendance_daily_summary%rowtype;
  v_before jsonb;
  v_preview jsonb;
  v_after public.attendance_daily_summary%rowtype;
  v_cycle record;
  v_locked boolean:=false;
  v_system boolean:=false;
  v_finalizable boolean:=false;
  v_resolution_status text;
  v_candidate numeric:=0;
  v_payable numeric:=0;
  v_old_event text;
  v_new_event text;
  v_changed boolean:=false;
  v_financial_drift boolean:=false;
begin
  if p_staff_id is null or p_attendance_date is null then
    raise exception 'attendance_dirty_reconcile_identity_or_date_missing' using errcode='22023';
  end if;

  if not exists(
    select 1 from public.staff s
    where s.id=p_staff_id and coalesce(s.active,false)=true and s.branch in ('فرع الشامي','فرع شكري')
  ) then
    return jsonb_build_object('action','out_of_scope','staff_id',p_staff_id,'attendance_date',p_attendance_date);
  end if;

  select * into v_cycle from public.dawaa_pay_cycle_bounds_v1(p_attendance_date);

  select exists(
    select 1 from public.payroll_finalized_snapshots_v2 f
    where f.staff_id=p_staff_id and f.month_cycle=v_cycle.month_cycle
  ) or exists(
    select 1 from public.staff_payroll_monthly_v13 p
    where p.staff_id=p_staff_id
      and ((p.cycle_start=v_cycle.cycle_start and p.cycle_end=v_cycle.cycle_end) or p.payroll_month=v_cycle.cycle_end)
      and (coalesce(p.status,'') in ('approved','paid','locked','closed') or p.approved_at is not null or p.paid_at is not null)
  ) into v_locked;

  if v_locked then
    return jsonb_build_object('action','cycle_locked','staff_id',p_staff_id,'attendance_date',p_attendance_date);
  end if;

  select * into v_saved
  from public.attendance_daily_summary a
  where a.staff_id=p_staff_id and a.attendance_date=p_attendance_date
  limit 1
  for update;

  if v_saved.id is null then
    v_after:=public.dawaa_materialize_attendance_day_internal_v2(p_staff_id,p_attendance_date);
    if v_after.id is null then
      return jsonb_build_object('action','waiting_not_finalizable','staff_id',p_staff_id,'attendance_date',p_attendance_date);
    end if;
    return jsonb_build_object('action','materialized_missing_summary','staff_id',p_staff_id,'attendance_date',p_attendance_date,'status',v_after.status,'resolution_status',v_after.resolution_status);
  end if;

  if v_saved.status is distinct from 'approved' then
    v_before:=to_jsonb(v_saved);
    v_after:=public.dawaa_materialize_attendance_day_internal_v2(p_staff_id,p_attendance_date);
    return jsonb_build_object(
      'action','refreshed_unapproved','staff_id',p_staff_id,'attendance_date',p_attendance_date,
      'before_status',v_before->>'status','status',v_after.status,'resolution_status',v_after.resolution_status
    );
  end if;

  if not (
    coalesce(v_saved.resolution_version,0)=2
    and v_saved.resolution_origin='system'
    and v_saved.approved_by='system:auto-attendance-v2'
  ) then
    return jsonb_build_object('action','immutable_approved','staff_id',p_staff_id,'attendance_date',p_attendance_date,'resolution_origin',v_saved.resolution_origin,'resolution_version',v_saved.resolution_version);
  end if;

  v_preview:=public.dawaa_build_attendance_day_resolution_v2(p_staff_id,p_attendance_date);
  v_finalizable:=coalesce((v_preview->>'finalizable')::boolean,false);
  if not v_finalizable then
    return jsonb_build_object('action','waiting_not_finalizable','staff_id',p_staff_id,'attendance_date',p_attendance_date,'reason',v_preview->>'reason');
  end if;

  v_system:=coalesce((v_preview->>'system_resolvable')::boolean,false);
  v_resolution_status:=v_preview->>'resolution_status';
  v_candidate:=coalesce(nullif(v_preview->>'candidate_hours','')::numeric,0);
  v_payable:=case when v_resolution_status in ('off_day','approved_time_off') then 0 else v_candidate end;

  v_changed :=
       v_saved.resolution_status is distinct from v_resolution_status
    or v_saved.first_in is distinct from nullif(v_preview->>'first_in','')::timestamptz
    or v_saved.last_out is distinct from nullif(v_preview->>'last_out','')::timestamptz
    or abs(coalesce(v_saved.candidate_hours,0)-v_candidate)>0.01
    or coalesce(v_saved.late_minutes,0) is distinct from coalesce((v_preview->>'late_minutes')::integer,0)
    or coalesce(v_saved.early_leave_minutes,0) is distinct from coalesce((v_preview->>'early_leave_minutes')::integer,0)
    or v_saved.schedule_id is distinct from nullif(v_preview->>'schedule_id','')::uuid
    or v_saved.time_off_request_id is distinct from nullif(v_preview->>'time_off_request_id','')::uuid
    or coalesce(v_saved.policy_version,'') is distinct from coalesce(v_preview->>'policy_version','');

  if not v_changed then
    return jsonb_build_object('action','already_current','staff_id',p_staff_id,'attendance_date',p_attendance_date);
  end if;

  v_before:=to_jsonb(v_saved);
  v_financial_drift:=abs(coalesce(v_saved.candidate_hours,0)-v_candidate)>0.10;
  v_old_event:=public.dawaa_attendance_impact_event_type_v1(v_saved.resolution_status);
  v_new_event:=case when v_system then public.dawaa_attendance_impact_event_type_v1(v_resolution_status) else null end;

  insert into public.attendance_resolution_audit(
    resolution_id,staff_id,attendance_date,action,actor_id,actor_name,note,snapshot
  ) values(
    v_saved.id,p_staff_id,p_attendance_date,'system_reconciled_stale_auto_v2',
    'system:attendance-dirty-reconcile-v1','النظام الذكي لمزامنة الحضور',
    'Evidence أحدث وصل بعد اعتماد V2 التلقائي',
    jsonb_build_object('stored',v_before,'rebuilt',v_preview,'financial_drift',v_financial_drift)
  );

  if (not v_system) or v_old_event is distinct from v_new_event then
    update public.attendance_impact_ledger
    set impact_status='superseded'
    where source_resolution_id=v_saved.id and impact_status='classified';
  end if;

  update public.attendance_daily_summary
  set
    branch=coalesce(v_preview->>'branch',branch),
    first_in=nullif(v_preview->>'first_in','')::timestamptz,
    last_out=nullif(v_preview->>'last_out','')::timestamptz,
    total_hours=v_candidate,
    late_minutes=coalesce((v_preview->>'late_minutes')::integer,0),
    early_leave_minutes=coalesce((v_preview->>'early_leave_minutes')::integer,0),
    missing_punch=not v_system,
    status=case when v_system then 'approved' else 'pending_review' end,
    source='attendance_resolution_v2_dirty_reconcile',
    schedule_id=nullif(v_preview->>'schedule_id','')::uuid,
    scheduled_start_at=nullif(v_preview->>'scheduled_start_at','')::timestamptz,
    scheduled_end_at=nullif(v_preview->>'scheduled_end_at','')::timestamptz,
    candidate_hours=v_candidate,
    payroll_eligible_hours=case when v_system then v_payable else null end,
    resolution_status=v_resolution_status,
    resolution_version=2,
    resolution_snapshot=v_preview||jsonb_build_object(
      'auto_reconciled_from_stale_approved',true,
      'previous_approved_snapshot',v_before,
      'reconciled_at',now(),
      'reconciliation_reason','new_attendance_evidence_after_system_approval'
    ),
    approved_at=case when v_system then now() else null end,
    approved_by=case when v_system then 'system:auto-attendance-v2' else null end,
    approved_by_name=case when v_system then 'النظام التلقائي للحضور' else null end,
    approval_note=null,
    updated_at=now(),
    resolution_origin=case when v_system then 'system' else 'review_queue' end,
    review_required=not v_system,
    resolved_at=case when v_system then now() else null end,
    time_off_request_id=nullif(v_preview->>'time_off_request_id','')::uuid,
    policy_version=v_preview->>'policy_version',
    sync_complete_through=nullif(v_preview->>'sync_complete_through','')::timestamptz
  where id=v_saved.id
  returning * into v_after;

  if v_after.status='approved' and (
       v_old_event is distinct from v_new_event
       or not exists(select 1 from public.attendance_impact_ledger l where l.source_resolution_id=v_after.id and l.impact_status='classified')
     ) then
    perform public.dawaa_sync_attendance_impact_for_resolution_v2(v_after.id);
  end if;

  return jsonb_build_object(
    'action',case when v_after.status='approved' then 'reconciled_auto_approved' else 'reopened_for_review' end,
    'staff_id',p_staff_id,'attendance_date',p_attendance_date,
    'old_resolution_status',v_saved.resolution_status,'new_resolution_status',v_after.resolution_status,
    'old_candidate_hours',v_saved.candidate_hours,'new_candidate_hours',v_after.candidate_hours,
    'financial_drift',v_financial_drift,'new_status',v_after.status
  );
end;
$$;

revoke all on function public.dawaa_reconcile_attendance_dirty_day_v1(uuid,date) from public, anon, authenticated;
grant execute on function public.dawaa_reconcile_attendance_dirty_day_v1(uuid,date) to service_role;

delete from public.attendance_materialization_dirty_queue_v1 q
where not exists(
  select 1 from public.staff s
  where s.id=q.staff_id and coalesce(s.active,false)=true and s.branch in ('فرع الشامي','فرع شكري')
);