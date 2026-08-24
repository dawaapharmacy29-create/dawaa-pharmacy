-- Keep database authorization aligned with the application role preset:
-- shift supervisors are pharmacist/doctor operators and must be able to view/manage
-- Customer Requests within their own branch, never across branches.

create or replace function public.dawaa_customer_request_permission_allowed(
  p_actor_id uuid,
  p_permission text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_role text;
  v_account_permissions jsonb := '{}'::jsonb;
  v_override jsonb := '{}'::jsonb;
  v_role_allowed boolean := false;
begin
  if p_actor_id is null or p_permission not in ('view_customer_requests','manage_customer_requests') then
    return false;
  end if;

  select lower(trim(coalesce(sa.role,''))), coalesce(sa.permissions,'{}'::jsonb)
    into v_role, v_account_permissions
  from public.staff_accounts sa
  where sa.id = p_actor_id
    and coalesce(sa.active,false)
    and coalesce(sa.can_login,false)
  limit 1;
  if not found then return false; end if;

  if p_permission = 'view_customer_requests' then
    v_role_allowed := v_role in (
      'general_manager','executive_manager','branches_manager','admin',
      'branch_manager','customer_service_manager',
      'shift_supervisor_morning','shift_supervisor_evening',
      'pharmacist','customer_service'
    );
  else
    v_role_allowed := v_role in (
      'general_manager','executive_manager','branches_manager','admin',
      'branch_manager','customer_service_manager',
      'shift_supervisor_morning','shift_supervisor_evening',
      'pharmacist'
    );
  end if;

  select coalesce(jsonb_object_agg(spo.permission_key, spo.allowed), '{}'::jsonb)
    into v_override
  from public.staff_permission_overrides spo
  where spo.staff_account_id = p_actor_id
    and spo.permission_key = p_permission;

  return v_role_allowed
    and coalesce(nullif(v_account_permissions->>p_permission,'')::boolean, true)
    and coalesce(nullif(v_override->>p_permission,'')::boolean, true);
end;
$$;
