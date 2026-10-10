-- ROLLBACK REFERENCE ONLY — not a migration.
-- Reverts migration 20261008120000_verified_staff_session_identity_v1.sql.
-- The exact previous definitions (pg_get_functiondef) of all 59 functions it rewrote were captured
-- by the migration itself in public.dawaa_identity_hardening_snapshot_v1, together with their md5.
-- WARNING: rolling back re-opens the x-dawaa-user-id impersonation hole. Use only to recover from an outage.

do $$
declare
  r record;
  v_restored integer := 0;
begin
  for r in select signature, definition, definition_md5 from public.dawaa_identity_hardening_snapshot_v1 order by signature loop
    if to_regprocedure(r.signature) is null then
      raise exception 'rollback: % no longer exists', r.signature;
    end if;
    execute r.definition;
    if md5(pg_get_functiondef(to_regprocedure(r.signature))) <> r.definition_md5 then
      raise exception 'rollback: restored definition of % does not match its snapshot', r.signature;
    end if;
    v_restored := v_restored + 1;
  end loop;
  if v_restored <> 59 then
    raise exception 'rollback: expected 59 restored functions, restored %', v_restored;
  end if;
end $$;

drop function if exists public.dawaa_bind_actor_v1(uuid);
drop function if exists public.dawaa_bind_actor_v1(text);
drop function if exists public.dawaa_request_context_is_client_v1();
drop function if exists public.dawaa_session_account_id_v1();
-- The snapshot table is kept as an audit record; drop it manually when no longer needed:
-- drop table public.dawaa_identity_hardening_snapshot_v1;
