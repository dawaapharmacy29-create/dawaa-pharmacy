import { describe, expect, it } from 'vitest';
import { buildEvaluationMetrics } from '../evaluationMetrics';
import type { StaffTaskCompletionProjection } from '@/lib/tasks/taskCompletionProjection';

function projection(
  overrides: Partial<StaffTaskCompletionProjection> = {}
): StaffTaskCompletionProjection {
  return {
    subjectStaffId: 'staff-1',
    branch: 'فرع شكري',
    completed: 8,
    missed: 2,
    active: 1,
    cancelled: 1,
    resolved: 10,
    completionRate: 80,
    onTimeCompleted: 6,
    lateCompleted: 2,
    sources: [],
    availableSourceCount: 4,
    partialSourceCount: 0,
    unavailableSourceCount: 0,
    hasUnavailableSources: false,
    ...overrides,
  };
}

describe('evaluation metrics projection', () => {
  it('keeps metrics neutral and marks complete evidence as high confidence', () => {
    const [metrics] = buildEvaluationMetrics([projection()]);

    expect(metrics.taskCompletionRate).toBe(80);
    expect(metrics.taskOnTimeCompletionRate).toBe(75);
    expect(metrics.sourceCoverageRate).toBe(100);
    expect(metrics.dataConfidence).toBe('high');
    expect(metrics.isEvaluationReady).toBe(true);
  });

  it('keeps partial evidence visible instead of treating missing sources as misses', () => {
    const [metrics] = buildEvaluationMetrics([
      projection({
        availableSourceCount: 3,
        partialSourceCount: 1,
        unavailableSourceCount: 1,
        hasUnavailableSources: true,
      }),
    ]);

    expect(metrics.taskCompletionRate).toBe(80);
    expect(metrics.sourceCoverageRate).toBe(70);
    expect(metrics.dataConfidence).toBe('low');
    expect(metrics.isEvaluationReady).toBe(false);
    expect(metrics.confidenceReasons.join(' ')).toMatch(/unavailable/);
  });

  it('does not mark unresolved work as evaluation-ready', () => {
    const [metrics] = buildEvaluationMetrics([
      projection({
        completed: 0,
        missed: 0,
        resolved: 0,
        completionRate: null,
        active: 5,
      }),
    ]);

    expect(metrics.taskCompletionRate).toBeNull();
    expect(metrics.dataConfidence).toBe('high');
    expect(metrics.isEvaluationReady).toBe(false);
    expect(metrics.confidenceReasons).toContain('No resolved task outcomes are available yet.');
  });

  it('reports unavailable confidence when no evidence source was observed', () => {
    const [metrics] = buildEvaluationMetrics([
      projection({
        availableSourceCount: 0,
        partialSourceCount: 0,
        unavailableSourceCount: 0,
        resolved: 0,
        completionRate: null,
      }),
    ]);

    expect(metrics.sourceCoverageRate).toBeNull();
    expect(metrics.dataConfidence).toBe('unavailable');
    expect(metrics.isEvaluationReady).toBe(false);
  });
});
