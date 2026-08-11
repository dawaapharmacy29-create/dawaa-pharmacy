import { describe, expect, it } from 'vitest';
import { evaluatePerformanceIncentiveEligibility } from '@/lib/evaluations/incentiveEligibility';
import { computeWeightedCriterionScores, type WeeklyAutoMetrics } from '@/lib/evaluations/managerEvaluationCriteria';

describe('performance incentive eligibility', () => {
  it('requires three approved weeks and 80 percent coverage', () => {
    expect(evaluatePerformanceIncentiveEligibility(3, 80).eligible).toBe(true);
    expect(evaluatePerformanceIncentiveEligibility(2, 100).eligible).toBe(false);
    expect(evaluatePerformanceIncentiveEligibility(4, 79).eligible).toBe(false);
  });

  it('rejects unknown coverage instead of guessing', () => {
    expect(evaluatePerformanceIncentiveEligibility(4, null).eligible).toBe(false);
  });
});

describe('core customer-service criterion governance', () => {
  it('keeps core customer-service work included without inventing a neutral score', () => {
    const metrics = {
      sales_total: 1000,
      sales_target_amount: 1000,
      sales_target_achievement_rate: 100,
      data_coverage: { sales: true, targets: true, followups: false, customers: false, customer_requests: false, attendance: false },
    } as unknown as WeeklyAutoMetrics;
    const checklistRates = {
      cash_reconciliation: 100, purchases_review: 100, inventory_review: 100,
      shortages_handling: 100, expiry_check: 100, team_briefing: 100,
    };
    const rows = computeWeightedCriterionScores('branch_manager', metrics, null, {}, checklistRates);
    const followups = rows.find((row) => row.criterion.key === 'customer_service');
    const sales = rows.find((row) => row.criterion.key === 'sales');
    expect(followups?.included).toBe(true);
    expect(followups?.contribution).toBe(0);
    expect(sales?.effectiveWeight).toBe(sales?.originalWeight);
    expect(Math.round(rows.reduce((sum, row) => sum + row.effectiveWeight, 0) * 100)).toBe(100);
  });
});
