-- Fixture for 20261015150200_pending_overtime_branch_scope_initplan_v1.
-- Base actors, verified-session stand-in and helpers:
\ir rls_actor_scope_initplan_v1.fixture.sql

insert into public.staff_accounts (id, staff_id, role, branch, active, can_login) values
  ('d0000000-0000-4000-8000-000000000001', null, 'procurement_manager', 'فرع شكري', true, true),
  ('d0000000-0000-4000-8000-000000000002', null, 'branch_manager', '  فرع   الشامي ', true, true),
  ('d0000000-0000-4000-8000-000000000003', null, 'branch_manager', 'شكري', true, true),
  ('d0000000-0000-4000-8000-000000000004', null, 'branch_manager', '', true, true),
  ('d0000000-0000-4000-8000-000000000005', null, 'General_Manager', null, true, true);

-- Production definition (2026-10-15) of the per-row helper.
create or replace function public.current_user_branch_access_v1(p_branch text, p_allow_global boolean default true)
returns boolean
language plpgsql
stable security definer
set search_path to 'public', 'auth', 'pg_temp'
as $function$
declare
  v_staff_id uuid;
  v_role text;
  v_branch text;
  v_row_branch text;
  v_user_branch text;
begin
  v_staff_id := public.dawaa_current_staff_account_id_strict();
  if v_staff_id is null then return false; end if;

  select sa.role, sa.branch into v_role, v_branch
  from public.staff_accounts sa
  where sa.id = v_staff_id
    and coalesce(sa.active,false) = true
    and coalesce(sa.can_login,false) = true
  limit 1;

  if v_role is null then return false; end if;
  if v_role in ('general_manager','executive_manager','branches_manager','procurement_manager') then return true; end if;

  v_row_branch := lower(btrim(regexp_replace(coalesce(p_branch,''), '^\s*فرع\s+', '', 'i')));
  v_user_branch := lower(btrim(regexp_replace(coalesce(v_branch,''), '^\s*فرع\s+', '', 'i')));
  if p_allow_global and v_row_branch in ('','كل الفروع','all','all branches') then return true; end if;
  return v_user_branch <> '' and v_row_branch = v_user_branch;
end;
$function$;
grant execute on function public.current_user_branch_access_v1(text, boolean) to anon, authenticated;

create table public.staff_overtime_approvals (
  id integer primary key, staff_id uuid, branch text, status text, attendance_date date
);
grant select on public.staff_overtime_approvals to anon, authenticated;

-- Production definition (2026-10-15) of the RPC before the migration, as the oracle.
create or replace function public.test_old_list_pending_overtime_v1(p_branch text default null::text)
returns setof public.staff_overtime_approvals
language sql security definer set search_path to 'public', 'pg_catalog'
as $function$
  select * from public.staff_overtime_approvals
  where status = 'pending'
    and (p_branch is null or branch = p_branch)
    and public.current_user_branch_access_v1(branch, true)
  order by attendance_date desc;
$function$;
grant execute on function public.test_old_list_pending_overtime_v1(text) to anon, authenticated;

insert into public.staff_overtime_approvals (id, staff_id, branch, status, attendance_date) values
  (1, null, 'فرع شكري', 'pending', '2026-10-01'),
  (2, null, 'شكري', 'pending', '2026-10-02'),
  (3, null, ' فرع الشامي', 'pending', '2026-10-03'),
  (4, null, 'فرع   الشامي', 'pending', '2026-10-04'),
  (5, null, '', 'pending', '2026-10-05'),
  (6, null, null, 'pending', '2026-10-06'),
  (7, null, 'كل الفروع', 'pending', '2026-10-07'),
  (8, null, 'ALL', 'pending', '2026-10-08'),
  (9, null, 'All Branches', 'pending', '2026-10-09'),
  (10, null, 'المخزن', 'pending', '2026-10-10'),
  (11, null, 'فرع شكري', 'approved', '2026-10-11'),
  (12, null, 'FRA3 shokry', 'pending', '2026-10-12');
