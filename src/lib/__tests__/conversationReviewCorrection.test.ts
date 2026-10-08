import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  CONVERSATION_REVIEW_CORRECTION_COMMAND,
  buildConversationReviewCorrection,
  conversationReviewKindLabel,
  correctConversationReviewVersion,
  correctionErrorMessage,
  isVersionedConversationReview,
  newCorrectionIdempotencyKey,
} from '@/lib/reviews/conversationReviewCorrection';

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const reviews = read('src/pages/Reviews.tsx');
const migration = read(
  'supabase/migrations/20261008160000_conversation_review_manager_correction_versioning_v1.sql'
);

function rpcClient(result: { data?: unknown; error?: unknown }) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    client: {
      rpc(fn: string, args: Record<string, unknown>) {
        calls.push({ fn, args });
        return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
      },
    },
  };
}

const payload = {
  final_score: 85,
  doctor_points_impact: -3,
  review_items: [{ key: 'greeting' }],
  raw_scores: { criteria: {} },
  // provenance / identity fields the editor also computes — these must never be sent
  whatsapp_review_source_id: 'src-1',
  sales_intelligence_case_id: 'case-1',
  customer_name: 'عميل',
  branch: 'فرع',
  conversation_date: '2026-10-01T10:00:00.000Z',
  manager_review_notes: 'سبب',
  staff_name: 'دكتور',
  month_cycle: '2026-10',
};

describe('manager correction = versioning, not overwrite (A/B/E/F/O/P/R/S)', () => {
  it('A: only automatic reviews and earlier corrections go through the versioning command', () => {
    expect(isVersionedConversationReview({ evaluation_kind: 'automatic' })).toBe(true);
    expect(isVersionedConversationReview({ evaluation_kind: ' Manager_Correction ' })).toBe(true);
    expect(isVersionedConversationReview({ evaluation_kind: 'واتساب' })).toBe(false);
    expect(isVersionedConversationReview(null)).toBe(false);
  });

  it('A: the correction payload carries evaluation + staff only, never provenance or identity', () => {
    const correction = buildConversationReviewCorrection(payload, 'staff-1');
    expect(correction.staff_id).toBe('staff-1');
    expect(correction.final_score).toBe(85);
    expect(correction.doctor_points_impact).toBe(-3);
    expect(correction.review_items).toEqual([{ key: 'greeting' }]);
    for (const forbidden of [
      'whatsapp_review_source_id',
      'sales_intelligence_case_id',
      'customer_name',
      'branch',
      'conversation_date',
      'manager_review_notes',
      'staff_name',
      'month_cycle',
    ]) {
      expect(Object.prototype.hasOwnProperty.call(correction, forbidden)).toBe(false);
    }
  });

  it('A: the browser never writes the review row or the points ledger on the versioned path', () => {
    const { calls, client } = rpcClient({
      data: { status: 'created', review_id: '11111111-1111-4111-8111-111111111111', superseded_review_id: 'r-old' },
    });
    return correctConversationReviewVersion(
      { reviewId: 'r-old', idempotencyKey: 'k1', reason: ' سبب ', correction: { staff_id: 's' } },
      { client, getSessionToken: () => 'tok' }
    ).then((result) => {
      expect(result).toMatchObject({
        ok: true,
        status: 'created',
        currentReviewId: '11111111-1111-4111-8111-111111111111',
        supersededReviewId: 'r-old',
      });
      expect(calls).toHaveLength(1);
      expect(calls[0].fn).toBe(CONVERSATION_REVIEW_CORRECTION_COMMAND);
      expect(calls[0].args).toMatchObject({
        p_session_token: 'tok',
        p_review_id: 'r-old',
        p_idempotency_key: 'k1',
        p_reason: 'سبب',
      });
    });
  });

  it('G: with no staff session the command is never called', async () => {
    const { calls, client } = rpcClient({ data: null });
    const result = await correctConversationReviewVersion(
      { reviewId: 'r', idempotencyKey: 'k', reason: 'سبب', correction: {} },
      { client, getSessionToken: () => null }
    );
    expect(result).toMatchObject({ ok: false, error: 'staff_session_required' });
    expect(calls).toHaveLength(0);
  });

  it('J: an empty manager reason never reaches the server', async () => {
    const { calls, client } = rpcClient({ data: null });
    const result = await correctConversationReviewVersion(
      { reviewId: 'r', idempotencyKey: 'k', reason: '   ', correction: {} },
      { client, getSessionToken: () => 'tok' }
    );
    expect(result).toMatchObject({ ok: false, error: 'correction_reason_required' });
    expect(calls).toHaveLength(0);
  });

  it('F/P: a stale editor is pointed at the version that replaced its review', async () => {
    const { client } = rpcClient({
      error: {
        message: 'review_version_not_current',
        details: '22222222-2222-4222-8222-222222222222',
      },
    });
    const result = await correctConversationReviewVersion(
      { reviewId: 'r-old', idempotencyKey: 'k', reason: 'سبب', correction: {} },
      { client, getSessionToken: () => 'tok' }
    );
    expect(result).toMatchObject({
      ok: false,
      currentReviewId: '22222222-2222-4222-8222-222222222222',
    });
    expect(correctionErrorMessage(String(result.error))).toContain('نسخة أحدث');
  });

  it('M/N: a failed correction reports that nothing was saved', () => {
    expect(correctionErrorMessage('conversation_review_points_require_official_review')).toContain(
      'لم يتم حفظ أي تغيير'
    );
    expect(correctionErrorMessage('boom')).toContain('لم يتم حفظ أي تغيير');
  });

  it('F: idempotency keys are RFC4122 v4 and unique per attempt', () => {
    const a = newCorrectionIdempotencyKey();
    const b = newCorrectionIdempotencyKey();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(a).not.toBe(b);
  });

  it('E: a correction version is labelled as such in the reviews list and details', () => {
    expect(conversationReviewKindLabel({ evaluation_kind: 'manager_correction', conversation_type: 'واتساب' })).toBe(
      'تصحيح إداري · واتساب'
    );
    expect(conversationReviewKindLabel({ evaluation_kind: 'واتساب' })).toBe('واتساب');
    expect(reviews).toMatch(/conversationReviewKindLabel\(row\)/);
  });

  it('A: saveEdit sends a versioned review through the command and never through updateSafe', () => {
    const saveEdit = reviews.slice(
      reviews.indexOf('const saveEdit = async'),
      reviews.indexOf('const openManagerReview')
    );
    const versionedBranch = saveEdit.slice(
      saveEdit.indexOf('if (isVersionedConversationReview(editingReview))'),
      saveEdit.indexOf("await updateSafe('conversation_sales_reviews'")
    );
    expect(versionedBranch).toMatch(/correctConversationReviewVersion\(/);
    expect(versionedBranch).not.toMatch(/updateSafe\(/);
    expect(versionedBranch).not.toMatch(/persistManagerAdjustment\(/);
    expect(versionedBranch).not.toMatch(/persistPointsTransaction\(/);
    // the command runs before any direct review UPDATE in the same function
    expect(saveEdit.indexOf('correctConversationReviewVersion(')).toBeLessThan(
      saveEdit.indexOf("await updateSafe('conversation_sales_reviews'")
    );
  });

  it('K/L/M: the versioned branch never reconciles points in the browser', () => {
    const saveEdit = reviews.slice(
      reviews.indexOf('const saveEdit = async'),
      reviews.indexOf('const openManagerReview')
    );
    const versionedBranch = saveEdit.slice(
      saveEdit.indexOf('if (isVersionedConversationReview(editingReview))'),
      saveEdit.indexOf("await updateSafe('conversation_sales_reviews'")
    );
    expect(versionedBranch).not.toMatch(/record_conversation_review_points_v1/);
    expect(versionedBranch).not.toMatch(/employee_transactions/);
  });

  it('O/S: a failed correction returns false without navigating (editor and route stay put)', () => {
    const saveEdit = reviews.slice(
      reviews.indexOf('const saveEdit = async'),
      reviews.indexOf('const openManagerReview')
    );
    expect(saveEdit).not.toMatch(/navigate\(/);
    expect(saveEdit).not.toMatch(/setSearchParams\(/);
    expect(saveEdit).toMatch(/if \(!corrected\.ok\) \{\s*toast\.error\(correctionErrorMessage\(corrected\.error\)\);\s*return false;/);
  });

  it('P: only a succeeded correction moves the editor to the new current review id', () => {
    expect(reviews).toMatch(/correctedReviewIdRef\.current = corrected\.currentReviewId;/);
    const closeEditor = reviews.slice(
      reviews.indexOf('const closeEditor'),
      reviews.indexOf('const editIsVersioned')
    );
    expect(closeEditor).toMatch(/correctedReviewIdRef\.current \?\? editRouteId/);
    expect(closeEditor).toMatch(/navigate\(reviewDetailsPath\(currentReviewId\), \{ replace: true \}\)/);
    // the correction id is cleared on every editor open, so a later close cannot reuse it
    expect(reviews).toMatch(/correctedReviewIdRef\.current = null;\s*setEditingReview\(fullRow\);/);
  });

  it('F: the idempotency key is created once per review and reused on retry', () => {
    expect(reviews).toMatch(/if \(correctionAttemptRef\.current\?\.reviewId !== editingReview\.id\)/);
    expect(reviews).toMatch(/correctionAttemptRef\.current = null;\s*correctedReviewIdRef\.current = corrected\.currentReviewId;/);
  });

  it('A: provenance and identity fields are read-only in the editor for a versioned review', () => {
    const editor = reviews.slice(
      reviews.indexOf('{editingReview && ('),
      reviews.indexOf('<div className="section-title text-sm">بنود التقييم كاملة</div>')
    );
    expect(editor.match(/disabled=\{editIsVersioned\}/g) ?? []).toHaveLength(11);
  });

  it('R: the migration touches no SI v22 / Story V16 / Evidence V17 object', () => {
    for (const other of [
      'whatsapp_customer_cases_v22',
      'whatsapp_sales_opportunities_v17',
      'whatsapp_evidence_facts_v17',
      'whatsapp_story_events',
      'whatsapp_customer_journeys',
      'dawaa_link_whatsapp_evidence_journey',
      'sales_intelligence_reconcile_case_set_v1',
      'dawaa_supersede_legacy_review_on_automatic_v2',
    ]) {
      expect(migration.replace(/--[^\n]*/g, '')).not.toContain(other);
    }
  });

  it('A: the migration never weakens the automatic-evidence guard or grants the browser privilege', () => {
    const sql = migration.replace(/--[^\n]*/g, '');
    expect(sql).toContain('automatic_conversation_review_evidence_is_immutable_for_client');
    expect(sql).toContain('automatic_conversation_review_is_system_owned');
    expect(sql).toContain('conversation_review_correction_is_command_owned');
    expect(sql).not.toMatch(/drop\s+trigger\s+if\s+exists\s+zzzz_automatic_conversation_review_writer_guard_v2/i);
    expect(sql).not.toMatch(/grant\s+(update|insert|all)[^;]*on\s+table?\s*public\.conversation_sales_reviews/i);
    // the command authenticates the staff session only
    expect(sql).not.toMatch(/auth\.uid\(\)/);
    expect(sql).not.toMatch(/x-dawaa-user-id/);
  });
});
