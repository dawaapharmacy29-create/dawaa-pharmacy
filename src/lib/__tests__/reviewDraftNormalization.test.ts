import { describe, expect, it } from 'vitest';
import {
  REVIEW_CRITERIA,
  defaultReviewState,
  defaultSevereErrors,
} from '@/lib/conversationReviews';
import {
  CONVERSATION_REVIEW_DRAFT_KEY,
  normalizeConversationReviewSevereErrors,
  normalizeConversationReviewState,
  normalizeStoredConversationReviewDraft,
  type ReviewDraftStorage,
} from '@/lib/reviews/reviewDraftNormalization';

function memoryStorage(initial: Record<string, string> = {}): ReviewDraftStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key)! : null),
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

describe('conversation review draft normalization', () => {
  it('fills every current criterion from canonical defaults for a legacy partial draft', () => {
    const normalized = normalizeConversationReviewState({
      greeting: { applies: true, choice: 'direct_reply', notes: 'قديم' },
    });

    for (const criterion of REVIEW_CRITERIA) {
      expect(normalized[criterion.key]).toBeTruthy();
      expect(typeof normalized[criterion.key].applies).toBe('boolean');
      expect(typeof normalized[criterion.key].choice).toBe('string');
    }

    expect(normalized.exceptional_followup_recognition).toEqual(
      defaultReviewState().exceptional_followup_recognition
    );
    expect(normalized.purchase_history_usage).toEqual(defaultReviewState().purchase_history_usage);
  });

  it('preserves valid saved values but rejects invalid choices and malformed fields', () => {
    const normalized = normalizeConversationReviewState({
      greeting: { applies: false, choice: 'close_with_name', notes: 'محفوظ' },
      tone: { applies: 'yes', choice: 'not-a-real-choice', notes: 12 },
    });

    expect(normalized.greeting).toEqual({
      applies: false,
      choice: 'close_with_name',
      notes: 'محفوظ',
    });
    expect(normalized.tone).toEqual(defaultReviewState().tone);
  });

  it('fills the full severe-error map and overlays only booleans', () => {
    const normalized = normalizeConversationReviewSevereErrors({
      medical_error: true,
      invoice_error: 'true',
    });
    const defaults = defaultSevereErrors();

    expect(normalized.medical_error).toBe(true);
    expect(normalized.invoice_error).toBe(defaults.invoice_error);
    expect(Object.keys(normalized).sort()).toEqual(Object.keys(defaults).sort());
  });

  it('normalizes persisted drafts in place and retains unrelated draft fields', () => {
    const storage = memoryStorage({
      [CONVERSATION_REVIEW_DRAFT_KEY]: JSON.stringify({
        form: { staffId: 'staff-1' },
        reviewState: { greeting: { applies: true, choice: 'official_full' } },
        savedAt: '2026-10-14T20:00:00Z',
      }),
    });

    expect(normalizeStoredConversationReviewDraft(storage)).toBe('normalized');
    const draft = JSON.parse(storage.getItem(CONVERSATION_REVIEW_DRAFT_KEY)!);
    expect(draft.form.staffId).toBe('staff-1');
    expect(draft.savedAt).toBe('2026-10-14T20:00:00Z');
    expect(draft.reviewState.exceptional_followup_recognition).toBeTruthy();
    expect(draft.reviewState.purchase_history_usage).toBeTruthy();
    expect(Object.keys(draft.severeErrors).sort()).toEqual(Object.keys(defaultSevereErrors()).sort());
  });

  it('removes invalid JSON instead of letting a corrupt draft reach the page', () => {
    const storage = memoryStorage({ [CONVERSATION_REVIEW_DRAFT_KEY]: '{broken' });
    expect(normalizeStoredConversationReviewDraft(storage)).toBe('removed_invalid');
    expect(storage.getItem(CONVERSATION_REVIEW_DRAFT_KEY)).toBeNull();
  });

  it('does not rewrite an already canonical draft', () => {
    const canonical = JSON.stringify({
      reviewState: defaultReviewState(),
      severeErrors: defaultSevereErrors(),
    });
    const storage = memoryStorage({ [CONVERSATION_REVIEW_DRAFT_KEY]: canonical });
    expect(normalizeStoredConversationReviewDraft(storage)).toBe('unchanged');
    expect(storage.getItem(CONVERSATION_REVIEW_DRAFT_KEY)).toBe(canonical);
  });
});
