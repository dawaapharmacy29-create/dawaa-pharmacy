do $do$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname='attendance-resolution-v2-reconcile'
  limit 1;

  if v_job_id is null then
    raise exception 'attendance_resolution_v2_reconcile_job_missing';
  end if;

  perform cron.alter_job(
    v_job_id,
    schedule := '44 * * * *',
    command := null,
    database := null,
    username := null,
    active := true
  );

  perform cron.unschedule('attendance-dirty-queue-v1')
  where exists(select 1 from cron.job where jobname='attendance-dirty-queue-v1');

  perform cron.schedule(
    'attendance-dirty-queue-v1',
    '2-57/5 * * * *',
    $cmd$select public.dawaa_process_attendance_dirty_queue_v1(3);$cmd$
  );
end;
$do$;