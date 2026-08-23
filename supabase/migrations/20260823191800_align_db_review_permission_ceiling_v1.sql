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
  v_effective jsonb := '{}'::jsonb;
  v_role_key text;
  v_can_view_reviews boolean := false;
  v_can_add_reviews boolean := false;
  v_can_edit_reviews boolean := false;
  v_can_approve_reviews boolean := false;
  v_can_delete_reviews boolean := false;
begin
  select id, role, allowed_pages, coalesce(permissions, '{}'::jsonb)
  into v_staff_account_id, v_role, v_allowed_pages, v_account_permissions
  from public.staff_accounts
  where (id = p_user_id or auth_user_id = p_user_id)
    and coalesce(active, false)
    and coalesce(can_login, false)
  order by case when id = p_user_id then 0 else 1 end, updated_at desc nulls last
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

  v_effective := v_role_json || v_pages_json || v_account_permissions || v_override_json;
  v_role_key := lower(trim(coalesce(v_role, '')));

  -- Canonical review permission ceiling, matching src/lib/core/permissionSystem.ts.
  -- Account/override false values remain explicit restrictions. A stored true can
  -- never grant a review action outside the role ceiling.
  if v_role_key in ('general_manager','executive_manager','branches_manager') then
    v_can_view_reviews := true;
    v_can_add_reviews := true;
    v_can_edit_reviews := true;
    v_can_approve_reviews := true;
    v_can_delete_reviews := true;
  elsif v_role_key in ('branch_manager','customer_service_manager') then
    v_can_view_reviews := true;
    v_can_add_reviews := true;
    v_can_edit_reviews := true;
    v_can_approve_reviews := true;
  elsif v_role_key in ('shift_supervisor_morning','shift_supervisor_evening','customer_service') then
    v_can_view_reviews := true;
    v_can_add_reviews := true;
  elsif v_role_key = 'pharmacist' then
    v_can_view_reviews := true;
  end if;

  v_effective := jsonb_set(v_effective, '{view_reviews}', to_jsonb(
    v_can_view_reviews
    and coalesce(nullif(v_account_permissions->>'view_reviews','')::boolean, true)
    and coalesce(nullif(v_override_json->>'view_reviews','')::boolean, true)
  ), true);
  v_effective := jsonb_set(v_effective, '{add_reviews}', to_jsonb(
    v_can_add_reviews
    and coalesce(nullif(v_account_permissions->>'add_reviews','')::boolean, true)
    and coalesce(nullif(v_override_json->>'add_reviews','')::boolean, true)
  ), true);
  v_effective := jsonb_set(v_effective, '{edit_reviews}', to_jsonb(
    v_can_edit_reviews
    and coalesce(nullif(v_account_permissions->>'edit_reviews','')::boolean, true)
    and coalesce(nullif(v_override_json->>'edit_reviews','')::boolean, true)
  ), true);
  v_effective := jsonb_set(v_effective, '{approve_reviews}', to_jsonb(
    v_can_approve_reviews
    and coalesce(nullif(v_account_permissions->>'approve_reviews','')::boolean, true)
    and coalesce(nullif(v_override_json->>'approve_reviews','')::boolean, true)
  ), true);
  v_effective := jsonb_set(v_effective, '{delete_reviews}', to_jsonb(
    v_can_delete_reviews
    and coalesce(nullif(v_account_permissions->>'delete_reviews','')::boolean, true)
    and coalesce(nullif(v_override_json->>'delete_reviews','')::boolean, true)
  ), true);

  return v_effective;
end;
$function$;
