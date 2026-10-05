import { describe, expect, it } from 'vitest';
import {
  INVENTORY_STRENGTH_MIN_MEASURED_WEEKS,
  INVENTORY_STRENGTH_MIN_STAGNANT_TARGET_PCT,
  hasStrongInventoryEvidence,
  getInventoryEvidenceSufficiency,
  isStagnantAssignmentRelevantForCycle,
} from '@/lib/evaluations/monthlyInventoryEvidence';

const cleanBase = {
  sourceStatus: 'available' as const,
  measuredWeeks: 3,
  onTrackWeeks: 2,
  aheadWeeks: 1,
  behindWeeks: 0,
  unresolvedDiscrepancies: 0,
  assignedItems: 0,
  configuredTargets: 0,
  targetAchievementPct: null,
};

describe('stagnant assignment cycle relevance', () => {
  it('keeps active assignments in the current-cycle responsibility set', () => {
    expect(isStagnantAssignmentRelevantForCycle({ status: 'نشط', movedQuantity: 0 })).toBe(true);
    expect(isStagnantAssignmentRelevantForCycle({ status: 'active', movedQuantity: 0 })).toBe(true);
  });

  it('keeps a non-active assignment when it actually moved in the evaluated cycle', () => {
    expect(isStagnantAssignmentRelevantForCycle({ status: 'محقق', movedQuantity: 2 })).toBe(true);
    expect(isStagnantAssignmentRelevantForCycle({ status: 'expired', movedQuantity: 1 })).toBe(true);
  });

  it('excludes historical achieved or expired rows without cycle movement', () => {
    expect(isStagnantAssignmentRelevantForCycle({ status: 'محقق', movedQuantity: 0 })).toBe(false);
    expect(isStagnantAssignmentRelevantForCycle({ status: 'expired', movedQuantity: 0 })).toBe(false);
  });
});

describe('monthly inventory strength evidence gate', () => {
  it('requires repeated weekly evidence rather than one good week', () => {
    expect(hasStrongInventoryEvidence({
      ...cleanBase,
      measuredWeeks: INVENTORY_STRENGTH_MIN_MEASURED_WEEKS - 1,
      onTrackWeeks: INVENTORY_STRENGTH_MIN_MEASURED_WEEKS - 1,
      aheadWeeks: 0,
    })).toBe(false);
  });

  it('blocks strength for a behind week or unresolved stock discrepancy', () => {
    expect(hasStrongInventoryEvidence({
      ...cleanBase,
      onTrackWeeks: 2,
      aheadWeeks: 0,
      behindWeeks: 1,
    })).toBe(false);

    expect(hasStrongInventoryEvidence({
      ...cleanBase,
      unresolvedDiscrepancies: 1,
    })).toBe(false);
  });

  it('does not turn partial source coverage into an automatic strength', () => {
    expect(hasStrongInventoryEvidence({
      ...cleanBase,
      sourceStatus: 'partial',
    })).toBe(false);
  });

  it('requires every assigned stagnant item to have a measurable target', () => {
    expect(hasStrongInventoryEvidence({
      ...cleanBase,
      assignedItems: 3,
      configuredTargets: 2,
      targetAchievementPct: 100,
    })).toBe(false);
  });

  it('requires strong stagnant target achievement when stagnant items are assigned', () => {
    expect(hasStrongInventoryEvidence({
      ...cleanBase,
      assignedItems: 2,
      configuredTargets: 2,
      targetAchievementPct: INVENTORY_STRENGTH_MIN_STAGNANT_TARGET_PCT - 0.1,
    })).toBe(false);

    expect(hasStrongInventoryEvidence({
      ...cleanBase,
      assignedItems: 2,
      configuredTargets: 2,
      targetAchievementPct: INVENTORY_STRENGTH_MIN_STAGNANT_TARGET_PCT,
    })).toBe(true);
  });

  it('allows clean repeated inventory evidence when no stagnant items are assigned', () => {
    expect(hasStrongInventoryEvidence(cleanBase)).toBe(true);
  });
});

describe('monthly inventory evidence sufficiency', () => {
  it('distinguishes unavailable evidence from weak performance', () => {
    expect(getInventoryEvidenceSufficiency({ ...cleanBase, sourceStatus: 'unavailable' })).toEqual({
      status: 'unavailable',
      sufficient: false,
      reasons: ['inventory_source_unavailable'],
    });
  });

  it('marks short or partial coverage as insufficient rather than negative performance', () => {
    const result = getInventoryEvidenceSufficiency({
      ...cleanBase,
      sourceStatus: 'partial',
      measuredWeeks: 1,
      onTrackWeeks: 1,
      aheadWeeks: 0,
    });
    expect(result.status).toBe('insufficient');
    expect(result.reasons).toContain('inventory_source_partial');
    expect(result.reasons).toContain('insufficient_measured_weeks');
  });

  it('requires measurable stagnant responsibility when items are assigned', () => {
    const result = getInventoryEvidenceSufficiency({
      ...cleanBase,
      assignedItems: 2,
      configuredTargets: 1,
      targetAchievementPct: null,
    });
    expect(result.sufficient).toBe(false);
    expect(result.reasons).toContain('stagnant_targets_incomplete');
    expect(result.reasons).toContain('stagnant_achievement_not_measurable');
  });
});
