export const ATTENDANCE_STRENGTH_MIN_WORKED_DAYS = 3;

export type AttendanceStrengthEvidenceInput = {
  onTimeDays: number;
  workedOnOffCases: number;
  approvedTimeOffCases?: number;
  offDayCases?: number;
  lateCases: number;
  veryLateCases: number;
  earlyLeaveCases: number;
  absenceCases: number;
  duplicateResolutionDays: number;
  manualResolutionCases: number;
};

/**
 * Approved leave, permissions and normal off-days are neutral and never count as faults.
 * Automatic attendance strength requires repeated classified workdays and no
 * documented employee-attendance breach or ambiguous/contradictory ledger state.
 */
export function hasStrongAttendanceEvidence(input: AttendanceStrengthEvidenceInput) {
  const workedDays =
    Math.max(0, Number(input.onTimeDays || 0))
    + Math.max(0, Number(input.workedOnOffCases || 0));

  if (workedDays < ATTENDANCE_STRENGTH_MIN_WORKED_DAYS) return false;
  if (Number(input.lateCases || 0) > 0) return false;
  if (Number(input.veryLateCases || 0) > 0) return false;
  if (Number(input.earlyLeaveCases || 0) > 0) return false;
  if (Number(input.absenceCases || 0) > 0) return false;
  if (Number(input.duplicateResolutionDays || 0) > 0) return false;
  if (Number(input.manualResolutionCases || 0) > 0) return false;

  return true;
}
