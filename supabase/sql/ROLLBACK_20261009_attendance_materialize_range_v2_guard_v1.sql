-- ROLLBACK REFERENCE ONLY — not a migration.
-- Reverts 20261009070000_attendance_materialize_range_v2_guard_v1.sql to the production definition of
-- 2026-10-09 (md5(pg_get_functiondef) = 42216198a9a8a88296f0a87b65bdbd44).
-- WARNING: this re-opens unauthenticated materialization. Use only to recover from an outage.
create or replace function public.materialize_attendance_range_v2(p_start date, p_end date, p_branch text DEFAULT NULL::text)
 returns jsonb
 language sql
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
  select public.dawaa_materialize_attendance_range_route_aware_v1(p_start,p_end,p_branch)
$function$;
revoke all on function public.materialize_attendance_range_v2(date,date,text) from public;
grant execute on function public.materialize_attendance_range_v2(date,date,text) to anon, authenticated, service_role;
