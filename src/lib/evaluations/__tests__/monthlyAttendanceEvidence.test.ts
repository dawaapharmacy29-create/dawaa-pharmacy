import { describe, expect, it } from 'vitest';
import {
  ATTENDANCE_STRENGTH_MIN_WORKED_DAYS,
  hasStrongAttendanceEvidence,
} from '@/lib/evaluations/monthlyAttendanceEvidence';

const cleanBase = {
  onTimeDays: ATTENDANCE_STRENGTH_MIN_WORKED_DAYS,
  workedOnOffCases: 0,
  lateCases: 0,
  veryLateCases: 0,
  earlyLeaveCases: 0,
  absenceCases: 0,
  duplicateResolutionDays: 0,
  manualResolutionCases: 0,
};

describe('monthly attendance strength evidence gate', () => {
  it('requires repeated actual worked-day evidence', () => {
    expect(hasStrongAttendanceEvidence({
      ...cleanBase,
      onTimeDays: ATTENDANCE_STRENGTH_MIN_WORKED_DAYS - 1,
    })).toBe(false);
  });

  it('blocks strength for any documented late, early-leave, or absence case', () => {
    expect(hasStrongAttendanceEvidence({ ...cleanBase, lateCases: 1 })).toBe(false);
    expect(hasStrongAttendanceEvidence({ ...cleanBase, veryLateCases: 1 })).toBe(false);
    expect(hasStrongAttendanceEvidence({ ...cleanBase, earlyLeaveCases: 1 })).toBe(false);
    expect(hasStrongAttendanceEvidence({ ...cleanBase, absenceCases: 1 })).toBe(false);
  });

  it('blocks automatic strength when the ledger is contradictory or ambiguous', () => {
    expect(hasStrongAttendanceEvidence({ ...cleanBase, duplicateResolutionDays: 1 })).toBe(false);
    expect(hasStrongAttendanceEvidence({ ...cleanBase, manualResolutionCases: 1 })).toBe(false);
  });

  it('accepts clean repeated on-time evidence', () => {
    expect(hasStrongAttendanceEvidence(cleanBase)).toBe(true);
  });

  it('can count confirmed work on an off-day as worked evidence without penalizing it', () => {
    expect(hasStrongAttendanceEvidence({
      ...cleanBase,
      onTimeDays: 2,
      workedOnOffCases: 1,
    })).toBe(true);
  });
});
