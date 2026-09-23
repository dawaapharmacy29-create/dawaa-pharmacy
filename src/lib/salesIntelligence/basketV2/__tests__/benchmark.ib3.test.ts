// Phase I.B.3 — the real Basket benchmark: OLD (caseBasketEngine.ts) vs Basket Reconstruction V2.
//
// GROUND TRUTH METHODOLOGY (instruction #27, same discipline as I.B.2.1's own benchmark): every
// `groundTruth` value below was written by reading the conversation text FIRST and deciding the
// correct answer BEFORE ever running either engine. Ground truth is never derived from, or
// adjusted to match, either engine's own output. Where the real conversation's text genuinely does
// not establish a safe answer (a decision made over a voice message, an image-only antecedent, a
// quantity split across two products with no per-product number), the ground truth says so
// honestly via `expectUnresolvedSignal`/loose `expectedAddedProductCodes` rather than guessing —
// and the specific ambiguity is recorded in `sourceNote` for the manual regression review this
// file's own test performs.
//
// REAL vs SYNTHETIC (instruction #26's "do not fabricate volume"): every case marked
// `source: 'real'` is copied — customer display name normalized to "Customer" for fixture
// cleanliness, message TEXT otherwise verbatim — from whatsapp_review_sources (mined 2026-09-23 via
// keyword SQL over the full 90-row corpus; see the I.B.3 report for the exact queries and per-
// category hit counts). `source: 'synthetic'` cases exist ONLY to cover mandatory structural
// categories (remove item, whole-order cancellation, a single-item rejection distinct from
// cancellation, a clean unambiguous substitution, the same-message reference gap, a two-product
// ambiguous-quantity worked example, a rejected recommendation) that this corpus's 90 conversations
// do not naturally contain at all (confirmed via SQL: zero real hits for remove/cancel/reject
// phrasing across the whole corpus) — never to inflate volume. Every synthetic case still uses only
// REAL catalog products (Antinal, Flexilax, Centrum) confirmed present in the actual `products`
// table, never an invented SKU.
//
// FINAL COUNT (reported honestly, not padded to the instruction's 30/40-case targets): 23 cases
// (13 real + 10 synthetic). This corpus is small (90 conversations total) and overwhelmingly
// voice/image-dependent for the exact commercial decision (which SKU, whether accepted) — a
// finding reported in its own right in the I.B.3/I.B.3.1 reports, not hidden by inflating the case
// count. I.B.3.1 added R11/R12 (further real price-only/misspelling cases outside this benchmark's
// catalog subset, mined the same way) and S09/S10 (mandatory families #6/#8 — recommendation-only
// and availability-then-order, which I.B.3's own 18-case set did not yet cover explicitly).
import { describe, expect, it } from 'vitest';
import { buildCanonicalProduct, countNormalizedNames, type RawProductRow } from '../../pharmacyProducts/canonicalProduct';
import { buildPharmacyProductIndex } from '../../pharmacyProducts/pharmacyProductResolverV2';
import { normalizePharmacyText } from '../../pharmacyProducts/pharmacyNormalization';
import { buildCaseBaskets } from '../../caseBasketEngine';
import { buildConversationEntityGraphV2 } from '../conversationEntityGraphV2';
import { reconstructBasketV2 } from '../basketReconstructionV2';
import { messagesFrom } from './testUtils';
import type { BasketStatusV2 } from '../basketV2Types';
import { BASKET_GROUND_TRUTH_CASES_V1, BASKET_GROUND_TRUTH_VERSION_V1, REAL_CATALOG_ROWS_V1 } from '../benchmarkGroundTruthV1';
import { runSalesIntelligenceBenchmarkV2 } from '../benchmarkV2';

function catalogFrom(rows: RawProductRow[]) {
  const counts = countNormalizedNames(rows);
  const catalog = rows.map((r) => buildCanonicalProduct(r, counts, normalizePharmacyText));
  return buildPharmacyProductIndex(catalog);
}

// Ground Truth lives outside the test harness so it is independently inspectable/versioned.
const REAL_CATALOG_ROWS = REAL_CATALOG_ROWS_V1;
const CASES = BASKET_GROUND_TRUTH_CASES_V1;

function codeForProductId(productId: string | null): string | null {
  if (!productId) return null;
  return REAL_CATALOG_ROWS.find((r) => r.id === productId)?.product_code ?? null;
}

function runOld(caseId: string, raw: string): { items: NormalizedItem[]; status: string | null } {
  const messages = messagesFrom(raw);
  const result = buildCaseBaskets(caseId, messages);
  const latest = result.baskets[result.baskets.length - 1] ?? null;
  if (!latest) return { items: [], status: null };
  const items = (result.itemsByBasketId[latest.basketId] ?? []).map((i) => ({
    productCode: codeForProductId(i.productId),
    quantity: i.quantity,
    active: true,
  }));
  return { items, status: latest.status };
}

function runV2(caseId: string, raw: string): { items: NormalizedItem[]; status: BasketStatusV2; unresolved: boolean; versionCount: number } {
  const messages = messagesFrom(raw);
  const graph = buildConversationEntityGraphV2(caseId, messages, { productIndex: CATALOG });
  const timestamps = new Map(messages.map((m) => [m.id, m.timestamp.toISOString()] as const));
  const result = reconstructBasketV2(graph, timestamps);
  const items = result.currentBasket.items
    .filter((i) => i.itemState !== 'removed' && i.itemState !== 'rejected' && i.itemState !== 'substituted')
    .map((i) => ({ productCode: i.canonicalProductCode, quantity: i.currentQuantity, active: true }));
  const unresolved = result.currentBasket.unresolvedCandidates.length > 0 || result.currentBasket.pendingReviewSignals.length > 0;
  return { items, status: result.currentBasket.status, unresolved, versionCount: result.basketVersions.length };
}

type CaseClass = 'v2_fixed' | 'both_correct' | 'both_partial' | 'v2_regression' | 'both_wrong';

function classify(c: BasketBenchmarkCase, oldItems: NormalizedItem[], v2Items: NormalizedItem[]): CaseClass {
  const oldCodes = new Set(oldItems.map((i) => i.productCode).filter((x): x is string => Boolean(x)));
  const v2Codes = new Set(v2Items.map((i) => i.productCode).filter((x): x is string => Boolean(x)));
  const expectedAdded = new Set(c.groundTruth.expectedAddedProductCodes);
  const neverAdded = new Set(c.groundTruth.expectedNeverAddedProductCodes);

  const oldFalseAdd = [...oldCodes].some((code) => neverAdded.has(code));
  const v2FalseAdd = [...v2Codes].some((code) => neverAdded.has(code));
  const oldMissesRequired = [...expectedAdded].some((code) => !oldCodes.has(code));
  const v2MissesRequired = [...expectedAdded].some((code) => !v2Codes.has(code));

  const oldCorrect = !oldFalseAdd && !oldMissesRequired;
  const v2Correct = !v2FalseAdd && !v2MissesRequired;

  if (oldCorrect && v2Correct) return 'both_correct';
  if (!oldCorrect && v2Correct) return 'v2_fixed';
  if (oldCorrect && !v2Correct) return 'v2_regression';
  // both incorrect — distinguish "both partial" (neither false-added, just missing something) from "both wrong" (a false add on either side)
  if (!oldFalseAdd && !v2FalseAdd) return 'both_partial';
  return 'both_wrong';
}

describe('I.B.3/I.B.3.1 — real Basket benchmark: OLD vs Basket Reconstruction V2 (22 cases: 12 real + 10 synthetic)', () => {
  it('computes item-level precision/recall, the false-added-product safety metric, and a case-by-case classification table', () => {
    let oldTP = 0, oldFP = 0, oldFN = 0;
    let v2TP = 0, v2FP = 0, v2FN = 0;
    let oldFalseAddedCount = 0;
    let v2FalseAddedCount = 0;
    let wrongQuantityCorrectProduct = 0;
    const classCounts: Record<CaseClass, number> = { v2_fixed: 0, both_correct: 0, both_partial: 0, v2_regression: 0, both_wrong: 0 };
    const rows: string[] = [];
    const regressions: string[] = [];

    for (const c of CASES) {
      const old = runOld(c.id, c.raw);
      const v2 = runV2(c.id, c.raw);

      const oldCodes = new Set(old.items.map((i) => i.productCode).filter((x): x is string => Boolean(x)));
      const v2Codes = new Set(v2.items.map((i) => i.productCode).filter((x): x is string => Boolean(x)));
      const expectedAdded = c.groundTruth.expectedAddedProductCodes;
      const neverAdded = new Set(c.groundTruth.expectedNeverAddedProductCodes);

      expectedAdded.forEach((code) => {
        if (oldCodes.has(code)) oldTP++; else oldFN++;
        if (v2Codes.has(code)) v2TP++; else v2FN++;
      });
      oldCodes.forEach((code) => { if (!expectedAdded.includes(code)) oldFP++; if (neverAdded.has(code)) oldFalseAddedCount++; });
      v2Codes.forEach((code) => { if (!expectedAdded.includes(code)) v2FP++; if (neverAdded.has(code)) v2FalseAddedCount++; });

      Object.entries(c.groundTruth.expectedQuantities).forEach(([code, expectedQty]) => {
        if (expectedQty === null) return;
        const v2Item = v2.items.find((i) => i.productCode === code);
        if (v2Item && v2Item.quantity !== null && v2Item.quantity !== expectedQty) wrongQuantityCorrectProduct++;
      });

      const cls = classify(c, old.items, v2.items);
      classCounts[cls]++;
      const row = `${c.id} [${c.source}/${c.category}] OLD=${JSON.stringify([...oldCodes])} V2=${JSON.stringify([...v2Codes])} truth_added=${JSON.stringify(expectedAdded)} truth_never=${JSON.stringify([...neverAdded])} v2_status=${v2.status} v2_unresolved=${v2.unresolved} class=${cls}`;
      rows.push(row);
      if (cls === 'v2_regression') regressions.push(`${row} | note: ${c.sourceNote}`);
    }

    // eslint-disable-next-line no-console
    console.log('[I.B.3 basket benchmark] per-case results:\n' + rows.join('\n'));
    // eslint-disable-next-line no-console
    console.log('[I.B.3 basket benchmark] OLD item-level:', { TP: oldTP, FP: oldFP, FN: oldFN, precision: oldTP / (oldTP + oldFP || 1), recall: oldTP / (oldTP + oldFN || 1) });
    // eslint-disable-next-line no-console
    console.log('[I.B.3 basket benchmark] V2 item-level:', { TP: v2TP, FP: v2FP, FN: v2FN, precision: v2TP / (v2TP + v2FP || 1), recall: v2TP / (v2TP + v2FN || 1) });
    // eslint-disable-next-line no-console
    console.log('[I.B.3 basket benchmark] false_added_product_to_basket:', { OLD: oldFalseAddedCount, V2: v2FalseAddedCount });
    // eslint-disable-next-line no-console
    console.log('[I.B.3 basket benchmark] wrong_quantity_applied_to_correct_product (V2):', wrongQuantityCorrectProduct);
    // eslint-disable-next-line no-console
    console.log('[I.B.3 basket benchmark] case classification counts:', classCounts);
    if (regressions.length > 0) {
      // eslint-disable-next-line no-console
      console.log('[I.B.3 basket benchmark] REGRESSIONS (manually inspected in the report):\n' + regressions.join('\n'));
    }

    // The single most important safety metric (instruction #29): V2 must NEVER silently add a
    // product the ground truth says was never safely ordered. Zero tolerance, unlike recall.
    expect(v2FalseAddedCount).toBe(0);
    // V2 must not regress below OLD on this same safety metric.
    expect(v2FalseAddedCount).toBeLessThanOrEqual(oldFalseAddedCount);
  });

  it('I.B.4 deterministic benchmark runner returns identical machine-readable output twice and preserves the safety baseline', () => {
    const first = runSalesIntelligenceBenchmarkV2(CASES, CATALOG, BASKET_GROUND_TRUTH_VERSION_V1);
    const second = runSalesIntelligenceBenchmarkV2(CASES, CATALOG, SALES_INTELLIGENCE_GROUND_TRUTH_VERSION);

    expect(first.machineReadableJson).toBe(second.machineReadableJson);
    expect(first.metrics.totalCases).toBe(CASES.length);
    expect(first.metrics.falseAddedProductToBasket.v2).toBe(0);
    expect(first.metrics.basketMatch.exactCases + first.metrics.basketMatch.partialCases + first.metrics.basketMatch.wrongCases + first.metrics.basketMatch.intentionallyUnresolvedCases).toBe(first.metrics.totalCases);
    expect(first.metrics.quantityTargetAudit.incorrect).toBe(0);
    expect(first.metrics.safeEdgeAudit.verifiedIncorrect).toBe(0);
    expect(first.metrics.confidenceCalibration.productMentions.length).toBe(3);
    expect(first.metrics.humanReviewQuality.missedReview).toBe(0);
    expect(first.metrics.wrongQuantityAppliedToCorrectProduct).toBe(0);
    expect(first.metrics.regressions).toBe(0);
  });

  it('treats ANY predicted SKU outside Ground Truth as a false-added product, even without an explicit denylist', () => {
    const deliberatelyWrong = CASES.map((c) => c.id === 'R01'
      ? { ...c, groundTruth: { ...c.groundTruth, expectedAddedProductCodes: [], expectedNeverAddedProductCodes: [] } }
      : c);
    const report = runSalesIntelligenceBenchmarkV2(deliberatelyWrong, CATALOG, BASKET_GROUND_TRUTH_VERSION_V1);
    // This assertion does not force R01 to be wrong; it locks the metric invariant globally:
    // falseAddedProductToBasket.v2 must exactly equal the sum of per-case unexpected basket SKUs.
    const unexpected = report.cases.reduce((sum, row) => {
      const expected = new Set(row.groundTruth.addedProductCodes);
      return sum + row.v2.productCodes.filter((code) => !expected.has(code)).length;
    }, 0);
    expect(report.metrics.falseAddedProductToBasket.v2).toBe(unexpected);
  });

  it('every real conversation case actually parses to at least one meaningful message (fixture sanity)', () => {
    CASES.filter((c) => c.source === 'real').forEach((c) => {
      const messages = messagesFrom(c.raw);
      expect(messages.length).toBeGreaterThan(0);
    });
  });
});
