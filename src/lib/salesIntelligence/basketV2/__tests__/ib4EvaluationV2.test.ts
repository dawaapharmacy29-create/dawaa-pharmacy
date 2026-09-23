import { describe, expect, it } from 'vitest';
import { buildCanonicalProduct, countNormalizedNames } from '../../pharmacyProducts/canonicalProduct';
import { normalizePharmacyText } from '../../pharmacyProducts/pharmacyNormalization';
import { buildPharmacyProductIndex } from '../../pharmacyProducts/pharmacyProductResolverV2';
import { REAL_CATALOG_ROWS_V1 } from '../benchmarkGroundTruthV1';
import { runIb4EvaluationV2 } from '../ib4EvaluationV2';

function productIndex() {
  const counts = countNormalizedNames(REAL_CATALOG_ROWS_V1);
  return buildPharmacyProductIndex(REAL_CATALOG_ROWS_V1.map((r) => buildCanonicalProduct(r, counts, normalizePharmacyText)));
}

describe('Phase I.B.4 — composed evaluation report', () => {
  it('is deterministic and keeps real quality blockers explicit', () => {
    const index = productIndex();
    const a = runIb4EvaluationV2(index);
    const b = runIb4EvaluationV2(index);

    expect(a.summary).toBe(b.summary);
    expect(a.basket.machineReadableJson).toBe(b.basket.machineReadableJson);
    expect(a.basket.metrics.falseAddedProductToBasket.v2).toBe(0);
    expect(a.basket.metrics.quantityTargetAudit.incorrect).toBe(0);
    expect(a.basket.metrics.wrongQuantityAppliedToCorrectProduct).toBe(0);
    expect(a.basket.metrics.safeEdgeAudit.verifiedIncorrect).toBe(0);
    expect(a.regressionCases).toEqual([]);
    expect(Array.isArray(a.topFailureCategories)).toBe(true);
    // I.B.4 closed: real Ground Truth volume crosses the minimumRealCases gate (21 >= 20), and the
    // last real quality blocker (R13's missed human review — see productMentionTracker.ts's
    // resolveRejectionTarget()) is fixed. readyForNextStage now correctly reports true with zero
    // blockers. This assertion is the phase's own acceptance criterion — a real future regression
    // (a false-added product, a wrong quantity, a missed review, a mis-sequenced event, etc.) must
    // flip this back to false and fail loudly, never be silently tolerated.
    expect(a.readiness.evidenceSufficient).toBe(true);
    expect(a.readiness.readyForNextStage).toBe(true);
    expect(a.readiness.blockers).toEqual([]);
  });
});
