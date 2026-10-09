create or replace function public.dawaa_reconcile_flexible_attendance_dirty_day_v1(p_staff_id uuid,p_attendance_date date)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_saved public.attendance_daily_summary%rowtype;
  v_after public.attendance_daily_summary%rowtype;
  v_preview jsonb;
  v_before jsonb;
  v_cycle record;
  v_locked boolean:=false;
  v_system boolean:=false;
  v_finalizable boolean:=false;
  v_status text;
  v_candidate numeric:=0;
  v_payable numeric:=0;
  v_changed boolean:=false;
  v_old_event text;
  v_new_event text;
  v_policy text;
  v_key text;
begin
  if p_staff_id is null or p_attendance_date is null then
    raise exception 'attendance_flexible_dirty_reconcile_identity_or_date_missing' using errcode='22023';
  end if;

  if not exists(select 1 from public.staff s where s.id=p_staff_id and coalesce(s.active,false)=true and s.branch in ('فرع الشامي','فرع شكري')) then
    return jsonb_build_object('action','out_of_scope','staff_id',p_staff_id,'attendance_date',p_attendance_date);
  end if;

  if not public.dawaa_staff_flexible_attendance_v1(p_staff_id) then
    return jsonb_build_object('action','not_flexible','staff_id',p_staff_id,'attendance_date',p_attendance_date);
  end if;

  select * into v_cycle from public.dawaa_pay_cycle_bounds_v1(p_attendance_date);
  select exists(
    select 1 from public.payroll_finalized_snapshots_v2 f where f.staff_id=p_staff_id and f.month_cycle=v_cycle.month_cycle
  ) or exists(
    select 1 from public.staff_payroll_monthly_v13 p
    where p.staff_id=p_staff_id
      and ((p.cycle_start=v_cycle.cycle_start and p.cycle_end=v_cycle.cycle_end) or p.payroll_month=v_cycle.cycle_end)
      and (coalesce(p.status,'') in ('approved','paid','locked','closed') or p.approved_at is not null or p.paid_at is not null)
  ) into v_locked;
  if v_locked then return jsonb_build_object('action','cycle_locked','staff_id',p_staff_id,'attendance_date',p_attendance_date); end if;

  select * into v_saved from public.attendance_daily_summary a
  where a.staff_id=p_staff_id and a.attendance_date=p_attendance_date
  limit 1 for update;

  if v_saved.id is null then
    v_after:=public.dawaa_materialize_attendance_day_internal_v3(p_staff_id,p_attendance_date);
    if v_after.id is null then
      return jsonb_build_object('action','waiting_not_finalizable','staff_id',p_staff_id,'attendance_date',p_attendance_date);
    end if;
    return jsonb_build_object('action','materialized_missing_summary_v3','staff_id',p_staff_id,'attendance_date',p_attendance_date,'status',v_after.status,'resolution_status',v_after.resolution_status);
  end if;

  v_preview:=public.dawaa_build_attendance_day_resolution_v3(p_staff_id,p_attendance_date);
  v_finalizable:=coalesce((v_preview->>'finalizable')::boolean,false);
  if not v_finalizable then
    return jsonb_build_object('action','waiting_not_finalizable','staff_id',p_staff_id,'attendance_date',p_attendance_date,'reason',v_preview->>'reason');
  end if;

  if v_saved.status='approved' and not (
      v_saved.resolution_origin='system'
      and coalesce(v_saved.approved_by,'') in ('system:auto-attendance-v2','system:auto-attendance-v3')
  ) then
    return jsonb_build_object('action','immutable_approved','staff_id',p_staff_id,'attendance_date',p_attendance_date,'resolution_origin',v_saved.resolution_origin,'resolution_version',v_saved.resolution_version);
  end if;

  v_system:=coalesce((v_preview->>'system_resolvable')::boolean,false);
  v_status:=v_preview->>'resolution_status';
  v_candidate:=coalesce(nullif(v_preview->>'candidate_hours','')::numeric,0);
  v_payable:=case when v_status in ('off_day','approved_time_off','flexible_no_activity') then 0 else v_candidate end;
  v_policy:=coalesce(nullif(v_preview->>'resolved_policy_version',''),nullif(v_preview->>'policy_version',''),'flexible_actual_hours_v1');

  v_changed :=
       coalesce(v_saved.resolution_version,0)<>3
    or v_saved.resolution_status is distinct from v_status
    or v_saved.first_in is distinct from nullif(v_preview->>'first_in','')::timestamptz
    or v_saved.last_out is distinct from nullif(v_preview->>'last_out','')::timestamptz
    or abs(coalesce(v_saved.candidate_hours,0)-v_candidate)>0.01
    or coalesce(v_saved.late_minutes,0) is distinct from coalesce((v_preview->>'late_minutes')::integer,0)
    or coalesce(v_saved.early_leave_minutes,0) is distinct from coalesce((v_preview->>'early_leave_minutes')::integer,0)
    or coalesce(v_saved.policy_version,'') is distinct from coalesce(v_policy,'');

  if not v_changed then
    return jsonb_build_object('action','already_current_v3','staff_id',p_staff_id,'attendance_date',p_attendance_date);
  end if;

  v_before:=to_jsonb(v_saved);
  v_old_event:=case v_saved.resolution_status
    when 'on_time' then 'attendance_on_time'
    when 'on_time_with_permission' then 'attendance_on_time_with_permission'
    when 'late' then 'attendance_late'
    when 'very_late' then 'attendance_very_late'
    when 'off_day' then 'attendance_off_day'
    when 'approved_time_off' then 'attendance_approved_time_off'
    when 'worked_on_off' then 'attendance_worked_on_off_confirmed'
    when 'flexible_present' then 'attendance_flexible_present'
    when 'flexible_no_activity' then 'attendance_flexible_no_activity'
    else 'attendance_manual_resolution' end;
  v_new_event:=case when v_system then case v_status
    when 'flexible_present' then 'attendance_flexible_present'
    when 'flexible_no_activity' then 'attendance_flexible_no_activity'
    when 'approved_time_off' then 'attendance_approved_time_off'
    when 'off_day' then 'attendance_off_day'
    else 'attendance_manual_resolution' end else null end;

  insert into public.attendance_resolution_audit(resolution_id,staff_id,attendance_date,action,actor_id,actor_name,note,snapshot)
  values(v_saved.id,p_staff_id,p_attendance_date,'system_reconciled_flexible_v3','system:attendance-dirty-flexible-v3','النظام الذكي للحضور المرن','إعادة بناء الحضور المرن باستخدام V3',jsonb_build_object('stored',v_before,'rebuilt',v_preview));

  if (not v_system) or v_old_event is distinct from v_new_event then
    update public.attendance_impact_ledger set impact_status='superseded'
    where source_resolution_id=v_saved.id and impact_status='classified';
  end if;

  update public.attendance_daily_summary
  set branch=coalesce(v_preview->>'branch',branch),
      first_in=nullif(v_preview->>'first_in','')::timestamptz,
      last_out=nullif(v_preview->>'last_out','')::timestamptz,
      total_hours=v_candidate,
      late_minutes=coalesce((v_preview->>'late_minutes')::integer,0),
      early_leave_minutes=coalesce((v_preview->>'early_leave_minutes')::integer,0),
      missing_punch=not v_system,
      status=case when v_system then 'approved' else 'pending_review' end,
      source='attendance_resolution_v3_dirty_reconcile',
      schedule_id=nullif(v_preview->>'schedule_id','')::uuid,
      scheduled_start_at=nullif(v_preview->>'scheduled_start_at','')::timestamptz,
      scheduled_end_at=nullif(v_preview->>'scheduled_end_at','')::timestamptz,
      candidate_hours=v_candidate,
      payroll_eligible_hours=case when v_system then v_payable else null end,
      resolution_status=v_status,
      resolution_version=3,
      resolution_snapshot=v_preview||jsonb_build_object('auto_reconciled_flexible_v3',true,'previous_snapshot',v_before,'reconciled_at',now()),
      approved_at=case when v_system then now() else null end,
      approved_by=case when v_system then 'system:auto-attendance-v3' else null end,
      approved_by_name=case when v_system then 'النظام التلقائي للحضور V3' else null end,
      approval_note=null,
      updated_at=now(),
      resolution_origin=case when v_system then 'system' else 'review_queue' end,
      review_required=not v_system,
      resolved_at=case when v_system then now() else null end,
      time_off_request_id=nullif(v_preview->>'time_off_request_id','')::uuid,
      policy_version=v_policy,
      sync_complete_through=nullif(v_preview->>'sync_complete_through','')::timestamptz
  where id=v_saved.id returning * into v_after;

  if v_after.status='approved' then
    v_key:=concat_ws(':','attendance_v3',v_after.staff_id::text,v_after.attendance_date::text,v_new_event,coalesce(v_after.policy_version,'unconfigured'),v_after.id::text);
    insert into public.attendance_impact_ledger(idempotency_key,staff_id,attendance_date,event_type,source_resolution_id,source_time_off_request_id,policy_version,impact_status,evidence_snapshot,created_by)
    values(v_key,v_after.staff_id,v_after.attendance_date,v_new_event,v_after.id,v_after.time_off_request_id,v_after.policy_version,'classified',coalesce(v_after.resolution_snapshot,'{}'::jsonb),'system:auto-attendance-v3')
    on conflict(idempotency_key) do nothing;
  end if;

  return jsonb_build_object('action',case when v_after.status='approved' then 'reconciled_flexible_v3' else 'reopened_flexible_for_review_v3' end,'staff_id',p_staff_id,'attendance_date',p_attendance_date,'old_resolution_status',v_saved.resolution_status,'new_resolution_status',v_after.resolution_status,'old_candidate_hours',v_saved.candidate_hours,'new_candidate_hours',v_after.candidate_hours,'new_status',v_after.status);
end;
$function$;

revoke all on function public.dawaa_reconcile_flexible_attendance_dirty_day_v1(uuid,date) from public,anon,authenticated;
grant execute on function public.dawaa_reconcile_flexible_attendance_dirty_day_v1(uuid,date) to service_role;

create or replace function public.dawaa_process_attendance_dirty_queue_v1(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_q public.attendance_materialization_dirty_queue_v1%rowtype;
  v_result jsonb;
  v_action text;
  v_processed integer:=0;
  v_waiting integer:=0;
  v_errors integer:=0;
  v_immutable integer:=0;
begin
  for v_q in
    select q.* from public.attendance_materialization_dirty_queue_v1 q
    where q.processed_at is null and q.next_attempt_at<=now()
    order by q.last_seen_at,q.attendance_date
    limit greatest(1,least(coalesce(p_limit,50),200))
    for update skip locked
  loop
    begin
      if public.dawaa_staff_flexible_attendance_v1(v_q.staff_id) then
        v_result:=public.dawaa_reconcile_flexible_attendance_dirty_day_v1(v_q.staff_id,v_q.attendance_date);
      else
        v_result:=public.dawaa_reconcile_attendance_dirty_day_v1(v_q.staff_id,v_q.attendance_date);
      end if;
      v_action:=coalesce(v_result->>'action','unknown');
      if v_action='waiting_not_finalizable' then
        update public.attendance_materialization_dirty_queue_v1
        set attempts=attempts+1,next_attempt_at=now()+interval '15 minutes',last_action=v_action,last_error=null
        where staff_id=v_q.staff_id and attendance_date=v_q.attendance_date;
        v_waiting:=v_waiting+1;
      else
        update public.attendance_materialization_dirty_queue_v1
        set attempts=attempts+1,processed_at=now(),next_attempt_at=now(),last_action=v_action,last_error=null
        where staff_id=v_q.staff_id and attendance_date=v_q.attendance_date;
        v_processed:=v_processed+1;
        if v_action in ('immutable_approved','cycle_locked') then v_immutable:=v_immutable+1; end if;
      end if;
    exception when others then
      update public.attendance_materialization_dirty_queue_v1
      set attempts=attempts+1,next_attempt_at=now()+interval '15 minutes',last_action='error',last_error=left(sqlstate||' '||sqlerrm,1000)
      where staff_id=v_q.staff_id and attendance_date=v_q.attendance_date;
      v_errors:=v_errors+1;
    end;
  end loop;
  return jsonb_build_object('processed',v_processed,'waiting',v_waiting,'errors',v_errors,'immutable_or_locked',v_immutable,'limit',p_limit);
end;
$function$;

revoke all on function public.dawaa_process_attendance_dirty_queue_v1(integer) from public,anon,authenticated;
grant execute on function public.dawaa_process_attendance_dirty_queue_v1(integer) to service_role;
