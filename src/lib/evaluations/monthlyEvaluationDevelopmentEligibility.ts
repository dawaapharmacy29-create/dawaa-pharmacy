export type MonthlyDevelopmentCandidate = {
  key: string;
  score: number;
  notes?: string | null;
};

export function isMonthlyEvaluationDevelopmentEligible(
  section: MonthlyDevelopmentCandidate,
  hasObjectiveEvidence: boolean
) {
  if (section.score <= 0) return false;
  if (hasObjectiveEvidence) return true;
  if (section.score <= 2) return true;
  if (section.score === 3) return String(section.notes || '').trim().length >= 12;
  return false;
}
