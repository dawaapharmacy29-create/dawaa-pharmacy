-- Step 2: Create get_user_permissions function
-- Execute this in Supabase SQL Editor after Step 1

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
