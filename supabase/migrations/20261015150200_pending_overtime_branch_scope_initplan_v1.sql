-- list_pending_overtime_v1: resolve the branch-access actor scope once per statement.
--
-- Production smoke (2026-10-15): /hr-workforce list_pending_overtime_v1 averaged 13.2 s (pg_stat_statements:
-- 8 calls, ~217k buffers per call) over a 32-page table: current_user_branch_access_v1(branch, true) resolved
-- the session actor for each of the 168 pending rows.
--
-- public.current_user_branch_access_scope_v1() returns the actor part of current_user_branch_access_v1 once:
--   'none'   no verified actor, no active+can_login account, or no role
--   'all'    general_manager / executive_manager / branches_manager / procurement_manager (same raw comparison)
--   'branch' every other role, with the actor branch normalized exactly like the row branch
-- and list_pending_overtime_v1 applies the remaining row rule of current_user_branch_access_v1(branch, true):
-- global rows ('', 'كل الفروع', 'all', 'all branches') are visible to any 'branch' actor, otherwise the
-- normalized row branch must equal the non-empty normalized actor branch. current_user_branch_access_v1 itself
-- is unchanged (other callers keep using it). The function keeps its Production signature and attributes.

create or replace function public.current_user_branch_access_scope_v1()
returns table(access_mode text, user_branch_key text)
language plpgsql
stable
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $function$
declare
  v_staff_id uuid;
  v_role text;
  v_branch text;
begin
  v_staff_id := public.dawaa_current_staff_account_id_strict();
  if v_staff_id is null then
    return query select 'none'::text, null::text;
    return;
  end if;

  select sa.role, sa.branch into v_role, v_branch
  from public.staff_accounts sa
  where sa.id = v_staff_id
    and coalesce(sa.active,false) = true
    and coalesce(sa.can_login,false) = true
  limit 1;

  if v_role is null then
    return query select 'none'::text, null::text;
    return;
  end if;
  if v_role in ('general_manager','executive_manager','branches_manager','procurement_manager') then
    return query select 'all'::text, null::text;
    return;
  end if;

  return query select 'branch'::text, lower(btrim(regexp_replace(coalesce(v_branch,''), '^\s*فرع\s+', '', 'i')));
end;
$function$;

revoke all on function public.current_user_branch_access_scope_v1() from public;
grant execute on function public.current_user_branch_access_scope_v1() to anon, authenticated, service_role;

create or replace function public.list_pending_overtime_v1(p_branch text default null::text)
returns setof public.staff_overtime_approvals
language sql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select * from public.staff_overtime_approvals
  where status = 'pending'
    and (p_branch is null or branch = p_branch)
    and (
      (select scope.access_mode from public.current_user_branch_access_scope_v1() scope) = 'all'
      or (
        (select scope.access_mode from public.current_user_branch_access_scope_v1() scope) = 'branch'
        and (
          lower(btrim(regexp_replace(coalesce(branch,''), '^\s*فرع\s+', '', 'i'))) in ('','كل الفروع','all','all branches')
          or (
            (select scope.user_branch_key from public.current_user_branch_access_scope_v1() scope) <> ''
            and lower(btrim(regexp_replace(coalesce(branch,''), '^\s*فرع\s+', '', 'i')))
              = (select scope.user_branch_key from public.current_user_branch_access_scope_v1() scope)
          )
        )
      )
    )
  order by attendance_date desc;
$function$;

notify pgrst, 'reload schema';
