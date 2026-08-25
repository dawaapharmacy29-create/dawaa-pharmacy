-- Active pg_cron jobs are scheduler-owned maintenance commands, not browser
-- RPC endpoints. Keep postgres/service execution and remove client execution.
do $revoke_client_execute$
declare
  routine record;
begin
  for routine in
    select distinct p.oid::regprocedure as signature
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and exists (
        select 1
        from cron.job job
        where job.active
          and job.command ilike '%public.' || p.proname || '(%'
      )
  loop
    execute format(
      'revoke execute on function %s from anon, authenticated',
      routine.signature
    );
  end loop;
end
$revoke_client_execute$;

-- Scheduled jobs must remain executable by their configured database user and
-- service_role, while no active scheduled routine may be exposed to clients.
do $assertion$
declare
  routine record;
begin
  for routine in
    select distinct p.oid, p.oid::regprocedure as signature, job.username
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    join cron.job job
      on job.active
     and job.command ilike '%public.' || p.proname || '(%'
    where n.nspname = 'public'
      and p.prosecdef
  loop
    if pg_catalog.has_function_privilege('anon', routine.oid, 'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated', routine.oid, 'EXECUTE') then
      raise exception 'scheduled routine remains executable by a client role: %',
        routine.signature;
    end if;

    if not pg_catalog.has_function_privilege(routine.username, routine.oid, 'EXECUTE')
       or not pg_catalog.has_function_privilege('service_role', routine.oid, 'EXECUTE') then
      raise exception 'scheduled routine lost scheduler/service execution: %',
        routine.signature;
    end if;
  end loop;
end
$assertion$;

notify pgrst, 'reload schema';
