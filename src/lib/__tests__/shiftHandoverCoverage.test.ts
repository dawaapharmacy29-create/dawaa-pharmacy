import { describe, expect, it } from 'vitest';
import { applyCorrections, closerOnShift, onDutyLabel, personKey, shiftCoverage, shiftDeadline } from '../shiftHandoverCoverage';
import { gmReviewSummary } from '../gmDailyReview';

// 2026-11-02 is winter time in Cairo (UTC+2).
const row = (id: string, branch: string, shift_type: string, shift_date: string, is_archived = false) =>
  ({ id, branch, shift_type, shift_date, is_archived });

describe('shift handover coverage', () => {
  it('deadlines: night 10:00, morning 19:00, evening 03:00 the next day (Cairo)', () => {
    expect(shiftDeadline('2026-11-01', 'ليلي').toISOString()).toBe('2026-11-01T08:00:00.000Z');
    expect(shiftDeadline('2026-11-01', 'صباحي').toISOString()).toBe('2026-11-01T17:00:00.000Z');
    expect(shiftDeadline('2026-11-01', 'مسائي').toISOString()).toBe('2026-11-02T01:00:00.000Z');
  });

  it('marks each branch × shift closed, doubled, late or not yet due', () => {
    // 12:00 Cairo on 2 Nov: today's night is due, morning and evening are not.
    const now = new Date('2026-11-02T10:00:00Z');
    const slots = shiftCoverage([
      row('1', 'فرع شكري', 'ليلي', '2026-11-02'),
      row('2', 'فرع شكري', 'مسائي', '2026-11-01'),
      row('3', 'فرع شكري', 'مسائي', '2026-11-01'),
      row('4', 'فرع الشامي', 'ليلي', '2026-11-02', true),
    ], 2, now);
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
    expect(onDutyLabel([{ staff_id: '1', name: 'د أ', source: 'punch' }, { staff_id: '2', name: 'د ب', source: 'schedule' }]))
      .toBe('د أ، د ب (جدول من غير بصمة)');
    const base = { id: 'h1', net_amount: 900, submitted_by: 'د غلط', cash_variance: -50 };
    const fix = (id: string, created_at: string, changes: Record<string, unknown>, handover_id = 'h1') =>
      ({ id, handover_id, changes, previous: {}, reason: 'x', corrected_by_name: null, created_at });
    expect(applyCorrections(base, [
      fix('2', '2026-11-01T12:00:00Z', { cash_variance: -20 }),
      fix('1', '2026-11-01T10:00:00Z', { submitted_by: 'د صح', cash_variance: 0 }),
      fix('3', '2026-11-01T13:00:00Z', { net_amount: 1 }, 'other'),
    ])).toEqual({ id: 'h1', net_amount: 900, submitted_by: 'د صح', cash_variance: -20 });
  });
});

describe('who was on the shift, from the fingerprints', () => {
  const omar = { staff_id: 'a1', name: 'محمد عمر', kind: 'assistant' as const, source: 'punch' as const };
  const reda = { staff_id: 'd1', name: 'د/ رضا', kind: 'doctor' as const, source: 'punch' as const };

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

  it('says a missing shift from another day apart from yesterday\'s count', () => {
    const [line] = gmReviewSummary({
      key: 'shifts',
      data_day: '2026-11-04',
      detail: {
        synced_at: new Date().toISOString(),
        branches: [{ branch: 'shokry', yesterday_done: 3, missing: [{ day: '2026-11-03', shift: 'صباحي', doctors: [] }] }],
      },
    });
    expect(line).toMatch(/^شكري: امبارح 3\/3 · ناقص من يوم تاني: /);
    expect(line).not.toContain('ما اتقفلش');
  });
});
