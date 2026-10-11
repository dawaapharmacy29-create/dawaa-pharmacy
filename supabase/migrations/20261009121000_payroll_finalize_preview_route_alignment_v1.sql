-- Payroll finalization must compare a staged snapshot against the same preview route that created it.
--
-- stage_payroll_final_snapshot_v2 stores payroll_final_snapshot_preview_v2 payloads, which include
-- `preview_route`. finalize_payroll_snapshot_v2 still compared every snapshot through compare V1.
-- That can reject an unchanged V2-staged snapshot because V1 and V2 payload schemas/fingerprints differ.
--
-- Preserve legacy compatibility: V2-staged snapshots use compare V2; older staged payloads without
-- `preview_route` continue to use compare V1. No payroll amounts are recalculated or written here.

do $$
declare
  v_sig constant regprocedure := 'public.finalize_payroll_snapshot_v2(uuid)'::regprocedure;
  v_def text := pg_get_functiondef('public.finalize_payroll_snapshot_v2(uuid)'::regprocedure);
  v_old constant text := $q$v_compare:=public.compare_payroll_final_snapshot_v1(p_snapshot_id);$q$;
  v_new constant text := $q$v_compare:=case when v_snapshot.payload ? 'preview_route' then public.compare_payroll_final_snapshot_v2(p_snapshot_id) else public.compare_payroll_final_snapshot_v1(p_snapshot_id) end; -- same preview as staging (payroll finalize preview route alignment v1)$q$;
begin
  if to_regprocedure('public.compare_payroll_final_snapshot_v2(uuid)') is null then
    raise exception 'payroll finalize route alignment: compare_payroll_final_snapshot_v2 missing';
  end if;

  if position(v_new in v_def) > 0 then
    return;
  end if;

  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'payroll finalize route alignment: compare anchor not found exactly once in %', v_sig;
  end if;

  execute replace(v_def, v_old, v_new);
end $$;
