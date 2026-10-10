-- Shared SECURITY DEFINER actor helpers must never trust a client-supplied account UUID.
-- Keep signatures for compatibility, but bind authorization to the canonical session actor.

create or replace function public.dawaa_can_manage_branch_targets(p_actor_id uuid default null)
returns boolean
language plpgsql
stable security definer
set search_path to 'public','auth','pg_temp'
as $function$
declare
  v_session_id uuid:=public.dawaa_current_staff_account_id_strict();
  v_role text;
  v_permissions jsonb;
begin
  if v_session_id is null then return false; end if;
  if p_actor_id is not null and p_actor_id is distinct from v_session_id then return false; end if;
  select lower(trim(coalesce(sa.role,''))),public.get_user_permissions(sa.id)
    into v_role,v_permissions
  from public.staff_accounts sa
  where sa.id=v_session_id and coalesce(sa.active,false) and coalesce(sa.can_login,false)
  limit 1;
  if not found then return false; end if;
  if v_role in ('general_manager','executive_manager','branches_manager','branch_manager') then return true; end if;
  return coalesce((v_permissions->>'manage_settings')::boolean,false);
end;
$function$;

create or replace function public.dawaa_shortage_permission_allowed_v1(
  p_actor_id uuid,p_permission text
)
returns boolean
language plpgsql
stable security definer
set search_path=public,pg_catalog
as $function$
declare
  v_session_id uuid:=public.dawaa_current_staff_account_id_strict();
  v_role text;
  v_permissions jsonb:='{}'::jsonb;
  v_override boolean;
  v_role_allowed boolean:=false;
begin
  if v_session_id is null or p_permission not in ('view_shortages','manage_shortages') then return false; end if;
  if p_actor_id is not null and p_actor_id is distinct from v_session_id then return false; end if;

  select lower(trim(coalesce(sa.role,''))),coalesce(sa.permissions,'{}'::jsonb)
    into v_role,v_permissions
  from public.staff_accounts sa
  where sa.id=v_session_id and coalesce(sa.active,false) and coalesce(sa.can_login,false)
  limit 1;
  if not found then return false; end if;

  v_role_allowed:=v_role in (
    'general_manager','executive_manager','branches_manager','admin',
    'branch_manager','procurement_manager','inventory_assistant'
  );
  if v_permissions?p_permission then
    v_role_allowed:=v_role_allowed and coalesce((v_permissions->>p_permission)::boolean,false);
  end if;

  select spo.allowed into v_override
  from public.staff_permission_overrides spo
  where spo.staff_account_id=v_session_id and spo.permission_key=p_permission
  order by spo.created_at desc,spo.id desc limit 1;
  if found then v_role_allowed:=v_role_allowed and coalesce(v_override,false); end if;
  return v_role_allowed;
end;
$function$;

-- Review coverage helper is also executable; bind its actor argument to the session.
create or replace function public.dawaa_can_access_review_coverage_branch_v1(
  p_actor_id uuid,p_branch text,p_write boolean default false
)
returns boolean
language plpgsql
stable security definer
set search_path=public,auth,pg_catalog
as $function$
declare
  v_session_id uuid:=public.dawaa_current_staff_account_id_strict();
  v_role text;
  v_actor_branch text;
  v_required_permission text:=case when p_write then 'approve_reviews' else 'view_reviews' end;
begin
  if v_session_id is null then return false; end if;
  if p_actor_id is not null and p_actor_id is distinct from v_session_id then return false; end if;
  select sa.role,sa.branch into v_role,v_actor_branch
  from public.staff_accounts sa
  where sa.id=v_session_id and coalesce(sa.active,false) and coalesce(sa.can_login,false)
  limit 1;
  if v_role is null then return false; end if;
  if not public.user_has_permission(v_session_id,v_required_permission) then return false; end if;
  if v_role in ('general_manager','executive_manager','branches_manager')
     and public.dawaa_review_coverage_branch_key_v1(v_actor_branch) in ('كل الفروع','all','all branches') then
    return true;
  end if;
  return public.dawaa_review_coverage_branch_key_v1(v_actor_branch)
       =public.dawaa_review_coverage_branch_key_v1(p_branch);
end;
$function$;

notify pgrst,'reload schema';
