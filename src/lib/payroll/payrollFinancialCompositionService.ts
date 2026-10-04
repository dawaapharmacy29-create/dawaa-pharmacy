import { supabase } from '@/lib/supabase';
import { buildEmployeeFinancialProjection, type FinancialComponent, type FinancialComponentState } from './employeeFinancialProjection';

export type EmployeePayrollFinancialCompositionV2 = {
  schema: 'employee_payroll_financial_composition_v2';
  staff_id: string;
  month_cycle: string;
  ready_for_finalization: boolean;
  source_mode:
    | 'frozen_v13_snapshot'
    | 'canonical_plus_legacy_manual_adjustments'
    | 'canonical_only_no_manual_adjustment_row'
    | 'frozen_legacy_snapshot'
    | 'canonical_manual_ledger_v1'
    | 'finalized_snapshot_v2';
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
  final_snapshot_id?: string | null;
  snapshot_fingerprint?: string | null;
  finalized_at?: string | null;
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


function componentState(row:EmployeePayrollFinancialCompositionV2):FinancialComponentState{
  if(row.frozen||row.source_mode==='finalized_snapshot_v2')return 'settled';
  return row.ready_for_finalization?'pending':'unavailable';
}

/**
 * Normalized employee financial read model. It never settles or writes money.
 * Preview values stay pending; only a frozen/finalized payroll snapshot is payable.
 */
export function toEmployeeFinancialProjection(row:EmployeePayrollFinancialCompositionV2){
  const state=componentState(row);
  const e=row.earnings,a=row.adjustments;
  const otherAutomated=e.followup_bonus_included_in_automated_total+e.customer_request_bonus_included_in_automated_total+e.branch_star_bonus_included_in_automated_total;
  const other=otherAutomated+e.manual_other_incentives+a.manual_adjustment-a.deductions_total;
  const components:FinancialComponent[]=[
    {key:'base_salary',label:'الراتب الأساسي',state,amountEgp:e.base_salary,source:row.source_mode},
    {key:'performance_incentive',label:'حافز الأداء',state,amountEgp:e.performance_incentive_included_in_automated_total,source:'get_payroll_incentive_truth_v2'},
    {key:'target_incentive',label:'حافز التارجت',state,amountEgp:e.target_bonus_included_in_automated_total,source:'get_payroll_incentive_truth_v2'},
    {key:'product_incentive',label:'حافز اللستة والرواكد',state,amountEgp:e.list_incentive,source:'get_payroll_components_v17'},
    {key:'near_expiry_incentive',label:'حافز قرب الصلاحية',state:'not_applicable',amountEgp:0,source:'policy_not_activated',note:'لا يوجد settlement مالي مستقل معتمد لقرب الصلاحية في المسار الحالي.'},
    {key:'overtime',label:'الأوفر تايم',state,amountEgp:e.approved_overtime,source:'attendance_gate'},
    {key:'other_adjustments',label:'حوافز وتسويات وخصومات أخرى',state,amountEgp:other,source:'canonical_financial_composition_v2'},
  ];
  return buildEmployeeFinancialProjection(components);
}

export async function getEmployeeFinancialProjection(staffId:string,monthCycle:string){
  return toEmployeeFinancialProjection(await getEmployeePayrollFinancialComposition(staffId,monthCycle));
}
