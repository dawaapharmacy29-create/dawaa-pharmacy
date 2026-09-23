-- Attendance Truth V2 follow-up
-- Safe overtime detection from approved daily truth only + payroll finalization blocker.
-- Cron cutover is intentionally not changed here; V2 can be validated before replacing V1 jobs.

create or replace function public.dawaa_detect_pending_overtime_v2(p_lookback_days integer default 3)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_day record;
  v_comp public.employee_compensation_profiles%rowtype;
  v_sched_hours numeric;
  v_extra_minutes integer;
  v_deviation jsonb;
  v_overtime_minutes integer;
  v_true_hourly_rate numeric;
  v_fingerprint text;
  v_inserted integer:=0;
  v_skipped_unapproved integer:=0;
  v_today date:=(now() at time zone 'Africa/Cairo')::date;
begin
  if p_lookback_days is null or p_lookback_days<1 or p_lookback_days>31 then
    raise exception 'invalid_overtime_lookback' using errcode='22023';
  end if;

  for v_day in
    select a.*,s.name staff_name,s.branch staff_branch,s.role staff_role
    from public.attendance_daily_summary a
    join public.staff s on s.id=a.staff_id
    where a.attendance_date between v_today-p_lookback_days and v_today-1
      and a.status='approved'
      and coalesce(a.resolution_version,0)>=2
      and coalesce(a.resolution_status,'') in ('on_time','late','very_late','on_time_with_permission','worked_on_off')
      and coalesce(a.candidate_hours,0)>0
      and not exists(
        select 1 from public.staff_overtime_approvals o
        where o.staff_id=a.staff_id and o.attendance_date=a.attendance_date
      )
  loop
    select * into v_comp
    from public.employee_compensation_profiles p
    where p.staff_id=v_day.staff_id::text
      and coalesce(p.active,true)
      and (p.effective_from is null or p.effective_from<=v_day.attendance_date)
    order by p.effective_from desc nulls last,p.updated_at desc nulls last,p.created_at desc nulls last
    limit 1;

    if coalesce(v_comp.exempt_from_lateness_deduction,false) then
      continue;
    end if;

    v_sched_hours:=case
      when v_day.scheduled_start_at is not null and v_day.scheduled_end_at is not null
      then greatest(extract(epoch from(v_day.scheduled_end_at-v_day.scheduled_start_at))/3600.0,0)
      else null
    end;
    if v_sched_hours is null or v_sched_hours<=0 then
      v_skipped_unapproved:=v_skipped_unapproved+1;
      continue;
    end if;

    v_extra_minutes:=round(greatest(coalesce(v_day.candidate_hours,0)-v_sched_hours,0)*60)::int;
    v_deviation:=public.dawaa_net_attendance_deviation_v1(
      coalesce(v_day.late_minutes,0),
      v_extra_minutes,
      v_day.staff_role,
      false
    );
    v_overtime_minutes:=coalesce((v_deviation->>'overtime_minutes')::int,0);
    if v_overtime_minutes<10 then continue; end if;

    v_true_hourly_rate:=case
      when coalesce(v_comp.hourly_rate,0)>0 then round(v_comp.hourly_rate/26.0,4)
      else null
    end;
    v_fingerprint:=public.attendance_resolution_fingerprint_v2(v_day.id);

    insert into public.staff_overtime_approvals(
      staff_id,staff_name,branch,attendance_date,overtime_hours,hourly_rate,overtime_amount,status,
      decision_note,source_resolution_id,source_resolution_fingerprint,source_resolution_linked_at
    )
    values(
      v_day.staff_id,v_day.staff_name,v_day.staff_branch,v_day.attendance_date,
      round(v_overtime_minutes/60.0,2),
      v_true_hourly_rate,
      case when v_true_hourly_rate is not null then round((v_overtime_minutes/60.0)*v_true_hourly_rate*1.5,2) else null end,
      'pending',
      case when v_overtime_minutes>360 then 'تنبيه: ساعات إضافية كبيرة — راجع اليوم قبل الاعتماد.' else null end,
      v_day.id,v_fingerprint,now()
    )
    on conflict(staff_id,attendance_date) do nothing;

    if found then v_inserted:=v_inserted+1; end if;
  end loop;

  return jsonb_build_object(
    'queued',v_inserted,
    'skipped_without_valid_schedule_hours',v_skipped_unapproved,
    'source','approved_attendance_truth_v2',
    'lookback_days',p_lookback_days
  );
end;
$$;

create or replace function public.overtime_truth_status_v2(
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
declare v_result jsonb;
begin
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>62 then
    raise exception 'invalid_overtime_truth_range' using errcode='22023';
  end if;
  if not public.dawaa_current_actor_can(array['view_attendance_leaves','manage_payroll']) then
    raise exception 'not_authorized_for_overtime_truth' using errcode='42501';
  end if;

  with rows as (
    select o.*,
      a.status attendance_status,
      a.resolution_status attendance_resolution_status,
      case
        when o.source_resolution_id is null then 'unlinked'
        when a.id is null then 'source_missing'
        when a.status<>'approved' then 'attendance_reopened'
        when public.attendance_resolution_fingerprint_v2(a.id) is distinct from o.source_resolution_fingerprint then 'attendance_changed'
        else 'valid'
      end truth_state
    from public.staff_overtime_approvals o
    left join public.attendance_daily_summary a on a.id=o.source_resolution_id
    where o.attendance_date between p_start and p_end
      and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or trim(o.branch)=trim(p_branch))
      and public.dawaa_can_read_staff_attendance_log(o.staff_id,o.branch)
  )
  select jsonb_build_object(
    'range_start',p_start,'range_end',p_end,'branch',p_branch,
    'pending',(select count(*) from rows where status='pending'),
    'approved',(select count(*) from rows where status='approved'),
    'rejected',(select count(*) from rows where status='rejected'),
    'approved_stale',(select count(*) from rows where status='approved' and truth_state<>'valid'),
    'pending_unlinked',(select count(*) from rows where status='pending' and truth_state='unlinked'),
    'rows',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',id,'staff_id',staff_id,'staff_name',staff_name,'branch',branch,
        'attendance_date',attendance_date,'overtime_hours',overtime_hours,'status',status,
        'source_resolution_id',source_resolution_id,'truth_state',truth_state,
        'attendance_status',attendance_status,'attendance_resolution_status',attendance_resolution_status,
        'decided_by_name',decided_by_name,'decided_at',decided_at
      ) order by attendance_date desc,staff_name)
      from rows where truth_state<>'valid'
    ),'[]'::jsonb),
    'generated_at',now()
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.finalize_payroll_snapshot_v2(p_snapshot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_actor public.staff_accounts%rowtype;
  v_snapshot public.payroll_final_snapshot_staging%rowtype;
  v_compare jsonb;
  v_review public.payroll_snapshot_reviews%rowtype;
  v_existing public.payroll_finalized_snapshots_v2%rowtype;
  v_final public.payroll_finalized_snapshots_v2%rowtype;
  v_stale_overtime integer:=0;
begin
  if p_snapshot_id is null then raise exception 'snapshot_id_required' using errcode='22023'; end if;

  select * into v_actor from public.staff_accounts
  where id=public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false)=true and coalesce(can_login,false)=true;

  if not found
     or coalesce(v_actor.role,'') not in ('general_manager','executive_manager')
     or not public.dawaa_current_actor_can(array['manage_payroll']) then
    raise exception 'not_authorized_for_payroll_finalization' using errcode='42501';
  end if;

  select * into v_snapshot
  from public.payroll_final_snapshot_staging
  where id=p_snapshot_id;
  if not found then raise exception 'snapshot_not_found' using errcode='22023'; end if;

  if not public.dawaa_can_manage_payroll_staff_v1(v_snapshot.staff_username) then
    raise exception 'not_authorized_for_payroll_staff' using errcode='42501';
  end if;

  select count(*)::int into v_stale_overtime
  from public.staff_overtime_approvals o
  left join public.attendance_daily_summary a on a.id=o.source_resolution_id
  where o.staff_id=v_snapshot.staff_id
    and o.attendance_date between v_snapshot.cycle_start and v_snapshot.cycle_end
    and o.status='approved'
    and (
      o.source_resolution_id is null
      or a.id is null
      or a.status<>'approved'
      or public.attendance_resolution_fingerprint_v2(a.id) is distinct from o.source_resolution_fingerprint
    );

  if v_stale_overtime>0 then
    raise exception 'stale_approved_overtime_blocks_payroll_finalization: %',v_stale_overtime using errcode='55000';
  end if;

  select * into v_existing
  from public.payroll_finalized_snapshots_v2
  where staff_id=v_snapshot.staff_id and month_cycle=v_snapshot.month_cycle;

  if found then
    if v_existing.snapshot_fingerprint=v_snapshot.snapshot_fingerprint then
      return jsonb_build_object('success',true,'existing',true,'finalized',to_jsonb(v_existing),'paid',false,'financial_effect','none');
    end if;
    raise exception 'payroll_cycle_already_finalized_with_different_snapshot' using errcode='55000';
  end if;

  select * into v_review
  from public.payroll_snapshot_reviews
  where snapshot_id=p_snapshot_id
  order by created_at desc,id desc
  limit 1;

  if not found or v_review.decision<>'approved' then
    raise exception 'latest_snapshot_review_must_be_approved' using errcode='22023';
  end if;

  v_compare:=public.compare_payroll_final_snapshot_v1(p_snapshot_id);

  if coalesce(v_snapshot.finalization_ready,false) is not true
     or coalesce((v_compare->>'unchanged')::boolean,false) is not true
     or coalesce((v_compare->>'current_ready')::boolean,false) is not true then
    raise exception 'snapshot_changed_or_blocked_before_finalization' using errcode='55000';
  end if;

  insert into public.payroll_finalized_snapshots_v2(
    snapshot_id,staff_id,staff_username,staff_name,branch,month_cycle,cycle_start,cycle_end,
    snapshot_fingerprint,payload,finalized_by,finalized_by_name
  )
  values(
    v_snapshot.id,v_snapshot.staff_id,v_snapshot.staff_username,v_snapshot.staff_name,v_snapshot.branch,
    v_snapshot.month_cycle,v_snapshot.cycle_start,v_snapshot.cycle_end,v_snapshot.snapshot_fingerprint,
    v_snapshot.payload,v_actor.id,coalesce(v_actor.name,v_actor.username)
  )
  returning * into v_final;

  return jsonb_build_object(
    'success',true,'existing',false,'finalized',to_jsonb(v_final),
    'review',to_jsonb(v_review),'comparison',v_compare,
    'stale_approved_overtime',v_stale_overtime,'paid',false,'financial_effect','none'
  );
end;
$$;

revoke execute on function public.dawaa_detect_pending_overtime_v2(integer) from public;
revoke execute on function public.overtime_truth_status_v2(date,date,text) from public;
grant execute on function public.dawaa_detect_pending_overtime_v2(integer) to service_role;
grant execute on function public.overtime_truth_status_v2(date,date,text) to anon,authenticated,service_role;
