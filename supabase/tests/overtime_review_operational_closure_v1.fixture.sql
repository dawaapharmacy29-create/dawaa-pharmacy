-- Fixture for 20261016145000_overtime_review_operational_closure_v1 (applied together with 20261016150000).
-- decide_overtime_approval_v3, payroll_finalization_gate_current_v1, the payroll staff scope, the overtime multiplier,
-- the attendance deviation, the pay-cycle bounds, the fingerprint and the invalidation trigger are the exact Production
-- texts. Session identity, permissions, delivery classification and the two inner payroll gates are reduced stand-ins.
-- The session actor is the single row of public.test_actor.
create role anon;
create role authenticated;
create role service_role bypassrls;

create table public.test_actor (account_id uuid);
insert into public.test_actor values (null);
grant select, update on public.test_actor to anon, authenticated, service_role;
create table public.test_permissions (account_id uuid primary key, permissions jsonb);

create table public.staff (id uuid primary key, name text, branch text, role text, active boolean default true);
create table public.staff_accounts (
  id uuid primary key, staff_id text, username text, name text, role text, branch text,
  active boolean default true, is_active boolean, can_login boolean default true, updated_at timestamptz default now()
);
create table public.employee_compensation_profiles (
  id uuid primary key default gen_random_uuid(), staff_id text, active boolean default true, effective_from date,
  hourly_rate numeric, exempt_from_lateness_deduction boolean default false, updated_at timestamptz default now(),
  created_at timestamptz default now()
);
create table public.attendance_daily_summary (
  id uuid primary key, staff_id uuid, attendance_date date, branch text, first_in timestamptz, last_out timestamptz,
  total_hours numeric, late_minutes integer, early_leave_minutes integer, missing_punch boolean, status text, source text,
  created_at timestamptz default now(), updated_at timestamptz default now(), schedule_id uuid,
  scheduled_start_at timestamptz, scheduled_end_at timestamptz, candidate_hours numeric, payroll_eligible_hours numeric,
  resolution_status text, resolution_version integer, resolution_snapshot jsonb, approved_at timestamptz, approved_by text,
  approved_by_name text, approval_note text, resolution_origin text, review_required boolean, resolved_at timestamptz,
  time_off_request_id uuid, policy_version text, sync_complete_through timestamptz
);
create table public.staff_overtime_approvals (
  id uuid not null default gen_random_uuid() primary key, staff_id uuid not null, staff_name text, branch text,
  attendance_date date not null, overtime_hours numeric not null, hourly_rate numeric, overtime_amount numeric,
  status text not null default 'pending' check (status = any (array['pending','approved','rejected'])),
  decided_by text, decided_by_name text, decided_at timestamptz, decision_note text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  source_resolution_id uuid, source_resolution_fingerprint text, source_resolution_linked_at timestamptz,
  decision_evidence_snapshot jsonb, decision_evidence_version text,
  unique (staff_id, attendance_date)
);
create table public.payroll_finalized_snapshots_v2 (
  id uuid not null default gen_random_uuid() primary key, snapshot_id uuid not null unique, staff_id uuid not null,
  staff_username text not null, staff_name text not null, branch text, month_cycle text not null check (month_cycle ~ '^\d{4}-\d{2}$'),
  cycle_start date, cycle_end date, snapshot_fingerprint text not null, payload jsonb not null, finalized_by uuid not null,
  finalized_by_name text not null, finalized_at timestamptz not null default now(),
  state text not null default 'finalized' check (state = 'finalized'),
  unique (staff_id, month_cycle)
);
create table public.employee_transactions (
  id uuid primary key default gen_random_uuid(), staff_id uuid, month_cycle text, source text, points numeric
);

-- Reduced stand-ins.
create or replace function public.dawaa_current_staff_account_id_strict() returns uuid
language sql stable security definer set search_path to 'public', 'pg_catalog'
as $$ select account_id from public.test_actor limit 1 $$;
create or replace function public.get_user_permissions(p_user_id uuid) returns jsonb
language sql stable security definer set search_path to 'public', 'pg_catalog'
as $$ select coalesce((select permissions from public.test_permissions where account_id = p_user_id), '{}'::jsonb) $$;
create or replace function public.dawaa_current_actor_can(required_permissions text[]) returns boolean
language sql stable security definer set search_path to 'public', 'pg_catalog'
as $$
  select coalesce((
    select lower(sa.role) in ('general_manager','admin')
        or exists (select 1 from unnest(required_permissions) p where coalesce((public.get_user_permissions(sa.id)->>p)::boolean,false))
    from public.staff_accounts sa
    where sa.id = public.dawaa_current_staff_account_id_strict() and coalesce(sa.active,false) and coalesce(sa.can_login,false)), false)
$$;
-- Production body of dawaa_can_manage_payroll_staff_v1 (scope by the target account's branch).
create or replace function public.dawaa_can_manage_payroll_staff_v1(p_staff_username text) returns boolean
language plpgsql stable security definer set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor_id uuid;
  v_actor_role text;
  v_actor_branch text;
  v_target_branch text;
  v_permissions jsonb;
begin
  v_actor_id := public.dawaa_current_staff_account_id_strict();
  if v_actor_id is null then
    return false;
  end if;
  select lower(trim(coalesce(role,''))), nullif(trim(coalesce(branch,'')), '')
  into v_actor_role, v_actor_branch
  from public.staff_accounts
  where id = v_actor_id and coalesce(active,false) and coalesce(can_login,false)
  limit 1;
  if v_actor_role is null then
    return false;
  end if;
  v_permissions := public.get_user_permissions(v_actor_id);
  if coalesce((v_permissions->>'manage_payroll')::boolean, false) is not true then
    return false;
  end if;
  if v_actor_role in ('general_manager','executive_manager','branches_manager','admin','manager') then
    return true;
  end if;
  if v_actor_role <> 'branch_manager' then
    return false;
  end if;
  select nullif(trim(coalesce(branch,'')), '') into v_target_branch
  from public.staff_accounts
  where lower(trim(username)) = lower(trim(coalesce(p_staff_username,'')))
  order by coalesce(active,false) desc, updated_at desc nulls last
  limit 1;
  return v_target_branch is not null and v_actor_branch is not null and v_target_branch = v_actor_branch;
end;
$function$;
create or replace function public.dawaa_staff_uses_delivery_finance_v1(p_staff_id uuid) returns boolean
language sql stable security definer set search_path to 'public', 'pg_catalog'
as $$ select coalesce((select s.role ilike '%توصيل%' from public.staff s where s.id = p_staff_id), false) $$;
create or replace function public.dawaa_delivery_payroll_classification_v1(p_staff_id uuid, p_month_cycle text) returns jsonb
language sql stable security definer set search_path to 'public', 'pg_catalog'
as $$ select jsonb_build_object('payroll_eligible', public.dawaa_staff_uses_delivery_finance_v1(p_staff_id)) $$;
create or replace function public.payroll_finalization_gate_v1(p_staff_id uuid, p_month_cycle text) returns jsonb
language sql stable security definer set search_path to 'public', 'pg_catalog'
as $$ select jsonb_build_object('ready', true, 'staff_id', p_staff_id, 'month_cycle', p_month_cycle, 'blockers', '[]'::jsonb, 'warnings', '[]'::jsonb) $$;
create or replace function public.payroll_finalization_gate_v2(p_staff_id uuid, p_month_cycle text) returns jsonb
language sql stable security definer set search_path to 'public', 'pg_catalog'
as $$ select jsonb_build_object('ready', true, 'staff_id', p_staff_id, 'month_cycle', p_month_cycle, 'blockers', '[]'::jsonb, 'warnings', '[]'::jsonb) $$;

\ir overtime_approval_freshness_v1.prod.sql
\ir overtime_review_operational_closure_v1.prod.sql

create trigger trg_hr_invalidate_overtime_on_attendance_change_v1 after update of status, schedule_id, scheduled_start_at, scheduled_end_at, first_in, last_out, candidate_hours, payroll_eligible_hours, late_minutes, early_leave_minutes, resolution_status, time_off_request_id on public.attendance_daily_summary for each row execute function hr_invalidate_overtime_on_attendance_change_v1();

-- Production grants (2026-10-16).
revoke all on function public.decide_overtime_approval_v3(uuid,text,text) from public, anon;
grant execute on function public.decide_overtime_approval_v3(uuid,text,text) to authenticated, service_role;
revoke all on function public.payroll_finalization_gate_current_v1(uuid,text) from public;
grant execute on function public.payroll_finalization_gate_current_v1(uuid,text) to anon, authenticated, service_role;
revoke all on function public.dawaa_can_manage_payroll_staff_id_v1(uuid) from public, anon, authenticated;
grant execute on function public.dawaa_can_manage_payroll_staff_id_v1(uuid) to service_role;

-- Staff: A (شكري, standard), B (الشامي, standard), H (شكري, delivery, no compensation profile), F (شكري, fresh only).
insert into public.staff values
  ('00000000-0000-4000-8000-0000000000a1', 'A', 'فرع شكري', 'صيدلي', true),
  ('00000000-0000-4000-8000-0000000000b1', 'B', 'فرع الشامي', 'صيدلي', true),
  ('00000000-0000-4000-8000-0000000000c1', 'H', 'فرع شكري', 'توصيل', true),
  ('00000000-0000-4000-8000-0000000000f1', 'F', 'فرع شكري', 'صيدلي', true);
insert into public.staff_accounts (id, staff_id, username, name, role, branch) values
  ('00000000-0000-4000-8000-000000000001', null, 'gm', 'المدير العام', 'general_manager', null),
  ('00000000-0000-4000-8000-000000000002', null, 'bm_shukri', 'مدير شكري', 'branch_manager', 'فرع شكري'),
  ('00000000-0000-4000-8000-000000000003', null, 'bm_shami', 'مدير الشامي', 'branch_manager', 'فرع الشامي'),
  ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000a1', 'a', 'A', 'pharmacist', 'فرع شكري'),
  ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-0000000000b1', 'b', 'B', 'pharmacist', 'فرع الشامي'),
  ('00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-0000000000c1', 'h', 'H', 'delivery', 'فرع شكري'),
  ('00000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-0000000000f1', 'f', 'F', 'pharmacist', 'فرع شكري');
insert into public.test_permissions values
  ('00000000-0000-4000-8000-000000000001', '{"manage_payroll": true}'),
  ('00000000-0000-4000-8000-000000000002', '{"manage_payroll": true}'),
  ('00000000-0000-4000-8000-000000000003', '{"manage_payroll": true}'),
  ('00000000-0000-4000-8000-000000000004', '{"view_attendance": true}');
insert into public.employee_compensation_profiles (staff_id, hourly_rate) values
  ('00000000-0000-4000-8000-0000000000a1', 650), ('00000000-0000-4000-8000-0000000000b1', 559), ('00000000-0000-4000-8000-0000000000f1', 650);

insert into public.attendance_daily_summary (id, staff_id, attendance_date, branch, first_in, last_out, late_minutes, early_leave_minutes, status, scheduled_start_at, scheduled_end_at, candidate_hours, payroll_eligible_hours, resolution_status, resolution_version, policy_version) values
  ('00000000-0000-4000-8000-0000000a1001', '00000000-0000-4000-8000-0000000000a1', '2026-10-01', 'فرع شكري', '2026-10-01 06:00+00', '2026-10-01 16:00+00', 0, 0, 'approved', '2026-10-01 06:00+00', '2026-10-01 15:00+00', 10, 9, 'on_time', 2, 'attendance_policy_v1'),
  ('00000000-0000-4000-8000-0000000a1002', '00000000-0000-4000-8000-0000000000a1', '2026-10-02', 'فرع شكري', '2026-10-02 06:00+00', '2026-10-02 16:00+00', 0, 0, 'approved', '2026-10-02 06:00+00', '2026-10-02 15:00+00', 10, 9, 'on_time', 2, 'attendance_policy_v1'),
  ('00000000-0000-4000-8000-0000000a1006', '00000000-0000-4000-8000-0000000000a1', '2026-10-06', 'فرع شكري', '2026-10-06 06:00+00', '2026-10-06 16:00+00', 0, 0, 'pending_review', '2026-10-06 06:00+00', '2026-10-06 15:00+00', 10, null, 'pending', 2, 'attendance_policy_v1'),
  ('00000000-0000-4000-8000-0000000b0925', '00000000-0000-4000-8000-0000000000b1', '2026-09-25', 'فرع الشامي', '2026-09-25 06:00+00', '2026-09-25 16:00+00', 0, 0, 'approved', '2026-09-25 06:00+00', '2026-09-25 15:00+00', 10, 9, 'on_time', 2, 'attendance_policy_v1'),
  ('00000000-0000-4000-8000-0000000b1003', '00000000-0000-4000-8000-0000000000b1', '2026-10-03', 'فرع الشامي', '2026-10-03 06:00+00', '2026-10-03 17:00+00', 0, 0, 'approved', '2026-10-03 06:00+00', '2026-10-03 15:00+00', 11, 9, 'on_time', 2, 'attendance_policy_v1'),
  ('00000000-0000-4000-8000-0000000b1007', '00000000-0000-4000-8000-0000000000b1', '2026-10-07', 'فرع الشامي', '2026-10-07 06:00+00', '2026-10-07 16:00+00', 0, 0, 'approved', '2026-10-07 06:00+00', '2026-10-07 15:00+00', 10, 9, 'on_time', 2, 'attendance_policy_v1'),
  ('00000000-0000-4000-8000-0000000c1004', '00000000-0000-4000-8000-0000000000c1', '2026-10-04', 'فرع شكري', '2026-10-04 06:00+00', '2026-10-04 17:24+00', 0, 0, 'approved', '2026-10-04 06:00+00', '2026-10-04 17:00+00', 11.4, 11, 'manager_approved_actual_hours', 2, 'attendance_policy_v1'),
  ('00000000-0000-4000-8000-0000000f1005', '00000000-0000-4000-8000-0000000000f1', '2026-10-05', 'فرع شكري', '2026-10-05 06:00+00', '2026-10-05 16:00+00', 0, 0, 'approved', '2026-10-05 06:00+00', '2026-10-05 15:00+00', 10, 9, 'on_time', 2, 'attendance_policy_v1');

insert into public.staff_overtime_approvals (id, staff_id, staff_name, branch, attendance_date, overtime_hours, hourly_rate, overtime_amount, status, decided_by, decided_by_name, decided_at, decision_note, source_resolution_id, source_resolution_fingerprint, decision_evidence_snapshot, decision_evidence_version) values
  -- A: diverged fingerprint (stale)
  ('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000000a1', 'A', 'فرع شكري', '2026-10-01', 1.0, 25, 37.5, 'approved', 'system:manager-decision', 'قرار المدير العام', '2026-10-02', 'اعتماد ساعة ×1.5', '00000000-0000-4000-8000-0000000a1001', 'fingerprint-of-an-earlier-truth', null, null),
  -- A: pending, linked with a fresh fingerprint (set below)
  ('00000000-0000-4000-8000-00000000a002', '00000000-0000-4000-8000-0000000000a1', 'A', 'فرع شكري', '2026-10-02', 1.0, 25, 37.5, 'pending', null, null, null, null, '00000000-0000-4000-8000-0000000a1002', null, null, null),
  -- A: approved while the attendance day is not approved (stale)
  ('00000000-0000-4000-8000-00000000a006', '00000000-0000-4000-8000-0000000000a1', 'A', 'فرع شكري', '2026-10-06', 0.5, 25, 18.75, 'approved', 'general_manager', 'قرار الإدارة', '2026-10-07', 'اعتماد نصف ساعة', '00000000-0000-4000-8000-0000000a1006', null, null, 'manual_v1'),
  -- B: no fingerprint, linked (stale); previous-cycle stale (2026-09-25); fresh approval without stored amount
  ('00000000-0000-4000-8000-00000000b003', '00000000-0000-4000-8000-0000000000b1', 'B', 'فرع الشامي', '2026-10-03', 2.0, 21.5, 64.5, 'approved', 'manager', 'الإدارة', '2026-10-04', 'اعتماد ساعتين', '00000000-0000-4000-8000-0000000b1003', null, '{"multiplier": 1.5}', 'manager_manual_v1'),
  ('00000000-0000-4000-8000-00000000b925', '00000000-0000-4000-8000-0000000000b1', 'B', 'فرع الشامي', '2026-09-25', 1.0, 21.5, 32.25, 'approved', null, 'قرار المدير العام', '2026-09-26', null, null, null, null, null),
  ('00000000-0000-4000-8000-00000000b007', '00000000-0000-4000-8000-0000000000b1', 'B', 'فرع الشامي', '2026-10-07', 1.0, null, null, 'approved', null, 'قرار المدير العام', '2026-10-08', null, '00000000-0000-4000-8000-0000000b1007', null, null, null),
  -- H (delivery): no fingerprint, no amount, multiplier 1.5 in the evidence (stale)
  ('00000000-0000-4000-8000-00000000c004', '00000000-0000-4000-8000-0000000000c1', 'H', 'فرع شكري', '2026-10-04', 0.4, null, null, 'approved', 'system:manager-decision', 'اعتماد المدير المباشر', '2026-10-11', 'اعتماد 24 دقيقة', '00000000-0000-4000-8000-0000000c1004', null, '{"multiplier": 1.5, "rate_status": "missing"}', 'attendance_overtime_decision_v1'),
  -- F: fresh approval (fingerprint set below)
  ('00000000-0000-4000-8000-00000000f005', '00000000-0000-4000-8000-0000000000f1', 'F', 'فرع شكري', '2026-10-05', 1.0, 25, 37.5, 'approved', null, 'قرار المدير العام', '2026-10-06', null, '00000000-0000-4000-8000-0000000f1005', null, null, null);
update public.staff_overtime_approvals o set source_resolution_fingerprint = public.attendance_resolution_fingerprint_v2(o.source_resolution_id)
where o.id in ('00000000-0000-4000-8000-00000000a002', '00000000-0000-4000-8000-00000000b007', '00000000-0000-4000-8000-00000000f005');

create table public.test_before_rows as
select md5(string_agg(o::text, '|' order by o.id)) rows_md5 from public.staff_overtime_approvals o;
