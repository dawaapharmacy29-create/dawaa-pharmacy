import { describe, expect, it } from 'vitest';
import { dimensionScoreToPercent, normalizeConversationDimensionScore } from '@/lib/evaluations/monthlyConversationScoreScale';

describe('monthly conversation score normalization', () => {
  it('normalizes consultation from its native 15-point scale to /10', () => {
    expect(normalizeConversationDimensionScore('consultation_quality', 15)).toBe(10);
    expect(normalizeConversationDimensionScore('consultation_quality', 12)).toBe(8);
  });

  it('normalizes closing message from its native 5-point scale to /10', () => {
    expect(normalizeConversationDimensionScore('closing_message', 5)).toBe(10);
    expect(normalizeConversationDimensionScore('closing_message', 4)).toBe(8);
  });

  it('leaves native 10-point dimensions on the same scale', () => {
    expect(normalizeConversationDimensionScore('greeting', 10)).toBe(10);
    expect(normalizeConversationDimensionScore('sales_quality', 8)).toBe(8);
  });

  // Clamping turned malformed values into valid-looking 10/0 scores that moved monthly averages.
  // Out-of-scale or non-numeric input is missing evidence instead.
  it('treats out-of-scale or non-numeric values as missing evidence, never a clamped score', () => {
    expect(normalizeConversationDimensionScore('consultation_quality', 30)).toBeNull();
    expect(normalizeConversationDimensionScore('closing_message', -2)).toBeNull();
    expect(normalizeConversationDimensionScore('greeting', Number.NaN)).toBeNull();
    expect(normalizeConversationDimensionScore('greeting', 0)).toBe(0);
  });

  it('converts a 0..10 dimension average onto the 0..100 row-score scale', () => {
    expect(dimensionScoreToPercent(8.5)).toBe(85);
    expect(dimensionScoreToPercent(null)).toBeNull();
  });
});
