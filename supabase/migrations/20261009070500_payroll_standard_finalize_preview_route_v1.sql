-- Fix: standard (non-delivery) payroll finalization could never succeed.
--
-- 20261008192743 payroll_snapshot_preview_read_model_v2 made stage_payroll_final_snapshot_v2 store the
-- fingerprint of payroll_final_snapshot_preview_v2, whose payload carries `preview_route`. Delivery staff
-- are finalized through compare_payroll_final_snapshot_v2 (same preview), but standard staff go
-- finalize_payroll_snapshot_v3 → finalize_payroll_snapshot_v2 → compare_payroll_final_snapshot_v1 →
-- payroll_final_snapshot_preview_v1, which has no `preview_route` key. The two fingerprints can never
-- be equal, so every standard finalization raised snapshot_changed_or_blocked_before_finalization.
--
-- Fix: finalize_payroll_snapshot_v2 compares a snapshot against the same preview that staged it:
-- v2-staged snapshots (payload has preview_route) use compare_v2, older v1-staged snapshots keep compare_v1.
-- Nothing else in the function changes. Production had no staged standard snapshot when this was written.
-- Rollback: supabase/sql/ROLLBACK_20261009_payroll_standard_finalize_preview_route_v1.sql

do $$
declare
  v_sig constant regprocedure := 'public.finalize_payroll_snapshot_v2(uuid)'::regprocedure;
  v_def text := pg_get_functiondef('public.finalize_payroll_snapshot_v2(uuid)'::regprocedure);
  v_old constant text := $q$v_compare:=public.compare_payroll_final_snapshot_v1(p_snapshot_id);$q$;
  v_new constant text := $q$v_compare:=case when v_snapshot.payload ? 'preview_route' then public.compare_payroll_final_snapshot_v2(p_snapshot_id) else public.compare_payroll_final_snapshot_v1(p_snapshot_id) end; -- same preview as staging (payroll finalize preview route v1)$q$;
begin
  if to_regprocedure('public.compare_payroll_final_snapshot_v2(uuid)') is null then
    raise exception 'payroll finalize fix: compare_payroll_final_snapshot_v2 missing';
  end if;
  if position(v_new in v_def) > 0 then
    return; -- already applied
  end if;
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'payroll finalize fix: compare anchor not found exactly once in %', v_sig;
  end if;
  execute replace(v_def, v_old, v_new);
end $$;
