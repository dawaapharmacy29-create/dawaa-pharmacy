-- ROLLBACK REFERENCE ONLY — not a migration.
-- Reverts 20261009070500_payroll_standard_finalize_preview_route_v1.sql.
-- Pre-migration md5(pg_get_functiondef('public.finalize_payroll_snapshot_v2(uuid)')) = 6e7a0ac8991c74828380d6ff088631b6 (2026-10-09).
-- WARNING: restores the defect (standard payroll finalization always fails after v2 staging).
do $$
declare
  v_def text := pg_get_functiondef('public.finalize_payroll_snapshot_v2(uuid)'::regprocedure);
  v_old constant text := $q$v_compare:=public.compare_payroll_final_snapshot_v1(p_snapshot_id);$q$;
  v_new constant text := $q$v_compare:=case when v_snapshot.payload ? 'preview_route' then public.compare_payroll_final_snapshot_v2(p_snapshot_id) else public.compare_payroll_final_snapshot_v1(p_snapshot_id) end; -- same preview as staging (payroll finalize preview route v1)$q$;
begin
  if position(v_new in v_def) = 0 then
    raise exception 'payroll finalize rollback: fix not present';
  end if;
  execute replace(v_def, v_new, v_old);
  if md5(pg_get_functiondef('public.finalize_payroll_snapshot_v2(uuid)'::regprocedure)) <> '6e7a0ac8991c74828380d6ff088631b6' then
    raise exception 'payroll finalize rollback: restored definition differs from the pre-migration snapshot';
  end if;
end $$;
