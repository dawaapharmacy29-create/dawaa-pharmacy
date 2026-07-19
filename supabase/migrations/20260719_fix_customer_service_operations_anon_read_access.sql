begin;

-- The application uses its own staff login while Supabase requests can still run
-- under the anon database role. The operations center is read-only, so expose
-- only the read paths required by the UI and keep all write RPCs restricted.
revoke all on function public.dawaa_customer_service_stats_v2(text) from public;
grant execute on function public.dawaa_customer_service_stats_v2(text)
  to anon, authenticated, service_role;

grant select on public.customer_followup_operations_v2
  to anon, authenticated, service_role;

grant select on public.customer_followup_events
  to anon, authenticated, service_role;

commit;
