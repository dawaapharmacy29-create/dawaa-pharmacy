import type { StaffTaskCompletionProjection } from '@/lib/tasks/taskCompletionProjection';

export const EVALUATION_DATA_CONFIDENCE = ['high', 'medium', 'low', 'unavailable'] as const;
export type EvaluationDataConfidence = (typeof EVALUATION_DATA_CONFIDENCE)[number];

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
  dataConfidence: EvaluationDataConfidence;
  isEvaluationReady: boolean;
  confidenceReasons: string[];
}

function roundPercent(numerator: number, denominator: number) {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 10_000) / 100;
}

function confidenceForProjection(projection: StaffTaskCompletionProjection) {
  const sourceTotal =
    projection.availableSourceCount +
    projection.partialSourceCount +
    projection.unavailableSourceCount;

  if (sourceTotal === 0) {
    return {
      level: 'unavailable' as const,
      sourceCoverageRate: null,
      reasons: ['No operational evidence sources were observed.'],
    };
  }

  const weightedCoverage =
    projection.availableSourceCount + projection.partialSourceCount * 0.5;
  const sourceCoverageRate = roundPercent(weightedCoverage, sourceTotal);
  const reasons: string[] = [];

  if (projection.unavailableSourceCount > 0) {
    reasons.push(`${projection.unavailableSourceCount} evidence source(s) unavailable.`);
  }
  if (projection.partialSourceCount > 0) {
    reasons.push(`${projection.partialSourceCount} evidence source(s) only partially available.`);
  }
  if (projection.resolved === 0) {
    reasons.push('No resolved task outcomes are available yet.');
  }

  if (projection.unavailableSourceCount === 0 && projection.partialSourceCount === 0) {
    return { level: 'high' as const, sourceCoverageRate, reasons };
  }
  if (sourceCoverageRate !== null && sourceCoverageRate >= 75) {
    return { level: 'medium' as const, sourceCoverageRate, reasons };
  }
  return { level: 'low' as const, sourceCoverageRate, reasons };
}

/**
 * Converts task completion projections into neutral evaluation metrics only.
 *
 * This layer intentionally does not create an evaluation score, points delta,
 * incentive amount, payroll amount, or settlement decision. Those require an
 * explicit approved evaluation policy downstream.
 */
export function buildEvaluationMetrics(
  projections: StaffTaskCompletionProjection[]
): EvaluationMetricProjection[] {
  return projections.map((projection) => {
    const confidence = confidenceForProjection(projection);
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
      sourceAvailableCount: projection.availableSourceCount,
      sourcePartialCount: projection.partialSourceCount,
      sourceUnavailableCount: projection.unavailableSourceCount,
      dataConfidence: confidence.level,
      isEvaluationReady:
        projection.resolved > 0 && confidence.level !== 'low' && confidence.level !== 'unavailable',
      confidenceReasons: confidence.reasons,
    };
  });
}
