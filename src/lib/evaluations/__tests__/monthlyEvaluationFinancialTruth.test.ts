import { describe, expect, it } from 'vitest';
import { resolveMonthlyEvaluationFinancialTruth } from '@/lib/evaluations/monthlyEvaluationFinancialTruth';

describe('monthly evaluation financial truth', () => {
  it('uses the frozen monthly statement for both closing points and incentive', () => {
    expect(resolveMonthlyEvaluationFinancialTruth({
      settledStatement: { points_closing: 460, incentive_amount: 113 },
      pointsTruth: { final_points: 485, target_points: 500, final_incentive_egp: 145 },
    })).toEqual({
      source: 'settled_statement',
      pointsFinal: 460,
      pointsTarget: 500,
      incentiveEgp: 113,
    });
  });

  it('uses live Points Truth only when no approved statement exists', () => {
    expect(resolveMonthlyEvaluationFinancialTruth({
      settledStatement: null,
      pointsTruth: { final_points: 485, target_points: 500, final_incentive_egp: 145 },
    })).toEqual({
      source: 'points_truth',
      pointsFinal: 485,
      pointsTarget: 500,
      incentiveEgp: 145,
    });
  });

  it('does not fall back to live values after a statement has frozen the cycle', () => {
    const result = resolveMonthlyEvaluationFinancialTruth({
      settledStatement: { points_closing: Number.NaN, incentive_amount: Number.NaN },
      pointsTruth: { final_points: 485, target_points: 500, final_incentive_egp: 145 },
    });
    expect(result.source).toBe('settled_statement');
    expect(result.pointsFinal).toBe(null);
    expect(result.incentiveEgp).toBe(null);
  });
});
