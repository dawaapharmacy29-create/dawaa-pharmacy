-- Security fix: restore the authorization check on materialize_attendance_range_v2.
--
-- 20261009053258 attendance_canonical_compatibility_cutover_v1 replaced the guarded wrapper
-- (20260906171400: active staff actor + top management) with a bare `language sql` call to
-- dawaa_materialize_attendance_range_route_aware_v1 and granted it to anon. Any holder of the public
-- anon key could re-materialize every Shamy/Shokry staff member for 46 days: heavy writes, rewritten
-- pending rows, auto-approved days and impact-ledger rows that feed payroll, with no branch scope.
--
-- This restores the original check and keeps the canonical route-aware target. Identity comes only
-- from dawaa_current_staff_account_id_strict(). The cron job attendance-resolution-v2-reconcile calls the
-- internal route-aware function directly and is not affected.
-- Rollback: supabase/sql/ROLLBACK_20261009_attendance_materialize_range_v2_guard_v1.sql (re-opens the hole).

do $$
begin
  if to_regprocedure('public.dawaa_materialize_attendance_range_route_aware_v1(date,date,text)') is null then
    raise exception 'materialize guard: route-aware materializer missing';
  end if;
  if to_regprocedure('public.dawaa_actor_is_top_management_v1()') is null then
    raise exception 'materialize guard: dawaa_actor_is_top_management_v1 missing';
  end if;
end $$;

create or replace function public.materialize_attendance_range_v2(
  p_start date,
  p_end date,
  p_branch text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor public.staff_accounts%rowtype;
begin
  select * into v_actor
  from public.staff_accounts sa
  where sa.id = public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active,false) = true
    and coalesce(sa.can_login,false) = true;
  if not found or not public.dawaa_actor_is_top_management_v1() then
    raise exception 'not_authorized_for_attendance_materialization' using errcode = '42501';
  end if;
  return public.dawaa_materialize_attendance_range_route_aware_v1(p_start, p_end, p_branch);
end;
$function$;

revoke all on function public.materialize_attendance_range_v2(date,date,text) from public;
grant execute on function public.materialize_attendance_range_v2(date,date,text) to anon, authenticated, service_role;

comment on function public.materialize_attendance_range_v2(date,date,text) is
  'UI refresh of attendance truth for a range. Requires an active top-management staff actor (verified identity); routes through the canonical route-aware materializer.';
