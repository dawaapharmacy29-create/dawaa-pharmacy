import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// Isolated PostgreSQL engine only. Synthetic ids/names; no URLs, secrets or application database.
const SOURCE = '11111111-1111-4111-8111-111111111111';
const OTHER_SOURCE = '11111111-1111-4111-8111-222222222222';
const CUSTOMER = '33333333-3333-4333-8333-333333333333';
const GM_STAFF = '44444444-4444-4444-8444-444444444444';
const BRANCH_STAFF = '44444444-4444-4444-8444-555555555555';
const INACTIVE_STAFF = '44444444-4444-4444-8444-666666666666';
const OTHER_BRANCH_STAFF = '44444444-4444-4444-8444-777777777777';
const PRODUCT = '55555555-5555-4555-8555-555555555555';
const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ANALYSIS = '66666666-6666-4666-8666-666666666666';
const CASE_ID = `${SOURCE}:interaction:0`;
const OLD_HASH = 'a'.repeat(64);
const NEW_HASH = 'b'.repeat(64);
const REQUEST_KEY = `cr1|${CASE_ID}:demand:product:${PRODUCT}`;
const REQUEST_IDENTITY = 'fu1|chat:x|2026-10-20T02:00:00.000Z|customer-request|cataflam';
const FOLLOWUP_IDENTITY = `fu1|chat:x|2026-10-20T02:00:00.000Z|customer-asked-to-wait|${PRODUCT}`;
const REASON = 'تصحيح مثال تجريبي: الموظفة الصحيحة وفرع المعاملة';

const FIXTURE = `
  alter table whatsapp_review_sources add column raw_text text, add column source_hash text unique,
    add column staff_name text, add column review_status text, add column reviewer_confirmed boolean,
    add column invoice_link_confirmed boolean, add column invoice_link_confirmed_invoice_id uuid,
    add column official_review_id uuid, add column updated_at timestamptz default now();
  alter table whatsapp_conversation_actions add column staff_id uuid, add column staff_name text,
    add column product_code text, add column confidence numeric,
    add constraint actions_source_key_uk unique(source_id, action_key);
  create table staff(id uuid primary key,name text,branch text,active boolean,is_active boolean);
  create table staff_accounts(id uuid primary key,name text,staff_name text,username text,role text);
  create table customers(id uuid primary key,name text);
  create table products(id uuid primary key,product_code text);
  create table customer_requests(id uuid primary key,customer_id uuid,product_id uuid,doctor_id uuid,branch text);
  create table whatsapp_review_audit(id bigserial primary key,source_id uuid,action text,actor_id text,
    actor_name text,actor_role text,before_state jsonb,after_state jsonb,note text,created_at timestamptz default now());
  create function dawaa_customer_request_branch_key(p_branch text) returns text language sql immutable as $$
    select case
      when lower(trim(coalesce(p_branch,''))) in ('فرع شكري','شكري','shokry','shoukry') then 'shokry'
      when lower(trim(coalesce(p_branch,''))) in ('فرع الشامي','الشامي','الشامى','elshamy','el-shamy','alshamy') then 'elshamy'
      when trim(coalesce(p_branch,'')) = '' then null
      else lower(trim(p_branch))
    end $$;
`;

function migration(suffix: string) {
  const file = readdirSync(resolve('supabase/migrations')).find((name) => name.endsWith(suffix));
  if (!file) throw new Error(`missing_migration:${suffix}`);
  return readFileSync(resolve('supabase/migrations', file), 'utf8');
}

let db: PGlite | null = null;

async function harness() {
  db = new PGlite();
  await db.exec(readFileSync(resolve('scripts/staging/fixtures/canonical-followup-lifecycle.sql'), 'utf8'));
  await db.exec(FIXTURE);
  await db.exec(migration('_canonical_followup_projection_lifecycle.sql'));
  await db.exec(migration('_customer_request_materialization_retry_v1.sql'));
  await db.exec(migration('_whatsapp_source_attribution_correction_v1.sql'));
  await db.exec(`
    insert into staff values
      ('${GM_STAFF}','د/ معاذ','كل الفروع',true,true),
      ('${BRANCH_STAFF}','د دنيا','فرع شكري',true,true),
      ('${INACTIVE_STAFF}','د/ دنيا','المخزن',false,false),
      ('${OTHER_BRANCH_STAFF}','د سارة','فرع الشامي',true,true);
    insert into staff_accounts values ('${ACTOR}','مراجع','مراجع','reviewer','admin');
    insert into customers values ('${CUSTOMER}','معاذ');
    insert into products values ('${PRODUCT}','28784');
    insert into whatsapp_review_sources(id,customer_id,customer_name,customer_code,branch,staff_id,staff_name,raw_text,source_hash)
      values ('${SOURCE}','${CUSTOMER}','د معاذ ش 13204','17','كل الفروع','${GM_STAFF}','د معاذ','old text','${OLD_HASH}'),
             ('${OTHER_SOURCE}','${CUSTOMER}','عميل آخر','18','فرع شكري','${BRANCH_STAFF}','د دنيا','other text','${'c'.repeat(64)}');
  `);
  await authorize(true);
  return db;
}

async function authorize(allowed: boolean) {
  await db!.exec(`set test.actor='${ACTOR}';set test.permission='${allowed}';
    set test.source_access='true';set test.branch_access='true';`);
}

async function publishRequest(status: 'qualified' | 'review_required', branch = 'فرع شكري') {
  const snapshot = {
    canonicalCustomerRequestAssessment: { requests: [{ requestKey: REQUEST_KEY, status, productId: PRODUCT }] },
    caseIntelligence: { followUp: { opportunities: [] } },
  };
  await db!.query(`insert into sales_intelligence_case_analyses(analysis_id,case_id,evidence_snapshot) values($1,$2,$3)
    on conflict(analysis_id) do update set evidence_snapshot=excluded.evidence_snapshot`, [ANALYSIS, CASE_ID, JSON.stringify(snapshot)]);
  await db!.query(`insert into sales_intelligence_cases(case_id,conversation_id,published_analysis_id) values($1,$2,$3)
    on conflict(case_id) do nothing`, [CASE_ID, SOURCE, ANALYSIS]);
  await db!.query('update whatsapp_review_sources set branch=$1 where id=$2', [branch, SOURCE]);
}

async function insertAction(row: Record<string, unknown>) {
  const record = {
    source_id: SOURCE, status: 'proposed', work_status: 'unassigned', auto_eligible: false,
    customer_id: CUSTOMER, customer_name: 'د معاذ ش 13204', evidence: ['m1', 'm2'], ...row,
  } as Record<string, unknown>;
  const keys = Object.keys(record);
  const result = await db!.query<{ id: string }>(
    `insert into whatsapp_conversation_actions(${keys.join(',')}) values(${keys.map((_, i) => `$${i + 1}`).join(',')}) returning id`,
    keys.map((key) => (['payload', 'evidence'].includes(key) ? JSON.stringify(record[key]) : record[key]))
  );
  return result.rows[0].id;
}

function canonicalRequest(branch: string, staffId = GM_STAFF) {
  return {
    action_type: 'customer_request', action_key: `canonical-request:${REQUEST_IDENTITY}`,
    followup_identity: REQUEST_IDENTITY, created_by: 'si-canonical-customer-request-projection-v1',
    branch, staff_id: staffId, product_id: PRODUCT, product_code: '28784', confidence: 90, quantity: 1,
    payload: { caseId: CASE_ID, requestKey: REQUEST_KEY, approvalRequired: true },
  };
}

function canonicalFollowup(branch: string) {
  return {
    action_type: 'customer_followup', action_key: `canonical-followup:${FOLLOWUP_IDENTITY}`,
    followup_identity: FOLLOWUP_IDENTITY, created_by: 'si-canonical-followup-projection-v1', status: 'ready',
    branch, product_id: PRODUCT, quantity: 1,
    payload: { canonicalProjectionVersion: 'si-canonical-followup-projection-v1', caseId: CASE_ID,
      canonicalReason: 'customer_asked_to_wait', canonicalLifecycle: 'active', canonicalAnalysisId: ANALYSIS },
  };
}

async function sql<T = Record<string, any>>(text: string, params: unknown[] = []) {
  return (await db!.query<T>(text, params)).rows;
}

async function errorOf(text: string, params: unknown[] = []) {
  try {
    await db!.query(text, params);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const correct = (overrides: Partial<Record<string, unknown>> = {}) => {
  const args = { expected: OLD_HASH, raw: 'corrected text', hash: NEW_HASH, staff: BRANCH_STAFF, branch: 'فرع شكري', reason: REASON, ...overrides };
  return [`select dawaa_correct_whatsapp_source_attribution_v1($1,$2,$3,$4,$5,$6,$7) result`,
    [SOURCE, args.expected, args.raw, args.hash, args.staff, args.branch, args.reason]] as const;
};

afterEach(async () => {
  await db?.close();
  db = null;
});

describe('transaction branch rule in the database', () => {
  it('matches the shared source rule for markers, real branches and diacritics', async () => {
    await harness();
    const rows = await sql<{ b: string; ok: boolean }>(`select b, dawaa_is_transaction_branch_v1(b) ok
      from unnest(array['كل الفروع','الكل','غير محدد','غير محدّد','All branches','',' ','فرع شكري','شكري','فرع الشامي']) b`);
    expect(Object.fromEntries(rows.map((row) => [row.b, row.ok]))).toEqual({
      'كل الفروع': false, 'الكل': false, 'غير محدد': false, 'غير محدّد': false, 'All branches': false,
      '': false, ' ': false, 'فرع شكري': true, 'شكري': true, 'فرع الشامي': true,
    });
    expect(await sql('select dawaa_is_transaction_branch_v1(null) ok')).toEqual([{ ok: false }]);
  });
});

describe('customer request approval and materialization guards', () => {
  it('refuses to approve a canonical request in account-wide scope even when source and action agree', async () => {
    await harness();
    await publishRequest('qualified', 'كل الفروع');
    const id = await insertAction(canonicalRequest('كل الفروع'));
    expect(await errorOf('select dawaa_approve_whatsapp_customer_request_action_v2($1)', [id]))
      .toContain('customer_request_action_transaction_branch_required');
    expect(await sql('select status,auto_eligible from whatsapp_conversation_actions where id=$1', [id]))
      .toEqual([{ status: 'proposed', auto_eligible: false }]);
    expect(await sql('select count(*)::int n from whatsapp_review_audit')).toEqual([{ n: 0 }]);
  });

  it('approves a canonical request only while the current analysis still qualifies it', async () => {
    await harness();
    await publishRequest('review_required');
    await db!.query('update whatsapp_review_sources set staff_id=$1 where id=$2', [BRANCH_STAFF, SOURCE]);
    const id = await insertAction(canonicalRequest('فرع شكري', BRANCH_STAFF));
    expect(await errorOf('select dawaa_approve_whatsapp_customer_request_action_v2($1)', [id]))
      .toContain('customer_request_requires_current_qualification');

    await publishRequest('qualified');
    await db!.query('select dawaa_approve_whatsapp_customer_request_action_v2($1)', [id]);
    expect(await sql(`select status,auto_eligible,payload->>'approvalSource' src from whatsapp_conversation_actions where id=$1`, [id]))
      .toEqual([{ status: 'ready', auto_eligible: true, src: 'human_review_v2' }]);

    // A re-analysis that withdraws the qualification makes the earlier approval non-executable.
    await publishRequest('review_required');
    expect(await errorOf('select dawaa_materialize_whatsapp_action_v1($1)', [id]))
      .toContain('customer_request_requires_current_qualification');
    await publishRequest('qualified');
    await db!.query('select dawaa_materialize_whatsapp_action_v1($1)', [id]);
    expect(await sql('select status from whatsapp_conversation_actions where id=$1', [id])).toEqual([{ status: 'created' }]);
  });

  it('never approves a request without a resolved responsible staff member', async () => {
    await harness();
    await publishRequest('qualified');
    await db!.query('update whatsapp_review_sources set staff_id=null where id=$1', [SOURCE]);
    const id = await insertAction({ ...canonicalRequest('فرع شكري'), staff_id: null });
    expect(await errorOf('select dawaa_approve_whatsapp_customer_request_action_v2($1)', [id]))
      .toContain('customer_request_action_canonical_identity_required');
    const inactive = await insertAction({ ...canonicalRequest('فرع شكري', INACTIVE_STAFF),
      action_key: 'canonical-request:inactive', followup_identity: 'inactive' });
    await db!.query('update whatsapp_review_sources set staff_id=$1 where id=$2', [INACTIVE_STAFF, SOURCE]);
    expect(await errorOf('select dawaa_approve_whatsapp_customer_request_action_v2($1)', [inactive]))
      .toContain('active_staff_required');
  });

  it('keeps the existing approval contract for legacy proposals in a real branch', async () => {
    await harness();
    await db!.query('update whatsapp_review_sources set branch=$1, staff_id=$2 where id=$3', ['فرع شكري', BRANCH_STAFF, SOURCE]);
    await db!.query('insert into sales_intelligence_cases(case_id,conversation_id) values($1,$2)', [CASE_ID, SOURCE]);
    const id = await insertAction({
      action_type: 'customer_request', action_key: 'customer-request', created_by: 'د معاذ', branch: 'فرع شكري',
      staff_id: BRANCH_STAFF, product_id: PRODUCT, product_code: '28784', confidence: 90, payload: {},
    });
    await db!.query('select dawaa_approve_whatsapp_customer_request_action_v2($1)', [id]);
    expect(await sql('select status from whatsapp_conversation_actions where id=$1', [id])).toEqual([{ status: 'ready' }]);
  });

  it('refuses to materialize any follow-up type into account-wide scope', async () => {
    await harness();
    for (const actionType of ['customer_followup', 'complaint_followup', 'recommendation_followup']) {
      const id = await insertAction({ action_type: actionType, action_key: `legacy-${actionType}`, status: 'ready',
        created_by: 'legacy', branch: 'كل الفروع', payload: {} });
      expect(await errorOf('select dawaa_materialize_whatsapp_action_v1($1)', [id]))
        .toContain('whatsapp_action_transaction_branch_required');
    }
    const ok = await insertAction({ action_type: 'customer_followup', action_key: 'legacy-real-branch', status: 'ready',
      created_by: 'legacy', branch: 'فرع شكري', payload: {} });
    await db!.query('select dawaa_materialize_whatsapp_action_v1($1)', [ok]);
    expect(await sql('select status from whatsapp_conversation_actions where id=$1', [ok])).toEqual([{ status: 'created' }]);
  });
});

describe('source attribution guard and rollback', () => {
  it('lets the browser fill blank attribution but not overwrite stored attribution', async () => {
    await harness();
    await db!.exec(`grant select, update on whatsapp_review_sources to authenticated;
      update whatsapp_review_sources set branch=null where id='${OTHER_SOURCE}';
      set role authenticated;`);
    await db!.query(`update whatsapp_review_sources set branch='فرع شكري', customer_name='ملء فقط' where id=$1`, [OTHER_SOURCE]);
    for (const patch of ["branch='فرع الشامي'", `staff_id='${BRANCH_STAFF}'`, "raw_text='edited'",
      `source_hash='${'f'.repeat(64)}'`, "customer_id=null"]) {
      expect(await errorOf(`update whatsapp_review_sources set ${patch} where id=$1`, [SOURCE]))
        .toContain('source_attribution_requires_correction_command');
    }
    await db!.exec('reset role;');
    expect(await sql('select branch,customer_name from whatsapp_review_sources where id=$1', [OTHER_SOURCE]))
      .toEqual([{ branch: 'فرع شكري', customer_name: 'ملء فقط' }]);
    expect(await sql('select branch,staff_id,raw_text from whatsapp_review_sources where id=$1', [SOURCE]))
      .toEqual([{ branch: 'كل الفروع', staff_id: GM_STAFF, raw_text: 'old text' }]);
  });

  it('rolls back to the exact previous command behavior without touching data', async () => {
    await harness();
    await publishRequest('qualified', 'كل الفروع');
    const id = await insertAction(canonicalRequest('كل الفروع'));
    const dataBefore = await sql('select * from whatsapp_conversation_actions order by id');
    await db!.exec(readFileSync(resolve(
      'docs/whatsapp-master-brain-lifecycle-v4-20261017/sql/rollback_20261020153000_source_attribution_correction_v1.sql'), 'utf8'));
    expect(await sql('select * from whatsapp_conversation_actions order by id')).toEqual(dataBefore);
    expect(await sql(`select count(*)::int n from pg_proc where proname in (
      'dawaa_correct_whatsapp_source_attribution_v1','dawaa_is_transaction_branch_v1',
      'dawaa_canonical_request_is_current_v1','dawaa_guard_whatsapp_source_attribution_v1')`)).toEqual([{ n: 0 }]);
    expect(await sql(`select count(*)::int n from pg_trigger where tgname='whatsapp_source_attribution_guard_v1'`))
      .toEqual([{ n: 0 }]);
    // The previous approval contract is back (it did not know the transaction-branch rule).
    await db!.query('select dawaa_approve_whatsapp_customer_request_action_v2($1)', [id]);
    expect(await sql('select status from whatsapp_conversation_actions where id=$1', [id])).toEqual([{ status: 'ready' }]);
    // And the forward migration re-applies cleanly after a rollback.
    await db!.exec(migration('_whatsapp_source_attribution_correction_v1.sql'));
    expect(await sql(`select count(*)::int n from pg_proc where proname='dawaa_correct_whatsapp_source_attribution_v1'`))
      .toEqual([{ n: 1 }]);
  });
});

describe('authorized source attribution correction', () => {
  async function seededCase() {
    await harness();
    await publishRequest('qualified', 'كل الفروع');
    const request = await insertAction(canonicalRequest('كل الفروع'));
    const followup = await insertAction(canonicalFollowup('كل الفروع'));
    const otherSourceAction = await insertAction({ source_id: OTHER_SOURCE, action_type: 'customer_followup',
      action_key: 'other-source', status: 'ready', created_by: 'legacy', branch: 'فرع شكري', payload: {} });
    return { request, followup, otherSourceAction };
  }

  it('corrects staff/branch/text, retires old proposals without deleting evidence, and audits once', async () => {
    const { request, followup, otherSourceAction } = await seededCase();
    const before = await sql(`select * from whatsapp_conversation_actions where id=$1`, [otherSourceAction]);
    const [{ result }] = await sql<{ result: any }>(...correct());
    expect(result).toMatchObject({ ok: true, changed: true, retiredActions: 2, reanalysisRequired: true });

    expect(await sql('select branch,staff_id,staff_name,customer_id,customer_code,source_hash,raw_text from whatsapp_review_sources where id=$1', [SOURCE]))
      .toEqual([{ branch: 'فرع شكري', staff_id: BRANCH_STAFF, staff_name: 'د دنيا', customer_id: CUSTOMER,
        customer_code: '17', source_hash: NEW_HASH, raw_text: 'corrected text' }]);
    const retired = await sql(`select id,status,auto_eligible,branch,staff_id,evidence,followup_identity,action_key,
      payload->>'supersededIdentity' old_identity, payload->>'canonicalWithdrawalReason' reason
      from whatsapp_conversation_actions where id in ($1,$2) order by action_type desc`, [request, followup]);
    expect(retired).toEqual([
      expect.objectContaining({ id: request, status: 'dismissed', auto_eligible: false, branch: 'كل الفروع',
        staff_id: GM_STAFF, evidence: ['m1', 'm2'], old_identity: REQUEST_IDENTITY,
        followup_identity: `${REQUEST_IDENTITY}|superseded:${request}`, reason: 'source_attribution_corrected' }),
      expect.objectContaining({ id: followup, status: 'dismissed', old_identity: FOLLOWUP_IDENTITY,
        followup_identity: `${FOLLOWUP_IDENTITY}|superseded:${followup}`, evidence: ['m1', 'm2'] }),
    ]);
    expect(await sql('select * from whatsapp_conversation_actions where id=$1', [otherSourceAction])).toEqual(before);
    const audit = await sql<{ action: string; note: string; before_state: any; after_state: any }>('select * from whatsapp_review_audit');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'source_attribution_corrected_v1', note: REASON });
    expect(audit[0].before_state).toMatchObject({ staff_id: GM_STAFF, branch: 'كل الفروع', raw_text: 'old text' });
    expect(audit[0].before_state.actions).toHaveLength(2);
    expect(audit[0].after_state).toMatchObject({ staff_id: BRANCH_STAFF, branch: 'فرع شكري', customer_id: CUSTOMER });

    // Exact replay is a no-op: no second audit, no further retirement.
    const [{ result: replay }] = await sql<{ result: any }>(...correct());
    expect(replay).toEqual({ ok: true, changed: false, sourceId: SOURCE, retiredActions: 0 });
    expect(await sql('select count(*)::int n from whatsapp_review_audit')).toEqual([{ n: 1 }]);
  });

  it('lets the next refresh project exactly one corrected request and re-activate one follow-up', async () => {
    await seededCase();
    await sql(...correct());
    await publishRequest('qualified', 'فرع شكري');
    // Same stable identities as before the correction; the freed identity accepts one new proposal.
    const corrected = await insertAction(canonicalRequest('فرع شكري', BRANCH_STAFF));
    expect(await errorOf(`insert into whatsapp_conversation_actions(source_id,action_key,action_type,followup_identity,status)
      values($1,$2,'customer_request',$3,'proposed')`, [SOURCE, `canonical-request:${REQUEST_IDENTITY}`, REQUEST_IDENTITY]))
      .toMatch(/duplicate key|unique/i);
    await db!.query('select dawaa_approve_whatsapp_customer_request_action_v2($1)', [corrected]);
    expect(await sql(`select count(*)::int n from whatsapp_conversation_actions where action_type='customer_request' and status in ('proposed','ready')`))
      .toEqual([{ n: 1 }]);

    const opportunity = { followUpKey: FOLLOWUP_IDENTITY, status: 'actionable', blocker: null, customerId: CUSTOMER, reason: 'customer_asked_to_wait' };
    await db!.query(`update sales_intelligence_case_analyses set evidence_snapshot=evidence_snapshot || $1 where analysis_id=$2`,
      [JSON.stringify({ caseIntelligence: { followUp: { opportunities: [opportunity] } } }), ANALYSIS]);
    const row = { ...canonicalFollowup('فرع شكري'), source_id: SOURCE, customer_id: CUSTOMER, customer_phone: null,
      product_name: 'CATAFLAM', due_at: null, reason: 'x', evidence: ['m1'], assigned_to_id: null, assigned_to_name: null };
    const reconcile = `select dawaa_reconcile_canonical_followup_actions_v1($1,$2,$3) result`;
    const args = [SOURCE, JSON.stringify({ [CASE_ID]: ANALYSIS }), JSON.stringify([row])];
    const [{ result: first }] = await sql<{ result: any }>(reconcile, args);
    expect(first).toMatchObject({ ok: true, inserted: 1, existing: 0 });
    const [{ result: second }] = await sql<{ result: any }>(reconcile, args);
    expect(second).toMatchObject({ ok: true, inserted: 0, existing: 1 });
    expect(await sql(`select branch from whatsapp_conversation_actions where followup_identity=$1`, [FOLLOWUP_IDENTITY]))
      .toEqual([{ branch: 'فرع شكري' }]);
  });

  it.each([
    ['no permission', { permission: false }, 'source_attribution_correction_permission_denied'],
    ['short reason', { reason: 'خطأ' }, 'source_attribution_correction_reason_required'],
    ['account-wide branch', { branch: 'كل الفروع' }, 'source_attribution_transaction_branch_required'],
    ['malformed hash', { hash: 'fallback-123' }, 'source_attribution_hash_invalid'],
    ['inactive staff', { staff: INACTIVE_STAFF }, 'active_staff_required'],
    ['staff from another branch', { staff: OTHER_BRANCH_STAFF }, 'source_attribution_staff_branch_mismatch'],
    ['customer as staff', { staff: CUSTOMER }, 'active_staff_required'],
    ['stale expected hash', { expected: 'd'.repeat(64) }, 'source_attribution_source_changed'],
    ['hash of another source', { hash: 'c'.repeat(64) }, 'source_attribution_hash_conflict'],
  ])('refuses %s and changes nothing', async (_label, overrides, message) => {
    const { request } = await seededCase();
    const { permission, ...args } = overrides as Record<string, unknown>;
    if (permission === false) await authorize(false);
    const sourceBefore = await sql('select * from whatsapp_review_sources order by id');
    const actionBefore = await sql('select * from whatsapp_conversation_actions where id=$1', [request]);
    expect(await errorOf(...correct(args))).toContain(message);
    expect(await sql('select * from whatsapp_review_sources order by id')).toEqual(sourceBefore);
    expect(await sql('select * from whatsapp_conversation_actions where id=$1', [request])).toEqual(actionBefore);
    expect(await sql('select count(*)::int n from whatsapp_review_audit')).toEqual([{ n: 0 }]);
  });

  it('refuses a customer id even if a staff row were ever created with it', async () => {
    await seededCase();
    await db!.query(`insert into staff values ($1,'عميل','فرع شكري',true,true)`, [CUSTOMER]);
    expect(await errorOf(...correct({ staff: CUSTOMER }))).toContain('source_attribution_staff_is_customer');
  });

  it.each([
    ['materialized', { status: 'created', target_table: 'customer_requests', target_id: '77777777-7777-4777-8777-777777777777' }],
    ['assigned', { work_status: 'in_progress' }],
    ['approved', { status: 'ready', auto_eligible: true }],
  ])('leaves a source with %s work for manual handling', async (_label, patch) => {
    const { request } = await seededCase();
    const sets = Object.keys(patch).map((key, i) => `${key}=$${i + 2}`).join(',');
    await db!.query(`update whatsapp_conversation_actions set ${sets} where id=$1`, [request, ...Object.values(patch)]);
    expect(await errorOf(...correct())).toContain('source_attribution_has_executed_or_approved_work');
    expect(await sql('select branch,staff_id from whatsapp_review_sources where id=$1', [SOURCE]))
      .toEqual([{ branch: 'كل الفروع', staff_id: GM_STAFF }]);
  });

  it('re-attributes again without reviving retired proposals or duplicating the corrected one', async () => {
    await seededCase();
    await sql(...correct());
    await publishRequest('qualified', 'فرع شكري');
    await insertAction(canonicalRequest('فرع شكري', BRANCH_STAFF));
    const [{ result }] = await sql<{ result: any }>(...correct({
      expected: NEW_HASH, hash: 'e'.repeat(64), raw: 'second correction', staff: GM_STAFF,
    }));
    expect(result).toMatchObject({ changed: true, retiredActions: 1 });
    expect(await sql(`select count(*)::int n from whatsapp_conversation_actions
      where source_id=$1 and status in ('proposed','ready')`, [SOURCE])).toEqual([{ n: 0 }]);
    expect(await sql(`select count(*)::int n from whatsapp_conversation_actions where source_id=$1`, [SOURCE]))
      .toEqual([{ n: 3 }]);
    expect(await sql('select count(*)::int n from whatsapp_review_audit')).toEqual([{ n: 2 }]);
  });

  it('keeps human confirmation untouched', async () => {
    await seededCase();
    await db!.query('update whatsapp_review_sources set reviewer_confirmed=true where id=$1', [SOURCE]);
    expect(await errorOf(...correct())).toContain('source_attribution_has_human_confirmation');
  });
});
