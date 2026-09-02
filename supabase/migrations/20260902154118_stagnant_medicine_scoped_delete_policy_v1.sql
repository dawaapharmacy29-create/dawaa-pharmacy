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

  if not public.dawaa_current_actor_can(array['manage_stagnant_medicines']) then
    return false;
  end if;

  v_role := lower(trim(coalesce(v_account.role, '')));
  if v_role in ('general_manager', 'executive_manager', 'branches_manager', 'admin') then
    return true;
  end if;

  return nullif(trim(coalesce(v_account.branch, '')), '') is not null
    and nullif(trim(coalesce(p_branch, '')), '') is not null
    and trim(v_account.branch) = trim(p_branch);
end;
$$;

revoke all on function public.dawaa_can_delete_stagnant_medicine_v1(text) from public;
grant execute on function public.dawaa_can_delete_stagnant_medicine_v1(text) to anon, authenticated, service_role;

drop policy if exists stagnant_medicines_delete_scoped_actor on public.stagnant_medicines;
create policy stagnant_medicines_delete_scoped_actor
on public.stagnant_medicines
for delete
to anon, authenticated
using (
  public.dawaa_can_delete_stagnant_medicine_v1(
    coalesce(nullif(branch_name, ''), nullif(branch, ''))
  )
);

grant delete on public.stagnant_medicines to anon, authenticated;
