import { describe, expect, it } from 'vitest';
import {
  sortStaffCredit,
  staffCreditLeaders,
  staffCreditView,
  type DrWaelStaffCreditRow,
  manualPunchErrorText,
  manualPunchFallsNextDay,
  summarizeManualPunches,
  type DrWaelManualPunch,
  addDays,
  clockDistance,
  creditAlerts,
  cycleLabel,
  dayCreditNote,
  datesInPeriod,
  quickPlan,
  type DrWaelDay,
  type PunchReading,
  readOpenDay,
  deliveryCreditView,
  knownShifts,
  matchesEmployeeSearch,
  shiftProfiles,
  weekdayPatterns,
  type DrWaelCreditLedger,
  type DrWaelDeliveryCredit,
  type DrWaelOpenDay,
  type DrWaelShiftSample,
  quickDayOptions,
  dayKind,
  employeeMoney,
  mapWithConcurrency,
  openShifts,
  payrollStaff,
  recentExceptions,
  shiftCycle,
  summarizeEmployee,
  todayByBranch,
  workDayRows,
  workingWeekDays,
  type DrWaelDay,
  type DrWaelEmployee,
} from '../drWaelFingerprints';
import {
  DR_WAEL_FINGERPRINTS_PATH,
  DR_WAEL_SHOKRY_REPORTS_PATH,
  accountDashboardBranch,
  canAccessAccountRoute,
} from '../core/permissionSystem';
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
      { ...punch(null, '2026-11-01T09:00:00Z', '77'), device_id: 'another-device' },
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
    const unmatched = rows.filter((r) => r.name === 'كود بصمة 77');
    expect(unmatched.map((r) => r.workMinutes).sort((a, b) => a - b)).toEqual([0, 60]);
    expect(new Set(unmatched.map((r) => r.key)).size).toBe(2);
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

  it('lists the working days of the week Saturday first, from the resolved week', () => {
    // 2026-10-28 is a Wednesday; Friday 2026-10-30 is off.
    const week = Array.from({ length: 7 }, (_, i) => ({
      date: addDays('2026-10-28', i),
      start: '09:00:00',
      end: '17:00:00',
      off: addDays('2026-10-28', i) === '2026-10-30',
      scheduled: true,
    }));
    expect(workingWeekDays(week)).toEqual([
      'السبت',
      'الأحد',
      'الاثنين',
      'الثلاثاء',
      'الأربعاء',
      'الخميس',
    ]);
    expect(workingWeekDays([])).toEqual([]);
  });

  it('lists the extra managers once, after the active page employees', () => {
    const e = (staff_id: string, active = true) => ({
      staff_id,
      name: staff_id,
      branch: 'b',
      role: null,
      active,
    });
    expect(
      payrollStaff(
        [e('a'), e('b', false), e('amira')],
        [e('amira'), e('ola'), e('gone', false)]
      ).map((x) => x.staff_id)
    ).toEqual(['a', 'amira', 'ola']);
  });

  it('opens «تقارير شكري» for the two accounts and closes the full report to Dr. Wael only', () => {
    const gm = '748fad73-5aab-4e61-bfd6-8be299af8aa9';
    const wael = 'E1454077-98EB-4F54-8FA8-2E4094991435';
    expect(canAccessAccountRoute(DR_WAEL_SHOKRY_REPORTS_PATH, gm)).toBe(true);
    expect(canAccessAccountRoute(DR_WAEL_SHOKRY_REPORTS_PATH, wael)).toBe(true);
    expect(
      canAccessAccountRoute(DR_WAEL_SHOKRY_REPORTS_PATH, '00000000-0000-4000-8000-000000000009')
    ).toBe(false);
    expect(canAccessAccountRoute('/consolidated-reports', wael)).toBe(false);
    expect(canAccessAccountRoute('/consolidated-reports', gm)).toBe(true);
    expect(GROUPS[0].items[2]).toMatchObject({
      path: DR_WAEL_SHOKRY_REPORTS_PATH,
      label: 'تقارير شكري',
    });
  });

  it('keeps Dr. Wael to the Shokry dashboard and his two pages, every other page closed', () => {
    const wael = 'e1454077-98eb-4f54-8fa8-2e4094991435';
    const gm = '748fad73-5aab-4e61-bfd6-8be299af8aa9';
    const context = (accountId: string) => ({
      rawRole: 'executive_manager',
      accountId,
      role: 'executive_manager',
      privileged: true,
      checkPermission: () => true,
    });
    const visible = (accountId: string) =>
      GROUPS.flatMap((group) => group.items)
        .filter((item) => isNavItemVisible(item, context(accountId)))
        .map((item) => item.path);
    expect(visible(wael)).toEqual(['/', DR_WAEL_FINGERPRINTS_PATH, DR_WAEL_SHOKRY_REPORTS_PATH]);
    expect(visible(gm).length).toBeGreaterThan(3);
    for (const path of ['/attendance-report', '/team', '/payroll', '/staff/1'])
      expect(canAccessAccountRoute(path, wael)).toBe(false);
    expect(canAccessAccountRoute('/', wael)).toBe(true);
    expect(accountDashboardBranch(wael.toUpperCase())).toBe('فرع شكري');
    expect(accountDashboardBranch(gm)).toBeNull();
  });
});

describe('one-click decisions next to a day under review', () => {
  const base = {
    staff_id: 's1',
    date: '2026-11-04',
    branch: 'فرع شكري',
    first_in: null,
    last_out: null,
    hours: null,
    payable_hours: null,
    late_minutes: 0,
    early_leave_minutes: 0,
    missing_punch: false,
    status: 'pending_review',
    resolution: null,
    review: true,
    scheduled_start: '2026-11-04T07:00:00Z',
    scheduled_end: '2026-11-04T15:00:00Z',
    time_off: false,
    punches: 0,
  };
  const pick = (
    day: Partial<typeof base> & {
      resolution: string;
      first_in?: string | null;
      last_out?: string | null;
      hours?: number | null;
    }
  ) =>
    quickDayOptions({ ...base, ...day } as Parameters<typeof quickDayOptions>[0]).map(
      (o) => o.decision
    );

  it('offers the fitting decision for each case', () => {
    expect(pick({ resolution: 'missing_checkout', first_in: '2026-11-04T07:05:00Z' })).toEqual([
      'to_shift_end',
    ]);
    expect(pick({ resolution: 'missing_checkin', last_out: '2026-11-04T15:05:00Z' })).toEqual([
      'from_shift_start',
    ]);
    expect(pick({ resolution: 'absence_review' })).toEqual(['absent', 'off']);
    expect(pick({ resolution: 'no_schedule' })).toEqual(['as_is']);
    expect(
      pick({
        resolution: 'early_leave_review',
        first_in: '2026-11-04T07:00:00Z',
        last_out: '2026-11-04T13:00:00Z',
        hours: 6,
      })
    ).toEqual(['as_is']);
  });

  it('offers nothing for what needs the detailed review', () => {
    expect(pick({ resolution: 'worked_on_off', first_in: '2026-11-04T07:00:00Z' })).toEqual([]);
    expect(pick({ resolution: 'absence_review', first_in: '2026-11-04T07:00:00Z' })).toEqual([]);
    expect(
      pick({
        resolution: 'missing_checkout',
        first_in: '2026-11-04T07:05:00Z',
        scheduled_end: null,
      } as never)
    ).toEqual([]);
    expect(
      quickDayOptions({ ...base, resolution: 'absence_review', review: false } as never)
    ).toEqual([]);
  });
});

describe('employee search with *', () => {
  it('finds by part of the name, with * and with loose spelling', () => {
    expect(matchesEmployeeSearch('د/ علياء', 'علياء')).toBe(true);
    expect(matchesEmployeeSearch('د/ علياء', 'د علياء')).toBe(true);
    expect(matchesEmployeeSearch('أحمد أبو نور', 'احمد*نور')).toBe(true);
    expect(matchesEmployeeSearch('أحمد أبو نور', '*نور')).toBe(true);
    expect(matchesEmployeeSearch('حبيبة تامر', 'حبيبه')).toBe(true);
    expect(matchesEmployeeSearch('حبيبة تامر', 'تامر*حبيبة')).toBe(false);
    expect(matchesEmployeeSearch('محمد', '   ')).toBe(true);
  });
});

describe('delivery and missing-punch credit', () => {
  const credit: DrWaelDeliveryCredit = {
    status: 'insufficient_attendance_days',
    band: null,
    band_ar: 'غير مؤهل بعد',
    attended_days: 10,
    minimum_days: 26,
    pending_days: 2,
    minutes: 40,
    late_minutes: 40,
    early_minutes: 0,
    excused_minutes: 0,
    committed_credit: 50,
    regular_credit: 300,
    committed_per_day: 5,
    regular_per_day: 30,
    days: [],
  };

  it('uses the payroll rule on the minutes and looks ahead to the end of the cycle', () => {
    const view = deliveryCreditView(credit, '2026-11-06', '2026-11-25');
    expect(view.band).toBe('committed');
    expect(view.final).toBe(false);
    expect(view.committedLeft).toBe(10);
    expect(view.daysLeft).toBe(20);
    expect(view.reachableDays).toBe(32);
    expect(view.canReachMinimum).toBe(true);
    expect(view.bestBand).toBe('committed');
  });

  it('warns only about what can no longer be fixed', () => {
    const ledger = (delivery: DrWaelDeliveryCredit, used = 0): DrWaelCreditLedger => ({
      month_cycle: '2026-11',
      cycle_start: '2026-10-26',
      cycle_end: '2026-11-25',
      today: '2026-11-06',
      missing_limit: 2,
      missing_penalty: 50,
      rows: [
        { staff_id: 's', missing_used: used, missing_penalized: 0, missing_open: 0, delivery },
      ],
    });
    expect(creditAlerts(ledger(credit))).toEqual([]);
    expect(creditAlerts(ledger({ ...credit, minutes: 200 }))[0].text).toContain('«عادي»');
    expect(creditAlerts(ledger({ ...credit, minutes: 1000 }))[0].severity).toBe('danger');
    expect(creditAlerts(ledger(credit, 2))[0].severity).toBe('warning');
    expect(creditAlerts(ledger(credit, 3))[0].severity).toBe('danger');
  });

  it('explains what a day under review costs him', () => {
    const row = {
      staff_id: 's',
      missing_used: 2,
      missing_penalized: 0,
      missing_open: 1,
      delivery: credit,
    };
    const base = { late_minutes: 15, early_leave_minutes: 0, resolution: 'late' } as DrWaelDay;
    expect(dayCreditNote(base, row, 2, 50)).toContain('فاضل 10 د ملتزم');
    expect(dayCreditNote({ ...base, resolution: 'missing_checkout' }, row, 2, 50)).toContain(
      'خصم 50'
    );
    expect(dayCreditNote(base, undefined, 2, 50)).toBeNull();
  });
});

describe('rotating shifts', () => {
  const day = (
    date: string,
    inAt: string,
    outAt: string,
    scheduled: [string, string] | null,
    extra: Partial<DrWaelShiftSample> = {}
  ): DrWaelShiftSample => {
    const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    return {
      staff_id: 's',
      date,
      in: m(inAt),
      out: m(outAt),
      scheduled_in: scheduled ? m(scheduled[0]) : null,
      scheduled_out: scheduled ? m(scheduled[1]) : null,
      late: 0,
      early: 0,
      locked: false,
      ...extra,
    };
  };
  const morning: [string, string] = ['09:00', '17:00'];
  const noon: [string, string] = ['13:00', '21:00'];
  const samples = [
    day('2026-10-26', '09:27', '17:04', morning),
    day('2026-10-27', '09:05', '17:00', morning),
    day('2026-10-28', '09:17', '17:14', morning),
    day('2026-10-31', '13:08', '21:04', noon),
    day('2026-11-01', '13:30', '20:56', noon),
    day('2026-11-02', '13:45', '21:12', noon),
    day('2026-11-04', '09:26', '16:59', noon, { late: 0, early: 241 }),
  ];

  it('measures clock distance across midnight', () => {
    expect(clockDistance(1430, 10)).toBe(20);
    expect(clockDistance(540, 780)).toBe(240);
  });

  it('finds every shift he really works, with the planned hours', () => {
    const known = knownShifts(samples);
    expect(known.map((k) => `${k.start}-${k.end}`)).toEqual(['09:00-17:00', '13:00-21:00']);
    expect(known[0].days).toBe(4);
    expect(known.every((k) => k.scheduled)).toBe(true);
  });

  it('keeps a night shift across midnight together', () => {
    const night = ['2026-10-01', '2026-10-02', '2026-10-03'].map((d, i) =>
      day(d, i ? '00:05' : '23:50', '08:10', ['00:00', '08:00'])
    );
    expect(knownShifts(night).map((k) => `${k.start}-${k.end}`)).toEqual(['00:00-08:00']);
  });

  it('flags the day that followed another shift and what it costs', () => {
    const profile = shiftProfiles(samples, '2026-11-06').get('s');
    expect(profile?.rotating).toBe(true);
    expect(profile?.mismatches).toHaveLength(1);
    expect(profile?.mismatches[0].sample.date).toBe('2026-11-04');
    expect(profile?.mismatches[0].shift.start).toBe('09:00');
    expect(profile?.mismatches[0].minutes).toBe(241);
  });

  it('does not forgive a plain late arrival: the leaving time must move too', () => {
    const late = [
      ...samples,
      day('2026-11-05', '11:00', '17:00', morning, { late: 120 }),
      day('2026-11-05', '11:10', '17:05', morning, { late: 130 }),
      day('2026-11-05', '11:05', '17:02', morning, { late: 125 }),
    ];
    const profile = shiftProfiles(late, '2026-11-06').get('s');
    expect(profile?.mismatches.map((m) => m.sample.date)).toEqual(['2026-11-04']);
  });

  it('leaves manager-approved and too-old days alone', () => {
    const locked = samples.map((s) => (s.date === '2026-11-04' ? { ...s, locked: true } : s));
    expect(shiftProfiles(locked, '2026-11-06').get('s')?.mismatches).toEqual([]);
    expect(shiftProfiles(samples, '2027-01-30').get('s')?.mismatches).toEqual([]);
  });

  it('a steady schedule is not rotating', () => {
    const profile = shiftProfiles(samples.slice(0, 3), '2026-11-06').get('s');
    expect(profile?.rotating).toBe(false);
    expect(profile?.mismatches).toEqual([]);
  });
});

describe('a shift that repeats on one weekday', () => {
  const row = (
    date: string,
    inAt: number,
    outAt: number,
    plan: [number, number],
    extra: Partial<DrWaelShiftSample> = {}
  ): DrWaelShiftSample => ({
    staff_id: 's',
    date,
    in: inAt,
    out: outAt,
    scheduled_in: plan[0],
    scheduled_out: plan[1],
    late: 0,
    early: 0,
    locked: false,
    ...extra,
  });
  const usual: [number, number] = [1200, 240];
  const thursday: [number, number] = [1200, 480];
  // يوسف عيد's real weeks: 20:00–04:00, but Thursday's schedule says until 08:00.
  const weeks = [
    row('2026-10-08', 1185, 242, thursday, { early: 237 }),
    row('2026-10-15', 1194, 181, thursday, { early: 298 }),
    row('2026-10-22', 1182, 301, thursday, { early: 178 }),
    row('2026-10-29', 1185, 238, thursday, { early: 241 }),
    row('2026-11-05', 1192, 131, thursday, { early: 348 }),
    row('2026-10-24', 1186, 248, usual),
    row('2026-10-25', 1135, 254, usual),
    row('2026-10-26', 1197, 241, usual),
    row('2026-10-27', 1167, 243, usual),
    row('2026-11-03', 1212, 253, usual, { late: 12 }),
  ];

  it('finds the wrong weekday in the schedule and what it costs', () => {
    const [pattern] = weekdayPatterns(weeks, '2026-11-06');
    expect(pattern.day).toBe('الخميس');
    expect(pattern.start).toBe('20:00');
    expect(pattern.end).toBe('04:00');
    expect(pattern.scheduledEnd).toBe('08:00');
    expect(pattern.minutes).toBe(954);
    expect(pattern.from).toBe('2026-10-08');
  });

  it('does not read a daily habit as a weekday shift', () => {
    const everyDay: DrWaelShiftSample[] = [];
    for (let i = 0; i < 28; i += 1) {
      everyDay.push(row(addDays('2026-10-05', i), 660, 1020, [540, 1020], { late: 120 }));
    }
    expect(weekdayPatterns(everyDay, '2026-11-06')).toEqual([]);
  });

  it('needs a real repeat, and leaves approved days out of the correction', () => {
    expect(weekdayPatterns(weeks.slice(3), '2026-11-06')).toEqual([]);
    const locked = weeks.map((w) => (w.date === '2026-10-08' ? { ...w, locked: true } : w));
    const [pattern] = weekdayPatterns(locked, '2026-11-06');
    expect(pattern.from).toBe('2026-10-15');
    expect(pattern.minutes).toBe(717);
  });

  it('does not offer the same days twice', () => {
    const profile = shiftProfiles(weeks, '2026-11-06').get('s');
    expect(profile?.weekly).toHaveLength(1);
    expect(profile?.mismatches).toEqual([]);
  });
});

describe('readOpenDay', () => {
  const day = (over: Partial<DrWaelOpenDay> = {}): DrWaelOpenDay => ({
    staff_id: 's1',
    date: '2026-11-04',
    resolution: 'missing_checkout',
    late: 0,
    early: 0,
    scheduled_in: '13:00',
    scheduled_out: '21:00',
    ...over,
  });
  const known = { start: '09:00', end: '17:00', source: 'known' as const };

  it('reads two punches on another of his shifts (real case: schedule 13-21, punches 09:26 and 16:59)', () => {
    const reading = readOpenDay(day(), ['2026-11-04T09:26', '2026-11-04T16:59'], [known]);
    expect(reading).toMatchObject({
      start: '09:00',
      end: '17:00',
      source: 'known',
      inAt: '2026-11-04T09:26',
      outAt: '2026-11-04T16:59',
      late: 26,
      early: 1,
    });
  });

  it('prefers the suggested shift when two shifts fit equally', () => {
    const reading = readOpenDay(
      day(),
      ['2026-11-04T09:00', '2026-11-04T17:00'],
      [known, { start: '09:00', end: '17:00', source: 'suggested' }]
    );
    expect(reading?.source).toBe('suggested');
  });

  it('follows an overnight shift to its leaving punch on the next date', () => {
    const reading = readOpenDay(
      day({
        date: '2026-10-30',
        resolution: 'worked_on_off',
        scheduled_in: null,
        scheduled_out: null,
      }),
      ['2026-10-30T01:38', '2026-10-30T17:18', '2026-10-31T00:45'],
      [{ start: '17:00', end: '00:00', source: 'known' }]
    );
    expect(reading).toMatchObject({
      inAt: '2026-10-30T17:18',
      outAt: '2026-10-31T00:45',
      late: 18,
      early: 0,
    });
  });

  it('takes the punch before a midnight start from the evening before (real case: off Thursdays he works)', () => {
    const reading = readOpenDay(
      day({
        date: '2026-11-05',
        resolution: 'worked_on_off',
        scheduled_in: null,
        scheduled_out: null,
      }),
      ['2026-11-04T23:17', '2026-11-05T09:39', '2026-11-05T23:13'],
      [{ start: '00:00', end: '09:00', source: 'known' }]
    );
    expect(reading).toMatchObject({
      inAt: '2026-11-04T23:17',
      outAt: '2026-11-05T09:39',
      early: 0,
    });
  });

  it('reads one punch only on a day with no schedule', () => {
    const shift = [{ start: '14:00', end: '22:00', source: 'known' as const }];
    expect(
      readOpenDay(
        day({ resolution: 'worked_on_off', scheduled_in: null, scheduled_out: null }),
        ['2026-11-04T14:13'],
        shift
      )
    ).toMatchObject({ inAt: '2026-11-04T14:13', outAt: null, late: 13 });
    expect(
      readOpenDay(
        day({ scheduled_in: '10:00', scheduled_out: '18:00' }),
        ['2026-11-04T14:13'],
        shift
      )
    ).toBeNull();
  });

  it('keeps a late arrival on his own shift as late, even when a nearby shift exists (real case: 15:14-20:05 on 14:30-20:30)', () => {
    expect(
      readOpenDay(
        day({ resolution: 'early_leave_review', scheduled_in: '14:30', scheduled_out: '20:30' }),
        ['2026-11-04T15:14', '2026-11-04T20:05'],
        [{ start: '15:00', end: '20:00', source: 'known' }]
      )
    ).toBeNull();
  });

  it('says nothing when the schedule already is that shift', () => {
    expect(
      readOpenDay(
        day({ scheduled_in: '09:00', scheduled_out: '17:00' }),
        ['2026-11-04T09:26'],
        [known]
      )
    ).toBeNull();
  });

  it('does not take a late day for another shift when only arrival and leaving do not fit', () => {
    expect(
      readOpenDay(
        day({ resolution: 'early_leave_review' }),
        ['2026-11-04T13:05', '2026-11-04T18:00'],
        [known]
      )
    ).toBeNull();
  });

  it('builds a shift from the punches only for an unpaired day, never for a late or early one', () => {
    const punches = ['2026-10-27T15:34', '2026-10-28T00:24'];
    expect(
      readOpenDay(day({ date: '2026-10-27', resolution: 'missing_checkin' }), punches, [])
    ).toMatchObject({ source: 'punches', start: '15:30', end: '00:30' });
    expect(
      readOpenDay(day({ date: '2026-10-27', resolution: 'early_leave_review' }), punches, [])
    ).toBeNull();
  });

  it('does not build a shift from a double punch', () => {
    expect(readOpenDay(day(), ['2026-11-04T07:58', '2026-11-04T07:59'], [])).toBeNull();
  });
});

describe('datesInPeriod', () => {
  it('counts every day, or only the chosen weekday', () => {
    expect(datesInPeriod('2026-11-01', '2026-11-07', null)).toBe(7);
    expect(datesInPeriod('2026-11-01', '2026-11-30', ['الخميس'])).toBe(4);
    expect(datesInPeriod('2026-11-07', '2026-11-01', null)).toBe(0);
  });
});

describe('quickPlan', () => {
  const day = (over: Partial<DrWaelDay>): DrWaelDay => ({
    staff_id: 's1',
    date: '2026-11-04',
    branch: 'فرع شكري',
    first_in: '2026-11-04T11:00:00Z',
    last_out: '2026-11-04T19:00:00Z',
    hours: 8,
    payable_hours: 8,
    late_minutes: 0,
    early_leave_minutes: 0,
    missing_punch: false,
    status: 'pending_review',
    resolution: 'late',
    review: true,
    scheduled_start: '2026-11-04T11:00:00Z',
    scheduled_end: '2026-11-04T19:00:00Z',
    time_off: false,
    punches: 2,
    ...over,
  });
  const plan = (days: DrWaelDay[], readings: PunchReading[] = [], allowance = 2) =>
    quickPlan(
      days,
      '2026-11-07',
      new Map(readings.map((r) => [`${r.staff_id}-${r.date}`, r])),
      new Set(['flex']),
      () => allowance
    );
  const reading = (over: Partial<PunchReading> = {}): PunchReading => ({
    staff_id: 's1',
    date: '2026-11-04',
    start: '09:00',
    end: '17:00',
    source: 'known',
    trusted: true,
    inAt: '2026-11-04T09:26',
    outAt: '2026-11-04T16:59',
    late: 26,
    early: 1,
    nowMinutes: 240,
    ...over,
  });

  it('runs a forgotten punch while the allowance lasts, then asks, oldest first', () => {
    const forgot = (date: string) => day({ date, resolution: 'missing_checkout', last_out: null });
    const result = plan([forgot('2026-11-05'), forgot('2026-11-03'), forgot('2026-11-04')], [], 2);
    expect(result.clear.map((i) => i.day.date)).toEqual(['2026-11-04', '2026-11-03']);
    expect(result.ask.map((i) => i.day.date)).toEqual(['2026-11-05']);
    expect(result.ask[0].why).toContain('سماح');
  });

  it('runs small minutes and asks about real ones', () => {
    const result = plan([
      day({ date: '2026-11-03', late_minutes: 10 }),
      day({ date: '2026-11-04', resolution: 'early_leave_review', early_leave_minutes: 142 }),
    ]);
    expect(result.clear.map((i) => i.group)).toEqual(['small']);
    expect(result.ask.map((i) => i.group)).toEqual(['minutes']);
  });

  it('never decides an absence on its own', () => {
    const result = plan([
      day({ resolution: 'absence_review', first_in: null, last_out: null, punches: 0 }),
    ]);
    expect(result.clear).toEqual([]);
    expect(result.ask[0].primary).toMatchObject({ decision: 'absent' });
    expect(result.ask[0].secondary).toMatchObject({ decision: 'off' });
  });

  it('prefers the shift when the punches explain the day, and runs it only when it is trusted', () => {
    const open = day({ resolution: 'early_leave_review', early_leave_minutes: 240 });
    expect(plan([open], [reading()]).clear[0].primary).toMatchObject({
      type: 'shift',
      start: '09:00',
    });
    expect(plan([open], [reading({ trusted: false })]).clear).toEqual([]);
    expect(plan([open], [reading({ source: 'punches' })]).clear).toEqual([]);
    expect(plan([open], [reading({ late: 40 })]).clear).toEqual([]);
    expect(plan([open], [reading({ outAt: null })]).clear).toEqual([]);
  });

  it('leaves today, approved days and flexible staff out of the one-click rules', () => {
    const result = plan([
      day({ date: '2026-11-07', late_minutes: 5 }),
      day({ status: 'approved', late_minutes: 5 }),
      day({ staff_id: 'flex', late_minutes: 5 }),
    ]);
    expect(result.clear).toEqual([]);
    expect(result.ask.map((i) => i.day.staff_id)).toEqual(['flex']);
    expect(result.ask[0].primary.type).toBe('details');
  });

  it('sends what has no quick decision to the details', () => {
    const result = plan([day({ resolution: 'worked_on_off', first_in: null })]);
    expect(result.ask[0].primary.type).toBe('details');
    expect(result.ask[0].secondary).toBeNull();
  });
});

describe('manual punches', () => {
  const punch = (over: Partial<DrWaelManualPunch>): DrWaelManualPunch => ({
    id: 'a',
    staff_id: 's',
    date: '2026-11-03',
    type: 'check_in',
    at: '2026-11-03T08:00:00Z',
    reason: null,
    by: null,
    occurrence_no: 1,
    allowance_limit: 2,
    penalized: false,
    day_status: 'approved',
    resolution: 'on_time',
    counted: true,
    ...over,
  });

  it('counts what is counted and what falls inside the allowance, each on its own', () => {
    expect(
      summarizeManualPunches([
        punch({}),
        punch({ occurrence_no: 2, counted: false }),
        punch({ occurrence_no: 3, penalized: true }),
        punch({ occurrence_no: null, allowance_limit: null }),
      ])
    ).toEqual({
      total: 4,
      counted: 3,
      notCounted: 1,
      insideAllowance: 2,
      overAllowance: 1,
      outsideCount: 1,
      penalized: 1,
    });
  });

  const fall = (over: Partial<Parameters<typeof manualPunchFallsNextDay>[0]>) =>
    manualPunchFallsNextDay({
      type: 'check_out',
      time: '08:00',
      firstIn: null,
      shiftStart: null,
      shiftEnd: null,
      ...over,
    });

  it('puts the check-out of an overnight shift on the next morning', () => {
    expect(fall({ shiftStart: '22:00', shiftEnd: '08:00' })).toBe(true);
    expect(fall({ shiftStart: '09:00', shiftEnd: '19:00' })).toBe(false);
    expect(fall({ type: 'check_in', shiftStart: '22:00', shiftEnd: '08:00' })).toBe(false);
  });

  it("puts a check-out earlier than that day's check-in on the next morning", () => {
    expect(fall({ firstIn: '2026-11-03T20:53:00Z' })).toBe(true);
    expect(fall({ time: '23:30', firstIn: '2026-11-03T20:53:00Z' })).toBe(false);
  });

  it('says why a punch was refused', () => {
    expect(manualPunchErrorText(new Error('manual_punch_cycle_locked'))).toContain('اتقفل');
    expect(manualPunchErrorText(new Error('something else'))).toBe('ماتسجلتش، حاول تاني');
  });
});

describe('staff commitment and flexibility credit', () => {
  const limits = { committed_per_day: 5, regular_per_day: 30 };
  const row = (over: Partial<DrWaelStaffCreditRow> = {}): DrWaelStaffCreditRow => ({
    staff_id: 's1',
    name: 'موظف',
    branch: 'فرع شكري',
    attended_days: 10,
    late_minutes: 0,
    early_minutes: 0,
    excused_minutes: 0,
    minutes: 0,
    absent_days: 0,
    missing_used: 0,
    management: 0,
    employee: 0,
    correction: 0,
    unclassified: 0,
    reduced: 0,
    changes: [],
    ...over,
  });

  it('uses the same minutes-per-day limits as delivery', () => {
    expect(staffCreditView(row({ minutes: 50 }), limits).band).toBe('committed');
    expect(staffCreditView(row({ minutes: 51 }), limits).band).toBe('regular');
    expect(staffCreditView(row({ minutes: 300 }), limits).band).toBe('regular');
    expect(staffCreditView(row({ minutes: 301 }), limits).band).toBe('low');
  });

  it('has no band before an attended day', () => {
    expect(staffCreditView(row({ attended_days: 0 }), limits)).toMatchObject({
      band: null,
      minutesPerDay: 0,
    });
  });

  it('does not call someone with an approved absence committed', () => {
    expect(staffCreditView(row({ absent_days: 1 }), limits).band).toBe('regular');
    expect(staffCreditView(row({ absent_days: 1, minutes: 400 }), limits).band).toBe('low');
  });

  it('counts a change for them when we asked and against them when they did', () => {
    expect(staffCreditView(row({ management: 3, employee: 1 }), limits)).toMatchObject({
      balance: 2,
      flexLabel: 'متعاون',
    });
    expect(staffCreditView(row({ employee: 2 }), limits)).toMatchObject({
      balance: -2,
      flexLabel: 'بيغيّر من نفسه',
    });
    expect(staffCreditView(row({ management: 1, employee: 1 }), limits).flexLabel).toBe('متوازن');
  });

  it('leaves corrections and unanswered changes out of the balance', () => {
    expect(staffCreditView(row({ correction: 4, unclassified: 3 }), limits)).toMatchObject({
      balance: 0,
      flexLabel: 'مفيش تغييرات',
    });
  });

  it('names leaders only for a real reason', () => {
    const rows = [
      row({ staff_id: 'zero', minutes: 400 }),
      row({ staff_id: 'clean', minutes: 10 }),
      row({ staff_id: 'absent', absent_days: 2 }),
      row({ staff_id: 'flex', minutes: 100, management: 2 }),
      row({ staff_id: 'self', employee: 2 }),
    ];
    const leaders = staffCreditLeaders(rows, limits);
    expect(leaders.committed.map((r) => r.staff_id)).toEqual(['self', 'clean']);
    expect(leaders.flexible.map((r) => r.staff_id)).toEqual(['flex']);
  });

  it('sorts by balance, then by fewer minutes', () => {
    const sorted = sortStaffCredit(
      [
        row({ staff_id: 'a', employee: 1 }),
        row({ staff_id: 'b', minutes: 100 }),
        row({ staff_id: 'c', minutes: 10 }),
        row({ staff_id: 'd', management: 1, minutes: 200 }),
      ],
      limits
    );
    expect(sorted.map((r) => r.staff_id)).toEqual(['d', 'c', 'b', 'a']);
  });
});
