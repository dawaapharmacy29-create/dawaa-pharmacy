// Phase I.B.4 — benchmark readiness gate for the NEXT semantic stage.
//
// This is NOT a production feature flag and never changes runtime behaviour. It turns the measured
// benchmark outputs into an explicit, auditable decision: either "benchmark evidence is sufficient
// to begin the next integration stage" or "blocked", with exact reasons.
//
// Precision/safety intentionally dominate recall. A low recall alone is not a safety failure, but a
// small real-case sample is evidence insufficiency and therefore remains a blocker.
import type { SalesIntelligenceBenchmarkMetrics } from './benchmarkV2';
import type { ClosureBenchmarkReportV2 } from './closureBenchmarkV2';

export interface SemanticReadinessThresholdsV2 {
  /** Minimum independently-labelled REAL cases before a next-stage readiness claim is evidence-backed. */
  minimumRealCases: number;
  minimumRealPositiveOrderCases: number;
  minimumRealHardCases: number;
  /** Hard safety thresholds. */
  maxFalseAddedProducts: number;
  maxWrongQuantities: number;
  maxVerifiedSafeEdgeErrors: number;
  maxRegressions: number;
  maxShadowFalseClosures: number;
  maxMissedHumanReviews: number;
}

export interface SemanticReadinessAssessmentV2 {
  readyForNextStage: boolean;
  safetyPassed: boolean;
  evidenceSufficient: boolean;
  blockers: string[];
  warnings: string[];
  thresholds: SemanticReadinessThresholdsV2;
}

export const DEFAULT_SEMANTIC_READINESS_THRESHOLDS_V2: SemanticReadinessThresholdsV2 = {
  minimumRealCases: 20,
  minimumRealPositiveOrderCases: 8,
  minimumRealHardCases: 5,
  maxFalseAddedProducts: 0,
  maxWrongQuantities: 0,
  maxVerifiedSafeEdgeErrors: 0,
  maxRegressions: 0,
  maxShadowFalseClosures: 0,
  maxMissedHumanReviews: 0,
};

export function evaluateSemanticIntelligenceReadinessV2(
  benchmark: SalesIntelligenceBenchmarkMetrics,
  closure: ClosureBenchmarkReportV2,
  thresholds: SemanticReadinessThresholdsV2 = DEFAULT_SEMANTIC_READINESS_THRESHOLDS_V2
): SemanticReadinessAssessmentV2 {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (benchmark.realCases < thresholds.minimumRealCases) {
    blockers.push(`insufficient_real_ground_truth_cases:${benchmark.realCases}<${thresholds.minimumRealCases}`);
  }
  if (benchmark.realPositiveOrderCases < thresholds.minimumRealPositiveOrderCases) {
    blockers.push(`insufficient_real_positive_order_cases:${benchmark.realPositiveOrderCases}<${thresholds.minimumRealPositiveOrderCases}`);
  }
  if (benchmark.realHardCases < thresholds.minimumRealHardCases) {
    blockers.push(`insufficient_real_hard_cases:${benchmark.realHardCases}<${thresholds.minimumRealHardCases}`);
  }
  if (benchmark.falseAddedProductToBasket.v2 > thresholds.maxFalseAddedProducts) {
    blockers.push(`false_added_products:${benchmark.falseAddedProductToBasket.v2}`);
  }
  if (benchmark.wrongQuantityAppliedToCorrectProduct > thresholds.maxWrongQuantities) {
    blockers.push(`wrong_quantities:${benchmark.wrongQuantityAppliedToCorrectProduct}`);
  }
  if (benchmark.safeEdgeAudit.verifiedIncorrect > thresholds.maxVerifiedSafeEdgeErrors) {
    blockers.push(`verified_safe_edge_errors:${benchmark.safeEdgeAudit.verifiedIncorrect}`);
  }
  if (benchmark.regressions > thresholds.maxRegressions) {
    blockers.push(`v2_regressions:${benchmark.regressions}`);
  }
  if (closure.shadowBinary.fp > thresholds.maxShadowFalseClosures) {
    blockers.push(`shadow_false_closures:${closure.shadowBinary.fp}`);
  }
  if (benchmark.humanReviewQuality.missedReview > thresholds.maxMissedHumanReviews) {
    blockers.push(`missed_human_reviews:${benchmark.humanReviewQuality.missedReview}`);
  }

  if (benchmark.safeEdgeAudit.unverifiable > 0) {
    warnings.push(`safe_edges_unverifiable:${benchmark.safeEdgeAudit.unverifiable}`);
  }
  if (benchmark.unresolvedCases > 0) {
    warnings.push(`cases_with_review_or_unresolved_signals:${benchmark.unresolvedCases}`);
  }
  if (benchmark.realOnlyV2Product.recall < 0.8) {
    warnings.push(`real_product_recall_below_80_percent:${(benchmark.realOnlyV2Product.recall * 100).toFixed(1)}`);
  }
  if (closure.genuineClosuresLostByShadow > 0) {
    warnings.push(`genuine_closures_lost_by_shadow:${closure.genuineClosuresLostByShadow}`);
  }

  const evidenceBlocker = (b: string) =>
    b.startsWith('insufficient_real_ground_truth_cases:') ||
    b.startsWith('insufficient_real_positive_order_cases:') ||
    b.startsWith('insufficient_real_hard_cases:');
  const evidenceSufficient = !blockers.some(evidenceBlocker);
  const safetyPassed = !blockers.some((b) => !evidenceBlocker(b));

  return {
    readyForNextStage: blockers.length === 0,
    safetyPassed,
    evidenceSufficient,
    blockers,
    warnings,
    thresholds,
  };
}
