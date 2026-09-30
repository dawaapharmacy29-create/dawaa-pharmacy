import { describe, expect, it } from 'vitest';
import { evaluateMonthlyAttendanceFinalization } from '@/lib/staff/monthlyAttendanceFinalization';

describe('monthly attendance finalization', () => {
  it('is ready only when attendance is available, resolved, and conflict-free', () => {
    expect(evaluateMonthlyAttendanceFinalization({
      sourceAvailable: true,
      pendingReviewCases: 0,
      conflictingResolutionDays: 0,
    }).ready).toBe(true);
  });

  it('blocks unresolved attendance days', () => {
    const state = evaluateMonthlyAttendanceFinalization({
      sourceAvailable: true,
      pendingReviewCases: 9,
      conflictingResolutionDays: 0,
    });
    expect(state.ready).toBe(false);
    expect(state.blockers).toContain('9 يوم حضور معلق');
  });

  it('blocks conflicting active attendance classifications', () => {
    const state = evaluateMonthlyAttendanceFinalization({
      sourceAvailable: true,
      pendingReviewCases: 0,
      conflictingResolutionDays: 1,
    });
    expect(state.ready).toBe(false);
    expect(state.blockers).toContain('1 يوم بتصنيف حضور متعارض');
  });

  it('blocks an unavailable attendance source', () => {
    expect(evaluateMonthlyAttendanceFinalization({
      sourceAvailable: false,
      pendingReviewCases: 0,
      conflictingResolutionDays: 0,
    }).ready).toBe(false);
  });
});
