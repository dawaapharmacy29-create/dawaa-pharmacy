import { describe, expect, it } from 'vitest';
import { normalizeConversationDimensionScore } from '@/lib/evaluations/monthlyConversationScoreScale';

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

  it('clamps malformed historical values to the 0..10 display range', () => {
    expect(normalizeConversationDimensionScore('consultation_quality', 30)).toBe(10);
    expect(normalizeConversationDimensionScore('closing_message', -2)).toBe(0);
  });
});
