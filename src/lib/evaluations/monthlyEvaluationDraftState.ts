type DraftSection = {
  key: string;
  score: number;
  notes?: string | null;
};

export type MonthlyEvaluationDraftState = {
  sections: DraftSection[];
  strengthsText: string;
  developmentText: string;
  managerNotes: string;
  activeGates: string[];
};

function normalizedLines(value: string) {
  return String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function monthlyEvaluationDraftFingerprint(input: MonthlyEvaluationDraftState) {
  return JSON.stringify({
    sections: [...input.sections]
      .map((section) => ({
        key: String(section.key || ''),
        score: Number(section.score || 0),
        notes: String(section.notes || ''),
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    strengths: normalizedLines(input.strengthsText),
    development: normalizedLines(input.developmentText),
    managerNotes: String(input.managerNotes || ''),
    activeGates: [...input.activeGates].map(String).sort(),
  });
}
