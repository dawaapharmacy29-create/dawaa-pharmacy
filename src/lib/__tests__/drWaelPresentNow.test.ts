import { describe, expect, it } from 'vitest';
import { presentNow, type DrWaelPunch } from '../drWaelFingerprints';

const punch = (staff: string, time: string, type: string, extra: Partial<DrWaelPunch> = {}): DrWaelPunch => ({
  staff_id: staff,
  name: staff,
  branch: 'فرع الشامي',
  biometric_user_id: '1',
  punch_time: time,
  punch_type: type,
  device_id: 'd',
  event_id: `${staff}-${time}`,
  interpreted_type: type,
  ...extra,
});

describe('presentNow', () => {
  const now = new Date('2026-11-04T10:30:00Z');

  it('lists whoever checked in today without checking out, from the punches themselves', () => {
    const rows = presentNow(
      [
        punch('noor', '2026-11-04T06:59:00Z', 'check_in'),
        punch('amr', '2026-11-04T07:26:00Z', 'check_in', { branch: 'فرع شكري' }),
        punch('deeb', '2026-11-03T21:00:00Z', 'check_in'),
        punch('deeb', '2026-11-04T06:14:00Z', 'check_out'),
      ],
      now
    );
    expect(rows.map((row) => row.staffId)).toEqual(['noor', 'amr']);
    expect(rows[1].punchBranch).toBe('فرع شكري');
  });

  it('keeps the start of the open session when someone punched in twice', () => {
    const rows = presentNow(
      [punch('wageeh', '2026-11-04T05:58:00Z', 'check_in'), punch('wageeh', '2026-11-04T06:01:00Z', 'check_in')],
      now
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].since).toBe('2026-11-04T05:58:00Z');
  });

  it('keeps last night’s open shift and drops a check-in older than the limit or a rejected duplicate', () => {
    const rows = presentNow(
      [
        punch('night', '2026-11-03T20:00:00Z', 'check_in'),
        punch('stale', '2026-11-03T08:00:00Z', 'check_in'),
        punch('dup', '2026-11-04T08:00:00Z', 'check_in', { interpretation_status: 'rejected' }),
      ],
      now
    );
    expect(rows.map((row) => row.staffId)).toEqual(['night']);
  });

  it('falls back to the device type when the punch still waits for review', () => {
    const rows = presentNow(
      [punch('omar', '2026-11-04T07:00:00Z', 'check_in', { interpreted_type: null, interpretation_status: 'manual_review' })],
      now
    );
    expect(rows.map((row) => row.staffId)).toEqual(['omar']);
  });
});
