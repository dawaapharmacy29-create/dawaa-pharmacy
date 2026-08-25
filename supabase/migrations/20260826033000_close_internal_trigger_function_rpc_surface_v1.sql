-- Trigger functions are invoked by their trigger bindings, not through the
-- browser RPC surface. Keep service ownership intact and remove client calls.
do $revoke_client_execute$
declare
  routine record;
begin
  for routine in
    select p.oid::regprocedure as signature
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.prorettype in ('trigger'::regtype, 'event_trigger'::regtype)
  loop
    execute format(
      'revoke execute on function %s from anon, authenticated',
      routine.signature
    );
  end loop;
end
$revoke_client_execute$;

-- Fail closed if an internal trigger entry point is re-exposed as a browser
-- RPC. Trigger bindings continue to invoke their functions internally.
do $assertion$
begin
  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.prorettype in ('trigger'::regtype, 'event_trigger'::regtype)
      and (
        pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
        or pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
      )
  ) then
    raise exception 'internal trigger function remains executable by a client role';
  end if;
end
$assertion$;

notify pgrst, 'reload schema';
