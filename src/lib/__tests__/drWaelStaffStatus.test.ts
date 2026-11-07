import { describe, expect, it } from 'vitest';
import {
  employeeWorkMode,
  endEmploymentLeftLines,
  endEmploymentResultText,
  idleEmployees,
  undoEndEmploymentText,
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

describe('what a separation decision leaves open', () => {
  it('says nothing when nothing is left, including on an older result', () => {
    expect(endEmploymentLeftLines({})).toEqual([]);
    expect(endEmploymentLeftLines({ open_days: [], pending_overtime: 0 })).toEqual([]);
  });

  it('lists punches after the last day first, then days, overtime and leave', () => {
    const lines = endEmploymentLeftLines({
      open_days: ['2026-10-28', '2026-10-29'],
      punch_days_after: ['2026-11-01'],
      pending_overtime: 3,
      leave_after: 1,
    });
    expect(lines).toEqual([
      'فيه بصمات بعد آخر يوم (1/11) ودي مش هتتقفل',
      '2 يوم لسه محتاج مراجعة لحد آخر يوم (28/10، 29/10)',
      '3 أوفر تايم مستني قرار',
      '1 إجازة معتمدة بتعدي آخر يوم',
    ]);
  });

  it('shortens a long list of days', () => {
    const open_days = ['01', '02', '03', '04', '05', '06', '07'].map((d) => `2026-10-${d}`);
    expect(endEmploymentLeftLines({ open_days })[0]).toContain(
      '1/10، 2/10، 3/10، 4/10، 5/10 و2 كمان'
    );
  });

  it('says so when the same decision was already recorded', () => {
    const text = endEmploymentResultText('سارة', {
      last_day: '2026-10-29',
      archived: true,
      days_closed: 0,
      already: true,
    });
    expect(text).toBe('سارة: القرار ده متسجل قبل كده ومفيش حاجة اتغيرت');
  });

  it('adds what is left to the result', () => {
    const text = endEmploymentResultText('سارة', {
      last_day: '2026-10-29',
      archived: true,
      days_closed: 6,
      pending_overtime: 1,
    });
    expect(text).toContain('اتشال من الحضور');
    expect(text).toContain('اتقفل 6 يوم معلق');
    expect(text).toContain('لسه: 1 أوفر تايم مستني قرار');
  });

  it('says login stays closed after taking a decision back', () => {
    const text = undoEndEmploymentText('سارة', {
      days_reopened: 4,
      days_kept: 1,
      login_still_closed: true,
    });
    expect(text).toContain('اترجع 4 يوم');
    expect(text).toContain('1 يوم اتغير من وقتها');
    expect(text).toContain('الدخول على التطبيق لسه مقفول');
  });
});
