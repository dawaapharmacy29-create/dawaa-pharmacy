import type { TaskEvidence, TaskEvidenceSourceType } from './taskEvidence';

export const TASK_SOURCE_AVAILABILITY = ['available', 'partial', 'unavailable'] as const;
export type TaskSourceAvailability = (typeof TASK_SOURCE_AVAILABILITY)[number];

export interface TaskEvidenceSourceBatch {
  sourceType: TaskEvidenceSourceType;
  availability: TaskSourceAvailability;
  evidence: TaskEvidence[];
  reason?: string | null;
  observedAt?: string | null;
}

export interface TaskSourceCoverage {
  sourceType: TaskEvidenceSourceType;
  availability: TaskSourceAvailability;
  evidenceCount: number;
  resolvedCount: number;
  completedCount: number;
  missedCount: number;
  activeCount: number;
  cancelledCount: number;
  reason: string | null;
  observedAt: string | null;
}

export interface StaffTaskCompletionProjection {
  subjectStaffId: string;
  branch: string;
  completed: number;
  missed: number;
  active: number;
  cancelled: number;
  resolved: number;
  completionRate: number | null;
  onTimeCompleted: number;
  lateCompleted: number;
  sources: TaskSourceCoverage[];
  availableSourceCount: number;
  partialSourceCount: number;
  unavailableSourceCount: number;
  hasUnavailableSources: boolean;
}

function timestamp(value: string | null | undefined) {
  if (!value) return null;
  const next = new Date(value).getTime();
  return Number.isFinite(next) ? next : null;
}

function completedOnTime(evidence: TaskEvidence) {
  if (evidence.status !== 'completed') return null;
  const expected = timestamp(evidence.expectedAt);
  const completed = timestamp(evidence.completedAt);
  if (expected === null || completed === null) return null;
  return completed <= expected;
}

function sourceCoverage(batch: TaskEvidenceSourceBatch): TaskSourceCoverage {
  const completedCount = batch.evidence.filter((row) => row.status === 'completed').length;
  const missedCount = batch.evidence.filter((row) => row.status === 'missed').length;
  const cancelledCount = batch.evidence.filter((row) => row.status === 'cancelled').length;
  const activeCount = batch.evidence.filter((row) =>
    ['expected', 'assigned', 'accepted'].includes(row.status)
  ).length;

  return {
    sourceType: batch.sourceType,
    availability: batch.availability,
    evidenceCount: batch.evidence.length,
    resolvedCount: completedCount + missedCount,
    completedCount,
    missedCount,
    activeCount,
    cancelledCount,
    reason: batch.reason?.trim() || null,
    observedAt: batch.observedAt || null,
  };
}

function projectionKey(subjectStaffId: string, branch: string) {
  return `${subjectStaffId}::${branch}`;
}

/**
 * Build a non-financial staff completion read model from canonical task evidence.
 *
 * Fairness rules:
 * - only resolved outcomes (completed + missed) enter completionRate;
 * - expected/assigned/accepted are active work, never failures;
 * - cancelled work is excluded from the denominator;
 * - unavailable sources contribute no zeroes/misses and stay visible as coverage gaps;
 * - partial sources include only the evidence they actually resolved; missing identity/data is not inferred.
 */
export function buildTaskCompletionProjection(
  batches: TaskEvidenceSourceBatch[]
): StaffTaskCompletionProjection[] {
  const coverage = batches.map(sourceCoverage);
  const evidenceByKey = new Map<string, TaskEvidence[]>();

  for (const batch of batches) {
    if (batch.availability === 'unavailable') continue;
    for (const evidence of batch.evidence) {
      const key = projectionKey(evidence.subjectStaffId, evidence.branch);
      const current = evidenceByKey.get(key) || [];
      current.push(evidence);
      evidenceByKey.set(key, current);
    }
  }

  const projections: StaffTaskCompletionProjection[] = [];
  for (const [key, evidenceRows] of evidenceByKey) {
    const separator = key.indexOf('::');
    const subjectStaffId = key.slice(0, separator);
    const branch = key.slice(separator + 2);
    const completed = evidenceRows.filter((row) => row.status === 'completed').length;
    const missed = evidenceRows.filter((row) => row.status === 'missed').length;
    const cancelled = evidenceRows.filter((row) => row.status === 'cancelled').length;
    const active = evidenceRows.filter((row) =>
      ['expected', 'assigned', 'accepted'].includes(row.status)
    ).length;
    const resolved = completed + missed;
    const completionRate = resolved > 0 ? Math.round((completed / resolved) * 10_000) / 100 : null;
    const onTimeCompleted = evidenceRows.filter((row) => completedOnTime(row) === true).length;
    const lateCompleted = evidenceRows.filter((row) => completedOnTime(row) === false).length;
    const sourceTypes = new Set(evidenceRows.map((row) => row.sourceType));
    const relevantSources = coverage.filter((row) =>
      sourceTypes.has(row.sourceType) || row.availability === 'unavailable'
    );

    projections.push({
      subjectStaffId,
      branch,
      completed,
      missed,
      active,
      cancelled,
      resolved,
      completionRate,
      onTimeCompleted,
      lateCompleted,
      sources: relevantSources,
      availableSourceCount: coverage.filter((row) => row.availability === 'available').length,
      partialSourceCount: coverage.filter((row) => row.availability === 'partial').length,
      unavailableSourceCount: coverage.filter((row) => row.availability === 'unavailable').length,
      hasUnavailableSources: coverage.some((row) => row.availability === 'unavailable'),
    });
  }

  return projections.sort((a, b) =>
    a.branch.localeCompare(b.branch, 'ar') || a.subjectStaffId.localeCompare(b.subjectStaffId)
  );
}

export function aggregateTaskSourceCoverage(
  batches: TaskEvidenceSourceBatch[]
): TaskSourceCoverage[] {
  return batches.map(sourceCoverage);
}
