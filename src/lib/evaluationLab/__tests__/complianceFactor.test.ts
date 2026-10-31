import { describe, expect, it } from 'vitest';
import { complianceFactorFor, personCompliance } from '../complianceFactor';

describe('compliance factor', () => {
  it('maps points to the agreed bands, the first point being a warning', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 12].map(complianceFactorFor)).toEqual([1, 1, 0.9, 0.9, 0.75, 0.75, 0.5, 0.5, 0, 0]);
  });

  it('counts recorded violations and only the missing punches above the allowance', () => {
    const result = personCompliance(
      [{ category: 'uniform', points: 1 }, { category: 'pconnect', points: 2 }, { category: 'uniform', points: 1 }],
      3, 2, 95,
    );
    expect(result).toMatchObject({ recordedPoints: 4, punchOverPoints: 1, points: 5, factor: 0.75, tierPayout: 110, payout: 83 });
    expect(result.byCategory).toEqual({ uniform: 2, pconnect: 1 });
    expect(personCompliance([], 2, 2, 82)).toMatchObject({ points: 0, factor: 1, tierPayout: 90, payout: 90 });
  });

  it('never turns compliance into an incentive on its own', () => {
    expect(personCompliance([], 0, 2, 55)).toMatchObject({ factor: 1, tierPayout: 0, payout: 0 });
    expect(personCompliance([], 0, 2, null)).toMatchObject({ tierPayout: null, payout: null });
  });
});
