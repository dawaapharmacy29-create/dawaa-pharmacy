import { describe, expect, it } from 'vitest';
import {
  CONVERSATION_STRENGTH_MIN_AVERAGE,
  CONVERSATION_STRENGTH_MIN_SAMPLES,
  hasStrongConversationEvidence,
} from '@/lib/evaluations/monthlyConversationEvidence';

const clean = {
  reviewCount: CONVERSATION_STRENGTH_MIN_SAMPLES,
  coreAverage: CONVERSATION_STRENGTH_MIN_AVERAGE,
  complaints: 0,
  badTone: 0,
  severeBadTone: 0,
  criticalErrors: 0,
};

describe('monthly conversation strength evidence gate', () => {
  it('requires enough reviews and the 8.5 core threshold', () => {
    expect(hasStrongConversationEvidence({ ...clean, reviewCount: 2 })).toBe(false);
    expect(hasStrongConversationEvidence({ ...clean, coreAverage: 8.4 })).toBe(false);
    expect(hasStrongConversationEvidence(clean)).toBe(true);
  });

  it('blocks strength when customer-experience evidence contradicts it', () => {
    expect(hasStrongConversationEvidence({ ...clean, complaints: 1 })).toBe(false);
    expect(hasStrongConversationEvidence({ ...clean, badTone: 1 })).toBe(false);
    expect(hasStrongConversationEvidence({ ...clean, severeBadTone: 1 })).toBe(false);
    expect(hasStrongConversationEvidence({ ...clean, criticalErrors: 1 })).toBe(false);
  });
});
