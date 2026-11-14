import { describe, expect, it } from 'vitest';
import {
  applyCorrections,
  closerOnShift,
  closerPresence,
  closerPresenceText,
  branchAt,
  handoverMoment,
  handoverWindow,
  missingByBranch,
  onDutyLabel,
  personKey,
  presenceIn,
  presenceLabel,
  readHandovers,
  responsibleNames,
  shiftCoverage,
  shiftDeadline,
  shiftGapLabel,
  shiftGapTone,
  shiftResponsible,
  type PunchInterval,
} from '../shiftHandoverCoverage';
import { gmReviewSummary } from '../gmDailyReview';

// 2026-11-02 is winter time in Cairo (UTC+2).
const row = (
  id: string,
  branch: string,
  shift_type: string,
  shift_date: string,
  is_archived = false
) => ({ id, branch, shift_type, shift_date, is_archived });

describe('shift handover coverage', () => {
  it('deadlines: night 10:00, morning 19:00, evening 03:00 the next day (Cairo)', () => {
    expect(shiftDeadline('2026-11-01', 'ليلي').toISOString()).toBe('2026-11-01T08:00:00.000Z');
    expect(shiftDeadline('2026-11-01', 'صباحي').toISOString()).toBe('2026-11-01T17:00:00.000Z');
    expect(shiftDeadline('2026-11-01', 'مسائي').toISOString()).toBe('2026-11-02T01:00:00.000Z');
  });

  it('marks each branch × shift closed, doubled, late or not yet due', () => {
    // 12:00 Cairo on 2 Nov: today's night is due, morning and evening are not.
    const now = new Date('2026-11-02T10:00:00Z');
    const slots = shiftCoverage(
      [
        row('1', 'فرع شكري', 'ليلي', '2026-11-02'),
        row('2', 'فرع شكري', 'مسائي', '2026-11-01'),
        row('3', 'فرع شكري', 'مسائي', '2026-11-01'),
        row('4', 'فرع الشامي', 'ليلي', '2026-11-02', true),
      ],
      2,
      now
    );
    const at = (day: string, branch: string, shift: string) =>
      slots.find((s) => s.day === day && s.branch === branch && s.shift === shift)!.status;
    expect(slots).toHaveLength(12);
    expect(at('2026-11-02', 'فرع شكري', 'ليلي')).toBe('closed');
    expect(at('2026-11-02', 'فرع شكري', 'صباحي')).toBe('pending');
    expect(at('2026-11-01', 'فرع شكري', 'مسائي')).toBe('duplicate');
    // An archived handover does not close the shift.
    expect(at('2026-11-02', 'فرع الشامي', 'ليلي')).toBe('late');
    expect(at('2026-11-01', 'فرع الشامي', 'صباحي')).toBe('late');
  });

  it('names the doctors on duty and applies corrections in order', () => {
    expect(onDutyLabel(undefined)).toBe('');
    expect(onDutyLabel([])).toBe('مفيش بصمة ولا جدول');
    expect(
      onDutyLabel([
        { staff_id: '1', name: 'د أ', source: 'punch' },
        { staff_id: '2', name: 'د ب', source: 'schedule' },
      ])
    ).toBe('د أ، د ب (جدول من غير بصمة)');
    const base = { id: 'h1', net_amount: 900, submitted_by: 'د غلط', cash_variance: -50 };
    const fix = (
      id: string,
      created_at: string,
      changes: Record<string, unknown>,
      handover_id = 'h1'
    ) => ({
      id,
      handover_id,
      changes,
      previous: {},
      reason: 'x',
      corrected_by_name: null,
      created_at,
    });
    expect(
      applyCorrections(base, [
        fix('2', '2026-11-01T12:00:00Z', { cash_variance: -20 }),
        fix('1', '2026-11-01T10:00:00Z', { submitted_by: 'د صح', cash_variance: 0 }),
        fix('3', '2026-11-01T13:00:00Z', { net_amount: 1 }, 'other'),
      ])
    ).toEqual({ id: 'h1', net_amount: 900, submitted_by: 'د صح', cash_variance: -20 });
  });
});

describe('who was on the shift, from the fingerprints', () => {
  const omar = {
    staff_id: 'a1',
    name: 'محمد عمر',
    kind: 'assistant' as const,
    source: 'punch' as const,
  };
  const reda = {
    staff_id: 'd1',
    name: 'د/ رضا',
    kind: 'doctor' as const,
    source: 'punch' as const,
  };

  it('marks assistants and reads one person under different spellings', () => {
    expect(onDutyLabel([reda, omar])).toBe('د/ رضا، محمد عمر (مساعد)');
    expect(personKey('د/ أحمد عاطف')).toBe(personKey('د احمد عاطف'));
    expect(personKey('د/ عمر عيسى')).toBe('عمر عيسي');
  });

  it('checks the closer against the punches, by staff id or by name', () => {
    expect(closerOnShift({ name: 'محمد عمر' }, [reda, omar])).toBe('yes');
    expect(closerOnShift({ name: 'د رضا', staffId: 'x' }, [reda])).toBe('yes');
    expect(closerOnShift({ name: 'د اميرة', staffId: 'm1' }, [reda, omar])).toBe('no');
    expect(closerOnShift({ name: 'د اميرة' }, [{ ...reda, source: 'schedule' }])).toBe('unknown');
    expect(closerOnShift({ name: 'د اميرة' }, null)).toBe('unknown');
  });

  it("says a missing shift from another day apart from yesterday's count", () => {
    const [line] = gmReviewSummary({
      key: 'shifts',
      data_day: '2026-11-04',
      detail: {
        synced_at: new Date().toISOString(),
        branches: [
          {
            branch: 'shokry',
            yesterday_done: 3,
            missing: [{ day: '2026-11-03', shift: 'صباحي', doctors: [] }],
          },
        ],
      },
    });
    expect(line).toMatch(/^شكري: امبارح 3\/3 · ناقص من يوم تاني: /);
    expect(line).not.toContain('ما اتقفلش');
  });
});

describe('reading a handover by when it was closed', () => {
  const closed = (
    id: string,
    shift_type: string,
    shift_date: string,
    recorded_at: string,
    branch = 'فرع شكري'
  ) => ({
    id,
    branch,
    shift_type,
    shift_date,
    recorded_at,
  });
  const at = (rows: ReturnType<typeof readHandovers<ReturnType<typeof closed>>>, id: string) =>
    rows.find((row) => row.id === id)!;

  it('moves an evening closed after midnight back to its day, clearing a false missing and a false double', () => {
    // Cairo: 06:04 on 6 Nov saved as the evening of 6 Nov, and the real one closed 00:23 on 7 Nov.
    const rows = readHandovers([
      closed('a', 'مسائي', '2026-11-06', '2026-11-06T04:04:00Z'),
      closed('b', 'مسائي', '2026-11-06', '2026-11-06T22:23:00Z'),
    ]);
    expect(at(rows, 'a')).toMatchObject({
      shift_date: '2026-11-05',
      shift_type: 'مسائي',
      source_date: '2026-11-06',
      reread: true,
    });
    expect(at(rows, 'b')).toMatchObject({ shift_date: '2026-11-06', reread: false });
    const coverage = shiftCoverage(rows, 3, new Date('2026-11-07T10:00:00Z'));
    const status = (day: string) =>
      coverage.find((s) => s.day === day && s.branch === 'فرع شكري' && s.shift === 'مسائي')!.status;
    expect(status('2026-11-05')).toBe('closed');
    expect(status('2026-11-06')).toBe('closed');
  });

  it('reads it as the night shift when that evening is already closed', () => {
    const rows = readHandovers([
      closed('real', 'مسائي', '2026-11-06', '2026-11-07T00:21:00Z', 'فرع الشامي'),
      closed('x', 'مسائي', '2026-11-07', '2026-11-07T05:13:00Z', 'فرع الشامي'),
    ]);
    expect(at(rows, 'x')).toMatchObject({ shift_date: '2026-11-07', shift_type: 'ليلي' });
  });

  it('resolves a chain of days saved one day ahead', () => {
    const rows = readHandovers([
      closed('d9', 'مسائي', '2026-10-09', '2026-10-09T06:29:00Z'),
      closed('d10', 'مسائي', '2026-10-10', '2026-10-10T03:18:00Z'),
      closed('d11', 'مسائي', '2026-10-11', '2026-10-11T04:22:00Z'),
    ]);
    expect(rows.map((row) => row.shift_date)).toEqual(['2026-10-08', '2026-10-09', '2026-10-10']);
  });

  it('reads an afternoon close as the morning shift, and leaves a real evening alone', () => {
    const rows = readHandovers([
      closed('m', 'مسائي', '2026-10-25', '2026-10-25T15:43:00Z'),
      closed('e', 'مسائي', '2026-10-18', '2026-10-18T21:29:00Z'),
    ]);
    expect(at(rows, 'm')).toMatchObject({ shift_date: '2026-10-25', shift_type: 'صباحي' });
    expect(at(rows, 'e').reread).toBe(false);
  });

  it('never moves a handover onto a closed shift', () => {
    const rows = readHandovers([
      closed('ev', 'مسائي', '2026-11-05', '2026-11-06T00:10:00Z'),
      closed('n', 'ليلي', '2026-11-06', '2026-11-06T07:00:00Z'),
      closed('x', 'مسائي', '2026-11-06', '2026-11-06T04:00:00Z'),
    ]);
    expect(at(rows, 'x')).toMatchObject({
      shift_date: '2026-11-06',
      shift_type: 'مسائي',
      reread: false,
    });
  });

  it('gives the time since the closing before it, per branch, skipping late entries', () => {
    const rows = readHandovers([
      closed('n', 'ليلي', '2026-11-07', '2026-11-07T07:35:00Z'),
      closed('m', 'صباحي', '2026-11-07', '2026-11-07T16:16:00Z'),
      closed('other', 'صباحي', '2026-11-07', '2026-11-07T15:00:00Z', 'فرع الشامي'),
      closed('late', 'صباحي', '2026-10-30', '2026-11-07T12:00:00Z'),
    ]);
    expect(at(rows, 'm')).toMatchObject({
      previous_close: '2026-11-07T07:35:00Z',
      gap_minutes: 521,
    });
    expect(at(rows, 'other').gap_minutes).toBeNull();
    expect(at(rows, 'late')).toMatchObject({ entered_late_days: 8, gap_minutes: null });
    expect(shiftGapLabel(521)).toBe('8س 41د');
    expect(shiftGapLabel(60)).toBe('1س');
    expect(shiftGapLabel(45)).toBe('45د');
  });

  it('marks gaps that hide a problem', () => {
    expect(shiftGapTone(52)).toBe('short');
    expect(shiftGapTone(521)).toBe('normal');
    expect(shiftGapTone(1000)).toBe('long');
    expect(shiftGapTone(null)).toBe('normal');
  });

  it('groups the missing shifts by branch, newest first', () => {
    const now = new Date('2026-11-02T10:00:00Z');
    const groups = missingByBranch(
      shiftCoverage([row('1', 'فرع شكري', 'ليلي', '2026-11-02')], 2, now)
    );
    expect(groups.map((g) => g.branch)).toEqual(['فرع شكري', 'فرع الشامي']);
    expect(groups[0].slots.map((s) => `${s.day} ${s.shift}`)).toEqual([
      '2026-11-01 مسائي',
      '2026-11-01 صباحي',
      '2026-11-01 ليلي',
    ]);
  });
});

describe('who was in a shift, from real punches', () => {
  const punch = (over: Partial<PunchInterval> & { staff_id: string }): PunchInterval => ({
    name: over.staff_id,
    kind: 'doctor',
    home_branch: 'فرع شكري',
    branches: ['فرع شكري'],
    first_in: '2026-11-07T07:00:00Z',
    last_out: '2026-11-07T15:00:00Z',
    scheduled_end: null,
    ...over,
  });
  const window = {
    from: Date.parse('2026-11-07T07:00:00Z'),
    to: Date.parse('2026-11-07T15:00:00Z'),
  };

  it('clamps the window between 6 and 10 hours', () => {
    const span = (close: string, previous: string | null) => {
      const w = handoverWindow(close, previous)!;
      return (w.to - w.from) / 3600000;
    };
    expect(span('2026-11-07T15:00:00Z', '2026-11-07T07:30:00Z')).toBe(7.5);
    expect(span('2026-11-07T15:00:00Z', '2026-11-07T14:00:00Z')).toBe(6);
    expect(span('2026-11-07T15:00:00Z', '2026-11-06T15:00:00Z')).toBe(10);
    expect(span('2026-11-07T15:00:00Z', null)).toBe(8);
    expect(handoverWindow(null, null)).toBeNull();
  });

  it('uses the device, not the home branch', () => {
    const atShami = punch({ staff_id: 'heba', branches: ['فرع الشامي'] });
    expect(presenceIn([atShami], 'فرع شكري', window)).toEqual([]);
    expect(presenceIn([atShami], 'فرع الشامي', window).map((p) => p.staff_id)).toEqual(['heba']);
  });

  it('counts a manual punch with no device log on the home branch', () => {
    const manual = punch({ staff_id: 'm', branches: [] });
    expect(presenceIn([manual], 'فرع شكري', window)).toHaveLength(1);
    expect(presenceIn([manual], 'فرع الشامي', window)).toEqual([]);
  });

  it('needs an hour inside the shift, and leaves out staff with no group', () => {
    const atTheDoor = punch({
      staff_id: 'next',
      first_in: '2026-11-07T14:30:00Z',
      last_out: '2026-11-07T22:00:00Z',
    });
    const delivery = punch({ staff_id: 'd', kind: null });
    expect(presenceIn([atTheDoor, delivery], 'فرع شكري', window)).toEqual([]);
  });

  it('runs a missing checkout to the scheduled end, and keeps a lone checkout only inside the window', () => {
    const noOut = punch({
      staff_id: 'a',
      first_in: '2026-11-07T01:00:00Z',
      last_out: null,
      scheduled_end: '2026-11-07T09:00:00Z',
    });
    const noOutEarly = punch({
      staff_id: 'b',
      first_in: '2026-11-06T22:00:00Z',
      last_out: null,
      scheduled_end: '2026-11-07T06:00:00Z',
    });
    const loneOut = punch({ staff_id: 'c', first_in: null, last_out: '2026-11-07T12:00:00Z' });
    const loneOutBefore = punch({
      staff_id: 'e',
      first_in: null,
      last_out: '2026-11-07T03:00:00Z',
    });
    expect(
      presenceIn([noOut, noOutEarly, loneOut, loneOutBefore], 'فرع شكري', window).map(
        (p) => p.staff_id
      )
    ).toEqual(['a', 'c']);
  });

  it('lists doctors before assistants, and says when nobody punched', () => {
    const rows = [
      punch({ staff_id: 'as', name: 'نور', kind: 'assistant' }),
      punch({ staff_id: 'dr', name: 'د هدي' }),
    ];
    const people = presenceIn(rows, 'فرع شكري', window);
    expect(people.map((p) => p.staff_id)).toEqual(['dr', 'as']);
    expect(presenceLabel(people)).toContain('نور، مساعد');
    expect(presenceLabel([])).toBe('مفيش بصمة');
  });

  describe('the person who closed it', () => {
    const closedAt = '2026-11-07T15:30:00Z';
    const check = (rows: PunchInterval[], closer: { name?: string; staffId?: string }) =>
      closerPresence(closer, rows, 'فرع شكري', closedAt);

    it('here, by id or by name', () => {
      expect(check([punch({ staff_id: 'x' })], { staffId: 'x' }).status).toBe('here');
      expect(check([punch({ staff_id: 'x', name: 'د/ أحمد' })], { name: 'د احمد' }).status).toBe(
        'here'
      );
    });

    it('here when their only punch is leaving after the close', () => {
      const out = punch({ staff_id: 'x', first_in: null, last_out: '2026-11-07T19:00:00Z' });
      expect(check([out], { staffId: 'x' }).status).toBe('here');
    });

    it('no punch that day', () => {
      const yesterday = punch({
        staff_id: 'x',
        first_in: '2026-11-05T07:00:00Z',
        last_out: '2026-11-05T15:00:00Z',
      });
      expect(check([yesterday], { staffId: 'x' }).status).toBe('no_punch');
      expect(check([], { staffId: 'x' }).status).toBe('no_punch');
    });

    it('punched at another branch', () => {
      expect(
        check([punch({ staff_id: 'x', branches: ['فرع الشامي'] })], { staffId: 'x' }).status
      ).toBe('other_branch');
    });

    it('punched at another time, with the times', () => {
      const later = punch({
        staff_id: 'x',
        first_in: '2026-11-07T18:00:00Z',
        last_out: '2026-11-07T23:00:00Z',
      });
      const result = check([later], { staffId: 'x' });
      expect(result.status).toBe('other_time');
      expect(closerPresenceText(result)).toContain('وقت تاني');
    });

    it('unknown when the name matches nobody and there is no id', () => {
      expect(check([punch({ staff_id: 'x' })], { name: 'حد تاني' })).toEqual({ status: 'unknown' });
      expect(closerPresenceText({ status: 'unknown' })).toBeNull();
    });
  });
});

describe('who was there at the handover', () => {
  // Cairo winter time is UTC+2. The evening of 10/11 is handed over at 01:30 on 11/11 (23:30Z).
  const base = (over: Partial<PunchInterval> & { staff_id: string }): PunchInterval => ({
    name: over.staff_id,
    kind: 'doctor',
    home_branch: 'فرع شكري',
    branches: ['فرع شكري'],
    first_in: '2026-11-10T16:00:00Z',
    last_out: '2026-11-11T00:00:00Z',
    scheduled_end: null,
    ...over,
  });
  const at = handoverMoment('2026-11-10', 'مسائي');
  // د/ عمر: in at Shokry 18:16, then a punch on the Shami device at 02:52.
  const omar = base({
    staff_id: 'omar',
    branches: ['فرع الشامي', 'فرع شكري'],
    first_in: '2026-11-10T16:16:44Z',
    last_out: '2026-11-11T00:52:04Z',
    punches: [
      { at: '2026-11-10T16:16:44Z', branch: 'فرع شكري' },
      { at: '2026-11-10T16:18:44Z', branch: 'فرع شكري' },
      { at: '2026-11-11T00:52:04Z', branch: 'فرع الشامي' },
    ],
  });

  it('hands over an hour and a half before the shift counts as missing', () => {
    expect(at.toISOString()).toBe('2026-11-10T23:30:00.000Z');
    expect(handoverMoment('2026-11-11', 'ليلي').toISOString()).toBe('2026-11-11T06:30:00.000Z');
  });

  it('reads the branch from the last punch before the moment', () => {
    expect(branchAt(omar, at.getTime())).toBe('فرع شكري');
    expect(branchAt(omar, Date.parse('2026-11-11T01:00:00Z'))).toBe('فرع الشامي');
    expect(branchAt(omar, Date.parse('2026-11-10T10:00:00Z'))).toBe('فرع شكري');
    // Without per-punch devices: one device is that branch, both count on their own branch.
    expect(branchAt(base({ staff_id: 'x', branches: ['فرع الشامي'] }), 0)).toBe('فرع الشامي');
    expect(branchAt({ ...omar, punches: undefined }, 0)).toBe('فرع شكري');
  });

  it('puts someone seen on both devices in one branch only', () => {
    expect(shiftResponsible([omar], 'فرع شكري', at).people.map((p) => p.staff_id)).toEqual([
      'omar',
    ]);
    expect(shiftResponsible([omar], 'فرع الشامي', at).basis).toBe('none');
  });

  it('leaves out whoever just arrived for the next shift, or left long before', () => {
    const arriving = base({ staff_id: 'next', first_in: '2026-11-10T23:00:00Z', last_out: null });
    const leftEarly = base({ staff_id: 'early', last_out: '2026-11-10T21:00:00Z' });
    const leftJustBefore = base({ staff_id: 'late', last_out: '2026-11-10T22:45:00Z' });
    expect(
      shiftResponsible([arriving, leftEarly, leftJustBefore], 'فرع شكري', at).people.map(
        (p) => p.staff_id
      )
    ).toEqual(['late']);
  });

  it('names doctors and managers first, an assistant only when no doctor punched', () => {
    const assistant = base({ staff_id: 'a', kind: 'assistant', name: 'محمد' });
    const manager = base({ staff_id: 'm', kind: 'manager', name: 'د اميرة' });
    const both = shiftResponsible([assistant, manager], 'فرع شكري', at);
    expect(both.basis).toBe('doctor');
    expect(responsibleNames(both)).toBe('د اميرة');
    expect(both.everyone).toHaveLength(2);
    const alone = shiftResponsible([assistant], 'فرع شكري', at);
    expect(alone.basis).toBe('assistant');
    expect(responsibleNames(alone)).toBe('محمد (مساعد)');
    expect(responsibleNames(shiftResponsible([], 'فرع شكري', at))).toBe('مفيش دكتور بصم');
  });

  it('names who worked the evening of 10/11, not the night doctor who came in at 11:30', () => {
    // The real punches at Shokry: د وائل 21:46–04:05, د/ عمر from 18:16, د دنيا 16:30–23:58,
    // and the night doctor د محمد شبل from 23:36.
    const wael = base({
      staff_id: 'wael',
      kind: 'manager',
      first_in: '2026-11-10T19:46:01Z',
      last_out: '2026-11-11T02:05:58Z',
    });
    const donia = base({
      staff_id: 'donia',
      first_in: '2026-11-10T14:30:06Z',
      last_out: '2026-11-10T21:58:22Z',
    });
    const shebl = base({
      staff_id: 'shebl',
      first_in: '2026-11-10T21:36:38Z',
      last_out: '2026-11-11T07:36:55Z',
    });
    expect(
      shiftResponsible([omar, wael, donia, shebl], 'فرع شكري', at)
        .people.map((p) => p.staff_id)
        .sort()
    ).toEqual(['omar', 'wael']);
  });

  it('counts a lone departure as a usual shift before it', () => {
    const loneOut = base({ staff_id: 'out', first_in: null, last_out: '2026-11-11T00:30:00Z' });
    expect(shiftResponsible([loneOut], 'فرع شكري', at).people).toHaveLength(1);
  });

  it('keeps the shift list to one branch too', () => {
    const window = { from: Date.parse('2026-11-10T16:00:00Z'), to: at.getTime() };
    expect(presenceIn([omar], 'فرع شكري', window)).toHaveLength(1);
    expect(presenceIn([omar], 'فرع الشامي', window)).toEqual([]);
  });
});
