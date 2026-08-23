create or replace function public.current_user_expiry_permission_v1(p_write boolean default false)
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_role text;
  v_permissions jsonb;
  v_key text;
  v_default_allowed boolean := false;
begin
  if auth.uid() is null then
    return false;
  end if;

  select sa.role
    into v_role
  from public.staff_accounts sa
  where (sa.id = auth.uid() or sa.auth_user_id = auth.uid())
    and coalesce(sa.active, true) = true
    and coalesce(sa.is_active, true) = true
  limit 1;

  if v_role is null then
    return false;
  end if;

  v_key := case when p_write then 'manage_medicines' else 'view_expiry_tracker' end;
  v_permissions := public.get_user_permissions(auth.uid());

  if v_permissions ? v_key then
    return coalesce((v_permissions ->> v_key)::boolean, false);
  end if;

  if p_write then
    v_default_allowed := v_role in (
      'general_manager',
      'executive_manager',
      'branches_manager',
      'procurement_manager',
      'branch_manager',
      'inventory_assistant'
    );
  else
    v_default_allowed := v_role in (
      'general_manager',
      'executive_manager',
      'branches_manager',
      'procurement_manager',
      'branch_manager',
      'pharmacist',
      'inventory_assistant'
    );
  end if;

  return v_default_allowed;
end;
$$;

revoke all on function public.current_user_expiry_permission_v1(boolean) from public;
revoke all on function public.current_user_expiry_permission_v1(boolean) from anon;
grant execute on function public.current_user_expiry_permission_v1(boolean) to authenticated;

drop policy if exists expiry_discount_items_select_v1 on public.expiry_discount_items;
create policy expiry_discount_items_select_v1
on public.expiry_discount_items
for select
to authenticated
using (
  public.current_user_expiry_permission_v1(false)
  and public.current_user_branch_access_v1(branch, true)
);

drop policy if exists expiry_discount_items_insert_v1 on public.expiry_discount_items;
create policy expiry_discount_items_insert_v1
on public.expiry_discount_items
for insert
to authenticated
with check (
  public.current_user_expiry_permission_v1(true)
  and public.current_user_branch_access_v1(branch, false)
);

drop policy if exists expiry_discount_items_update_v1 on public.expiry_discount_items;
create policy expiry_discount_items_update_v1
on public.expiry_discount_items
for update
to authenticated
using (
  public.current_user_expiry_permission_v1(true)
  and public.current_user_branch_access_v1(branch, false)
)
with check (
  public.current_user_expiry_permission_v1(true)
  and public.current_user_branch_access_v1(branch, false)
);

drop function if exists public.current_user_has_permission_v1(text);
