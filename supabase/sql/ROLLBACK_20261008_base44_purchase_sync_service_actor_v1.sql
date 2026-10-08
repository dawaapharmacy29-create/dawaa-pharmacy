-- ROLLBACK REFERENCE ONLY — not a migration.
-- Reverts 20261008115000_base44_purchase_sync_service_actor_v1.sql by restoring the unconditional
-- staff checks. Pre-migration md5(pg_get_functiondef) = db806d8561edf5d05600a0efac4e5ea4 (2026-10-08).
-- Run only after the Edge Function is back on the anon + header call, and only while
-- 20261008120000 is NOT applied (otherwise the sync has no staff actor and fails).
do $$
declare
  v_def text := pg_get_functiondef('public.import_base44_purchase_invoices_v1(jsonb)'::regprocedure);
  v_guard_open constant text := $q$  -- Staff checks apply to client requests only; service_role/cron run as the system (base44 sync v1).
  if public.dawaa_request_context_is_client_v1() then
$q$;
  v_guard_close constant text := $q$    raise exception using errcode = '42501', message = 'purchase invoice sync permission required';
  end if;
  end if;
$q$;
  v_close_plain constant text := $q$    raise exception using errcode = '42501', message = 'purchase invoice sync permission required';
  end if;
$q$;
begin
  if position(v_guard_open in v_def) = 0 then
    raise exception 'base44 sync rollback: guard not present';
  end if;
  v_def := replace(replace(v_def, v_guard_open, ''), v_guard_close, v_close_plain);
  execute v_def;
  if md5(pg_get_functiondef('public.import_base44_purchase_invoices_v1(jsonb)'::regprocedure)) <> 'db806d8561edf5d05600a0efac4e5ea4' then
    raise exception 'base44 sync rollback: restored definition differs from the pre-migration snapshot';
  end if;
end $$;
