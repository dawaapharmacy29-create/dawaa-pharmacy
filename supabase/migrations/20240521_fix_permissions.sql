-- Fix permissions system - Execute this in Supabase SQL Editor
-- Date: 2024-05-21

-- Update staff_account_login function to use roles table
create or replace function public.staff_account_login(p_username text, p_password text)
returns table (
  id uuid,
  staff_id uuid,
  username text,
  name text,
  role text,
  branch text,
  phone text,
  active boolean,
  can_login boolean,
  permissions jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role_name text;
  v_role_permissions jsonb;
begin
  -- Get role name from staff account
  select coalesce(a.role, a.staff_role, 'صيدلاني') into v_role_name
  from public.staff_accounts a
  where lower(a.username) = lower(p_username)
    and coalesce(a.can_login, true) = true
    and coalesce(a.active, true) = true
    and (
      a.temporary_password = p_password
      or a.password_hash = crypt(p_password, a.password_hash)
      or a.password_hash = p_password
    )
  limit 1;

  -- Get role permissions from roles table
  select r.permissions into v_role_permissions
  from public.roles r
  where r.name = v_role_name or r.name_ar = v_role_name
  limit 1;

  return query
  select
    a.id,
    a.staff_id,
    a.username,
    coalesce(a.name, a.staff_name, a.username) as name,
    coalesce(a.role, a.staff_role, 'صيدلاني') as role,
    coalesce(a.branch, 'الكل') as branch,
    a.phone,
    coalesce(a.active, true) as active,
    coalesce(a.can_login, true) as can_login,
    coalesce(v_role_permissions, a.permissions, '{}'::jsonb) as permissions
  from public.staff_accounts a
  where lower(a.username) = lower(p_username)
    and coalesce(a.can_login, true) = true
    and coalesce(a.active, true) = true
    and (
      a.temporary_password = p_password
      or a.password_hash = crypt(p_password, a.password_hash)
      or a.password_hash = p_password
    )
  limit 1;

  update public.staff_accounts a
  set last_login_at = now()
  where lower(a.username) = lower(p_username)
    and coalesce(a.can_login, true) = true
    and coalesce(a.active, true) = true
    and (
      a.temporary_password = p_password
      or a.password_hash = crypt(p_password, a.password_hash)
      or a.password_hash = p_password
    );
end;
$$;

-- Function to get effective permissions for a user (role + overrides)
create or replace function public.get_user_permissions(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with role_permissions as (
    select r.permissions
    from staff_accounts sa
    join roles r on r.name = sa.role or r.name_ar = sa.role
    where sa.id = p_user_id
  ),
  user_overrides as (
    select permission_key, allowed
    from user_permissions
    where user_id = p_user_id
  )
  select
    coalesce(
      (
        select jsonb_object_agg(
          ak.key,
          coalesce(
            (select to_jsonb(uo.allowed) from user_overrides uo where uo.permission_key = ak.key),
            (rp.permissions->>ak.key)::jsonb,
            'false'::jsonb
          )
        )
        from (
          select jsonb_object_keys(rp.permissions) as key
          from role_permissions rp
          union
          select permission_key as key
          from user_overrides
        ) ak
        cross join role_permissions rp
      ),
      '{}'::jsonb
    ) as permissions;
$$;

-- Function to check if user has specific permission
create or replace function public.user_has_permission(p_user_id uuid, p_permission_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((get_user_permissions(p_user_id)->>p_permission_key)::boolean, false);
$$;

-- Grant permissions
grant execute on function public.staff_account_login(text, text) to anon, authenticated;
grant execute on function public.get_user_permissions(uuid) to anon, authenticated;
grant execute on function public.user_has_permission(uuid, text) to anon, authenticated;
