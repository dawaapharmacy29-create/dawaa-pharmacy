import { describe, expect, it } from 'vitest';
import { BASKET_GROUND_TRUTH_CASES_V1, BASKET_GROUND_TRUTH_VERSION_V1 } from '../benchmarkGroundTruthV1';

function inferredDifficulty(category: string): 'easy' | 'medium' | 'hard' {
  if (/image|media|substitution|ambiguous|quantity_change|multiple|multi_item|hard/i.test(category)) return 'hard';
  if (/recommendation|availability|same_customer|price/i.test(category)) return 'medium';
  return 'easy';
}

describe('Phase I.B.4 — canonical Ground Truth integrity', () => {
  it('keeps dataset identity explicit and case ids unique', () => {
    expect(BASKET_GROUND_TRUTH_VERSION_V1).toBe('dawaa-intelligence-ground-truth-v1.1');
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

  it('keeps synthetic cases explicitly synthetic rather than padding real evidence', () => {
    const synthetic = BASKET_GROUND_TRUTH_CASES_V1.filter((c) => c.source === 'synthetic');
    expect(synthetic.length).toBe(10);
    expect(synthetic.every((c) => /^S\d+/.test(c.id))).toBe(true);
  });
});
