export const INVENTORY_STRENGTH_MIN_MEASURED_WEEKS = 3;
export const INVENTORY_STRENGTH_MIN_STAGNANT_TARGET_PCT = 80;

export type InventoryStrengthEvidenceInput = {
  sourceStatus: 'available' | 'partial' | 'unavailable';
  measuredWeeks: number;
  onTrackWeeks: number;
  aheadWeeks: number;
  behindWeeks: number;
  unresolvedDiscrepancies: number;
  assignedItems: number;
  configuredTargets: number;
  targetAchievementPct: number | null;
};

export type InventoryEvidenceSufficiency = {
  status: 'sufficient' | 'insufficient' | 'unavailable';
  sufficient: boolean;
  reasons: string[];
};

export function getInventoryEvidenceSufficiency(input: InventoryStrengthEvidenceInput): InventoryEvidenceSufficiency {
  const measuredWeeks = Math.max(0, Number(input.measuredWeeks || 0));
  const assignedItems = Math.max(0, Number(input.assignedItems || 0));
  const configuredTargets = Math.max(0, Number(input.configuredTargets || 0));

  if (input.sourceStatus === 'unavailable') {
    return { status: 'unavailable', sufficient: false, reasons: ['inventory_source_unavailable'] };
  }

  const reasons: string[] = [];
  if (input.sourceStatus !== 'available') reasons.push('inventory_source_partial');
  if (measuredWeeks < INVENTORY_STRENGTH_MIN_MEASURED_WEEKS) reasons.push('insufficient_measured_weeks');

  if (assignedItems > 0) {
    if (configuredTargets !== assignedItems) reasons.push('stagnant_targets_incomplete');
    if (input.targetAchievementPct === null) reasons.push('stagnant_achievement_not_measurable');
  }

  return {
    status: reasons.length ? 'insufficient' : 'sufficient',
    sufficient: reasons.length === 0,
    reasons,
  };
}

/**
 * A manager score, one completed week, or stagnant movement alone is not enough.
 * Automatic inventory strength requires sufficient repeated evidence first, then clean
 * execution: no behind weeks, no unresolved discrepancies, and strong stagnant performance.
 */
export function hasStrongInventoryEvidence(input: InventoryStrengthEvidenceInput) {
  const sufficiency = getInventoryEvidenceSufficiency(input);
  if (!sufficiency.sufficient) return false;

  const measuredWeeks = Math.max(0, Number(input.measuredWeeks || 0));
  const onTrackWeeks = Math.max(0, Number(input.onTrackWeeks || 0));
  const aheadWeeks = Math.max(0, Number(input.aheadWeeks || 0));
  const behindWeeks = Math.max(0, Number(input.behindWeeks || 0));
  const unresolvedDiscrepancies = Math.max(0, Number(input.unresolvedDiscrepancies || 0));
  const assignedItems = Math.max(0, Number(input.assignedItems || 0));

  if (behindWeeks > 0) return false;
  if (onTrackWeeks + aheadWeeks !== measuredWeeks) return false;
  if (unresolvedDiscrepancies > 0) return false;

  if (assignedItems > 0 && Number(input.targetAchievementPct) < INVENTORY_STRENGTH_MIN_STAGNANT_TARGET_PCT) {
    return false;
  }

  return true;
}

export type StagnantAssignmentCycleRelevanceInput = {
  status?: string | null;
  movedQuantity?: number | null;
};

/**
 * Current responsibility includes active assignments.
 * A non-active row is still relevant when it has an actual dispense in the evaluated cycle.
 * Historical achieved/expired rows with no cycle movement are excluded from the current-cycle denominator.
 */
export function isStagnantAssignmentRelevantForCycle(input: StagnantAssignmentCycleRelevanceInput) {
  if (Number(input.movedQuantity || 0) > 0) return true;

  const status = String(input.status || '').trim().toLowerCase();
  return status === '' || status === 'active' || status === 'نشط';
}
