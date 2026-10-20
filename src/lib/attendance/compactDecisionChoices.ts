import type { AttendanceExceptionRow } from './attendanceResolutionService';

/**
 * Short, case-dependent actions. These are display choices, not automatic approvals.
 * Every selection still goes through the canonical guarded decision operations.
 */
export function recommendedAttendanceDecisionIds(row: Pick<
  AttendanceExceptionRow, 'issue_group' | 'resolution_status' | 'candidate_hours' | 'first_in' | 'last_out'
>): string[] {
  if (row.issue_group === 'absence' || row.resolution_status === 'absence_review') {
    return ['annual_leave', 'sick_leave', 'approved_absence'];
  }
  if (row.resolution_status === 'missing_checkin') return ['forgot_in', 'device_fault', 'cross_branch'];
  if (row.resolution_status === 'missing_checkout') return ['forgot_out', 'device_fault', 'cross_branch'];
  if (row.issue_group === 'missing_punch') return ['forgot_in', 'forgot_out', 'device_fault'];

  const hasCompletePunches = !!row.first_in && !!row.last_out && row.candidate_hours != null;
  if (row.issue_group === 'early_leave' || row.resolution_status === 'early_leave_review'
    || row.resolution_status === 'late' || row.resolution_status === 'very_late') {
    return hasCompletePunches
      ? ['approve_actual', 'permission', 'time_deduction']
      : ['permission', 'time_deduction', 'custom'];
  }
  return hasCompletePunches
    ? ['approve_actual', 'permission', 'custom']
    : ['permission', 'schedule_error', 'custom'];
}
