-- Fixture for 20261016100000_payroll_cycle_staff_scope_shared_v1.
-- Loads the Production definitions of payroll_cycle_finalization_overview_v2 (2026-10-16, ledger 20260925175453)
-- and hr_canonical_architecture_health_v1 (20260925150000), runs them for a set of actors/branches BEFORE the
-- migration and stores their outputs in test_before, so the test can prove the migrated functions return exactly
-- the same results. Actor, permissions and read scopes come from GUCs; payroll_finalization_gate_v1 is a
-- deterministic stand-in that counts its calls in test.gate_calls.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema cron;
create table cron.job (jobid serial primary key, jobname text, command text, active boolean);
insert into cron.job (jobname, command, active) values
  ('attendance-points-deduction-sync', 'select public.dawaa_sync_attendance_points_deduction_v2()', true);

create table public.staff (
  id uuid primary key, name text, role text, branch text, active boolean, is_active boolean, status text, type text
);
create table public.staff_accounts (
  id uuid primary key default gen_random_uuid(), staff_id text, username text, role text, staff_role text, job_title text,
  branch text, active boolean, can_login boolean, created_at timestamptz default now(), updated_at timestamptz
);
create table public.employee_compensation_profiles (staff_id text, active boolean);
create table public.employee_transactions (
  id uuid primary key default gen_random_uuid(), staff_id uuid, month_cycle text, status text, source text, source_id text,
  points_delta numeric, final_points numeric, points numeric
);
create table public.staff_payroll_monthly_v13 (staff_id uuid);
create table public.staff_overtime_approvals (
  id uuid primary key default gen_random_uuid(), attendance_date date, status text, source_resolution_id uuid, source_resolution_fingerprint text
);
create table public.attendance_daily_summary (
  id uuid primary key default gen_random_uuid(), attendance_date date, status text, resolution_status text, time_off_request_id uuid
);
create table public.staff_time_off_requests (id uuid primary key, status text);
create table public.staff_monthly_manager_evaluations (staff_id uuid, evaluation_month date, sent_at timestamptz, status text);
create table public.staff_evaluation_incentive_multipliers (staff_id uuid, month_cycle text);
create table public.payroll_finalized_snapshots_v2 (staff_id uuid, month_cycle text);

-- Actor: test.account_id; permissions: test.permissions (comma list); attendance read scope: test.read_scope
-- ('all' or a branch); payroll manage scope: test.payroll_scope ('all' or a branch).
create or replace function public.dawaa_current_staff_account_id_strict()
returns uuid language sql stable security definer set search_path to 'public'
as $$ select nullif(current_setting('test.account_id', true), '')::uuid $$;
create or replace function public.dawaa_current_actor_can(required_permissions text[])
returns boolean language sql stable security definer set search_path to 'public'
as $$ select coalesce(string_to_array(nullif(current_setting('test.permissions', true), ''), ',') && required_permissions, false) $$;
create or replace function public.dawaa_can_read_staff_attendance_log(p_staff_id uuid, p_branch text)
returns boolean language sql stable security definer set search_path to 'public'
as $$ select coalesce(current_setting('test.read_scope', true), '') in ('all', trim(coalesce(p_branch, ''))) and coalesce(current_setting('test.read_scope', true), '') <> '' $$;
create or replace function public.dawaa_can_manage_payroll_staff_v1(p_staff_username text)
returns boolean language sql stable security definer set search_path to 'public'
as $$
  select coalesce(current_setting('test.payroll_scope', true), '') = 'all'
      or exists (select 1 from public.staff_accounts sa where lower(trim(sa.username)) = lower(trim(coalesce(p_staff_username, '')))
                 and trim(coalesce(sa.branch, '')) = coalesce(current_setting('test.payroll_scope', true), '') and coalesce(current_setting('test.payroll_scope', true), '') <> '')
$$;
-- Production definition (2026-10-16).
create or replace function public.dawaa_staff_uses_delivery_finance_v1(p_staff_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $$
select exists(select 1 from public.staff s where s.id=p_staff_id and (lower(trim(coalesce(s.role,''))) in ('delivery','توصيل','مندوب','مندوب توصيل') or lower(trim(coalesce(s.type,''))) in ('delivery','توصيل') or exists(select 1 from public.staff_accounts sa where sa.staff_id=s.id::text and (lower(trim(coalesce(sa.role,'')))='delivery' or lower(trim(coalesce(sa.staff_role,''))) in ('delivery','توصيل','مندوب','مندوب توصيل') or lower(trim(coalesce(sa.job_title,''))) in ('delivery','توصيل','مندوب','مندوب توصيل')))));
$$;
create or replace function public.payroll_finalization_gate_v1(p_staff_id uuid, p_month_cycle text)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
begin
  perform set_config('test.gate_calls', (coalesce(nullif(current_setting('test.gate_calls', true), ''), '0')::int + 1)::text, false);
  return case when (select name from public.staff where id = p_staff_id) like '%blocked%'
    then jsonb_build_object('ready', false, 'blockers', jsonb_build_array(jsonb_build_object('code', 'policy_unresolved_days', 'label', 'x')), 'warnings', '[]'::jsonb, 'policy_validation', jsonb_build_object('checked_days', 3))
    else jsonb_build_object('ready', true, 'blockers', '[]'::jsonb, 'warnings', '[]'::jsonb, 'policy_validation', jsonb_build_object('checked_days', 3)) end;
end;
$$;
create or replace function public.dawaa_pay_cycle_bounds_v1(p_date date)
returns table(cycle_start date, cycle_end date, month_cycle text) language sql stable
as $$ select date '2026-09-26', date '2026-10-25', '2026-10'::text $$;
create or replace function public.attendance_resolution_fingerprint_v2(p_id uuid)
returns text language sql stable as $$ select 'fp-' || p_id::text $$;
create or replace function public.attendance_policy_v3_cutover_readiness_v1(p_start date default null, p_end date default null)
returns jsonb language sql stable as $$ select jsonb_build_object('ready_for_v3_cutover', true) $$;

-- Staff: two branches, delivery staff (excluded), an archived member, missing/disabled accounts, unconfigured
-- staff with and without activity, and a configured staff member whose gate is blocked.
insert into public.staff (id, name, role, branch, active, status, type) values
  ('00000000-0000-4000-8000-000000000001', 'A configured', 'pharmacist', 'فرع شكري', true, 'active', null),
  ('00000000-0000-4000-8000-000000000002', 'B configured blocked', 'pharmacist', 'فرع شكري', true, 'active', null),
  ('00000000-0000-4000-8000-000000000003', 'C unconfigured with incentive', 'assistant', 'فرع شكري', true, 'active', null),
  ('00000000-0000-4000-8000-000000000004', 'D unconfigured no activity', 'assistant', 'فرع الشامي', true, 'active', null),
  ('00000000-0000-4000-8000-000000000005', 'E missing account with profile', 'pharmacist', 'فرع الشامي', true, 'active', null),
  ('00000000-0000-4000-8000-000000000006', 'F disabled account', 'assistant', 'فرع الشامي', true, 'active', null),
  ('00000000-0000-4000-8000-000000000007', 'G delivery', 'delivery', 'فرع شكري', true, 'active', null),
  ('00000000-0000-4000-8000-000000000008', 'H archived', 'pharmacist', 'فرع شكري', false, 'inactive', null),
  ('00000000-0000-4000-8000-000000000009', 'I configured shami', 'branch_manager', 'فرع الشامي', true, 'active', null),
  ('00000000-0000-4000-8000-000000000010', 'J unconfigured with history', 'assistant', 'فرع الشامي', true, 'active', null);
insert into public.staff_accounts (staff_id, username, role, branch, active, can_login, updated_at) values
  ('00000000-0000-4000-8000-000000000001', 'a', 'pharmacist', 'فرع شكري', true, true, now()),
  ('00000000-0000-4000-8000-000000000002', 'b', 'pharmacist', 'فرع شكري', true, true, now()),
  ('00000000-0000-4000-8000-000000000003', 'c', 'assistant', 'فرع شكري', true, true, now()),
  ('00000000-0000-4000-8000-000000000004', 'd', 'assistant', 'فرع الشامي', true, true, now()),
  ('00000000-0000-4000-8000-000000000006', 'f', 'assistant', 'فرع الشامي', false, false, now()),
  ('00000000-0000-4000-8000-000000000007', 'g', 'delivery', 'فرع شكري', true, true, now()),
  ('00000000-0000-4000-8000-000000000009', 'i', 'branch_manager', 'فرع الشامي', true, true, now()),
  ('00000000-0000-4000-8000-000000000010', 'j', 'assistant', 'فرع الشامي', true, true, now());
insert into public.employee_compensation_profiles (staff_id, active) values
  ('00000000-0000-4000-8000-000000000001', true), ('00000000-0000-4000-8000-000000000002', true),
  ('00000000-0000-4000-8000-000000000005', true), ('00000000-0000-4000-8000-000000000009', null),
  ('00000000-0000-4000-8000-000000000004', false);
insert into public.employee_transactions (staff_id, month_cycle, status, source, source_id, points_delta) values
  ('00000000-0000-4000-8000-000000000003', '2026-10', 'active', 'manual', 's1', 5),
  ('00000000-0000-4000-8000-000000000001', '2026-10', 'approved', 'manual', 's2', 3),
  ('00000000-0000-4000-8000-000000000004', '2026-09', 'active', 'manual', 's3', 1);
insert into public.staff_payroll_monthly_v13 (staff_id) values ('00000000-0000-4000-8000-000000000010');

-- Production definition of payroll_cycle_finalization_overview_v2 (2026-10-16, pg_get_functiondef).
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
  ),
  identity_gaps as (
    select i.*,
      case when i.account_count=0 then 'missing_account' else 'disabled_account' end identity_state,
      (i.has_profile or i.incentive_transactions>0 or i.payroll_history_rows>0) priority_review
    from identity_scope i where i.active_login_account_count=0
  ),
  scoped_staff as (
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
  ),
  profile_state as (
    select ss.*,
      exists(select 1 from public.employee_compensation_profiles p where p.staff_id=ss.staff_id::text and coalesce(p.active,true)) has_profile,
      (select count(*)::integer from public.employee_transactions et where et.staff_id=ss.staff_id and et.month_cycle=p_month_cycle and et.status in ('active','approved','pending')) incentive_transactions,
      (select count(*)::integer from public.staff_payroll_monthly_v13 pm where pm.staff_id=ss.staff_id) payroll_history_rows
    from scoped_staff ss
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
           else 'missing_no_activity' end configuration_state,
      (ps.incentive_transactions>0 or ps.payroll_history_rows>0) priority_review
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

revoke all on function public.payroll_cycle_finalization_overview_v2(text,text,integer) from public;
grant execute on function public.payroll_cycle_finalization_overview_v2(text,text,integer) to anon, authenticated, service_role;

-- Production definition of hr_canonical_architecture_health_v1 (body identical to 20260925150000) and its
-- Production grants after 20261015140200 (anon EXECUTE, authorized internally).
\ir ../migrations/20260925150000_hr_canonical_architecture_health_v1.sql
grant execute on function public.hr_canonical_architecture_health_v1() to anon;

-- Actor accounts (no staff link, so they do not enter the payroll scopes).
insert into public.staff_accounts (id, staff_id, username, role, branch, active, can_login) values
  ('00000000-0000-4000-8000-0000000000a1', null, 'actor-gm', 'general_manager', null, true, true),
  ('00000000-0000-4000-8000-0000000000a2', null, 'actor-bm', 'branch_manager', 'فرع الشامي', true, true),
  ('00000000-0000-4000-8000-0000000000a3', null, 'actor-hr', 'hr_manager', null, true, true);

create table public.test_scenarios (
  scenario text primary key, account_id text, permissions text, read_scope text, payroll_scope text, branch text
);
insert into public.test_scenarios values
  ('gm_all_branches', '00000000-0000-4000-8000-0000000000a1', 'manage_payroll,manage_hr', 'all', 'all', null),
  ('gm_branch_filter', '00000000-0000-4000-8000-0000000000a1', 'manage_payroll,manage_hr', 'all', 'all', 'فرع شكري'),
  ('gm_branch_all_label', '00000000-0000-4000-8000-0000000000a1', 'manage_payroll,manage_hr', 'all', 'all', 'الكل'),
  ('branch_manager_scope', '00000000-0000-4000-8000-0000000000a2', 'manage_payroll,manage_attendance', 'فرع الشامي', 'فرع الشامي', null),
  ('hr_without_payroll', '00000000-0000-4000-8000-0000000000a3', 'manage_hr', 'all', 'all', null),
  ('no_actor', '', '', '', '', null);

-- Outputs of the pre-migration functions, captured before 20261016100000 runs.
create table public.test_before (
  scenario text primary key, overview jsonb, overview_error text, health jsonb, health_error text,
  overview_gate_calls int, health_gate_calls int, overview_acl text, health_acl text
);
do $capture$
declare
  v record; v_overview jsonb; v_overview_error text; v_health jsonb; v_health_error text; v_og int; v_hg int;
begin
  for v in select * from public.test_scenarios loop
    perform set_config('test.account_id', v.account_id, false);
    perform set_config('test.permissions', v.permissions, false);
    perform set_config('test.read_scope', v.read_scope, false);
    perform set_config('test.payroll_scope', v.payroll_scope, false);
    v_overview := null; v_overview_error := null; v_health := null; v_health_error := null;
    perform set_config('test.gate_calls', '0', false);
    begin
      v_overview := public.payroll_cycle_finalization_overview_v2('2026-10', v.branch, 200) - 'generated_at';
    exception when others then v_overview_error := sqlstate || ' ' || sqlerrm;
    end;
    v_og := current_setting('test.gate_calls')::int;
    perform set_config('test.gate_calls', '0', false);
    if v.branch is null then
      begin
        v_health := public.hr_canonical_architecture_health_v1() - 'generated_at';
      exception when others then v_health_error := sqlstate || ' ' || sqlerrm;
      end;
    end if;
    v_hg := current_setting('test.gate_calls')::int;
    insert into public.test_before values (v.scenario, v_overview, v_overview_error, v_health, v_health_error, v_og, v_hg,
      (select proacl::text from pg_proc where oid = 'public.payroll_cycle_finalization_overview_v2(text,text,integer)'::regprocedure),
      (select proacl::text from pg_proc where oid = 'public.hr_canonical_architecture_health_v1()'::regprocedure));
  end loop;
end;
$capture$;
