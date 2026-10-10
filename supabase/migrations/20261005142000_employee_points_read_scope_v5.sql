-- Employee points V5 read boundary.
-- view_points allows a user to see their own ledger. Team-wide ledger visibility is
-- a management/financial capability and must not be inferred from customer-service role.

create or replace function public.dawaa_can_read_employee_transaction(p_staff_id uuid, p_branch text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_account_id uuid;
  v_role text;
  v_branch text;
  v_staff_id text;
  v_permissions jsonb;
  v_can_view boolean;
  v_can_view_team boolean;
begin
  v_account_id := public.dawaa_current_staff_account_id_strict();
  if v_account_id is null then return false; end if;

  select lower(trim(coalesce(sa.role,''))), sa.branch, sa.staff_id, public.get_user_permissions(sa.id)
    into v_role, v_branch, v_staff_id, v_permissions
  from public.staff_accounts sa
  where sa.id=v_account_id and coalesce(sa.active,false) and coalesce(sa.can_login,false)
  limit 1;
  if not found then return false; end if;

  v_can_view := public.dawaa_jsonb_has_true_any(coalesce(v_permissions,'{}'::jsonb),array['view_points']);
  if not v_can_view then return false; end if;

  -- Self ledger is the baseline meaning of view_points.
  if p_staff_id is not null
     and nullif(trim(coalesce(v_staff_id,'')),'') is not null
     and p_staff_id::text=trim(v_staff_id) then
    return true;
  end if;

  -- Global management keeps organization-wide visibility.
  if v_role in ('general_manager','executive_manager','branches_manager','admin') then
    return true;
  end if;

  -- Team ledger requires an explicit team/financial capability in addition to view_points.
  v_can_view_team := public.dawaa_jsonb_has_true_any(
    coalesce(v_permissions,'{}'::jsonb),
    array['view_team','manage_points','approve_points','manage_payroll']
  );

  if v_role in ('branch_manager','shift_supervisor_morning','shift_supervisor_evening')
     and v_can_view_team then
    return p_branch is not null and v_branch is not null and trim(p_branch)=trim(v_branch);
  end if;

  return false;
end;
$function$;

revoke all on function public.dawaa_can_read_employee_transaction(uuid,text) from public;
grant execute on function public.dawaa_can_read_employee_transaction(uuid,text) to anon,authenticated,service_role;

notify pgrst,'reload schema';
