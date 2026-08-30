import { supabase } from '@/lib/supabase';

export type PayrollIncentiveTruth = {
  staffId: string;
  monthCycle: string;
  profileConfigured: boolean;
  performanceSource: 'points' | 'manager_evaluation' | 'none';
  pointsIncentive: number;
  competitionBonus: number;
  managerEvaluationIncentive: number;
  performanceIncentive: number;
  targetBonus: number;
  followupThresholdBonus: number;
  customerRequestThresholdBonus: number;
  branchStarBonus: number;
  automatedTotal: number;
  excludedManagerEvaluationDueToPointsProfile: boolean;
  performanceRecords: number;
  targetRecords: number;
};

export async function fetchPayrollIncentiveTruth(
  staffId?: string | null,
  monthCycle?: string | null
): Promise<PayrollIncentiveTruth[]> {
  if (!staffId || !monthCycle) return [];

  const { data, error } = await supabase.rpc('get_payroll_incentive_truth_v2', {
    p_staff_id: staffId,
    p_month_cycle: monthCycle,
  });
  if (error) throw new Error(error.message);

  return (data || []).map((row: any) => {
    const pointsIncentive = Number(row.points_incentive_egp || 0);
    const competitionBonus = Number(row.competition_bonus_egp || 0);
    const managerEvaluationIncentive = Number(row.manager_evaluation_incentive_egp || 0);
    const performanceIncentive = Number(row.performance_incentive_egp || 0);
    const targetBonus = Number(row.target_bonus_egp || 0);
    return {
      staffId: String(row.staff_id || ''),
      monthCycle: String(row.month_cycle || ''),
      profileConfigured: row.profile_configured === true,
      performanceSource: row.performance_source === 'points'
        ? 'points'
        : row.performance_source === 'manager_evaluation'
          ? 'manager_evaluation'
          : 'none',
      pointsIncentive,
      competitionBonus,
      managerEvaluationIncentive,
      performanceIncentive,
      targetBonus,
      followupThresholdBonus: Number(row.followup_threshold_bonus_egp || 0),
      customerRequestThresholdBonus: Number(row.customer_request_threshold_bonus_egp || 0),
      branchStarBonus: Number(row.branch_star_bonus_egp || 0),
      automatedTotal: Number(row.automated_incentives_total_egp || 0),
      excludedManagerEvaluationDueToPointsProfile: row.excluded_manager_evaluation_due_to_points_profile === true,
      performanceRecords: performanceIncentive !== 0 || pointsIncentive !== 0 || competitionBonus !== 0 || managerEvaluationIncentive !== 0 ? 1 : 0,
      targetRecords: targetBonus !== 0 ? 1 : 0,
    } satisfies PayrollIncentiveTruth;
  });
}
