import type { StaffCycleIncentive } from '@/lib/performance/monthlyIncentiveService';

export function buildMonthlyPerformanceReportModel(incentive: StaffCycleIncentive) {
  return {
    staff: incentive.staff,
    cycleStart: incentive.cycleStart,
    cycleEnd: incentive.cycleEnd,
    monthlySummary: {
      startingPoints: incentive.startingPoints,
      fullIncentiveValue: incentive.maxIncentiveValue,
      approvedDeductions: incentive.approvedDeductionPoints,
      approvedExceptionalRewards: incentive.approvedRewardPoints,
      finalPoints: incentive.finalPoints,
      expectedMonthlyIncentive: incentive.incentiveValue,
      distinctionPointsAbove500: incentive.distinctionPointsAbove500,
    },
    rewards: incentive.rewardTransactions,
    deductions: incentive.deductionTransactions,
    pending: incentive.pendingTransactions,
    warnings: incentive.warnings,
    calculationMethod:
      '500 - approved deductions + approved exceptional rewards = final points; monthly incentive = min(finalPoints / 500, 1) * 1500',
  };
}
