import { supabase } from '@/lib/supabase';

export type PayrollIncentiveTruth = {
  staffId: string;
  monthCycle: string;
  performanceIncentive: number;
  targetBonus: number;
  automatedTotal: number;
  performanceRecords: number;
  targetRecords: number;
};

export async function fetchPayrollIncentiveTruth(
  staffId?: string | null,
  monthCycle?: string | null
): Promise<PayrollIncentiveTruth[]> {
  let query = supabase.from('staff_payroll_incentive_truth_v1').select('*').limit(5000);
  if (staffId) query = query.eq('staff_id', staffId);
  if (monthCycle) query = query.eq('month_cycle', monthCycle);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []).map((row: any) => ({
    staffId: String(row.staff_id || ''),
    monthCycle: String(row.month_cycle || ''),
    performanceIncentive: Number(row.performance_incentive || 0),
    targetBonus: Number(row.target_bonus || 0),
    automatedTotal: Number(row.automated_incentives_total || 0),
    performanceRecords: Number(row.performance_records || 0),
    targetRecords: Number(row.target_records || 0),
  }));
}
