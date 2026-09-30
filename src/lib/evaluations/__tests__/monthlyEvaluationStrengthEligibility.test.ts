import { describe, expect, it } from 'vitest';
import {
  hasEvidenceSupportedStrongPerformance,
  isMonthlyEvaluationStrengthEligible,
} from '@/lib/evaluations/monthlyEvaluationStrengthEligibility';

describe('monthly evaluation strength eligibility', () => {
  it('keeps ordinary 4+ star sections eligible', () => {
    expect(isMonthlyEvaluationStrengthEligible(
      { key: 'discipline', score: 4 },
      { dispensing: false, salesQuality: false }
    )).toBe(true);
  });

  it('does not treat manager stars as enough for dispensing or sales quality', () => {
    expect(isMonthlyEvaluationStrengthEligible(
      { key: 'dispensing', score: 5 },
      { dispensing: false, salesQuality: true }
    )).toBe(false);

    expect(isMonthlyEvaluationStrengthEligible(
      { key: 'sales_quality', score: 4 },
      { dispensing: true, salesQuality: false }
    )).toBe(false);
  });

  it('allows evidence-gated sections only after their evidence gate passes', () => {
    expect(isMonthlyEvaluationStrengthEligible(
      { key: 'dispensing', score: 4 },
      { dispensing: true, salesQuality: false }
    )).toBe(true);

    expect(isMonthlyEvaluationStrengthEligible(
      { key: 'sales_quality', score: 5 },
      { dispensing: false, salesQuality: true }
    )).toBe(true);
  });

  it('does not force a written strength when the only 4+ star sections lack evidence', () => {
    expect(hasEvidenceSupportedStrongPerformance(
      [
        { key: 'dispensing', score: 4 },
        { key: 'sales_quality', score: 5 },
        { key: 'conversations', score: 3 },
      ],
      { dispensing: false, salesQuality: false }
    )).toBe(false);
  });
});
