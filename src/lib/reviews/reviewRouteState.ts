// Reviews route contract (/reviews?...) — pure rules, unit-testable.
//
// * The URL `id` is the stable identity of the review being viewed or edited. Editing a draft is
//   never "close current review": opening the editor keeps (or sets) `mode=edit&id=<id>`, and no
//   field edit, autosave or refetch rewrites the URL.
// * The Reviews form component key depends only on the route kind + review id, so it cannot change
//   while the same review stays open (no remount from saves, timestamps or list refetches).
// * A list refetch re-selects by stable review id only, and never on the edit route (where the
//   editor, not a details modal, owns the selection).

export type ReviewsRouteKind = 'evidence' | 'history-detail' | 'history' | 'edit' | 'new' | 'main';

export interface ReviewsRoute {
  kind: ReviewsRouteKind;
  /** Trimmed `id` search param ('' when absent). */
  reviewId: string;
  /** `fromSmart=1` handoff from the Smart Folder watcher (meaningful on the `new` route). */
  fromSmart: boolean;
}

export function parseReviewsRoute(search: string | URLSearchParams): ReviewsRoute {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const mode = params.get('mode') || '';
  const history = params.get('section') === 'history';
  const reviewId = String(params.get('id') || '').trim();
  const fromSmart = params.get('fromSmart') === '1';
  let kind: ReviewsRouteKind = 'main';
  if (mode === 'evidence') kind = 'evidence';
  else if (mode === 'edit') kind = 'edit';
  else if (history && reviewId) kind = 'history-detail';
  else if (history) kind = 'history';
  else if (mode === 'new') kind = 'new';
  return { kind, reviewId, fromSmart };
}

/** Key of the Reviews form component: stable for the whole lifetime of one opened review. */
export function reviewsFormKey(route: ReviewsRoute): string {
  return route.kind === 'edit' && route.reviewId
    ? `reviews-edit-${route.reviewId}`
    : 'reviews-main';
}

/** The review the editor must open on this route ('' = none). */
export function editRouteReviewId(route: ReviewsRoute): string {
  return route.kind === 'edit' ? route.reviewId : '';
}

/**
 * The review a details deep-link (`?id=`) should open as a details modal. The edit route opens the
 * editor instead, so it never yields a details selection.
 */
export function detailsDeepLinkReviewId(route: ReviewsRoute): string {
  return route.kind === 'edit' ? '' : route.reviewId;
}

/** After a list refetch: the row to keep selected, matched by stable id (never by list position). */
export function reselectReviewById<Row extends { id?: string | null }>(
  rows: readonly Row[],
  route: ReviewsRoute
): { apply: false } | { apply: true; row: Row | null } {
  const id = detailsDeepLinkReviewId(route);
  if (!id) return { apply: false };
  return { apply: true, row: rows.find((row) => row.id === id) ?? null };
}

export function reviewEditPath(reviewId: string): string {
  return `/reviews?mode=edit&id=${encodeURIComponent(reviewId)}`;
}

export function reviewDetailsPath(reviewId: string): string {
  return `/reviews?section=history&id=${encodeURIComponent(reviewId)}`;
}
