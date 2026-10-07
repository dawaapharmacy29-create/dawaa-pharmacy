// New-review draft lifecycle: an untouched review is never dirty, real edits are, autosave only
// stores meaningful work, and discard clears both the draft and a pending Smart transfer.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  discardReviewDraft,
  isReviewDraftDirty,
  persistReviewDraft,
  reviewMeaningfulFingerprint,
  type ReviewDraftStorage,
} from '@/lib/reviews/reviewDraftLifecycle';

const DRAFT_KEY = 'dawaa_conversation_review_draft_v3';
const TRANSFER_KEY = 'dawaa_pending_conversation_review_snapshot_v1';

function memoryStorage(initial: Record<string, string> = {}): ReviewDraftStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key)! : null),
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

// Mirrors Reviews.tsx emptyReviewForm (defaults included on purpose: they must not count as edits).
function emptyState(reviewerId = 'manager-1') {
  return {
    form: {
      reviewerId,
      staffId: '',
      customerId: '',
      customerCode: '',
      customerName: '',
      customerPhone: '',
      customerType: '',
      evaluationKind: 'واتساب',
      evaluationReason: 'مراجعة عشوائية',
      invoiceNo: '',
      convertedToSale: '',
      conversationDate: '2026-10-07T09:00',
      firstCustomerMessageAt: '',
      firstStaffReplyAt: '',
      followUpPromised: false,
      followUpPromisedAt: '',
      followUpReturnedAt: '',
      notes: '',
      reviewerNotes: '',
      trainingRecommendationManual: '',
    },
    reviewState: { greeting: { applies: true, choice: 'good' } },
    severeErrors: { wrong_medicine: false },
    custSearch: '',
  };
}

describe('review draft lifecycle — dirty tracking', () => {
  it('a new untouched review (with default evaluationReason "مراجعة عشوائية") is NOT dirty', () => {
    const state = emptyState();
    const baseline = reviewMeaningfulFingerprint(state);
    expect(isReviewDraftDirty(state, baseline)).toBe(false);
  });

  it('a different reviewer/session id alone does not make it dirty', () => {
    const baseline = reviewMeaningfulFingerprint(emptyState('a'));
    expect(isReviewDraftDirty(emptyState('b'), baseline)).toBe(false);
  });

  it('whitespace-only typing is not a meaningful modification', () => {
    const baseline = reviewMeaningfulFingerprint(emptyState());
    const state = emptyState();
    state.form.reviewerNotes = '   ';
    expect(isReviewDraftDirty(state, baseline)).toBe(false);
  });

  it('a modified review is dirty (form field, criterion or severe error)', () => {
    const baseline = reviewMeaningfulFingerprint(emptyState());
    const notes = emptyState();
    notes.form.reviewerNotes = 'رد متأخر';
    expect(isReviewDraftDirty(notes, baseline)).toBe(true);
    const criterion = emptyState();
    criterion.reviewState = { greeting: { applies: true, choice: 'weak' } };
    expect(isReviewDraftDirty(criterion, baseline)).toBe(true);
    const severe = emptyState();
    severe.severeErrors = { wrong_medicine: true };
    expect(isReviewDraftDirty(severe, baseline)).toBe(true);
  });

  it('editing back to the baseline makes it clean again', () => {
    const baseline = reviewMeaningfulFingerprint(emptyState());
    const state = emptyState();
    state.form.staffId = 'staff-noor';
    expect(isReviewDraftDirty(state, baseline)).toBe(true);
    state.form.staffId = '';
    expect(isReviewDraftDirty(state, baseline)).toBe(false);
  });
});

describe('review draft lifecycle — autosave / restore / discard', () => {
  it('autosave never creates a draft for an untouched form', () => {
    const storage = memoryStorage();
    const state = emptyState();
    const outcome = persistReviewDraft(storage, DRAFT_KEY, state, false, '2026-10-07T09:00:00Z');
    expect(outcome).toBe('cleared');
    expect(storage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('a saved draft restores exactly (form, criteria, severe errors, search)', () => {
    const storage = memoryStorage();
    const state = emptyState();
    state.form.staffId = 'staff-noor';
    state.form.reviewerNotes = 'متابعة جيدة';
    state.custSearch = 'معاذ';
    expect(persistReviewDraft(storage, DRAFT_KEY, state, true, '2026-10-07T09:01:00Z')).toBe('saved');
    const restored = JSON.parse(storage.getItem(DRAFT_KEY)!);
    expect(restored.form.staffId).toBe('staff-noor');
    expect(restored.form.reviewerNotes).toBe('متابعة جيدة');
    expect(restored.reviewState).toEqual(state.reviewState);
    expect(restored.severeErrors).toEqual(state.severeErrors);
    expect(restored.custSearch).toBe('معاذ');
    expect(restored.savedAt).toBe('2026-10-07T09:01:00Z');
    // restored unsaved work is dirty against a fresh baseline (so leaving still asks)
    expect(isReviewDraftDirty(restored, reviewMeaningfulFingerprint(emptyState()))).toBe(true);
  });

  it('discard clears the stored draft', () => {
    const storage = memoryStorage({ [DRAFT_KEY]: '{"form":{}}' });
    discardReviewDraft({ storage, draftKey: DRAFT_KEY, clearPendingTransfer: () => undefined });
    expect(storage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('discarding a pending Smart transfer means it cannot resurrect on the next visit', () => {
    const local = memoryStorage({ [DRAFT_KEY]: '{"form":{"staffId":"x"}}' });
    const session = memoryStorage({ [TRANSFER_KEY]: '{"staffName":"نور"}' });
    discardReviewDraft({
      storage: local,
      draftKey: DRAFT_KEY,
      clearPendingTransfer: () => session.removeItem(TRANSFER_KEY),
    });
    expect(local.getItem(DRAFT_KEY)).toBeNull();
    expect(session.getItem(TRANSFER_KEY)).toBeNull();
  });
});

describe('review navigation guard wiring', () => {
  const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

  it('"الانتقال بدون حفظ" runs onDiscard for dirty guards and then navigates', () => {
    const source = read('src/contexts/NavigationGuardContext.tsx');
    const discard = source.slice(source.indexOf('const handleDiscard'), source.indexOf('const handleCancel'));
    expect(discard).toMatch(/guard\.onDiscard\?\.\(\)/);
    expect(discard.indexOf('onDiscard')).toBeLessThan(discard.indexOf('completeNavigation(pendingTarget)'));
  });

  it('Reviews registers a discard handler and no longer treats default values as edits', () => {
    const source = read('src/pages/Reviews.tsx');
    expect(source).toMatch(/onDiscard: discardCurrentReview/);
    expect(source).not.toMatch(/form\.evaluationReason\.trim\(\) \|\|/);
    const discard = source.slice(source.indexOf('const discardCurrentReview'), source.indexOf('usePendingFormNavigationGuard({'));
    expect(discard).toMatch(/clearPendingTransfer: clearPendingConversationReviewTransfer/);
    expect(discard).toMatch(/setReviewBaseline/);
  });
});
