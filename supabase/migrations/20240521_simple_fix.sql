-- Simple fix for permissions - Execute each block separately in Supabase SQL Editor

-- Block 1: Update staff_account_login function
drop function if exists public.staff_account_login(text, text);

create function public.staff_account_login(p_username text, p_password text)
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
