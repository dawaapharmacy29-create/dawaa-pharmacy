import { PGlite } from '@electric-sql/pglite';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Isolated PostgreSQL engine only. Synthetic ids/names; no URLs, secrets or application database.
export const SOURCE = '11111111-1111-4111-8111-111111111111';
export const OTHER_SOURCE = '11111111-1111-4111-8111-222222222222';
export const CUSTOMER = '33333333-3333-4333-8333-333333333333';
export const GM_STAFF = '44444444-4444-4444-8444-444444444444';
export const BRANCH_STAFF = '44444444-4444-4444-8444-555555555555';
export const INACTIVE_STAFF = '44444444-4444-4444-8444-666666666666';
export const OTHER_BRANCH_STAFF = '44444444-4444-4444-8444-777777777777';
export const WAREHOUSE_STAFF = '44444444-4444-4444-8444-888888888888';
export const PRODUCT = '55555555-5555-4555-8555-555555555555';
export const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const ANALYSIS = '66666666-6666-4666-8666-666666666666';
export const CASE_ID = `${SOURCE}:interaction:0`;
export const STARTED_AT = '2026-10-20T02:00:00.000Z';
export const ENDED_AT = '2026-10-20T02:02:00.000Z';
export const OLD_RAW = 'old text';
export const REQUEST_KEY = `cr1|${CASE_ID}:demand:product:${PRODUCT}`;
export const REQUEST_IDENTITY = 'fu1|chat:x|2026-10-20T02:00:00.000Z|customer-request|cataflam';
export const FOLLOWUP_IDENTITY = `fu1|chat:x|2026-10-20T02:00:00.000Z|customer-asked-to-wait|${PRODUCT}`;
export const REASON = 'تصحيح مثال تجريبي: الموظفة الصحيحة وفرع المعاملة';
export const CANONICAL_REQUEST_CREATOR = 'si-canonical-customer-request-projection-v1';

/** Same digest as hashWhatsAppSession and the database command. */
export function hashOf(raw: string, startedAt = STARTED_AT, endedAt = ENDED_AT) {
  return createHash('sha256').update(`${startedAt}|${endedAt}|${raw}`, 'utf8').digest('hex');
}
export const OLD_HASH = hashOf(OLD_RAW);

const FIXTURE = readFileSync(resolve('scripts/staging/fixtures/source-attribution-correction.sql'), 'utf8');

export function migration(suffix: string) {
  const file = readdirSync(resolve('supabase/migrations')).find((name) => name.endsWith(suffix));
  if (!file) throw new Error(`missing_migration:${suffix}`);
  return readFileSync(resolve('supabase/migrations', file), 'utf8');
}

export function opsScript(name: string) {
  return readFileSync(resolve('docs/whatsapp-master-brain-lifecycle-v4-20261017/sql', name), 'utf8');
}

export async function createHarness() {
  const db = new PGlite();
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
      ('${OTHER_BRANCH_STAFF}','د سارة','فرع الشامي',true,true),
      ('${WAREHOUSE_STAFF}','د مخزن','المخزن',true,true);
    insert into staff_accounts values ('${ACTOR}','مراجع','مراجع','reviewer','admin');
    insert into customers values ('${CUSTOMER}','عميل تجريبي');
    insert into products values ('${PRODUCT}','28784');
    insert into whatsapp_review_sources(id,customer_id,customer_name,customer_code,branch,staff_id,staff_name,raw_text,source_hash,
      conversation_started_at,conversation_ended_at)
      values ('${SOURCE}','${CUSTOMER}','عميل تجريبي','17','كل الفروع','${GM_STAFF}','د معاذ','${OLD_RAW}','${OLD_HASH}','${STARTED_AT}','${ENDED_AT}'),
             ('${OTHER_SOURCE}','${CUSTOMER}','عميل آخر','18','فرع شكري','${BRANCH_STAFF}','د دنيا','other text','${hashOf('other text')}','${STARTED_AT}','${ENDED_AT}');
  `);
  const h = {
    db,
    async authorize(allowed = true) {
      await db.exec(`set test.actor='${ACTOR}';set test.permission='${allowed}';
        set test.source_access='true';set test.branch_access='true';`);
    },
    async sql<T = Record<string, any>>(text: string, params: unknown[] = []) {
      return (await db.query<T>(text, params)).rows;
    },
    async errorOf(text: string, params: unknown[] = []) {
      try {
        await db.query(text, params);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    /** Publishes a current analysis snapshot for the synthetic case and sets the source branch. */
    async publish(snapshot: Record<string, unknown>, branch: string | null = null, analysisId = ANALYSIS) {
      await db.query('update sales_intelligence_case_analyses set is_current=false where case_id=$1 and analysis_id<>$2', [CASE_ID, analysisId]);
      await db.query(`insert into sales_intelligence_case_analyses(analysis_id,case_id,evidence_snapshot) values($1,$2,$3)
        on conflict(analysis_id) do update set evidence_snapshot=excluded.evidence_snapshot,is_current=true`,
      [analysisId, CASE_ID, JSON.stringify(snapshot)]);
      await db.query(`insert into sales_intelligence_cases(case_id,conversation_id,published_analysis_id) values($1,$2,$3)
        on conflict(case_id) do update set published_analysis_id=excluded.published_analysis_id`, [CASE_ID, SOURCE, analysisId]);
      if (branch !== null) {
        await db.exec(`set session_replication_role=replica;`);
        await db.query('update whatsapp_review_sources set branch=$1 where id=$2', [branch, SOURCE]);
        await db.exec(`set session_replication_role=origin;`);
      }
    },
    /** Inserts an action; `preexisting` simulates rows written before this migration's triggers. */
    async insertAction(row: Record<string, unknown>, preexisting = false) {
      const record = {
        source_id: SOURCE, status: 'proposed', work_status: 'unassigned', auto_eligible: false,
        customer_id: CUSTOMER, customer_name: 'عميل تجريبي', evidence: ['m1', 'm2'], ...row,
      } as Record<string, unknown>;
      const keys = Object.keys(record);
      if (preexisting) await db.exec('set session_replication_role=replica;');
      try {
        const result = await db.query<{ id: string }>(
          `insert into whatsapp_conversation_actions(${keys.join(',')}) values(${keys.map((_, i) => `$${i + 1}`).join(',')}) returning id`,
          keys.map((key) => (['payload', 'evidence'].includes(key) ? JSON.stringify(record[key]) : record[key]))
        );
        return result.rows[0].id;
      } finally {
        if (preexisting) await db.exec('set session_replication_role=origin;');
      }
    },
    correctCall(overrides: Partial<Record<string, unknown>> = {}) {
      const raw = (overrides.raw as string) ?? 'corrected text';
      const args = {
        expected: OLD_HASH, raw, hash: hashOf(raw), staff: BRANCH_STAFF, branch: 'فرع شكري', reason: REASON, cover: false,
        ...overrides,
      };
      return [`select dawaa_correct_whatsapp_source_attribution_v1($1,$2,$3,$4,$5,$6,$7,$8) result`,
        [SOURCE, args.expected, args.raw, args.hash, args.staff, args.branch, args.reason, args.cover]] as const;
    },
    close: () => db.close(),
  };
  await h.authorize(true);
  return h;
}

export type SourceAttributionHarness = Awaited<ReturnType<typeof createHarness>>;

export function qualifiedSnapshot(status: 'qualified' | 'review_required' = 'qualified', participants: unknown[] = []) {
  return {
    canonicalCustomerRequestAssessment: { requests: [{ requestKey: REQUEST_KEY, status, productId: PRODUCT }] },
    caseIntelligence: { followUp: { opportunities: [] }, staff: { participants, facts: [] } },
  };
}

export function canonicalRequestRow(branch: string, staffId = GM_STAFF) {
  return {
    action_type: 'customer_request', action_key: `canonical-request:${REQUEST_IDENTITY}`,
    followup_identity: REQUEST_IDENTITY, created_by: CANONICAL_REQUEST_CREATOR,
    branch, staff_id: staffId, product_id: PRODUCT, product_code: '28784', confidence: 90, quantity: 1,
    payload: { caseId: CASE_ID, requestKey: REQUEST_KEY, approvalRequired: true },
  };
}

export function canonicalFollowupRow(branch: string) {
  return {
    action_type: 'customer_followup', action_key: `canonical-followup:${FOLLOWUP_IDENTITY}`,
    followup_identity: FOLLOWUP_IDENTITY, created_by: 'si-canonical-followup-projection-v1', status: 'ready',
    branch, product_id: PRODUCT, quantity: 1,
    payload: { canonicalProjectionVersion: 'si-canonical-followup-projection-v1', caseId: CASE_ID,
      canonicalReason: 'customer_asked_to_wait', canonicalLifecycle: 'active', canonicalAnalysisId: ANALYSIS },
  };
}
