create or replace function public.dawaa_jsonb_has_true_any(p_permissions jsonb, p_keys text[])
returns boolean
language sql
immutable
as $$
  select coalesce(bool_or(coalesce((p_permissions ->> k)::boolean, false)), false)
  from unnest(coalesce(p_keys, '{}'::text[])) as k
  where p_permissions ? k;
$$;

create or replace function public.dawaa_current_actor_can(required_permissions text[])
returns boolean
language plpgsql
stable security definer
set search_path to 'public','auth','pg_temp'
as $$
declare
  v_staff_id uuid;
  v_auth_id uuid := auth.uid();
  v_role text;
  v_active boolean;
  v_can_login boolean;
  v_permissions jsonb;
  v_profile_role text;
  v_profile_active boolean;
  v_profile_permissions jsonb;
begin
  v_staff_id := public.dawaa_request_staff_id();

  select sa.role, coalesce(sa.active,false), coalesce(sa.can_login,false), public.get_user_permissions(sa.id)
    into v_role, v_active, v_can_login, v_permissions
  from public.staff_accounts sa
  where (v_staff_id is not null and sa.id = v_staff_id)
     or (v_auth_id is not null and sa.auth_user_id = v_auth_id)
  order by case when v_staff_id is not null and sa.id = v_staff_id then 0 else 1 end
  limit 1;

  if found then
    if not v_active or not v_can_login then return false; end if;
    if lower(trim(coalesce(v_role,''))) in ('general_manager','admin') then return true; end if;
    return public.dawaa_jsonb_has_true_any(coalesce(v_permissions,'{}'::jsonb), required_permissions);
  end if;

  select lower(trim(coalesce(up.role,''))), coalesce(up.active,true), coalesce(up.permissions,'{}'::jsonb)
    into v_profile_role, v_profile_active, v_profile_permissions
  from public.user_profiles up
  where v_auth_id is not null and up.auth_user_id = v_auth_id
  limit 1;

  if not found or not v_profile_active then return false; end if;
  if v_profile_role in ('مدير عام','أدمن','admin','general_manager','مدير') then return true; end if;
  return public.dawaa_jsonb_has_true_any(v_profile_permissions, required_permissions);
end;
$$;

create or replace function public.current_user_branch_access_v1(p_branch text, p_allow_global boolean default true)
returns boolean
language plpgsql
stable security definer
set search_path to 'public','auth','pg_temp'
as $$
declare
  v_role text;
  v_branch text;
  v_row_branch text;
  v_user_branch text;
begin
  if auth.uid() is null then return false; end if;

  select sa.role, sa.branch into v_role, v_branch
  from public.staff_accounts sa
  where (sa.id = auth.uid() or sa.auth_user_id = auth.uid())
    and coalesce(sa.active,false) = true
    and coalesce(sa.can_login,false) = true
  limit 1;

  if v_role is null then return false; end if;
  if v_role in ('general_manager','executive_manager','branches_manager','procurement_manager') then return true; end if;

  v_row_branch := lower(btrim(regexp_replace(coalesce(p_branch,''), '^\s*فرع\s+', '', 'i')));
  v_user_branch := lower(btrim(regexp_replace(coalesce(v_branch,''), '^\s*فرع\s+', '', 'i')));
  if p_allow_global and v_row_branch in ('','كل الفروع','all','all branches') then return true; end if;
  return v_user_branch <> '' and v_row_branch = v_user_branch;
end;
$$;

create or replace function public.current_user_expiry_permission_v1(p_write boolean default false)
returns boolean
language plpgsql
stable security definer
set search_path to 'public','auth','pg_temp'
as $$
declare
  v_id uuid;
  v_role text;
  v_permissions jsonb;
  v_key text;
  v_default_allowed boolean := false;
begin
  if auth.uid() is null then return false; end if;
  select sa.id, sa.role into v_id, v_role
  from public.staff_accounts sa
  where (sa.id = auth.uid() or sa.auth_user_id = auth.uid())
    and coalesce(sa.active,false) = true
    and coalesce(sa.can_login,false) = true
  limit 1;
  if v_id is null then return false; end if;

  v_key := case when p_write then 'manage_medicines' else 'view_expiry_tracker' end;
  v_permissions := public.get_user_permissions(v_id);
  if v_permissions ? v_key then return coalesce((v_permissions ->> v_key)::boolean,false); end if;

  if p_write then
    v_default_allowed := v_role in ('general_manager','executive_manager','branches_manager','procurement_manager','branch_manager','inventory_assistant');
  else
    v_default_allowed := v_role in ('general_manager','executive_manager','branches_manager','procurement_manager','branch_manager','pharmacist','inventory_assistant');
  end if;
  return v_default_allowed;
end;
$$;

create or replace function public.resolve_active_branch_manager(p_branch text)
returns table(manager_staff_id uuid, manager_name text)
language sql
stable security definer
set search_path to 'public'
as $$
  select
    case when sa.staff_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then sa.staff_id::uuid else null end,
    coalesce(nullif(trim(sa.staff_name),''), nullif(trim(sa.name),''), nullif(trim(sa.username),''))
  from public.staff_accounts sa
  where coalesce(sa.active,false) = true
    and coalesce(sa.can_login,false) = true
    and sa.role = 'branch_manager'
    and sa.branch = p_branch
  order by sa.updated_at desc nulls last, sa.created_at desc nulls last
  limit 1;
$$;

create or replace function public.dawaa_require_customer_service_actor_v1(p_manager_only boolean default false)
returns staff_accounts
language plpgsql
stable security definer
set search_path to 'public','auth','pg_catalog'
as $$
declare
  v_id uuid;
  v_actor public.staff_accounts;
  v_role text;
  v_perms jsonb;
  v_can_manage boolean;
begin
  v_id := public.dawaa_current_staff_account_id_strict();
  if v_id is null then raise exception 'يجب تسجيل الدخول بحساب موظف نشط'; end if;

  select * into v_actor from public.staff_accounts
  where id = v_id and coalesce(active,false) and coalesce(can_login,false);
  if not found then raise exception 'حساب الموظف غير نشط أو غير مصرح له'; end if;

  v_role := lower(trim(coalesce(v_actor.role,'')));
  v_perms := public.get_user_permissions(v_id);
  v_can_manage := v_role in ('general_manager','executive_manager','branches_manager','branch_manager','customer_service_manager')
    or public.dawaa_jsonb_has_true_any(v_perms, array['assign_followup','manage_customer_requests']);

  if p_manager_only and not v_can_manage then
    raise exception 'الأرشفة والاستعادة متاحة للمدير أو مسؤول خدمة العملاء المخول فقط';
  end if;
  return v_actor;
end;
$$;
