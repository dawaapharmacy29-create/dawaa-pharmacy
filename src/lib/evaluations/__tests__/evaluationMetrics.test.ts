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
    sources: [
      {
        sourceType: 'manager_checklist',
        availability: 'available',
        evidenceCount: 10,
        resolvedCount: 10,
        completedCount: 8,
        missedCount: 2,
        activeCount: 0,
        cancelledCount: 0,
        reason: null,
        observedAt: null,
      },
      {
        sourceType: 'customer_followup',
        availability: 'available',
        evidenceCount: 5,
        resolvedCount: 4,
        completedCount: 4,
        missedCount: 0,
        activeCount: 1,
        cancelledCount: 0,
        reason: null,
        observedAt: null,
      },
      {
        sourceType: 'cleaning_task',
        availability: 'unavailable',
        evidenceCount: 0,
        resolvedCount: 0,
        completedCount: 0,
        missedCount: 0,
        activeCount: 0,
        cancelledCount: 0,
        reason: 'not loaded',
        observedAt: null,
      },
    ],
    availableSourceCount: 2,
    partialSourceCount: 0,
    unavailableSourceCount: 1,
    hasUnavailableSources: true,
    ...overrides,
  };
}

const managerApplicability = [
  {
    subjectStaffId: 'staff-1',
    branch: 'فرع شكري',
    expectedSourceTypes: ['manager_checklist'] as const,
  },
];

describe('evaluation metrics projection', () => {
  it('ignores unrelated source outages when applicability is explicit', () => {
    const [metrics] = buildEvaluationMetrics([projection()], managerApplicability.map((entry) => ({
      ...entry,
      expectedSourceTypes: [...entry.expectedSourceTypes],
    })));

    expect(metrics.taskCompletionRate).toBe(80);
    expect(metrics.taskOnTimeCompletionRate).toBe(75);
    expect(metrics.sourceCoverageRate).toBe(100);
    expect(metrics.sourceUnavailableCount).toBe(0);
    expect(metrics.dataConfidence).toBe('high');
    expect(metrics.isEvaluationReady).toBe(true);
  });

  it('keeps applicable partial/unavailable evidence visible without turning it into misses', () => {
    const partialProjection = projection({
      sources: [
        {
          sourceType: 'manager_checklist',
          availability: 'available',
          evidenceCount: 10,
          resolvedCount: 10,
          completedCount: 8,
          missedCount: 2,
          activeCount: 0,
          cancelledCount: 0,
          reason: null,
          observedAt: null,
        },
        {
          sourceType: 'customer_followup',
          availability: 'partial',
          evidenceCount: 2,
          resolvedCount: 1,
          completedCount: 1,
          missedCount: 0,
          activeCount: 1,
          cancelledCount: 0,
          reason: 'identity repair incomplete',
          observedAt: null,
        },
        {
          sourceType: 'shift_note',
          availability: 'unavailable',
          evidenceCount: 0,
          resolvedCount: 0,
          completedCount: 0,
          missedCount: 0,
          activeCount: 0,
          cancelledCount: 0,
          reason: 'source unavailable',
          observedAt: null,
        },
      ],
    });

    const [metrics] = buildEvaluationMetrics([partialProjection], [
      {
        subjectStaffId: 'staff-1',
        branch: 'فرع شكري',
        expectedSourceTypes: ['manager_checklist', 'customer_followup', 'shift_note'],
      },
    ]);

    expect(metrics.taskCompletionRate).toBe(80);
    expect(metrics.sourceCoverageRate).toBe(50);
    expect(metrics.dataConfidence).toBe('low');
    expect(metrics.isEvaluationReady).toBe(false);
    expect(metrics.confidenceReasons.join(' ')).toMatch(/unavailable/);
  });

  it('does not mark unresolved work as evaluation-ready even with healthy applicable sources', () => {
    const [metrics] = buildEvaluationMetrics([
      projection({
        completed: 0,
        missed: 0,
        resolved: 0,
        completionRate: null,
        active: 5,
      }),
    ], managerApplicability.map((entry) => ({
      ...entry,
      expectedSourceTypes: [...entry.expectedSourceTypes],
    })));

    expect(metrics.taskCompletionRate).toBeNull();
    expect(metrics.dataConfidence).toBe('high');
    expect(metrics.isEvaluationReady).toBe(false);
    expect(metrics.confidenceReasons).toContain('No resolved task outcomes are available yet.');
  });

  it('fails closed when staff/source applicability is not configured', () => {
    const [metrics] = buildEvaluationMetrics([projection()]);

    expect(metrics.sourceCoverageRate).toBeNull();
    expect(metrics.dataConfidence).toBe('unavailable');
    expect(metrics.isEvaluationReady).toBe(false);
    expect(metrics.confidenceReasons.join(' ')).toMatch(/applicability/);
  });
});
