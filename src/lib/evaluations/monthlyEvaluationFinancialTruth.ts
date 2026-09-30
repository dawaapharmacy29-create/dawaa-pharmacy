export type MonthlyEvaluationFinancialTruthInput = {
  settledStatement: {
    points_closing: number;
    incentive_amount: number;
  } | null;
  pointsTruth: {
    final_points?: number | null;
    target_points?: number | null;
    final_incentive_egp?: number | null;
  } | null;
};

function finiteOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Closed monthly statements are frozen financial truth.
 * Live Points Truth is used only while no approved statement exists.
 */
export function resolveMonthlyEvaluationFinancialTruth(input: MonthlyEvaluationFinancialTruthInput) {
  if (input.settledStatement) {
    return {
      source: 'settled_statement' as const,
      pointsFinal: finiteOrNull(input.settledStatement.points_closing),
      pointsTarget: finiteOrNull(input.pointsTruth?.target_points),
      incentiveEgp: finiteOrNull(input.settledStatement.incentive_amount),
    };
  }

  return {
    source: 'points_truth' as const,
    pointsFinal: finiteOrNull(input.pointsTruth?.final_points),
    pointsTarget: finiteOrNull(input.pointsTruth?.target_points),
    incentiveEgp: finiteOrNull(input.pointsTruth?.final_incentive_egp),
  };
}
