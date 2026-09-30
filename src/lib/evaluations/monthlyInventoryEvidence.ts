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

/**
 * A manager score, one completed week, or stagnant movement alone is not enough.
 * Automatic inventory strength requires repeated clean weekly execution, no unresolved
 * discrepancies, and measurable strong stagnant performance whenever stagnant items are assigned.
 */
export function hasStrongInventoryEvidence(input: InventoryStrengthEvidenceInput) {
  const measuredWeeks = Math.max(0, Number(input.measuredWeeks || 0));
  const onTrackWeeks = Math.max(0, Number(input.onTrackWeeks || 0));
  const aheadWeeks = Math.max(0, Number(input.aheadWeeks || 0));
  const behindWeeks = Math.max(0, Number(input.behindWeeks || 0));
  const unresolvedDiscrepancies = Math.max(0, Number(input.unresolvedDiscrepancies || 0));
  const assignedItems = Math.max(0, Number(input.assignedItems || 0));
  const configuredTargets = Math.max(0, Number(input.configuredTargets || 0));

  if (input.sourceStatus !== 'available') return false;
  if (measuredWeeks < INVENTORY_STRENGTH_MIN_MEASURED_WEEKS) return false;
  if (behindWeeks > 0) return false;
  if (onTrackWeeks + aheadWeeks !== measuredWeeks) return false;
  if (unresolvedDiscrepancies > 0) return false;

  if (assignedItems > 0) {
    if (configuredTargets !== assignedItems) return false;
    if (input.targetAchievementPct === null) return false;
    if (Number(input.targetAchievementPct) < INVENTORY_STRENGTH_MIN_STAGNANT_TARGET_PCT) return false;
  }

  return true;
}
