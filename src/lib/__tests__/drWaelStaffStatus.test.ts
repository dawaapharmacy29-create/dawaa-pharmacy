import { describe, expect, it } from 'vitest';
import {
  employeeWorkMode,
  idleEmployees,
  type DrWaelEmployee,
  type DrWaelTimeOff,
} from '../drWaelFingerprints';

const employee = (over: Partial<DrWaelEmployee>): DrWaelEmployee => ({
  staff_id: 's1',
  name: 'موظف',
  branch: 'فرع شكري',
  role: null,
  type: null,
  active: true,
  delivery: false,
  join_date: '2025-01-01',
  week: [],
  status: 'نشط',
  work_mode: null,
  last_punch: '2026-11-03T08:00:00Z',
  ...over,
});

const leave = (over: Partial<DrWaelTimeOff>): DrWaelTimeOff => ({
  id: 'l1',
  staff_id: 's1',
  kind: 'approved_absence',
  label: null,
  status: 'approved',
  start_date: '2026-11-01',
  end_date: '2026-11-10',
  start_time: null,
  end_time: null,
  minutes: null,
  reason: null,
  decided_by: null,
  ...over,
});

describe('ترك عمل / نظام الشغل', () => {
  const today = '2026-11-04';

  it('lists «موقوف» staff and staff with no punch for 5 days, «موقوف» first then the longest away', () => {
    const rows = idleEmployees(
      [
        employee({ staff_id: 'recent' }),
        employee({ staff_id: 'away', last_punch: '2026-10-22T09:00:00Z' }),
        employee({ staff_id: 'stopped', status: 'موقوف', last_punch: '2026-11-02T22:30:00Z' }),
        employee({ staff_id: 'farther', last_punch: '2026-10-11T09:00:00Z' }),
      ],
      [],
      today
    );
    expect(rows.map((row) => row.employee.staff_id)).toEqual(['stopped', 'farther', 'away']);
    // A late-night punch belongs to the Cairo day (00:30 on the 3rd).
    expect(rows[0]).toMatchObject({ lastPunchDay: '2026-11-03', daysAway: 1, stopped: true });
    expect(rows[2]).toMatchObject({ lastPunchDay: '2026-10-22', daysAway: 13, stopped: false });
  });

  it('leaves out staff on a running leave, already leaving, archived, or paid by hours', () => {
    const old = '2026-10-01T09:00:00Z';
    const rows = idleEmployees(
      [
        employee({ staff_id: 's1', last_punch: old }),
        employee({ staff_id: 'leaving', status: 'قيد المغادرة', last_punch: old }),
        employee({ staff_id: 'archived', active: false, last_punch: old }),
        employee({ staff_id: 'joker', work_mode: 'joker', last_punch: old }),
        employee({ staff_id: 'flex', work_mode: 'flexible', last_punch: old }),
        employee({ staff_id: 'future', last_punch: old }),
      ],
      [leave({}), leave({ id: 'l2', staff_id: 'future', start_date: '2026-11-08' })],
      today
    );
    expect(rows.map((row) => row.employee.staff_id)).toEqual(['future']);
  });

  it('skips a new hire who never punched but lists an old one', () => {
    const rows = idleEmployees(
      [
        employee({ staff_id: 'new', last_punch: null, join_date: '2026-11-02' }),
        employee({ staff_id: 'old', last_punch: null, join_date: '2026-09-01' }),
      ],
      [],
      today
    );
    expect(rows.map((row) => [row.employee.staff_id, row.lastPunchDay, row.daysAway])).toEqual([
      ['old', null, null],
    ]);
  });

  it('lights the work-mode chip from the hour rule', () => {
    expect(employeeWorkMode({ work_mode: null })).toBe('regular');
    expect(employeeWorkMode({ work_mode: 'part_time' })).toBe('part_time');
    expect(employeeWorkMode({ work_mode: 'joker' })).toBe('joker');
    expect(employeeWorkMode({ work_mode: 'flexible' })).toBeNull();
  });
});
