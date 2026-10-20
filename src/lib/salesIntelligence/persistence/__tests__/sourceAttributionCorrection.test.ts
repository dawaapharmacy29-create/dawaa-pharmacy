import { afterEach, describe, expect, it } from 'vitest';
import {
  ANALYSIS, BRANCH_STAFF, CASE_ID, CUSTOMER, FOLLOWUP_IDENTITY, GM_STAFF, INACTIVE_STAFF, OLD_HASH, OTHER_BRANCH_STAFF,
  OTHER_SOURCE, PRODUCT, REASON, REQUEST_IDENTITY, SOURCE, WAREHOUSE_STAFF, canonicalFollowupRow, canonicalRequestRow,
  createHarness, hashOf, migration, opsScript, qualifiedSnapshot, type SourceAttributionHarness,
} from './sourceAttributionHarness';

let h: SourceAttributionHarness | null = null;
async function harness() {
  h = await createHarness();
  return h;
}
afterEach(async () => {
  await h?.close();
  h = null;
});

const approve = 'select dawaa_approve_whatsapp_customer_request_action_v2($1) result';
const materialize = 'select dawaa_materialize_whatsapp_action_v1($1) result';

describe('operating branch rule in the database', () => {
  it('accepts only the operating branches', async () => {
    const t = await harness();
    const rows = await t.sql<{ b: string; ok: boolean }>(`select b, dawaa_is_transaction_branch_v1(b) ok
      from unnest(array['كل الفروع','الكل','غير محدد','المخزن','All branches','',' ','فرع جديد','فرع شكري','شكري','فرع الشامي','الشامى']) b`);
    expect(Object.fromEntries(rows.map((row) => [row.b, row.ok]))).toEqual({
      'كل الفروع': false, 'الكل': false, 'غير محدد': false, 'المخزن': false, 'All branches': false, '': false,
      ' ': false, 'فرع جديد': false, 'فرع شكري': true, 'شكري': true, 'فرع الشامي': true, 'الشامى': true,
    });
    expect(await t.sql('select dawaa_is_transaction_branch_v1(null) ok')).toEqual([{ ok: false }]);
  });
});

describe('customer request approval and execution guards', () => {
  it('keeps the live 5728c227 shape unapprovable and unexecutable', async () => {
    const t = await harness();
    await t.publish(qualifiedSnapshot('qualified'));
    // Live shape: canonical proposal written before this migration, «كل الفروع», general manager, confidence 80.
    const id = await t.insertAction({ ...canonicalRequestRow('كل الفروع'), confidence: 80 }, true);
    expect(await t.errorOf(approve, [id])).toContain('customer_request_action_transaction_branch_required');
    expect(await t.errorOf(materialize, [id])).toContain('whatsapp_action_transaction_branch_required');
    expect(await t.sql('select status,auto_eligible from whatsapp_conversation_actions where id=$1', [id]))
      .toEqual([{ status: 'proposed', auto_eligible: false }]);
    expect(await t.sql('select count(*)::int n from whatsapp_review_audit')).toEqual([{ n: 0 }]);
    expect(await t.sql('select count(*)::int n from customer_requests')).toEqual([{ n: 0 }]);
  });

  it('approves and executes a canonical request only while the current analysis qualifies it, idempotently', async () => {
    const t = await harness();
    await t.publish(qualifiedSnapshot('review_required'), 'فرع شكري');
    await t.db.query('update whatsapp_review_sources set staff_id=$1 where id=$2', [BRANCH_STAFF, SOURCE]);
    const id = await t.insertAction(canonicalRequestRow('فرع شكري', BRANCH_STAFF));
    expect(await t.errorOf(approve, [id])).toContain('customer_request_requires_current_qualification');

    await t.publish(qualifiedSnapshot('qualified'));
    const [{ result: first }] = await t.sql<{ result: any }>(approve, [id]);
    const [{ result: second }] = await t.sql<{ result: any }>(approve, [id]);
    expect(first).toMatchObject({ ok: true, status: 'ready' });
    expect(second).toMatchObject({ ok: true, status: 'ready', already_approved: true });
    expect(await t.sql(`select count(*)::int n from whatsapp_review_audit where action='customer_request_action_approved_v2'`))
      .toEqual([{ n: 1 }]);

    await t.publish(qualifiedSnapshot('review_required'));
    expect(await t.errorOf(materialize, [id])).toContain('customer_request_requires_current_qualification');
    await t.publish(qualifiedSnapshot('qualified'));
    const [{ result: executed }] = await t.sql<{ result: any }>(materialize, [id]);
    const [{ result: retried }] = await t.sql<{ result: any }>(materialize, [id]);
    expect(executed).toMatchObject({ ok: true, already_created: false });
    expect(retried).toMatchObject({ ok: true, already_created: true, target_id: executed.target_id });
    expect(await t.sql('select customer_id,product_id,doctor_id,branch from customer_requests')).toEqual([
      { customer_id: CUSTOMER, product_id: PRODUCT, doctor_id: BRANCH_STAFF, branch: 'فرع شكري' },
    ]);
  });

  it('refuses a request when the conversation evidence resolves a different doctor', async () => {
    const t = await harness();
    await t.publish(qualifiedSnapshot('qualified', [{ sender: 'You', staffId: OTHER_BRANCH_STAFF, messageIds: ['m2'], messageCount: 1 }]), 'فرع شكري');
    await t.db.query('update whatsapp_review_sources set staff_id=$1 where id=$2', [BRANCH_STAFF, SOURCE]);
    const id = await t.insertAction(canonicalRequestRow('فرع شكري', BRANCH_STAFF));
    expect(await t.errorOf(approve, [id])).toContain('customer_request_action_staff_evidence_conflict');
    await t.publish(qualifiedSnapshot('qualified', [{ sender: 'You', staffId: BRANCH_STAFF, messageIds: ['m2'], messageCount: 1 }]));
    expect(await t.sql(approve, [id])).toHaveLength(1);
  });

  it('allows a doctor from another home branch only with an audited human cover confirmation', async () => {
    const t = await harness();
    await t.publish(qualifiedSnapshot('qualified'), 'فرع شكري');
    await t.db.exec(`set session_replication_role=replica; update whatsapp_review_sources set staff_id='${OTHER_BRANCH_STAFF}' where id='${SOURCE}'; set session_replication_role=origin;`);
    const id = await t.insertAction(canonicalRequestRow('فرع شكري', OTHER_BRANCH_STAFF));
    expect(await t.errorOf(approve, [id])).toContain('customer_request_action_cross_branch_requires_confirmation');

    // Restore the pre-correction attribution, then correct with explicit cover.
    await t.db.exec(`set session_replication_role=replica; update whatsapp_review_sources set staff_id='${GM_STAFF}', branch='كل الفروع' where id='${SOURCE}'; set session_replication_role=origin;`);
    expect(await t.errorOf(...t.correctCall({ staff: OTHER_BRANCH_STAFF }))).toContain('source_attribution_staff_branch_mismatch');
    const [{ result }] = await t.sql<{ result: any }>(...t.correctCall({ staff: OTHER_BRANCH_STAFF, cover: true }));
    expect(result).toMatchObject({ changed: true, retiredActions: 1 });
    expect(await t.sql(`select after_state->>'cross_branch_cover' cover, after_state->>'staff_home_branch' home
      from whatsapp_review_audit where action='source_attribution_corrected_v1'`)).toEqual([{ cover: 'true', home: 'فرع الشامي' }]);
    const corrected = await t.insertAction(canonicalRequestRow('فرع شكري', OTHER_BRANCH_STAFF));
    expect(await t.sql(approve, [corrected])).toHaveLength(1);
  });

  it('never approves a request without a resolved, active responsible doctor', async () => {
    const t = await harness();
    await t.publish(qualifiedSnapshot('qualified'), 'فرع شكري');
    await t.db.exec(`set session_replication_role=replica; update whatsapp_review_sources set staff_id=null where id='${SOURCE}'; set session_replication_role=origin;`);
    const missing = await t.insertAction({ ...canonicalRequestRow('فرع شكري'), staff_id: null }, true);
    expect(await t.errorOf(approve, [missing])).toContain('customer_request_action_canonical_identity_required');
    await t.db.exec(`set session_replication_role=replica; update whatsapp_review_sources set staff_id='${INACTIVE_STAFF}' where id='${SOURCE}'; set session_replication_role=origin;`);
    const inactive = await t.insertAction({ ...canonicalRequestRow('فرع شكري', INACTIVE_STAFF), action_key: 'canonical-request:inactive', followup_identity: 'inactive' }, true);
    expect(await t.errorOf(approve, [inactive])).toMatch(/active_staff_required|cross_branch_requires_confirmation/);
  });

  it('keeps the existing approval contract for legacy proposals, including legitimate cross-branch cover', async () => {
    const t = await harness();
    await t.db.exec(`set session_replication_role=replica; update whatsapp_review_sources set branch='فرع شكري', staff_id='${WAREHOUSE_STAFF}' where id='${SOURCE}'; set session_replication_role=origin;`);
    await t.db.query('insert into sales_intelligence_cases(case_id,conversation_id) values($1,$2)', [CASE_ID, SOURCE]);
    // Live legacy example: a doctor whose home is the warehouse, request in فرع شكري.
    const id = await t.insertAction({
      action_type: 'customer_request', action_key: 'customer-request', created_by: 'د معاذ', branch: 'فرع شكري',
      staff_id: WAREHOUSE_STAFF, product_id: PRODUCT, product_code: '28784', confidence: 90, payload: {},
    });
    await t.db.query(approve, [id]);
    expect(await t.sql('select status from whatsapp_conversation_actions where id=$1', [id])).toEqual([{ status: 'ready' }]);
  });

  it('refuses to execute any follow-up type outside an operating branch', async () => {
    const t = await harness();
    for (const [index, branch] of ['كل الفروع', 'غير محدد', 'المخزن'].entries()) {
      for (const actionType of ['customer_followup', 'complaint_followup', 'recommendation_followup']) {
        const id = await t.insertAction({ action_type: actionType, action_key: `legacy-${actionType}-${index}`, status: 'ready',
          created_by: 'legacy', branch, payload: {} });
        expect(await t.errorOf(materialize, [id])).toContain('whatsapp_action_transaction_branch_required');
      }
    }
    const ok = await t.insertAction({ action_type: 'customer_followup', action_key: 'legacy-real-branch', status: 'ready',
      created_by: 'legacy', branch: 'فرع شكري', payload: {} });
    await t.db.query(materialize, [ok]);
    expect(await t.sql('select status from whatsapp_conversation_actions where id=$1', [ok])).toEqual([{ status: 'created' }]);
  });

  it('refuses to publish a canonical request with a stale or non-operating attribution', async () => {
    const t = await harness();
    expect(await t.errorOf(`insert into whatsapp_conversation_actions(source_id,action_key,action_type,status,created_by,branch,staff_id)
      values($1,'k1','customer_request','proposed','si-canonical-customer-request-projection-v1','كل الفروع',$2)`, [SOURCE, GM_STAFF]))
      .toContain('canonical_request_projection_stale_source');
    await t.db.exec(`set session_replication_role=replica; update whatsapp_review_sources set branch='فرع شكري' where id='${SOURCE}'; set session_replication_role=origin;`);
    expect(await t.errorOf(`insert into whatsapp_conversation_actions(source_id,action_key,action_type,status,created_by,branch,staff_id)
      values($1,'k2','customer_request','proposed','si-canonical-customer-request-projection-v1','فرع شكري',$2)`, [SOURCE, BRANCH_STAFF]))
      .toContain('canonical_request_projection_stale_source');
    await t.db.query(`insert into whatsapp_conversation_actions(source_id,action_key,action_type,status,created_by,branch,staff_id)
      values($1,'k3','customer_request','proposed','si-canonical-customer-request-projection-v1','فرع شكري',$2)`, [SOURCE, GM_STAFF]);
  });
});

describe('source attribution guard, emergency stop and rollback', () => {
  it('lets the browser fill blank attribution but not overwrite stored attribution', async () => {
    const t = await harness();
    await t.db.exec(`grant select, update on whatsapp_review_sources to authenticated;
      update whatsapp_review_sources set branch=null where id='${OTHER_SOURCE}';
      set role authenticated;`);
    await t.db.query(`update whatsapp_review_sources set branch='فرع شكري', customer_name='ملء فقط' where id=$1`, [OTHER_SOURCE]);
    for (const patch of ["branch='فرع الشامي'", `staff_id='${BRANCH_STAFF}'`, "raw_text='edited'",
      `source_hash='${'f'.repeat(64)}'`, 'customer_id=null']) {
      expect(await t.errorOf(`update whatsapp_review_sources set ${patch} where id=$1`, [SOURCE]))
        .toContain('source_attribution_requires_correction_command');
    }
    await t.db.exec('reset role;');
    expect(await t.sql('select branch,staff_id,raw_text from whatsapp_review_sources where id=$1', [SOURCE]))
      .toEqual([{ branch: 'كل الفروع', staff_id: GM_STAFF, raw_text: 'old text' }]);
  });

  it('pauses approval, execution and correction for clients without reopening older behavior, then resumes', async () => {
    const t = await harness();
    await t.publish(qualifiedSnapshot('qualified'), 'فرع شكري');
    await t.db.exec(`set session_replication_role=replica; update whatsapp_review_sources set staff_id='${BRANCH_STAFF}' where id='${SOURCE}'; set session_replication_role=origin;`);
    const id = await t.insertAction(canonicalRequestRow('فرع شكري', BRANCH_STAFF));
    await t.db.exec(opsScript('emergency_stop_20261020153000.sql'));
    await t.db.exec('set role authenticated;');
    for (const call of [approve, materialize]) expect(await t.errorOf(call, [id])).toMatch(/permission denied/);
    expect(await t.errorOf(...t.correctCall())).toMatch(/permission denied/);
    await t.db.exec('reset role;');
    expect(await t.sql('select status from whatsapp_conversation_actions where id=$1', [id])).toEqual([{ status: 'proposed' }]);
    await t.db.exec(opsScript('resume_20261020153000.sql'));
    await t.db.exec('set role authenticated;');
    expect(await t.sql(approve, [id])).toHaveLength(1);
    await t.db.exec('reset role;');
  });

  it('stops safely BEFORE the migration and refuses to resume the older approval behavior', async () => {
    const t = await harness();
    await t.publish(qualifiedSnapshot('qualified'));
    // Pre-migration state (today's Production): previous approve/materialize bodies, no correction command.
    await t.db.exec(opsScript('rollback_exact_20261020153000_REOPENS_PREVIOUS_APPROVAL.sql'));
    const id = await t.insertAction(canonicalRequestRow('كل الفروع'), true);
    await t.db.exec(opsScript('emergency_stop_20261020153000.sql'));
    await t.db.exec('set role authenticated;');
    for (const call of [approve, materialize]) expect(await t.errorOf(call, [id])).toMatch(/permission denied/);
    await t.db.exec('reset role;');
    const resumeError = await t.db.exec(opsScript('resume_20261020153000.sql')).then(() => null, (error: Error) => error.message);
    await t.db.exec('rollback;');
    expect(resumeError).toContain('resume_requires_hardened_20261020153000');
    await t.db.exec('set role authenticated;');
    expect(await t.errorOf(approve, [id])).toMatch(/permission denied/);
    await t.db.exec('reset role;');
    expect(await t.sql('select status from whatsapp_conversation_actions where id=$1', [id])).toEqual([{ status: 'proposed' }]);
    // After the migration is installed, resume restores the grants onto the hardened commands only.
    await t.db.exec(migration('_whatsapp_source_attribution_correction_v1.sql'));
    await t.db.exec(opsScript('emergency_stop_20261020153000.sql'));
    await t.db.exec(opsScript('resume_20261020153000.sql'));
    await t.db.exec('set role authenticated;');
    expect(await t.errorOf(approve, [id])).toContain('customer_request_action_transaction_branch_required');
    await t.db.exec('reset role;');
  });

  it('safe rollback removes only the correction command and new triggers and keeps the hardened guards', async () => {
    const t = await harness();
    await t.publish(qualifiedSnapshot('qualified'));
    const id = await t.insertAction(canonicalRequestRow('كل الفروع'), true);
    const before = await t.sql('select * from whatsapp_conversation_actions order by id');
    await t.db.exec(opsScript('rollback_safe_20261020153000.sql'));
    expect(await t.sql('select * from whatsapp_conversation_actions order by id')).toEqual(before);
    expect(await t.sql(`select proname from pg_proc where proname in ('dawaa_correct_whatsapp_source_attribution_v1',
      'dawaa_guard_whatsapp_source_attribution_v1','dawaa_guard_canonical_request_projection_v1')`)).toEqual([]);
    expect(await t.errorOf(approve, [id])).toContain('customer_request_action_transaction_branch_required');
  });

  it('exact rollback restores the previous bodies and the migration re-applies cleanly', async () => {
    const t = await harness();
    await t.publish(qualifiedSnapshot('qualified'));
    const id = await t.insertAction(canonicalRequestRow('كل الفروع'), true);
    const before = await t.sql('select * from whatsapp_conversation_actions order by id');
    await t.db.exec(opsScript('rollback_exact_20261020153000_REOPENS_PREVIOUS_APPROVAL.sql'));
    expect(await t.sql('select * from whatsapp_conversation_actions order by id')).toEqual(before);
    expect(await t.sql(`select count(*)::int n from pg_proc where proname like 'dawaa_%v1' and proname in (
      'dawaa_correct_whatsapp_source_attribution_v1','dawaa_is_transaction_branch_v1','dawaa_canonical_request_is_current_v1',
      'dawaa_canonical_request_staff_refusal_v1','dawaa_guard_whatsapp_source_attribution_v1','dawaa_guard_canonical_request_projection_v1')`))
      .toEqual([{ n: 0 }]);
    // This is exactly why the exact rollback must only be used with the emergency stop in force.
    await t.db.query(approve, [id]);
    expect(await t.sql('select status from whatsapp_conversation_actions where id=$1', [id])).toEqual([{ status: 'ready' }]);
    await t.db.exec(migration('_whatsapp_source_attribution_correction_v1.sql'));
    expect(await t.sql(`select count(*)::int n from pg_proc where proname='dawaa_correct_whatsapp_source_attribution_v1'`))
      .toEqual([{ n: 1 }]);
  });
});

describe('retired source hash registry', () => {
  const insertSource = (hash: string) =>
    `insert into whatsapp_review_sources(id,customer_name,branch,source_hash) values (gen_random_uuid(),'synthetic','فرع شكري','${hash}')`;

  it('binds the pre-correction hash to the same source and refuses any new source for it', async () => {
    const t = await harness();
    await t.sql(...t.correctCall());
    expect(await t.sql('select source_hash,source_id from whatsapp_review_source_hash_aliases')).toEqual([
      { source_hash: OLD_HASH, source_id: SOURCE },
    ]);
    expect(await t.errorOf(insertSource(OLD_HASH))).toContain('source_hash_superseded_by_correction');
    expect(await t.errorOf(insertSource(hashOf('corrected text')))).toMatch(/duplicate key|unique/i);
    expect(await t.sql('select count(*)::int n from whatsapp_review_sources')).toEqual([{ n: 2 }]);
  });

  it('keeps every earlier hash on a second correction and lets a source return to its own earlier text', async () => {
    const t = await harness();
    await t.sql(...t.correctCall());
    await t.sql(...t.correctCall({ expected: hashOf('corrected text'), raw: 'second text' }));
    expect(await t.sql('select source_hash from whatsapp_review_source_hash_aliases order by created_at')).toEqual([
      { source_hash: OLD_HASH }, { source_hash: hashOf('corrected text') },
    ]);
    // Back to the original text of the SAME source: that hash becomes current again.
    const [{ result }] = await t.sql<{ result: any }>(...t.correctCall({ expected: hashOf('second text'), raw: 'old text', staff: GM_STAFF }));
    expect(result).toMatchObject({ changed: true });
    expect(await t.sql('select source_hash from whatsapp_review_source_hash_aliases order by source_hash')).toEqual(
      [{ source_hash: hashOf('corrected text') }, { source_hash: hashOf('second text') }].sort((a, b) => a.source_hash.localeCompare(b.source_hash))
    );
    expect(await t.sql('select source_hash from whatsapp_review_sources where id=$1', [SOURCE])).toEqual([{ source_hash: OLD_HASH }]);
  });

  it('refuses a correction to a hash retired by another source', async () => {
    const t = await harness();
    await t.db.query('select dawaa_correct_whatsapp_source_attribution_v1($1,$2,$3,$4,$5,$6,$7,$8)',
      [OTHER_SOURCE, hashOf('other text'), 'other corrected', hashOf('other corrected'), BRANCH_STAFF, 'فرع شكري', REASON, false]);
    expect(await t.errorOf(...t.correctCall({ raw: 'other text' }))).toContain('source_attribution_hash_conflict');
  });

  it('is never writable by clients and survives the safe rollback', async () => {
    const t = await harness();
    await t.sql(...t.correctCall());
    await t.db.exec('set role authenticated;');
    expect(await t.errorOf(`insert into whatsapp_review_source_hash_aliases values ('x','${SOURCE}','${SOURCE}')`)).toMatch(/permission denied/);
    expect(await t.errorOf(`delete from whatsapp_review_source_hash_aliases`)).toMatch(/permission denied/);
    await t.db.exec('reset role;');
    await t.db.exec(opsScript('rollback_safe_20261020153000.sql'));
    expect(await t.errorOf(insertSource(OLD_HASH))).toContain('source_hash_superseded_by_correction');
  });
});

describe('authorized source attribution correction', () => {
  async function seededCase() {
    const t = await harness();
    await t.publish(qualifiedSnapshot('qualified'));
    const request = await t.insertAction(canonicalRequestRow('كل الفروع'), true);
    const followup = await t.insertAction(canonicalFollowupRow('كل الفروع'), true);
    const otherSourceAction = await t.insertAction({ source_id: OTHER_SOURCE, action_type: 'customer_followup',
      action_key: 'other-source', status: 'ready', created_by: 'legacy', branch: 'فرع شكري', payload: {} });
    return { t, request, followup, otherSourceAction };
  }

  it('corrects staff/branch/text with a server-verified hash, retires old proposals and audits once', async () => {
    const { t, request, followup, otherSourceAction } = await seededCase();
    const neighbour = await t.sql('select * from whatsapp_conversation_actions where id=$1', [otherSourceAction]);
    const [{ result }] = await t.sql<{ result: any }>(...t.correctCall());
    expect(result).toMatchObject({ ok: true, changed: true, retiredActions: 2, reanalysisRequired: true });
    expect(await t.sql('select branch,staff_id,staff_name,customer_id,customer_code,source_hash,raw_text from whatsapp_review_sources where id=$1', [SOURCE]))
      .toEqual([{ branch: 'فرع شكري', staff_id: BRANCH_STAFF, staff_name: 'د دنيا', customer_id: CUSTOMER,
        customer_code: '17', source_hash: hashOf('corrected text'), raw_text: 'corrected text' }]);
    const retired = await t.sql(`select id,status,branch,staff_id,evidence,followup_identity,
      payload->>'supersededIdentity' old_identity from whatsapp_conversation_actions where id in ($1,$2) order by action_type desc`, [request, followup]);
    expect(retired).toEqual([
      { id: request, status: 'dismissed', branch: 'كل الفروع', staff_id: GM_STAFF, evidence: ['m1', 'm2'],
        followup_identity: `${REQUEST_IDENTITY}|superseded:${request}`, old_identity: REQUEST_IDENTITY },
      { id: followup, status: 'dismissed', branch: 'كل الفروع', staff_id: null, evidence: ['m1', 'm2'],
        followup_identity: `${FOLLOWUP_IDENTITY}|superseded:${followup}`, old_identity: FOLLOWUP_IDENTITY },
    ]);
    expect(await t.sql('select * from whatsapp_conversation_actions where id=$1', [otherSourceAction])).toEqual(neighbour);
    const audit = await t.sql<{ before_state: any; after_state: any; note: string }>('select before_state,after_state,note from whatsapp_review_audit');
    expect(audit).toHaveLength(1);
    expect(audit[0].note).toBe(REASON);
    expect(audit[0].before_state).toMatchObject({ staff_id: GM_STAFF, branch: 'كل الفروع', raw_text: 'old text', source_hash: OLD_HASH });
    expect(audit[0].before_state.actions).toHaveLength(2);
    expect(audit[0].after_state).toMatchObject({ staff_id: BRANCH_STAFF, branch: 'فرع شكري', customer_id: CUSTOMER, cross_branch_cover: false });

    const [{ result: replay }] = await t.sql<{ result: any }>(...t.correctCall());
    expect(replay).toEqual({ ok: true, changed: false, sourceId: SOURCE, retiredActions: 0 });
    expect(await t.sql('select count(*)::int n from whatsapp_review_audit')).toEqual([{ n: 1 }]);
  });

  it('re-attributes again without reviving retired proposals or duplicating the corrected one', async () => {
    const { t } = await seededCase();
    await t.sql(...t.correctCall());
    await t.publish(qualifiedSnapshot('qualified'));
    await t.insertAction(canonicalRequestRow('فرع شكري', BRANCH_STAFF));
    const [{ result }] = await t.sql<{ result: any }>(...t.correctCall({ expected: hashOf('corrected text'), raw: 'second correction', staff: GM_STAFF }));
    expect(result).toMatchObject({ changed: true, retiredActions: 1 });
    expect(await t.sql(`select count(*)::int n from whatsapp_conversation_actions where source_id=$1 and status in ('proposed','ready')`, [SOURCE]))
      .toEqual([{ n: 0 }]);
    expect(await t.sql('select count(*)::int n from whatsapp_conversation_actions where source_id=$1', [SOURCE])).toEqual([{ n: 3 }]);
    expect(await t.sql('select count(*)::int n from whatsapp_review_audit')).toEqual([{ n: 2 }]);
  });

  it.each([
    ['no permission', { permission: false }, 'source_attribution_correction_permission_denied'],
    ['short reason', { reason: 'خطأ' }, 'source_attribution_correction_reason_required'],
    ['account-wide branch', { branch: 'كل الفروع' }, 'source_attribution_transaction_branch_required'],
    ['warehouse branch', { branch: 'المخزن' }, 'source_attribution_transaction_branch_required'],
    ['malformed hash', { hash: 'fallback-123' }, 'source_attribution_hash_invalid'],
    ['hash of other text', { hash: hashOf('something else') }, 'source_attribution_hash_mismatch'],
    ['hash with shifted timeline', { hash: hashOf('corrected text', '2026-10-20T02:05:00.000Z') }, 'source_attribution_hash_mismatch'],
    ['inactive staff', { staff: INACTIVE_STAFF }, 'active_staff_required'],
    ['cross-branch staff without cover', { staff: OTHER_BRANCH_STAFF }, 'source_attribution_staff_branch_mismatch'],
    ['warehouse staff without cover', { staff: WAREHOUSE_STAFF }, 'source_attribution_staff_branch_mismatch'],
    ['customer as staff', { staff: CUSTOMER }, 'active_staff_required'],
    ['stale expected hash', { expected: 'd'.repeat(64) }, 'source_attribution_source_changed'],
    ['text of another source', { raw: 'other text' }, 'source_attribution_hash_conflict'],
  ])('refuses %s and changes nothing', async (_label, overrides, message) => {
    const { t, request } = await seededCase();
    const { permission, ...args } = overrides as Record<string, unknown>;
    if (permission === false) await t.authorize(false);
    const sources = await t.sql('select * from whatsapp_review_sources order by id');
    const actions = await t.sql('select * from whatsapp_conversation_actions order by id');
    expect(await t.errorOf(...t.correctCall(args))).toContain(message);
    expect(await t.sql('select * from whatsapp_review_sources order by id')).toEqual(sources);
    expect(await t.sql('select * from whatsapp_conversation_actions order by id')).toEqual(actions);
    expect(await t.sql('select count(*)::int n from whatsapp_review_audit')).toEqual([{ n: 0 }]);
    expect(request).toBeTruthy();
  });

  it('refuses a customer id even if a staff row were ever created with it', async () => {
    const { t } = await seededCase();
    await t.db.query(`insert into staff values ($1,'عميل','فرع شكري',true,true)`, [CUSTOMER]);
    expect(await t.errorOf(...t.correctCall({ staff: CUSTOMER }))).toContain('source_attribution_staff_is_customer');
  });

  it.each([
    ['materialized', { status: 'created', target_table: 'customer_requests', target_id: '77777777-7777-4777-8777-777777777777' }],
    ['assigned', { work_status: 'in_progress' }],
    ['approved', { status: 'ready', auto_eligible: true }],
  ])('leaves a source with %s work for manual handling', async (_label, patch) => {
    const { t, request } = await seededCase();
    const sets = Object.keys(patch).map((key, i) => `${key}=$${i + 2}`).join(',');
    await t.db.query(`update whatsapp_conversation_actions set ${sets} where id=$1`, [request, ...Object.values(patch)]);
    expect(await t.errorOf(...t.correctCall())).toContain('source_attribution_has_executed_or_approved_work');
    expect(await t.sql('select branch,staff_id from whatsapp_review_sources where id=$1', [SOURCE]))
      .toEqual([{ branch: 'كل الفروع', staff_id: GM_STAFF }]);
  });

  it('keeps human confirmation untouched', async () => {
    const { t } = await seededCase();
    await t.db.query('update whatsapp_review_sources set reviewer_confirmed=true where id=$1', [SOURCE]);
    expect(await t.errorOf(...t.correctCall())).toContain('source_attribution_has_human_confirmation');
  });

  it('rolls back the whole correction when a late step fails (no partial write)', async () => {
    const { t, request } = await seededCase();
    const sources = await t.sql('select * from whatsapp_review_sources order by id');
    const actions = await t.sql('select * from whatsapp_conversation_actions order by id');
    // Force the final audit insert to fail after the retire + source update already ran.
    await t.db.exec(`alter table whatsapp_review_audit add constraint fail_audit check (action <> 'source_attribution_corrected_v1')`);
    expect(await t.errorOf(...t.correctCall())).toContain('fail_audit');
    expect(await t.sql('select * from whatsapp_review_sources order by id')).toEqual(sources);
    expect(await t.sql('select * from whatsapp_conversation_actions order by id')).toEqual(actions);
    expect(request).toBeTruthy();
    expect(ANALYSIS).toBeTruthy();
  });
});
