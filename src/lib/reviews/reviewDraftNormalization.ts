import {
  REVIEW_CRITERIA,
  defaultReviewState,
  defaultSevereErrors,
  type ConversationReviewState,
  type SevereErrorsState,
} from '@/lib/conversationReviews';

export const CONVERSATION_REVIEW_DRAFT_KEY = 'dawaa_conversation_review_draft_v3';

export interface ReviewDraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Old browser drafts may predate newly-added criteria or contain partially-written
 * criterion objects. Always rebuild the state from the current canonical criteria
 * list, then overlay only validated persisted values.
 */
export function normalizeConversationReviewState(value: unknown): ConversationReviewState {
  const next = defaultReviewState();
  if (!isRecord(value)) return next;

  for (const criterion of REVIEW_CRITERIA) {
    const saved = value[criterion.key];
    if (!isRecord(saved)) continue;

    const savedChoice = typeof saved.choice === 'string' ? saved.choice : '';
    const validChoice = criterion.choices.some((choice) => choice.value === savedChoice);

    next[criterion.key] = {
      applies:
        typeof saved.applies === 'boolean'
          ? saved.applies
          : next[criterion.key].applies,
      choice: validChoice ? savedChoice : next[criterion.key].choice,
      notes: typeof saved.notes === 'string' ? saved.notes : '',
    };
  }

  return next;
}

export function normalizeConversationReviewSevereErrors(value: unknown): SevereErrorsState {
  const next = defaultSevereErrors();
  if (!isRecord(value)) return next;

  for (const key of Object.keys(next) as Array<keyof SevereErrorsState>) {
    if (typeof value[key] === 'boolean') next[key] = value[key] as boolean;
  }
  return next;
}

export type ReviewDraftNormalizationResult =
  | 'missing'
  | 'unchanged'
  | 'normalized'
  | 'removed_invalid';

/**
 * Normalize the persisted draft before the Reviews route can mount. This replaces
 * the old hard-coded index.html patch with typed logic that follows REVIEW_CRITERIA,
 * so adding a criterion can never leave browser drafts structurally stale.
 */
export function normalizeStoredConversationReviewDraft(
  storage: ReviewDraftStorage
): ReviewDraftNormalizationResult {
  const raw = storage.getItem(CONVERSATION_REVIEW_DRAFT_KEY);
  if (!raw) return 'missing';

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      storage.removeItem(CONVERSATION_REVIEW_DRAFT_KEY);
      return 'removed_invalid';
    }

    const normalized = {
      ...parsed,
      reviewState: normalizeConversationReviewState(parsed.reviewState),
      severeErrors: normalizeConversationReviewSevereErrors(parsed.severeErrors),
    };
    const nextRaw = JSON.stringify(normalized);
    if (nextRaw === raw) return 'unchanged';

    storage.setItem(CONVERSATION_REVIEW_DRAFT_KEY, nextRaw);
    return 'normalized';
  } catch {
    storage.removeItem(CONVERSATION_REVIEW_DRAFT_KEY);
    return 'removed_invalid';
  }
}
