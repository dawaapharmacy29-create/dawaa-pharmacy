-- Canonical attendance architecture layer.
-- Additive first: one routing contract, accurate review triage, and system health.
-- Existing workers/cron are intentionally left unchanged in this migration.

create or replace function public.dawaa_attendance_engine_route_v1(p_staff_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_flexible boolean;
begin
  if p_staff_id is null then
    raise exception 'attendance_route_staff_id_required' using errcode='22023';
  end if;

  if not exists (
    select 1 from public.staff s
    where s.id=p_staff_id
      and coalesce(s.active,false)=true
      and s.branch in ('فرع الشامي','فرع شكري')
  ) then
    return jsonb_build_object(
      'staff_id',p_staff_id,
      'in_scope',false,
      'route','out_of_scope',
      'resolution_version',null,
      'flexible',null
    );
  end if;

  v_flexible:=public.dawaa_staff_flexible_attendance_v1(p_staff_id);

  return jsonb_build_object(
    'staff_id',p_staff_id,
    'in_scope',true,
    'route',case when v_flexible then 'flexible_v3' else 'standard_v2' end,
    'resolution_version',case when v_flexible then 3 else 2 end,
    'flexible',v_flexible
  );
end;
$function$;

revoke all on function public.dawaa_attendance_engine_route_v1(uuid) from public,anon,authenticated;
grant execute on function public.dawaa_attendance_engine_route_v1(uuid) to service_role;

create or replace function public.dawaa_build_attendance_day_resolution_current_v1(
  p_staff_id uuid,
  p_attendance_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_route jsonb;
begin
  if p_staff_id is null or p_attendance_date is null then
    raise exception 'attendance_current_builder_identity_or_date_required' using errcode='22023';
  end if;

  v_route:=public.dawaa_attendance_engine_route_v1(p_staff_id);

  if coalesce((v_route->>'in_scope')::boolean,false)=false then
    return jsonb_build_object(
      'staff_id',p_staff_id,
      'attendance_date',p_attendance_date,
      'route','out_of_scope',
      'finalizable',false,
      'system_resolvable',false,
      'reason','staff_out_of_scope'
    );
  end if;

  if v_route->>'route'='flexible_v3' then
    return public.dawaa_build_attendance_day_resolution_v3(p_staff_id,p_attendance_date)
      || jsonb_build_object('canonical_route','flexible_v3','canonical_resolution_version',3);
  end if;

  return public.dawaa_build_attendance_day_resolution_v2(p_staff_id,p_attendance_date)
    || jsonb_build_object('canonical_route','standard_v2','canonical_resolution_version',2);
end;
$function$;

revoke all on function public.dawaa_build_attendance_day_resolution_current_v1(uuid,date) from public,anon,authenticated;
grant execute on function public.dawaa_build_attendance_day_resolution_current_v1(uuid,date) to service_role;

create or replace function public.dawaa_materialize_attendance_day_current_v1(
  p_staff_id uuid,
  p_attendance_date date
)
returns public.attendance_daily_summary
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_route jsonb;
  v_row public.attendance_daily_summary%rowtype;
begin
  if p_staff_id is null or p_attendance_date is null then
    raise exception 'attendance_current_materializer_identity_or_date_required' using errcode='22023';
  end if;

  v_route:=public.dawaa_attendance_engine_route_v1(p_staff_id);
  if coalesce((v_route->>'in_scope')::boolean,false)=false then
    return v_row;
  end if;

  if v_route->>'route'='flexible_v3' then
    v_row:=public.dawaa_materialize_attendance_day_internal_v3(p_staff_id,p_attendance_date);
  else
    v_row:=public.dawaa_materialize_attendance_day_internal_v2(p_staff_id,p_attendance_date);
  end if;

  return v_row;
end;
$function$;

revoke all on function public.dawaa_materialize_attendance_day_current_v1(uuid,date) from public,anon,authenticated;
grant execute on function public.dawaa_materialize_attendance_day_current_v1(uuid,date) to service_role;

create or replace function public.dawaa_reconcile_attendance_dirty_day_current_v1(
  p_staff_id uuid,
  p_attendance_date date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_route jsonb;
  v_result jsonb;
begin
  if p_staff_id is null or p_attendance_date is null then
    raise exception 'attendance_current_reconciler_identity_or_date_required' using errcode='22023';
  end if;

  v_route:=public.dawaa_attendance_engine_route_v1(p_staff_id);
  if coalesce((v_route->>'in_scope')::boolean,false)=false then
    return jsonb_build_object(
      'action','out_of_scope',
      'staff_id',p_staff_id,
      'attendance_date',p_attendance_date,
      'canonical_route','out_of_scope'
    );
  end if;

  if v_route->>'route'='flexible_v3' then
    v_result:=public.dawaa_reconcile_flexible_attendance_dirty_day_v1(p_staff_id,p_attendance_date);
  else
    v_result:=public.dawaa_reconcile_attendance_dirty_day_v1(p_staff_id,p_attendance_date);
  end if;

  return coalesce(v_result,'{}'::jsonb)
    || jsonb_build_object(
      'canonical_route',v_route->>'route',
      'canonical_resolution_version',(v_route->>'resolution_version')::integer
    );
end;
$function$;

revoke all on function public.dawaa_reconcile_attendance_dirty_day_current_v1(uuid,date) from public,anon,authenticated;
grant execute on function public.dawaa_reconcile_attendance_dirty_day_current_v1(uuid,date) to service_role;

-- V4 fixes V3 triage. V3 used raw biometric-event count as a proxy for whether
-- the system can resolve a day. The canonical builder is the source of truth.
create or replace function public.get_attendance_resolution_queue_v4(
  p_start date,
  p_end date,
  p_branch text default null,
  p_status text default null,
  p_triage text default 'all',
  p_limit integer default 300
)
returns setof public.attendance_daily_summary
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor public.staff_accounts%rowtype;
  v_triage text:=lower(trim(coalesce(p_triage,'all')));
begin
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>45 then
    raise exception 'attendance_resolution_queue_v4_invalid_range' using errcode='22023';
  end if;
  if v_triage not in ('all','system','manager','waiting') then
    raise exception 'attendance_resolution_queue_v4_invalid_triage' using errcode='22023';
  end if;

  select * into v_actor
  from public.staff_accounts sa
  where sa.id=public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active,false)=true
    and coalesce(sa.can_login,false)=true;

  if not found then
    raise exception 'active staff actor required' using errcode='42501';
  end if;

  return query
  with base as (
    select
      a as row_data,
      case when a.status='pending_review'
        then public.dawaa_build_attendance_day_resolution_current_v1(a.staff_id,a.attendance_date)
        else null::jsonb
      end as preview
    from public.attendance_daily_summary a
    where a.attendance_date between p_start and p_end
      and coalesce(a.resolution_version,0)>=2
      and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or a.branch=p_branch)
      and (p_status is null or trim(p_status)='' or a.status=p_status)
      and public.dawaa_can_read_staff_attendance_log(a.staff_id,a.branch)
  )
  select (b.row_data).*
  from base b
  where
    v_triage='all'
    or (
      v_triage='system'
      and (b.row_data).status='pending_review'
      and coalesce((b.preview->>'finalizable')::boolean,false)=true
      and coalesce((b.preview->>'system_resolvable')::boolean,false)=true
    )
    or (
      v_triage='manager'
      and (b.row_data).status='pending_review'
      and coalesce((b.preview->>'finalizable')::boolean,false)=true
      and coalesce((b.preview->>'system_resolvable')::boolean,false)=false
    )
    or (
      v_triage='waiting'
      and (b.row_data).status='pending_review'
      and coalesce((b.preview->>'finalizable')::boolean,false)=false
    )
  order by
    case when (b.row_data).status='pending_review' then 0 else 1 end,
    case when (b.row_data).status<>'pending_review' then 99 else
      case (b.row_data).resolution_status
        when 'missing_checkin' then 1
        when 'missing_checkout' then 1
        when 'invalid_duration' then 2
        when 'worked_on_off' then 3
        when 'early_leave_review' then 4
        when 'needs_event_review' then 5
        when 'absence_review' then 5
        when 'no_schedule' then 6
        else 8
      end
    end,
    (b.row_data).attendance_date desc,
    (b.row_data).branch,
    (b.row_data).staff_id
  limit greatest(1,least(coalesce(p_limit,300),1000));
end;
$function$;

revoke all on function public.get_attendance_resolution_queue_v4(date,date,text,text,text,integer) from public;
grant execute on function public.get_attendance_resolution_queue_v4(date,date,text,text,text,integer)
to anon,authenticated,service_role;

create or replace function public.get_attendance_system_health_v1(p_month_cycle text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog','cron'
as $function$
declare
  v_cycle text;
  v_start date;
  v_end date;
  v_dirty_pending integer:=0;
  v_dirty_errors integer:=0;
  v_dirty_waiting integer:=0;
  v_dirty_oldest timestamptz;
  v_review_total integer:=0;
  v_review_system integer:=0;
  v_review_manager integer:=0;
  v_review_waiting integer:=0;
  v_flexible_v2 integer:=0;
  v_duplicate_classified integer:=0;
  v_raw_financial_violations integer:=0;
  v_dirty_job_active boolean:=false;
  v_safety_job_active boolean:=false;
  v_dirty_last_status text;
  v_dirty_last_end timestamptz;
  v_safety_last_status text;
  v_safety_last_end timestamptz;
  v_technical_status text;
  v_operational_status text;
  v_overall_status text;
begin
  if not public.dawaa_current_actor_can(array['manage_payroll']) then
    raise exception 'not_authorized_for_attendance_system_health' using errcode='42501';
  end if;

  if nullif(trim(coalesce(p_month_cycle,'')),'') is null then
    select month_cycle,cycle_start,cycle_end
      into v_cycle,v_start,v_end
    from public.dawaa_pay_cycle_bounds_v1(null);
  else
    v_cycle:=trim(p_month_cycle);
    v_start:=public.dawaa_points_cycle_start_for_label_v1(v_cycle);
    v_end:=public.dawaa_points_cycle_end_for_label_v1(v_cycle);
  end if;

  select
    count(*) filter(where processed_at is null)::int,
    count(*) filter(where processed_at is null and coalesce(last_action,'')='error')::int,
    count(*) filter(where processed_at is null and coalesce(last_action,'')='waiting_not_finalizable')::int,
    min(first_seen_at) filter(where processed_at is null)
  into v_dirty_pending,v_dirty_errors,v_dirty_waiting,v_dirty_oldest
  from public.attendance_materialization_dirty_queue_v1;

  with pending as (
    select a.*,
           public.dawaa_build_attendance_day_resolution_current_v1(a.staff_id,a.attendance_date) preview
    from public.attendance_daily_summary a
    where a.attendance_date between v_start and v_end
      and a.status='pending_review'
      and a.branch in ('فرع الشامي','فرع شكري')
  )
  select
    count(*)::int,
    count(*) filter(
      where coalesce((preview->>'finalizable')::boolean,false)=true
        and coalesce((preview->>'system_resolvable')::boolean,false)=true
    )::int,
    count(*) filter(
      where coalesce((preview->>'finalizable')::boolean,false)=true
        and coalesce((preview->>'system_resolvable')::boolean,false)=false
    )::int,
    count(*) filter(
      where coalesce((preview->>'finalizable')::boolean,false)=false
    )::int
  into v_review_total,v_review_system,v_review_manager,v_review_waiting
  from pending;

  select count(*)::int into v_flexible_v2
  from public.attendance_daily_summary a
  where a.attendance_date between v_start and v_end
    and a.status='approved'
    and a.resolution_origin='system'
    and coalesce(a.resolution_version,0)=2
    and public.dawaa_staff_flexible_attendance_v1(a.staff_id);

  select count(*)::int into v_duplicate_classified
  from (
    select l.source_resolution_id
    from public.attendance_impact_ledger l
    join public.attendance_daily_summary a on a.id=l.source_resolution_id
    where a.attendance_date between v_start and v_end
      and l.impact_status='classified'
    group by l.source_resolution_id
    having count(*)>1
  ) d;

  select count(*)::int into v_raw_financial_violations
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.prokind='f'
    and pg_get_functiondef(p.oid) ilike '%staff_attendance_logs%'
    and (
      p.proname ilike '%payroll%'
      or p.proname ilike '%financial%'
      or p.proname ilike '%statement%'
      or p.proname ilike '%eligibility%'
    )
    and p.proname not in ('get_attendance_payroll_readiness_v1');

  select coalesce(bool_or(active),false) into v_dirty_job_active
  from cron.job where jobname='attendance-dirty-queue-v1';
  select coalesce(bool_or(active),false) into v_safety_job_active
  from cron.job where jobname='attendance-resolution-v2-reconcile';

  select jrd.status,jrd.end_time
    into v_dirty_last_status,v_dirty_last_end
  from cron.job_run_details jrd
  join cron.job j on j.jobid=jrd.jobid
  where j.jobname='attendance-dirty-queue-v1'
  order by jrd.start_time desc
  limit 1;

  select jrd.status,jrd.end_time
    into v_safety_last_status,v_safety_last_end
  from cron.job_run_details jrd
  join cron.job j on j.jobid=jrd.jobid
  where j.jobname='attendance-resolution-v2-reconcile'
  order by jrd.start_time desc
  limit 1;

  v_technical_status:=case
    when v_dirty_errors>0
      or v_duplicate_classified>0
      or v_flexible_v2>0
      or v_raw_financial_violations>0
      or not v_dirty_job_active
      or not v_safety_job_active
      or coalesce(v_dirty_last_status,'')<>'succeeded'
      or coalesce(v_safety_last_status,'')<>'succeeded'
      then 'red'
    else 'green'
  end;

  v_operational_status:=case
    when v_review_manager>0 then 'yellow'
    when v_review_waiting>0 or v_dirty_pending>0 then 'yellow'
    else 'green'
  end;

  v_overall_status:=case
    when v_technical_status='red' then 'red'
    when v_operational_status='yellow' then 'yellow'
    else 'green'
  end;

  return jsonb_build_object(
    'schema','attendance_system_health_v1',
    'month_cycle',v_cycle,
    'cycle_start',v_start,
    'cycle_end',v_end,
    'overall_status',v_overall_status,
    'technical_status',v_technical_status,
    'operational_status',v_operational_status,
    'dirty_queue',jsonb_build_object(
      'pending',v_dirty_pending,
      'errors',v_dirty_errors,
      'waiting_not_finalizable',v_dirty_waiting,
      'oldest_pending_at',v_dirty_oldest
    ),
    'review_queue',jsonb_build_object(
      'total',v_review_total,
      'system_resolvable',v_review_system,
      'manager_required',v_review_manager,
      'waiting',v_review_waiting
    ),
    'invariants',jsonb_build_object(
      'flexible_system_v2_rows',v_flexible_v2,
      'duplicate_classified_resolutions',v_duplicate_classified,
      'financial_functions_reading_raw_attendance',v_raw_financial_violations
    ),
    'jobs',jsonb_build_object(
      'dirty_worker',jsonb_build_object(
        'active',v_dirty_job_active,
        'last_status',v_dirty_last_status,
        'last_finished_at',v_dirty_last_end
      ),
      'safety_net',jsonb_build_object(
        'active',v_safety_job_active,
        'last_status',v_safety_last_status,
        'last_finished_at',v_safety_last_end
      )
    ),
    'generated_at',now()
  );
end;
$function$;

revoke all on function public.get_attendance_system_health_v1(text) from public;
grant execute on function public.get_attendance_system_health_v1(text)
to anon,authenticated,service_role;
