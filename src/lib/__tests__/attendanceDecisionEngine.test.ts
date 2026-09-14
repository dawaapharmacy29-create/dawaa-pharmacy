import { describe, expect, it } from 'vitest';
import { decideAttendanceDay } from '@/lib/attendance/attendanceDecisionEngine';
import { resolveEffectiveAttendancePolicy } from '@/lib/attendance/effectiveAttendancePolicy';

describe('attendance decision engine', () => {
  it('uses approved delayed-start permission instead of base shift start', () => {
    const policy = resolveEffectiveAttendancePolicy({
      date: '2026-09-14',
      baseStart: '09:00',
      baseEnd: '18:00',
      timeOff: [{
        id: 'p1', request_kind: 'permission', request_label: 'إذن تأخير', status: 'approved',
        start_date: '2026-09-14', end_date: '2026-09-14', start_time: '11:00', end_time: null,
        duration_minutes: 120, reason: 'إذن معتمد',
      }],
    });
    const result = decideAttendanceDay({ policy, firstIn: '11:03', lastOut: '18:02', shiftCompleted: true });
    expect(result.status).toBe('on_time');
    expect(result.lateMinutes).toBe(0);
  });

  it('blocks final penalty while a permission is pending review', () => {
    const policy = resolveEffectiveAttendancePolicy({
      date: '2026-09-14', baseStart: '09:00', baseEnd: '18:00',
      timeOff: [{
        id: 'p2', request_kind: 'permission', request_label: 'إذن', status: 'pending_review',
        start_date: '2026-09-14', end_date: '2026-09-14', start_time: '10:00', end_time: null,
        duration_minutes: 60, reason: 'قيد المراجعة',
      }],
    });
    const result = decideAttendanceDay({ policy, firstIn: '10:30', lastOut: '18:00', shiftCompleted: true, graceMinutes: 15 });
    expect(result.penaltyBlocked).toBe(true);
    expect(result.status).toBe('needs_review');
  });

  it('understands an overnight shift without treating after-midnight checkout as early leave', () => {
    const policy = resolveEffectiveAttendancePolicy({
      date: '2026-09-14', baseStart: '18:00', baseEnd: '02:00',
    });
    expect(policy.isOvernightShift).toBe(true);
    const result = decideAttendanceDay({ policy, firstIn: '18:02', lastOut: '02:05', shiftCompleted: true });
    expect(result.status).toBe('on_time');
    expect(result.earlyLeaveMinutes).toBe(0);
  });

  it('does not flag missing checkout before the shift has ended', () => {
    const policy = resolveEffectiveAttendancePolicy({ date: '2026-09-14', baseStart: '09:00', baseEnd: '18:00' });
    const result = decideAttendanceDay({ policy, firstIn: '09:05', lastOut: null, nowTime: '13:00', shiftCompleted: false });
    expect(result.status).toBe('working_now');
    expect(result.requiresReview).toBe(false);
  });

  it('treats full-day approved leave as off and never penalizes missing punches', () => {
    const policy = resolveEffectiveAttendancePolicy({
      date: '2026-09-14', baseStart: '09:00', baseEnd: '18:00',
      timeOff: [{
        id: 'v1', request_kind: 'vacation', request_label: 'إجازة', status: 'approved',
        start_date: '2026-09-14', end_date: '2026-09-14', start_time: null, end_time: null,
        duration_minutes: null, reason: 'إجازة معتمدة',
      }],
    });
    const result = decideAttendanceDay({ policy, firstIn: null, lastOut: null, shiftCompleted: true });
    expect(result.status).toBe('off');
    expect(result.penaltyBlocked).toBe(true);
  });
});
