-- Branch sales targets are set by top management only.
--
-- dawaa_can_manage_branch_targets allowed any branch_manager to insert/update the target of any
-- branch (no branch check), including the target his own evaluation and incentives are measured
-- against. Branch managers keep read access (branch_sales_targets_select_authenticated is unchanged).
-- Body is the production body with 'branch_manager' removed from the role list.
-- Verified by scripts/verification/test-branch-targets-top-management-native.mjs.
--
-- Rollback: re-add 'branch_manager' to the role list below.

begin;

create or replace function public.dawaa_can_manage_branch_targets(p_actor_id uuid default null::uuid)
returns boolean
language plpgsql
stable security definer
set search_path to 'public', 'auth', 'pg_temp'
as $function$
declare
  v_id uuid := coalesce(p_actor_id, public.dawaa_request_staff_id());
  v_role text;
  v_permissions jsonb;
begin
  if v_id is null then return false; end if;

  select lower(trim(coalesce(sa.role,''))), public.get_user_permissions(sa.id)
    into v_role, v_permissions
  from public.staff_accounts sa
  where sa.id = v_id
    and coalesce(sa.active,false) = true
    and coalesce(sa.can_login,false) = true
  limit 1;

  if not found then return false; end if;
  if v_role in ('general_manager','executive_manager','branches_manager') then return true; end if;
  return coalesce((v_permissions ->> 'manage_settings')::boolean,false);
end;
$function$;

commit;
