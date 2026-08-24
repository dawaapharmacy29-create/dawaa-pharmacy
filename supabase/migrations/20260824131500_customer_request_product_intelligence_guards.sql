-- Product-intelligence helpers previously ran SECURITY DEFINER with broad execute
-- grants. Keep the scoring cores private and expose branch-scoped wrappers that
-- use the same Customer Requests view/manage authorization as the main workspace.

alter function public.get_customer_request_product_candidates_v2(uuid, integer)
  rename to get_customer_request_product_candidates_core_v2;
alter function public.get_customer_request_product_match_queue_v2(text, integer)
  rename to get_customer_request_product_match_queue_core_v2;
alter function public.auto_link_customer_request_products_v2(boolean, text)
  rename to auto_link_customer_request_products_core_v2;

revoke execute on function public.get_customer_request_product_candidates_core_v2(uuid, integer) from public, anon, authenticated;
revoke execute on function public.get_customer_request_product_match_queue_core_v2(text, integer) from public, anon, authenticated;
revoke execute on function public.auto_link_customer_request_products_core_v2(boolean, text) from public, anon, authenticated;
grant execute on function public.get_customer_request_product_candidates_core_v2(uuid, integer) to service_role;
grant execute on function public.get_customer_request_product_match_queue_core_v2(text, integer) to service_role;
grant execute on function public.auto_link_customer_request_products_core_v2(boolean, text) to service_role;

-- Preserve the legacy internal function name for the queue/autolink cores, but
-- never expose it directly to the browser roles. It checks the request branch
-- against the current app staff session before delegating to the scoring core.
create or replace function public.get_customer_request_product_candidates_v2(
  p_request_id uuid,
  p_limit integer default 5
)
returns table(
  product_id uuid,
  product_code text,
  product_name text,
  price numeric,
  match_score numeric,
  name_similarity numeric,
  alias_confirmations bigint,
  fulfilled_history bigint,
  movement_qty_180 numeric,
  movement_events_180 bigint,
  last_movement_date date,
  strength_match boolean,
  form_match boolean,
  blocked_reason text,
  confidence_label text
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_branch text;
begin
  if public.dawaa_current_staff_account_id_strict() is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select cr.branch into v_branch
  from public.customer_requests cr
  where cr.id = p_request_id;
  if not found then raise exception 'customer_request_not_found'; end if;

  if not public.dawaa_can_access_customer_request_branch('view_customer_requests', v_branch) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  return query
  select *
  from public.get_customer_request_product_candidates_core_v2(p_request_id, p_limit);
end;
$$;

revoke execute on function public.get_customer_request_product_candidates_v2(uuid, integer) from public, anon, authenticated;
grant execute on function public.get_customer_request_product_candidates_v2(uuid, integer) to service_role;

create or replace function public.get_customer_request_product_match_queue_v2(
  p_branch text default null,
  p_limit integer default 80
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor uuid := public.dawaa_current_staff_account_id_strict();
  v_role text;
  v_actor_branch text;
  v_effective_branch text;
begin
  if v_actor is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select lower(trim(coalesce(sa.role,''))), sa.branch
    into v_role, v_actor_branch
  from public.staff_accounts sa
  where sa.id = v_actor
    and coalesce(sa.active,false)
    and coalesce(sa.can_login,false)
  limit 1;
  if not found then raise exception 'not_authorized' using errcode = '42501'; end if;

  if p_branch is null or trim(p_branch) = '' or lower(trim(p_branch)) = 'all' then
    if v_role in ('general_manager','executive_manager','branches_manager','admin') then
      v_effective_branch := null;
    else
      v_effective_branch := v_actor_branch;
    end if;
  else
    if not public.dawaa_can_access_customer_request_branch('view_customer_requests', p_branch) then
      raise exception 'not_authorized' using errcode = '42501';
    end if;
    v_effective_branch := p_branch;
  end if;

  return public.get_customer_request_product_match_queue_core_v2(v_effective_branch, p_limit);
end;
$$;

create or replace function public.auto_link_customer_request_products_v2(
  p_apply boolean default false,
  p_branch text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor uuid := public.dawaa_current_staff_account_id_strict();
  v_role text;
  v_actor_branch text;
  v_effective_branch text;
  v_permission text := case when coalesce(p_apply,false) then 'manage_customer_requests' else 'view_customer_requests' end;
begin
  if v_actor is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select lower(trim(coalesce(sa.role,''))), sa.branch
    into v_role, v_actor_branch
  from public.staff_accounts sa
  where sa.id = v_actor
    and coalesce(sa.active,false)
    and coalesce(sa.can_login,false)
  limit 1;
  if not found then raise exception 'not_authorized' using errcode = '42501'; end if;

  if p_branch is null or trim(p_branch) = '' or lower(trim(p_branch)) = 'all' then
    if v_role in ('general_manager','executive_manager','branches_manager','admin') then
      if not public.dawaa_customer_request_permission_allowed(v_actor, v_permission) then
        raise exception 'not_authorized' using errcode = '42501';
      end if;
      v_effective_branch := null;
    else
      if not public.dawaa_can_access_customer_request_branch(v_permission, v_actor_branch) then
        raise exception 'not_authorized' using errcode = '42501';
      end if;
      v_effective_branch := v_actor_branch;
    end if;
  else
    if not public.dawaa_can_access_customer_request_branch(v_permission, p_branch) then
      raise exception 'not_authorized' using errcode = '42501';
    end if;
    v_effective_branch := p_branch;
  end if;

  return public.auto_link_customer_request_products_core_v2(coalesce(p_apply,false), v_effective_branch);
end;
$$;

revoke execute on function public.get_customer_request_product_match_queue_v2(text, integer) from public;
revoke execute on function public.auto_link_customer_request_products_v2(boolean, text) from public;
grant execute on function public.get_customer_request_product_match_queue_v2(text, integer) to anon, authenticated, service_role;
grant execute on function public.auto_link_customer_request_products_v2(boolean, text) to anon, authenticated, service_role;
