-- Fixture for 20261015140200_anon_session_internal_authorized_reads_v1 and
-- 20261015140300_reconcile_staff_points_manager_summary_v4. The authorization statements of the
-- Production functions are reproduced verbatim; data access is reduced to small tables.
create role anon;
create role authenticated;
create role service_role bypassrls;

create table public.staff (id uuid primary key, name text, role text, branch text, active boolean, is_active boolean, status text);
create table public.staff_accounts (id uuid primary key, staff_id text, role text, branch text, active boolean, can_login boolean);
create table public.account_permissions (account_id uuid primary key, permissions jsonb not null);
create table public.staff_evaluation_incentive_multipliers (staff_id uuid, month_cycle text, multiplier_pct numeric);
create table public.staff_monthly_manager_evaluations (staff_id uuid, evaluation_month date, status text, overall_score numeric);
create table public.payroll_finalized_snapshots_v2 (staff_id uuid, month_cycle text);

-- Verified-session stand-ins (the test selects the actor through a GUC).
create or replace function public.dawaa_session_account_id_v1()
returns uuid language sql stable security definer set search_path to 'public'
as $$ select nullif(current_setting('test.account_id', true), '')::uuid $$;
create or replace function public.dawaa_current_staff_account_id_strict()
returns uuid language sql stable security definer set search_path to 'public'
as $$ select a.id from public.staff_accounts a where a.id = public.dawaa_session_account_id_v1() and a.active and a.can_login $$;

create or replace function public.employee_operating_actor_id()
returns text language sql stable set search_path to 'public', 'pg_catalog'
as $function$
  select coalesce(
    public.dawaa_session_account_id_v1()::text,
    nullif(current_setting('request.jwt.claim.sub', true), '')
  );
$function$;
create or replace function public.employee_operating_actor_role()
returns text language sql stable security definer set search_path to 'public', 'pg_catalog'
as $function$
  select lower(trim(coalesce(sa.role, '')))
  from public.staff_accounts sa
  where sa.id::text = public.employee_operating_actor_id()
    and coalesce(sa.active, true) = true
    and coalesce(sa.can_login, true) = true
  limit 1;
$function$;
create or replace function public.employee_operating_actor_branch()
returns text language sql stable security definer set search_path to 'public', 'pg_catalog'
as $function$
  select nullif(trim(coalesce(sa.branch, '')), '')
  from public.staff_accounts sa
  where sa.id::text = public.employee_operating_actor_id()
    and coalesce(sa.active, true) = true
    and coalesce(sa.can_login, true) = true
  limit 1;
$function$;
create or replace function public.dawaa_current_points_cycle_label_v1()
returns text language sql stable as $$ select '2026-10' $$;

create or replace function public.dawaa_can_read_employee_transaction(p_staff_id uuid, p_branch text)
returns boolean language plpgsql security definer set search_path to 'public'
as $function$
declare v_role text; v_branch text; v_permissions jsonb;
begin
  select lower(trim(coalesce(sa.role,''))), sa.branch, (select permissions from public.account_permissions where account_id = sa.id)
    into v_role, v_branch, v_permissions
  from public.staff_accounts sa where sa.id = public.dawaa_current_staff_account_id_strict();
  if not found or coalesce((v_permissions->>'view_points')::boolean, false) is not true then return false; end if;
  if v_role in ('general_manager','executive_manager','branches_manager','admin') then return true; end if;
  if v_role in ('branch_manager','customer_service_manager') then return trim(p_branch) = trim(v_branch); end if;
  return false;
end;
$function$;

create or replace function public.dawaa_staff_points_truth_v2(p_staff_id uuid, p_month_cycle text default null)
returns table(staff_id uuid, staff_name text, staff_role text, branch text, tier_key text, month_cycle text, starting_points numeric, reward_points numeric, deduction_points numeric, net_points_delta numeric, final_points numeric, distinction_points numeric, target_points integer, point_rate_egp numeric, max_incentive_egp numeric, points_incentive_egp numeric, competition_bonus_egp numeric, final_incentive_egp numeric, progress_pct numeric, pending_reward_points numeric, pending_deduction_points numeric, profile_configured boolean)
language plpgsql stable security definer set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_staff public.staff%rowtype;
begin
  select * into v_staff from public.staff s where s.id = p_staff_id;
  if not found then
    return;
  end if;

  if not public.dawaa_can_read_employee_transaction(p_staff_id, v_staff.branch) then
    raise exception 'not_authorized';
  end if;

  return query select p_staff_id, v_staff.name, v_staff.role, v_staff.branch, null::text,
    coalesce(p_month_cycle, '2026-10'), 0::numeric, 10::numeric, 2::numeric, 8::numeric, 8::numeric, 0::numeric, 500,
    3::numeric, 1500::numeric, 24::numeric, 0::numeric, 24::numeric, 1.6::numeric, 0::numeric, 0::numeric, true;
end;
$function$;
revoke all on function public.dawaa_staff_points_truth_v2(uuid, text) from public, anon;

create or replace function public.get_doctor_pillar_breakdown(p_staff_id uuid, p_month_cycle text default null)
returns table(pillar_key text, points numeric, has_competition_win boolean)
language sql stable security definer set search_path to 'public', 'pg_catalog'
as $function$
  with scope as (
    select t.month_cycle, t.final_points
    from public.dawaa_staff_points_truth_v2(p_staff_id, p_month_cycle) t
  )
  select 'محادثات'::text, coalesce((select final_points from scope), 0)::numeric, false
$function$;
revoke all on function public.get_doctor_pillar_breakdown(uuid, text) from public, anon;
grant execute on function public.get_doctor_pillar_breakdown(uuid, text) to authenticated, service_role;

create or replace function public.dawaa_current_actor_can(required_permissions text[])
returns boolean language sql stable security definer set search_path to 'public'
as $$
  select coalesce((
    select bool_or(coalesce((p.permissions ->> k)::boolean, false))
    from public.account_permissions p, unnest(required_permissions) k
    where p.account_id = public.dawaa_current_staff_account_id_strict()
  ), false)
$$;

create or replace function public.hr_canonical_architecture_health_v1()
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_catalog'
as $function$
begin
  if not public.dawaa_current_actor_can(array['manage_hr','manage_payroll','manage_attendance']) then
    raise exception 'not_authorized_for_hr_architecture_health' using errcode='42501';
  end if;
  return jsonb_build_object('schema','hr_canonical_architecture_health_v1','status','healthy');
end;
$function$;
revoke all on function public.hr_canonical_architecture_health_v1() from public, anon;
grant execute on function public.hr_canonical_architecture_health_v1() to authenticated, service_role;

insert into public.staff (id, name, role, branch, active, is_active, status) values
  ('50000000-0000-4000-8000-000000000001', 'د/ أ', 'pharmacist', 'فرع شكري', true, true, 'active'),
  ('50000000-0000-4000-8000-000000000002', 'د/ ب', 'pharmacist', 'فرع الشامي', true, true, 'active'),
  ('50000000-0000-4000-8000-000000000003', 'د/ ج', 'pharmacist', 'فرع شكري', false, false, 'inactive');
insert into public.staff_accounts (id, staff_id, role, branch, active, can_login) values
  ('a0000000-0000-4000-8000-000000000001', null, 'general_manager', null, true, true),
  ('a0000000-0000-4000-8000-000000000002', null, 'branch_manager', 'فرع شكري', true, true),
  ('a0000000-0000-4000-8000-000000000003', null, 'pharmacist', 'فرع شكري', true, true),
  ('a0000000-0000-4000-8000-000000000004', null, 'branch_manager', null, true, true);
insert into public.account_permissions (account_id, permissions) values
  ('a0000000-0000-4000-8000-000000000001', '{"view_points": true, "manage_hr": true}'),
  ('a0000000-0000-4000-8000-000000000002', '{"view_points": true}'),
  ('a0000000-0000-4000-8000-000000000003', '{"view_points": true}'),
  ('a0000000-0000-4000-8000-000000000004', '{"view_points": true}');
