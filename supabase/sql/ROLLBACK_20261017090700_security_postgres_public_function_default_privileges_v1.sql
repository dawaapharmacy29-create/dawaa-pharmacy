-- EMERGENCY RECOVERY for 20261017090700_security_postgres_public_function_default_privileges_v1.
--
-- Restores the exact reviewed PRE state of the postgres/public/function default ACL captured read-only from
-- Production on 2026-10-17:
--   postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, service_role=X/postgres
--
-- This affects FUTURE functions only. It does not change ACLs on existing functions and touches no business rows.
-- Re-opening implicit anon/authenticated EXECUTE is a security regression; use only if the 090700 default-ACL
-- change itself causes a confirmed operational emergency, then re-apply the forward hardening after correction.

begin;

do $preflight$
begin
  if current_user <> 'postgres' or session_user <> 'postgres' then
    raise exception '090700 recovery: expected postgres/postgres executor, got current_user=% session_user=%',
      current_user, session_user;
  end if;
  if pg_has_role(current_user, 'supabase_admin', 'member') then
    raise exception '090700 recovery: postgres unexpectedly has supabase_admin membership; stop and re-review';
  end if;
end
$preflight$;

-- Remove the hardened default entries first, including PUBLIC, then recreate the captured explicit PRE ACL.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  grant execute on functions to postgres, anon, authenticated, service_role;

-- Verify the exact explicit PRE grantee set for EXECUTE.
do $post$
declare
  v_actual text[];
  v_expected constant text[] := array['anon','authenticated','postgres','service_role'];
begin
  select coalesce(array_agg(coalesce(r.rolname, 'PUBLIC') order by coalesce(r.rolname, 'PUBLIC')), '{}')
    into v_actual
  from pg_default_acl d
  cross join lateral aclexplode(d.defaclacl) x
  left join pg_roles r on r.oid = x.grantee
  where d.defaclrole = 'postgres'::regrole
    and d.defaclnamespace = 'public'::regnamespace
    and d.defaclobjtype = 'f'
    and x.privilege_type = 'EXECUTE';

  if v_actual is distinct from v_expected then
    raise exception '090700 recovery: restored default ACL differs from captured PRE state: actual %, expected %',
      v_actual, v_expected;
  end if;
end
$post$;

commit;
