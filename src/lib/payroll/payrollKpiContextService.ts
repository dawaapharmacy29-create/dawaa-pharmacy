import { supabase } from '@/lib/supabase';

export type EmployeePayrollKpiContextV1 = {
  schema: 'employee_payroll_kpi_context_v1';
  staff_id: string;
  month_cycle: string;
  branch: string | null;
  cycle_start: string;
  cycle_end: string;
  staff_performance: Record<string, unknown>;
  branch_target: Record<string, unknown>;
  branch_kpis: Record<string, unknown>;
  employee_sales_kpi: {
    available: boolean;
    reason: string;
  };
  financial_rule: string;
  generated_at: string;
};

export async function getEmployeePayrollKpiContextV1(
  staffId: string,
  monthCycle: string
): Promise<EmployeePayrollKpiContextV1> {
  const { data, error } = await supabase.rpc('employee_payroll_kpi_context_v1', {
    p_staff_id: staffId,
    p_month_cycle: monthCycle,
  });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('payroll_kpi_context_unavailable');
  }
  return data as EmployeePayrollKpiContextV1;
}
