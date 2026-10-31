import { describe, expect, it } from 'vitest';
import { cairoHourKey, hourlyTargets } from '../hourlyTarget';

// December: Cairo is UTC+2. The previous cycle sold only at 18:00 and 19:00 Cairo, so the target of
// 4000 lands on those two hours of each of the two cycle days (1000 per hour), scaled to the doctors'
// share of this cycle: (1000 + 500 + 3000 capped) of 8500 with the manager's 2000.
const B = 'فرع شكري';
const sale = (staffId: string | null, net: number, at: string) => ({ staffId, branch: B, net, at });
const F = 4500 / 8500;
const input = () => ({
  cycle: { start: '2026-12-01', endExclusive: '2026-12-03' },
  targets: [{ branch: B, targetAmount: 4000 }],
  previousInvoices: [
    sale('a', 1000, '2026-11-24T16:10:00Z'), sale('a', 1000, '2026-11-24T17:10:00Z'),
    sale('b', 1000, '2026-11-25T16:10:00Z'), sale('b', 1000, '2026-11-25T17:10:00Z'),
  ],
  invoices: [
    sale('a', 1000, '2026-12-01T16:30:00Z'),
    sale('b', 500, '2026-12-01T17:15:00Z'),
    sale('m', 2000, '2026-12-01T16:40:00Z'),
    sale('a', 5000, '2026-12-02T16:30:00Z'),
  ],
  attendance: [
    { staffId: 'a', firstInAt: '2026-12-01T15:00:00Z', lastOutAt: '2026-12-01T19:00:00Z' },
    { staffId: 'b', firstInAt: '2026-12-01T16:00:00Z', lastOutAt: '2026-12-01T18:00:00Z' },
    { staffId: 'a', firstInAt: '2026-12-02T16:00:00Z', lastOutAt: '2026-12-02T18:00:00Z' },
  ],
  pool: [{ id: 'a', branch: B, weight: 1 }, { id: 'b', branch: B, weight: 0.5 }],
});

describe('v6.6 hourly target', () => {
  it('keys invoices by the Cairo hour', () => {
    expect(cairoHourKey('2026-12-01T16:30:00Z')).toBe('2026-12-01|18');
    expect(cairoHourKey('2026-12-01T22:30:00Z')).toBe('2026-12-02|00');
  });

  it('splits each shared hour by weight and gives a doctor alone the whole hour', () => {
    const out = hourlyTargets(input());
    const a = out.people.get('a')!;
    const b = out.people.get('b')!;
    // Day 1, 18-19: a carries 2/3 and b 1/3 of 1000; day 2 a is alone on 2000.
    expect(a.target).toBeCloseTo((2000 / 1.5 + 2000) * F, 5);
    expect(b.target).toBeCloseTo((1000 / 1.5) * F, 5);
    expect(a.hours).toBe(6);
    expect(b.hours).toBe(2);
  });

  it('caps a big invoice and reads the shift on the same hours, without non-doctor sales', () => {
    const out = hourlyTargets(input());
    const a = out.people.get('a')!;
    const b = out.people.get('b')!;
    expect(a.own).toBe(4000);
    expect(a.cappedInvoices).toBe(1);
    // The manager's 2000 is nobody's share.
    expect(a.teamSales).toBe(4500);
    expect(a.teamTarget).toBeCloseTo(4000 * F, 5);
    expect(b.teamSales).toBe(1500);
    expect(b.teamTarget).toBeCloseTo(2000 * F, 5);
  });

  it('counts invoices rung by someone with no punch around them', () => {
    const out = hourlyTargets(input());
    expect(out.attribution.get(B)).toEqual({ outside: 1, total: 4 });
    expect(out.people.get('a')!.outsidePunch).toBe(0);
  });

  it('an own invoice proves presence when the punch is missing', () => {
    const data = input();
    data.attendance = data.attendance.filter((day) => day.staffId !== 'b');
    const b = hourlyTargets(data).people.get('b')!;
    expect(b.hours).toBe(1);
    expect(b.outsidePunch).toBe(1);
  });

  it('a branch where most invoices carry no seller gets no target', () => {
    const data = input();
    data.invoices = [...data.invoices, ...Array.from({ length: 4 }, () => sale(null, 100, '2026-12-01T16:50:00Z'))];
    const out = hourlyTargets(data);
    expect(out.sellerCoverage.get(B)).toBe(0.5);
    expect(out.people.get('a')!.target).toBe(0);
    expect(out.people.get('a')!.sellerCoverage).toBe(0.5);
  });

  it('no previous-cycle curve: not ready (never a zero target)', () => {
    expect(hourlyTargets({ ...input(), previousInvoices: [] }).ready).toBe(false);
  });
});
