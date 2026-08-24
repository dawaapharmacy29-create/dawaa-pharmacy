-- Runtime correction: COALESCE is SQL syntax and cannot be schema-qualified.
create or replace function public.dawaa_can_access_customer_core_branch_v1(
  p_permissions text[],
  p_branch text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_role text;
  v_actor_branch text;
  v_data_branch text;
begin
  v_actor_id := public.dawaa_current_staff_account_id_strict();
  if v_actor_id is null or not public.dawaa_current_actor_can(p_permissions) then
    return false;
  end if;

  select pg_catalog.lower(pg_catalog.btrim(coalesce(sa.role, ''))), sa.branch
    into v_role, v_actor_branch
  from public.staff_accounts sa
  where sa.id = v_actor_id
    and coalesce(sa.active, false)
    and coalesce(sa.can_login, false)
  limit 1;

  if not found then return false; end if;
  if v_role in ('general_manager', 'executive_manager', 'branches_manager', 'admin') then
    return true;
  end if;

  v_data_branch := public.dawaa_customer_request_branch_key(p_branch);
  if v_data_branch is null
     or pg_catalog.lower(pg_catalog.btrim(coalesce(p_branch, ''))) in ('متعدد الفروع', 'كل الفروع', 'all') then
    return true;
  end if;

  return public.dawaa_customer_request_branch_key(v_actor_branch) is not null
    and public.dawaa_customer_request_branch_key(v_actor_branch) = v_data_branch;
end;
$$;

revoke all on function public.dawaa_can_access_customer_core_branch_v1(text[],text) from public;
grant execute on function public.dawaa_can_access_customer_core_branch_v1(text[],text)
  to anon, authenticated, service_role;

