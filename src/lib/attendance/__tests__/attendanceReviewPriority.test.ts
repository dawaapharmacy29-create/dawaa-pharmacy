import { describe, expect, it } from 'vitest';
import {
  compareAttendanceReviewPriority,
  isFormerAttendanceReviewRow,
  type AttendanceExceptionRow,
} from '../attendanceResolutionService';

function reviewRow(overrides: Partial<AttendanceExceptionRow> = {}): AttendanceExceptionRow {
  return {
    id: overrides.id || 'row',
    staff_id: overrides.staff_id || 'staff',
    staff_name: overrides.staff_name || 'موظف',
    branch: overrides.branch ?? 'فرع الشامي',
    staff_branch: overrides.staff_branch ?? 'فرع الشامي',
    staff_active: overrides.staff_active ?? true,
    attendance_date: overrides.attendance_date || '2026-10-08',
    resolution_status: overrides.resolution_status ?? 'missing_checkin',
    triage_code: overrides.triage_code || 'manager',
    queue_lane: overrides.queue_lane || 'manager',
    review_lane: overrides.review_lane ?? 'manager_required',
    action_required: overrides.action_required ?? true,
    employee_fault: overrides.employee_fault ?? false,
    issue_group: overrides.issue_group || 'missing_punch',
    issue_label: overrides.issue_label || 'بصمة دخول ناقصة',
    raw_events: overrides.raw_events ?? 1,
    first_in: overrides.first_in ?? null,
    last_out: overrides.last_out ?? null,
    late_minutes: overrides.late_minutes ?? 0,
    early_leave_minutes: overrides.early_leave_minutes ?? 0,
    candidate_hours: overrides.candidate_hours ?? null,
    payroll_eligible_hours: overrides.payroll_eligible_hours ?? null,
    status: overrides.status ?? 'pending_review',
    resolution_origin: overrides.resolution_origin ?? 'canonical',
    policy_version: overrides.policy_version ?? 'v1',
    schedule_id: overrides.schedule_id ?? null,
    scheduled_start_at: overrides.scheduled_start_at ?? null,
    scheduled_end_at: overrides.scheduled_end_at ?? null,
    priority_code: overrides.priority_code ?? 'P1',
    sort_rank: overrides.sort_rank ?? 10,
    age_days: overrides.age_days ?? 1,
    age_bucket: overrides.age_bucket ?? '1_2',
    priority_reason: overrides.priority_reason ?? 'payable_hours_blocked_by_missing_punch',
  };
}

describe('attendance manager-review priority ordering', () => {
  it('places active P1 before active P2 without reclassifying statuses in the client', () => {
    const rows = [
      reviewRow({ id: 'p2', priority_code: 'P2', sort_rank: 20, age_days: 9 }),
      reviewRow({ id: 'p1', priority_code: 'P1', sort_rank: 10, age_days: 1 }),
    ].sort(compareAttendanceReviewPriority);

    expect(rows.map((row) => row.id)).toEqual(['p1', 'p2']);
  });

  it('places the oldest case first inside the same priority', () => {
    const rows = [
      reviewRow({ id: 'newer', priority_code: 'P1', sort_rank: 10, age_days: 1, attendance_date: '2026-10-08' }),
      reviewRow({ id: 'older', priority_code: 'P1', sort_rank: 10, age_days: 6, attendance_date: '2026-10-03' }),
    ].sort(compareAttendanceReviewPriority);

    expect(rows.map((row) => row.id)).toEqual(['older', 'newer']);
  });

  it('keeps former staff in a separate lane after active manager-review cases', () => {
    const former = reviewRow({
      id: 'former',
      staff_active: false,
      priority_code: 'former_staff',
      sort_rank: 90,
      age_days: 30,
    });
    const active = reviewRow({ id: 'active', staff_active: true, priority_code: 'P2', sort_rank: 20, age_days: 1 });

    const rows = [former, active].sort(compareAttendanceReviewPriority);

    expect(isFormerAttendanceReviewRow(former)).toBe(true);
    expect(isFormerAttendanceReviewRow(active)).toBe(false);
    expect(rows.map((row) => row.id)).toEqual(['active', 'former']);
  });

  it('keeps system-repair rows after manager-review lanes', () => {
    const system = reviewRow({
      id: 'system',
      queue_lane: 'system',
      triage_code: 'system_repair',
      review_lane: 'system_repair',
      action_required: false,
      priority_code: null,
      sort_rank: null,
      age_days: null,
      age_bucket: null,
      priority_reason: null,
    });
    const manager = reviewRow({ id: 'manager', priority_code: 'P3', sort_rank: 30 });

    const rows = [system, manager].sort(compareAttendanceReviewPriority);
    expect(rows.map((row) => row.id)).toEqual(['manager', 'system']);
  });
});
