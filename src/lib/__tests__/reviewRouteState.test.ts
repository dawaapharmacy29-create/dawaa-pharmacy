// Reviews route contract: editing a review is never "close current review". The URL id is the
// stable identity of the review being edited, the form key never changes while it stays open, and
// list refetches re-select by id (never on the edit route).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  detailsDeepLinkReviewId,
  editRouteReviewId,
  parseReviewsRoute,
  reselectReviewById,
  reviewDetailsPath,
  reviewEditPath,
  reviewsFormKey,
} from '@/lib/reviews/reviewRouteState';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('reviews route state', () => {
  it('parses every Reviews route kind', () => {
    expect(parseReviewsRoute('').kind).toBe('main');
    expect(parseReviewsRoute('?mode=new').kind).toBe('new');
    expect(parseReviewsRoute('?mode=new&fromSmart=1')).toEqual({
      kind: 'new',
      reviewId: '',
      fromSmart: true,
    });
    expect(parseReviewsRoute('?mode=edit&id=rev-1')).toEqual({
      kind: 'edit',
      reviewId: 'rev-1',
      fromSmart: false,
    });
    expect(parseReviewsRoute('?section=history').kind).toBe('history');
    expect(parseReviewsRoute('?section=history&id=rev-1').kind).toBe('history-detail');
    expect(parseReviewsRoute('?mode=evidence').kind).toBe('evidence');
    // edit wins over section=history (same as the previous ReviewsEnhanced branching)
    expect(parseReviewsRoute('?section=history&mode=edit&id=rev-1').kind).toBe('edit');
  });

  it('A/B: the form key is stable for one opened review, whatever is edited', () => {
    const opened = reviewsFormKey(parseReviewsRoute(reviewEditPath('rev-1').split('?')[1]));
    expect(opened).toBe('reviews-edit-rev-1');
    // consecutive edits/saves never touch the URL, so the key is recomputed from the same route
    for (let i = 0; i < 3; i++) {
      expect(reviewsFormKey(parseReviewsRoute('?mode=edit&id=rev-1'))).toBe(opened);
    }
    // the root cause: stripping ?id= from the edit route changed the key -> full remount
    expect(reviewsFormKey(parseReviewsRoute('?mode=edit'))).toBe('reviews-main');
  });

  it('the edit route opens the editor and never a details modal', () => {
    const route = parseReviewsRoute('?mode=edit&id=rev-1');
    expect(editRouteReviewId(route)).toBe('rev-1');
    expect(detailsDeepLinkReviewId(route)).toBe('');
    const deepLink = parseReviewsRoute('?id=rev-9');
    expect(editRouteReviewId(deepLink)).toBe('');
    expect(detailsDeepLinkReviewId(deepLink)).toBe('rev-9');
  });

  it('E: a refetch re-selects by stable id, not list position', () => {
    const before = [{ id: 'rev-1' }, { id: 'rev-2' }, { id: 'rev-3' }];
    const refetched = [{ id: 'rev-new' }, { id: 'rev-3' }, { id: 'rev-1' }, { id: 'rev-2' }];
    const route = parseReviewsRoute('?id=rev-2');
    const first = reselectReviewById(before, route);
    const second = reselectReviewById(refetched, route);
    expect(first).toEqual({ apply: true, row: { id: 'rev-2' } });
    expect(second).toEqual({ apply: true, row: { id: 'rev-2' } });
    expect(reselectReviewById(refetched, parseReviewsRoute('?id=gone'))).toEqual({
      apply: true,
      row: null,
    });
  });

  it('E: a refetch never changes the selection on the edit route or without an id', () => {
    expect(reselectReviewById([{ id: 'rev-1' }], parseReviewsRoute('?mode=edit&id=rev-1'))).toEqual(
      { apply: false }
    );
    expect(
      reselectReviewById([{ id: 'rev-1' }], parseReviewsRoute('?mode=new&fromSmart=1'))
    ).toEqual({ apply: false });
  });

  it('paths encode the review id', () => {
    expect(reviewEditPath('a b')).toBe('/reviews?mode=edit&id=a%20b');
    expect(reviewDetailsPath('rev-1')).toBe('/reviews?section=history&id=rev-1');
  });
});

describe('reviews route wiring (source contract)', () => {
  const reviews = read('src/pages/Reviews.tsx');
  const enhanced = read('src/pages/ReviewsEnhanced.tsx');

  it('ReviewsEnhanced keys the form only by route kind + review id', () => {
    expect(enhanced).toMatch(/<Reviews key=\{reviewsFormKey\(route\)\} \/>/);
  });

  it('opening the editor from a details modal moves to the edit route instead of stripping ?id=', () => {
    const onEdit = reviews.slice(
      reviews.indexOf('onEdit={() => {'),
      reviews.indexOf('onManagerReview={() => {')
    );
    expect(onEdit).toMatch(/navigate\(reviewEditPath\(reviewId\)\)/);
    // closeSelectedReview (which deletes ?id=) is only the legacy path for a row without an id
    expect(onEdit.indexOf('closeSelectedReview()')).toBeLessThan(onEdit.indexOf('return;'));
  });

  it('the edit route loads the editor by id once, keyed on the id string only', () => {
    expect(reviews).toMatch(/\}, \[editRouteId\]\);/);
    expect(reviews).toMatch(/editRouteOpenedRef\.current === editRouteId/);
  });

  it('refetch re-selection goes through reselectReviewById (stable id, edit route excluded)', () => {
    expect(reviews).toMatch(
      /reselectReviewById\(rows, parseReviewsRoute\(window\.location\.search\)\)/
    );
    expect(reviews).not.toMatch(/rows\.find\(\(row\) => row\.id === id\)/);
  });

  it('C/D: save and autosave paths never navigate to the Reviews root', () => {
    const saveEdit = reviews.slice(
      reviews.indexOf('const saveEdit = async'),
      reviews.indexOf('const openManagerReview')
    );
    const autosave = reviews.slice(
      reviews.indexOf('// Autosave only real'),
      reviews.indexOf('const setCriterionApplies')
    );
    for (const block of [saveEdit, autosave]) {
      expect(block).not.toMatch(/navigate\(/);
      expect(block).not.toMatch(/setSearchParams\(/);
    }
    // closing the editor returns to the same review, not to /reviews
    const closeEditor = reviews.slice(
      reviews.indexOf('const editorCloseTarget'),
      reviews.indexOf('const editIsVersioned')
    );
    // S: still the same review's details, never /reviews. After a successful manager correction the
    // target is the NEW current version id (correctedReviewIdRef), which defaults to editRouteId.
    expect(closeEditor).toMatch(
      /reviewEditorCloseTarget\(\{ correctedReviewId: correctedReviewIdRef\.current, editRouteId \}\)/
    );
    expect(closeEditor).toMatch(/if \(target\) navigate\(target, \{ replace: true \}\)/);
    expect(closeEditor).toMatch(/requestNavigation\(editorCloseTarget, \{ replace: true \}\)/);
    expect(closeEditor).not.toMatch(/navigate\('\/reviews'/);
  });

  it('I: the Smart Folder handoff still keys on mode=new&fromSmart=1', () => {
    expect(reviews).toMatch(/!newOnlyMode \|\| searchParams\.get\('fromSmart'\) !== '1'/);
    expect(read('src/pages/WhatsAppSmartFolderWatcher.tsx')).toMatch(
      /navigate\('\/reviews\?mode=new&fromSmart=1'\)/
    );
  });
});
