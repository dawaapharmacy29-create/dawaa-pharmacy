create or replace function public.dawaa_can_delete_stagnant_medicine_v1(p_branch text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_account public.staff_accounts%rowtype;
  v_role text;
begin
  select sa.* into v_account
  from public.staff_accounts sa
  where sa.id = public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active, false)
    and coalesce(sa.can_login, false)
  limit 1;

  if not found then
    return false;
  end if;

  v_role := lower(trim(coalesce(v_account.role, '')));

  if v_role in ('general_manager', 'executive_manager', 'branches_manager', 'procurement_manager', 'admin') then
    return true;
  end if;

  if v_role = 'branch_manager' then
    return nullif(trim(coalesce(v_account.branch, '')), '') is not null
      and nullif(trim(coalesce(p_branch, '')), '') is not null
      and trim(v_account.branch) = trim(p_branch);
  end if;

  return false;
end;
$$;
