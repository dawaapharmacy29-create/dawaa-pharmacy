-- Fixture for 20261015140000_rls_actor_scope_initplan_v1: Production row-level helpers and the policies
-- they back, so the test can prove the new initplan policies return exactly the rows the old helpers allow.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;

create table public.staff_accounts (
  id uuid primary key,
  staff_id text,
  username text,
  role text,
  branch text,
  active boolean,
  can_login boolean,
  auth_user_id uuid,
  created_at timestamptz default now(),
  updated_at timestamptz
);
create table public.user_profiles (auth_user_id uuid, staff_account_id uuid, role text, active boolean, permissions jsonb);
create table public.account_permissions (account_id uuid primary key, permissions jsonb not null);

-- Verified session stand-in: the test selects the actor through a GUC instead of a session token.
create or replace function public.dawaa_current_staff_account_id_strict()
returns uuid language sql stable security definer set search_path to 'public'
as $$ select nullif(current_setting('test.account_id', true), '')::uuid $$;

create or replace function public.get_user_permissions(p_account_id uuid)
returns jsonb language sql stable security definer set search_path to 'public'
as $$ select coalesce((select permissions from public.account_permissions where account_id = p_account_id), '{}'::jsonb) $$;

create or replace function public.dawaa_jsonb_has_true_any(p_permissions jsonb, p_keys text[])
returns boolean language sql immutable
as $function$
  select coalesce(bool_or(coalesce((p_permissions ->> k)::boolean, false)), false)
  from unnest(coalesce(p_keys, '{}'::text[])) as k
  where p_permissions ? k;
$function$;

-- Production definitions (2026-10-15) of the helpers the policies used.
create or replace function public.dawaa_current_actor_can(required_permissions text[])
returns boolean language plpgsql stable security definer set search_path to 'public', 'auth', 'pg_temp'
as $function$
declare
  v_staff_id uuid; v_role text; v_permissions jsonb; v_profile_role text; v_profile_active boolean; v_profile_permissions jsonb;
begin
  v_staff_id := public.dawaa_current_staff_account_id_strict();
  if v_staff_id is not null then
    select sa.role, public.get_user_permissions(sa.id) into v_role, v_permissions
    from public.staff_accounts sa
    where sa.id = v_staff_id and coalesce(sa.active,false) and coalesce(sa.can_login,false)
    limit 1;
    if found then
      if lower(trim(coalesce(v_role,''))) in ('general_manager','admin') then return true; end if;
      return public.dawaa_jsonb_has_true_any(coalesce(v_permissions,'{}'::jsonb), required_permissions);
    end if;
  end if;
  select lower(trim(coalesce(up.role,''))), coalesce(up.active,true), coalesce(up.permissions,'{}'::jsonb)
    into v_profile_role, v_profile_active, v_profile_permissions
  from public.user_profiles up
  where auth.uid() is not null and up.auth_user_id = auth.uid() and up.staff_account_id is null
  limit 1;
  if not found or not v_profile_active then return false; end if;
  if v_profile_role in ('مدير عام','أدمن','admin','general_manager','مدير') then return true; end if;
  return public.dawaa_jsonb_has_true_any(v_profile_permissions, required_permissions);
end;
$function$;

create or replace function public.dawaa_can_read_employee_transaction(p_staff_id uuid, p_branch text)
returns boolean language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_account_id uuid; v_role text; v_branch text; v_staff_id text; v_permissions jsonb;
begin
  v_account_id := public.dawaa_current_staff_account_id_strict();
  if v_account_id is null then return false; end if;
  select lower(trim(coalesce(sa.role,''))), sa.branch, sa.staff_id, public.get_user_permissions(sa.id)
    into v_role, v_branch, v_staff_id, v_permissions
  from public.staff_accounts sa
  where sa.id = v_account_id and coalesce(sa.active,false) and coalesce(sa.can_login,false)
  limit 1;
  if not found then return false; end if;
  if not public.dawaa_jsonb_has_true_any(coalesce(v_permissions,'{}'::jsonb), array['view_points']) then return false; end if;
  if v_role in ('general_manager','executive_manager','branches_manager','admin') then return true; end if;
  if v_role = 'pharmacist' then
    return p_staff_id is not null and nullif(trim(coalesce(v_staff_id,'')),'') is not null and p_staff_id::text = trim(v_staff_id);
  end if;
  if v_role in ('branch_manager','customer_service_manager','customer_service','shift_supervisor_morning','shift_supervisor_evening') then
    return p_branch is not null and v_branch is not null and trim(p_branch) = trim(v_branch);
  end if;
  return false;
end;
$function$;

create or replace function public.dawaa_current_attendance_subject_id()
returns uuid language plpgsql stable security definer set search_path to 'public', 'pg_catalog'
as $function$
declare v_account_id uuid; v_staff_id text;
begin
  v_account_id := public.dawaa_current_staff_account_id_strict();
  if v_account_id is null then return null; end if;
  select nullif(trim(sa.staff_id), '') into v_staff_id
  from public.staff_accounts sa
  where sa.id = v_account_id and coalesce(sa.active, true) = true and coalesce(sa.can_login, true) = true;
  if v_staff_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return v_staff_id::uuid;
  end if;
  return v_account_id;
end;
$function$;

create or replace function public.dawaa_can_read_staff_attendance_log(p_staff_id uuid, p_branch text)
returns boolean language plpgsql stable security definer set search_path to 'public', 'pg_catalog'
as $function$
declare v_account_id uuid; v_subject_id uuid; v_role text; v_branch text;
begin
  v_account_id := public.dawaa_current_staff_account_id_strict();
  if v_account_id is null then return false; end if;
  select lower(trim(sa.role)), trim(coalesce(sa.branch,'')) into v_role, v_branch
  from public.staff_accounts sa
  where sa.id=v_account_id and sa.active=true and sa.can_login=true;
  if v_role is null then return false; end if;
  v_subject_id := public.dawaa_current_attendance_subject_id();
  if v_role in ('general_manager','executive_manager','branches_manager','admin') then return true; end if;
  if p_staff_id is not null and v_subject_id is not null and p_staff_id=v_subject_id then return true; end if;
  if v_role in ('branch_manager','shift_supervisor_morning','shift_supervisor_evening') then
    return nullif(v_branch,'') is not null and trim(coalesce(p_branch,''))=v_branch;
  end if;
  return false;
end;
$function$;

create or replace function public.dawaa_customer_request_branch_key(p_branch text)
returns text language sql immutable set search_path to 'public', 'pg_catalog'
as $function$
  select case
    when lower(trim(coalesce(p_branch,''))) in ('فرع شكري','شكري','shokry','shoukry') then 'shokry'
    when lower(trim(coalesce(p_branch,''))) in ('فرع الشامي','الشامي','الشامى','elshamy','el-shamy','alshamy') then 'elshamy'
    when trim(coalesce(p_branch,'')) = '' then null
    else lower(trim(p_branch))
  end
$function$;

create or replace function public.dawaa_can_read_conversation_review_row_v2(p_actor_id uuid, p_staff_id uuid, p_doctor_id uuid, p_branch text, p_reviewer_id uuid)
returns boolean language sql stable security definer set search_path to 'public', 'pg_catalog'
as $function$
  with me as (
    select sa.* from public.staff_accounts sa
    where sa.id = p_actor_id and coalesce(sa.active,false) and coalesce(sa.can_login,false)
    limit 1
  )
  select exists (
    select 1 from me
    where lower(trim(coalesce(me.role,''))) in ('general_manager','executive_manager','branches_manager','admin','team_dawaa_alpha')
      or me.id = p_reviewer_id
      or me.staff_id = p_staff_id::text
      or me.staff_id = p_doctor_id::text
      or (
        lower(trim(coalesce(me.role,''))) in ('branch_manager','customer_service_manager','customer_service','shift_supervisor_morning','shift_supervisor_evening')
        and public.dawaa_customer_request_branch_key(me.branch) is not null
        and public.dawaa_customer_request_branch_key(me.branch)=public.dawaa_customer_request_branch_key(p_branch)
      )
  )
$function$;

create table public.employee_transactions (id integer primary key, staff_id uuid, branch text, source text, type text);
create table public.staff_attendance_logs (id integer primary key, staff_id uuid, branch_name text);
create table public.conversation_sales_reviews (id integer primary key, is_current boolean, staff_id uuid, doctor_id uuid, branch text, reviewer_id uuid);
create table public.activity_log (id integer primary key, action text);

alter table public.employee_transactions enable row level security;
alter table public.staff_attendance_logs enable row level security;
alter table public.conversation_sales_reviews enable row level security;
alter table public.activity_log enable row level security;
grant select on public.employee_transactions, public.staff_attendance_logs, public.conversation_sales_reviews, public.activity_log to anon, authenticated;

-- Production policies before the migration.
create policy employee_transactions_select_scoped_actor on public.employee_transactions
  for select to anon, authenticated using (public.dawaa_can_read_employee_transaction(staff_id, branch));
create policy staff_attendance_logs_select_scoped on public.staff_attendance_logs
  for select using (public.dawaa_can_read_staff_attendance_log(staff_id, branch_name));
create policy conversation_sales_reviews_select_canonical on public.conversation_sales_reviews
  for select using (
    is_current = true
    and (select public.dawaa_current_actor_can(array['view_reviews']))
    and public.dawaa_can_read_conversation_review_row_v2((select public.dawaa_current_staff_account_id_strict()), staff_id, doctor_id, branch, reviewer_id)
  );
create policy activity_log_select_authorized on public.activity_log
  for select using (public.dawaa_current_actor_can(array['view_activity_log','view_activity_logs']));

-- Oracles: the row sets the previous helpers allow for the current actor (owner bypasses RLS).
create function public.test_oracle_employee_transactions() returns int[] language sql stable security definer set search_path to 'public'
as $$ select coalesce(array_agg(id order by id), '{}') from public.employee_transactions where public.dawaa_can_read_employee_transaction(staff_id, branch) $$;
create function public.test_oracle_staff_attendance_logs() returns int[] language sql stable security definer set search_path to 'public'
as $$ select coalesce(array_agg(id order by id), '{}') from public.staff_attendance_logs where public.dawaa_can_read_staff_attendance_log(staff_id, branch_name) $$;
create function public.test_oracle_conversation_sales_reviews() returns int[] language sql stable security definer set search_path to 'public'
as $$ select coalesce(array_agg(id order by id), '{}') from public.conversation_sales_reviews
      where is_current = true and public.dawaa_current_actor_can(array['view_reviews'])
        and public.dawaa_can_read_conversation_review_row_v2(public.dawaa_current_staff_account_id_strict(), staff_id, doctor_id, branch, reviewer_id) $$;
create function public.test_oracle_activity_log() returns int[] language sql stable security definer set search_path to 'public'
as $$ select coalesce(array_agg(id order by id), '{}') from public.activity_log where public.dawaa_current_actor_can(array['view_activity_log','view_activity_logs']) $$;
grant execute on all functions in schema public to anon, authenticated;

-- Actors (staff ids are uuids; one non-uuid staff id exercises the attendance subject fallback).
insert into public.staff_accounts (id, staff_id, role, branch, active, can_login) values
  ('a0000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'admin', null, true, true),
  ('a0000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000002', 'pharmacist', 'فرع شكري', true, true),
  ('a0000000-0000-4000-8000-000000000003', '  ', 'pharmacist', 'فرع شكري', true, true),
  ('a0000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000004', 'branch_manager', ' فرع شكري ', true, true),
  ('a0000000-0000-4000-8000-000000000005', '50000000-0000-4000-8000-000000000005', 'Branch_Manager', 'فرع الشامي', true, true),
  ('a0000000-0000-4000-8000-000000000006', '50000000-0000-4000-8000-000000000006', 'customer_service', 'شكري', true, true),
  ('a0000000-0000-4000-8000-000000000007', '50000000-0000-4000-8000-000000000007', 'shift_supervisor_morning', null, true, true),
  ('a0000000-0000-4000-8000-000000000008', '50000000-0000-4000-8000-000000000008', 'delivery', 'فرع شكري', true, true),
  ('a0000000-0000-4000-8000-000000000009', '50000000-0000-4000-8000-000000000009', 'general_manager', null, false, true),
  ('a0000000-0000-4000-8000-000000000010', '50000000-0000-4000-8000-000000000010', 'branches_manager', null, true, false),
  ('a0000000-0000-4000-8000-000000000011', 'legacy-text-id', 'team_dawaa_alpha', 'فرع شكري', true, true),
  ('a0000000-0000-4000-8000-000000000012', '50000000-0000-4000-8000-000000000012', 'executive_manager', null, true, true);

insert into public.account_permissions (account_id, permissions) values
  ('a0000000-0000-4000-8000-000000000001', '{"view_points": true, "view_reviews": true, "view_activity_log": true}'),
  ('a0000000-0000-4000-8000-000000000002', '{"view_points": true, "view_reviews": true}'),
  ('a0000000-0000-4000-8000-000000000003', '{"view_points": true}'),
  ('a0000000-0000-4000-8000-000000000004', '{"view_points": true, "view_reviews": true, "view_activity_logs": true}'),
  ('a0000000-0000-4000-8000-000000000005', '{"view_points": false, "view_reviews": true}'),
  ('a0000000-0000-4000-8000-000000000006', '{"view_points": true, "view_reviews": true}'),
  ('a0000000-0000-4000-8000-000000000007', '{"view_points": true, "view_reviews": true}'),
  ('a0000000-0000-4000-8000-000000000008', '{"view_points": true, "view_reviews": true}'),
  ('a0000000-0000-4000-8000-000000000009', '{"view_points": true, "view_reviews": true}'),
  ('a0000000-0000-4000-8000-000000000010', '{"view_points": true, "view_reviews": true}'),
  ('a0000000-0000-4000-8000-000000000011', '{"view_reviews": true}'),
  ('a0000000-0000-4000-8000-000000000012', '{"view_points": true, "view_reviews": true}');

insert into public.employee_transactions (id, staff_id, branch) values
  (1, '50000000-0000-4000-8000-000000000002', 'فرع شكري'),
  (2, '50000000-0000-4000-8000-000000000004', ' فرع شكري'),
  (3, '50000000-0000-4000-8000-000000000005', 'فرع الشامي'),
  (4, null, 'فرع شكري'),
  (5, '50000000-0000-4000-8000-000000000002', null),
  (6, null, null),
  (7, '50000000-0000-4000-8000-000000000099', 'شكري');

insert into public.staff_attendance_logs (id, staff_id, branch_name) values
  (1, '50000000-0000-4000-8000-000000000002', 'فرع شكري'),
  (2, '50000000-0000-4000-8000-000000000004', 'فرع شكري '),
  (3, '50000000-0000-4000-8000-000000000005', 'فرع الشامي'),
  (4, null, ''),
  (5, 'a0000000-0000-4000-8000-000000000011', 'فرع الشامي'),
  (6, '50000000-0000-4000-8000-000000000007', null),
  (7, null, null);

insert into public.conversation_sales_reviews (id, is_current, staff_id, doctor_id, branch, reviewer_id) values
  (1, true, '50000000-0000-4000-8000-000000000002', null, 'فرع شكري', null),
  (2, true, null, '50000000-0000-4000-8000-000000000002', 'فرع الشامي', null),
  (3, true, null, null, 'shokry', 'a0000000-0000-4000-8000-000000000004'),
  (4, true, null, null, 'الشامى', null),
  (5, false, '50000000-0000-4000-8000-000000000002', null, 'فرع شكري', null),
  (6, true, null, null, null, null),
  (7, true, '50000000-0000-4000-8000-000000000006', null, ' شكري ', null);

insert into public.activity_log (id, action) values (1, 'a'), (2, 'b'), (3, 'c');
