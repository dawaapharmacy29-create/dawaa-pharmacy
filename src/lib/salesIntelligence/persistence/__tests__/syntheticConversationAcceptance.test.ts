import { afterEach, describe, expect, it, vi } from 'vitest';
// Directory lookups are the only stubs: the branch-hint fallback resolvers would query Supabase.
vi.mock('@/lib/whatsappSmartReviewOwnership', () => ({ buildSmartOwnershipTimeline: () => ({ episodes: [], verifiedStaff: [] }) }));
vi.mock('@/lib/whatsappStaffResolverV6', () => ({ resolveWhatsAppStaffV6: vi.fn(async () => ({ staff: null })) }));
import { extractIntroducedStaffName, parseWhatsAppExport } from '@/lib/whatsappConversationParser';
import { segmentWhatsAppExportCanonical } from '@/lib/whatsappCanonicalSegmentation';
import { resolveConversationBranchHint } from '@/lib/whatsappConversationBranchHint';
import { persistAnalyzedWhatsAppSession, readStoredSourceBranch } from '@/lib/whatsappReviewPersistenceV4';
import type { WhatsAppParticipantRoleModelV15 } from '@/lib/whatsappParticipantRoleResolverV15';
import { runSalesIntelligencePipeline } from '../../salesIntelligencePipeline';
import { buildCanonicalProduct, countNormalizedNames } from '../../pharmacyProducts/canonicalProduct';
import { buildPharmacyProductIndex } from '../../pharmacyProducts/pharmacyProductResolverV2';
import { normalizePharmacyText } from '../../pharmacyProducts/pharmacyNormalization';
import { reviewSourceRowToBatchConversation } from '../reviewSourceBatchAdapter';
import { mapCaseAnalysisRowContent } from '../mappers';
import { projectCanonicalCustomerRequestsToActions } from '../canonicalCustomerRequestProjector';
import { projectCanonicalFollowupsToActions } from '../canonicalFollowupProjector';
import { createHarness, type SourceAttributionHarness } from './sourceAttributionHarness';

// ACCEPTANCE — one synthetic conversation through the real read -> segment -> identity -> persist
// -> canonical analysis -> projection path, in isolated PostgreSQL. Independent synthetic customer,
// doctor and product; no real customer, invoice or Production data.

const FILE = 'ACCEPTANCE-synthetic-customer.txt';
const CUSTOMER = '9a000000-0000-4000-8000-000000000001';
const DOCTOR = '9a000000-0000-4000-8000-000000000002';
const PRODUCT = '9a000000-0000-4000-8000-000000000003';
const directory = [{ id: DOCTOR, name: 'د هالة', branch: 'فرع الشامي', active: true }];

const EXPORT = [
  '[11/02/26, 10:00:00 AM] عميل قبول تجريبي: صباح الخير، عندكم كاتفلام 50 مجم أقراص؟ محتاج علبتين.',
  '[11/02/26, 10:00:40 AM] You: صباح النور، مع حضرتك د هالة من فرع الشامي. كتافلام 50 مجم أقراص غير متوفر حاليًا.',
  '[11/02/26, 10:01:20 AM] عميل قبول تجريبي: طيب سجل لي طلب علبتين كاتفلام 50 مجم أقراص، وكلمني أول ما يتوفر. مش عايز بديل.',
  '[11/02/26, 10:02:00 AM] You: حاضر، سجلت طلب توفير علبتين كتافلام 50 مجم أقراص وهتواصل مع حضرتك أول ما يتوفر.',
  '[11/02/26, 10:02:30 AM] عميل قبول تجريبي: شكرًا جدًا.',
].join('\n');

const products = [
  { id: PRODUCT, name: 'CATAFLAM 50MG 20TAB', product_code: '90001' },
  { id: '9a000000-0000-4000-8000-000000000004', name: 'CATAFLAM 25MG 20TAB', product_code: '90002' },
].map((row) => ({ ...row, normalized_name: row.name.toLowerCase(), category: null, price: null, source: 'synthetic' }));
const counts = countNormalizedNames(products);
const productIndex = buildPharmacyProductIndex(products.map((row) => buildCanonicalProduct(row, counts, normalizePharmacyText)));

/** In-memory persistence client (unique source_hash) for the real persistAnalyzedWhatsAppSession. */
function memoryClient() {
  const tables: Record<string, Record<string, any>[]> = { whatsapp_review_sources: [], whatsapp_review_audit: [], whatsapp_review_source_hash_aliases: [] };
  let seq = 0;
  return {
    tables,
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let inserted: Record<string, any> | null = null;
      let failure: Record<string, any> | null = null;
      const match = () => (tables[table] || []).filter((row) => filters.every(([k, v]) => row[k] === v));
      const chain: any = {
        select: () => chain,
        eq: (k: string, v: unknown) => { filters.push([k, v]); return chain; },
        maybeSingle: async () => ({ data: match()[0] ?? null, error: null }),
        single: async () => (inserted ? { data: inserted, error: null } : failure ? { data: null, error: failure } : { data: match()[0] ?? null, error: null }),
        insert: (row: Record<string, any>) => {
          if (table === 'whatsapp_review_sources' && tables[table].some((r) => r.source_hash === row.source_hash)) {
            failure = { code: '23505', message: 'duplicate source_hash' };
          } else {
            inserted = { id: `9b000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, ...row };
            (tables[table] ||= []).push(inserted);
          }
          return chain;
        },
        then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
      };
      return chain;
    },
  };
}

/** Minimal Supabase-shaped adapter over the isolated engine for the real projectors. */
function pgClient(t: SourceAttributionHarness) {
  const run = async (text: string, params: unknown[]) => {
    try { return { data: (await t.db.query(text, params)).rows, error: null }; }
    catch (error: any) { return { data: null, error: { message: String(error?.message ?? error), code: String(error?.code ?? '') } }; }
  };
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      const result = await run(`select ${name}($1,$2,$3) r`, [args.p_source_id, JSON.stringify(args.p_analysis_ids), JSON.stringify(args.p_rows)]);
      return { data: result.data?.[0]?.r ?? null, error: result.error };
    },
    from: () => ({
      select: (columns: string) => ({
        in: (column: string, values: unknown[]) => run(`select ${columns} from whatsapp_conversation_actions where ${column} = any($1)`, [values]),
        eq: (column: string, value: unknown) => ({
          maybeSingle: async () => {
            const r = await run(`select ${columns} from whatsapp_conversation_actions where ${column} = $1`, [value]);
            return { data: r.data?.[0] ?? null, error: r.error };
          },
        }),
      }),
      insert: async (row: Record<string, unknown>) => {
        const keys = Object.keys(row);
        const r = await run(`insert into whatsapp_conversation_actions(${keys.join(',')}) values(${keys.map((_, i) => `$${i + 1}`).join(',')})`,
          keys.map((k) => (['payload', 'evidence'].includes(k) ? JSON.stringify(row[k]) : row[k])));
        return { error: r.error };
      },
    }),
  };
}

let h: SourceAttributionHarness | null = null;
afterEach(async () => { await h?.close(); h = null; });

describe('synthetic conversation acceptance (expected vs actual)', () => {
  it('delivers identity, need, request, follow-up and no sale to the right destinations, once', async () => {
    // 1) Read + canonical segmentation.
    const messages = parseWhatsAppExport(EXPORT);
    expect(messages).toHaveLength(5);
    const contexts = segmentWhatsAppExportCanonical(messages, FILE).caseContexts.contexts;
    expect(contexts).toHaveLength(1);
    const session = contexts[0].mergedSession;

    // 2) Doctor and transaction branch from the conversation itself (customer never mistaken for staff).
    const introduced = session.messages.map((m) => extractIntroducedStaffName(m)).filter(Boolean);
    expect(introduced).toEqual(['هالة']);
    const roles = { staff: [] } as unknown as WhatsAppParticipantRoleModelV15;
    const memory = memoryClient();
    const branchHint = await resolveConversationBranchHint(session, roles, await readStoredSourceBranch(session, memory));
    expect(branchHint).toMatchObject({ value: 'فرع الشامي', source: 'explicit_introduction' });
    const doctor = directory.filter((row) => row.active && row.name === `د ${introduced[0]}`);
    expect(doctor).toHaveLength(1); // exact, unique directory match

    // 3) Real persistence: one source; re-ingest of the same export is the same source.
    const intelligence = { version: 'acceptance', confidence: 90, requiresHumanApproval: false, priority: 'normal' } as any;
    const context = { sourceFileName: FILE, branch: branchHint.value, customerId: CUSTOMER, customerCode: 'TEST-ACC-01',
      customerName: 'عميل قبول تجريبي', staffId: DOCTOR, staffName: doctor[0].name };
    const first = await persistAnalyzedWhatsAppSession(session, intelligence, context, { client: memory });
    const again = await persistAnalyzedWhatsAppSession(session, intelligence, context, { client: memory });
    expect(first.duplicate).toBe(false);
    expect(again).toMatchObject({ id: first.id, duplicate: true });
    expect(memory.tables.whatsapp_review_sources).toHaveLength(1);
    const row = memory.tables.whatsapp_review_sources[0];
    expect(row).toMatchObject({ customer_id: CUSTOMER, staff_id: DOCTOR, branch: 'فرع الشامي', message_count: 5 });
    expect(row.customer_id).not.toBe(row.staff_id);
    expect(row.source_hash).toMatch(/^[0-9a-f]{64}$/);

    // 4) Real source -> pipeline adapter + canonical analysis (customer identity resolved by the canonical resolver).
    const analyze = () => runSalesIntelligencePipeline({
      ...reviewSourceRowToBatchConversation(row as any),
      customerIdentityStatus: 'resolved',
      productIndex,
      resolveInvoiceCandidates: () => [],
    }).caseAnalyses;
    const analyses = analyze();
    expect(analyses).toHaveLength(1);
    const [analysis] = analyses;
    expect(analysis.caseId).toBe(`${first.id}:interaction:0`);
    expect(analysis.conversationCase).toMatchObject({ customerId: CUSTOMER, branchNameRaw: 'فرع الشامي' });
    const need = analysis.customerNeed.products;
    expect(need).toHaveLength(1);
    expect(need[0]).toMatchObject({ productId: PRODUCT, productCode: '90001', requestedQuantity: 2, availability: 'unavailable' });
    expect(need[0].roles).not.toContain('alternative');
    expect(analysis.customerRequestAssessment?.requests).toEqual([
      expect.objectContaining({ status: 'qualified', productId: PRODUCT, quantity: 2, customerId: CUSTOMER, blockers: [] }),
    ]);
    const actionable = analysis.followUp.opportunities.filter((o) => o.status === 'actionable');
    expect(actionable).toHaveLength(1);
    expect(actionable[0]).toMatchObject({ productId: PRODUCT, duePolicy: 'when_in_stock', dueAt: null, customerId: CUSTOMER });
    expect(actionable[0].evidenceMessageIds.length).toBeGreaterThan(0);
    expect(analysis.salesOutcome).toMatchObject({ isSaleCountable: false, isRevenueCountable: false });
    expect(analysis.salesOutcome.outcome).not.toBe('sale_proven');

    // 5) Isolated PostgreSQL with the applied migration: real projectors publish proposals.
    const t = (h = await createHarness());
    await t.db.query(`insert into staff values ($1,'د هالة','فرع الشامي',true,true) on conflict do nothing`, [DOCTOR]);
    await t.db.query(`insert into whatsapp_review_sources(id,customer_id,customer_name,customer_code,branch,staff_id,staff_name,raw_text,source_hash,conversation_started_at,conversation_ended_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [first.id, CUSTOMER, row.customer_name, row.customer_code, row.branch, DOCTOR, row.staff_name,
      row.raw_text, row.source_hash, row.conversation_started_at, row.conversation_ended_at]);
    const publishAndProject = async (analysisId: string) => {
      const current = analyze();
      await t.db.query('update sales_intelligence_case_analyses set is_current=false where case_id=$1', [current[0].caseId]);
      await t.db.query('insert into sales_intelligence_case_analyses(analysis_id,case_id,evidence_snapshot) values($1,$2,$3)',
        [analysisId, current[0].caseId, JSON.stringify(mapCaseAnalysisRowContent(current[0]).evidenceSnapshot)]);
      await t.db.query(`insert into sales_intelligence_cases(case_id,conversation_id,published_analysis_id) values($1,$2,$3)
        on conflict(case_id) do update set published_analysis_id=excluded.published_analysis_id`, [current[0].caseId, first.id, analysisId]);
      const [source] = await t.sql<any>('select id,raw_text,customer_name,customer_code,staff_id from whatsapp_review_sources where id=$1', [first.id]);
      return {
        requests: await projectCanonicalCustomerRequestsToActions(pgClient(t), current, [source]),
        followups: await projectCanonicalFollowupsToActions(pgClient(t), current, [source], [{ sourceId: first.id, analysisIds: { [current[0].caseId]: analysisId } }]),
      };
    };
    const firstRun = await publishAndProject('9c000000-0000-4000-8000-000000000001');
    expect(firstRun.requests).toMatchObject({ inserted: 1, existing: 0 });
    expect(firstRun.followups).toMatchObject({ inserted: 1, existing: 0 });
    const actions = await t.sql<any>(`select action_type,status,branch,staff_id,customer_id,product_id,product_code,quantity::int quantity,
      payload->>'caseId' case_id, payload->>'canonicalReason' reason, jsonb_array_length(evidence) evidence_count, target_id
      from whatsapp_conversation_actions where source_id=$1 order by action_type`, [first.id]);
    expect(actions).toEqual([
      { action_type: 'customer_followup', status: 'ready', branch: 'فرع الشامي', staff_id: null, customer_id: CUSTOMER, product_id: PRODUCT,
        product_code: null, quantity: 2, case_id: analysis.caseId, reason: actionable[0].reason, evidence_count: expect.any(Number), target_id: null },
      { action_type: 'customer_request', status: 'proposed', branch: 'فرع الشامي', staff_id: DOCTOR, customer_id: CUSTOMER, product_id: PRODUCT,
        product_code: '90001', quantity: 2, case_id: analysis.caseId, reason: 'confirmed_unavailable_product', evidence_count: expect.any(Number), target_id: null },
    ]);
    expect(actions.every((a) => a.evidence_count > 0)).toBe(true);

    // 6) Re-processing with a new analysis version: no duplicate operation.
    const secondRun = await publishAndProject('9c000000-0000-4000-8000-000000000002');
    expect(secondRun.requests).toMatchObject({ inserted: 0, existing: 1 });
    expect(secondRun.followups).toMatchObject({ inserted: 0 });
    expect(await t.sql('select count(*)::int n from whatsapp_conversation_actions where source_id=$1', [first.id])).toEqual([{ n: 2 }]);

    // 7) Proposals are not executions and not sales: nothing materialized, no request/follow-up/sale record.
    expect(await t.sql('select count(*)::int n from customer_requests')).toEqual([{ n: 0 }]);
    expect(await t.sql(`select count(*)::int n from whatsapp_conversation_actions where target_id is not null`)).toEqual([{ n: 0 }]);
  }, 60_000);
});
