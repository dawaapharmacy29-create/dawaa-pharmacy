export const FOLLOWUP_STRENGTH_MIN_SAMPLES = 3;

export type FollowupStrengthEvidenceInput = {
  total: number;
  completed: number;
  documented: number;
  needsNextFollowup: number;
  nextFollowupScheduled: number;
};

/**
 * A manager score is not follow-up evidence by itself.
 * Automatic strength requires a meaningful sample, full closure/documentation,
 * and a recorded next date for every case that explicitly needs another follow-up.
 */
export function hasStrongFollowupEvidence(input: FollowupStrengthEvidenceInput) {
  const total = Math.max(0, Number(input.total || 0));
  const completed = Math.max(0, Number(input.completed || 0));
  const documented = Math.max(0, Number(input.documented || 0));
  const needsNextFollowup = Math.max(0, Number(input.needsNextFollowup || 0));
  const nextFollowupScheduled = Math.max(0, Number(input.nextFollowupScheduled || 0));

  if (total < FOLLOWUP_STRENGTH_MIN_SAMPLES) return false;
  if (completed < total) return false;
  if (documented < total) return false;
  if (nextFollowupScheduled < needsNextFollowup) return false;

  return true;
}
