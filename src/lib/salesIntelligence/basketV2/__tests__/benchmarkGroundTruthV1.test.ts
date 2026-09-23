import { describe, expect, it } from 'vitest';
import { BASKET_GROUND_TRUTH_CASES_V1, BASKET_GROUND_TRUTH_VERSION_V1, BENCHMARK_CATALOG_FIXTURE_VERSION_V1, REAL_CATALOG_ROWS_V1 } from '../benchmarkGroundTruthV1';

function inferredDifficulty(category: string): 'easy' | 'medium' | 'hard' {
  if (/image|media|substitution|ambiguous|quantity_change|multiple|multi_item|hard/i.test(category)) return 'hard';
  if (/recommendation|availability|same_customer|price/i.test(category)) return 'medium';
  return 'easy';
}

describe('Phase I.B.4 — canonical Ground Truth integrity', () => {
  it('keeps the hermetic catalog fixture versioned and includes realistic ambiguity confusers', () => {
    expect(BENCHMARK_CATALOG_FIXTURE_VERSION_V1).toBe('dawaa-benchmark-catalog-fixture-v1.1');
    const codes = new Set(REAL_CATALOG_ROWS_V1.map((r) => r.product_code));
    expect(codes.has('60650')).toBe(true); // CIPRO 500
    expect(codes.has('8635')).toBe(true);  // CIPRO drops
    expect(codes.has('67660')).toBe(true); // Sweetal sticks
    expect(codes.has('60145')).toBe(true); // Sweetal tabs
    expect(codes.has('56544')).toBe(true); // Sweetal sachets
  });

  it('keeps dataset identity explicit and case ids unique', () => {
    expect(BASKET_GROUND_TRUTH_VERSION_V1).toBe('dawaa-intelligence-ground-truth-v1.3');
    const ids = BASKET_GROUND_TRUTH_CASES_V1.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('meets the evidence-composition floor without counting synthetic cases', () => {
    const real = BASKET_GROUND_TRUTH_CASES_V1.filter((c) => c.source === 'real');
    const realPositive = real.filter((c) => c.groundTruth.expectedAddedProductCodes.length > 0);
    const realHard = real.filter((c) => inferredDifficulty(c.category) === 'hard');

    expect(real.length).toBeGreaterThanOrEqual(20);
    expect(realPositive.length).toBeGreaterThanOrEqual(8);
    expect(realHard.length).toBeGreaterThanOrEqual(5);
  });

  it('contains every positively-labeled Ground Truth SKU in the hermetic catalog fixture', () => {
    const catalogCodes = new Set(REAL_CATALOG_ROWS_V1.map((r) => r.product_code));
    const expectedCodes = new Set(BASKET_GROUND_TRUTH_CASES_V1.flatMap((c) => c.groundTruth.expectedAddedProductCodes));
    for (const code of expectedCodes) expect(catalogCodes.has(code), `missing catalog fixture code ${code}`).toBe(true);
  });

  it('requires an explicit trusted date anchor for every time-only markdown Ground Truth case', () => {
    const timeOnly = BASKET_GROUND_TRUTH_CASES_V1.filter((c) => /time_only_markdown/i.test(c.category));
    expect(timeOnly.length).toBeGreaterThan(0);
    for (const c of timeOnly) expect(c.trustedConversationStartedAt).toBeTruthy();
  });

  it('never gives a media-only case a guessed canonical product', () => {
    const mediaOnly = BASKET_GROUND_TRUTH_CASES_V1.filter(
      (c) => c.source === 'real' && /media_only/i.test(c.category)
    );
    expect(mediaOnly.length).toBeGreaterThan(0);
    for (const c of mediaOnly) {
      expect(c.groundTruth.expectedAddedProductCodes).toEqual([]);
      expect(c.groundTruth.expectUnresolvedSignal).toBe(true);
    }
  });

  it('does not count the same conversation window twice as separate evidence', () => {
    const normalized = BASKET_GROUND_TRUTH_CASES_V1.map((c) => c.raw.replace(/\s+/g, ' ').trim());
    expect(new Set(normalized).size).toBe(normalized.length);
  });

  it('keeps synthetic cases explicitly synthetic rather than padding real evidence', () => {
    const synthetic = BASKET_GROUND_TRUTH_CASES_V1.filter((c) => c.source === 'synthetic');
    expect(synthetic.length).toBe(10);
    expect(synthetic.every((c) => /^S\d+/.test(c.id))).toBe(true);
  });
});
