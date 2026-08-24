-- Migrate the five still-active dot-notation permissions to snake_case.
-- Old values remain during the compatibility window; all new reads/writes use
-- the canonical keys below.

do $$
declare
  v_pair text[];
begin
  foreach v_pair slice 1 in array array[
    array['customer_welcome_messages.view',   'customer_welcome_messages_view'],
    array['customer_welcome_messages.create', 'customer_welcome_messages_create'],
    array['customer_welcome_messages.update', 'customer_welcome_messages_update'],
    array['employee_operating_system.view',    'employee_operating_system_view'],
    array['employee_operating_system.manage',  'employee_operating_system_manage']
  ] loop
    update public.staff_accounts
    set permissions = jsonb_set(
      coalesce(permissions, '{}'::jsonb), array[v_pair[2]],
      coalesce(permissions->v_pair[2], permissions->v_pair[1], 'false'::jsonb), true
    )
    where coalesce(permissions, '{}'::jsonb) ? v_pair[1]
       or coalesce(permissions, '{}'::jsonb) ? v_pair[2];

    update public.app_role_permissions
    set permissions = jsonb_set(
      coalesce(permissions, '{}'::jsonb), array[v_pair[2]],
      coalesce(permissions->v_pair[2], permissions->v_pair[1], 'false'::jsonb), true
    )
    where coalesce(permissions, '{}'::jsonb) ? v_pair[1]
       or coalesce(permissions, '{}'::jsonb) ? v_pair[2];

    update public.roles
    set permissions = jsonb_set(
      coalesce(permissions, '{}'::jsonb), array[v_pair[2]],
      coalesce(permissions->v_pair[2], permissions->v_pair[1], 'false'::jsonb), true
    )
    where coalesce(permissions, '{}'::jsonb) ? v_pair[1]
       or coalesce(permissions, '{}'::jsonb) ? v_pair[2];

    update public.staff_permission_overrides
      set permission_key = v_pair[2]
      where permission_key = v_pair[1]
        and not exists (
          select 1 from public.staff_permission_overrides n
          where n.staff_account_id = staff_permission_overrides.staff_account_id
            and n.permission_key = v_pair[2]
        );
    delete from public.staff_permission_overrides where permission_key = v_pair[1];

    update public.user_permission_overrides
      set permission_key = v_pair[2]
      where permission_key = v_pair[1]
        and not exists (
          select 1 from public.user_permission_overrides n
          where n.user_id = user_permission_overrides.user_id
            and n.permission_key = v_pair[2]
        );
    delete from public.user_permission_overrides where permission_key = v_pair[1];

    update public.user_permissions
      set permission_key = v_pair[2]
      where permission_key = v_pair[1]
        and not exists (
          select 1 from public.user_permissions n
          where n.user_id = user_permissions.user_id
            and n.permission_key = v_pair[2]
        );
    delete from public.user_permissions where permission_key = v_pair[1];

    update public.role_permissions
      set permission_key = v_pair[2]
      where permission_key = v_pair[1]
        and not exists (
          select 1 from public.role_permissions n
          where n.role_id = role_permissions.role_id
            and n.permission_key = v_pair[2]
        );
    delete from public.role_permissions where permission_key = v_pair[1];

    update public.app_role_section_permissions
      set permission_key = v_pair[2]
      where permission_key = v_pair[1]
        and not exists (
          select 1 from public.app_role_section_permissions n
          where n.role_key = app_role_section_permissions.role_key
            and n.permission_key = v_pair[2]
        );
    delete from public.app_role_section_permissions where permission_key = v_pair[1];

    update public.permission_definitions
      set permission_key = v_pair[2]
      where permission_key = v_pair[1]
        and not exists (
          select 1 from public.permission_definitions n where n.permission_key = v_pair[2]
        );
    delete from public.permission_definitions where permission_key = v_pair[1];
  end loop;
end $$;
