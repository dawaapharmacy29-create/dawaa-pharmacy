export const MIN_APPROVED_WEEKS_FOR_PAYOUT = 3;
export const MIN_DATA_COVERAGE_PERCENT_FOR_PAYOUT = 80;

export type IncentiveEligibility = {
  eligible: boolean;
  status: 'eligible' | 'insufficient_approved_weeks' | 'insufficient_data_coverage';
  reasons: string[];
};

export function evaluatePerformanceIncentiveEligibility(
  approvedWeeks: number,
  dataCoveragePercent: number | null
): IncentiveEligibility {
  const reasons: string[] = [];
  if (approvedWeeks < MIN_APPROVED_WEEKS_FOR_PAYOUT) {
    reasons.push(`يلزم اعتماد ${MIN_APPROVED_WEEKS_FOR_PAYOUT} أسابيع على الأقل؛ المعتمد حاليًا ${approvedWeeks}.`);
  }
  if (dataCoveragePercent === null || dataCoveragePercent < MIN_DATA_COVERAGE_PERCENT_FOR_PAYOUT) {
    reasons.push(`يلزم وصول تغطية البيانات إلى ${MIN_DATA_COVERAGE_PERCENT_FOR_PAYOUT}% على الأقل.`);
  }
  return {
    eligible: reasons.length === 0,
    status: approvedWeeks < MIN_APPROVED_WEEKS_FOR_PAYOUT
      ? 'insufficient_approved_weeks'
      : reasons.length
        ? 'insufficient_data_coverage'
        : 'eligible',
    reasons,
  };
}
