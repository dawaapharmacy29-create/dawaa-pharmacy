-- Attendance Truth V2 hardening
-- Adds provenance to overtime decisions and one cycle-level truth read model.
-- Additive: existing attendance snapshots and old clients remain compatible.

alter table public.staff_overtime_approvals
  add column if not exists source_resolution_id uuid references public.attendance_daily_summary(id) on delete restrict,
  add column if not exists source_resolution_fingerprint text,
  add column if not exists source_resolution_linked_at timestamptz;

create index if not exists staff_overtime_source_resolution_idx
  on public.staff_overtime_approvals(source_resolution_id)
  where source_resolution_id is not null;

create or replace function public.attendance_resolution_fingerprint_v2(p_resolution_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
  select md5(jsonb_build_object(
    'id',a.id,
    'staff_id',a.staff_id,
    'attendance_date',a.attendance_date,
    'status',a.status,
    'resolution_status',a.resolution_status,
    'candidate_hours',a.candidate_hours,
    'payroll_eligible_hours',a.payroll_eligible_hours,
    'schedule_id',a.schedule_id,
    'first_in',a.first_in,
    'last_out',a.last_out,
    'late_minutes',a.late_minutes,
    'early_leave_minutes',a.early_leave_minutes,
    'time_off_request_id',a.time_off_request_id,
    'policy_version',a.policy_version
  )::text)
  from public.attendance_daily_summary a
  where a.id=p_resolution_id
$$;

-- Backfill provenance where there is an approved V2 attendance snapshot for the overtime day.
update public.staff_overtime_approvals o
set source_resolution_id=a.id,
    source_resolution_fingerprint=public.attendance_resolution_fingerprint_v2(a.id),
    source_resolution_linked_at=coalesce(o.updated_at,o.created_at,now())
from public.attendance_daily_summary a
where o.source_resolution_id is null
  and a.staff_id=o.staff_id
  and a.attendance_date=o.attendance_date
  and a.status='approved'
  and coalesce(a.resolution_version,0)>=2;

create or replace function public.decide_overtime_approval_v2(
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
  v_fingerprint text;
  v_decision text:=lower(trim(coalesce(p_decision,'')));
begin
  if v_decision not in ('approved','rejected') then
    raise exception 'invalid_overtime_decision' using errcode='22023';
  end if;

  select * into v_actor
  from public.staff_accounts
  where id=public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false)=true and coalesce(can_login,false)=true;
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

  select * into v_resolution
  from public.attendance_daily_summary a
  where a.staff_id=v_ot.staff_id
    and a.attendance_date=v_ot.attendance_date
  order by (a.status='approved') desc,coalesce(a.resolution_version,0) desc,a.updated_at desc nulls last,a.created_at desc
  limit 1;

  if v_decision='approved' then
    if not found
       or v_resolution.status<>'approved'
       or coalesce(v_resolution.resolution_version,0)<2
       or coalesce(v_resolution.resolution_status,'') not in ('on_time','late','very_late','on_time_with_permission','worked_on_off') then
      raise exception 'overtime_requires_approved_attendance_truth' using errcode='55000';
    end if;

    v_fingerprint:=public.attendance_resolution_fingerprint_v2(v_resolution.id);

    if v_ot.source_resolution_id is not null and v_ot.source_resolution_id<>v_resolution.id then
      raise exception 'overtime_source_resolution_changed' using errcode='55000';
    end if;
    if v_ot.source_resolution_fingerprint is not null
       and v_ot.source_resolution_fingerprint<>v_fingerprint then
      raise exception 'overtime_source_resolution_drifted' using errcode='55000';
    end if;

    update public.staff_overtime_approvals
    set source_resolution_id=v_resolution.id,
        source_resolution_fingerprint=v_fingerprint,
        source_resolution_linked_at=coalesce(source_resolution_linked_at,now()),
        status='approved',
        decided_at=now(),
        decided_by=v_actor.id::text,
        decided_by_name=coalesce(v_actor.name,v_actor.username),
        decision_note=nullif(trim(coalesce(p_note,'')),''),
        updated_at=now()
    where id=p_id;
  else
    update public.staff_overtime_approvals
    set status='rejected',
        decided_at=now(),
        decided_by=v_actor.id::text,
        decided_by_name=coalesce(v_actor.name,v_actor.username),
        decision_note=nullif(trim(coalesce(p_note,'')),''),
        updated_at=now()
    where id=p_id;
  end if;

  return jsonb_build_object(
    'success',true,
    'id',p_id,
    'status',v_decision,
    'attendance_resolution_id',case when v_decision='approved' then v_resolution.id else v_ot.source_resolution_id end,
    'truth_validated',v_decision='approved'
  );
end;
$$;

create or replace function public.attendance_truth_cycle_v2(
  p_start date,
  p_end date,
  p_branch text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_result jsonb;
begin
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>62 then
    raise exception 'invalid_attendance_truth_range' using errcode='22023';
  end if;
  if not public.dawaa_current_actor_can(array['view_attendance_leaves','view_schedule','manage_payroll']) then
    raise exception 'not_authorized_for_attendance_truth' using errcode='42501';
  end if;

  with eligible as (
    select s.id,s.name,s.role,s.branch
    from public.staff s
    where coalesce(s.active,s.is_active,true)
      and coalesce(s.visible_in_schedule,true)
      and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or trim(s.branch)=trim(p_branch))
      and public.dawaa_can_read_staff_attendance_log(s.id,s.branch)
  ),
  attendance as (
    select a.staff_id,
      count(*) filter(where a.status='approved')::int approved_days,
      count(*) filter(where a.status='pending_review')::int pending_days,
      count(*) filter(where a.status='approved' and coalesce(a.candidate_hours,0)>0
        and coalesce(a.resolution_status,'') not in ('off_day','approved_time_off','absence_review'))::int worked_days,
      round(coalesce(sum(a.candidate_hours) filter(where a.status='approved'
        and coalesce(a.candidate_hours,0)>0
        and coalesce(a.resolution_status,'') not in ('off_day','approved_time_off','absence_review')),0),2) worked_hours,
      count(*) filter(where a.status='approved' and a.resolution_status='off_day')::int off_days,
      count(*) filter(where a.status='approved' and a.resolution_status='approved_time_off')::int leave_days,
      count(*) filter(where a.status='approved' and a.resolution_status='absence_review')::int absence_days,
      count(*) filter(where a.status='approved' and a.resolution_status='worked_on_off')::int worked_on_off_days
    from public.attendance_daily_summary a
    where a.attendance_date between p_start and p_end
    group by a.staff_id
  ),
  overtime as (
    select o.staff_id,
      round(coalesce(sum(o.overtime_hours) filter(where o.status='approved'),0),2) approved_ot_hours,
      round(coalesce(sum(o.overtime_hours) filter(where o.status='pending'),0),2) pending_ot_hours,
      count(*) filter(where o.status='pending')::int pending_ot_count,
      count(*) filter(
        where o.status='approved' and (
          o.source_resolution_id is null
          or not exists(
            select 1 from public.attendance_daily_summary a
            where a.id=o.source_resolution_id and a.status='approved'
              and public.attendance_resolution_fingerprint_v2(a.id)=o.source_resolution_fingerprint
          )
        )
      )::int stale_approved_ot
    from public.staff_overtime_approvals o
    where o.attendance_date between p_start and p_end
    group by o.staff_id
  ),
  corrections as (
    select r.staff_id,count(*) filter(where r.status='pending')::int pending_corrections
    from public.attendance_manual_requests r
    where coalesce(r.attendance_date,(r.requested_time at time zone 'Africa/Cairo')::date) between p_start and p_end
    group by r.staff_id
  ),
  timeoff as (
    select r.staff_id,count(*) filter(where r.status='pending')::int pending_timeoff
    from public.staff_time_off_requests r
    where r.start_date<=p_end and r.end_date>=p_start
    group by r.staff_id
  ),
  rows as (
    select e.*,
      coalesce(a.approved_days,0) approved_days,
      coalesce(a.pending_days,0) pending_days,
      coalesce(a.worked_days,0) worked_days,
      coalesce(a.worked_hours,0) worked_hours,
      coalesce(a.off_days,0) off_days,
      coalesce(a.leave_days,0) leave_days,
      coalesce(a.absence_days,0) absence_days,
      coalesce(a.worked_on_off_days,0) worked_on_off_days,
      coalesce(o.approved_ot_hours,0) approved_ot_hours,
      coalesce(o.pending_ot_hours,0) pending_ot_hours,
      coalesce(o.pending_ot_count,0) pending_ot_count,
      coalesce(o.stale_approved_ot,0) stale_approved_ot,
      coalesce(c.pending_corrections,0) pending_corrections,
      coalesce(t.pending_timeoff,0) pending_timeoff
    from eligible e
    left join attendance a on a.staff_id=e.id
    left join overtime o on o.staff_id=e.id
    left join corrections c on c.staff_id=e.id
    left join timeoff t on t.staff_id=e.id
  )
  select jsonb_build_object(
    'range_start',p_start,
    'range_end',p_end,
    'branch',p_branch,
    'summary',jsonb_build_object(
      'staff_count',(select count(*) from rows),
      'approved_days',(select coalesce(sum(approved_days),0) from rows),
      'pending_attendance_days',(select coalesce(sum(pending_days),0) from rows),
      'worked_days',(select coalesce(sum(worked_days),0) from rows),
      'worked_hours',(select coalesce(sum(worked_hours),0) from rows),
      'approved_overtime_hours',(select coalesce(sum(approved_ot_hours),0) from rows),
      'pending_overtime_hours',(select coalesce(sum(pending_ot_hours),0) from rows),
      'pending_corrections',(select coalesce(sum(pending_corrections),0) from rows),
      'pending_timeoff',(select coalesce(sum(pending_timeoff),0) from rows),
      'stale_approved_overtime',(select coalesce(sum(stale_approved_ot),0) from rows),
      'ready_for_payroll_truth',(
        select coalesce(sum(pending_days),0)=0
          and coalesce(sum(pending_ot_count),0)=0
          and coalesce(sum(stale_approved_ot),0)=0
        from rows
      )
    ),
    'rows',coalesce((
      select jsonb_agg(jsonb_build_object(
        'staff_id',id,'staff_name',name,'role',role,'branch',branch,
        'approved_days',approved_days,'pending_attendance_days',pending_days,
        'worked_days',worked_days,'worked_hours',worked_hours,
        'off_days',off_days,'approved_leave_days',leave_days,'absence_days',absence_days,
        'worked_on_off_days',worked_on_off_days,
        'approved_overtime_hours',approved_ot_hours,'pending_overtime_hours',pending_ot_hours,
        'pending_overtime_count',pending_ot_count,'stale_approved_overtime',stale_approved_ot,
        'pending_corrections',pending_corrections,'pending_timeoff',pending_timeoff,
        'truth_ready',(pending_days=0 and pending_ot_count=0 and stale_approved_ot=0)
      ) order by branch,name)
      from rows
    ),'[]'::jsonb),
    'generated_at',now()
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.attendance_resolution_fingerprint_v2(uuid) from public;
revoke execute on function public.decide_overtime_approval_v2(uuid,text,text) from public;
revoke execute on function public.attendance_truth_cycle_v2(date,date,text) from public;
grant execute on function public.attendance_resolution_fingerprint_v2(uuid) to anon,authenticated,service_role;
grant execute on function public.decide_overtime_approval_v2(uuid,text,text) to anon,authenticated,service_role;
grant execute on function public.attendance_truth_cycle_v2(date,date,text) to anon,authenticated,service_role;
