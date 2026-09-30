import { describe, expect, it } from 'vitest';
import { isMonthlyEvaluationDevelopmentEligible } from '@/lib/evaluations/monthlyEvaluationDevelopmentEligibility';

describe('monthly evaluation development eligibility', () => {
  it('keeps three stars neutral without evidence or manager rationale', () => {
    expect(isMonthlyEvaluationDevelopmentEligible({ key: 'sales_quality', score: 3, notes: '' }, false)).toBe(false);
  });

  it('allows objective development evidence regardless of manager stars', () => {
    expect(isMonthlyEvaluationDevelopmentEligible({ key: 'discipline', score: 5, notes: '' }, true)).toBe(true);
  });

  it('keeps one/two star sections as development', () => {
    expect(isMonthlyEvaluationDevelopmentEligible({ key: 'teamwork', score: 2, notes: '' }, false)).toBe(true);
  });

  it('allows a three-star manual opportunity only with a concrete note', () => {
    expect(isMonthlyEvaluationDevelopmentEligible({ key: 'teamwork', score: 3, notes: 'مقبول' }, false)).toBe(false);
    expect(isMonthlyEvaluationDevelopmentEligible({
      key: 'teamwork',
      score: 3,
      notes: 'يحتاج توثيق تسليم المهام بشكل أوضح في نهاية الشيفت.',
    }, false)).toBe(true);
  });

  it('does not classify four/five stars as manual development without objective contradiction', () => {
    expect(isMonthlyEvaluationDevelopmentEligible({ key: 'teamwork', score: 4, notes: 'ملاحظة عامة' }, false)).toBe(false);
    expect(isMonthlyEvaluationDevelopmentEligible({ key: 'teamwork', score: 5, notes: '' }, false)).toBe(false);
  });
});
