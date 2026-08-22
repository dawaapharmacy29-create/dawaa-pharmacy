-- Decouple expensive app-wide health computation from interactive page reads.
--
-- Previous behavior:
-- get_app_data_health_v2() recomputed the complete health payload whenever the
-- cache was older than 2 minutes. pg_stat_statements showed ~10s mean execution,
-- making the first user after cache expiry pay the full diagnostic cost.
--
-- New behavior:
-- - refresh_app_data_health_v2() owns the expensive compute/upsert path;
-- - get_app_data_health_v2() reads the last snapshot immediately;
-- - pg_cron refreshes the snapshot every 5 minutes;
-- - on a fresh database with no snapshot, the getter may compute once so the
--   product remains self-bootstrapping.

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

  return r || jsonb_build_object(
    'cache_age_seconds', 0,
    'cached', false,
    'stale', false
  );
end;
$function$;

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
    'stale', age_seconds > 600
  );
end;
$function$;

-- Keep a single named job across repeated/rebased migrations.
do $block$
begin
  if exists (
    select 1
    from cron.job
    where jobname = 'refresh-app-data-health-v2'
  ) then
    perform cron.unschedule('refresh-app-data-health-v2');
  end if;

  perform cron.schedule(
    'refresh-app-data-health-v2',
    '*/5 * * * *',
    'select public.refresh_app_data_health_v2();'
  );
end;
$block$;

comment on function public.get_app_data_health_v2() is
  'Fast read path for the cached application data-health snapshot. Expensive refresh runs separately.';

comment on function public.refresh_app_data_health_v2() is
  'Refreshes the cached application data-health snapshot; intended for cron/admin use, not page render paths.';
