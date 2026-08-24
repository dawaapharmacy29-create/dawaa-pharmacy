import type { TaskEvidenceSourceType } from '@/lib/tasks/taskEvidence';
import type { StaffTaskCompletionProjection } from '@/lib/tasks/taskCompletionProjection';

export const EVALUATION_DATA_CONFIDENCE = ['high', 'medium', 'low', 'unavailable'] as const;
export type EvaluationDataConfidence = (typeof EVALUATION_DATA_CONFIDENCE)[number];

export interface EvaluationSourceApplicability {
  subjectStaffId: string;
  branch: string;
  expectedSourceTypes: TaskEvidenceSourceType[];
}

export interface EvaluationMetricProjection {
  subjectStaffId: string;
  branch: string;
  taskCompletionRate: number | null;
  taskResolvedCount: number;
  taskCompletedCount: number;
  taskMissedCount: number;
  taskActiveCount: number;
  taskOnTimeCompletionRate: number | null;
  sourceCoverageRate: number | null;
  sourceAvailableCount: number;
  sourcePartialCount: number;
  sourceUnavailableCount: number;
  expectedSourceTypes: TaskEvidenceSourceType[];
  dataConfidence: EvaluationDataConfidence;
  /** Readiness of the task-evidence slice only; never final employee evaluation readiness. */
  isTaskEvidenceReady: boolean;
  confidenceReasons: string[];
}

function roundPercent(numerator: number, denominator: number) {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 10_000) / 100;
}

function applicabilityKey(subjectStaffId: string, branch: string) {
  return `${subjectStaffId}::${branch}`;
}

function confidenceForProjection(
  projection: StaffTaskCompletionProjection,
  expectedSourceTypes: TaskEvidenceSourceType[] | null
) {
  if (!expectedSourceTypes?.length) {
    return {
      level: 'unavailable' as const,
      sourceCoverageRate: null,
      availableCount: 0,
      partialCount: 0,
      unavailableCount: 0,
      reasons: ['Evaluation source applicability is not configured for this staff/branch.'],
    };
  }

  const expected = new Set(expectedSourceTypes);
  const selectedSources = projection.sources.filter((source) => expected.has(source.sourceType));
  const byType = new Map(selectedSources.map((source) => [source.sourceType, source]));
  const missingConfiguredSources = expectedSourceTypes.filter((sourceType) => !byType.has(sourceType));
  const availableCount = selectedSources.filter((source) => source.availability === 'available').length;
  const partialCount = selectedSources.filter((source) => source.availability === 'partial').length;
  const unavailableCount =
    selectedSources.filter((source) => source.availability === 'unavailable').length +
    missingConfiguredSources.length;
  const sourceTotal = expectedSourceTypes.length;
  const weightedCoverage = availableCount + partialCount * 0.5;
  const sourceCoverageRate = roundPercent(weightedCoverage, sourceTotal);
  const reasons: string[] = [];

  if (unavailableCount > 0) {
    reasons.push(`${unavailableCount} applicable evidence source(s) unavailable.`);
  }
  if (partialCount > 0) {
    reasons.push(`${partialCount} applicable evidence source(s) only partially available.`);
  }
  if (projection.resolved === 0) {
    reasons.push('No resolved task outcomes are available yet.');
  }

  if (unavailableCount === 0 && partialCount === 0) {
    return {
      level: 'high' as const,
      sourceCoverageRate,
      availableCount,
      partialCount,
      unavailableCount,
      reasons,
    };
  }
  if (sourceCoverageRate !== null && sourceCoverageRate >= 75) {
    return {
      level: 'medium' as const,
      sourceCoverageRate,
      availableCount,
      partialCount,
      unavailableCount,
      reasons,
    };
  }
  return {
    level: 'low' as const,
    sourceCoverageRate,
    availableCount,
    partialCount,
    unavailableCount,
    reasons,
  };
}

/**
 * Converts task completion projections into neutral evaluation metrics only.
 *
 * Source applicability must be supplied explicitly. A source outage in a domain
 * that does not apply to a staff member must never reduce that staff member's
 * data confidence. Missing applicability fails closed and cannot make the task
 * evidence slice ready.
 *
 * This layer intentionally does not create an evaluation score, points delta,
 * incentive amount, payroll amount, or settlement decision. Those require an
 * explicit approved evaluation policy downstream.
 */
export function buildEvaluationMetrics(
  projections: StaffTaskCompletionProjection[],
  applicability: EvaluationSourceApplicability[] = []
): EvaluationMetricProjection[] {
  const applicabilityByKey = new Map(
    applicability.map((entry) => [
      applicabilityKey(entry.subjectStaffId, entry.branch),
      Array.from(new Set(entry.expectedSourceTypes)),
    ])
  );

  return projections.map((projection) => {
    const expectedSourceTypes =
      applicabilityByKey.get(applicabilityKey(projection.subjectStaffId, projection.branch)) || null;
    const confidence = confidenceForProjection(projection, expectedSourceTypes);
    const timedCompleted = projection.onTimeCompleted + projection.lateCompleted;
    const taskOnTimeCompletionRate = roundPercent(projection.onTimeCompleted, timedCompleted);

    return {
      subjectStaffId: projection.subjectStaffId,
      branch: projection.branch,
      taskCompletionRate: projection.completionRate,
      taskResolvedCount: projection.resolved,
      taskCompletedCount: projection.completed,
      taskMissedCount: projection.missed,
      taskActiveCount: projection.active,
      taskOnTimeCompletionRate,
      sourceCoverageRate: confidence.sourceCoverageRate,
      sourceAvailableCount: confidence.availableCount,
      sourcePartialCount: confidence.partialCount,
      sourceUnavailableCount: confidence.unavailableCount,
      expectedSourceTypes: expectedSourceTypes || [],
      dataConfidence: confidence.level,
      isTaskEvidenceReady:
        projection.resolved > 0 && confidence.level !== 'low' && confidence.level !== 'unavailable',
      confidenceReasons: confidence.reasons,
    };
  });
}
