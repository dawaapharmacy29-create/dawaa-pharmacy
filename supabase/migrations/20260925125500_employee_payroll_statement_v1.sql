-- Employee Payroll Statement Contract V1
-- Composite read-only contract for the employee-facing monthly payroll statement.

create or replace function public.employee_payroll_statement_v1(
  p_staff_id uuid,
  p_month_cycle text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_transparency jsonb;
  v_financial jsonb;
  v_kpi jsonb;
  v_start date;
  v_end date;
  v_start_leave jsonb;
  v_end_leave jsonb;
  v_leave jsonb;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_employee_payroll_statement_input' using errcode='22023';
  end if;

  v_transparency:=public.employee_payroll_transparency_v1(p_staff_id,p_month_cycle);
  v_financial:=public.employee_payroll_financial_composition_v2(p_staff_id,p_month_cycle);
  v_kpi:=public.employee_payroll_kpi_context_v1(p_staff_id,p_month_cycle);

  select cycle_start,cycle_end
  into v_start,v_end
  from public.dawaa_pay_cycle_bounds_v1(to_date(p_month_cycle||'-25','YYYY-MM-DD'));

  begin
    v_start_leave:=public.get_annual_leave_balance_v1(p_staff_id,extract(year from v_start)::integer);
  exception when others then
    v_start_leave:=jsonb_build_object(
      'year',extract(year from v_start)::integer,
      'configured',false,
      'available',false,
      'reason','annual_leave_balance_unavailable'
    );
  end;

  if extract(year from v_end)::integer=extract(year from v_start)::integer then
    v_leave:=jsonb_build_object(
      'cycle_spans_years',false,
      'balances',jsonb_build_array(v_start_leave)
    );
  else
    begin
      v_end_leave:=public.get_annual_leave_balance_v1(p_staff_id,extract(year from v_end)::integer);
    exception when others then
      v_end_leave:=jsonb_build_object(
        'year',extract(year from v_end)::integer,
        'configured',false,
        'available',false,
        'reason','annual_leave_balance_unavailable'
      );
    end;
    v_leave:=jsonb_build_object(
      'cycle_spans_years',true,
      'balances',jsonb_build_array(v_start_leave,v_end_leave)
    );
  end if;

  return jsonb_build_object(
    'schema','employee_payroll_statement_v1',
    'staff',v_transparency->'staff',
    'cycle',v_transparency->'cycle',
    'finalization',v_transparency->'finalization',
    'payroll_engine',v_transparency->'payroll_engine',
    'payroll_components',v_transparency->'payroll_components',
    'attendance',v_transparency->'attendance',
    'time_off',v_transparency->'time_off',
    'annual_leave',v_leave,
    'missing_punch',v_transparency->'missing_punch',
    'overtime',v_transparency->'overtime',
    'transactions',v_transparency->'transactions',
    'incentives',v_transparency->'incentives',
    'financial',v_financial,
    'kpi',v_kpi,
    'statement_rules',jsonb_build_object(
      'attendance','approved Attendance Truth only',
      'overtime','approved overtime only; pending/rejected are disclosed but not paid',
      'performance','KPI context is non-financial unless Incentive Truth converts it to a payable amount',
      'missing_punch','only an applied deduction transaction affects pay',
      'annual_leave','balance is informational and comes from the annual leave ledger',
      'net_salary','financial.display_net_salary'
    ),
    'generated_at',now()
  );
end;
$function$;

revoke execute on function public.employee_payroll_statement_v1(uuid,text) from public,anon;
grant execute on function public.employee_payroll_statement_v1(uuid,text)
  to authenticated,service_role;
