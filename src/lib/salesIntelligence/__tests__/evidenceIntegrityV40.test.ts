import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
import { readFileSync } from 'node:fs';
import { runSalesIntelligencePipeline } from '../salesIntelligencePipeline';
import { analyzeConversationEvaluation } from '../conversationEvaluation';
import { buildCaseConversationReviewPayload } from '../conversationEvaluationPersistence';
import { hasSubstantiveBasket, salesCriteriaApplicable } from '../conversationEvaluationEvidence';
import { buildCanonicalProduct, countNormalizedNames } from '../pharmacyProducts/canonicalProduct';
import { buildPharmacyProductIndex } from '../pharmacyProducts/pharmacyProductResolverV2';
import { normalizePharmacyText } from '../pharmacyProducts/pharmacyNormalization';
import {
  buildSalesIntelligenceRuntimeContext,
  pipelineBaseInputFor,
  prepareSalesIntelligenceConversations,
} from '../runtimeContext';
import type { CaseIntelligenceView } from '../types';

// V40 evidence-integrity regressions from the Ibrahim review (real wording, synthetic ids/names).
// Root causes covered: an empty draft basket made welfare and nursing cases look commercial
// (sales_closing 8/10), and an identity-less basket line was labelled "proven".

const C = 'عميل تجريبي 90001';
const EXPORT = [
  '[9/27/26, 10:54:07 AM] You: صباح الخير يا أستاذ 🌷\nمع حضرتك هبه من خدمة عملاء صيدليات دواء.💙\n\nحابين نطمن على والد حضرتك بعد خدمة التمريض وأخذ المحلول',
  `[9/27/26, 1:14:23 PM] ${C}: اهلا وسهلا بحضرتك الحمدلله الوالد اتحسن كتير جدا وخدمه التمريض ممتازة شكرا على متابعتكم واهتمامكم`,
  '[9/27/26, 1:15:33 PM] You: الحمدلله، فرحتنا جدًا إن الوالد اتحسن',
  `[9/27/26, 1:16:11 PM] ${C}: ربنا يسعدكم ويبارك فيكم جميعا 🤲`,
  `[9/28/26, 12:56:27 AM] ${C}: السلام عليكم`,
  '[9/28/26, 12:58:50 AM] You: أهلًا وسهلًا بحضرتك✨\nمع حضرتك د شبل\nخدمة التوصيل متاحة على مدار ٢٤ ساعة 🚗',
  '[9/28/26, 12:59:36 AM] You: اهلا بحضرتك اقدر اساعد حضرتك ازاي',
  `[9/28/26, 12:59:49 AM] ${C}: [Forwarded] <image omitted>`,
  `[9/28/26, 1:01:04 AM] ${C}: خليهم علبتين كولونا`,
  '[9/28/26, 1:02:11 AM] You: يعني حضرتك محتاج تكرر المحلول وعلبتين كولونا وعلبة جاسترو بيوتيك',
  '[9/28/26, 1:02:17 AM] You: تركيز 550 صح؟',
  `[9/28/26, 1:02:18 AM] ${C}: مطبووط`,
  '[9/28/26, 1:02:37 AM] You: عنيا حاضر',
  '[9/28/26, 1:28:43 AM] You: تم الارسال \nنتشرف ب خدمة حضرتك ٢٤ ساعه 🌸🌸',
  `[9/28/26, 2:17:35 AM] ${C}: لو سمحت ي دكتور ممكن تبعت حد مالتمريض لأن الكانيولا اتحركت م مكانها والمحلول بيسرب`,
  '[9/28/26, 2:20:25 AM] You: أهلًا وسهلًا بحضرتك✨\nمع حضرتك د شبل',
  '[9/28/26, 2:20:27 AM] You: عنيا حالا هبعته لحضرتك',
  `[9/28/26, 2:20:44 AM] ${C}: تمام شكرا لحضرتك ي دكتور`,
  `[9/28/26, 3:39:59 AM] ${C}: دكتورنا معلش شوفه تاني كده`,
  '[9/28/26, 3:41:26 AM] You: بيقولي عشر دقايق او ربع ساعه وييجي لحضرتك',
].join('\n');

const catalogRows = [
  ['p-colona-30', 'COLONA 30 TAB', '91001'],
  ['p-colona-40', 'colona 40 tab', '91002'],
  ['p-gastro-200', 'GASTROBIOTIC 200 MG 20 TAB', '91003'],
  ['p-gastro-550', 'GASTROBIOTIC 550 MG 20 TAB', '91004'],
].map(([id, name, product_code]) => ({ id, name, product_code, normalized_name: name.toLowerCase(), category: null, price: null, source: 'synthetic' }));
const counts = countNormalizedNames(catalogRows);
const productIndex = buildPharmacyProductIndex(catalogRows.map((row) => buildCanonicalProduct(row, counts, normalizePharmacyText)));

const staff = (id: string, name: string, branch: string, extra: Record<string, unknown> = {}) =>
  ({ id, name, branch, role: 'صيدلاني', type: 'Pharmacist', username: null, status: 'active', active: true, source: 'staff', ...extra });
const DIRECTORY = [
  staff('staff-shebl', 'د محمد شبل', 'فرع شكري'),
  staff('staff-shebl', 'شبل', 'فرع شكري', { source: 'alias' }),
  staff('staff-heba', 'هبه محمد', 'المخزن', { role: 'assistant', type: 'فريق دواء ألفا' }),
  staff('staff-heba', 'هبه', 'المخزن', { source: 'alias', role: 'assistant', type: 'فريق دواء ألفا' }),
  staff('staff-nour', 'نور', 'فرع الشامي', { role: 'assistant', type: 'فريق دواء ألفا' }),
  staff('staff-hajar', 'هاجر', 'المخزن', { role: 'فريق دواء ألفا', type: 'فريق دواء ألفا' }),
];

// A customer master row exists for the code, but neither the source nor the invoice carries its id.
const INVOICE = {
  id: 'inv-synthetic-1', invoice_number: '90938', invoice_datetime: '2026-09-27T22:06:00+00:00',
  branch: 'فرع شكري', customer_code: '90001', customer_id: null, customer_name: 'د عميل تجريبي',
  seller_name: 'د محمد شبل', total_amount: 849,
};
const ITEMS = [
  { productNameRaw: 'colona 40 tab', productCode: '91002', productId: 'p-colona-40', quantity: 2 },
  { productNameRaw: 'GASTROBIOTIC 550 MG 20 TAB', productCode: '91004', productId: 'p-gastro-550', quantity: 1 },
  { productNameRaw: 'Zomegipral 40 mg Vial', productCode: '91009', quantity: 2 },
  { productNameRaw: 'توصيل منزلي', productCode: '79693', quantity: 1 },
];

async function analyze(customerRowExists: boolean) {
  const context = buildSalesIntelligenceRuntimeContext({ productIndex, staffDirectory: DIRECTORY as any });
  const rows: Record<string, unknown[]> = {
    customers: customerRowExists ? [{ id: 'customer-90001', customer_code: '90001', name: 'د عميل تجريبي', phone: null, branch: null }] : [],
  };
  const client: any = {
    from: (table: string) => {
      const proxy: any = new Proxy(
        { then: (resolve: any) => resolve({ data: rows[table] ?? [], error: null }), maybeSingle: async () => ({ data: null, error: null }) },
        { get: (target, key) => (key in target ? (target as any)[key] : () => proxy) }
      );
      return proxy;
    },
    rpc: async () => ({ data: [], error: null }),
  };
  const [prepared] = await prepareSalesIntelligenceConversations(
    client,
    [{ conversationId: 'v40-integrity', rawWhatsAppExportText: EXPORT, customerNameHint: C, customerCodeHint: '90001', knownStaffIds: [] } as any],
    context
  );
  const result = runSalesIntelligencePipeline({
    ...pipelineBaseInputFor(prepared, context),
    customerCodeHint: '90001',
    customerNameHint: C,
    branchNameRawHint: 'المخزن',
    resolveInvoiceCandidates: () => [INVOICE],
    itemEvidenceProvider: { getItemsForInvoice: (id: string) => (id === INVOICE.id ? ITEMS : 'unavailable') },
  } as any);
  return { prepared, cases: result.caseAnalyses };
}

const startsBefore = (iso: string) => (c: { conversationCase: { startedAt: string } }) =>
  new Date(c.conversationCase.startedAt).getTime() < new Date(iso).getTime();

describe('V40 evidence integrity — the Ibrahim export shape', () => {
  it('assigns every message to exactly one case and keeps the welfare reply with customer service', async () => {
    const { cases } = await analyze(true);
    const ids = cases.flatMap((c) => c.caseIntelligence!.interaction.messageIds);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(EXPORT.split(/\n(?=\[\d)/).length);
    const service = cases.find(startsBefore('2026-09-27T21:00:00Z'))!;
    expect(cases.filter(startsBefore('2026-09-27T21:00:00Z'))).toHaveLength(1);
    expect(service.conversationCase.ownership?.department).toBe('customer_service');
    expect(service.caseIntelligence!.staff.participants.map((p) => p.staffId).filter(Boolean)).toEqual(['staff-heba']);
    // The customer's reply and blessing stay inside Heba's case.
    expect(service.caseIntelligence!.interaction.messages.some((m) => m.text.includes('الوالد اتحسن'))).toBe(true);
  });

  it('attributes the order to the introduced doctor only, never Heba and never by invoice seller alone', async () => {
    const { cases } = await analyze(true);
    const order = cases.find((c) => c.customerNeed.products.length > 0)!;
    expect(order.conversationCase.ownership?.department).toBe('pharmacy');
    expect(order.caseIntelligence!.staff.participants.map((p) => p.staffId).filter(Boolean)).toEqual(['staff-shebl']);
    expect(cases.filter((c) => c !== order).every((c) =>
      !c.caseIntelligence!.staff.participants.some((p) => p.staffId === 'staff-shebl') ||
      c.caseIntelligence!.interaction.messages.some((m) => m.text.includes('مع حضرتك د شبل')))).toBe(true);
  });

  it('a resolved customer master row does not prove an invoice that carries no customer_id', async () => {
    const { prepared, cases } = await analyze(true);
    expect(prepared.customerIdentityStatus).toBe('resolved');
    for (const c of cases) {
      expect(c.salesOutcome.saleProofState).not.toBe('proven');
      expect(c.salesOutcome.isSaleCountable).toBe(false);
      expect(c.salesOutcome.isRevenueCountable).toBe(false);
    }
    const order = cases.find((c) => c.customerNeed.products.length > 0)!;
    expect(order.attribution.attributionLevel).not.toBe('proven');
    // The candidate's per-factor reasons are recorded, not a bare confidence number.
    expect(order.attribution.ruleIds.some((rule) => rule.startsWith('attribution.factor.'))).toBe(true);
  });

  it('a basket line whose catalog identity is ambiguous is not "proven"; the resolved one keeps its code', async () => {
    const { cases } = await analyze(true);
    const order = cases.find((c) => c.customerNeed.products.length > 0)!;
    const items = order.caseIntelligence!.basket.activeItems;
    const colona = items.find((item) => item.productNameRaw.includes('كولونا'))!;
    const gastro = items.find((item) => item.productNameRaw.includes('جاسترو'))!;
    expect(colona.productId).toBeNull();
    expect(colona.resolutionStatus).toBe('partially_proven');
    expect(colona.quantity).toBe(2);
    expect(gastro.productId).toBe('p-gastro-550');
    // Invoice lines never become requested products: Zomegipral is not in the conversation.
    expect(order.customerNeed.products.some((p) => /zomegipral/i.test(p.productNameRaw))).toBe(false);
  });

  it('welfare and nursing cases get no sales criteria even with an empty draft basket and a nearby invoice', async () => {
    const { cases } = await analyze(true);
    const noncommercial = cases.filter((c) => ['follow_up', 'information_only'].includes(c.conversationCase.caseType));
    expect(noncommercial.length).toBeGreaterThanOrEqual(2);
    for (const c of noncommercial) {
      const view = c.caseIntelligence!;
      expect(hasSubstantiveBasket(view)).toBe(false);
      expect(salesCriteriaApplicable(view)).toBe(false);
      const evaluation = analyzeConversationEvaluation(view, null);
      const closing = evaluation.items.find((item) => item.key === 'sales_closing')!;
      const crossSell = evaluation.items.find((item) => item.key === 'cross_sell_upsell')!;
      expect(closing.status).toBe('not_applicable');
      expect(closing.pointsEarned ?? null).toBeNull();
      expect(crossSell.status).toBe('not_applicable');
    }
    const order = cases.find((c) => c.conversationCase.caseType === 'sales_opportunity')!;
    expect(salesCriteriaApplicable(order.caseIntelligence!)).toBe(true);
  });

  it('the stored review row and the display read back exactly what the engine decided', async () => {
    const { cases } = await analyze(true);
    for (const c of cases) {
      const engineView = c.caseIntelligence!;
      // Persistence stores the view as JSON; the QA screen reads that JSON back.
      const storedView = JSON.parse(JSON.stringify(engineView)) as CaseIntelligenceView;
      const engine = analyzeConversationEvaluation(engineView, null);
      const replay = analyzeConversationEvaluation(storedView, null);
      expect(replay.summary.autoScore).toBe(engine.summary.autoScore);
      expect(replay.items.map((i) => [i.key, i.status, i.pointsEarned])).toEqual(engine.items.map((i) => [i.key, i.status, i.pointsEarned]));
      const payload = buildCaseConversationReviewPayload({
        sourceId: 'v40-integrity', view: storedView, evaluation: replay,
        staffRow: { id: 'staff-x', name: 'x', branch: null, role: null },
      });
      expect(payload.final_score).toBe(engine.summary.autoScore);
      const closing = engine.items.find((i) => i.key === 'sales_closing')!;
      if (closing.status === 'assessed') expect(payload.sales_quality_score).not.toBeNull();
      else expect(payload.sales_quality_score ?? null).toBeNull();
      expect(payload.point_impact).toBe(0);
      expect(payload.invoice_number).toBeNull();
    }
  });
});

describe('legacy complaint action is neither duplicated nor withdrawn by a new analysis', () => {
  it('no canonical complaint means no read or write on whatsapp_conversation_actions', async () => {
    const { projectCanonicalComplaintsToActions } = await import('../persistence/canonicalComplaintProjector');
    const { cases } = await analyze(true);
    expect(cases.every((c) => c.complaintAssessment?.state !== 'detected')).toBe(true);
    const touched: string[] = [];
    const client = { from: (table: string) => { touched.push(table); throw new Error('must not touch ' + table); } };
    const result = await projectCanonicalComplaintsToActions(client, cases, [{ sourceId: 'v40-integrity' } as any]);
    expect(result).toMatchObject({ inserted: 0, existing: 0 });
    expect(touched).toEqual([]);
  });
});

describe('competition average rule (explicit)', () => {
  it('every officially approved current review in the cycle with a positive score feeds avgReview — point_impact does not exclude it', () => {
    const source = readFileSync('src/lib/doctorCompetitionMetrics.ts', 'utf8');
    // Documented on purpose: if this rule changes, the incentive owner must approve and this test changes with it.
    // 2026-10-26 owner instruction: unapproved (pending or automatic) reviews never enter incentives, so only
    // officially approved reviews score; the positive-score rule and the 15-point weight are unchanged.
    expect(source).toMatch(/\.eq\('is_current', true\)/);
    expect(source).toMatch(/if \(!isOfficialConversationReview\(row\)\) continue;/);
    expect(source).toMatch(/if \(score > 0\) \{\s*current\.reviewCount \+= 1;/);
    expect(source).toMatch(/const reviewScore = row\.reviewCount \? \(avgReview\(row\) \/ 100\) \* 15 : 0;/);
    expect(source).not.toMatch(/point_impact/);
  });
});
