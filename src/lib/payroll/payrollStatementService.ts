import { supabase } from '@/lib/supabase';
import type { EmployeePayrollTransparencyV1 } from '@/lib/payroll/payrollTransparencyService';
import type { EmployeePayrollFinancialCompositionV2 } from '@/lib/payroll/payrollFinancialCompositionService';
import type { EmployeePayrollKpiContextV1 } from '@/lib/payroll/payrollKpiContextService';

export type AnnualLeaveBalanceStatement = {
  year: number;
  configured: boolean;
  available?: boolean;
  balance?: number | null;
  used?: number;
  reserved?: number;
  policy_version?: string;
  reason?: string;
};

export type EmployeePayrollStatementV1 = Omit<EmployeePayrollTransparencyV1, 'schema' | 'generated_at'> & {
  schema: 'employee_payroll_statement_v1';
  annual_leave: {
    cycle_spans_years: boolean;
    balances: AnnualLeaveBalanceStatement[];
  };
  financial: EmployeePayrollFinancialCompositionV2;
  kpi: EmployeePayrollKpiContextV1;
  statement_rules: {
    attendance: string;
    overtime: string;
    performance: string;
    missing_punch: string;
    annual_leave: string;
    net_salary: string;
  };
  generated_at: string;
};

export async function getEmployeePayrollStatementV1(
  staffId: string,
  monthCycle: string
): Promise<EmployeePayrollStatementV1> {
  const { data, error } = await supabase.rpc('employee_payroll_statement_v1', {
    p_staff_id: staffId,
    p_month_cycle: monthCycle,
  });

  if (error) throw new Error(error.message);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('employee_payroll_statement_unavailable');
  }

  return data as EmployeePayrollStatementV1;
}
