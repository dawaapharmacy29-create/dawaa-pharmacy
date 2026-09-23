import { describe, expect, it } from 'vitest';
import { buildCanonicalProduct, countNormalizedNames, type RawProductRow } from '../../pharmacyProducts/canonicalProduct';
import { normalizePharmacyText } from '../../pharmacyProducts/pharmacyNormalization';
import { buildPharmacyProductIndex } from '../../pharmacyProducts/pharmacyProductResolverV2';
import { runHistoricalClosureBenchmarkV2, type ClosureGroundTruthCaseV2 } from '../closureBenchmarkV2';

function catalogFrom(rows: RawProductRow[]) {
  const counts = countNormalizedNames(rows);
  return buildPharmacyProductIndex(rows.map((r) => buildCanonicalProduct(r, counts, normalizePharmacyText)));
}

const CATALOG = catalogFrom([
  { id: 'p-antinal', name: 'ANTINAL 24 CAP', product_code: '56822', normalized_name: 'antinal 24 cap', category: null, price: '52', source: 'catalog_import' },
  { id: 'p-isis', name: 'ISIS TEEN DERM GEL SENSITIVE 250ML', product_code: '70271', normalized_name: 'isis teen derm gel sensitive 250ml', category: null, price: '659', source: 'catalog_import' },
]);

const CASES: ClosureGroundTruthCaseV2[] = [
  {
    id: 'C01-real-advisory-politeness',
    source: 'real',
    sourceNote: 'Real Dawaa conversation 6472fb41...: staff says "من عنيا" while still reviewing/recommending; no accepted product/order is visible in text.',
    raw: `[5/9/26, 11:27:38 PM] Customer: انا كنت واخد نوع شيكولاته للجنس
[5/9/26, 11:28:21 PM] Customer: فأفضل حاجه ايه تظبط الرغبه
[5/9/26, 11:31:49 PM] You: من عنيا لحضرتك طبعا
[5/9/26, 11:32:04 PM] You: هراجع افضل نوع عندنا والبلغك بيه والسعر كمان`,
    expectedLevel: 'not_closed',
  },
  {
    id: 'C02-real-accepted-fulfillment',
    source: 'real',
    sourceNote: 'Real Dawaa conversation 9a59338b...: named product, explicit "اه ابعته", then staff fulfillment intent and delivery follow-up.',
    raw: `[9/15/26, 9:30:55 PM] Customer: Isis teenderm gel for sensitive skin
[9/15/26, 9:31:16 PM] Customer: موجود عندكم الغسول ده
[9/15/26, 9:32:09 PM] You: موجود باذن الله يافندم
[9/15/26, 9:35:06 PM] You: تحب نبعته لحضرتك باذن الله ؟
[9/15/26, 9:42:30 PM] Customer: اه ابعته
[9/15/26, 9:42:57 PM] You: من عنيا لحضرتك مسافه الطريق ويكون عند حضرتك
[9/15/26, 10:28:58 PM] You: اه يا فندم المندوب في الطريق لحضرتك`,
    expectedLevel: 'strongly_inferred',
  },
  {
    id: 'C03-real-price-only',
    source: 'real',
    sourceNote: 'Real Dawaa price/recommendation-only pattern with no customer acceptance.',
    raw: `[6/21/26, 2:55:16 PM] Customer: طب تنضيف البشره ده ترشحيلي ايه
[6/21/26, 2:56:45 PM] You: غسول فيتشي ممتاز يا فندم
[6/21/26, 2:57:00 PM] Customer: سعره كام
[6/21/26, 2:57:59 PM] You: 400 مللي ب 1200 جنيه`,
    expectedLevel: 'not_closed',
  },
  {
    id: 'C04-synthetic-pure-thanks',
    source: 'synthetic',
    sourceNote: 'Structural negative: no purchase intent at all.',
    raw: `[9/15/26, 9:00:00 AM] Customer: شكرا
[9/15/26, 9:01:00 AM] You: تحت أمرك دائما`,
    expectedLevel: 'unknown',
  },
  {
    id: 'C05-synthetic-clean-organic-order',
    source: 'synthetic',
    sourceNote: 'Structural positive using a real catalog SKU and ordinary Dawaa organic closing language.',
    raw: `[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: موجود
[9/15/26, 9:02:00 AM] Customer: تمام ابعته
[9/15/26, 9:03:00 AM] You: جاري الارسال`,
    expectedLevel: 'strongly_inferred',
  },
];

describe('Phase I.B.4 — closure benchmark current vs Basket-V2 shadow', () => {
  it('does not introduce new closure overclaims and fixes the known advisory-politeness false positive', () => {
    const report = runHistoricalClosureBenchmarkV2(CASES, CATALOG);
    const advisory = report.cases.find((c) => c.caseId === 'C01-real-advisory-politeness')!;

    expect(advisory.currentLevel).toBe('weakly_inferred');
    expect(advisory.shadowLevel).toBe('not_closed');
    expect(report.shadowOverclaims).toBeLessThanOrEqual(report.currentOverclaims);
    expect(report.shadowExactMatches).toBeGreaterThanOrEqual(report.currentExactMatches);
  });

  it('preserves genuine strong organic closures', () => {
    const report = runHistoricalClosureBenchmarkV2(CASES, CATALOG);
    const realAccepted = report.cases.find((c) => c.caseId === 'C02-real-accepted-fulfillment')!;
    const syntheticAccepted = report.cases.find((c) => c.caseId === 'C05-synthetic-clean-organic-order')!;

    expect(realAccepted.shadowLevel).toBe('strongly_inferred');
    expect(syntheticAccepted.shadowLevel).toBe('strongly_inferred');
  });
});
