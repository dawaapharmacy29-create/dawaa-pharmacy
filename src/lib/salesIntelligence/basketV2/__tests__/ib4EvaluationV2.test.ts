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
  it('is deterministic and keeps the current evidence-size blocker explicit', () => {
    const index = productIndex();
    const a = runIb4EvaluationV2(index);
    const b = runIb4EvaluationV2(index);

    expect(a.summary).toBe(b.summary);
    expect(a.basket.machineReadableJson).toBe(b.basket.machineReadableJson);
    expect(a.basket.metrics.falseAddedProductToBasket.v2).toBe(0);
    expect(a.basket.metrics.quantityTargetAudit.incorrect).toBe(0);
    expect(a.basket.metrics.wrongQuantityAppliedToCorrectProduct).toBe(0);
    expect(a.basket.metrics.safeEdgeAudit.verifiedIncorrect).toBe(0);
    expect(a.readiness.readyForNextStage).toBe(false);
    expect(a.readiness.blockers.some((x) => x.startsWith('insufficient_real_ground_truth_cases:'))).toBe(true);
  });
});
