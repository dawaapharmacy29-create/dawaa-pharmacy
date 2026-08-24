import { describe, expect, it } from 'vitest';
import { normalizeTaskEvidence } from '../taskEvidence';
import { aggregateTaskSourceCoverage, buildTaskCompletionProjection } from '../taskCompletionProjection';

const STAFF_ID = '11111111-1111-4111-8111-111111111111';

function evidence(overrides: Partial<Parameters<typeof normalizeTaskEvidence>[0]> = {}) {
  return normalizeTaskEvidence({
    sourceType: 'manager_checklist',
    sourceId: 'source-1',
    taskKey: 'task-1',
    subjectStaffId: STAFF_ID,
    branch: 'فرع شكري',
    status: 'completed',
    occurredAt: '2026-08-24T10:00:00+03:00',
    completedAt: '2026-08-24T10:00:00+03:00',
    ...overrides,
  });
}

describe('task completion projection', () => {
  it('uses only completed + missed outcomes in the completion-rate denominator', () => {
    const projection = buildTaskCompletionProjection([
      {
        sourceType: 'manager_checklist',
        availability: 'available',
        evidence: [
          evidence({ sourceId: '1', taskKey: 'done' }),
          evidence({ sourceId: '2', taskKey: 'missed', status: 'missed', completedAt: null }),
          evidence({ sourceId: '3', taskKey: 'assigned', status: 'assigned', completedAt: null }),
          evidence({ sourceId: '4', taskKey: 'accepted', status: 'accepted', completedAt: null }),
          evidence({
            sourceId: '5',
            taskKey: 'cancelled',
            status: 'cancelled',
            completedAt: null,
            cancellationReason: 'لم تعد مطلوبة',
          }),
        ],
      },
    ])[0];

    expect(projection.completed).toBe(1);
    expect(projection.missed).toBe(1);
    expect(projection.active).toBe(2);
    expect(projection.cancelled).toBe(1);
    expect(projection.resolved).toBe(2);
    expect(projection.completionRate).toBe(50);
  });

  it('does not turn an unavailable source into zero performance or missed work', () => {
    const projection = buildTaskCompletionProjection([
      {
        sourceType: 'manager_checklist',
        availability: 'available',
        evidence: [evidence({ sourceId: '1', taskKey: 'done' })],
      },
      {
        sourceType: 'customer_followup',
        availability: 'unavailable',
        evidence: [],
        reason: 'canonical staff identity coverage is incomplete',
      },
    ])[0];

    expect(projection.completionRate).toBe(100);
    expect(projection.missed).toBe(0);
    expect(projection.hasUnavailableSources).toBe(true);
    expect(projection.unavailableSourceCount).toBe(1);
    expect(projection.sources.find((row) => row.sourceType === 'customer_followup')?.reason).toMatch(/identity/);
  });

  it('keeps partial-source evidence while exposing the coverage gap', () => {
    const projection = buildTaskCompletionProjection([
      {
        sourceType: 'customer_followup',
        availability: 'partial',
        evidence: [
          evidence({
            sourceType: 'customer_followup',
            sourceId: 'followup-1',
            taskKey: 'vip-followup',
          }),
        ],
        reason: 'only canonical handled/assigned staff ids are included',
      },
    ])[0];

    expect(projection.completed).toBe(1);
    expect(projection.completionRate).toBe(100);
    expect(projection.partialSourceCount).toBe(1);
    expect(projection.unavailableSourceCount).toBe(0);
  });

  it('distinguishes on-time and late completions only when an expected time exists', () => {
    const projection = buildTaskCompletionProjection([
      {
        sourceType: 'manager_checklist',
        availability: 'available',
        evidence: [
          evidence({
            sourceId: 'on-time',
            taskKey: 'on-time',
            expectedAt: '2026-08-24T11:00:00+03:00',
            completedAt: '2026-08-24T10:00:00+03:00',
          }),
          evidence({
            sourceId: 'late',
            taskKey: 'late',
            expectedAt: '2026-08-24T09:00:00+03:00',
            completedAt: '2026-08-24T10:00:00+03:00',
          }),
          evidence({
            sourceId: 'no-deadline',
            taskKey: 'no-deadline',
            expectedAt: null,
            completedAt: '2026-08-24T10:00:00+03:00',
          }),
        ],
      },
    ])[0];

    expect(projection.completed).toBe(3);
    expect(projection.onTimeCompleted).toBe(1);
    expect(projection.lateCompleted).toBe(1);
  });

  it('returns source coverage independently from staff projections', () => {
    const coverage = aggregateTaskSourceCoverage([
      {
        sourceType: 'shift_note',
        availability: 'partial',
        evidence: [evidence({ sourceType: 'shift_note', sourceId: 'n1', taskKey: 'handover' })],
        reason: '2 legacy notes are unresolved',
      },
      {
        sourceType: 'cleaning_task',
        availability: 'unavailable',
        evidence: [],
        reason: 'no production rows yet',
      },
    ]);

    expect(coverage).toHaveLength(2);
    expect(coverage[0].resolvedCount).toBe(1);
    expect(coverage[1].availability).toBe('unavailable');
    expect(coverage[1].resolvedCount).toBe(0);
  });
});
