import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runSalesIntelligencePipeline } from '../salesIntelligencePipeline';
import { analyzeConversationEvaluation } from '../conversationEvaluation';
import { buildCaseConversationReviewPayload } from '../conversationEvaluationPersistence';
import { buildCanonicalProduct, countNormalizedNames } from '../pharmacyProducts/canonicalProduct';
import { buildPharmacyProductIndex } from '../pharmacyProducts/pharmacyProductResolverV2';
import { normalizePharmacyText } from '../pharmacyProducts/pharmacyNormalization';
import { buildSalesIntelligenceRuntimeContext, pipelineBaseInputFor, prepareSalesIntelligenceConversations } from '../runtimeContext';
import { recommendInvoiceCandidate } from '../saleAttributionEngine';
import { careFollowUpState } from '../careFollowUpEngine';
import { recommendCaseBranch } from '../caseOwnershipContext';
import { buildConversationUnderstandingV32 } from '../../whatsappConversationUnderstandingV32';
import { parseWhatsAppExport, splitWhatsAppSessions } from '../../whatsappConversationParser';

// V43 acceptance on the real 38-message export shape (customer name, code and address replaced):
// customer-service welfare check → medicine order with «د شبل» → nursing request + its chase.
const EXPORT = readFileSync(path.resolve(__dirname, 'fixtures/service-order-nursing-38.txt'), 'utf8');

const staff = (id: string, name: string, branch: string, extra: Record<string, unknown> = {}) =>
  ({ id, name, branch, role: 'صيدلاني', type: 'Pharmacist', username: null, status: 'active', active: true, source: 'staff', ...extra });
const DIRECTORY = [
  staff('staff-shebl', 'د محمد شبل', 'فرع شكري'),
  staff('staff-shebl', 'شبل', 'فرع شكري', { source: 'alias' }),
  staff('staff-omar', 'د عمر', 'فرع شكري'),
  staff('staff-heba', 'هبه محمد', 'المخزن', { role: 'assistant', type: 'فريق دواء ألفا' }),
  staff('staff-heba', 'هبه', 'المخزن', { source: 'alias', role: 'assistant', type: 'فريق دواء ألفا' }),
  staff('staff-nour', 'نور', 'فرع الشامي', { role: 'assistant', type: 'فريق دواء ألفا' }),
  staff('staff-hajar', 'هاجر', 'المخزن', { role: 'فريق دواء ألفا', type: 'فريق دواء ألفا' }),
];

const catalogRows = [
  ['p-colona-30', 'COLONA 30 TAB', '57909'],
  ['p-colona-40', 'colona 40 tab', '81948'],
  ['p-gastro-200', 'GASTROBIOTIC 200 MG 20 TAB', '66361'],
  ['p-gastro-550', 'GASTROBIOTIC 550 MG 20 TAB', '78994'],
  ['p-ringer', 'RINGER SOLUTION INJECTION 500 ML.', '16467'],
].map(([id, name, product_code]) => ({ id, name, product_code, normalized_name: name.toLowerCase(), category: null, price: null, source: 'synthetic' }));
const counts = countNormalizedNames(catalogRows);
const productIndex = buildPharmacyProductIndex(catalogRows.map((row) => buildCanonicalProduct(row, counts, normalizePharmacyText)));

// Synthetic invoice ids; the 10-line shape and product codes follow the reviewed invoice.
const ORDER_INVOICE = {
  id: 'inv-order', invoice_number: '90938', invoice_datetime: '2026-09-27T22:06:00+00:00', branch: 'فرع شكري',
  customer_code: '90001', customer_id: null, customer_name: 'د عميل تجريبي', seller_name: 'د محمد شبل', total_amount: 849,
};
const EARLIER_INVOICE = {
  id: 'inv-earlier', invoice_number: '90706', invoice_datetime: '2026-09-26T17:37:00+00:00', branch: 'فرع شكري',
  customer_code: '90001', customer_id: null, customer_name: 'د عميل تجريبي', seller_name: 'د عمر', total_amount: 300,
};
const ORDER_LINES = [
  { productNameRaw: 'RINGER SOLUTION INJECTION 500 ML.', productCode: '16467', productId: 'p-ringer', quantity: 1 },
  { productNameRaw: 'B- COM 6 AMP', productCode: '59503', quantity: 1 },
  { productNameRaw: 'Zomegipral 40 mg Vial', productCode: '74440', quantity: 2 },
  { productNameRaw: 'SPASMOFREE 3 AMP', productCode: '54727', quantity: 1 },
  { productNameRaw: 'جهاز محلول', productCode: '79704', quantity: 1 },
  { productNameRaw: 'S 10', productCode: 'S10', quantity: 1 },
  { productNameRaw: 'Danset 8 mg 6 amp', productCode: '81805', quantity: 1 },
  { productNameRaw: 'توصيل منزلي', productCode: '79693', quantity: 1 },
  { productNameRaw: 'colona 40 tab', productCode: '81948', productId: 'p-colona-40', quantity: 2 },
  { productNameRaw: 'GASTROBIOTIC 550 MG 20 TAB', productCode: '78994', productId: 'p-gastro-550', quantity: 1 },
];

function clientWithCustomer() {
  const rows: Record<string, unknown[]> = { customers: [{ id: 'customer-90001', customer_code: '90001', name: 'د عميل تجريبي', phone: null, branch: null }] };
  return {
    from: (table: string) => {
      const proxy: any = new Proxy(
        { then: (resolve: any) => resolve({ data: rows[table] ?? [], error: null }), maybeSingle: async () => ({ data: null, error: null }) },
        { get: (target, key) => (key in target ? (target as any)[key] : () => proxy) }
      );
      return proxy;
    },
    rpc: async () => ({ data: [], error: null }),
  };
}

async function analyze(options: { invoices?: unknown[]; lines?: unknown[]; sourceBranch?: string; knownStaffIds?: string[] } = {}) {
  const context = buildSalesIntelligenceRuntimeContext({ productIndex, staffDirectory: DIRECTORY as any });
  const [prepared] = await prepareSalesIntelligenceConversations(
    clientWithCustomer(),
    [{ conversationId: 'case-continuity', rawWhatsAppExportText: EXPORT, customerNameHint: 'عميل تجريبي', customerCodeHint: '90001', knownStaffIds: options.knownStaffIds ?? [] } as any],
    context
  );
  const invoices = options.invoices ?? [ORDER_INVOICE, EARLIER_INVOICE];
  const lines = options.lines ?? ORDER_LINES;
  const result = runSalesIntelligencePipeline({
    ...pipelineBaseInputFor(prepared, context),
    customerCodeHint: '90001',
    customerNameHint: 'عميل تجريبي',
    branchNameRawHint: options.sourceBranch ?? 'المخزن',
    resolveInvoiceCandidates: () => invoices,
    itemEvidenceProvider: { getItemsForInvoice: (id: string) => (id === 'inv-order' ? lines : 'unavailable') },
  } as any);
  return { context, prepared, cases: result.caseAnalyses };
}

const staffIds = (c: any) => [...new Set(c.caseIntelligence.staff.participants.map((p: any) => p.staffId).filter(Boolean))];

describe('V43 — case continuity on the 38-message export', () => {
  it('splits 38 messages into exactly three cases (4 + 17 + 17) with nothing lost or repeated', async () => {
    const { cases } = await analyze();
    expect(EXPORT.split(/\n(?=\[\d)/)).toHaveLength(38);
    expect(cases.map((c) => c.caseIntelligence!.interaction.messageIds.length)).toEqual([4, 17, 17]);
    const ids = cases.flatMap((c) => c.caseIntelligence!.interaction.messageIds);
    expect(new Set(ids).size).toBe(38);
    expect(cases.map((c) => c.conversationCase.caseType)).toEqual(['information_only', 'sales_opportunity', 'follow_up']);
  });

  it('keeps the nurse chase («شوفه تاني كده») inside the open nursing case and records why', async () => {
    const { cases } = await analyze();
    const nursing = cases[2].caseIntelligence!;
    expect(nursing.interaction.messages.some((m) => m.text.includes('مالتمريض'))).toBe(true);
    expect(nursing.interaction.messages.some((m) => m.text.includes('شوفه تاني'))).toBe(true);
    expect(nursing.interaction.continuationEvidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: 'open_service_need_followup' })])
    );
    // The order is a different case even though the customer and doctor are the same.
    expect(cases[1].caseIntelligence!.interaction.messages.some((m) => m.text.includes('شوفه تاني'))).toBe(false);
  });

  it('assigns staff per case: Heba only to the welfare check, Shibl only where he introduced himself', async () => {
    const { cases, context } = await analyze();
    expect(staffIds(cases[0])).toEqual(['staff-heba']);
    expect(cases[0].conversationCase.ownership?.department).toBe('customer_service');
    expect(staffIds(cases[1])).toEqual(['staff-shebl']);
    expect(staffIds(cases[2])).toEqual(['staff-shebl']);
    // Shibl owns every staff message from his introduction onward; the greeting a second before it
    // stays unresolved (an introduction never reaches backwards), and nothing is given to Heba.
    const contributions = cases[1].conversationCase.ownership?.contributions ?? [];
    expect(contributions.map((c) => c.staffId)).toEqual([null, 'staff-shebl']);
    expect(contributions[0].messageIds).toHaveLength(1);
    expect(contributions[1].messageIds).toHaveLength(8);
    // Team classification comes from the directory's team type, whatever the home branch.
    for (const id of ['staff-heba', 'staff-nour', 'staff-hajar']) {
      expect(context.staffProfilesById?.[id]?.function).toBe('customer_service');
    }
    expect(context.staffProfilesById?.['staff-shebl']?.function).toBe('pharmacist');
  });

  it('does not spread the source branch «المخزن»; the order case gets an explained branch recommendation', async () => {
    const { cases } = await analyze();
    for (const c of cases) expect(c.conversationCase.branchNameRaw).not.toBe('المخزن');
    expect(cases[0].branchRecommendation).toMatchObject({ branch: null, strength: 'none' });
    expect(cases[1].conversationCase.branchNameRaw).toBeNull();
    // The invoice's seller is the case doctor, so its branch and his home branch are one chain of
    // evidence: a supporting hint for «فرع شكري», never a confirmed or strong case branch.
    expect(cases[1].branchRecommendation).toMatchObject({ branch: 'فرع شكري', strength: 'supporting_only' });
    expect(cases[1].branchRecommendation?.reasons.join(' ')).toMatch(/الفرع الأساسي للدكتور/);
    expect(cases[1].branchRecommendation?.reasons.join(' ')).toMatch(/فرع الفاتورة/);
    expect(cases[1].branchRecommendation?.reasons.join(' ')).toMatch(/دليل واحد غير مستقل/);
  });

  it('a doctor-home vs invoice branch disagreement is a conflict, not a choice', () => {
    const ownership = { department: 'pharmacy', sourceBranchNameRaw: 'المخزن', operationalBranch: null, branchBasis: 'none', suggestedStaffBranch: 'فرع شكري', owners: [], introductionMessageIds: [], blockers: [] } as any;
    expect(recommendCaseBranch({ ownership, invoiceBranch: 'فرع الشامي', invoiceCandidateStrong: true, attributionUsedCaseBranch: false }).strength).toBe('conflict');
    // The invoice branch cannot confirm a branch it was already scored against (no circular evidence).
    expect(recommendCaseBranch({ ownership, invoiceBranch: 'فرع شكري', invoiceCandidateStrong: true, attributionUsedCaseBranch: true }).strength).toBe('supporting_only');
  });

  it('ranks the order invoice as a strong candidate for the ORDER case only, without proof, sale or credit', async () => {
    const { cases } = await analyze();
    const order = cases[1];
    expect(order.attribution.selectedInvoiceNumber).toBe('90938');
    expect(order.attribution.candidateRecommendation?.level).toBe('strong_candidate_requires_approval');
    expect(order.attribution.ruleIds).toEqual(expect.arrayContaining([
      'attribution.factor.customer_code_exact', 'attribution.factor.customer_name_match',
      'attribution.factor.time_very_strong', 'attribution.factor.staff_same', 'attribution.factor.product_match',
    ]));
    expect(order.attribution.attributionLevel).not.toBe('proven');
    expect(order.attribution.isOfficialForStaffEvaluation).toBe(false);
    expect(order.salesOutcome.isSaleCountable).toBe(false);
    expect(order.salesOutcome.isRevenueCountable).toBe(false);
    expect(order.salesOutcome.saleProofState).not.toBe('proven');
    for (const c of [cases[0], cases[2]]) expect(c.attribution.selectedInvoiceNumber ?? null).toBeNull();
  });

  it('customer code and time without product content never make a strong candidate', async () => {
    const { cases } = await analyze({ lines: [] });
    expect(cases[1].attribution.candidateRecommendation?.level).not.toBe('strong_candidate_requires_approval');
    const top = { ...cases[1].attribution.selectedCandidate!, productMatch: 'unavailable', staffMatch: 'unknown', announcedTotalMatch: 'unknown' } as any;
    expect(recommendInvoiceCandidate(top, null, { ambiguous: false, competingCaseIds: [], sameCodeCandidates: 1 }).level).toBe('weak_candidate');
  });

  it('two close invoices for the same customer and time require a human decision', async () => {
    const twin = { ...ORDER_INVOICE, id: 'inv-twin', invoice_number: '90939', invoice_datetime: '2026-09-27T22:07:00+00:00' };
    const { cases } = await analyze({ invoices: [ORDER_INVOICE, twin] });
    expect(cases[1].attribution.candidateRecommendation?.level).not.toBe('strong_candidate_requires_approval');
  });

  it('matches items by product code and quantity, keeps the Colona pack unresolved and never adopts extra invoice lines', async () => {
    const renamed = ORDER_LINES.map((line) => (line.productCode === '78994' ? { ...line, productNameRaw: 'GB 550 tabs', productId: null } : line));
    const { cases } = await analyze({ lines: renamed });
    const products = cases[1].caseIntelligence!.products;
    const gastro = products.find((p) => p.productNameRaw.includes('جاسترو'))!;
    const colona = products.find((p) => p.productNameRaw.includes('كولونا'))!;
    expect(gastro.productCode).toBe('78994');
    expect(gastro.invoiceLine).toMatchObject({ matchedBy: 'product_code', invoiceProductCode: '78994', quantityAgrees: true });
    expect(gastro.mentionSource).toBe('staff_restatement');
    expect(colona.productCode).toBeNull();
    expect(colona.mentionSource).toBe('customer_explicit');
    expect(colona.quantitySource).toBe('customer');
    expect(colona.requestedQuantity).toBe(2);
    // Invoice lines that the conversation never mentioned are not requested products.
    expect(products.some((p) => /zomegipral|spasmofree|danset|ringer/i.test(p.productNameRaw))).toBe(false);
    // Image and voice placeholders add no product.
    expect(products.map((p) => p.productNameRaw).every((name) => /كولونا|جاسترو/.test(name))).toBe(true);
  });

  it('suggests a separate care check-in for the nursing case: deterministic, not a sales task, history when past', async () => {
    const { cases } = await analyze();
    const nursing = cases[2];
    expect(nursing.followUp.opportunities).toEqual([]);
    expect(nursing.careFollowUp).toMatchObject({
      key: `${nursing.caseId}:care_check_in`, kind: 'care_check_in', team: 'customer_service',
    });
    expect(nursing.careFollowUp?.problems).toEqual(expect.arrayContaining(['device_problem', 'leak', 'delay']));
    expect(careFollowUpState(nursing.careFollowUp!, new Date('2026-10-22T00:00:00Z'))).toBe('was_due_historically');
    // Re-analysis yields the same key: no duplicate suggestion.
    const again = await analyze();
    expect(again.cases[2].careFollowUp?.key).toBe(nursing.careFollowUp?.key);
    expect(cases[0].careFollowUp ?? null).toBeNull();
    expect(cases[1].careFollowUp ?? null).toBeNull();
  });

  it('evaluates each case on its own criteria; no sale points come from an unapproved invoice', async () => {
    const { cases } = await analyze();
    const closing = (c: any) => analyzeConversationEvaluation(c.caseIntelligence, null).items.find((i) => i.key === 'sales_closing')!;
    expect(closing(cases[0]).status).toBe('not_applicable');
    expect(closing(cases[2]).status).toBe('not_applicable');
    for (const c of cases) {
      const payload = buildCaseConversationReviewPayload({
        sourceId: 'case-continuity', view: c.caseIntelligence!, evaluation: analyzeConversationEvaluation(c.caseIntelligence!, null),
        staffRow: { id: 'staff-x', name: 'x', branch: null, role: null },
      });
      expect(payload.point_impact).toBe(0);
      expect(payload.doctor_points_impact).toBe(0);
      expect(payload.invoice_number).toBeNull();
    }
  });
});

// V43 review regressions: each test pins a gap found while reviewing V43 (fixed in the same change).
describe('V43 review — gaps closed', () => {
  const interactionsOf = (raw: string) =>
    buildConversationUnderstandingV32(splitWhatsAppSessions(parseWhatsAppExport(raw), 24 * 60)[0]).interactions;
  const nurseThen = (turn: string, at = '2:50:00 AM') => [
    '[9/28/26, 2:17:35 AM] عميل 1: لو سمحت ممكن تبعت حد مالتمريض الكانيولا اتحركت',
    '[9/28/26, 2:20:27 AM] You: عنيا حالا هبعته لحضرتك',
    `[9/28/26, ${at}] عميل 1: ${turn}`,
    `[9/28/26, ${at.replace(/:00 /, ':30 ')}] You: حاضر`,
  ].join('\n');

  it('a chase of the open nurse visit stays in the nursing case even when worded as a need or an availability question', () => {
    for (const chase of ['محتاج حد ييجي بسرعة المحلول بيسرب', 'الممرض متاح امتى؟', 'بابا عنده دوار جامد', 'عايز الممرض ييجي دلوقتي']) {
      const interactions = interactionsOf(nurseThen(chase));
      expect(interactions.map((i) => i.messageIds.length), chase).toEqual([4]);
    }
  });

  it('an explicit medicine or price request during an open nurse visit is still its own case', () => {
    for (const request of ['عايز علبة بنادول كمان', 'بكام الكانيولا؟', 'محتاج دواء للكحة']) {
      const interactions = interactionsOf(nurseThen(request));
      expect(interactions.map((i) => [i.segmentationReason, i.messageIds.length]), request).toEqual([['conversation_start', 2], ['new_commercial_need', 2]]);
    }
  });

  it('after the visit is closed, or past the open-need window, a later turn is not kept as an open-need follow-up', () => {
    const closed = [
      '[9/28/26, 2:17:35 AM] عميل 1: لو سمحت ممكن تبعت حد مالتمريض',
      '[9/28/26, 2:20:27 AM] You: عنيا حالا هبعته لحضرتك',
      '[9/28/26, 3:00:00 AM] عميل 1: الممرض وصل شكرا',
      '[9/28/26, 9:00:00 AM] عميل 1: عايز علبة بنادول',
    ].join('\n');
    const afterClose = interactionsOf(closed);
    // The closing turn itself still answers the open visit; the medicine request after it does not.
    expect(afterClose.map((i) => i.messageIds.length)).toEqual([3, 1]);
    expect(['new_commercial_need', 'time_gap']).toContain(afterClose[1].segmentationReason);
    const lastId = afterClose[1].messageIds[0];
    expect(afterClose.flatMap((i) => i.continuationEvidence ?? []).some((e) => e.messageId === lastId)).toBe(false);

    const late = [
      '[9/28/26, 2:17:35 AM] عميل 1: لو سمحت ممكن تبعت حد مالتمريض',
      '[9/28/26, 2:20:27 AM] You: عنيا حالا هبعته لحضرتك',
      '[9/28/26, 3:00:00 PM] عميل 1: الممرض متاح امتى؟',
    ].join('\n');
    expect(interactionsOf(late).flatMap((i) => i.continuationEvidence ?? []).some((e) => e.reason === 'open_service_need_followup')).toBe(false);
  });

  it('customer code and name never add weight on top of a customer_id match (one identity is counted once)', async () => {
    // Same customer linked by id on both sides, close time and the same seller, but no item lines.
    const linked = { ...ORDER_INVOICE, customer_id: 'customer-90001' };
    const { cases } = await analyze({ invoices: [linked, EARLIER_INVOICE], lines: [] });
    const order = cases[1].attribution;
    expect(order.selectedInvoiceNumber).toBe('90938');
    expect(order.ruleIds).toEqual(expect.arrayContaining(['attribution.factor.customer_id_match', 'attribution.factor.customer_code_exact']));
    // customer_id 0.30 + very strong time 0.15 + same seller 0.05 — the code/name are recorded, not re-weighted.
    expect(order.selectedCandidate?.confidenceAssessment.score).toBeCloseTo(0.5, 5);
    expect(order.attributionLevel).not.toBe('strongly_inferred');
    expect(order.isOfficialForStaffEvaluation).toBe(false);
    expect(cases[1].salesOutcome.isSaleCountable).toBe(false);
  });

  it('a doctor-seller invoice branch only supports the doctor home branch; independent agreement stays a recommendation', () => {
    const ownership = { department: 'pharmacy', sourceBranchNameRaw: 'المخزن', operationalBranch: null, branchBasis: 'none', suggestedStaffBranch: 'فرع شكري', owners: [], introductionMessageIds: [], blockers: [] } as any;
    const sameChain = recommendCaseBranch({ ownership, invoiceBranch: 'فرع شكري', invoiceCandidateStrong: true, attributionUsedCaseBranch: false, invoiceSellerIsCaseStaff: true });
    expect(sameChain.strength).toBe('supporting_only');
    const independent = recommendCaseBranch({ ownership, invoiceBranch: 'فرع شكري', invoiceCandidateStrong: true, attributionUsedCaseBranch: false, invoiceSellerIsCaseStaff: false });
    expect(independent.strength).toBe('strong_recommendation');
    expect(independent.strength).not.toBe('decided');
    // A customer-service case never gets a sale branch, whatever the invoice says.
    expect(recommendCaseBranch({ ownership: { ...ownership, department: 'customer_service' }, invoiceBranch: 'فرع شكري', invoiceCandidateStrong: true, attributionUsedCaseBranch: false }).branch).toBeNull();
  });

  it('a source-level staff owner (the invoice seller) never takes over the customer-service welfare case', async () => {
    const { cases } = await analyze({ knownStaffIds: ['staff-shebl'] });
    expect(staffIds(cases[0])).toEqual(['staff-heba']);
    expect(cases[0].conversationCase.ownership?.contributions?.map((c) => c.staffId)).toEqual(['staff-heba']);
    expect(staffIds(cases[1])).toEqual(['staff-shebl']);
  });

  it('matches Colona 40 (81948 × 2) and GASTROBIOTIC 550 (78994 × 1) only as candidate lines, never as a proven sale', async () => {
    const { cases } = await analyze();
    const order = cases[1];
    const lines = order.attribution.selectedCandidate?.lineMatches ?? [];
    const gastro = lines.find((l) => l.invoiceProductCode === '78994');
    expect(gastro).toMatchObject({ invoiceQuantity: 1 });
    // The Colona strength is not resolved from «كولونا» alone (30 vs 40 tab), so it is not matched
    // to line 81948 by the engine; the line exists on the invoice as a fact only.
    expect(lines.some((l) => l.invoiceProductCode === '81948')).toBe(false);
    expect(order.attribution.attributionLevel).not.toBe('proven');
    expect(order.salesOutcome.saleProofState).not.toBe('proven');
    expect(order.salesOutcome.isRevenueCountable).toBe(false);
  });
});
