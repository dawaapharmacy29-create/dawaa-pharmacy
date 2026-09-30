export const DEVELOPMENT_STRENGTH_MIN_DELTA = 5;

export type DevelopmentStrengthEvidenceInput = {
  sourceStatus: 'available' | 'partial' | 'manual';
  trendMeasurable: boolean;
  direction: 'improving' | 'stable' | 'declining' | 'not_measurable';
  delta: number | null;
  repeatedIssueCount: number;
  trainingAssigned: number;
  trainingCompleted: number;
  overdueTraining: number;
};

/**
 * Training completion by itself is not proof of development.
 * Automatic strength requires measurable improvement, no repeated issue, and
 * clean completion of any training that was actually assigned in the cycle.
 */
export function hasStrongDevelopmentEvidence(input: DevelopmentStrengthEvidenceInput) {
  const trainingAssigned = Math.max(0, Number(input.trainingAssigned || 0));
  const trainingCompleted = Math.max(0, Number(input.trainingCompleted || 0));
  const overdueTraining = Math.max(0, Number(input.overdueTraining || 0));
  const repeatedIssueCount = Math.max(0, Number(input.repeatedIssueCount || 0));

  if (input.sourceStatus !== 'available') return false;
  if (!input.trendMeasurable) return false;
  if (input.direction !== 'improving') return false;
  if (input.delta === null || Number(input.delta) < DEVELOPMENT_STRENGTH_MIN_DELTA) return false;
  if (repeatedIssueCount > 0) return false;
  if (overdueTraining > 0) return false;
  if (trainingAssigned > 0 && trainingCompleted < trainingAssigned) return false;

  return true;
}
