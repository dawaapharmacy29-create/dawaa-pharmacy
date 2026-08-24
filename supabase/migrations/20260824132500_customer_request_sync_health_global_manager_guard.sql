-- Sync-health contains global integration/inbox state, so branch-scoped customer
-- service managers should not receive the cross-branch feed. Restrict it to roles
-- that already have all-branches Customer Request scope.

create or replace function public.get_customer_request_sync_health_v2()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor uuid := public.dawaa_current_staff_account_id_strict();
  v_role text;
begin
  if v_actor is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select lower(trim(coalesce(sa.role,''))) into v_role
  from public.staff_accounts sa
  where sa.id = v_actor
    and coalesce(sa.active,false)
    and coalesce(sa.can_login,false)
  limit 1;

  if v_role not in ('general_manager','executive_manager','branches_manager','admin') then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  return public.get_customer_request_sync_health_v1();
end;
$$;

revoke execute on function public.get_customer_request_sync_health_v2() from public;
grant execute on function public.get_customer_request_sync_health_v2() to anon, authenticated, service_role;
