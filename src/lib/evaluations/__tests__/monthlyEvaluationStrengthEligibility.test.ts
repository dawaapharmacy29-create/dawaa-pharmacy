import { describe, expect, it } from 'vitest';
import {
  hasEvidenceSupportedStrongPerformance,
  isMonthlyEvaluationStrengthEligible,
} from '@/lib/evaluations/monthlyEvaluationStrengthEligibility';

describe('monthly evaluation strength eligibility', () => {
  it('keeps ordinary non-gated 4+ star sections eligible', () => {
    expect(isMonthlyEvaluationStrengthEligible(
      { key: 'conversations', score: 4 },
      { dispensing: false, salesQuality: false, followupsRequests: false, inventory: false, development: false, attendance: false }
    )).toBe(true);
  });

  it('does not treat manager stars as enough for dispensing or sales quality', () => {
    expect(isMonthlyEvaluationStrengthEligible(
      { key: 'dispensing', score: 5 },
      { dispensing: false, salesQuality: true, followupsRequests: false, inventory: false, development: false, attendance: false }
    )).toBe(false);

    expect(isMonthlyEvaluationStrengthEligible(
      { key: 'sales_quality', score: 4 },
      { dispensing: true, salesQuality: false, followupsRequests: false, inventory: false, development: false, attendance: false }
    )).toBe(false);
  });

  it('allows evidence-gated sections only after their evidence gate passes', () => {
    expect(isMonthlyEvaluationStrengthEligible(
      { key: 'dispensing', score: 4 },
      { dispensing: true, salesQuality: false, followupsRequests: false, inventory: false, development: false, attendance: false }
    )).toBe(true);

    expect(isMonthlyEvaluationStrengthEligible(
      { key: 'sales_quality', score: 5 },
      { dispensing: false, salesQuality: true, followupsRequests: false, inventory: false, development: false, attendance: false }
    )).toBe(true);
  });

  it('requires operational follow-up evidence before followups_requests can be a strength', () => {
    expect(isMonthlyEvaluationStrengthEligible(
      { key: 'followups_requests', score: 5 },
      { dispensing: false, salesQuality: false, followupsRequests: false, inventory: false, development: false, attendance: false }
    )).toBe(false);

    expect(isMonthlyEvaluationStrengthEligible(
      { key: 'followups_requests', score: 4 },
      { dispensing: false, salesQuality: false, followupsRequests: true, inventory: false, development: false, attendance: false }
    )).toBe(true);
  });

  it('requires repeated clean inventory evidence before inventory can be a strength', () => {
    expect(isMonthlyEvaluationStrengthEligible(
      { key: 'inventory', score: 5 },
      { dispensing: false, salesQuality: false, followupsRequests: false, inventory: false, development: false, attendance: false }
    )).toBe(false);

    expect(isMonthlyEvaluationStrengthEligible(
      { key: 'inventory', score: 4 },
      { dispensing: false, salesQuality: false, followupsRequests: false, inventory: true, development: false, attendance: false }
    )).toBe(true);
  });

  it('requires documented improvement evidence before development can be a strength', () => {
    expect(isMonthlyEvaluationStrengthEligible(
      { key: 'development', score: 5 },
      { dispensing: false, salesQuality: false, followupsRequests: false, inventory: false, development: false, attendance: false }
    )).toBe(false);

    expect(isMonthlyEvaluationStrengthEligible(
      { key: 'development', score: 4 },
      { dispensing: false, salesQuality: false, followupsRequests: false, inventory: false, development: true, attendance: false }
    )).toBe(true);
  });

  it('requires clean attendance evidence for attendance-related strength sections', () => {
    for (const key of ['discipline', 'attendance', 'shift_discipline']) {
      expect(isMonthlyEvaluationStrengthEligible(
        { key, score: 5 },
        { dispensing: false, salesQuality: false, followupsRequests: false, inventory: false, development: false, attendance: false }
      )).toBe(false);

      expect(isMonthlyEvaluationStrengthEligible(
        { key, score: 4 },
        { dispensing: false, salesQuality: false, followupsRequests: false, inventory: false, development: false, attendance: true }
      )).toBe(true);
    }
  });

  it('does not force a written strength when the only 4+ star sections lack evidence', () => {
    expect(hasEvidenceSupportedStrongPerformance(
      [
        { key: 'dispensing', score: 4 },
        { key: 'sales_quality', score: 5 },
        { key: 'conversations', score: 3 },
      ],
      { dispensing: false, salesQuality: false, followupsRequests: false, inventory: false, development: false, attendance: false }
    )).toBe(false);
  });
});
