import { describe, expect, it } from 'vitest';
import {
  applyCorrections,
  closerOnShift,
  missingByBranch,
  onDutyLabel,
  personKey,
  readHandovers,
  shiftCoverage,
  shiftDeadline,
  shiftGapLabel,
  shiftGapTone,
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
