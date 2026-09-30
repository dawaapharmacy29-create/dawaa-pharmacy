import { describe, expect, it } from 'vitest';
import {
  DEVELOPMENT_STRENGTH_MIN_DELTA,
  hasStrongDevelopmentEvidence,
  trainingCompletionTiming,
} from '@/lib/evaluations/monthlyDevelopmentEvidence';

const cleanBase = {
  sourceStatus: 'available' as const,
  trendMeasurable: true,
  direction: 'improving' as const,
  delta: DEVELOPMENT_STRENGTH_MIN_DELTA,
  repeatedIssueCount: 0,
  trainingAssigned: 0,
  trainingCompleted: 0,
  overdueTraining: 0,
};

describe('training completion timing', () => {
  it('counts a timestamp before the exclusive cycle end inside the cycle', () => {
    expect(trainingCompletionTiming({
      completedAt: '2026-09-25T20:00:00+03:00',
      status: 'completed',
      endDateExclusive: '2026-09-26',
    })).toBe('within_cycle');
  });

  it('does not backdate a completion recorded after the cycle ended', () => {
    expect(trainingCompletionTiming({
      completedAt: '2026-09-27T09:00:00+03:00',
      status: 'completed',
      endDateExclusive: '2026-09-26',
    })).toBe('after_cycle');
  });

  it('treats completed status without completed_at as timing-unknown evidence', () => {
    expect(trainingCompletionTiming({
      completedAt: null,
      status: 'مكتمل',
      endDateExclusive: '2026-09-26',
    })).toBe('unknown_completed');
  });

  it('keeps an open assignment as not completed', () => {
    expect(trainingCompletionTiming({
      completedAt: null,
      status: 'pending',
      endDateExclusive: '2026-09-26',
    })).toBe('not_completed');
  });
});

describe('monthly development strength evidence gate', () => {
  it('does not allow training completion alone without a measurable improving trend', () => {
    expect(hasStrongDevelopmentEvidence({
      ...cleanBase,
      trendMeasurable: false,
      direction: 'not_measurable',
      delta: null,
      trainingAssigned: 1,
      trainingCompleted: 1,
    })).toBe(false);
  });

  it('requires at least the documented improvement delta', () => {
    expect(hasStrongDevelopmentEvidence({
      ...cleanBase,
      delta: DEVELOPMENT_STRENGTH_MIN_DELTA - 0.1,
    })).toBe(false);
  });

  it('blocks strength while the same issue is still repeated', () => {
    expect(hasStrongDevelopmentEvidence({
      ...cleanBase,
      repeatedIssueCount: 1,
    })).toBe(false);
  });

  it('requires every assigned training to be completed with no overdue item', () => {
    expect(hasStrongDevelopmentEvidence({
      ...cleanBase,
      trainingAssigned: 2,
      trainingCompleted: 1,
    })).toBe(false);

    expect(hasStrongDevelopmentEvidence({
      ...cleanBase,
      trainingAssigned: 2,
      trainingCompleted: 2,
      overdueTraining: 1,
    })).toBe(false);
  });

  it('allows documented improvement after guidance even when no formal training was assigned', () => {
    expect(hasStrongDevelopmentEvidence(cleanBase)).toBe(true);
  });

  it('allows documented improvement with all assigned training completed cleanly', () => {
    expect(hasStrongDevelopmentEvidence({
      ...cleanBase,
      trainingAssigned: 2,
      trainingCompleted: 2,
    })).toBe(true);
  });

  it('does not create an automatic strength from partial evidence coverage', () => {
    expect(hasStrongDevelopmentEvidence({
      ...cleanBase,
      sourceStatus: 'partial',
    })).toBe(false);
  });
});
