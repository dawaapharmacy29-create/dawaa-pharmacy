-- Route all background attendance runtime paths through the canonical router.
-- No attendance/payroll policy is changed here; this removes duplicated V2/V3 branching.

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
  v_retry_preview jsonb;
  v_scheduled_end timestamptz;
  v_retry_at timestamptz;
begin
  for v_q in
    select q.*
    from public.attendance_materialization_dirty_queue_v1 q
    where q.processed_at is null and q.next_attempt_at<=now()
    order by case when q.attempts=0 then 0 else 1 end,
             q.next_attempt_at,q.last_seen_at,q.attendance_date
    limit greatest(1,least(coalesce(p_limit,50),200))
    for update skip locked
  loop
    begin
      v_result:=public.dawaa_reconcile_attendance_dirty_day_current_v1(v_q.staff_id,v_q.attendance_date);
      v_action:=coalesce(v_result->>'action','unknown');

      if v_action='waiting_not_finalizable' then
        v_retry_preview:=public.dawaa_build_attendance_day_resolution_current_v1(v_q.staff_id,v_q.attendance_date);
        v_scheduled_end:=nullif(v_retry_preview->>'scheduled_end_at','')::timestamptz;
        if v_scheduled_end is not null and v_scheduled_end>now() then
          v_retry_at:=v_scheduled_end+interval '10 minutes';
        else
          v_retry_at:=now()+interval '30 minutes';
        end if;

        update public.attendance_materialization_dirty_queue_v1
        set attempts=attempts+1,
            next_attempt_at=v_retry_at,
            last_action=v_action,
            last_error=null
        where staff_id=v_q.staff_id and attendance_date=v_q.attendance_date;
        v_waiting:=v_waiting+1;
      else
        update public.attendance_materialization_dirty_queue_v1
        set attempts=attempts+1,
            processed_at=now(),
            next_attempt_at=now(),
            last_action=v_action,
            last_error=null
        where staff_id=v_q.staff_id and attendance_date=v_q.attendance_date;
        v_processed:=v_processed+1;
        if v_action in ('immutable_approved','cycle_locked') then
          v_immutable:=v_immutable+1;
        end if;
      end if;
    exception when others then
      update public.attendance_materialization_dirty_queue_v1
      set attempts=attempts+1,
          next_attempt_at=now()+interval '15 minutes',
          last_action='error',
          last_error=left(sqlstate||' '||sqlerrm,1000)
      where staff_id=v_q.staff_id and attendance_date=v_q.attendance_date;
      v_errors:=v_errors+1;
    end;
  end loop;

  return jsonb_build_object(
    'processed',v_processed,
    'waiting',v_waiting,
    'errors',v_errors,
    'immutable_or_locked',v_immutable,
    'limit',p_limit
  );
end;
$function$;

revoke all on function public.dawaa_process_attendance_dirty_queue_v1(integer) from public,anon,authenticated;
grant execute on function public.dawaa_process_attendance_dirty_queue_v1(integer) to service_role;

create or replace function public.dawaa_reconcile_attendance_range_route_aware_v1(
  p_start date,
  p_end date,
  p_branch text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_d date;
  v_staff record;
  v_result jsonb;
  v_route jsonb;
  v_action text;
  v_processed integer:=0;
  v_waiting integer:=0;
  v_errors integer:=0;
  v_immutable integer:=0;
  v_flexible integer:=0;
  v_standard integer:=0;
begin
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>45 then
    raise exception 'attendance_route_aware_reconcile_invalid_range' using errcode='22023';
  end if;

  for v_d in select generate_series(p_start,p_end,interval '1 day')::date loop
    for v_staff in
      select s.id
      from public.staff s
      where coalesce(s.active,false)=true
        and s.branch in ('فرع الشامي','فرع شكري')
        and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or s.branch=p_branch)
    loop
      begin
        v_route:=public.dawaa_attendance_engine_route_v1(v_staff.id);
        v_result:=public.dawaa_reconcile_attendance_dirty_day_current_v1(v_staff.id,v_d);
        if v_route->>'route'='flexible_v3' then
          v_flexible:=v_flexible+1;
        else
          v_standard:=v_standard+1;
        end if;

        v_action:=coalesce(v_result->>'action','unknown');
        if v_action='waiting_not_finalizable' then
          v_waiting:=v_waiting+1;
        else
          v_processed:=v_processed+1;
          if v_action in ('immutable_approved','cycle_locked') then
            v_immutable:=v_immutable+1;
          end if;
        end if;
      exception when others then
        v_errors:=v_errors+1;
      end;
    end loop;
  end loop;

  return jsonb_build_object(
    'schema','attendance_route_aware_safety_range_v1',
    'start',p_start,
    'end',p_end,
    'branch',p_branch,
    'processed',v_processed,
    'waiting',v_waiting,
    'errors',v_errors,
    'immutable_or_locked',v_immutable,
    'flexible_checks',v_flexible,
    'standard_checks',v_standard,
    'generated_at',now()
  );
end;
$function$;

revoke all on function public.dawaa_reconcile_attendance_range_route_aware_v1(date,date,text) from public,anon,authenticated;
grant execute on function public.dawaa_reconcile_attendance_range_route_aware_v1(date,date,text) to service_role;

create or replace function public.dawaa_materialize_attendance_range_route_aware_v1(
  p_start date,
  p_end date,
  p_branch text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_d date;
  v_staff record;
  v_route jsonb;
  v_row public.attendance_daily_summary%rowtype;
  v_processed integer:=0;
  v_approved integer:=0;
  v_review integer:=0;
  v_flexible integer:=0;
  v_standard integer:=0;
begin
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>45 then
    raise exception 'attendance_route_aware_materialize_invalid_range' using errcode='22023';
  end if;

  for v_d in select generate_series(p_start,p_end,interval '1 day')::date loop
    for v_staff in
      select s.id
      from public.staff s
      where coalesce(s.active,false)=true
        and s.branch in ('فرع الشامي','فرع شكري')
        and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or s.branch=p_branch)
    loop
      v_route:=public.dawaa_attendance_engine_route_v1(v_staff.id);
      v_row:=public.dawaa_materialize_attendance_day_current_v1(v_staff.id,v_d);

      if v_route->>'route'='flexible_v3' then
        v_flexible:=v_flexible+1;
      else
        v_standard:=v_standard+1;
      end if;

      if v_row.id is not null then
        v_processed:=v_processed+1;
        if v_row.status='approved' then
          v_approved:=v_approved+1;
        elsif v_row.status='pending_review' then
          v_review:=v_review+1;
        end if;
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'schema','attendance_route_aware_fast_safety_materializer_v1',
    'start',p_start,
    'end',p_end,
    'branch',p_branch,
    'processed',v_processed,
    'approved',v_approved,
    'pending_review',v_review,
    'flexible_checks',v_flexible,
    'standard_checks',v_standard,
    'generated_at',now()
  );
end;
$function$;

revoke all on function public.dawaa_materialize_attendance_range_route_aware_v1(date,date,text) from public,anon,authenticated;
grant execute on function public.dawaa_materialize_attendance_range_route_aware_v1(date,date,text) to service_role;

create or replace function public.dawaa_reconcile_attendance_system_review_backlog_v1(p_limit integer default 10)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_cycle record;
  v_q record;
  v_result jsonb;
  v_action text;
  v_selected integer:=0;
  v_processed integer:=0;
  v_waiting integer:=0;
  v_errors integer:=0;
begin
  select * into v_cycle from public.dawaa_pay_cycle_bounds_v1(null);

  for v_q in
    select a.id,a.staff_id,a.attendance_date,p.preview
    from public.attendance_daily_summary a
    join public.staff s on s.id=a.staff_id
    cross join lateral (
      select public.dawaa_build_attendance_day_resolution_current_v1(a.staff_id,a.attendance_date) as preview
    ) p
    where a.attendance_date between v_cycle.cycle_start and v_cycle.cycle_end
      and a.status='pending_review'
      and s.branch in ('فرع الشامي','فرع شكري')
      and coalesce((p.preview->>'finalizable')::boolean,false)=true
      and coalesce((p.preview->>'system_resolvable')::boolean,false)=true
    order by a.attendance_date,a.updated_at nulls first,a.id
    limit greatest(1,least(coalesce(p_limit,10),50))
    for update of a skip locked
  loop
    v_selected:=v_selected+1;
    begin
      v_result:=public.dawaa_reconcile_attendance_dirty_day_current_v1(v_q.staff_id,v_q.attendance_date);
      v_action:=coalesce(v_result->>'action','unknown');
      if v_action='waiting_not_finalizable' then
        v_waiting:=v_waiting+1;
      else
        v_processed:=v_processed+1;
      end if;
    exception when others then
      v_errors:=v_errors+1;
    end;
  end loop;

  return jsonb_build_object(
    'schema','attendance_system_review_backlog_v1',
    'month_cycle',v_cycle.month_cycle,
    'selected',v_selected,
    'processed',v_processed,
    'waiting',v_waiting,
    'errors',v_errors,
    'limit',p_limit,
    'generated_at',now()
  );
end;
$function$;

revoke all on function public.dawaa_reconcile_attendance_system_review_backlog_v1(integer) from public,anon,authenticated;
grant execute on function public.dawaa_reconcile_attendance_system_review_backlog_v1(integer) to service_role;

do $do$
begin
  perform cron.unschedule('attendance-system-review-backlog-v1')
  where exists(select 1 from cron.job where jobname='attendance-system-review-backlog-v1');

  perform cron.schedule(
    'attendance-system-review-backlog-v1',
    '17 */6 * * *',
    $cmd$select public.dawaa_reconcile_attendance_system_review_backlog_v1(10);$cmd$
  );
end;
$do$;
