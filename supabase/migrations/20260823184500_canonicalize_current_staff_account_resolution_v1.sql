create or replace function public.dawaa_current_staff_account_id_strict()
returns uuid
language sql
stable security definer
set search_path to 'public','auth','pg_catalog'
as $$
  with request_identity as (
    select public.dawaa_request_staff_identifier() as value
  )
  select coalesce(
    (
      select a.id
      from public.staff_accounts a
      where auth.uid() is not null
        and a.auth_user_id = auth.uid()
        and coalesce(a.active,false)
        and coalesce(a.can_login,false)
      limit 1
    ),
    (
      select a.id
      from public.user_profiles up
      join public.staff_accounts a on a.id = up.staff_account_id
      where auth.uid() is not null
        and up.auth_user_id = auth.uid()
        and coalesce(up.active,false)
        and coalesce(a.active,false)
        and coalesce(a.can_login,false)
      limit 1
    ),
    (
      select a.id
      from public.staff_accounts a, request_identity r
      where r.value is not null
        and coalesce(a.active,false)
        and coalesce(a.can_login,false)
        and (
          a.id::text = r.value
          or a.staff_id::text = r.value
          or lower(trim(coalesce(a.username,''))) = lower(r.value)
        )
      order by
        case
          when a.id::text = r.value then 1
          when a.staff_id::text = r.value then 2
          else 3
        end,
        coalesce(a.updated_at,a.created_at) desc nulls last
      limit 1
    )
  );
$$;

create or replace function public.dawaa_current_actor_can(required_permissions text[])
returns boolean
language plpgsql
stable security definer
set search_path to 'public','auth','pg_temp'
as $$
declare
  v_staff_id uuid;
  v_role text;
  v_permissions jsonb;
  v_profile_role text;
  v_profile_active boolean;
  v_profile_permissions jsonb;
begin
  v_staff_id := public.dawaa_current_staff_account_id_strict();

  if v_staff_id is not null then
    select sa.role, public.get_user_permissions(sa.id)
      into v_role, v_permissions
    from public.staff_accounts sa
    where sa.id = v_staff_id
      and coalesce(sa.active,false)
      and coalesce(sa.can_login,false)
    limit 1;

    if found then
      if lower(trim(coalesce(v_role,''))) in ('general_manager','admin') then return true; end if;
      return public.dawaa_jsonb_has_true_any(coalesce(v_permissions,'{}'::jsonb), required_permissions);
    end if;
  end if;

  select lower(trim(coalesce(up.role,''))), coalesce(up.active,true), coalesce(up.permissions,'{}'::jsonb)
    into v_profile_role, v_profile_active, v_profile_permissions
  from public.user_profiles up
  where auth.uid() is not null
    and up.auth_user_id = auth.uid()
    and up.staff_account_id is null
  limit 1;

  if not found or not v_profile_active then return false; end if;
  if v_profile_role in ('مدير عام','أدمن','admin','general_manager','مدير') then return true; end if;
  return public.dawaa_jsonb_has_true_any(v_profile_permissions, required_permissions);
end;
$$;
