import { describe, expect, it } from 'vitest';
import { buildCanonicalProduct, countNormalizedNames, type RawProductRow } from '../../pharmacyProducts/canonicalProduct';
import { normalizePharmacyText } from '../../pharmacyProducts/pharmacyNormalization';
import { buildPharmacyProductIndex } from '../../pharmacyProducts/pharmacyProductResolverV2';
import { runHistoricalClosureBenchmarkV2 } from '../closureBenchmarkV2';
import { CLOSURE_GROUND_TRUTH_CASES_V1 } from '../closureGroundTruthV1';

function catalogFrom(rows: RawProductRow[]) {
  const counts = countNormalizedNames(rows);
  return buildPharmacyProductIndex(rows.map((r) => buildCanonicalProduct(r, counts, normalizePharmacyText)));
}

const CATALOG = catalogFrom([
  { id: 'p-antinal', name: 'ANTINAL 24 CAP', product_code: '56822', normalized_name: 'antinal 24 cap', category: null, price: '52', source: 'catalog_import' },
  { id: 'p-isis', name: 'ISIS TEEN DERM GEL SENSITIVE 250ML', product_code: '70271', normalized_name: 'isis teen derm gel sensitive 250ml', category: null, price: '659', source: 'catalog_import' },
]);

const CASES = CLOSURE_GROUND_TRUTH_CASES_V1;

describe('Phase I.B.4 — closure Ground Truth evidence composition', () => {
  it('has enough REAL positive and negative closure cases for calibration', () => {
    const report = runHistoricalClosureBenchmarkV2(CASES, CATALOG);
    expect(report.realCases).toBeGreaterThanOrEqual(5);
    expect(report.realExpectedClosedCases).toBeGreaterThanOrEqual(3);
    expect(report.realExpectedNotClosedCases).toBeGreaterThanOrEqual(2);
  });
});

describe('Phase I.B.4 — closure benchmark current vs Basket-V2 shadow', () => {
  it('does not introduce new closure overclaims and fixes the known advisory-politeness false positive', () => {
    const report = runHistoricalClosureBenchmarkV2(CASES, CATALOG);
    const advisory = report.cases.find((c) => c.caseId === 'C01-real-advisory-politeness')!;

    expect(advisory.currentLevel).toBe('weakly_inferred');
    expect(advisory.shadowLevel).toBe('not_closed');
    expect(report.shadowOverclaims).toBeLessThanOrEqual(report.currentOverclaims);
    expect(report.shadowExactMatches).toBeGreaterThanOrEqual(report.currentExactMatches);
    expect(report.shadowBinary.fp).toBeLessThanOrEqual(report.currentBinary.fp);
    expect(report.shadowBinary.precision).toBeGreaterThanOrEqual(report.currentBinary.precision);
    expect(report.falseClosuresPreventedByShadow).toBeGreaterThanOrEqual(1);
    expect(report.genuineClosuresLostByShadow).toBe(0);
  });

  it('preserves genuine strong organic closures', () => {
    const report = runHistoricalClosureBenchmarkV2(CASES, CATALOG);
    const realAccepted = report.cases.find((c) => c.caseId === 'C02-real-accepted-fulfillment')!;
    const syntheticAccepted = report.cases.find((c) => c.caseId === 'C05-synthetic-clean-organic-order')!;

    expect(realAccepted.shadowLevel).toBe('strongly_inferred');
    expect(syntheticAccepted.shadowLevel).toBe('strongly_inferred');
  });
});
