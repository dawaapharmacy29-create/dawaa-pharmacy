import { describe, expect, it } from 'vitest';
import { hourlyTargets, type HourlyInput } from '../hourlyTarget';

// Owner 2026-11-17: a doctor on 9–17 who moves to 16–00 for a few days must get the target of the hours he
// really worked, day by day. December: Cairo is UTC+2, so Cairo hour h is UTC h − 2.
const B = 'فرع شكري';
const at = (day: string, cairoHour: number, minute = 10) => {
  const t = Date.parse(`${day}T00:00:00Z`) + (cairoHour - 2) * 36e5 + minute * 6e4;
  return new Date(t).toISOString();
};
// Last cycle, every weekday: 100 an hour from 9 to 15, 300 an hour from 16 to 23 (evenings sell triple).
const previous = Array.from({ length: 7 }, (_, i) => `2026-11-${String(20 + i).padStart(2, '0')}`).flatMap((day) =>
  Array.from({ length: 15 }, (_, k) => 9 + k).map((h) => ({ staffId: 'x', branch: B, net: h >= 16 ? 300 : 100, at: at(day, h) })));

const shift = (staffId: string, day: string, from: number, to: number, extra: Partial<HourlyInput['attendance'][number]> = {}) => ({
  staffId, date: day, firstInAt: at(day, from, 0), lastOutAt: at(day, to, 0), ...extra,
});
// One sale an hour by whoever is on duty, so every hour has a seller.
const sales = (staffId: string, day: string, from: number, to: number) =>
  Array.from({ length: to - from }, (_, k) => ({ staffId, branch: B, net: 100, at: at(day, from + k, 20) }));

const DAYS = ['2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04'];
const base = (): HourlyInput => ({
  cycle: { start: '2026-12-01', endExclusive: '2026-12-05' },
  targets: [{ branch: B, targetAmount: 40000 }],
  previousInvoices: previous,
  // a: mornings on days 1–2, evenings on days 3–4; b: the opposite.
  attendance: [
    shift('a', DAYS[0], 9, 17), shift('a', DAYS[1], 9, 17), shift('a', DAYS[2], 16, 24), shift('a', DAYS[3], 16, 24),
    shift('b', DAYS[0], 16, 24), shift('b', DAYS[1], 16, 24), shift('b', DAYS[2], 9, 17), shift('b', DAYS[3], 9, 17),
  ],
  invoices: [
    ...sales('a', DAYS[0], 9, 16), ...sales('a', DAYS[1], 9, 16), ...sales('a', DAYS[2], 17, 24), ...sales('a', DAYS[3], 17, 24),
    ...sales('b', DAYS[0], 17, 24), ...sales('b', DAYS[1], 17, 24), ...sales('b', DAYS[2], 9, 16), ...sales('b', DAYS[3], 9, 16),
  ],
  pool: [{ id: 'a', branch: B, weight: 1 }, { id: 'b', branch: B, weight: 1 }],
  fairShifts: true,
});

describe('v7.1 a doctor whose shift changes during the month', () => {
  it('reads every day from its own punches, and the evening days carry a bigger target', () => {
    const a = hourlyTargets(base()).people.get('a')!;
    expect(a.shifts.map((s) => `${s.date} ${s.from}-${s.to} ${s.source}`)).toEqual([
      '2026-12-01 09:00-17:00 punch', '2026-12-02 09:00-17:00 punch', '2026-12-03 16:00-00:00 punch', '2026-12-04 16:00-00:00 punch',
    ]);
    const [morning, , evening] = a.shifts;
    expect(evening.target).toBeGreaterThan(morning.target * 2);
    expect(a.target).toBeCloseTo(a.shifts.reduce((s, line) => s + line.target, 0), 6);
  });

  it('gives two doctors with the same mix of shifts the same target', () => {
    const out = hourlyTargets(base());
    expect(out.people.get('a')!.target).toBeCloseTo(out.people.get('b')!.target, 6);
  });

  it('a changed day with a forgotten out punch still counts the whole shift', () => {
    const data = base();
    // Day 3: planned 9–17 in the schedule, came at 16:00, no out punch.
    data.attendance = data.attendance.map((d) => (d.staffId === 'a' && d.date === DAYS[2]
      ? { ...d, lastOutAt: null, scheduledEndAt: at(DAYS[2], 17, 0) } : d));
    const fair = hourlyTargets(data).people.get('a')!.shifts.find((s) => s.date === DAYS[2])!;
    expect(fair.hours).toBe(8);
    const before = hourlyTargets({ ...data, fairShifts: false }).people.get('a')!.shifts.filter((s) => s.date === DAYS[2] || s.source === 'invoices');
    expect(before.find((s) => s.source === 'punch' && s.date === DAYS[2])!.hours).toBe(1);
  });

  it('a day with sales inside the planned shift and no punch counts the planned hours', () => {
    const data = base();
    data.attendance = data.attendance.map((d) => (d.staffId === 'a' && d.date === DAYS[0]
      ? { staffId: 'a', date: DAYS[0], firstInAt: null, lastOutAt: null, scheduledStartAt: at(DAYS[0], 9, 0), scheduledEndAt: at(DAYS[0], 17, 0) } : d));
    const day = hourlyTargets(data).people.get('a')!.shifts.find((s) => s.date === DAYS[0])!;
    expect(day.source).toBe('schedule');
    expect(day.hours).toBe(8);
  });

  it('a day with no punch whose sales sit outside the plan is not read from the plan', () => {
    const data = base();
    // Planned 9–17 but he really worked the evening (sales 17–24) with no punch.
    data.attendance = data.attendance.map((d) => (d.staffId === 'a' && d.date === DAYS[2]
      ? { staffId: 'a', date: DAYS[2], firstInAt: null, lastOutAt: null, scheduledStartAt: at(DAYS[2], 9, 0), scheduledEndAt: at(DAYS[2], 17, 0) } : d));
    const lines = hourlyTargets(data).people.get('a')!.shifts.filter((s) => s.date === DAYS[2]);
    expect(lines.map((s) => s.source)).toEqual(['invoices']);
    expect(lines[0].from).toBe('17:00');
  });
});
