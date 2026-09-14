import { describe, expect, it } from 'vitest';
import {
  isMinuteInsideProtectedWindow,
  resolveEffectiveAttendancePolicy,
} from '@/lib/attendance/effectiveAttendancePolicy';

describe('effective attendance policy', () => {
  it('keeps the raw schedule but applies an approved override as the effective schedule', () => {
    const result = resolveEffectiveAttendancePolicy({
      date: '2026-09-14',
      baseStart: '09:00',
      baseEnd: '18:00',
      overrides: [{
        id: 'o1', date: '2026-09-14', status: 'approved', start_time: '12:00', end_time: '20:00',
        label: 'تبديل شيفت', reason: 'تغطية زميل', swap_with_staff_id: 'staff-b',
      }],
    });
    expect(result.base.start).toBe('09:00');
    expect(result.base.end).toBe('18:00');
    expect(result.effective.start).toBe('12:00');
    expect(result.effective.end).toBe('20:00');
    expect(result.effective.source).toBe('approved_override');
  });

  it('adds a partial permission as a protected window without replacing the whole shift', () => {
    const result = resolveEffectiveAttendancePolicy({
      date: '2026-09-14', baseStart: '09:00', baseEnd: '18:00',
      timeOff: [{
        id: 'p1', request_kind: 'permission', request_label: 'إذن شخصي', status: 'approved',
        start_date: '2026-09-14', end_date: '2026-09-14', start_time: '13:00', end_time: '14:30',
        duration_minutes: 90, reason: 'موعد',
      }],
    });
    expect(result.effective.start).toBe('09:00');
    expect(result.effective.end).toBe('18:00');
    expect(result.protectedWindows).toHaveLength(1);
    expect(isMinuteInsideProtectedWindow('13:45', result.protectedWindows[0])).toBe(true);
  });

  it('recognizes an overnight protected permission window', () => {
    const result = resolveEffectiveAttendancePolicy({
      date: '2026-09-14', baseStart: '18:00', baseEnd: '02:00',
      timeOff: [{
        id: 'p2', request_kind: 'permission', request_label: 'إذن', status: 'approved',
        start_date: '2026-09-14', end_date: '2026-09-14', start_time: '23:30', end_time: '00:30',
        duration_minutes: 60, reason: null,
      }],
    });
    expect(result.isOvernightShift).toBe(true);
    expect(isMinuteInsideProtectedWindow('00:10', result.protectedWindows[0])).toBe(true);
    expect(isMinuteInsideProtectedWindow('23:50', result.protectedWindows[0])).toBe(true);
    expect(isMinuteInsideProtectedWindow('01:30', result.protectedWindows[0])).toBe(false);
  });
});
