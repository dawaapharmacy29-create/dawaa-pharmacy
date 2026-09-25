import { supabase } from '@/lib/supabase';

export type EmployeePayrollFinancialCompositionV2 = {
  schema: 'employee_payroll_financial_composition_v2';
  staff_id: string;
  month_cycle: string;
  ready_for_finalization: boolean;
  source_mode: 'frozen_v13_snapshot' | 'canonical_plus_legacy_manual_adjustments' | 'canonical_only_no_manual_adjustment_row' | 'frozen_legacy_snapshot' | 'canonical_manual_ledger_v1';
  earnings: {
    base_salary: number;
    automated_incentives_total: number;
    performance_incentive_included_in_automated_total: number;
    target_bonus_included_in_automated_total: number;
    followup_bonus_included_in_automated_total: number;
    customer_request_bonus_included_in_automated_total: number;
    branch_star_bonus_included_in_automated_total: number;
    list_incentive: number;
    approved_overtime: number;
    manual_other_incentives: number;
  };
  adjustments: {
    manual_adjustment: number;
    deductions_total: number;
    expiry_shortage_deduction: number;
    branch_general_deduction: number;
    individual_deduction: number;
    other_deduction: number;
  };
  manual_ledger?: {
    entries: Array<Record<string, unknown>>;
    earnings_total: number;
    deductions_total: number;
    adjustments_total: number;
  };
  preview_net_salary: number;
  frozen: boolean;
  frozen_net_salary: number | null;
  display_net_salary: number;
  double_count_guard: {
    monthly_incentive_component_reference_only: number;
    rule: string;
  };
  blockers: Array<Record<string, unknown>>;
  warnings: Array<Record<string, unknown>>;
  generated_at: string;
};

export async function getEmployeePayrollFinancialComposition(
  staffId: string,
  monthCycle: string
): Promise<EmployeePayrollFinancialCompositionV2> {
  const { data, error } = await supabase.rpc('employee_payroll_financial_composition_v2', {
    p_staff_id: staffId,
    p_month_cycle: monthCycle,
  });

  if (error) throw new Error(error.message);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('payroll_financial_composition_unavailable');
  }

  return data as EmployeePayrollFinancialCompositionV2;
}

export const getEmployeePayrollFinancialCompositionV2 = getEmployeePayrollFinancialComposition;
