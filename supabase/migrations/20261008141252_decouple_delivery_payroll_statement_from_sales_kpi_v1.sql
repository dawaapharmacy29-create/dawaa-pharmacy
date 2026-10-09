create or replace function public.employee_payroll_statement_v2(p_staff_id uuid, p_month_cycle text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_catalog'
as $$
declare
  v_class jsonb; v_delivery boolean:=false; v_finalized public.payroll_finalized_snapshots_v2%rowtype; v_frozen jsonb;
  t jsonb; f jsonb; k jsonb; v_start date; v_end date; v_start_leave jsonb; v_end_leave jsonb; v_leave jsonb;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'invalid_employee_payroll_statement_v2_input' using errcode='22023'; end if;
  begin v_class:=public.dawaa_delivery_payroll_classification_v1(p_staff_id,p_month_cycle); v_delivery:=coalesce((v_class->>'payroll_eligible')::boolean,false); exception when others then v_delivery:=false; end;
  if not v_delivery then return public.employee_payroll_statement_v1(p_staff_id,p_month_cycle)||jsonb_build_object('schema','employee_payroll_statement_v2','route','standard_v1','delivery_mode',false); end if;
  if not public.dawaa_can_manage_payroll_staff_id_v1(p_staff_id) then raise exception 'not_authorized_for_delivery_payroll_statement_v2' using errcode='42501'; end if;

  select * into v_finalized from public.payroll_finalized_snapshots_v2 x where x.staff_id=p_staff_id and x.month_cycle=p_month_cycle limit 1;
  if found and coalesce(v_finalized.payload,'{}'::jsonb) ? 'employee_statement' then
    v_frozen:=coalesce(v_finalized.payload->'employee_statement','{}'::jsonb);
    return v_frozen||jsonb_build_object('schema','employee_payroll_statement_v2','statement_mode','finalized_snapshot_v2','route','frozen_existing_snapshot','delivery_mode',true,'generated_at',v_finalized.finalized_at);
  end if;

  t:=public.employee_payroll_transparency_v2(p_staff_id,p_month_cycle);
  f:=public.employee_payroll_financial_composition_compat_v1(p_staff_id,p_month_cycle);
  k:=jsonb_build_object(
    'schema','employee_payroll_kpi_context_v1',
    'available',false,
    'not_applicable',true,
    'reason','sales_kpi_not_applicable_to_delivery_payroll',
    'financial_effect','none'
  );
  select cycle_start,cycle_end into v_start,v_end from public.dawaa_pay_cycle_bounds_v1(to_date(p_month_cycle||'-25','YYYY-MM-DD'));
  begin v_start_leave:=public.get_annual_leave_balance_v1(p_staff_id,extract(year from v_start)::int); exception when others then v_start_leave:=jsonb_build_object('year',extract(year from v_start)::int,'configured',false,'available',false,'reason','annual_leave_balance_unavailable'); end;
  if extract(year from v_end)::int=extract(year from v_start)::int then
    v_leave:=jsonb_build_object('cycle_spans_years',false,'balances',jsonb_build_array(v_start_leave));
  else
    begin v_end_leave:=public.get_annual_leave_balance_v1(p_staff_id,extract(year from v_end)::int); exception when others then v_end_leave:=jsonb_build_object('year',extract(year from v_end)::int,'configured',false,'available',false,'reason','annual_leave_balance_unavailable'); end;
    v_leave:=jsonb_build_object('cycle_spans_years',true,'balances',jsonb_build_array(v_start_leave,v_end_leave));
  end if;

  return jsonb_build_object(
    'schema','employee_payroll_statement_v2','statement_mode','live_preview','route','delivery_v3_compat','delivery_mode',true,
    'staff',t->'staff','cycle',t->'cycle','finalization',t->'finalization','payroll_engine',t->'payroll_engine','payroll_components',t->'payroll_components',
    'attendance',t->'attendance','time_off',t->'time_off','annual_leave',v_leave,'missing_punch',t->'missing_punch','overtime',t->'overtime','transactions',t->'transactions','incentives',t->'incentives',
    'financial',f,'kpi',k,'delivery_classification',t->'delivery_classification','delivery_preview',t->'delivery_preview',
    'statement_rules',jsonb_build_object(
      'attendance','Payroll attendance_daily_summary is canonical; delivery app attendance is evidence only',
      'overtime','approved overtime x final delivery hourly rate x approved multiplier; pending/rejected are disclosed but not paid',
      'performance','delivery monthly incentive requires an approved evaluation multiplier; no evaluation means no automatic 100%',
      'missing_punch','only an applied deduction transaction affects pay','annual_leave','balance is informational and comes from the annual leave ledger',
      'net_salary','base hours + approved overtime + countable orders + approved trips + approved delivery incentive + manual ledger - deductions',
      'finalization','finalization is blocked by unresolved attendance/overtime/orders/trips/evaluation/classification or cycle-open conditions',
      'kpi','sales KPIs are not applicable to delivery payroll and are intentionally excluded from the delivery finalization path'
    ),
    'generated_at',now()
  );
end;$$;
