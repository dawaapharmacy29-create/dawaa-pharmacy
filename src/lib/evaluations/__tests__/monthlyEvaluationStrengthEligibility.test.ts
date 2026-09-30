import { describe, expect, it } from 'vitest';
import {
  hasEvidenceSupportedStrongPerformance,
  isMonthlyEvaluationStrengthEligible,
} from '@/lib/evaluations/monthlyEvaluationStrengthEligibility';

const none = {
  conversations: false,
  dispensing: false,
  salesQuality: false,
  followupsRequests: false,
  inventory: false,
  development: false,
  attendance: false,
};

describe('monthly evaluation strength eligibility', () => {
  it('does not treat manager stars alone as conversation evidence', () => {
    expect(isMonthlyEvaluationStrengthEligible({ key: 'conversations', score: 5 }, none)).toBe(false);
    expect(isMonthlyEvaluationStrengthEligible({ key: 'conversations', score: 4 }, { ...none, conversations: true })).toBe(true);
  });

  it('allows objective sections only after their evidence gate passes', () => {
    for (const [key, gate] of [
      ['dispensing', 'dispensing'],
      ['sales_quality', 'salesQuality'],
      ['followups_requests', 'followupsRequests'],
      ['inventory', 'inventory'],
      ['development', 'development'],
      ['discipline', 'attendance'],
      ['attendance', 'attendance'],
      ['shift_discipline', 'attendance'],
    ] as const) {
      expect(isMonthlyEvaluationStrengthEligible({ key, score: 5 }, none)).toBe(false);
      expect(isMonthlyEvaluationStrengthEligible({ key, score: 4 }, { ...none, [gate]: true })).toBe(true);
    }
  });

  it('requires a concrete manager evidence note for manual-only sections', () => {
    expect(isMonthlyEvaluationStrengthEligible({ key: 'delivery_success', score: 5, notes: '' }, none)).toBe(false);
    expect(isMonthlyEvaluationStrengthEligible({ key: 'team', score: 4, notes: 'ممتاز' }, none)).toBe(false);
    expect(isMonthlyEvaluationStrengthEligible({
      key: 'delivery_success',
      score: 4,
      notes: 'إغلاق الأوردرات موثق بدون حالات فشل غير مبررة.',
    }, none)).toBe(true);
  });

  it('does not force a written strength when high stars lack evidence', () => {
    expect(hasEvidenceSupportedStrongPerformance([
      { key: 'dispensing', score: 4 },
      { key: 'sales_quality', score: 5 },
      { key: 'delivery_success', score: 5, notes: '' },
    ], none)).toBe(false);
  });
});
