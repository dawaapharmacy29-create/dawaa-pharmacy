export type MonthlyStrengthEvidenceGates = {
  dispensing: boolean;
  salesQuality: boolean;
  followupsRequests: boolean;
  inventory: boolean;
  development: boolean;
  attendance: boolean;
};

export type MonthlyStrengthCandidate = {
  key: string;
  score: number;
};

export function isMonthlyEvaluationStrengthEligible(
  section: MonthlyStrengthCandidate,
  gates: MonthlyStrengthEvidenceGates
) {
  if (section.score < 4) return false;
  if (section.key === 'dispensing') return gates.dispensing;
  if (section.key === 'sales_quality') return gates.salesQuality;
  if (section.key === 'followups_requests') return gates.followupsRequests;
  if (section.key === 'inventory') return gates.inventory;
  if (section.key === 'development') return gates.development;
  if (['discipline', 'attendance', 'shift_discipline'].includes(section.key)) return gates.attendance;
  return true;
}

export function hasEvidenceSupportedStrongPerformance(
  sections: MonthlyStrengthCandidate[],
  gates: MonthlyStrengthEvidenceGates
) {
  return sections.some((section) => isMonthlyEvaluationStrengthEligible(section, gates));
}
