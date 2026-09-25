-- Canonical HR architecture health V1.
-- Operational contract that verifies legacy paths stay retired and domain truth stays consistent.

create or replace function public.hr_canonical_architecture_health_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_bounds record;
  v_legacy_exposed integer:=0;
  v_points_v1_cron integer:=0;
  v_points_v2_cron integer:=0;
  v_stale_overtime integer:=0;
  v_timeoff_mismatch integer:=0;
  v_duplicate_points integer:=0;
  v_missing_cycle integer:=0;
  v_missing_source integer:=0;
  v_missing_points integer:=0;
  v_sent_eval_missing_multiplier integer:=0;
  v_ledger_direct_write_exposure integer:=0;
  v_config jsonb:='{}'::jsonb;
  v_cutover jsonb:='{}'::jsonb;
  v_status text:='healthy';
begin
  if not public.dawaa_current_actor_can(array['manage_hr','manage_payroll','manage_attendance']) then
    raise exception 'not_authorized_for_hr_architecture_health' using errcode='42501';
  end if;

  select * into v_bounds
  from public.dawaa_pay_cycle_bounds_v1((now() at time zone 'Africa/Cairo')::date);

  select count(*)::integer into v_legacy_exposed
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname=any(array[
      'save_staff_payroll_monthly_v14',
      'save_staff_payroll_monthly_v15',
      'save_staff_payroll_monthly_v16',
      'save_staff_payroll_monthly_v17',
      'approve_attendance_day_resolution_v1',
      'assign_biometric_staff_mapping_v1',
      'assign_biometric_staff_mapping_v2',
      'attendance_request_time_off_v1',
      'attendance_branch_review_time_off_v1',
      'attendance_gm_review_time_off_v1',
      'attendance_branch_time_off_queue_v1',
      'attendance_gm_time_off_queue_v1',
      'attendance_my_time_off_requests_v1',
      'attendance_cancel_time_off_request_v1',
      'dawaa_sync_attendance_points_deduction_v1',
      'attendance_deduction_pending_review_v1',
      'attendance_deduction_review_decide_v1',
      'attendance_deduction_adjust_v1',
      'payroll_cycle_finalization_overview_v1',
      'employee_payroll_financial_composition_v1',
      'record_employee_points_transaction_v3'
    ])
    and has_function_privilege('authenticated',p.oid,'EXECUTE');

  select
    count(*) filter(where command ilike '%dawaa_sync_attendance_points_deduction_v1%')::integer,
    count(*) filter(where command ilike '%dawaa_sync_attendance_points_deduction_v2%')::integer
  into v_points_v1_cron,v_points_v2_cron
  from cron.job
  where jobname='attendance-points-deduction-sync' and active;

  select count(*)::integer into v_stale_overtime
  from public.staff_overtime_approvals o
  left join public.attendance_daily_summary a on a.id=o.source_resolution_id
  where o.attendance_date between v_bounds.cycle_start and v_bounds.cycle_end
    and o.status='approved'
    and (
      o.source_resolution_id is null
      or a.id is null
      or a.status<>'approved'
      or public.attendance_resolution_fingerprint_v2(a.id) is distinct from o.source_resolution_fingerprint
    );

  select count(*)::integer into v_timeoff_mismatch
  from public.attendance_daily_summary a
  left join public.staff_time_off_requests r on r.id=a.time_off_request_id
  where a.attendance_date between v_bounds.cycle_start and v_bounds.cycle_end
    and a.status='approved'
    and a.resolution_status='approved_time_off'
    and (a.time_off_request_id is null or r.id is null or r.status<>'approved');

  select count(*)::integer into v_duplicate_points
  from (
    select et.staff_id,et.month_cycle,et.source,et.source_id
    from public.employee_transactions et
    where et.source_id is not null
      and et.status in ('active','approved','pending')
    group by et.staff_id,et.month_cycle,et.source,et.source_id
    having count(*)>1
  ) d;

  select
    count(*) filter(where et.month_cycle is null or trim(et.month_cycle)='')::integer,
    count(*) filter(where et.source is null or trim(et.source)='')::integer,
    count(*) filter(where et.points_delta is null and et.final_points is null and et.points is null)::integer
  into v_missing_cycle,v_missing_source,v_missing_points
  from public.employee_transactions et
  where et.status in ('active','approved','pending');

  select
    (case when has_table_privilege('authenticated','public.employee_transactions','INSERT') then 1 else 0 end)
    +(case when has_table_privilege('authenticated','public.employee_transactions','UPDATE') then 1 else 0 end)
    +(case when has_table_privilege('authenticated','public.employee_transactions','DELETE') then 1 else 0 end)
    +(case when has_table_privilege('anon','public.employee_transactions','INSERT') then 1 else 0 end)
    +(case when has_table_privilege('anon','public.employee_transactions','UPDATE') then 1 else 0 end)
    +(case when has_table_privilege('anon','public.employee_transactions','DELETE') then 1 else 0 end)
  into v_ledger_direct_write_exposure;

    select count(*)::integer
  into v_sent_eval_missing_multiplier
  from public.staff_monthly_manager_evaluations e
  left join public.staff_evaluation_incentive_multipliers m
    on m.staff_id=e.staff_id
   and m.month_cycle=to_char(e.evaluation_month,'YYYY-MM')
  where (e.sent_at is not null or e.status='sent')
    and m.staff_id is null
    and not exists(
      select 1 from public.payroll_finalized_snapshots_v2 f
      where f.staff_id=e.staff_id
        and f.month_cycle=to_char(e.evaluation_month,'YYYY-MM')
    );

    v_config:=public.payroll_cycle_finalization_overview_v2(v_bounds.month_cycle,null,200);
  v_cutover:=public.attendance_policy_v3_cutover_readiness_v1(v_bounds.cycle_start,v_bounds.cycle_end);

  if v_legacy_exposed>0
     or v_points_v1_cron>0
     or v_points_v2_cron<>1
     or v_stale_overtime>0
     or v_timeoff_mismatch>0
     or v_duplicate_points>0
     or v_missing_cycle>0
     or v_missing_source>0
     or v_missing_points>0
     or v_sent_eval_missing_multiplier>0
     or v_ledger_direct_write_exposure>0 then
    v_status:='critical';
  elsif coalesce((v_config->>'unconfigured_priority_count')::integer,0)>0
        or coalesce((v_cutover->>'ready_for_v3_cutover')::boolean,false) is not true then
    v_status:='warning';
  end if;

  return jsonb_build_object(
    'schema','hr_canonical_architecture_health_v1',
    'status',v_status,
    'month_cycle',v_bounds.month_cycle,
    'cycle_start',v_bounds.cycle_start,
    'cycle_end',v_bounds.cycle_end,
    'legacy_api_exposure',v_legacy_exposed,
    'employee_ledger_direct_write_exposure',v_ledger_direct_write_exposure,
    'attendance_points_cron',jsonb_build_object(
      'v1_jobs',v_points_v1_cron,
      'v2_jobs',v_points_v2_cron,
      'healthy',v_points_v1_cron=0 and v_points_v2_cron=1
    ),
    'integrity',jsonb_build_object(
      'approved_stale_overtime',v_stale_overtime,
      'approved_timeoff_truth_mismatch',v_timeoff_mismatch,
      'duplicate_active_points_events',v_duplicate_points,
      'transactions_missing_cycle',v_missing_cycle,
      'transactions_missing_source',v_missing_source,
      'transactions_missing_points',v_missing_points,
      'sent_evaluations_missing_multiplier',v_sent_eval_missing_multiplier
    ),
    'compensation_configuration',jsonb_build_object(
      'scope_staff_count',coalesce((v_config->>'scope_staff_count')::integer,0),
      'configured_staff_count',coalesce((v_config->>'configured_staff_count')::integer,0),
      'unconfigured_staff_count',coalesce((v_config->>'unconfigured_staff_count')::integer,0),
      'priority_review_count',coalesce((v_config->>'unconfigured_priority_count')::integer,0)
    ),
    'attendance_v3_cutover',v_cutover,
    'generated_at',now()
  );
end;
$function$;

revoke execute on function public.hr_canonical_architecture_health_v1()
  from public,anon;
grant execute on function public.hr_canonical_architecture_health_v1()
  to authenticated,service_role;
