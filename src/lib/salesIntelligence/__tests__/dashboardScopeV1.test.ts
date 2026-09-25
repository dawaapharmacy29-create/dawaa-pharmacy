import {
  buildRecentPharmacyCyclesV1,
  dateFallsInCycleV1,
  pharmacyCycleForDateV1,
  previousPharmacyCycleV1,
} from '@/lib/salesIntelligence/dashboardScopeV1';

describe('dashboardScopeV1 pharmacy cycle', () => {
  it('uses 26-to-25 cycle before the cutoff day', () => {
    expect(pharmacyCycleForDateV1('2026-09-25')).toMatchObject({
      start: '2026-08-26',
      end: '2026-09-25',
      key: '2026-08-26',
    });
  });

  it('starts a new cycle on day 26', () => {
    expect(pharmacyCycleForDateV1('2026-09-26')).toMatchObject({
      start: '2026-09-26',
      end: '2026-10-25',
      key: '2026-09-26',
    });
  });

  it('handles year boundaries correctly', () => {
    expect(pharmacyCycleForDateV1('2027-01-03')).toMatchObject({
      start: '2026-12-26',
      end: '2027-01-25',
    });
  });

  it('derives the previous cycle without overlap', () => {
    const current = pharmacyCycleForDateV1('2026-09-25');
    expect(previousPharmacyCycleV1(current)).toMatchObject({
      start: '2026-07-26',
      end: '2026-08-25',
    });
  });

  it('checks inclusive cycle boundaries', () => {
    const cycle = pharmacyCycleForDateV1('2026-09-25');
    expect(dateFallsInCycleV1('2026-08-26T00:00:00Z', cycle)).toBe(true);
    expect(dateFallsInCycleV1('2026-09-25T23:59:59Z', cycle)).toBe(true);
    expect(dateFallsInCycleV1('2026-08-25T23:59:59Z', cycle)).toBe(false);
    expect(dateFallsInCycleV1('2026-09-26T00:00:00Z', cycle)).toBe(false);
  });

  it('builds consecutive recent cycles', () => {
    const cycles = buildRecentPharmacyCyclesV1(new Date('2026-09-25T12:00:00'), 3);
    expect(cycles.map((cycle) => cycle.start)).toEqual([
      '2026-08-26',
      '2026-07-26',
      '2026-06-26',
    ]);
  });
});
