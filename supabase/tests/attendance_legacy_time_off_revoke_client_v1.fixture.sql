-- Fixture for 20261016140000_attendance_legacy_time_off_revoke_client_v1.
-- The seven legacy APIs and the current reader list_staff_time_off_requests_v1 are the exact Production texts
-- (attendance_legacy_time_off_revoke_client_v1.prod.sql) with their Production grants. Identity/authorization helpers
-- used by them are the Production bodies where the legacy APIs depend on them; the current reader's scope helpers are
-- reduced stand-ins (only their unchanged behaviour before/after the revoke is under test). The session actor is the
-- single row of public.test_actor.
create role anon;
create role authenticated;
create role service_role bypassrls;

create table public.test_actor (account_id uuid);
insert into public.test_actor values (null);
grant select, update on public.test_actor to anon, authenticated, service_role;

create table public.staff (id uuid primary key, name text, branch text, active boolean default true);
create table public.staff_accounts (
  id uuid primary key, staff_id text, name text, role text, branch text,
  active boolean default true, is_active boolean, can_login boolean default true
);
create table public.staff_time_off_requests (
  id uuid primary key default gen_random_uuid(), staff_id uuid, staff_name_snapshot text, branch_snapshot text,
  request_kind text, request_label text, status text, start_date date, end_date date, start_time time, end_time time,
  reason text, requested_by text, requested_at timestamptz default now(), policy_version text, source text,
  metadata jsonb default '{}'::jsonb, decided_by text, decided_by_name text, decided_at timestamptz, decision_note text,
  cancelled_by text, cancelled_at timestamptz, cancellation_reason text,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

insert into public.staff values
  ('00000000-0000-4000-8000-0000000000a1', 'موظف شكري', 'فرع شكري', true),
  ('00000000-0000-4000-8000-0000000000b1', 'موظف الشامي', 'فرع الشامي', true);
insert into public.staff_accounts (id, staff_id, name, role, branch) values
  ('00000000-0000-4000-8000-000000000001', null, 'المدير العام', 'general_manager', null),
  ('00000000-0000-4000-8000-000000000002', null, 'مدير شكري', 'branch_manager', 'فرع شكري'),
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000a1', 'موظف شكري', 'pharmacist', 'فرع شكري'),
  ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000b1', 'موظف الشامي', 'pharmacist', 'فرع الشامي');

-- Requests from every flow Production holds, plus legacy two-stage rows still in a pending legacy status.
insert into public.staff_time_off_requests (id, staff_id, staff_name_snapshot, branch_snapshot, request_kind, request_label, status, start_date, end_date, policy_version, source, created_at) values
  ('00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-0000000000a1', 'موظف شكري', 'فرع شكري', 'annual_leave', 'إجازة سنوية', 'approved', '2026-10-05', '2026-10-05', 'attendance_timeoff_v1', 'app', '2026-10-01'),
  ('00000000-0000-4000-8000-00000000c002', '00000000-0000-4000-8000-0000000000a1', 'موظف شكري', 'فرع شكري', 'permission', 'إذن', 'pending_branch_review', '2026-10-20', '2026-10-20', 'two_stage_v1', 'self_service', '2026-10-02'),
  ('00000000-0000-4000-8000-00000000c003', '00000000-0000-4000-8000-0000000000b1', 'موظف الشامي', 'فرع الشامي', 'sick_leave', 'إجازة مرضية', 'pending_gm_review', '2026-10-21', '2026-10-22', 'two_stage_v1', 'self_service', '2026-10-03'),
  ('00000000-0000-4000-8000-00000000c004', '00000000-0000-4000-8000-0000000000b1', 'موظف الشامي', 'فرع الشامي', 'annual_leave', 'إجازة سنوية', 'cancelled', '2026-09-06', '2026-09-06', 'legacy_import_v1', 'legacy', '2026-09-01');

create or replace function public.dawaa_current_staff_account_id_strict() returns uuid
language sql stable security definer set search_path to 'public', 'pg_catalog'
as $$ select account_id from public.test_actor limit 1 $$;

-- Production bodies (2026-10-16).
create or replace function public.dawaa_current_attendance_subject_id() returns uuid
language plpgsql stable security definer set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_account_id uuid;
  v_staff_id text;
begin
  v_account_id := public.dawaa_current_staff_account_id_strict();
  if v_account_id is null then
    return null;
  end if;

  select nullif(trim(sa.staff_id), '')
    into v_staff_id
  from public.staff_accounts sa
  where sa.id = v_account_id
    and coalesce(sa.active, true) = true
    and coalesce(sa.can_login, true) = true;

  if v_staff_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return v_staff_id::uuid;
  end if;

  return v_account_id;
end;
$function$;

create or replace function public.dawaa_can_read_staff_attendance_log(p_staff_id uuid, p_branch text) returns boolean
language plpgsql stable security definer set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_account_id uuid;
  v_subject_id uuid;
  v_role text;
  v_branch text;
begin
  v_account_id := public.dawaa_current_staff_account_id_strict();
  if v_account_id is null then return false; end if;

  select lower(trim(sa.role)), trim(coalesce(sa.branch,''))
    into v_role, v_branch
  from public.staff_accounts sa
  where sa.id=v_account_id and sa.active=true and sa.can_login=true;

  if v_role is null then return false; end if;
  v_subject_id := public.dawaa_current_attendance_subject_id();

  if v_role in ('general_manager','executive_manager','branches_manager','admin') then
    return true;
  end if;

  if p_staff_id is not null and v_subject_id is not null and p_staff_id=v_subject_id then
    return true;
  end if;

  if v_role in ('branch_manager','shift_supervisor_morning','shift_supervisor_evening') then
    return nullif(v_branch,'') is not null and trim(coalesce(p_branch,''))=v_branch;
  end if;

  return false;
end;
$function$;

create or replace function public.dawaa_can_manage_biometric_mapping_v1() returns boolean
language sql stable security definer set search_path to 'public', 'pg_catalog'
as $function$
  select exists (
    select 1
    from public.staff_accounts a
    where a.id = public.dawaa_current_staff_account_id_strict()
      and coalesce(a.active, a.is_active, true) = true
      and coalesce(a.can_login, true) = true
      and a.role in ('general_manager','executive_manager','branches_manager')
  );
$function$;

-- Reduced stand-ins for the current reader's scope helpers.
create or replace function public.test_actor_role() returns text
language sql stable security definer set search_path to 'public', 'pg_catalog'
as $$ select lower(sa.role) from public.staff_accounts sa where sa.id = public.dawaa_current_staff_account_id_strict() $$;
create or replace function public.dawaa_current_staff_subject_uuid_v1() returns uuid
language sql stable security definer set search_path to 'public', 'pg_catalog'
as $$ select public.dawaa_current_attendance_subject_id() $$;
create or replace function public.dawaa_time_off_scope_all_v1() returns boolean
language sql stable security definer set search_path to 'public', 'pg_catalog'
as $$ select coalesce(public.test_actor_role() in ('general_manager','executive_manager','branches_manager','admin'), false) $$;
create or replace function public.employee_operating_actor_branch() returns text
language sql stable security definer set search_path to 'public', 'pg_catalog'
as $$ select sa.branch from public.staff_accounts sa where sa.id = public.dawaa_current_staff_account_id_strict() $$;
create or replace function public.dawaa_current_actor_can(p_permissions text[]) returns boolean
language sql stable security definer set search_path to 'public', 'pg_catalog'
as $$ select coalesce(public.test_actor_role() = 'branch_manager', false) $$;
create or replace function public.dawaa_time_off_can_access_staff_v1(p_staff_id uuid) returns boolean
language sql stable security definer set search_path to 'public', 'pg_catalog'
as $$ select public.dawaa_time_off_scope_all_v1() or p_staff_id = public.dawaa_current_attendance_subject_id()
  or (public.dawaa_current_actor_can(array['manage_time_off']) and exists (
    select 1 from public.staff s where s.id = p_staff_id and s.branch = public.employee_operating_actor_branch())) $$;

\ir attendance_legacy_time_off_revoke_client_v1.prod.sql

-- Production grants (2026-10-16).
grant execute on function public.attendance_request_time_off_v1(text,date,date,time without time zone,time without time zone,text) to public, anon, authenticated, service_role;
grant execute on function public.attendance_branch_review_time_off_v1(uuid,text,text) to public, anon, authenticated, service_role;
grant execute on function public.attendance_gm_review_time_off_v1(uuid,text,text) to public, anon, authenticated, service_role;
grant execute on function public.attendance_branch_time_off_queue_v1() to public, anon, authenticated, service_role;
grant execute on function public.attendance_gm_time_off_queue_v1() to public, anon, authenticated, service_role;
grant execute on function public.attendance_my_time_off_requests_v1() to public, anon, authenticated, service_role;
grant execute on function public.attendance_cancel_time_off_request_v1(uuid) to public, anon, authenticated, service_role;
revoke execute on function public.list_staff_time_off_requests_v1(uuid,date,date,text,integer) from public;
grant execute on function public.list_staff_time_off_requests_v1(uuid,date,date,text,integer) to anon, authenticated, service_role;

-- attendance_unified_approval_decide_v1 (Production signature, SECURITY DEFINER), reduced to its time-off branches:
-- the internal caller that must keep working after the client revoke.
create or replace function public.attendance_unified_approval_decide_v1(p_item_type text, p_item_id uuid, p_decision text, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_catalog'
as $function$
begin
  if p_item_type = 'timeoff_branch' then
    return public.attendance_branch_review_time_off_v1(p_item_id, p_decision, p_note);
  elsif p_item_type = 'timeoff_gm' then
    return public.attendance_gm_review_time_off_v1(p_item_id, p_decision, p_note);
  else
    raise exception using errcode='22023', message='نوع عنصر غير معروف';
  end if;
end;
$function$;
grant execute on function public.attendance_unified_approval_decide_v1(text,uuid,text,text) to public, anon, authenticated, service_role;

-- Before-state captured for the test: definitions, the current reader's results per actor, and every row.
create table public.test_before_defs as
select p.proname::text, md5(pg_get_functiondef(p.oid)) def_md5 from pg_proc p
where p.proname in ('attendance_request_time_off_v1','attendance_branch_review_time_off_v1','attendance_gm_review_time_off_v1',
  'attendance_branch_time_off_queue_v1','attendance_gm_time_off_queue_v1','attendance_my_time_off_requests_v1',
  'attendance_cancel_time_off_request_v1','list_staff_time_off_requests_v1');

create table public.test_before_rows as
select md5(string_agg(r::text, '|' order by r.id)) rows_md5 from public.staff_time_off_requests r;

create table public.test_before_list (actor uuid, ids text);
do $$
declare v_actor uuid;
begin
  foreach v_actor in array array['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004']::uuid[] loop
    update public.test_actor set account_id = v_actor;
    insert into public.test_before_list
    select v_actor, string_agg(l.id::text, ',' order by l.id) from public.list_staff_time_off_requests_v1() l;
  end loop;
  update public.test_actor set account_id = null;
end;
$$;
