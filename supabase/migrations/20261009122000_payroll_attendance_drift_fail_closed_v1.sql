-- A failed attendance financial-drift check must never be interpreted as zero drift.
-- payroll_finalization_gate_v2 previously swallowed any error from
-- attendance_resolution_financial_drift_count_v1 and set v_financial_drift=0, which could make
-- a delivery payroll appear finalizable while the safety check itself was unavailable.

do $migration$
declare
  v_sig constant regprocedure := 'public.payroll_finalization_gate_v2(uuid,text)'::regprocedure;
  v_def text := pg_get_functiondef('public.payroll_finalization_gate_v2(uuid,text)'::regprocedure);
  v_old constant text := 'begin v_financial_drift:=public.attendance_resolution_financial_drift_count_v1(p_staff_id,v_start,v_end); exception when others then v_financial_drift:=0; end;';
  v_new constant text := 'begin v_financial_drift:=public.attendance_resolution_financial_drift_count_v1(p_staff_id,v_start,v_end); exception when others then raise exception ''attendance_financial_drift_check_unavailable'' using errcode=''55000''; end;';
  v_hits integer;
begin
  if to_regprocedure('public.attendance_resolution_financial_drift_count_v1(uuid,date,date)') is null then
    raise exception 'payroll attendance drift fail-closed: drift counter missing';
  end if;

  if position(v_new in v_def) > 0 then
    return;
  end if;

  v_hits := (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old);
  if v_hits <> 1 then
    raise exception 'payroll attendance drift fail-closed: expected one zero-on-error fallback in %, found %',v_sig,v_hits;
  end if;

  execute replace(v_def,v_old,v_new);
end;
$migration$;
