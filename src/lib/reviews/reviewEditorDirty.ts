// Manager review editor (Reviews page, mode=edit) — dirty tracking and close target, pure rules.
//
// * An open editor is NOT dirty by itself: it is dirty only when its meaningful state differs from
//   the baseline captured when openEdit() loaded the review.
// * Every editor-close path (X / Escape / backdrop) returns to the details of the same review, or —
//   only after a versioned correction SUCCEEDED — of the new current version that replaced it.

import { reviewDetailsPath } from './reviewRouteState';

export interface ReviewEditSnapshot {
  /** editForm, including the editable manager correction reason (manager_note). */
  form: Record<string, unknown>;
  /** editReviewState */
  reviewState: unknown;
  /** editSevereErrors */
  severeErrors: unknown;
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
}

export function reviewEditFingerprint(snapshot: ReviewEditSnapshot): string {
  const form: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(snapshot.form || {})) {
    form[key] = typeof value === 'string' ? value.trim() : value;
  }
  return stable({ form, reviewState: snapshot.reviewState, severeErrors: snapshot.severeErrors });
}

/** No baseline (editor not loaded / closed) is never dirty. */
export function isReviewEditDirty(snapshot: ReviewEditSnapshot, baseline: string | null): boolean {
  if (baseline == null) return false;
  return reviewEditFingerprint(snapshot) !== baseline;
}

/** Where closing the editor goes; null = the editor was not opened from the edit route (stay put). */
export function reviewEditorCloseTarget(input: {
  correctedReviewId: string | null;
  editRouteId: string | null;
}): string | null {
  const currentReviewId = input.correctedReviewId ?? input.editRouteId;
  if (!input.editRouteId || !currentReviewId) return null;
  return reviewDetailsPath(currentReviewId);
}
