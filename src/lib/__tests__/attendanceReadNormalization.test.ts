import { describe, expect, it } from 'vitest';
import {
  mergeAttendanceRowsForSubject,
  normalizeAcceptedAttendanceLogs,
} from '@/lib/attendance/attendanceReadNormalization';

describe('attendance read normalization', () => {
  it('collapses accepted check-in and check-out punches into one present day', () => {
    const rows = normalizeAcceptedAttendanceLogs([
      {
        staff_id: '11111111-1111-4111-8111-111111111111',
        staff_name: 'د اختبار',
        shift_date: '2026-08-20',
        attendance_type: 'check_out',
        status: 'accepted',
        recorded_at: '2026-08-20T18:05:00Z',
      },
      {
        staff_id: '11111111-1111-4111-8111-111111111111',
        staff_name: 'د اختبار',
        shift_date: '2026-08-20',
        attendance_type: 'check_in',
        status: 'accepted',
        recorded_at: '2026-08-20T09:01:00Z',
      },
    ]);

    expect(rows.length).toBe(1);
    expect(rows[0].date).toBe('2026-08-20');
    expect(rows[0].status).toBe('present');
    expect(rows[0].check_in).toBe('09:01:00');
    expect(rows[0].check_out).toBe('18:05:00');
  });

  it('does not count rejected or manual-review attempts as confirmed attendance', () => {
    const rows = normalizeAcceptedAttendanceLogs([
      {
        staff_id: '11111111-1111-4111-8111-111111111111',
        shift_date: '2026-08-21',
        attendance_type: 'check_in',
        status: 'rejected',
        recorded_at: '2026-08-21T09:00:00Z',
      },
      {
        staff_id: '11111111-1111-4111-8111-111111111111',
        shift_date: '2026-08-22',
        attendance_type: 'check_in',
        status: 'manual_review',
        recorded_at: '2026-08-22T09:00:00Z',
      },
    ]);

    expect(rows.length).toBe(0);
  });

  it('prefers modern attendance when the same calendar day exists in both sources', () => {
    const rows = mergeAttendanceRowsForSubject(
      [
        {
          staff_id: '11111111-1111-4111-8111-111111111111',
          date: '2026-08-20',
          attendance_date: '2026-08-20',
          status: 'late',
          source: 'legacy',
        },
      ],
      [
        {
          staff_id: '11111111-1111-4111-8111-111111111111',
          date: '2026-08-20',
          attendance_date: '2026-08-20',
          status: 'present',
          source: 'modern',
        },
      ]
    );

    expect(rows.length).toBe(1);
    expect(rows[0].source).toBe('modern');
    expect(rows[0].status).toBe('present');
  });
});
