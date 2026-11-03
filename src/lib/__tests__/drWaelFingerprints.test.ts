import { describe, expect, it } from 'vitest';
import {
  addDays,
  cycleLabel,
  dayKind,
  employeeMoney,
  mapWithConcurrency,
  openShifts,
  recentExceptions,
  shiftCycle,
  summarizeEmployee,
  todayByBranch,
  workDayRows,
  type DrWaelDay,
  type DrWaelEmployee,
} from '../drWaelFingerprints';
import { DR_WAEL_FINGERPRINTS_PATH, canAccessAccountRoute } from '../core/permissionSystem';
import { GROUPS, isNavItemVisible } from '../../components/layout/SidebarBase';

const day = (patch: Partial<DrWaelDay>): DrWaelDay => ({
  staff_id: 's1',
  date: '2026-11-01',
  branch: 'فرع شكري',
  first_in: null,
  last_out: null,
  hours: 0,
  payable_hours: 0,
  late_minutes: 0,
  early_leave_minutes: 0,
  missing_punch: false,
  status: 'approved',
  resolution: 'on_time',
  review: false,
  scheduled_start: null,
  scheduled_end: null,
  time_off: false,
  punches: 0,
  ...patch,
});
const employee = (staff_id: string, branch: string, active = true) =>
  ({
    staff_id,
    name: staff_id,
    branch,
    role: null,
    type: null,
    active,
    delivery: false,
    join_date: null,
    week: [],
  }) as DrWaelEmployee;

describe('بصمات د وائل', () => {
  it('opens only for the general manager and Dr. Wael accounts', () => {
    expect(
      canAccessAccountRoute(DR_WAEL_FINGERPRINTS_PATH, '748fad73-5aab-4e61-bfd6-8be299af8aa9')
    ).toBe(true);
    expect(
      canAccessAccountRoute(DR_WAEL_FINGERPRINTS_PATH, 'E1454077-98EB-4F54-8FA8-2E4094991435')
    ).toBe(true);
    expect(
      canAccessAccountRoute(DR_WAEL_FINGERPRINTS_PATH, '00000000-0000-4000-8000-000000000001')
    ).toBe(false);
    expect(canAccessAccountRoute(DR_WAEL_FINGERPRINTS_PATH, null)).toBe(false);
    // Other routes are not affected by the account list.
    expect(canAccessAccountRoute('/consolidated-reports', null)).toBe(true);
  });

  it('sits right under «لوحة القيادة» and hides from every other account, whatever the role', () => {
    const items = GROUPS[0].items;
    expect(items[0].label).toBe('لوحة القيادة');
    expect(items[1]).toMatchObject({ path: DR_WAEL_FINGERPRINTS_PATH, label: 'بصمات د وائل' });
    const context = (accountId: string) => ({
      rawRole: 'general_manager',
      accountId,
      role: 'general_manager',
      privileged: true,
      checkPermission: () => true,
    });
    expect(isNavItemVisible(items[1], context('748fad73-5aab-4e61-bfd6-8be299af8aa9'))).toBe(true);
    expect(isNavItemVisible(items[1], context('e1454077-98eb-4f54-8fa8-2e4094991435'))).toBe(true);
    expect(isNavItemVisible(items[1], context('00000000-0000-4000-8000-000000000009'))).toBe(false);
  });

  it('names the 26 → 25 pay cycle after the month it ends in', () => {
    expect(shiftCycle('2026-11', -1)).toBe('2026-10');
    expect(shiftCycle('2026-01', -1)).toBe('2025-12');
    expect(shiftCycle('2026-12', 1)).toBe('2027-01');
    expect(cycleLabel('2026-11')).toBe('26 أكتوبر – 25 نوفمبر 2026');
    expect(cycleLabel('2026-01')).toBe('26 ديسمبر – 25 يناير 2026');
  });

  it('reads the resolved day the way the Base44 app labels it', () => {
    expect(dayKind(day({ review: true, late_minutes: 30 }))).toBe('review');
    expect(dayKind(day({ resolution: 'approved_time_off' }))).toBe('time_off');
    expect(dayKind(day({ resolution: 'off_day' }))).toBe('off');
    expect(dayKind(day({ resolution: 'absence_review' }))).toBe('absent');
    expect(dayKind(day({ resolution: 'very_late', late_minutes: 40, hours: 7 }))).toBe('late');
    expect(dayKind(day({ hours: 8, first_in: '2026-11-01T06:00:00Z' }))).toBe('present');
  });

  it('summarises one employee across the cycle', () => {
    const days = [
      day({ hours: 8, payable_hours: 8, first_in: 'x' }),
      day({
        date: '2026-11-02',
        hours: 7.5,
        payable_hours: 7,
        late_minutes: 30,
        resolution: 'late',
        first_in: 'x',
      }),
      day({
        date: '2026-11-03',
        review: true,
        missing_punch: true,
        punches: 1,
        status: 'pending_review',
      }),
      day({ date: '2026-11-04', resolution: 'off_day' }),
      day({ date: '2026-11-05', resolution: 'absence_review' }),
      day({ staff_id: 's2', hours: 9 }),
    ];
    expect(summarizeEmployee('s1', days)).toMatchObject({
      days: 5,
      workedDays: 2,
      hours: 15.5,
      payableHours: 15,
      lateDays: 1,
      lateMinutes: 30,
      reviewDays: 1,
      singlePunchDays: 1,
      offDays: 1,
      absentDays: 1,
    });
  });

  it('counts today per branch for the dashboard', () => {
    const data = {
      branches: ['فرع شكري', 'فرع الشامي'],
      employees: [
        employee('s1', 'فرع شكري'),
        employee('s2', 'فرع شكري'),
        employee('s3', 'فرع الشامي', false),
      ],
      days: [
        day({ staff_id: 's1', first_in: 'x', hours: 3 }),
        day({ staff_id: 's2', first_in: 'x', late_minutes: 20, resolution: 'late' }),
        day({
          staff_id: 's3',
          branch: 'فرع الشامي',
          review: true,
          missing_punch: true,
          punches: 1,
          first_in: 'x',
        }),
        day({ staff_id: 's1', date: '2026-10-31', first_in: 'x' }),
      ],
    };
    expect(todayByBranch(data, '2026-11-01')).toEqual([
      { branch: 'فرع شكري', employees: 2, present: 2, late: 1, review: 0, absent: 0, off: 0 },
      { branch: 'فرع الشامي', employees: 0, present: 1, late: 0, review: 1, absent: 0, off: 0 },
    ]);
  });

  it('lists who is still in (today or last night) and the exception days of the last five days', () => {
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    const days = [
      day({ staff_id: 'night', date: '2026-10-31', first_in: '2026-10-31T20:00:00Z' }),
      day({ staff_id: 'morning', first_in: '2026-11-01T06:00:00Z' }),
      day({ staff_id: 'left', first_in: '2026-11-01T06:00:00Z', last_out: '2026-11-01T14:00:00Z' }),
      day({ staff_id: 'old', date: '2026-10-30', first_in: '2026-10-30T06:00:00Z' }),
    ];
    expect(openShifts(days, '2026-11-01').map((d) => d.staff_id)).toEqual(['night', 'morning']);
    const recent = recentExceptions(
      [
        day({ date: '2026-10-31', late_minutes: 20, resolution: 'late' }),
        day({ date: '2026-10-31', staff_id: 'ok', hours: 8, first_in: 'x' }),
        day({ date: '2026-10-30', early_leave_minutes: 15, hours: 7, first_in: 'x' }),
        day({ date: '2026-11-01', review: true }),
      ],
      '2026-11-01'
    );
    expect(recent.map((g) => [g.date, g.days.length])).toEqual([
      ['2026-10-31', 1],
      ['2026-10-30', 1],
      ['2026-10-29', 0],
      ['2026-10-28', 0],
      ['2026-10-27', 0],
    ]);
  });

  it('pairs a day of punches into work sessions and flags a lone punch', () => {
    const punch = (staff_id: string | null, at: string, code = '1') => ({
      staff_id,
      name: staff_id,
      branch: 'فرع شكري',
      biometric_user_id: code,
      punch_time: at,
      punch_type: null,
      device_id: null,
    });
    const rows = workDayRows([
      punch('a', '2026-11-01T14:00:00Z'),
      punch('a', '2026-11-01T06:00:00Z'),
      punch('a', '2026-11-01T10:00:00Z'),
      punch('a', '2026-11-01T11:00:00Z'),
      punch('b', '2026-11-01T07:00:00Z'),
      punch(null, '2026-11-01T08:00:00Z', '77'),
      punch(null, '2026-11-01T09:00:00Z', '77'),
      punch('c', '2026-11-01T08:00:00Z'),
      punch('c', '2026-11-01T09:00:00Z'),
      punch('c', '2026-11-01T10:00:00Z'),
    ]);
    const a = rows.find((r) => r.staffId === 'a')!;
    // 06–10 and 11–14: 7h of work in an 8h day, 1h break.
    expect([a.workMinutes, a.grossMinutes, a.breakMinutes, a.singlePunch, a.unpaired]).toEqual([
      420,
      480,
      60,
      false,
      false,
    ]);
    expect(rows.find((r) => r.staffId === 'b')).toMatchObject({
      singlePunch: true,
      workMinutes: 0,
    });
    expect(rows.find((r) => r.staffId === 'c')).toMatchObject({
      unpaired: true,
      workMinutes: 60,
      singlePunch: false,
    });
    expect(rows.find((r) => r.key === 'code:77')).toMatchObject({
      name: 'كود بصمة 77',
      workMinutes: 60,
    });
  });

  it('adds up the incentive and deduction ledgers of one employee', () => {
    const data = {
      incentives: [
        { staff_id: 's1', performance_incentive: 300, target_bonus: 200, automated_total: 500 },
      ],
      movements: [
        {
          id: '1',
          staff_id: 's1',
          type: 'reward',
          category: null,
          reason: null,
          amount: 250,
          date: '2026-11-01',
          status: 'active',
        },
        {
          id: '2',
          staff_id: 's1',
          type: 'penalty',
          category: null,
          reason: null,
          amount: 50,
          date: '2026-11-01',
          status: 'approved',
        },
        {
          id: '3',
          staff_id: 's2',
          type: 'reward',
          category: null,
          reason: null,
          amount: 999,
          date: '2026-11-01',
          status: 'active',
        },
      ],
      manual_entries: [
        {
          id: 'm1',
          staff_id: 's1',
          kind: 'deduction',
          category: 'other',
          amount: 400,
          signed_amount: -400,
          reason: 'سلفة',
          reversal_of: null,
          created_at: '',
          created_by: null,
        },
        {
          id: 'm2',
          staff_id: 's1',
          kind: 'earning',
          category: 'incentive',
          amount: 100,
          signed_amount: 100,
          reason: null,
          reversal_of: null,
          created_at: '',
          created_by: null,
        },
      ],
    };
    expect(employeeMoney('s1', data)).toEqual({
      automatedIncentives: 500,
      performanceIncentive: 300,
      targetBonus: 200,
      rewards: 250,
      penalties: 50,
      manualEarnings: 100,
      manualDeductions: 400,
      manualNet: -300,
    });
    expect(employeeMoney('s3', data).automatedIncentives).toBe(0);
  });

  it('runs the payroll reads a few at a time and keeps their order', async () => {
    let running = 0;
    let peak = 0;
    const result = await mapWithConcurrency([5, 1, 4, 2, 3], 2, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, n));
      running -= 1;
      return n * 10;
    });
    expect(result).toEqual([50, 10, 40, 20, 30]);
    expect(peak).toBe(2);
  });
});
