// Phase I.B.4 — one deterministic, read-only evaluation entry point for the complete semantic benchmark.
//
// This composes the canonical Basket Ground Truth, canonical Closure Ground Truth, both benchmark
// runners, and the readiness gate. It performs no DB writes and does not alter runtime behaviour.
import type { PharmacyProductIndex } from '../pharmacyProducts/pharmacyProductResolverV2';
import { runSalesIntelligenceBenchmarkV2, type SalesIntelligenceBenchmarkReport } from './benchmarkV2';
import { runHistoricalClosureBenchmarkV2, type ClosureBenchmarkReportV2 } from './closureBenchmarkV2';
import { BASKET_GROUND_TRUTH_CASES_V1, BASKET_GROUND_TRUTH_VERSION_V1 } from './benchmarkGroundTruthV1';
import { CLOSURE_GROUND_TRUTH_CASES_V1, CLOSURE_GROUND_TRUTH_VERSION_V1 } from './closureGroundTruthV1';
import { evaluateSemanticIntelligenceReadinessV2, type SemanticReadinessAssessmentV2 } from './semanticReadinessV2';

export interface Ib4EvaluationReportV2 {
  evaluationVersion: 'ib4-evaluation-v1';
  basketDatasetVersion: string;
  closureDatasetVersion: string;
  basket: SalesIntelligenceBenchmarkReport;
  closure: ClosureBenchmarkReportV2;
  readiness: SemanticReadinessAssessmentV2;
  safetyCriticalErrors: string[];
  regressionCases: string[];
  topFailureCategories: Array<{ category: string; count: number }>;
  mediaLimitedCaseCount: number;
  transliterationFailureCount: number;
  blockers: string[];
  summary: string;
}

export function runIb4EvaluationV2(productIndex: PharmacyProductIndex): Ib4EvaluationReportV2 {
  const basket = runSalesIntelligenceBenchmarkV2(
    BASKET_GROUND_TRUTH_CASES_V1,
    productIndex,
    BASKET_GROUND_TRUTH_VERSION_V1
  );
  const closure = runHistoricalClosureBenchmarkV2(CLOSURE_GROUND_TRUTH_CASES_V1, productIndex);
  const readiness = evaluateSemanticIntelligenceReadinessV2(basket.metrics, closure);

  const safetyCriticalErrors = basket.cases.flatMap((c) => c.safetyCritical.map((e) => `${c.caseId}:${e}`));
  if (closure.shadowBinary.fp > 0) safetyCriticalErrors.push(`closure:false_positive_count=${closure.shadowBinary.fp}`);

  const regressionCases = basket.cases
    .filter((c) => c.classification === 'old_correct_v2_regression')
    .map((c) => c.caseId);
  const topFailureCategories = Object.entries(basket.metrics.failureCounts)
    .map(([category, count]) => ({ category, count: count ?? 0 }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category))
    .slice(0, 20);

  const summary = [
    'Phase I.B.4 — Full Intelligence Evaluation',
    `Basket dataset: ${BASKET_GROUND_TRUTH_VERSION_V1}`,
    `Closure dataset: ${CLOSURE_GROUND_TRUTH_VERSION_V1}`,
    `Basket cases: ${basket.metrics.totalCases} (real ${basket.metrics.realCases}, synthetic ${basket.metrics.syntheticCases})`,
    `Real-only V2 product precision/recall: ${(basket.metrics.realOnlyV2Product.precision * 100).toFixed(1)}% / ${(basket.metrics.realOnlyV2Product.recall * 100).toFixed(1)}%`,
    `False-added products: ${basket.metrics.falseAddedProductToBasket.v2}`,
    `Exact basket match: ${basket.metrics.basketMatch.exactCases}/${basket.metrics.totalCases} (${(basket.metrics.basketMatch.exactRate * 100).toFixed(1)}%)`,
    `Partial baskets: ${basket.metrics.basketMatch.partialCases}; wrong baskets: ${basket.metrics.basketMatch.wrongCases}; intentional unresolved: ${basket.metrics.basketMatch.intentionallyUnresolvedCases}`,
    `Wrong quantity links: ${basket.metrics.wrongQuantityAppliedToCorrectProduct}; quantity target accuracy: ${(basket.metrics.quantityTargetAudit.accuracy * 100).toFixed(1)}%`,
    `Verified safe-edge errors: ${basket.metrics.safeEdgeAudit.verifiedIncorrect}`,
    `Shadow closure precision/recall: ${(closure.shadowBinary.precision * 100).toFixed(1)}% / ${(closure.shadowBinary.recall * 100).toFixed(1)}%`,
    `Shadow false closures: ${closure.shadowBinary.fp}`,
    `Human review precision/recall: ${(basket.metrics.humanReviewQuality.precision * 100).toFixed(1)}% / ${(basket.metrics.humanReviewQuality.recall * 100).toFixed(1)}%`,
    `Event sequence accuracy: ${(basket.metrics.eventSequenceAudit.accuracy * 100).toFixed(1)}% across ${basket.metrics.eventSequenceAudit.labeledCases} labeled cases`,
    `Basket version accuracy: ${(basket.metrics.versioningAudit.accuracy * 100).toFixed(1)}% across ${basket.metrics.versioningAudit.labeledCases} labeled cases`,
    `Media-limited cases: ${basket.metrics.mediaLimitedCases}; transliteration failures: ${basket.metrics.transliterationFailureCases}`,
    `V2 regressions: ${regressionCases.length ? regressionCases.join(', ') : 'none'}`,
    `Ready for next stage: ${readiness.readyForNextStage ? 'YES' : 'NO'}`,
    `Blockers: ${readiness.blockers.length ? readiness.blockers.join(', ') : 'none'}`,
  ].join('\n');

  return {
    evaluationVersion: 'ib4-evaluation-v1',
    basketDatasetVersion: BASKET_GROUND_TRUTH_VERSION_V1,
    closureDatasetVersion: CLOSURE_GROUND_TRUTH_VERSION_V1,
    basket,
    closure,
    readiness,
    safetyCriticalErrors,
    regressionCases,
    topFailureCategories,
    mediaLimitedCaseCount: basket.metrics.mediaLimitedCases,
    transliterationFailureCount: basket.metrics.transliterationFailureCases,
    blockers: [...readiness.blockers],
    summary,
  };
}
