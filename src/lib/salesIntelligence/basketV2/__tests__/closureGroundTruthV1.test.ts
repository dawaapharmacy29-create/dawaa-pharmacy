import { describe, expect, it } from 'vitest';
import { CLOSURE_GROUND_TRUTH_CASES_V1, CLOSURE_GROUND_TRUTH_VERSION_V1 } from '../closureGroundTruthV1';

function isClosed(level: string): boolean {
  return level === 'strongly_inferred' || level === 'explicit';
}

describe('Phase I.B.4 — closure Ground Truth integrity', () => {
  it('keeps closure dataset version and ids explicit', () => {
    expect(CLOSURE_GROUND_TRUTH_VERSION_V1).toBe('dawaa-closure-ground-truth-v1.1');
    const ids = CLOSURE_GROUND_TRUTH_CASES_V1.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('contains enough REAL positive and negative closure evidence', () => {
    const real = CLOSURE_GROUND_TRUTH_CASES_V1.filter((c) => c.source === 'real');
    const positive = real.filter((c) => isClosed(c.expectedLevel));
    const negative = real.filter((c) => !isClosed(c.expectedLevel));
    expect(real.length).toBeGreaterThanOrEqual(5);
    expect(positive.length).toBeGreaterThanOrEqual(3);
    expect(negative.length).toBeGreaterThanOrEqual(2);
  });

  it('does not count duplicate raw windows as separate closure evidence', () => {
    const normalized = CLOSURE_GROUND_TRUTH_CASES_V1.map((c) => c.raw.replace(/\s+/g, ' ').trim());
    expect(new Set(normalized).size).toBe(normalized.length);
  });
});
