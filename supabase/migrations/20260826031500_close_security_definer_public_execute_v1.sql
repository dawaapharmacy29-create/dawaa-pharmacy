-- SECURITY DEFINER routines are privileged API boundaries. Client access must
-- always be explicit; inherited PUBLIC execution makes every new routine an
-- accidental endpoint.
do $revoke_public$
declare
  routine record;
begin
  for routine in
    select p.oid::regprocedure as signature
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
  loop
    execute format(
      'revoke execute on function %s from public',
      routine.signature
    );
  end loop;
end
$revoke_public$;

-- PostgreSQL grants function execution to PUBLIC by default. Make explicit
-- grants mandatory for all future routines owned by the migration role.
alter default privileges for role postgres in schema public
  revoke execute on functions from public;

-- Fail closed if any privileged routine still has a direct PUBLIC grant.
do $assertion$
begin
  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    join lateral pg_catalog.aclexplode(
      coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) acl on true
    where n.nspname = 'public'
      and p.prosecdef
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'SECURITY DEFINER routine remains executable by PUBLIC';
  end if;
end
$assertion$;

notify pgrst, 'reload schema';
