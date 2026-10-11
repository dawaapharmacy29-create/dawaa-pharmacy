-- Reuse already-computed delivery payroll evidence instead of recalculating it.
-- This migration is intentionally output-preserving: it only removes duplicate
-- calls to Hours Truth / Delivery Preview inside the same payroll request.

do $$
declare
  v_oid oid;
  v_def text;
  v_old text;
  v_new text;
begin
  v_oid := to_regprocedure('public.dawaa_delivery_financial_preview_v2(uuid,text)');
  if v_oid is null then raise exception 'missing dawaa_delivery_financial_preview_v2'; end if;
  v_def := pg_get_functiondef(v_oid);
  v_old := '  v_hours:=public.dawaa_delivery_hours_truth_v1(p_staff_id,p_month_cycle);';
  v_new := '  v_hours:=coalesce(j->''attendance_hours'',''{}''::jsonb);' || E'\n' ||
           '  if v_hours=''{}''::jsonb then' || E'\n' ||
           '    v_hours:=public.dawaa_delivery_hours_truth_v1(p_staff_id,p_month_cycle);' || E'\n' ||
           '  end if;';
  if position(v_old in v_def)=0 then raise exception 'preview_v2 optimization anchor not found'; end if;
  execute replace(v_def,v_old,v_new);

  v_oid := to_regprocedure('public.payroll_finalization_gate_v2(uuid,text)');
  if v_oid is null then raise exception 'missing payroll_finalization_gate_v2'; end if;
  v_def := pg_get_functiondef(v_oid);
  v_old := '      ''engine'',public.dawaa_delivery_hours_truth_v1(p_staff_id,p_month_cycle),';
  v_new := '      ''engine'',case when coalesce(v_delivery->''attendance_hours'',''{}''::jsonb)=''{}''::jsonb then public.dawaa_delivery_hours_truth_v1(p_staff_id,p_month_cycle) else v_delivery->''attendance_hours'' end,';
  if position(v_old in v_def)=0 then raise exception 'gate_v2 optimization anchor not found'; end if;
  execute replace(v_def,v_old,v_new);

  v_oid := to_regprocedure('public.employee_payroll_transparency_v2(uuid,text)');
  if v_oid is null then raise exception 'missing employee_payroll_transparency_v2'; end if;
  v_def := pg_get_functiondef(v_oid);
  v_old := '  v_gate:=public.payroll_finalization_gate_v2(p_staff_id,p_month_cycle);' || E'\n' ||
           '  v_hours:=public.dawaa_delivery_hours_truth_v1(p_staff_id,p_month_cycle);' || E'\n' ||
           '  v_preview:=public.dawaa_delivery_financial_preview_v2(p_staff_id,p_month_cycle);';
  v_new := '  v_gate:=public.payroll_finalization_gate_v2(p_staff_id,p_month_cycle);' || E'\n' ||
           '  v_preview:=coalesce(v_gate->''delivery_gate'',''{}''::jsonb);' || E'\n' ||
           '  if v_preview=''{}''::jsonb then' || E'\n' ||
           '    v_preview:=public.dawaa_delivery_financial_preview_v2(p_staff_id,p_month_cycle);' || E'\n' ||
           '  end if;' || E'\n' ||
           '  v_hours:=coalesce(v_preview->''attendance_hours'',v_gate->''attendance_gate''->''engine'',''{}''::jsonb);' || E'\n' ||
           '  if v_hours=''{}''::jsonb then' || E'\n' ||
           '    v_hours:=public.dawaa_delivery_hours_truth_v1(p_staff_id,p_month_cycle);' || E'\n' ||
           '  end if;';
  if position(v_old in v_def)=0 then raise exception 'transparency_v2 optimization anchor not found'; end if;
  execute replace(v_def,v_old,v_new);

  v_oid := to_regprocedure('public.employee_payroll_financial_composition_v3(uuid,text)');
  if v_oid is null then raise exception 'missing employee_payroll_financial_composition_v3'; end if;
  v_def := pg_get_functiondef(v_oid);
  v_old := '  v_delivery:=public.dawaa_delivery_financial_preview_v2(p_staff_id,p_month_cycle);' || E'\n' ||
           '  v_gate:=public.payroll_finalization_gate_v2(p_staff_id,p_month_cycle);';
  v_new := '  v_gate:=public.payroll_finalization_gate_v2(p_staff_id,p_month_cycle);' || E'\n' ||
           '  v_delivery:=coalesce(v_gate->''delivery_gate'',''{}''::jsonb);' || E'\n' ||
           '  if v_delivery=''{}''::jsonb then' || E'\n' ||
           '    v_delivery:=public.dawaa_delivery_financial_preview_v2(p_staff_id,p_month_cycle);' || E'\n' ||
           '  end if;';
  if position(v_old in v_def)=0 then raise exception 'financial_v3 optimization anchor not found'; end if;
  execute replace(v_def,v_old,v_new);
end $$;
