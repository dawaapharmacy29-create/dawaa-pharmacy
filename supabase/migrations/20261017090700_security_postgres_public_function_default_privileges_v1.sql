-- SECURITY: make future application functions in public fail closed by default.
--
-- Production migrations run as the managed `postgres` role. Current Production catalog review (2026-10-17):
--   * current_user/session_user = postgres;
--   * postgres is NOT a member of managed role supabase_admin;
--   * all non-extension functions in public are postgres-owned;
--   * the 31 supabase_admin-owned public functions are pg_trgm extension members and none is SECURITY DEFINER.
--
-- Therefore this migration deliberately changes ONLY postgres/public/function defaults. It does NOT attempt
-- privilege escalation, SET ROLE supabase_admin, or ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin.
-- The live identity contract separately fails if a non-extension/sensitive supabase_admin-owned public function
-- appears later, so that managed-role residual cannot silently become application authorization surface.
--
-- Existing functions are unchanged. This affects future functions created by postgres in schema public only.
-- Client-facing RPCs must grant EXECUTE explicitly; internal helpers remain closed unless deliberately granted.
-- No business-row DML.

do $preflight$
declare
  v_unreviewed_owner text;
  v_managed_sensitive text;
begin
  if current_user <> 'postgres' or session_user <> 'postgres' then
    raise exception 'default privileges v1: expected managed Production executor postgres/postgres, got current_user=% session_user=%',
      current_user, session_user;
  end if;

  if pg_has_role(current_user, 'supabase_admin', 'member') then
    raise exception 'default privileges v1: postgres unexpectedly has supabase_admin membership; re-review without privilege escalation';
  end if;

  -- Application/public functions must be owned by the migration role unless they belong to an extension.
  select string_agg(p.oid::regprocedure::text || ' owner=' || pg_get_userbyid(p.proowner), ', ' order by 1)
    into v_unreviewed_owner
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and pg_get_userbyid(p.proowner) <> 'postgres'
    and not exists (
      select 1
      from pg_depend d
      where d.classid = 'pg_proc'::regclass
        and d.objid = p.oid
        and d.deptype = 'e'
    );
  if v_unreviewed_owner is not null then
    raise exception 'default privileges v1: non-extension public functions are not postgres-owned: %', v_unreviewed_owner;
  end if;

  -- Managed-role public functions are acceptable only as non-SECURITY-DEFINER extension members.
  select string_agg(p.oid::regprocedure::text, ', ' order by 1)
    into v_managed_sensitive
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and pg_get_userbyid(p.proowner) = 'supabase_admin'
    and (
      p.prosecdef
      or not exists (
        select 1
        from pg_depend d
        where d.classid = 'pg_proc'::regclass
          and d.objid = p.oid
          and d.deptype = 'e'
      )
    );
  if v_managed_sensitive is not null then
    raise exception 'default privileges v1: unreviewed supabase_admin public functions exist: %', v_managed_sensitive;
  end if;
end
$preflight$;

-- Scope is intentionally narrow: the creator role used by application migrations + schema public only.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

alter default privileges for role postgres in schema public
  grant execute on functions to service_role;

-- Verify the effective postgres/public/function default ACL. No client role may inherit EXECUTE implicitly.
do $post$
declare
  v_bad text;
  v_service_execute boolean := false;
begin
  select string_agg(coalesce(r.rolname, 'PUBLIC') || ':' || x.privilege_type, ', ' order by 1)
    into v_bad
  from pg_default_acl d
  cross join lateral aclexplode(d.defaclacl) x
  left join pg_roles r on r.oid = x.grantee
  where d.defaclrole = 'postgres'::regrole
    and d.defaclnamespace = 'public'::regnamespace
    and d.defaclobjtype = 'f'
    and x.privilege_type = 'EXECUTE'
    and (x.grantee = 0 or r.rolname in ('anon','authenticated'));

  if v_bad is not null then
    raise exception 'default privileges v1: client EXECUTE remains in postgres/public function defaults: %', v_bad;
  end if;

  select exists (
    select 1
    from pg_default_acl d
    cross join lateral aclexplode(d.defaclacl) x
    join pg_roles r on r.oid = x.grantee
    where d.defaclrole = 'postgres'::regrole
      and d.defaclnamespace = 'public'::regnamespace
      and d.defaclobjtype = 'f'
      and r.rolname = 'service_role'
      and x.privilege_type = 'EXECUTE'
  ) into v_service_execute;

  if not v_service_execute then
    raise exception 'default privileges v1: service_role EXECUTE missing from postgres/public function defaults';
  end if;
end
$post$;
