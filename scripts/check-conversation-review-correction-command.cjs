#!/usr/bin/env node
// A manager "full correction" of an automatic conversation review (or of an earlier correction) must
// be VERSIONING through one staff-session command, never a browser UPDATE of system-owned evidence.
// This gate blocks the regression that produced
// `automatic_conversation_review_evidence_is_immutable_for_client`, and blocks any later migration
// from weakening the immutability guard or handing the browser privileged write paths.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const failures = [];
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const MIGRATION =
  'supabase/migrations/20261008160000_conversation_review_manager_correction_versioning_v1.sql';
const COMMAND = 'dawaa_correct_conversation_review_session_v1';
const SIGNATURE = 'text,uuid,uuid,text,jsonb';
const SERVICE = 'src/lib/reviews/conversationReviewCorrection.ts';

const sql = read(MIGRATION);
const sqlNoComments = sql.replace(/--[^\n]*/g, '');
const fnStart = sql.indexOf(`create or replace function public.${COMMAND}(`);
if (fnStart < 0) failures.push(`${MIGRATION}: ${COMMAND} not defined.`);
const header = fnStart < 0 ? '' : sql.slice(fnStart, sql.indexOf('as $function$', fnStart));
const body =
  fnStart < 0 ? '' : sql.slice(sql.indexOf('as $function$', fnStart), sql.indexOf('$function$;', fnStart));

if (!/security definer/i.test(header)) failures.push(`${MIGRATION}: missing SECURITY DEFINER.`);
if (!/set search_path to 'public','extensions','pg_catalog'/.test(header))
  failures.push(`${MIGRATION}: missing pinned search_path.`);

// Staff-session authentication, fail closed, exactly like the sibling session commands.
for (const [re, label] of [
  [/staff_session_required/, 'non-empty token check'],
  [/extensions\.digest\(btrim\(p_session_token\),'sha256'\)/, 'sha256 token hash'],
  [/s\.revoked_at is null/, 'revoked_at IS NULL'],
  [/s\.expires_at>now\(\)/, 'expires_at > now()'],
  [/a\.active is true/, 'fail-closed active check'],
  [/a\.is_active is true/, 'fail-closed is_active check'],
  [/a\.can_login is true/, 'fail-closed can_login check'],
  [/lower\(btrim\(coalesce\(a\.status,''\)\)\)='active'/, 'fail-closed status check'],
  [/get_user_permissions\(v_account\.id\)/, 'permission resolved for the session account'],
  [/'edit_reviews','approve_reviews','manage_conversation_evaluations'/, 'edit/approve review permission set'],
  [/dawaa_can_read_conversation_review_row_v2\(v_account\.id,/, 'branch/source scope for the session account'],
  [/correction_reason_required/, 'mandatory manager reason'],
  [/idempotency_key_required/, 'explicit idempotency key'],
  [/already_applied/, 'idempotent replay'],
  [/review_version_not_current/, 'current-version-only guard'],
  [/self_correction_forbidden/, 'no self-correction'],
  [/correction_payload_unknown_field/, 'whitelisted correction payload'],
  [/where id=p_review_id\s*\n\s*for update/, 'row lock on the corrected version'],
  [/is_current=false,\s*\n\s*superseded_at=v_now,\s*\n\s*superseded_reason=/, 'supersession of the old version'],
  [/insert into public\.conversation_sales_reviews/, 'new correction version inserted'],
  [/dawaa_apply_conversation_review_correction_points_v1\(p_session_token, v_new_id\)/, 'points applied in the same transaction'],
]) {
  if (!re.test(body)) failures.push(`${MIGRATION}: missing ${label}.`);
}
for (const [re, label] of [
  [/auth\.uid\(\)/, 'auth.uid()'],
  [/x-dawaa-user-id|request\.headers/, 'request header identity'],
  [/dawaa_current_actor_can|dawaa_current_staff_account_id_strict/, 'header-resolved actor helpers'],
  [/update public\.conversation_sales_reviews[\s\S]*?set[\s\S]*?(raw_scores|review_items|final_score)\s*=/, 'an UPDATE of evidence columns'],
  [/delete\s+from\s+public\.conversation_sales_reviews/i, 'deletion of review rows'],
  [/delete\s+from\s+public\.employee_transactions/i, 'deletion of ledger rows'],
]) {
  if (re.test(body)) failures.push(`${MIGRATION}: command must not use ${label}.`);
}

// Immutability guard: strengthened, never weakened or dropped.
for (const token of [
  'automatic_conversation_review_evidence_is_immutable_for_client',
  'automatic_conversation_review_is_system_owned',
  'conversation_review_correction_is_command_owned',
  'conversation_review_version_is_immutable_for_client',
  'conversation_review_version_superseded_is_frozen',
]) {
  if (!sqlNoComments.includes(token))
    failures.push(`${MIGRATION}: must keep/raise ${token}.`);
}
if (/drop\s+trigger\s+if\s+exists\s+zzzz_automatic_conversation_review_writer_guard_v2[\s\S]{0,400}?(?!create\s+trigger)/i.test(sqlNoComments) &&
    !/create\s+trigger\s+zzzz_automatic_conversation_review_writer_guard_v2/i.test(sqlNoComments)) {
  failures.push(`${MIGRATION}: must not drop the automatic-evidence writer guard trigger.`);
}
if (/grant\s+(all|insert|update|delete)[^;]*on\s+(table\s+)?public\.(conversation_sales_reviews|employee_transactions)/i.test(sqlNoComments)) {
  failures.push(`${MIGRATION}: must not grant the browser privileged writes on review/ledger tables.`);
}

// Grants: the browser calls with the anon key; the token is the authentication.
if (!new RegExp(`revoke all on function public\\.${COMMAND}\\(${SIGNATURE}\\)\\s+from public, anon, authenticated, service_role;`).test(sql))
  failures.push(`${MIGRATION}: must revoke EXECUTE from public, anon, authenticated, service_role.`);
if (!new RegExp(`grant execute on function public\\.${COMMAND}\\(${SIGNATURE}\\)\\s+to anon, authenticated;`).test(sql))
  failures.push(`${MIGRATION}: must grant EXECUTE only to anon, authenticated.`);
if (!/revoke all on function public\.dawaa_apply_conversation_review_correction_points_v1\(text,uuid\)\s+from public, anon, authenticated, service_role;/.test(sql))
  failures.push(`${MIGRATION}: the points helper must not be callable by any client role.`);

// The migration prepares schema only; it must not be applied from code, and it must not reach into
// other canonical domains.
for (const other of [
  'whatsapp_customer_cases_v22',
  'whatsapp_sales_opportunities_v17',
  'whatsapp_evidence_facts_v17',
  'whatsapp_story_events',
  'dawaa_link_whatsapp_evidence_journey',
  'sales_intelligence_reconcile_case_set_v1',
  'dawaa_supersede_legacy_review_on_automatic_v2',
]) {
  if (sqlNoComments.includes(other))
    failures.push(`${MIGRATION}: must not touch ${other} (separate canonical domain).`);
}

// Fix A: the correction keeps the conversation/source branch; the staff branch is a scope input only.
if (!/'branch', v_old\.branch,\s*'branch_id', v_old\.branch_id,/.test(body))
  failures.push(`${MIGRATION}: the correction must bind branch/branch_id to the superseded version.`);
if (/'branch',\s*v_staff\.branch/.test(body))
  failures.push(`${MIGRATION}: the correction must never take the reassigned staff member's branch.`);

// Fix B: strict, complete, self-consistent evaluation payload (no stale derived fields).
for (const [re, label] of [
  [/correction_payload_missing_field/, 'required presence of every whitelisted key'],
  [/correction_payload_inconsistent/, 'raw_scores consistency checks'],
]) {
  if (!re.test(body)) failures.push(`${MIGRATION}: missing ${label}.`);
}
for (const flag of [
  'has_complaint', 'has_medical_error', 'has_invoice_error', 'has_delivery_issue', 'bad_tone_flag',
  'severe_bad_tone_flag', 'rushed_response_flag', 'misunderstood_customer_flag', 'bad_alternative_flag',
  'closing_message_used', 'follow_up_promised', 'has_critical_error', 'final_score', 'doctor_points_impact', 'review_items',
]) {
  if (!new RegExp(`\\('${flag}', `).test(body))
    failures.push(`${MIGRATION}: ${flag} must be re-checked against raw_scores.`);
}

// Fix C: the Production review-points caller is fail-closed, contract and grants untouched.
const pointsStart = sqlNoComments.indexOf('CREATE OR REPLACE FUNCTION public.record_conversation_review_points_v1(p_session_token text, p_review_id uuid)');
if (pointsStart < 0) {
  failures.push(`${MIGRATION}: must harden record_conversation_review_points_v1 in place.`);
} else {
  const points = sqlNoComments.slice(pointsStart, sqlNoComments.indexOf('end;$function$;', pointsStart));
  if (!points.includes("and a.active is true and a.is_active is true and a.can_login is true and lower(btrim(coalesce(a.status,'')))='active'"))
    failures.push(`${MIGRATION}: record_conversation_review_points_v1 must use fail-closed account state.`);
  if (/coalesce\(a\.(active|is_active|can_login),true\)|coalesce\(a\.status,'active'\)/.test(points))
    failures.push(`${MIGRATION}: record_conversation_review_points_v1 still has a fail-open account check.`);
}
if (/(grant|revoke)[^;]*record_conversation_review_points_v1/i.test(sqlNoComments))
  failures.push(`${MIGRATION}: must not change record_conversation_review_points_v1 grants.`);

const ui = read('src/pages/Reviews.tsx');
const staffSelection = ui.slice(ui.indexOf('<Field label="الدكتور / الموظف">'), ui.indexOf('<Field label="اسم الدكتور الظاهر">'));
if (!staffSelection.includes('setEditForm((f) => ({') || !staffSelection.includes('...f,') ||
    !staffSelection.includes('staff_id: e.target.value,') || /\bbranch\s*:/.test(staffSelection))
  failures.push('src/pages/Reviews.tsx: staff selection must not change the branch of a versioned review.');

// Application side: one boundary, no parallel writer.
const service = read(SERVICE);
if (!service.includes(`'${COMMAND}'`)) failures.push(`${SERVICE}: must call ${COMMAND}.`);
if (/\.from\(\s*'(conversation_sales_reviews|employee_transactions)'\s*\)/.test(service))
  failures.push(`${SERVICE}: must not read/write review or ledger tables directly.`);

const reviews = read('src/pages/Reviews.tsx');
const saveEdit = reviews.slice(
  reviews.indexOf('const saveEdit = async'),
  reviews.indexOf('const openManagerReview')
);
if (!saveEdit.includes('isVersionedConversationReview(editingReview)'))
  failures.push('src/pages/Reviews.tsx: saveEdit must branch on isVersionedConversationReview.');
const versioned = saveEdit.slice(
  saveEdit.indexOf('if (isVersionedConversationReview(editingReview))'),
  saveEdit.indexOf("await updateSafe('conversation_sales_reviews'")
);
if (!versioned.includes('correctConversationReviewVersion('))
  failures.push('src/pages/Reviews.tsx: the versioned branch must use the correction command.');
for (const [token, label] of [
  ['updateSafe(', 'a direct review UPDATE'],
  ['persistManagerAdjustment(', 'browser points reconciliation'],
  ['persistPointsTransaction(', 'browser points writes'],
  ['record_conversation_review_points_v1', 'a second points call'],
]) {
  if (versioned.includes(token))
    failures.push(`src/pages/Reviews.tsx: the versioned branch must not use ${label}.`);
}
if (/navigate\(|setSearchParams\(/.test(saveEdit))
  failures.push('src/pages/Reviews.tsx: saveEdit must not navigate (a failed save stays on the editor route).');
if (!reviews.includes('correctedReviewIdRef.current = corrected.currentReviewId;'))
  failures.push('src/pages/Reviews.tsx: routing to the new version must happen only after success.');

// The automatic writer must not resurrect a corrected case.
const persistence = read('src/lib/salesIntelligence/conversationEvaluationPersistence.ts');
if (!persistence.includes("'skipped_manager_corrected'"))
  failures.push('src/lib/salesIntelligence/conversationEvaluationPersistence.ts: must skip a manager-corrected case.');
if (persistence.indexOf("'manager_correction'") > persistence.indexOf('.select(\'id, evaluation_kind\')'))
  failures.push('src/lib/salesIntelligence/conversationEvaluationPersistence.ts: the correction gate must run before any write path.');

if (failures.length) {
  console.error('Conversation review manager-correction boundary violations:');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log('Conversation review manager-correction boundary OK.');
