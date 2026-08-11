import { describe, expect, it } from 'vitest';
import { normalizeWatchlistRows } from '@/lib/customerService/customerCohortIntelligenceService';
import {
  computeWeightedCriterionScores,
  type WeeklyAutoMetrics,
} from '@/lib/evaluations/managerEvaluationCriteria';

const emptyMetrics = {
  data_coverage: { followups: false, points: false, customers: false, reviews: false },
} as WeeklyAutoMetrics;

describe('customer service intelligence governance', () => {
  it('keeps core customer-service work in the score when activity is zero', () => {
    const rows = computeWeightedCriterionScores('customer_service', emptyMetrics, null, {}, {});
    for (const key of [
      'conversation_quality',
      'followups_execution',
      'points_communication',
      'customer_growth',
      'vip_retention',
    ]) {
      expect(rows.find((row) => row.criterion.key === key)?.included).toBe(true);
    }
  });

  it('does not award a neutral score for missing core activity', () => {
    const rows = computeWeightedCriterionScores('customer_service', emptyMetrics, null, {}, {});
    expect(rows.find((row) => row.criterion.key === 'followups_execution')?.score10).toBe(0);
    expect(rows.find((row) => row.criterion.key === 'points_communication')?.score10).toBe(0);
  });

  it('normalizes Arabic watchlist uploads, removes duplicates and caps at 20', () => {
    const source = Array.from({ length: 22 }, (_, index) => ({
      'كود العميل': String(index + 1),
      'اسم العميل': `عميل ${index + 1}`,
    }));
    source.push({ 'كود العميل': '1', 'اسم العميل': 'نسخة مكررة' });
    const rows = normalizeWatchlistRows(source);
    expect(rows.length).toBe(20);
    expect(new Set(rows.map((row) => row.customer_code)).size).toBe(20);
  });
});
