-- Payroll cycle staff scope: one shared source for the overview and the HR architecture health counts.
--
-- Production smoke (2026-10-16, after 20261016090000/090100): /hr-data-quality loads
-- hr_canonical_architecture_health_v1 in ~10.4 s (statement_timeout 15 s). The health RPC calls
-- payroll_cycle_finalization_overview_v2 only to read seven identity/configuration counts, but the overview also
-- runs payroll_finalization_gate_v1 for every configured staff member (24 gates; each runs the attendance payroll
-- engine twice and rebuilds V2/V3 day resolutions for the whole cycle). Read-only Production measurement as the
-- general manager: full overview 7.3 s / 264k buffers; the identity/configuration part alone 72 ms / 2.4k buffers.
--
-- This migration:
--   1. public.payroll_cycle_staff_scope_v1(month_cycle, branch): the overview's identity scope and payroll scope
--      rows, moved verbatim (same predicates, per-row authorization helpers, branch filters and identity priority
--      rule) into one internal set-returning function.
--   2. public.payroll_cycle_configuration_counts_v1(month_cycle, branch): the seven counts, with the overview's
--      input validation and actor authorization (same errors), computed from (1) without any payroll gate.
--   3. payroll_cycle_finalization_overview_v2: the exact Production definition (2026-10-16, ledger
--      20260925175453) with its identity_scope / profile_state CTEs read from (1). Output, gates, limits, ordering
--      and errors are unchanged.
--   4. hr_canonical_architecture_health_v1: the exact Production definition (identical to 20260925150000) with its
--      single overview call replaced by (2): it reads the same seven counts and raises the same authorization error.
-- Grants: (1) and (2) are internal (called by the SECURITY DEFINER readers as their owner); (3) and (4) keep theirs.

do $guard$
declare
  v_overview text := md5(btrim(regexp_replace(pg_get_functiondef(to_regprocedure('public.payroll_cycle_finalization_overview_v2(text,text,integer)')), '\s+', ' ', 'g')));
  v_health text := (select md5(btrim(regexp_replace(prosrc, '\s+', ' ', 'g'))) from pg_proc where oid = to_regprocedure('public.hr_canonical_architecture_health_v1()'));
begin
  if v_overview is null or v_overview not in ('14322d059473f17b8e295df0e4f8e492', '000e211d85914bf3bf51ca9e71c968d9') then
    raise exception 'payroll_cycle_finalization_overview_v2 differs from the reviewed definition; regenerate this migration';
  end if;
  if v_health is null or v_health not in ('4c2d1486e675ecb40f3a377018d4412b', 'db1a7f723aa8327c78012afe5b199b26') then
    raise exception 'hr_canonical_architecture_health_v1 differs from the reviewed definition; regenerate this migration';
  end if;
  if to_regprocedure('public.payroll_finalization_gate_v1(uuid,text)') is null
     or to_regprocedure('public.dawaa_can_manage_payroll_staff_v1(text)') is null
     or to_regprocedure('public.dawaa_staff_uses_delivery_finance_v1(uuid)') is null
     or to_regprocedure('public.dawaa_can_read_staff_attendance_log(uuid,text)') is null then
    raise exception 'payroll scope dependencies are missing';
  end if;
end;
$guard$;

create or replace function public.payroll_cycle_staff_scope_v1(p_month_cycle text, p_branch text default null)
returns table(
  scope text, staff_id uuid, staff_name text, role text, branch text, username text,
  account_count integer, active_login_account_count integer, has_profile boolean,
  incentive_transactions integer, payroll_history_rows integer, priority_review boolean
)
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  -- identity scope: staff the actor may read attendance for (payroll identity gaps are measured here).
  select 'identity'::text,
    i.staff_id,i.staff_name,i.role,i.branch,null::text,
    i.account_count,i.active_login_account_count,i.has_profile,i.incentive_transactions,i.payroll_history_rows,
    (i.has_profile or i.incentive_transactions>0 or i.payroll_history_rows>0)
  from (
    select
      s.id staff_id,s.name staff_name,s.role,s.branch,
      (select count(*)::integer from public.staff_accounts a where a.staff_id=s.id::text) account_count,
      (select count(*)::integer from public.staff_accounts a where a.staff_id=s.id::text and coalesce(a.active,false) and coalesce(a.can_login,false)) active_login_account_count,
      exists(select 1 from public.employee_compensation_profiles cp where cp.staff_id=s.id::text and coalesce(cp.active,true)) has_profile,
      (select count(*)::integer from public.employee_transactions et where et.staff_id=s.id and et.month_cycle=p_month_cycle and et.status in ('active','approved','pending')) incentive_transactions,
      (select count(*)::integer from public.staff_payroll_monthly_v13 pm where pm.staff_id=s.id) payroll_history_rows
    from public.staff s
    where coalesce(s.active,s.is_active,true)
      and coalesce(s.status,'active') not in ('inactive','deleted','disabled')
      and not public.dawaa_staff_uses_delivery_finance_v1(s.id)
      and public.dawaa_can_read_staff_attendance_log(s.id,s.branch)
      and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or trim(coalesce(s.branch,''))=trim(p_branch))
  ) i
  union all
  -- payroll scope: staff with a login account the actor may manage payroll for (configuration is measured here).
  select 'payroll'::text,
    ps.staff_id,ps.staff_name,ps.role,ps.branch,ps.username,
    null::integer,null::integer,
    ps.has_profile,ps.incentive_transactions,ps.payroll_history_rows,
    (ps.incentive_transactions>0 or ps.payroll_history_rows>0)
  from (
    select ss.*,
      exists(select 1 from public.employee_compensation_profiles p where p.staff_id=ss.staff_id::text and coalesce(p.active,true)) has_profile,
      (select count(*)::integer from public.employee_transactions et where et.staff_id=ss.staff_id and et.month_cycle=p_month_cycle and et.status in ('active','approved','pending')) incentive_transactions,
      (select count(*)::integer from public.staff_payroll_monthly_v13 pm where pm.staff_id=ss.staff_id) payroll_history_rows
    from (
    select distinct on (s.id)
      s.id staff_id,s.name staff_name,s.role,s.branch,sa.username
    from public.staff s
    join public.staff_accounts sa on sa.staff_id=s.id::text
    where coalesce(s.active,s.is_active,true)
      and coalesce(s.status,'active') not in ('inactive','deleted','disabled')
      and not public.dawaa_staff_uses_delivery_finance_v1(s.id)
      and coalesce(sa.active,true)
      and coalesce(sa.can_login,true)
      and public.dawaa_can_manage_payroll_staff_v1(sa.username)
      and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or trim(coalesce(s.branch,sa.branch,''))=trim(p_branch))
    order by s.id,sa.updated_at desc nulls last,sa.created_at desc nulls last
    ) ss
  ) ps;
$function$;

revoke all on function public.payroll_cycle_staff_scope_v1(text,text) from public, anon, authenticated;
grant execute on function public.payroll_cycle_staff_scope_v1(text,text) to service_role;

create or replace function public.payroll_cycle_configuration_counts_v1(p_month_cycle text, p_branch text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor public.staff_accounts%rowtype;
  v_result jsonb;
begin
  -- Same input validation and actor authorization as payroll_cycle_finalization_overview_v2.
  if coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_payroll_cycle_overview_input' using errcode='22023';
  end if;

  select * into v_actor
  from public.staff_accounts
  where id=public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false)=true
    and coalesce(can_login,false)=true;

  if not found or not public.dawaa_current_actor_can(array['manage_payroll']) then
    raise exception 'not_authorized_for_payroll_cycle_overview' using errcode='42501';
  end if;

  with scope as (
    select * from public.payroll_cycle_staff_scope_v1(p_month_cycle,p_branch)
  ),
  identity_gaps as (
    select * from scope where scope='identity' and active_login_account_count=0
  ),
  profile_state as (
    select * from scope where scope='payroll'
  )
  select jsonb_build_object(
    'schema','payroll_cycle_configuration_counts_v1',
    'month_cycle',p_month_cycle,
    'branch',nullif(trim(coalesce(p_branch,'')),''),
    'scope_staff_count',(select count(*) from scope where scope='identity'),
    'identified_staff_count',(select count(*) from profile_state),
    'identity_gap_count',(select count(*) from identity_gaps),
    'identity_priority_count',(select count(*) from identity_gaps where priority_review),
    'configured_staff_count',(select count(*) from profile_state where has_profile),
    'unconfigured_staff_count',(select count(*) from profile_state where not has_profile),
    'unconfigured_priority_count',(select count(*) from profile_state where not has_profile and priority_review)
  ) into v_result;

  return v_result;
end;
$function$;

revoke all on function public.payroll_cycle_configuration_counts_v1(text,text) from public, anon, authenticated;
grant execute on function public.payroll_cycle_configuration_counts_v1(text,text) to service_role;

CREATE OR REPLACE FUNCTION public.payroll_cycle_finalization_overview_v2(p_month_cycle text, p_branch text DEFAULT NULL::text, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_actor public.staff_accounts%rowtype;
  v_result jsonb;
begin
  if coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_payroll_cycle_overview_input' using errcode='22023';
  end if;

  select * into v_actor
  from public.staff_accounts
  where id=public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false)=true
    and coalesce(can_login,false)=true;

  if not found or not public.dawaa_current_actor_can(array['manage_payroll']) then
    raise exception 'not_authorized_for_payroll_cycle_overview' using errcode='42501';
  end if;

  with identity_scope as (
    select x.staff_id,x.staff_name,x.role,x.branch,x.account_count,x.active_login_account_count,
      x.has_profile,x.incentive_transactions,x.payroll_history_rows,x.priority_review
    from public.payroll_cycle_staff_scope_v1(p_month_cycle,p_branch) x
    where x.scope='identity'
  ),
  identity_gaps as (
    select i.*,
      case when i.account_count=0 then 'missing_account' else 'disabled_account' end identity_state
    from identity_scope i where i.active_login_account_count=0
  ),
  profile_state as (
    select x.staff_id,x.staff_name,x.role,x.branch,x.username,
      x.has_profile,x.incentive_transactions,x.payroll_history_rows,x.priority_review
    from public.payroll_cycle_staff_scope_v1(p_month_cycle,p_branch) x
    where x.scope='payroll'
  ),
  configured as (select * from profile_state where has_profile),
  evaluated as (
    select c.*,public.payroll_finalization_gate_v1(c.staff_id,p_month_cycle) gate
    from configured c
  ),
  limited as (
    select * from evaluated order by staff_name limit greatest(1,least(coalesce(p_limit,100),200))
  ),
  unconfigured as (
    select ps.*,
      case when ps.incentive_transactions>0 then 'missing_with_incentive_activity'
           when ps.payroll_history_rows>0 then 'missing_with_payroll_history'
           else 'missing_no_activity' end configuration_state
    from profile_state ps where not ps.has_profile
  ),
  blockers as (
    select x.value->>'code' code,x.value->>'label' label,count(*)::integer affected_staff
    from evaluated e
    cross join lateral jsonb_array_elements(coalesce(e.gate->'blockers','[]'::jsonb)) x(value)
    group by x.value->>'code',x.value->>'label'
  )
  select jsonb_build_object(
    'schema','payroll_cycle_finalization_overview_v2',
    'month_cycle',p_month_cycle,
    'branch',nullif(trim(coalesce(p_branch,'')),''),
    'scope_staff_count',(select count(*) from identity_scope),
    'identified_staff_count',(select count(*) from profile_state),
    'identity_gap_count',(select count(*) from identity_gaps),
    'identity_priority_count',(select count(*) from identity_gaps where priority_review),
    'configured_staff_count',(select count(*) from configured),
    'unconfigured_staff_count',(select count(*) from unconfigured),
    'unconfigured_priority_count',(select count(*) from unconfigured where priority_review),
    'staff_count',(select count(*) from evaluated),
    'ready_count',(select count(*) from evaluated where coalesce((gate->>'ready')::boolean,false)),
    'blocked_count',(select count(*) from evaluated where not coalesce((gate->>'ready')::boolean,false)),
    'rows',coalesce((
      select jsonb_agg(jsonb_build_object(
        'staff_id',staff_id,'staff_name',staff_name,'role',role,'branch',branch,
        'configuration_state','configured','ready',coalesce((gate->>'ready')::boolean,false),
        'blocker_count',jsonb_array_length(coalesce(gate->'blockers','[]'::jsonb)),
        'warning_count',jsonb_array_length(coalesce(gate->'warnings','[]'::jsonb)),
        'blockers',coalesce(gate->'blockers','[]'::jsonb),
        'warnings',coalesce(gate->'warnings','[]'::jsonb),
        'policy_validation',coalesce(gate->'policy_validation','{}'::jsonb)
      ) order by staff_name) from limited
    ),'[]'::jsonb),
    'identity_queue',coalesce((
      select jsonb_agg(jsonb_build_object(
        'staff_id',staff_id,'staff_name',staff_name,'role',role,'branch',branch,
        'identity_state',identity_state,'priority_review',priority_review,
        'account_count',account_count,'active_login_account_count',active_login_account_count,
        'has_profile',has_profile,'incentive_transactions',incentive_transactions,'payroll_history_rows',payroll_history_rows
      ) order by priority_review desc,branch,role,staff_name) from identity_gaps
    ),'[]'::jsonb),
    'configuration_queue',coalesce((
      select jsonb_agg(jsonb_build_object(
        'staff_id',staff_id,'staff_name',staff_name,'role',role,'branch',branch,
        'configuration_state',configuration_state,'priority_review',priority_review,
        'incentive_transactions',incentive_transactions,'payroll_history_rows',payroll_history_rows
      ) order by priority_review desc,branch,role,staff_name) from unconfigured
    ),'[]'::jsonb),
    'top_blockers',coalesce((
      select jsonb_agg(jsonb_build_object('code',code,'label',label,'affected_staff',affected_staff)
        order by affected_staff desc,code) from blockers
    ),'[]'::jsonb),
    'generated_at',now(),
    'external_finance_note','Delivery staff are excluded from standard payroll readiness and handled by Dawaa Delivery financial truth.'
  ) into v_result;

  return v_result;
end;
$function$;

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

    v_config:=public.payroll_cycle_configuration_counts_v1(v_bounds.month_cycle,null);
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
        or coalesce((v_config->>'identity_priority_count')::integer,0)>0
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
    'payroll_identity',jsonb_build_object(
      'scope_staff_count',coalesce((v_config->>'scope_staff_count')::integer,0),
      'identified_staff_count',coalesce((v_config->>'identified_staff_count')::integer,0),
      'identity_gap_count',coalesce((v_config->>'identity_gap_count')::integer,0),
      'priority_review_count',coalesce((v_config->>'identity_priority_count')::integer,0)
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

notify pgrst, 'reload schema';
