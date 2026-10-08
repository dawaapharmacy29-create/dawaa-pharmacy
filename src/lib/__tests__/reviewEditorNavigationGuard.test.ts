// Reviews editor close contract: an open editor is dirty only against its openEdit() baseline, and
// every editor-close action goes through the same navigation guard as the sidebar.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isReviewEditDirty,
  reviewEditFingerprint,
  reviewEditorCloseTarget,
  type ReviewEditSnapshot,
} from '@/lib/reviews/reviewEditorDirty';
import { resolveNavigationTarget } from '@/lib/navigationGuardTarget';
import { reviewDetailsPath } from '@/lib/reviews/reviewRouteState';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const reviews = read('src/pages/Reviews.tsx');
const guard = read('src/contexts/NavigationGuardContext.tsx');
const between = (source: string, start: string, end: string) =>
  source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

const loaded = (): ReviewEditSnapshot => ({
  form: {
    staff_id: 'staff-1',
    customer_name: 'أحمد',
    evaluation_reason: 'مراجعة عشوائية',
    reviewer_notes: '',
    manager_note: '',
  },
  reviewState: {
    greeting: { applies: true, choice: 'official_full' },
    tone: { applies: true, choice: 'good' },
  },
  severeErrors: { wrong_dose: false, rude: false },
});

const closeEditor = between(reviews, 'const closeEditor', 'const editIsVersioned');
const discardEditor = between(reviews, 'const discardEditor', 'const finishEditorClose');
const discardCurrentReview = between(
  reviews,
  'const discardCurrentReview',
  'const saveForNavigation'
);
const WRITES =
  /insertSafe|updateSafe|supabase|\.rpc\(|applyConversationReviewCorrection|logActivity|Points|ledger/;

describe('reviews editor navigation guard', () => {
  it('A: open editor, no changes -> not dirty, closes straight to the same review details', () => {
    const baseline = reviewEditFingerprint(loaded());
    expect(isReviewEditDirty(loaded(), baseline)).toBe(false);
    expect(reviewEditorCloseTarget({ correctedReviewId: null, editRouteId: 'rev-1' })).toBe(
      reviewDetailsPath('rev-1')
    );
    // an open editor by itself is never dirty
    expect(reviews).not.toMatch(/if \(editingReview\) return true/);
    expect(closeEditor).toMatch(/if \(!editDirty\) \{\s*finishEditorClose\(\);\s*return;\s*\}/);
  });

  it('B: changing any one editable field makes the editor dirty and X goes through the guard', () => {
    const baseline = reviewEditFingerprint(loaded());
    const changes: Array<(s: ReviewEditSnapshot) => void> = [
      (s) => (s.form.customer_name = 'محمد'),
      (s) => (s.form.manager_note = 'تصحيح بند الفهم'),
      (s) => ((s.reviewState as any).tone.choice = 'bad'),
      (s) => ((s.severeErrors as any).rude = true),
    ];
    for (const change of changes) {
      const next = loaded();
      change(next);
      expect(isReviewEditDirty(next, baseline)).toBe(true);
    }
    // whitespace-only edits are not meaningful
    const spaced = loaded();
    spaced.form.customer_name = '  أحمد ';
    expect(isReviewEditDirty(spaced, baseline)).toBe(false);
    // dirty X / Escape / backdrop -> the SAME guard as sidebar navigation
    expect(closeEditor).toMatch(/requestNavigation\(editorCloseTarget, \{ replace: true \}\)/);
    expect(reviews).toMatch(
      /<Modal title="تعديل تقييم المحادثة بالكامل - المدير العام" onClose=\{closeEditor\}>/
    );
    // the fingerprint covers editForm (incl. manager_note), editReviewState and editSevereErrors
    expect(reviews).toMatch(
      /\{ form: editForm, reviewState: editReviewState, severeErrors: editSevereErrors \}/
    );
  });

  it('C: dirty + cancel keeps the editor and draft exactly as-is', () => {
    // nothing is cleared before the decision: closeEditor only clears via finishEditorClose (clean)
    expect(closeEditor).not.toMatch(
      /setEditingReview|setEditForm|setEditBaseline|discardEditor\(\)/
    );
    const cancel = between(guard, 'const handleCancel', 'const value = useMemo');
    expect(cancel).not.toMatch(/onDiscard|navigate|onSave/);
  });

  it('D: dirty + discard drops the edit state and returns to the same review details', () => {
    expect(discardCurrentReview).toMatch(
      /if \(!managerReviewTarget && editDirty\) \{\s*discardEditor\(\);\s*return;\s*\}/
    );
    expect(discardEditor).toMatch(/setEditingReview\(null\);/);
    expect(discardEditor).toMatch(/correctedReviewIdRef\.current = null;/);
    // the guard discards first, then completes navigation with the lazily resolved target
    const handleDiscard = between(guard, 'const handleDiscard', 'const handleCancel');
    expect(handleDiscard.indexOf('onDiscard')).toBeLessThan(
      handleDiscard.indexOf('completeNavigation(pendingTarget)')
    );
    let corrected: string | null = null;
    const target = () =>
      reviewEditorCloseTarget({ correctedReviewId: corrected, editRouteId: 'rev-1' });
    corrected = null; // discardEditor clears it
    expect(resolveNavigationTarget(target)).toBe(reviewDetailsPath('rev-1'));
  });

  it('E: dirty + failed save keeps the editor open with the draft intact', () => {
    const save = between(guard, 'const handleSaveAndNavigate', 'const handleDiscard');
    expect(save).toMatch(/if \(!ok\) \{\s*setModalError\([^)]*\);\s*return;\s*\}/);
    expect(save.indexOf('return;', save.indexOf('if (!ok)'))).toBeLessThan(
      save.indexOf('completeNavigation(pendingTarget)', save.indexOf('if (!ok)'))
    );
    expect(reviews).toMatch(/if \(editDirty\) return saveEdit\(\);/);
    // saveEdit clears the editor only on success
    const saveEdit = between(reviews, 'const saveEdit = async', 'const openManagerReview');
    const clears = saveEdit.split('setEditingReview(null);').slice(1);
    expect(clears.length).toBe(2);
    for (const after of clears) {
      expect(after.slice(after.indexOf('return')).startsWith('return true;')).toBe(true);
    }
  });

  it('F: dirty + successful save lands on the current review (new version after a correction)', () => {
    let corrected: string | null = null;
    const target = () =>
      reviewEditorCloseTarget({ correctedReviewId: corrected, editRouteId: 'rev-old' });
    // the target is resolved only when navigation completes, i.e. after saveEdit set the new id
    corrected = 'rev-new';
    expect(resolveNavigationTarget(target)).toBe(reviewDetailsPath('rev-new'));
    expect(reviewEditorCloseTarget({ correctedReviewId: null, editRouteId: 'rev-old' })).toBe(
      reviewDetailsPath('rev-old')
    );
    // the in-editor save button closes unguarded only after a successful save
    expect(reviews).toMatch(/if \(await saveEdit\(\)\) finishEditorClose\(\);/);
    // the guard keeps a function target in a ref (not a state updater) and resolves it at completion
    expect(guard).toMatch(
      /pendingRef = useRef<\{ target: NavigationTarget; replace: boolean \} \| null>/
    );
    expect(guard).toMatch(/const path = resolveNavigationTarget\(target\);/);
  });

  it('G: sidebar navigation to Customers from a dirty editor hits the same prompt', () => {
    expect(reviews).toMatch(/if \(editDirty\) return true;/);
    expect(reviews).toMatch(/isDirty: reviewIsDirty/);
    const sidebar = read('src/components/layout/SidebarBase.tsx');
    expect(sidebar).toMatch(
      /guard\?\.hasActiveDirtyGuard\(\)\) \{ event\.preventDefault\(\); guard\.requestNavigation\(item\.path\)/
    );
    expect(resolveNavigationTarget('/customers')).toBe('/customers');
  });

  it('H: returning to the same review after discard does not resurrect the draft', () => {
    // no baseline (closed editor) is never dirty, and a reopen re-baselines from the loaded row
    const edited = loaded();
    edited.form.customer_name = 'محمد';
    expect(isReviewEditDirty(edited, null)).toBe(false);
    expect(isReviewEditDirty(loaded(), reviewEditFingerprint(loaded()))).toBe(false);
    expect(discardEditor).toMatch(/setEditBaseline\(null\);/);
    // the edit route reloads the row from the database; the edit draft is never persisted
    expect(reviews).toMatch(/setEditBaseline\(\s*reviewEditFingerprint\(\{\s*form: nextForm,/);
    expect(reviews).not.toMatch(/localStorage\.setItem\([^)]*edit/i);
  });

  it('I: the route/remount fix stays: the edit route loads by id once, close never hits /reviews', () => {
    expect(reviews).toMatch(/\}, \[editRouteId\]\);/);
    expect(reviews).toMatch(/editRouteOpenedRef\.current === editRouteId/);
    expect(reviewEditorCloseTarget({ correctedReviewId: null, editRouteId: null })).toBeNull();
    expect(resolveNavigationTarget(() => null)).toBeNull();
  });

  it('J: discard performs no review or points write', () => {
    expect(discardEditor).not.toMatch(WRITES);
    expect(discardCurrentReview).not.toMatch(WRITES);
  });
});
