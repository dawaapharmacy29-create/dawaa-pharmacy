import { describe, expect, it } from 'vitest';
import { parseAmount, recentCycleStarts } from '../branchCycleLosses';

describe('branch cycle losses', () => {
  it('lists the running cycle first, crossing the year', () => {
    expect(recentCycleStarts('2026-11-14', 3)).toEqual(['2026-10-26', '2026-09-26', '2026-08-26']);
    expect(recentCycleStarts('2026-11-26', 1)).toEqual(['2026-11-26']);
    expect(recentCycleStarts('2027-01-10', 2)).toEqual(['2026-12-26', '2026-11-26']);
  });

  it('reads Arabic and western digits, and refuses anything else', () => {
    expect(parseAmount('1,250.5')).toBe(1250.5);
    expect(parseAmount('١٢٥٠')).toBe(1250);
    expect(parseAmount('')).toBe(0);
    expect(parseAmount('-5')).toBeNull();
    expect(parseAmount('12.345')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
  });
});
