import type { StaffEvaluationSectionV3 } from '@/lib/evaluations/staffEvaluationProfilesV3';

export type MonthlyEvaluationPdfReport = {
  approvedAt: string;
  snapshotHash: string;
  sections: StaffEvaluationSectionV3[];
  strengths: string[];
  developmentPoints: string[];
  managerNotes: string;
  overallScore: number;
  grade: string;
  evaluatorName: string;
  criticalGates: string[];
  evidence: {
    reviewsStatus: string; followupsStatus: string; attendanceStatus: string;
    conversationReviews: number; conversationAverage: number | null;
    followupsCompleted: number; followupsTotal: number;
    attendanceResolvedDays: number; attendancePendingDays: number; attendanceConflictDays: number;
    attendanceLateCases: number; attendanceLateMinutes: number; attendanceAbsenceCases: number;
    medicalErrors: number; invoiceErrors: number;
  };
};

const rec = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const arr = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const num = (v: unknown) => Number.isFinite(Number(v)) ? Number(v) : 0;
const nullableNum = (v: unknown) => v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null);

export function buildApprovedMonthlyEvaluationPdfReport(input: {
  snapshot: Record<string, unknown> | null;
  snapshotHash: string;
  fallbackSections: StaffEvaluationSectionV3[];
}): MonthlyEvaluationPdfReport | null {
  const s = input.snapshot;
  const hash = input.snapshotHash.trim();
  if (!s || !hash || String(s.schema || '') !== 'monthly_evaluation_final_snapshot_v5') return null;
  // A PDF is an audit artifact: never synthesize missing approved axes from the
  // current role profile. Every expected axis must exist in the frozen snapshot.
  const savedSections = arr(s.sections);
  if (savedSections.length !== input.fallbackSections.length) return null;
  const savedByKey = new Map(savedSections.map((item) => {
    const row = rec(item);
    return [String(row.key || ''), row] as const;
  }));
  if (input.fallbackSections.some((section) => !savedByKey.has(section.key))) return null;
  const coaching = rec(s.coaching_snapshot);
  const conversation = rec(coaching.conversation);
  const followups = rec(coaching.followups);
  const attendance = rec(coaching.attendance);
  const flags = rec(conversation.flags);
  const serverEvidence = rec(s.server_evidence);
  const health = rec(serverEvidence.health);
  return {
    approvedAt: String(s.approved_at || ''),
    snapshotHash: hash,
    sections: input.fallbackSections.map((fallback) => {
      const saved = savedByKey.get(fallback.key) || {};
      return { ...fallback, score: num(saved.score), notes: String(saved.notes || '') };
    }),
    strengths: arr(s.strengths).map(String).filter(Boolean),
    developmentPoints: arr(s.development_points).map(String).filter(Boolean),
    managerNotes: String(s.manager_notes || ''),
    overallScore: num(s.overall_score),
    grade: String(s.grade || ''),
    evaluatorName: String(s.evaluator_name || 'المدير'),
    criticalGates: arr(s.active_critical_gates).map(String).filter(Boolean),
    evidence: {
      reviewsStatus: String(health.reviews || 'unavailable'),
      followupsStatus: String(health.followups || 'unavailable'),
      attendanceStatus: String(health.attendance || 'unavailable'),
      conversationReviews: num(conversation.reviewCount),
      conversationAverage: nullableNum(conversation.coreAverage),
      followupsCompleted: num(followups.completed),
      followupsTotal: num(followups.total),
      attendanceResolvedDays: num(attendance.resolvedDays),
      attendancePendingDays: num(attendance.pendingReviewCases),
      attendanceConflictDays: num(attendance.conflictingResolutionDays),
      attendanceLateCases: num(attendance.lateCases) + num(attendance.veryLateCases),
      attendanceLateMinutes: num(attendance.lateMinutes),
      attendanceAbsenceCases: num(attendance.absenceCases),
      medicalErrors: num(flags.medicalErrors),
      invoiceErrors: num(flags.invoiceErrors),
    },
  };
}
