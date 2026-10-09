create or replace function public.get_attendance_system_health_core_v1(p_month_cycle text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog, cron
as $$
declare
  v_cycle text;
  v_start date;
  v_end date;
  v_dirty_pending integer:=0;
  v_dirty_errors integer:=0;
  v_dirty_waiting integer:=0;
  v_dirty_oldest timestamptz;
  v_review_total integer:=0;
  v_review_auto integer:=0;
  v_review_manager integer:=0;
  v_review_manager_active integer:=0;
  v_review_manager_former integer:=0;
  v_review_system_repair integer:=0;
  v_review_waiting integer:=0;
  v_flexible_v2 integer:=0;
  v_duplicate_classified integer:=0;
  v_raw_financial_violations integer:=0;
  v_dirty_job_active boolean:=false;
  v_safety_job_active boolean:=false;
  v_backlog_job_active boolean:=false;
  v_dirty_last_status text;
  v_dirty_last_end timestamptz;
  v_safety_last_status text;
  v_safety_last_end timestamptz;
  v_backlog_last_status text;
  v_backlog_last_end timestamptz;
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
    select
      a.staff_id,a.attendance_date,a.resolution_status,
      coalesce(s.active,false) staff_active,
      public.dawaa_build_attendance_day_resolution_current_v1(a.staff_id,a.attendance_date) preview
    from public.attendance_daily_summary a
    join public.staff s on s.id=a.staff_id
    where a.attendance_date between v_start and v_end
      and a.status='pending_review'
      and s.branch in ('فرع الشامي','فرع شكري')
  ), classified as (
    select p.*,
      public.dawaa_attendance_review_triage_v1(p.resolution_status,p.preview) as lane
    from pending p
  )
  select
    count(*)::int,
    count(*) filter(where lane='auto')::int,
    count(*) filter(where lane='manager')::int,
    count(*) filter(where lane='manager' and staff_active)::int,
    count(*) filter(where lane='manager' and not staff_active)::int,
    count(*) filter(where lane='system_repair')::int,
    count(*) filter(where lane='waiting')::int
  into
    v_review_total,v_review_auto,v_review_manager,v_review_manager_active,
    v_review_manager_former,v_review_system_repair,v_review_waiting
  from classified;

  select count(*)::int into v_flexible_v2
  from public.attendance_daily_summary a
  join public.staff s on s.id=a.staff_id
  where a.attendance_date between v_start and v_end
    and s.branch in ('فرع الشامي','فرع شكري')
    and a.status='approved'
    and a.resolution_origin='system'
    and coalesce(a.resolution_version,0)=2
    and public.dawaa_staff_flexible_attendance_v1(a.staff_id);

  select count(*)::int into v_duplicate_classified
  from (
    select l.source_resolution_id
    from public.attendance_impact_ledger l
    join public.attendance_daily_summary a on a.id=l.source_resolution_id
    join public.staff s on s.id=a.staff_id
    where a.attendance_date between v_start and v_end
      and s.branch in ('فرع الشامي','فرع شكري')
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
  select coalesce(bool_or(active),false) into v_backlog_job_active
  from cron.job where jobname='attendance-system-review-backlog-v1';

  select jrd.status,jrd.end_time into v_dirty_last_status,v_dirty_last_end
  from cron.job_run_details jrd join cron.job j on j.jobid=jrd.jobid
  where j.jobname='attendance-dirty-queue-v1'
  order by jrd.start_time desc limit 1;

  select jrd.status,jrd.end_time into v_safety_last_status,v_safety_last_end
  from cron.job_run_details jrd join cron.job j on j.jobid=jrd.jobid
  where j.jobname='attendance-resolution-v2-reconcile'
  order by jrd.start_time desc limit 1;

  select jrd.status,jrd.end_time into v_backlog_last_status,v_backlog_last_end
  from cron.job_run_details jrd join cron.job j on j.jobid=jrd.jobid
  where j.jobname='attendance-system-review-backlog-v1'
  order by jrd.start_time desc limit 1;

  v_technical_status:=case
    when v_dirty_errors>0
      or v_duplicate_classified>0
      or v_flexible_v2>0
      or v_raw_financial_violations>0
      or not v_dirty_job_active
      or not v_safety_job_active
      or not v_backlog_job_active
      or coalesce(v_dirty_last_status,'')<>'succeeded'
      or coalesce(v_safety_last_status,'')<>'succeeded'
      or (v_backlog_last_status is not null and v_backlog_last_status<>'succeeded')
      then 'red'
    else 'green'
  end;

  v_operational_status:=case
    when v_review_manager>0 or v_review_system_repair>0 or v_review_waiting>0 or v_dirty_pending>0 then 'yellow'
    else 'green'
  end;

  v_overall_status:=case
    when v_technical_status='red' then 'red'
    when v_operational_status='yellow' then 'yellow'
    else 'green'
  end;

  return jsonb_build_object(
    'schema','attendance_system_health_v1',
    'lane_schema','attendance_review_lanes_v3',
    'scope','staff_branch_shamy_shokry',
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
      'auto_resolvable',v_review_auto,
      'manager_required',v_review_manager,
      'manager_required_active_staff',v_review_manager_active,
      'manager_required_former_staff',v_review_manager_former,
      'system_repair',v_review_system_repair,
      'waiting',v_review_waiting
    ),
    'invariants',jsonb_build_object(
      'flexible_system_v2_rows',v_flexible_v2,
      'duplicate_classified_resolutions',v_duplicate_classified,
      'financial_functions_reading_raw_attendance',v_raw_financial_violations
    ),
    'jobs',jsonb_build_object(
      'dirty_worker',jsonb_build_object(
        'active',v_dirty_job_active,'last_status',v_dirty_last_status,'last_finished_at',v_dirty_last_end
      ),
      'safety_net',jsonb_build_object(
        'active',v_safety_job_active,'last_status',v_safety_last_status,'last_finished_at',v_safety_last_end
      ),
      'system_review_backlog',jsonb_build_object(
        'active',v_backlog_job_active,'last_status',v_backlog_last_status,'last_finished_at',v_backlog_last_end
      )
    ),
    'generated_at',now()
  );
end;
$$;
