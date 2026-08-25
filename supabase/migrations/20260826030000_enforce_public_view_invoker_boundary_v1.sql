-- Public views must execute with the caller's privileges so their source-table
-- grants and RLS policies remain the authorization boundary.
do $migration$
declare
  candidate record;
begin
  for candidate in
    select c.oid::regclass as qualified_name
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'v'
      and not coalesce(c.reloptions, array[]::text[])
        @> array['security_invoker=true']
  loop
    execute format(
      'alter view %s set (security_invoker=true)',
      candidate.qualified_name
    );
  end loop;
end
$migration$;

-- These are internal diagnostic projections. They have no application caller,
-- and exposing them would require granting access to deliberately private tables.
revoke all on table public.dawaa_customer_phone_quality_summary_v2
  from public, anon, authenticated;
revoke all on table public.notification_delivery_health_v1
  from public, anon, authenticated;
revoke all on table public.dawaa_data_health_customer_metrics_mismatch_v1
  from public, anon, authenticated;

-- staff_payroll_summary is the stable application projection and delegates to
-- this versioned view. Both layers now use the same caller/RLS boundary.
grant select on table public.dawaa_staff_payroll_summary_v13 to anon;

-- Fail the migration rather than silently leaving a definer-rights view in the
-- API-exposed schema.
do $assertion$
begin
  if exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'v'
      and not coalesce(c.reloptions, array[]::text[])
        @> array['security_invoker=true']
  ) then
    raise exception 'public view security_invoker boundary is incomplete';
  end if;
end
$assertion$;
