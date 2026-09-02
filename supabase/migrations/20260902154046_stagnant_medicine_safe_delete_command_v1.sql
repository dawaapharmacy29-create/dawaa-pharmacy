create or replace function public.delete_stagnant_medicine_v1(p_medicine_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_account public.staff_accounts%rowtype;
  v_role text;
  v_medicine_branch text;
begin
  if p_medicine_id is null then
    return false;
  end if;

  select sa.* into v_account
  from public.staff_accounts sa
  where sa.id = public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active, false)
    and coalesce(sa.can_login, false)
  limit 1;

  if not found then
    raise exception using errcode = '42501', message = 'active staff actor required';
  end if;

  if not public.dawaa_current_actor_can(array['manage_stagnant_medicines']) then
    raise exception using errcode = '42501', message = 'manage stagnant medicines permission required';
  end if;

  select trim(coalesce(nullif(sm.branch_name, ''), nullif(sm.branch, ''), ''))
    into v_medicine_branch
  from public.stagnant_medicines sm
  where sm.id = p_medicine_id
  for update;

  if not found then
    return false;
  end if;

  v_role := lower(trim(coalesce(v_account.role, '')));

  if v_role not in ('general_manager', 'executive_manager', 'branches_manager', 'admin') then
    if nullif(trim(coalesce(v_account.branch, '')), '') is null
       or nullif(v_medicine_branch, '') is null
       or trim(v_account.branch) <> v_medicine_branch then
      raise exception using errcode = '42501', message = 'stagnant medicine branch scope denied';
    end if;
  end if;

  delete from public.stagnant_medicines sm
  where sm.id = p_medicine_id;

  return found;
end;
$$;

revoke all on function public.delete_stagnant_medicine_v1(uuid) from public;
grant execute on function public.delete_stagnant_medicine_v1(uuid) to anon, authenticated, service_role;
