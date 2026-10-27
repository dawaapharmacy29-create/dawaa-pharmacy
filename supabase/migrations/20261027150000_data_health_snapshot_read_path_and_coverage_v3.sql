-- /data-health production parity. Read-only diagnostics; no business data is written.
--
-- 1. get_app_data_health_v2 recomputed compute_app_data_health_v2() inside the page
--    request whenever its cache was older than 2 minutes. Measured on production
--    (2026-10-27): 19.85 s per compute, above the anon statement_timeout (15 s), so
--    every call was cancelled (HTTP 500) and the cache never refreshed (last success
--    46 days earlier). This carries forward the reviewed design of
--    20260822_decouple_app_data_health_refresh.sql, which never reached production:
--    pages read the snapshot; a cron job refreshes it. Interval is 30 minutes (not 5)
--    so a ~20 s diagnostic costs ~1% of database time instead of ~7%.
-- 2. get_compensation_profile_coverage_v3 (from 20260826163000, never applied in
--    production) is the read-only manager audit the points panel calls. Only the
--    function is installed; the rest of that migration is out of scope. All its
--    dependencies exist in production. It authorizes the actor itself, so EXECUTE
--    follows the session model of its sibling get_points_architecture_health_v3.

create or replace function public.refresh_app_data_health_v2()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  r jsonb;
begin
  r := public.compute_app_data_health_v2();

  insert into public.app_data_health_cache(cache_key, payload, computed_at)
  values ('main', r, now())
  on conflict (cache_key)
  do update set
    payload = excluded.payload,
    computed_at = excluded.computed_at;

  return r || jsonb_build_object('cache_age_seconds', 0, 'cached', false, 'stale', false);
end;
$function$;

revoke all on function public.refresh_app_data_health_v2() from public, anon, authenticated;

create or replace function public.get_app_data_health_v2()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  r jsonb;
  t timestamptz;
  age_seconds integer;
begin
  select payload, computed_at
  into r, t
  from public.app_data_health_cache
  where cache_key = 'main';

  -- Bootstrap only: normal interactive reads never invoke the expensive compute.
  if r is null then
    return public.refresh_app_data_health_v2();
  end if;

  age_seconds := extract(epoch from (now() - t))::int;

  return r || jsonb_build_object(
    'cache_age_seconds', age_seconds,
    'cached', true,
    'stale', age_seconds > 3600
  );
end;
$function$;

-- Keep a single named job across repeated applications.
do $block$
begin
  if exists (select 1 from cron.job where jobname = 'refresh-app-data-health-v2') then
    perform cron.unschedule('refresh-app-data-health-v2');
  end if;

  perform cron.schedule(
    'refresh-app-data-health-v2',
    '*/30 * * * *',
    'select public.refresh_app_data_health_v2();'
  );
end;
$block$;

comment on function public.get_app_data_health_v2() is
  'Fast read path for the cached application data-health snapshot. Expensive refresh runs separately.';
comment on function public.refresh_app_data_health_v2() is
  'Refreshes the cached application data-health snapshot; cron/admin only, never a page render path.';

create or replace function public.get_compensation_profile_coverage_v3(
  p_branch text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_role text := lower(trim(coalesce(public.employee_operating_actor_role(), '')));
  v_actor_branch text := nullif(trim(coalesce(public.employee_operating_actor_branch(), '')), '');
  v_requested_branch text := nullif(trim(coalesce(p_branch, '')), '');
  v_global boolean := v_role in ('general_manager', 'admin', 'executive_manager', 'branches_manager');
  v_result jsonb;
begin
  if not (v_global or v_role in ('branch_manager', 'customer_service_manager')) then
    raise exception 'not_authorized';
  end if;

  if not v_global then
    if v_actor_branch is null then
      raise exception 'manager_branch_missing';
    end if;
    if v_requested_branch is not null and v_requested_branch is distinct from v_actor_branch then
      raise exception 'not_authorized_for_branch';
    end if;
    v_requested_branch := v_actor_branch;
  end if;

  with active_staff as (
    select s.id, s.name, s.role, s.branch
    from public.staff s
    where coalesce(s.active, s.is_active, true)
      and coalesce(s.status, 'active') not in ('inactive', 'deleted', 'disabled')
      and (v_requested_branch is null or s.branch = v_requested_branch)
  ), latest_profile as (
    select distinct on (ecp.staff_id)
      ecp.staff_id,
      ecp.monthly_incentive_base,
      ecp.point_value,
      ecp.effective_from
    from public.employee_compensation_profiles ecp
    where coalesce(ecp.active, true)
      and coalesce(ecp.effective_from, current_date) <= current_date
    order by ecp.staff_id, ecp.effective_from desc nulls last, ecp.updated_at desc nulls last
  ), coverage as (
    select
      s.id as staff_id,
      s.name as staff_name,
      coalesce(s.role, '') as staff_role,
      coalesce(s.branch, '') as branch,
      p.staff_id is not null
        and coalesce(p.monthly_incentive_base, 0) > 0
        and coalesce(p.point_value, 0) > 0 as profile_configured,
      case when p.staff_id is null then 'missing_profile'
           when coalesce(p.monthly_incentive_base, 0) <= 0 then 'invalid_monthly_base'
           when coalesce(p.point_value, 0) <= 0 then 'invalid_point_value'
           else 'configured'
      end as coverage_status
    from active_staff s
    left join latest_profile p on p.staff_id = s.id::text
  ), by_role as (
    select
      staff_role,
      count(*)::int as staff_count,
      count(*) filter (where profile_configured)::int as configured_count,
      count(*) filter (where not profile_configured)::int as missing_count
    from coverage
    group by staff_role
  )
  select jsonb_build_object(
    'engine_version', 3,
    'scope_branch', coalesce(v_requested_branch, 'كل الفروع'),
    'active_staff', (select count(*) from coverage),
    'configured_profiles', (select count(*) from coverage where profile_configured),
    'missing_profiles', (select count(*) from coverage where not profile_configured),
    'coverage_pct', case
      when (select count(*) from coverage) = 0 then 100
      else round(
        100.0 * (select count(*) from coverage where profile_configured)
        / (select count(*) from coverage),
        1
      )
    end,
    'roles', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'role', r.staff_role,
          'staff_count', r.staff_count,
          'configured_count', r.configured_count,
          'missing_count', r.missing_count
        )
        order by r.missing_count desc, r.staff_count desc, r.staff_role
      )
      from by_role r
    ), '[]'::jsonb),
    'missing_staff', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'staff_id', c.staff_id,
          'staff_name', c.staff_name,
          'staff_role', c.staff_role,
          'branch', c.branch,
          'status', c.coverage_status
        )
        order by c.branch, c.staff_role, c.staff_name
      )
      from coverage c
      where not c.profile_configured
    ), '[]'::jsonb),
    'generated_at', now()
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_compensation_profile_coverage_v3(text) from public;
grant execute on function public.get_compensation_profile_coverage_v3(text) to anon, authenticated;

comment on function public.get_compensation_profile_coverage_v3(text) is
  'Manager-only compensation coverage audit. Reports missing/invalid profiles without inventing payout values.';

notify pgrst, 'reload schema';
