import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  currentEvaluationCycleLabel,
  evaluationCycleDateKeys,
  evaluationCycleRangeFromLabel,
  isEvaluationCycleClosed,
  latestClosedEvaluationCycleLabel,
} from '@/lib/evaluations/monthlyEvaluationCycle';

describe('monthly evaluation 26 → 25 cycle', () => {
  const originalTz = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = 'Africa/Cairo';
  });

  afterAll(() => {
    if (originalTz == null) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('keeps date-only query bounds on the Cairo calendar instead of UTC-shifting them', () => {
    const range = evaluationCycleRangeFromLabel('2026-09');
    expect(range.start.getFullYear()).toBe(2026);
    expect(range.start.getMonth()).toBe(7);
    expect(range.start.getDate()).toBe(26);
    expect(range.end.getFullYear()).toBe(2026);
    expect(range.end.getMonth()).toBe(8);
    expect(range.end.getDate()).toBe(25);

    expect(evaluationCycleDateKeys('2026-09')).toEqual({
      startDate: '2026-08-26',
      endDate: '2026-09-25',
      endDateExclusive: '2026-09-26',
    });
  });

  it('treats Sep 29 as the Oct active cycle and Sep as the latest closed cycle', () => {
    const reference = new Date(2026, 8, 29, 14, 0, 0);
    expect(currentEvaluationCycleLabel(reference)).toBe('2026-10');
    expect(latestClosedEvaluationCycleLabel(reference)).toBe('2026-09');
    expect(isEvaluationCycleClosed('2026-09', reference)).toBe(true);
    expect(isEvaluationCycleClosed('2026-10', reference)).toBe(false);
  });

  it('does not close the cycle until after the end of day 25', () => {
    const beforeClose = new Date(2026, 8, 25, 23, 59, 59);
    const afterClose = new Date(2026, 8, 26, 0, 0, 1);
    expect(isEvaluationCycleClosed('2026-09', beforeClose)).toBe(false);
    expect(isEvaluationCycleClosed('2026-09', afterClose)).toBe(true);
  });
});
