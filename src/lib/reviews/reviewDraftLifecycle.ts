// New-review draft lifecycle (Reviews page, mode=new) — pure rules, unit-testable.
//
// * Baseline-based dirty tracking: a form is dirty only when its meaningful state differs from the
//   baseline captured when the review was opened. Defaults (e.g. evaluationReason = "مراجعة عشوائية",
//   the auto-filled conversation date, the reviewer id) never make an untouched form dirty.
// * Autosave: a draft is written only for a dirty form; returning to the baseline removes it.
// * Discard: clears the stored draft AND any pending Smart transfer, so neither can resurrect the
//   discarded review on the next visit or on browser back to ?fromSmart=1.

export interface ReviewEditableState<Form extends Record<string, unknown> = Record<string, unknown>> {
  form: Form;
  reviewState: unknown;
  severeErrors: unknown;
  custSearch: string;
}

/** Fields that identify the session/actor, not the reviewer's input. */
const NON_MEANINGFUL_FORM_FIELDS = new Set(['reviewerId']);

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
}

export function reviewMeaningfulFingerprint(state: ReviewEditableState): string {
  const form: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state.form || {})) {
    if (NON_MEANINGFUL_FORM_FIELDS.has(key)) continue;
    form[key] = typeof value === 'string' ? value.trim() : value;
  }
  return stable({
    form,
    reviewState: state.reviewState,
    severeErrors: state.severeErrors,
    custSearch: String(state.custSearch || '').trim(),
  });
}

export function isReviewDraftDirty(state: ReviewEditableState, baselineFingerprint: string): boolean {
  return reviewMeaningfulFingerprint(state) !== baselineFingerprint;
}

export interface ReviewDraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Autosave decision: save a dirty form, remove a stored draft once the form is back to baseline. */
export function persistReviewDraft(
  storage: ReviewDraftStorage,
  key: string,
  state: ReviewEditableState,
  dirty: boolean,
  savedAt: string
): 'saved' | 'cleared' {
  if (!dirty) {
    storage.removeItem(key);
    return 'cleared';
  }
  storage.setItem(key, JSON.stringify({ ...state, savedAt }));
  return 'saved';
}

/** Discard: draft and pending Smart transfer are both gone; the caller then resets state + navigates. */
export function discardReviewDraft(input: {
  storage: ReviewDraftStorage;
  draftKey: string;
  clearPendingTransfer: () => void;
}) {
  input.storage.removeItem(input.draftKey);
  input.clearPendingTransfer();
}
