do $do$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname='attendance-resolution-v2-reconcile' limit 1;
  if v_job_id is null then
    raise exception 'attendance_safety_job_not_found';
  end if;

  perform cron.alter_job(
    v_job_id,
    schedule => '44 * * * *',
    command => $$select public.dawaa_materialize_attendance_range_route_aware_v1(((now() at time zone 'Africa/Cairo')::date-1),(now() at time zone 'Africa/Cairo')::date,null);$$,
    active => true
  );
end;
$do$;