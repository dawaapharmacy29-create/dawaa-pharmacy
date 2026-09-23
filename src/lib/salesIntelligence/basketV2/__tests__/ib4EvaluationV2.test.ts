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
    // Real Ground Truth volume has now crossed the minimumRealCases gate (21 >= 20) —
    // evidenceSufficient is true, so this is no longer the blocking reason. `readyForNextStage`
    // still correctly reports false, driven by the real remaining quality gaps (missed human
    // reviews, event-sequence errors) rather than case volume.
    expect(a.readiness.evidenceSufficient).toBe(true);
    expect(a.readiness.readyForNextStage).toBe(false);
    expect(a.readiness.blockers.length).toBeGreaterThan(0);
  });
});
