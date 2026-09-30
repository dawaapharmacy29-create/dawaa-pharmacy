import { describe, expect, it } from 'vitest';
import {
  FOLLOWUP_STRENGTH_MIN_SAMPLES,
  hasStrongFollowupEvidence,
} from '@/lib/evaluations/monthlyFollowupEvidence';

describe('monthly follow-up strength evidence gate', () => {
  it('does not treat one successful purchase follow-up as enough evidence', () => {
    expect(hasStrongFollowupEvidence({
      total: 1,
      completed: 1,
      documented: 1,
      needsNextFollowup: 0,
      nextFollowupScheduled: 0,
    })).toBe(false);
  });

  it('requires all recorded follow-ups to be completed and documented', () => {
    expect(hasStrongFollowupEvidence({
      total: 4,
      completed: 3,
      documented: 4,
      needsNextFollowup: 0,
      nextFollowupScheduled: 0,
    })).toBe(false);

    expect(hasStrongFollowupEvidence({
      total: 4,
      completed: 4,
      documented: 3,
      needsNextFollowup: 0,
      nextFollowupScheduled: 0,
    })).toBe(false);
  });

  it('does not penalize continuation itself, but requires a next date when continuation is requested', () => {
    expect(hasStrongFollowupEvidence({
      total: 4,
      completed: 4,
      documented: 4,
      needsNextFollowup: 2,
      nextFollowupScheduled: 1,
    })).toBe(false);

    expect(hasStrongFollowupEvidence({
      total: 4,
      completed: 4,
      documented: 4,
      needsNextFollowup: 2,
      nextFollowupScheduled: 2,
    })).toBe(true);
  });

  it('accepts a clean repeated sample starting at the minimum size', () => {
    expect(hasStrongFollowupEvidence({
      total: FOLLOWUP_STRENGTH_MIN_SAMPLES,
      completed: FOLLOWUP_STRENGTH_MIN_SAMPLES,
      documented: FOLLOWUP_STRENGTH_MIN_SAMPLES,
      needsNextFollowup: 0,
      nextFollowupScheduled: 0,
    })).toBe(true);
  });
});
