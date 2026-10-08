import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  CONVERSATION_REVIEW_CORRECTION_COMMAND,
  CORRECTION_EVALUATION_KEYS,
  buildConversationReviewCorrection,
  conversationReviewKindLabel,
  correctConversationReviewVersion,
  correctionErrorMessage,
  isVersionedConversationReview,
  newCorrectionIdempotencyKey,
} from '@/lib/reviews/conversationReviewCorrection';
import {
  DERIVED_EVALUATION_FLAG_COLUMNS,
  deriveConversationReviewEvaluationFlags,
} from '@/lib/reviews/conversationReviewEvaluationColumns';
import {
  defaultReviewState,
  defaultSevereErrors,
  evaluateConversationReview,
  type ConversationReviewState,
  type SevereErrorsState,
} from '@/lib/conversationReviews';

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
      data: {
        status: 'created',
        review_id: '11111111-1111-4111-8111-111111111111',
        superseded_review_id: 'r-old',
      },
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
    expect(
      conversationReviewKindLabel({
        evaluation_kind: 'manager_correction',
        conversation_type: 'واتساب',
      })
    ).toBe('تصحيح إداري · واتساب');
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
    expect(saveEdit).toMatch(
      /if \(!corrected\.ok\) \{\s*toast\.error\(correctionErrorMessage\(corrected\.error\)\);\s*return false;/
    );
  });

  it('P: only a succeeded correction moves the editor to the new current review id', () => {
    expect(reviews).toMatch(/correctedReviewIdRef\.current = corrected\.currentReviewId;/);
    const closeEditor = reviews.slice(
      reviews.indexOf('const closeEditor'),
      reviews.indexOf('const editIsVersioned')
    );
    expect(closeEditor).toMatch(/correctedReviewIdRef\.current \?\? editRouteId/);
    expect(closeEditor).toMatch(
      /navigate\(reviewDetailsPath\(currentReviewId\), \{ replace: true \}\)/
    );
    // the correction id is cleared on every editor open, so a later close cannot reuse it
    expect(reviews).toMatch(/correctedReviewIdRef\.current = null;\s*setEditingReview\(fullRow\);/);
  });

  it('F: the idempotency key is created once per review and reused on retry', () => {
    expect(reviews).toMatch(
      /if \(correctionAttemptRef\.current\?\.reviewId !== editingReview\.id\)/
    );
    expect(reviews).toMatch(
      /correctionAttemptRef\.current = null;\s*correctedReviewIdRef\.current = corrected\.currentReviewId;/
    );
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
    expect(sql).not.toMatch(
      /drop\s+trigger\s+if\s+exists\s+zzzz_automatic_conversation_review_writer_guard_v2/i
    );
    expect(sql).not.toMatch(
      /grant\s+(update|insert|all)[^;]*on\s+table?\s*public\.conversation_sales_reviews/i
    );
    // the command authenticates the staff session only (the hardened points bridge below keeps its
    // live downstream request.headers hand-off to v4, which is not an authentication input)
    expect(sql).not.toMatch(/auth\.uid\(\)/);
    const command = sql.slice(
      sql.indexOf('create or replace function public.dawaa_correct_conversation_review_session_v1'),
      sql.indexOf('revoke all on function public.dawaa_correct_conversation_review_session_v1')
    );
    expect(command).not.toMatch(/x-dawaa-user-id|request\.headers/);
  });
});

const sqlNoComments = migration.replace(/--[^\n]*/g, '');

function migrationEvalKeys() {
  const block = sqlNoComments.match(/v_eval_keys text\[\] := array\[([\s\S]*?)\];/);
  expect(block).not.toBeNull();
  return Array.from(block![1].matchAll(/'([a-z_]+)'/g), (m) => m[1]);
}

function state(
  patch: Partial<Record<keyof ConversationReviewState, { applies: boolean; choice: string }>>
) {
  return { ...defaultReviewState(), ...patch } as ConversationReviewState;
}
function severe(patch: Partial<SevereErrorsState>) {
  return { ...defaultSevereErrors(), ...patch } as SevereErrorsState;
}
function flags(criteria: ConversationReviewState, severeErrors: SevereErrorsState) {
  const result = evaluateConversationReview(criteria, severeErrors, '');
  return deriveConversationReviewEvaluationFlags(criteria, severeErrors, result.reviewItems);
}

describe('fix A: staff reassignment never moves the conversation branch', () => {
  it('selecting a staff member keeps the source branch for a versioned review', () => {
    const select = reviews.slice(
      reviews.indexOf('<Field label="الدكتور / الموظف">'),
      reviews.indexOf('<Field label="اسم الدكتور الظاهر">')
    );
    expect(select).toMatch(
      /branch: editIsVersioned \? f\.branch : selected\?\.branch \|\| f\.branch,/
    );
    expect(select).not.toMatch(/^\s*branch: selected\?\.branch \|\| f\.branch,/m);
  });

  it('the command binds the correction branch to the superseded version, never the staff branch', () => {
    expect(sqlNoComments).toMatch(/'branch', v_old\.branch,\s*'branch_id', v_old\.branch_id,/);
    expect(sqlNoComments).not.toMatch(/'branch',\s*v_staff\.branch/);
    // the staff branch is only an authorization scope input
    expect(sqlNoComments).toMatch(
      /dawaa_can_read_conversation_review_row_v2\(v_account\.id,null::uuid,null::uuid,v_staff\.branch,null::uuid\)/
    );
    expect(
      Object.prototype.hasOwnProperty.call(
        buildConversationReviewCorrection({ branch: 'B' }, 's'),
        'branch'
      )
    ).toBe(false);
  });
});

describe('fix B: a correction carries no stale derived field', () => {
  it('the client whitelist equals the command whitelist and contains every derived flag column', () => {
    expect([...CORRECTION_EVALUATION_KEYS].sort()).toEqual(migrationEvalKeys().sort());
    expect(new Set(CORRECTION_EVALUATION_KEYS).size).toBe(CORRECTION_EVALUATION_KEYS.length);
    for (const column of [
      ...DERIVED_EVALUATION_FLAG_COLUMNS,
      'has_complaint',
      'has_medical_error',
      'has_invoice_error',
      'has_delivery_issue',
      'severe_bad_tone_flag',
      'bad_alternative_flag',
      'rushed_response_flag',
      'misunderstood_customer_flag',
    ])
      expect(CORRECTION_EVALUATION_KEYS).toContain(column);
    expect(CORRECTION_EVALUATION_KEYS).toHaveLength(61);
  });

  it('every whitelisted key is sent, undefined as null (the command rejects missing keys)', () => {
    const correction = buildConversationReviewCorrection(
      { final_score: 70, repeated_error_type: undefined },
      's'
    );
    for (const key of CORRECTION_EVALUATION_KEYS)
      expect(Object.prototype.hasOwnProperty.call(correction, key)).toBe(true);
    expect(correction.repeated_error_type).toBeNull();
    expect(JSON.parse(JSON.stringify(correction))).toHaveProperty('repeated_error_type', null);
    expect(sqlNoComments).toContain("raise exception 'correction_payload_missing_field:%'");
    expect(sqlNoComments).toContain("raise exception 'correction_payload_inconsistent:%'");
  });

  it('the editor payload builds every evaluation column from the same recalculation', () => {
    const saveEdit = reviews.slice(
      reviews.indexOf('const saveEdit = async'),
      reviews.indexOf('const openManagerReview')
    );
    const payloadBlock = saveEdit.slice(
      saveEdit.indexOf('const payload = {'),
      saveEdit.indexOf('if (isVersionedConversationReview(editingReview))')
    );
    const explicit = new Set(Array.from(payloadBlock.matchAll(/^ {8}([a-z_]+):/gm), (m) => m[1]));
    expect(payloadBlock).toMatch(/\.\.\.evaluationFlags,/);
    expect(saveEdit).toMatch(
      /deriveConversationReviewEvaluationFlags\(\s*editReviewState,\s*editSevereErrors,\s*recalculated\.reviewItems\s*\)/
    );
    // the flags come only from the derivation, never inline
    for (const flag of DERIVED_EVALUATION_FLAG_COLUMNS) expect(explicit.has(flag)).toBe(false);
    for (const key of CORRECTION_EVALUATION_KEYS) {
      expect(
        explicit.has(key) || (DERIVED_EVALUATION_FLAG_COLUMNS as readonly string[]).includes(key)
      ).toBe(true);
    }
    // a versioned correction derives follow_up_promised strictly from its criteria
    expect(saveEdit).toMatch(/const evaluationFlags = editIsVersioned\s*\?\s*derivedFlags/);
  });

  it('medical_error on and off', () => {
    expect(flags(state({}), severe({ medical_error: true })).has_medical_error).toBe(true);
    expect(flags(state({}), severe({})).has_medical_error).toBe(false);
  });

  it('invoice_error and delivery_error', () => {
    const f = flags(state({}), severe({ invoice_error: true, delivery_error: true }));
    expect(f.has_invoice_error).toBe(true);
    expect(f.has_delivery_issue).toBe(true);
    expect(flags(state({}), severe({})).has_invoice_error).toBe(false);
  });

  it('complaint and tone flags', () => {
    expect(
      flags(state({ angry_customer: { applies: true, choice: 'calm' } }), severe({})).has_complaint
    ).toBe(true);
    expect(flags(state({}), severe({ insult: true })).has_complaint).toBe(true);
    const bad = flags(state({ tone: { applies: true, choice: 'bad' } }), severe({}));
    expect([bad.bad_tone_flag, bad.severe_bad_tone_flag]).toEqual([true, false]);
    const insult = flags(state({ tone: { applies: true, choice: 'insult' } }), severe({}));
    expect([insult.bad_tone_flag, insult.severe_bad_tone_flag]).toEqual([true, true]);
    const notApplying = flags(state({ tone: { applies: false, choice: 'insult' } }), severe({}));
    expect([notApplying.bad_tone_flag, notApplying.severe_bad_tone_flag]).toEqual([false, false]);
  });

  it('alternative, understanding, closing and follow-up flags', () => {
    const f = flags(
      state({
        unavailable_items: { applies: true, choice: 'bad_alternative' },
        understanding: { applies: true, choice: 'rushed' },
        closing_message: { applies: true, choice: 'official' },
        followup_after_wait: { applies: true, choice: 'done' },
      }),
      severe({})
    );
    expect(
      f.bad_alternative_flag &&
        f.rushed_response_flag &&
        f.closing_message_used &&
        f.follow_up_promised
    ).toBe(true);
    expect(f.misunderstood_customer_flag).toBe(false);
    expect(
      flags(state({ understanding: { applies: true, choice: 'wrong' } }), severe({}))
        .misunderstood_customer_flag
    ).toBe(true);
  });

  it('the server re-checks the same flag rules against raw_scores', () => {
    for (const [column, rule] of [
      ['bad_tone_flag', "'tone',array['dry','bad','very_bad','insult']"],
      ['severe_bad_tone_flag', "'tone',array['very_bad','insult']"],
      ['rushed_response_flag', "'understanding',array['rushed']"],
      ['misunderstood_customer_flag', "'understanding',array['wrong','caused_error']"],
      ['bad_alternative_flag', "'unavailable_items',array['bad_alternative']"],
      ['closing_message_used', "'closing_message',array['official','respectful']"],
      ['follow_up_promised', "'followup_after_wait',null"],
    ])
      expect(sqlNoComments).toContain(
        `('${column}', to_jsonb(public.dawaa_conversation_review_chose_v1(v_crit,${rule})`
      );
    for (const column of [
      'has_complaint',
      'has_medical_error',
      'has_invoice_error',
      'has_delivery_issue',
    ])
      expect(sqlNoComments).toContain(`('${column}', to_jsonb(`);
  });
});

describe('fix C: record_conversation_review_points_v1 is fail-closed', () => {
  const points = sqlNoComments.slice(
    sqlNoComments.indexOf('CREATE OR REPLACE FUNCTION public.record_conversation_review_points_v1'),
    sqlNoComments.indexOf('end;$function$;')
  );
  it('replaces the fail-open account-state check, keeping the live contract', () => {
    expect(points).toContain(
      "and a.active is true and a.is_active is true and a.can_login is true and lower(btrim(coalesce(a.status,'')))='active' limit 1;"
    );
    expect(points).not.toMatch(/coalesce\(a\.(active|is_active|can_login),true\)/);
    expect(points).not.toMatch(/coalesce\(a\.status,'active'\)/);
    expect(points).toContain(
      "'conversation_evaluation',v_review.id,null,v_review.month_cycle,v_review.branch,v_status,null,"
    );
    expect(points).toContain("raise exception 'review_author_session_mismatch'");
  });
  it('does not change the points command grants', () => {
    expect(sqlNoComments).not.toMatch(/(grant|revoke)[^;]*record_conversation_review_points_v1/i);
  });
});
