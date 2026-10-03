export type MonthlyAttendanceFinalization = {
  ready: boolean;
  pendingReviewCases: number;
  conflictingResolutionDays: number;
  blockers: string[];
};

export function evaluateMonthlyAttendanceFinalization(input: {
  sourceAvailable: boolean;
  pendingReviewCases: number;
  conflictingResolutionDays: number;
}): MonthlyAttendanceFinalization {
  const pendingReviewCases = Math.max(0, Math.trunc(input.pendingReviewCases || 0));
  const conflictingResolutionDays = Math.max(0, Math.trunc(input.conflictingResolutionDays || 0));
  const blockers = [
    !input.sourceAvailable ? 'مصدر الحضور غير مكتمل' : '',
    pendingReviewCases > 0 ? `${pendingReviewCases} يوم حضور معلق` : '',
    conflictingResolutionDays > 0 ? `${conflictingResolutionDays} يوم بتصنيف حضور متعارض` : '',
  ].filter(Boolean);

  return { ready: blockers.length === 0, pendingReviewCases, conflictingResolutionDays, blockers };
}
