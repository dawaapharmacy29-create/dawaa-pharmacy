import { describe, expect, it } from 'vitest';
import { evaluateSemanticIntelligenceReadinessV2 } from '../semanticReadinessV2';
import type { SalesIntelligenceBenchmarkMetrics } from '../benchmarkV2';
import type { ClosureBenchmarkReportV2 } from '../closureBenchmarkV2';

function benchmark(overrides: Partial<SalesIntelligenceBenchmarkMetrics> = {}): SalesIntelligenceBenchmarkMetrics {
  return {
    datasetVersion: 'test-v1',
    totalCases: 30,
    realCases: 25,
    syntheticCases: 5,
    realPositiveOrderCases: 15,
    realHardCases: 8,
    byDifficulty: { easy: 10, medium: 10, hard: 10 },
    difficultyMetrics: {
      easy: { cases: 10, tp: 10, fp: 0, fn: 0, precision: 1, recall: 1, falseAddedProducts: 0, wrongQuantities: 0 },
      medium: { cases: 10, tp: 8, fp: 0, fn: 2, precision: 1, recall: 0.8, falseAddedProducts: 0, wrongQuantities: 0 },
      hard: { cases: 10, tp: 7, fp: 0, fn: 3, precision: 1, recall: 0.7, falseAddedProducts: 0, wrongQuantities: 0 },
    },
    realOnlyV2Product: { tp: 20, fp: 0, fn: 5, precision: 1, recall: 0.8 },
    syntheticOnlyV2Product: { tp: 5, fp: 0, fn: 0, precision: 1, recall: 1 },
    oldProduct: { tp: 0, fp: 0, fn: 25, precision: 0, recall: 0 },
    v2Product: { tp: 25, fp: 0, fn: 5, precision: 1, recall: 25 / 30 },
    falseAddedProductToBasket: { old: 0, v2: 0 },
    safeEdgeAudit: { total: 20, verifiedCorrect: 18, verifiedIncorrect: 0, unverifiable: 2, empiricalErrorRate: 0 },
    confidenceCalibration: {
      productMentions: [],
      quantityLinks: [],
      referenceLinks: [],
    },
    humanReviewQuality: {
      trueReviewNeeded: 5,
      unnecessaryReview: 1,
      missedReview: 0,
      correctlyNoReview: 24,
      precision: 5 / 6,
      recall: 1,
    },
    wrongQuantityAppliedToCorrectProduct: 0,
    missedExpectedQuantity: 2,
    unresolvedCases: 6,
    mediaLimitedCases: 1,
    transliterationFailureCases: 0,
    safetyCriticalErrorCount: 0,
    regressions: 0,
    failureCounts: {},
    ...overrides,
  };
}

function closure(overrides: Partial<ClosureBenchmarkReportV2> = {}): ClosureBenchmarkReportV2 {
  return {
    totalCases: 8,
    realCases: 5,
    syntheticCases: 3,
    currentExactMatches: 6,
    shadowExactMatches: 7,
    currentOverclaims: 1,
    shadowOverclaims: 0,
    currentBinary: { tp: 3, fp: 1, fn: 0, tn: 4, precision: 0.75, recall: 1, falseClosureRate: 0.2 },
    shadowBinary: { tp: 3, fp: 0, fn: 0, tn: 5, precision: 1, recall: 1, falseClosureRate: 0 },
    falseClosuresPreventedByShadow: 1,
    genuineClosuresLostByShadow: 0,
    cases: [],
    ...overrides,
  };
}

describe('Phase I.B.4 — semantic readiness gate', () => {
  it('passes when safety is clean and real evidence is sufficient', () => {
    const result = evaluateSemanticIntelligenceReadinessV2(benchmark(), closure());
    expect(result.readyForNextStage).toBe(true);
    expect(result.safetyPassed).toBe(true);
    expect(result.evidenceSufficient).toBe(true);
  });

  it('blocks on an insufficient real benchmark even when safety is clean', () => {
    const result = evaluateSemanticIntelligenceReadinessV2(benchmark({ realCases: 13, realPositiveOrderCases: 7, realHardCases: 4 }), closure());
    expect(result.readyForNextStage).toBe(false);
    expect(result.safetyPassed).toBe(true);
    expect(result.evidenceSufficient).toBe(false);
    expect(result.blockers.some((b) => b.startsWith('insufficient_real_ground_truth_cases:'))).toBe(true);
  });

  it('blocks every safety-critical regression independently of recall', () => {
    const result = evaluateSemanticIntelligenceReadinessV2(
      benchmark({
        falseAddedProductToBasket: { old: 0, v2: 1 },
        wrongQuantityAppliedToCorrectProduct: 1,
        safeEdgeAudit: { total: 5, verifiedCorrect: 3, verifiedIncorrect: 1, unverifiable: 1, empiricalErrorRate: 0.25 },
        regressions: 1,
        humanReviewQuality: {
          trueReviewNeeded: 1, unnecessaryReview: 0, missedReview: 1, correctlyNoReview: 27, precision: 1, recall: 0.5,
        },
      }),
      closure({
        shadowBinary: { tp: 2, fp: 1, fn: 0, tn: 4, precision: 2 / 3, recall: 1, falseClosureRate: 0.2 },
      })
    );
    expect(result.readyForNextStage).toBe(false);
    expect(result.safetyPassed).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining([
      'false_added_products:1',
      'wrong_quantities:1',
      'verified_safe_edge_errors:1',
      'v2_regressions:1',
      'shadow_false_closures:1',
      'missed_human_reviews:1',
    ]));
  });
});
