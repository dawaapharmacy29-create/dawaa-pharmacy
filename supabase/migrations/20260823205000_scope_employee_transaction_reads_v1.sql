create or replace function public.dawaa_can_read_employee_transaction(p_staff_id uuid, p_branch text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_role text;
  v_branch text;
  v_staff_id text;
  v_permissions jsonb;
begin
  v_account_id := public.dawaa_current_staff_account_id_strict();
  if v_account_id is null then
    return false;
  end if;

  select lower(trim(coalesce(sa.role,''))), sa.branch, sa.staff_id, public.get_user_permissions(sa.id)
    into v_role, v_branch, v_staff_id, v_permissions
  from public.staff_accounts sa
  where sa.id = v_account_id
    and coalesce(sa.active,false)
    and coalesce(sa.can_login,false)
  limit 1;

  if not found then
    return false;
  end if;

  if not public.dawaa_jsonb_has_true_any(coalesce(v_permissions,'{}'::jsonb), array['view_points']) then
    return false;
  end if;

  if v_role in ('general_manager','executive_manager','branches_manager','admin') then
    return true;
  end if;

  if v_role = 'pharmacist' then
    return p_staff_id is not null
      and nullif(trim(coalesce(v_staff_id,'')),'') is not null
      and p_staff_id::text = trim(v_staff_id);
  end if;

  if v_role in ('branch_manager','customer_service_manager','customer_service','shift_supervisor_morning','shift_supervisor_evening') then
    return p_branch is not null and v_branch is not null and trim(p_branch) = trim(v_branch);
  end if;

  return false;
end;
$$;

grant execute on function public.dawaa_can_read_employee_transaction(uuid,text) to anon, authenticated;

drop policy if exists employee_transactions_select_active_actor on public.employee_transactions;
drop policy if exists employee_transactions_select_scoped_actor on public.employee_transactions;
create policy employee_transactions_select_scoped_actor
on public.employee_transactions
for select
to anon, authenticated
using (public.dawaa_can_read_employee_transaction(staff_id, branch));
