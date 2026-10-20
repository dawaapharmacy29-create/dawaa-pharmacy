import { afterEach, describe, expect, it } from 'vitest';
import { runSalesIntelligencePipeline } from '../../salesIntelligencePipeline';
import { buildCanonicalProduct, countNormalizedNames } from '../../pharmacyProducts/canonicalProduct';
import { buildPharmacyProductIndex } from '../../pharmacyProducts/pharmacyProductResolverV2';
import { normalizePharmacyText } from '../../pharmacyProducts/pharmacyNormalization';
import { mapCaseAnalysisRowContent } from '../mappers';
import { buildCanonicalCustomerRequestActionRows, projectCanonicalCustomerRequestsToActions } from '../canonicalCustomerRequestProjector';
import { projectCanonicalFollowupsToActions } from '../canonicalFollowupProjector';
import { buildSourceCorrectionPreview, type StoredSourceAttribution } from '../../operations/sourceCorrectionModel';
import { parseWhatsAppExport, serializeWhatsAppSessionRawText } from '@/lib/whatsappConversationParser';
import { segmentWhatsAppExportCanonical } from '@/lib/whatsappCanonicalSegmentation';
import { hashWhatsAppSession } from '@/lib/whatsappReviewPersistenceV4';
import type { StaffDirectoryIdentity } from '@/lib/readModels/staffDirectoryReadModel';
import {
  BRANCH_STAFF, CUSTOMER, GM_STAFF, PRODUCT, SOURCE, createHarness, type SourceAttributionHarness,
} from './sourceAttributionHarness';

// Full synthetic cycle in an isolated PostgreSQL engine: legacy wrong proposal -> refused approval
// -> audited correction through the UI model -> explicit re-analysis with the real pipeline and
// projectors -> approval -> execution -> second re-analysis -> no duplicate. No real customer,
// staff, product or conversation is used.

const FILE = 'TEST-SYNTHETIC-customer.txt';
const products = [
  { id: PRODUCT, name: 'CATAFLAM 50MG 20TAB', product_code: '28784' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'CATAFLAM 25MG 20TAB', product_code: '102' },
].map((row) => ({ ...row, normalized_name: row.name.toLowerCase(), category: null, price: null, source: 'synthetic' }));
const counts = countNormalizedNames(products);
const productIndex = buildPharmacyProductIndex(products.map((row) => buildCanonicalProduct(row, counts, normalizePharmacyText)));

const conversation = (intro: string) => [
  '[10/20/26, 5:00:00 AM] عميل تجريبي 17: السلام عليكم، عندكم كاتفلام 50 مجم أقراص؟ عايز علبة واحدة 20 قرص.',
  `[10/20/26, 5:00:30 AM] You: وعليكم السلام، مع حضرتك ${intro} من فرع شكري. كتافلام 50 مجم 20 قرص غير متوفر حاليًا.`,
  '[10/20/26, 5:01:00 AM] عميل تجريبي 17: تمام، سجل لي طلب علبة واحدة كاتفلام 50 مجم أقراص، وكلمني أول ما يتوفر. مش عايز بديل دلوقتي.',
  '[10/20/26, 5:01:30 AM] You: حاضر، هنراجع طلب توفير كتافلام 50 مجم أقراص ونتواصل مع حضرتك أول ما يتوفر.',
  '[10/20/26, 5:02:00 AM] عميل تجريبي 17: شكرًا، هنتظر تواصلكم.',
].join('\n');
const ORIGINAL = conversation('د معاذ');
const CORRECTED = conversation('د دنيا');

const directory: StaffDirectoryIdentity[] = [
  { id: GM_STAFF, name: 'د/ معاذ', branch: 'كل الفروع', role: 'مدير عام', username: null, status: null, active: true, source: 'staff' },
  { id: BRANCH_STAFF, name: 'د دنيا', branch: 'فرع شكري', role: 'صيدلاني', username: null, status: null, active: true, source: 'staff' },
];

async function session(text: string) {
  const [context] = segmentWhatsAppExportCanonical(parseWhatsAppExport(text), FILE).caseContexts.contexts;
  const s = context.mergedSession;
  return { raw: serializeWhatsAppSessionRawText(s), hash: await hashWhatsAppSession(s), startedAt: s.startedAt.toISOString(), endedAt: s.endedAt.toISOString(), count: s.messages.length };
}

function analyze(raw: string, branch: string, staffId: string) {
  return runSalesIntelligencePipeline({
    conversationId: SOURCE,
    rawWhatsAppExportText: raw,
    customerIdHint: CUSTOMER,
    customerIdentityStatus: 'resolved',
    branchNameRawHint: branch,
    knownStaffIds: [staffId],
    productIndex,
    resolveInvoiceCandidates: () => [],
  }).caseAnalyses;
}

/** Minimal Supabase-shaped adapter over the isolated engine for the real projectors. */
function client(t: SourceAttributionHarness) {
  const run = async (text: string, params: unknown[]) => {
    try {
      return { data: (await t.db.query(text, params)).rows, error: null };
    } catch (error: any) {
      return { data: null, error: { message: String(error?.message ?? error), code: String(error?.code ?? '') } };
    }
  };
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name !== 'dawaa_reconcile_canonical_followup_actions_v1') throw new Error(`unexpected_rpc:${name}`);
      const result = await run('select dawaa_reconcile_canonical_followup_actions_v1($1,$2,$3) r',
        [args.p_source_id, JSON.stringify(args.p_analysis_ids), JSON.stringify(args.p_rows)]);
      return { data: result.data?.[0]?.r ?? null, error: result.error };
    },
    from: (table: string) => {
      if (table !== 'whatsapp_conversation_actions') throw new Error(`unexpected_table:${table}`);
      return {
        select: (columns: string) => ({
          in: (column: string, values: unknown[]) =>
            run(`select ${columns} from whatsapp_conversation_actions where ${column} = any($1)`, [values]),
          eq: (column: string, value: unknown) => ({
            maybeSingle: async () => {
              const result = await run(`select ${columns} from whatsapp_conversation_actions where ${column} = $1`, [value]);
              return { data: result.data?.[0] ?? null, error: result.error };
            },
          }),
        }),
        insert: async (row: Record<string, unknown>) => {
          const keys = Object.keys(row);
          const result = await run(
            `insert into whatsapp_conversation_actions(${keys.join(',')}) values(${keys.map((_, i) => `$${i + 1}`).join(',')})`,
            keys.map((key) => (['payload', 'evidence'].includes(key) ? JSON.stringify(row[key]) : row[key]))
          );
          return { error: result.error };
        },
      };
    },
  };
}

async function publishAndProject(t: SourceAttributionHarness, analysisId: string, raw: string, branch: string, staffId: string) {
  const analyses = analyze(raw, branch, staffId);
  expect(analyses).toHaveLength(1);
  const [analysis] = analyses;
  await t.db.query('update sales_intelligence_case_analyses set is_current=false where case_id=$1', [analysis.caseId]);
  await t.db.query('insert into sales_intelligence_case_analyses(analysis_id,case_id,evidence_snapshot) values($1,$2,$3)',
    [analysisId, analysis.caseId, JSON.stringify(mapCaseAnalysisRowContent(analysis).evidenceSnapshot)]);
  await t.db.query(`insert into sales_intelligence_cases(case_id,conversation_id,published_analysis_id) values($1,$2,$3)
    on conflict(case_id) do update set published_analysis_id=excluded.published_analysis_id,is_active=true`, [analysis.caseId, SOURCE, analysisId]);
  const [source] = await t.sql<any>('select id,raw_text,customer_name,customer_code,staff_id from whatsapp_review_sources where id=$1', [SOURCE]);
  const requests = await projectCanonicalCustomerRequestsToActions(client(t), analyses, [source]);
  const followups = await projectCanonicalFollowupsToActions(client(t), analyses, [source], [
    { sourceId: SOURCE, analysisIds: { [analysis.caseId]: analysisId } },
  ]);
  return { analysis, requests, followups };
}

let h: SourceAttributionHarness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

describe('synthetic end-to-end source correction cycle', () => {
  it('goes from a wrong legacy proposal to exactly one correct request and follow-up, twice-refreshed', async () => {
    const t = (h = await createHarness());
    const original = await session(ORIGINAL);
    await t.db.exec('set session_replication_role=replica;');
    await t.db.query('update whatsapp_review_sources set raw_text=$1,source_hash=$2,conversation_started_at=$3,conversation_ended_at=$4 where id=$5',
      [original.raw, original.hash, original.startedAt, original.endedAt, SOURCE]);
    await t.db.exec('set session_replication_role=origin;');

    // 1) v36 analysis of the stored wrong attribution («كل الفروع», general manager): nothing executable.
    const wrong = analyze(original.raw, 'كل الفروع', GM_STAFF)[0];
    expect(wrong.customerRequestAssessment?.requests[0]).toMatchObject({ status: 'review_required', blockers: ['branch_unknown'] });
    expect(wrong.followUp.opportunities.filter((o) => o.status === 'actionable')).toHaveLength(0);
    const [sourceRow] = await t.sql<any>('select id,raw_text,customer_name,customer_code,staff_id from whatsapp_review_sources where id=$1', [SOURCE]);
    expect(buildCanonicalCustomerRequestActionRows([wrong], [sourceRow]).rows).toEqual([]);

    // 2) The live-like legacy proposal written before v36 stays unapprovable.
    const legacy = await t.insertAction({
      action_type: 'customer_request', action_key: 'canonical-request:legacy', followup_identity: 'legacy-identity',
      created_by: 'si-canonical-customer-request-projection-v1', branch: 'كل الفروع', staff_id: GM_STAFF,
      product_id: PRODUCT, product_code: '28784', confidence: 80, quantity: 1,
      payload: { caseId: wrong.caseId, requestKey: wrong.customerRequestAssessment?.requests[0].requestKey },
    }, true);
    expect(await t.errorOf('select dawaa_approve_whatsapp_customer_request_action_v2($1)', [legacy]))
      .toContain('customer_request_action_transaction_branch_required');

    // 3) Audited correction through the same model the screen uses; the database re-verifies the hash.
    const stored: StoredSourceAttribution = {
      id: SOURCE, sourceFilename: FILE, sourceHash: original.hash, rawText: original.raw, staffId: GM_STAFF, staffName: 'د معاذ',
      branch: 'كل الفروع', customerId: CUSTOMER, customerCode: '17', customerName: 'عميل تجريبي',
      conversationStartedAt: original.startedAt, conversationEndedAt: original.endedAt, messageCount: original.count, reviewStatus: null,
    };
    const preview = await buildSourceCorrectionPreview(stored,
      { rawText: CORRECTED, staffId: BRANCH_STAFF, branch: 'فرع شكري', reason: 'تصحيح مثال تجريبي إلى د دنيا فرع شكري' }, directory);
    expect('rawText' in preview).toBe(true);
    if (!('rawText' in preview)) return;
    expect(preview.changedLines).toHaveLength(1);
    const correction = async () => (await t.sql<{ r: any }>(
      'select dawaa_correct_whatsapp_source_attribution_v1($1,$2,$3,$4,$5,$6,$7,$8) r',
      [SOURCE, original.hash, preview.rawText, preview.sourceHash, preview.staffId, preview.branch, preview.reason, preview.crossBranchCover]))[0].r;
    expect(await correction()).toMatchObject({ ok: true, changed: true, retiredActions: 1 });
    expect(await correction()).toMatchObject({ ok: true, changed: false });

    // 4) Explicit re-analysis #1 with the real pipeline and projectors.
    const first = await publishAndProject(t, '77777777-7777-4777-8777-000000000001', preview.rawText, 'فرع شكري', BRANCH_STAFF);
    expect(first.requests).toMatchObject({ inserted: 1, existing: 0 });
    expect(first.followups).toMatchObject({ inserted: 1, existing: 0 });
    const active = await t.sql<any>(`select id,action_type,status,branch,staff_id,customer_id,product_id,product_code,quantity::int quantity
      from whatsapp_conversation_actions where source_id=$1 and status in ('proposed','ready') order by action_type`, [SOURCE]);
    expect(active).toEqual([
      expect.objectContaining({ action_type: 'customer_followup', status: 'ready', branch: 'فرع شكري', customer_id: CUSTOMER, product_id: PRODUCT }),
      expect.objectContaining({ action_type: 'customer_request', status: 'proposed', branch: 'فرع شكري', staff_id: BRANCH_STAFF,
        customer_id: CUSTOMER, product_id: PRODUCT, product_code: '28784', quantity: 1 }),
    ]);
    const requestAction = active.find((row) => row.action_type === 'customer_request').id;
    const followupAction = active.find((row) => row.action_type === 'customer_followup').id;

    // 5) Explicit approval and execution.
    await t.db.query('select dawaa_approve_whatsapp_customer_request_action_v2($1)', [requestAction]);
    const [{ r: executed }] = await t.sql<{ r: any }>('select dawaa_materialize_whatsapp_action_v1($1) r', [requestAction]);
    const [{ r: followupExecuted }] = await t.sql<{ r: any }>('select dawaa_materialize_whatsapp_action_v1($1) r', [followupAction]);
    expect(executed).toMatchObject({ ok: true, already_created: false });
    expect(followupExecuted).toMatchObject({ ok: true, already_created: false });

    // 6) Explicit re-analysis #2 (new analysis version): no duplicate request, follow-up or proposal.
    const second = await publishAndProject(t, '77777777-7777-4777-8777-000000000002', preview.rawText, 'فرع شكري', BRANCH_STAFF);
    expect(second.requests).toMatchObject({ inserted: 0, existing: 1 });
    expect(second.followups).toMatchObject({ inserted: 0 });
    expect(await t.sql('select customer_id,product_id,doctor_id,branch from customer_requests')).toEqual([
      { customer_id: CUSTOMER, product_id: PRODUCT, doctor_id: BRANCH_STAFF, branch: 'فرع شكري' },
    ]);
    expect(await t.sql(`select action_type,status,count(*)::int n from whatsapp_conversation_actions where source_id=$1
      group by 1,2 order by 1,2`, [SOURCE])).toEqual([
      { action_type: 'customer_followup', status: 'created', n: 1 },
      { action_type: 'customer_request', status: 'created', n: 1 },
      { action_type: 'customer_request', status: 'dismissed', n: 1 },
    ]);
    // Retrying execution is a read of the same target.
    const [{ r: retry }] = await t.sql<{ r: any }>('select dawaa_materialize_whatsapp_action_v1($1) r', [requestAction]);
    expect(retry).toMatchObject({ ok: true, already_created: true, target_id: executed.target_id });
    expect(await t.sql(`select count(*)::int n from whatsapp_review_audit where action='source_attribution_corrected_v1'`)).toEqual([{ n: 1 }]);
  }, 60_000);
});
