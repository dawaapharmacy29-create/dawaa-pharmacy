-- Step 3: Create user_has_permission function and grant permissions
-- Execute this in Supabase SQL Editor after Step 2

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