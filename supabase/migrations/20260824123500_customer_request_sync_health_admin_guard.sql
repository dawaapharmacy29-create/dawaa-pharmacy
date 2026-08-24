-- Sync-health includes inbox/global integration metadata and recent request samples.
-- Keep the legacy implementation private to service_role and expose an app-facing
-- wrapper only to explicitly authorized Customer Request data-quality managers.

revoke execute on function public.get_customer_request_sync_health_v1() from public, anon, authenticated;
grant execute on function public.get_customer_request_sync_health_v1() to service_role;

create or replace function public.get_customer_request_sync_health_v2()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
begin
  if not public.dawaa_customer_request_staff_attribution_admin_allowed() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return public.get_customer_request_sync_health_v1();
end;
$$;

revoke execute on function public.get_customer_request_sync_health_v2() from public;
grant execute on function public.get_customer_request_sync_health_v2() to anon, authenticated, service_role;
