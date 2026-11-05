import { describe, expect, it } from 'vitest';
import { serverCycle } from '@/lib/evaluationLab/server/cycleScores';

// Cairo noon on a given day, so the date never depends on the machine timezone.
const at = (day: string) => new Date(`${day}T10:00:00Z`);

describe('doctor evaluation cycles', () => {
  it('cuts the running cycle at today (yesterday included) and keeps its real length', () => {
    expect(serverCycle('running', at('2026-11-05'))).toEqual({
      kind: 'running', start: '2026-10-26', endExclusive: '2026-11-05', fullEndExclusive: '2026-11-26', elapsedDays: 10, totalDays: 31,
    });
  });

  it('has no running cycle on its first day', () => {
    expect(serverCycle('running', at('2026-11-26'))).toBeNull();
  });

  it('crosses the year and returns the last closed cycle', () => {
    expect(serverCycle('running', at('2027-01-03'))).toMatchObject({ start: '2026-12-26', endExclusive: '2027-01-03', elapsedDays: 8 });
    expect(serverCycle('closed', at('2026-11-05'))).toEqual({
      kind: 'closed', start: '2026-09-26', endExclusive: '2026-10-26', fullEndExclusive: '2026-10-26', elapsedDays: 30, totalDays: 30,
    });
  });
});
