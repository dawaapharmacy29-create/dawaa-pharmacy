create table if not exists public.attendance_materialization_dirty_queue_v1 (
  staff_id uuid not null references public.staff(id) on delete cascade,
  attendance_date date not null,
  dirty_reason text not null default 'attendance_input_changed',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  processed_at timestamptz,
  last_action text,
  last_error text,
  primary key (staff_id, attendance_date)
);

create index if not exists attendance_materialization_dirty_queue_pending_v1_idx
  on public.attendance_materialization_dirty_queue_v1 (next_attempt_at, last_seen_at)
  where processed_at is null;

alter table public.attendance_materialization_dirty_queue_v1 enable row level security;
revoke all on table public.attendance_materialization_dirty_queue_v1 from public, anon, authenticated;
grant select, insert, update, delete on table public.attendance_materialization_dirty_queue_v1 to service_role;

create or replace function public.dawaa_attendance_impact_event_type_v1(p_resolution_status text)
returns text
language sql
immutable
set search_path to 'public','pg_catalog'
as $$
  select case p_resolution_status
    when 'on_time' then 'attendance_on_time'
    when 'on_time_with_permission' then 'attendance_on_time_with_permission'
    when 'late' then 'attendance_late'
    when 'very_late' then 'attendance_very_late'
    when 'approved_time_off' then 'attendance_approved_time_off'
    when 'off_day' then 'attendance_off_day'
    when 'absence_review' then 'attendance_absence_confirmed'
    when 'early_leave_review' then 'attendance_early_leave_confirmed'
    when 'worked_on_off' then 'attendance_worked_on_off_confirmed'
    else 'attendance_manual_resolution'
  end
$$;

revoke all on function public.dawaa_attendance_impact_event_type_v1(text) from public, anon, authenticated;
grant execute on function public.dawaa_attendance_impact_event_type_v1(text) to service_role;

create or replace function public.dawaa_enqueue_attendance_materialization_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
begin
  if tg_op in ('INSERT','UPDATE') and new.staff_id is not null and new.shift_date is not null then
    insert into public.attendance_materialization_dirty_queue_v1(
      staff_id,attendance_date,dirty_reason,first_seen_at,last_seen_at,next_attempt_at,processed_at,last_error
    ) values(
      new.staff_id,new.shift_date,'staff_attendance_log_'||lower(tg_op),now(),now(),now(),null,null
    )
    on conflict (staff_id,attendance_date) do update set
      dirty_reason=excluded.dirty_reason,
      last_seen_at=now(),
      next_attempt_at=now(),
      processed_at=null,
      last_error=null;
  end if;

  if tg_op in ('UPDATE','DELETE') and old.staff_id is not null and old.shift_date is not null
     and (tg_op='DELETE' or old.staff_id is distinct from new.staff_id or old.shift_date is distinct from new.shift_date) then
    insert into public.attendance_materialization_dirty_queue_v1(
      staff_id,attendance_date,dirty_reason,first_seen_at,last_seen_at,next_attempt_at,processed_at,last_error
    ) values(
      old.staff_id,old.shift_date,'staff_attendance_log_'||lower(tg_op)||'_old_identity',now(),now(),now(),null,null
    )
    on conflict (staff_id,attendance_date) do update set
      dirty_reason=excluded.dirty_reason,
      last_seen_at=now(),
      next_attempt_at=now(),
      processed_at=null,
      last_error=null;
  end if;

  return null;
end;
$$;

revoke all on function public.dawaa_enqueue_attendance_materialization_v1() from public, anon, authenticated;

drop trigger if exists trg_dawaa_enqueue_attendance_materialization_v1 on public.staff_attendance_logs;
create trigger trg_dawaa_enqueue_attendance_materialization_v1
after insert or update or delete on public.staff_attendance_logs
for each row execute function public.dawaa_enqueue_attendance_materialization_v1();

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

create or replace function public.dawaa_process_attendance_dirty_queue_v1(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
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
    select q.*
    from public.attendance_materialization_dirty_queue_v1 q
    where q.processed_at is null and q.next_attempt_at<=now()
    order by q.last_seen_at, q.attendance_date
    limit greatest(1,least(coalesce(p_limit,50),200))
    for update skip locked
  loop
    begin
      v_result:=public.dawaa_reconcile_attendance_dirty_day_v1(v_q.staff_id,v_q.attendance_date);
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
$$;

revoke all on function public.dawaa_process_attendance_dirty_queue_v1(integer) from public, anon, authenticated;
grant execute on function public.dawaa_process_attendance_dirty_queue_v1(integer) to service_role;

with bounds as (
  select cycle_start,cycle_end from public.dawaa_pay_cycle_bounds_v1(null)
), dirty as (
  select l.staff_id,l.shift_date,
         min(coalesce(l.created_at,l.updated_at,now())) first_seen,
         max(coalesce(l.updated_at,l.created_at)) last_seen
  from public.staff_attendance_logs l
  join public.staff s on s.id=l.staff_id and coalesce(s.active,false)=true
  cross join bounds b
  left join public.attendance_daily_summary a on a.staff_id=l.staff_id and a.attendance_date=l.shift_date
  where l.staff_id is not null
    and l.shift_date between b.cycle_start and b.cycle_end
    and (
      a.id is null
      or a.status is distinct from 'approved'
      or (coalesce(a.resolution_version,0)=2 and a.resolution_origin='system' and a.approved_by='system:auto-attendance-v2')
    )
  group by l.staff_id,l.shift_date,a.id,a.updated_at
  having a.id is null or max(coalesce(l.updated_at,l.created_at))>coalesce(a.updated_at,'epoch'::timestamptz)
)
insert into public.attendance_materialization_dirty_queue_v1(
  staff_id,attendance_date,dirty_reason,first_seen_at,last_seen_at,next_attempt_at,processed_at,last_error
)
select staff_id,shift_date,'seed_current_cycle_dirty',first_seen,last_seen,now(),null,null
from dirty
on conflict (staff_id,attendance_date) do update set
  dirty_reason='seed_current_cycle_dirty',
  last_seen_at=greatest(public.attendance_materialization_dirty_queue_v1.last_seen_at,excluded.last_seen_at),
  next_attempt_at=now(),processed_at=null,last_error=null;