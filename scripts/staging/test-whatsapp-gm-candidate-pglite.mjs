// Isolated PostgreSQL-compatible regression suite. Never connects to Production.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const fixture = readFileSync('scripts/staging/test-whatsapp-soft-delete.py', 'utf8');
const schema = fixture.match(/SCHEMA = """([\s\S]*?)"""/)?.[1];
assert.ok(schema, 'missing existing isolated schema');
const database = new PGlite();
const oldSql = readFileSync('supabase/migrations/20261025100000_whatsapp_conversation_case_soft_delete_v1.sql', 'utf8');
const newSql = readFileSync('supabase/migrations/20261025170000_whatsapp_gm_invoice_candidate_correction_v1.sql', 'utf8');
const requestSql = readFileSync('supabase/migrations/20261025173000_whatsapp_gm_approved_change_requests_v1.sql', 'utf8');

try {
  await database.exec(schema);
  await database.exec(`alter table public.whatsapp_review_sources
    add column matched_invoice_date timestamptz,
    add column matched_invoice_value numeric,
    add column invoice_match_status text,
    add column invoice_match_confidence numeric,
    add column invoice_match_reason text,
    add column updated_at timestamptz;`);
  // The original migration depends on the captured Production reconcile function only for
  // runtime tests of re-analysis, not for installation. The candidate command does not invoke it.
  await database.exec(oldSql);
  await database.exec(newSql);
  await database.exec(requestSql);

  const source = '753b38b2-69d7-48da-85be-acd8f50e1e80';
  const invoice = '97086127-a14f-48cc-ab86-13cb7f2b4b29';
  const gm = 'daaa0000-0000-4000-8000-000000000001';
  const staff = 'daaa0000-0000-4000-8000-000000000002';
  const caseId = `${source}:interaction:0`;
  await database.exec(`insert into public.staff_accounts(id,name,role,active,can_login) values
    ('${gm}','المدير العام','general_manager',true,true),
    ('${staff}','صيدلي','pharmacist',true,true);
    insert into public.whatsapp_review_sources(id,source_hash,source_filename,matched_invoice_id,
      matched_invoice_number,invoice_match_status,invoice_match_confidence)
      values ('${source}','hash-candidate','TEST-V35-customer-17.txt','${invoice}','77773','needs_review',0.6);
    insert into public.sales_intelligence_cases(case_id,conversation_id,is_active)
      values ('${caseId}','${source}',true);`);

  const args = `('${source}','${invoice}','77773','الترشيح مرتبط بفاتورة قديمة غير معتمدة',
    'تصحيح ربط الفاتورة','del-candidate-001')`;
  await assert.rejects(database.exec(`select public.dawaa_clear_whatsapp_unconfirmed_invoice_candidate_v1${args}`),
    /whatsapp_deletion_general_manager_required/);
  await database.exec(`set test.actor='${gm}'`);
  await assert.rejects(database.exec(`select public.dawaa_clear_whatsapp_unconfirmed_invoice_candidate_v1(
    '${source}','${invoice}','77773','سبب تصحيح مفصل','تأكيد خاطئ','del-candidate-002')`),
    /whatsapp_candidate_confirmation_required/);
  await assert.rejects(database.exec(`select public.dawaa_clear_whatsapp_unconfirmed_invoice_candidate_v1(
    '${source}','${invoice}','77774','سبب تصحيح مفصل','تصحيح ربط الفاتورة','del-candidate-003')`),
    /whatsapp_candidate_changed_since_preview/);

  // A proven V22 envelope is untouchable even when the source only has a candidate match.
  await database.exec(`insert into public.whatsapp_customer_cases_v22(id,root_source_id,case_json)
    values ('cbbb0000-0000-4000-8000-000000000001','${source}',
      '{"canonicalSaleProof":{"state":"proven","salesCaseId":"${caseId}"}}'::jsonb);`);
  await assert.rejects(database.exec(`select public.dawaa_clear_whatsapp_unconfirmed_invoice_candidate_v1${args}`),
    /whatsapp_candidate_other_protected_work/);
  await database.exec(`delete from public.whatsapp_customer_cases_v22 where root_source_id='${source}'`);

  const first = await database.query(`select public.dawaa_clear_whatsapp_unconfirmed_invoice_candidate_v1${args} as result`);
  assert.equal(first.rows[0].result.status, 'corrected');
  assert.ok(first.rows[0].result.auditId);
  const replay = await database.query(`select public.dawaa_clear_whatsapp_unconfirmed_invoice_candidate_v1${args} as result`);
  assert.equal(replay.rows[0].result.status, 'replayed');
  const check = await database.query(`select matched_invoice_id, matched_invoice_number from public.whatsapp_review_sources where id='${source}'`);
  assert.equal(check.rows[0].matched_invoice_id, null);
  assert.equal(check.rows[0].matched_invoice_number, null);
  const count = await database.query(`select count(*)::integer as value from public.whatsapp_invoice_candidate_corrections_v1`);
  assert.equal(count.rows[0].value, 1);

  const impact = await database.query(`select public.dawaa_whatsapp_deletion_impact_v1('${source}',
    'conversation',array['${caseId}']) as result`);
  const fp = impact.rows[0].result.fingerprint;
  const request = await database.query(`select public.dawaa_request_whatsapp_gm_change_v1(
    'delete_conversation','${source}',null,'{}'::jsonb,'إغلاق المحادثة التجريبية بعد التدقيق',
    '${fp}','req-gm-protected-001') as result`);
  assert.equal(request.rows[0].result.status, 'pending_confirmation');
  const reqId = request.rows[0].result.requestId;
  await assert.rejects(database.exec(`select public.dawaa_request_whatsapp_gm_change_v1(
    'delete_conversation','${source}',null,'{}'::jsonb,'سبب مختلف يعيد نفس المفتاح',
    '${fp}','req-gm-protected-001')`), /whatsapp_gm_change_request_key_conflict/);
  const pending = await database.query(`select public.dawaa_list_whatsapp_gm_changes_v1(5) as result`);
  assert.equal(pending.rows[0].result.length, 1);
  assert.equal(pending.rows[0].result[0].status, 'pending_confirmation');
  await assert.rejects(database.exec(`select public.dawaa_confirm_whatsapp_gm_change_v1(
    '${reqId}','تأكيد خاطئ','تأكيد إداري واضح','confirm-gm-001')`),
    /whatsapp_gm_change_confirmation_required/);
  const confirm = await database.query(`select public.dawaa_confirm_whatsapp_gm_change_v1(
    '${reqId}','أؤكد التصحيح المعتمد','أراجع الأثر قبل التسوية المالية','confirm-gm-001') as result`);
  assert.equal(confirm.rows[0].result.applied, false);
  assert.equal(confirm.rows[0].result.status, 'approved_pending_reconciliation');
  assert.equal(confirm.rows[0].result.settlementRequired, true);
  const listed = await database.query(`select public.dawaa_list_whatsapp_gm_changes_v1(5) as result`);
  assert.equal(listed.rows[0].result[0].status, 'approved_pending_reconciliation');
  const confirmationReplay = await database.query(`select public.dawaa_confirm_whatsapp_gm_change_v1(
    '${reqId}','أؤكد التصحيح المعتمد','أراجع الأثر قبل التسوية المالية','confirm-gm-001') as result`);
  assert.equal(confirmationReplay.rows[0].result.replayed, true);
  const auditEvents = await database.query(`select count(*)::integer as count from public.whatsapp_gm_change_request_audit_v1`);
  assert.equal(auditEvents.rows[0].count, 2);
  await assert.rejects(database.exec(`delete from public.whatsapp_gm_change_request_audit_v1 where request_id='${reqId}'`),
    /whatsapp_gm_change_audit_is_immutable/);
  await assert.rejects(database.exec(`update public.whatsapp_gm_change_request_audit_v1 set actor_name='changed' where request_id='${reqId}'`),
    /whatsapp_gm_change_audit_is_immutable/);
  const untouched = await database.query(`select is_active from public.sales_intelligence_cases where case_id='${caseId}'`);
  assert.equal(untouched.rows[0].is_active, true);

  // The action cannot be performed by a pharmacist, even when there is no financial work.
  await database.exec(`set test.actor='${staff}'`);
  await assert.rejects(database.exec(`select public.dawaa_clear_whatsapp_unconfirmed_invoice_candidate_v1${args}`),
    /whatsapp_deletion_general_manager_required/);
  await assert.rejects(database.exec(`select public.dawaa_list_whatsapp_gm_changes_v1(5)`),
    /whatsapp_deletion_general_manager_required/);
  await assert.rejects(database.exec(`select public.dawaa_request_whatsapp_gm_change_v1(
    'delete_conversation','${source}',null,'{}'::jsonb,'طلب موظف غير مصرح به',
    '${fp}','req-gm-forbidden-001')`), /whatsapp_deletion_general_manager_required/);

  process.stdout.write('[whatsapp-gm] PASS: candidate correction, audited 2-step approved request, replay, no financial or case writes\n');
} finally {
  await database.close();
}
