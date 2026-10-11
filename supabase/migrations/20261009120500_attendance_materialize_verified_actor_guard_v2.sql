-- Security boundary: bind attendance range materialization to the verified Dawaa staff actor.
--
-- The canonical compatibility cutover kept the route-aware materializer, but exposed the wrapper
-- to browser roles without re-applying the original active/top-management authorization guard.
-- The UI does not send an actor id; identity must come only from the verified current staff session.
-- This migration changes no attendance calculation logic and does not touch existing rows by itself.

do $$
begin
  if to_regprocedure('public.dawaa_materialize_attendance_range_route_aware_v1(date,date,text)') is null then
    raise exception 'materialize guard: route-aware materializer missing';
  end if;
  if to_regprocedure('public.dawaa_current_staff_account_id_strict()') is null then
    raise exception 'materialize guard: strict staff identity helper missing';
  end if;
  if to_regprocedure('public.dawaa_actor_is_top_management_v1()') is null then
    raise exception 'materialize guard: top-management authorization helper missing';
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
  'UI refresh of attendance truth for a range. Requires an active top-management staff actor resolved from verified identity; routes through the canonical route-aware materializer.';
