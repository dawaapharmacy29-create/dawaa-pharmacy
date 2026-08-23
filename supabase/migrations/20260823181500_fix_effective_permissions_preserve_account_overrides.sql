create or replace function public.get_user_permissions(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_staff_account_id uuid;
  v_role text;
  v_allowed_pages text[];
  v_account_permissions jsonb := '{}'::jsonb;
  v_role_json jsonb := '{}'::jsonb;
  v_pages_json jsonb := '{}'::jsonb;
  v_override_json jsonb := '{}'::jsonb;
begin
  select id, role, allowed_pages, coalesce(permissions, '{}'::jsonb)
  into v_staff_account_id, v_role, v_allowed_pages, v_account_permissions
  from public.staff_accounts
  where id = p_user_id or auth_user_id = p_user_id
  limit 1;

  if v_staff_account_id is null then
    return '{}'::jsonb;
  end if;

  select coalesce(jsonb_object_agg(permission_key, allowed), '{}'::jsonb)
  into v_role_json
  from public.app_role_section_permissions
  where role_key = v_role;

  select coalesce(jsonb_object_agg(x, true), '{}'::jsonb)
  into v_pages_json
  from unnest(coalesce(v_allowed_pages, '{}'::text[])) as x;

  select coalesce(jsonb_object_agg(permission_key, allowed), '{}'::jsonb)
  into v_override_json
  from public.staff_permission_overrides
  where staff_account_id = v_staff_account_id;

  -- Precedence: role config < legacy allowed_pages < account permissions < explicit per-account overrides.
  -- False values in staff_accounts.permissions are intentionally preserved so restricted pages stay restricted.
  return v_role_json || v_pages_json || v_account_permissions || v_override_json;
end;
$function$;
