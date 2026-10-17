import { describe, expect, it } from 'vitest';
import { fetchQaCaseDetail } from '../queries';
import { createSelectedCaseRequestGate } from '../selectedCaseRequestGate';
import { openSelectedCase, type SelectedCaseDetailSink } from '../selectedCaseDetailFlow';
import { describeCanonicalCaseSaleTruth, canonicalTrustedInvoiceId } from '../canonicalCaseTruthPresentation';
import { readCanonicalCaseSaleTruth } from '../canonicalCaseTruth';
import { createInMemorySupabase } from './inMemorySupabase.testkit';

// One selected case = one window truth. Synthetic data only.
//
//   customer X (conv-1, one WhatsApp source, one shared Customer Case V22 v22-x):
//     case-A  morning  — canonical sale: proven invoice inv-A, sale_proven, countable; V22 proof owner
//     case-B  evening  — needs_review: invoice proof 'proven' on inv-B but NOT countable / NOT confirmed
//   customer Y (conv-2, v22-y):
//     case-C  — no sale proof at all
//   case-D (customer Y, legacy engine) — current analysis without a persisted canonical outcome,
//     linked to a V22 case this viewer cannot read.
//   inv-X2 is another invoice of customer X attributed to no case (customer-wide history).

function outcome(caseId: string, fields: Record<string, unknown>) {
  return { caseId, reasonCodes: [], ...fields };
}

function fixtureTables() {
  return {
    sales_intelligence_cases: [
      { case_id: 'case-A', conversation_id: 'conv-1', customer_id: 'cust-x', customer_phone: '01000000001', source_case_id_v22: 'v22-x', case_started_at: '2026-09-24T06:00:00.000Z', case_ended_at: '2026-09-24T06:10:00.000Z' },
      { case_id: 'case-B', conversation_id: 'conv-1', customer_id: 'cust-x', customer_phone: '01000000001', source_case_id_v22: 'v22-x', case_started_at: '2026-09-24T16:00:00.000Z', case_ended_at: '2026-09-24T16:10:00.000Z' },
      { case_id: 'case-C', conversation_id: 'conv-2', customer_id: 'cust-y', customer_phone: '01000000002', source_case_id_v22: 'v22-y', case_started_at: '2026-09-25T07:00:00.000Z', case_ended_at: '2026-09-25T07:10:00.000Z' },
      { case_id: 'case-D', conversation_id: 'conv-2', customer_id: 'cust-y', customer_phone: '01000000002', source_case_id_v22: 'v22-hidden', case_started_at: '2026-09-25T15:00:00.000Z', case_ended_at: '2026-09-25T15:10:00.000Z' },
    ],
    sales_intelligence_current_case_analyses: [
      {
        analysis_id: 'an-A', case_id: 'case-A', pipeline_version: 'sales-intelligence-v24-canonical-basket-product-identity',
        case_type: 'purchase_request', case_started_at: '2026-09-24T06:00:00.000Z', case_ended_at: '2026-09-24T06:10:00.000Z',
        attribution_level: 'proven', integrity_evaluation_scope: 'header_only', needs_human_review: false, commercial_confirmation_state: 'commercial_confirmation_complete',
        evidence_snapshot: { canonicalSalesOutcome: outcome('case-A', { outcome: 'sale_proven', saleProofState: 'proven', isSaleCountable: true, isRevenueCountable: true, isOrderConfirmed: true, needsHumanReview: false }) },
      },
      {
        analysis_id: 'an-B', case_id: 'case-B', pipeline_version: 'sales-intelligence-v24-canonical-basket-product-identity',
        case_type: 'purchase_request', case_started_at: '2026-09-24T16:00:00.000Z', case_ended_at: '2026-09-24T16:10:00.000Z',
        attribution_level: 'proven', integrity_evaluation_scope: 'header_only', needs_human_review: true, commercial_confirmation_state: 'unknown',
        evidence_snapshot: { canonicalSalesOutcome: outcome('case-B', { outcome: 'needs_review', saleProofState: 'proven', isSaleCountable: false, isRevenueCountable: false, isOrderConfirmed: false, needsHumanReview: true }) },
      },
      {
        analysis_id: 'an-C', case_id: 'case-C', pipeline_version: 'sales-intelligence-v24-canonical-basket-product-identity',
        case_type: 'inquiry', case_started_at: '2026-09-25T07:00:00.000Z', case_ended_at: '2026-09-25T07:10:00.000Z',
        attribution_level: 'unknown', integrity_evaluation_scope: 'insufficient', needs_human_review: false, commercial_confirmation_state: 'unknown',
        evidence_snapshot: { canonicalSalesOutcome: outcome('case-C', { outcome: 'open_opportunity', saleProofState: 'unknown', isSaleCountable: false, isRevenueCountable: false, isOrderConfirmed: false, needsHumanReview: false }) },
      },
      {
        analysis_id: 'an-D', case_id: 'case-D', pipeline_version: 'sales-intelligence-v12',
        case_type: 'inquiry', case_started_at: '2026-09-25T15:00:00.000Z', case_ended_at: '2026-09-25T15:10:00.000Z',
        attribution_level: 'unknown', integrity_evaluation_scope: 'insufficient', needs_human_review: false, commercial_confirmation_state: 'unknown',
        evidence_snapshot: {},
      },
    ],
    sales_intelligence_case_analyses: [
      { analysis_id: 'an-A', case_id: 'case-A', is_current: true },
      { analysis_id: 'an-B', case_id: 'case-B', is_current: true },
      { analysis_id: 'an-C', case_id: 'case-C', is_current: true },
      { analysis_id: 'an-D', case_id: 'case-D', is_current: true },
    ],
    sales_intelligence_current_attributions: [
      { id: 'at-A', analysis_id: 'an-A', case_id: 'case-A', selected_invoice_id: 'inv-A', selected_invoice_number: 'A-100', attribution_level: 'proven', is_official_for_staff_evaluation: true, candidate_count: 1, competing_case_ids: [], rule_ids: [], contradictions: [] },
      { id: 'at-B', analysis_id: 'an-B', case_id: 'case-B', selected_invoice_id: 'inv-B', selected_invoice_number: 'B-200', attribution_level: 'proven', is_official_for_staff_evaluation: false, candidate_count: 1, competing_case_ids: [], rule_ids: [], contradictions: [] },
    ],
    sales_intelligence_basket_invoice_matches: [
      { id: 'm-A', analysis_id: 'an-A', case_id: 'case-A', attribution_row_id: 'at-A', invoice_id: 'inv-A', invoice_number: 'A-100', is_current_evaluation: true, integrity_evaluation_scope: 'header_only', header_evidence_ready: true, item_evidence_ready: false },
      { id: 'm-B', analysis_id: 'an-B', case_id: 'case-B', attribution_row_id: 'at-B', invoice_id: 'inv-B', invoice_number: 'B-200', is_current_evaluation: true, integrity_evaluation_scope: 'header_only', header_evidence_ready: true, item_evidence_ready: false },
    ],
    whatsapp_customer_cases_v22: [
      { id: 'v22-x', verified_invoice_id: 'inv-A', verified_invoice_number: 'A-100', verified_revenue: 150, verified_sale_at: '2026-09-24T06:30:00.000Z', proposed_outcome: 'verified_sale', case_json: { canonicalSaleProof: { state: 'proven', salesCaseId: 'case-A', analysisId: 'an-A', invoiceId: 'inv-A', invoiceNumber: 'A-100', pipelineVersion: 'sales-intelligence-v24-canonical-basket-product-identity' } } },
      { id: 'v22-y', verified_invoice_id: null, verified_invoice_number: null, verified_revenue: null, verified_sale_at: null, proposed_outcome: null, case_json: { canonicalSaleProof: { state: 'not_proven' } } },
    ],
    whatsapp_review_sources: [
      {
        id: 'conv-1', source_filename: 'chat-x.txt', customer_id: 'cust-x', customer_name: 'كريم', customer_code: '5001', customer_phone: '01000000001', branch: 'فرع شكري',
        conversation_started_at: '2026-09-24T06:00:00.000Z', conversation_ended_at: '2026-09-24T16:10:00.000Z', staff_id: null, staff_name: null,
        raw_text: '24/09/2026, 9:01 AM - كريم: محتاج بانادول اكسترا\n24/09/2026, 9:02 AM - صيدلية دواء: متاح\n24/09/2026, 7:01 PM - كريم: محتاج فيتامين سي\n24/09/2026, 7:02 PM - صيدلية دواء: متاح',
        review_status: 'pending',
      },
      {
        id: 'conv-2', source_filename: 'chat-y.txt', customer_id: 'cust-y', customer_name: 'سارة', customer_code: '5002', customer_phone: '01000000002', branch: 'فرع شكري',
        conversation_started_at: '2026-09-25T07:00:00.000Z', conversation_ended_at: '2026-09-25T15:10:00.000Z', staff_id: null, staff_name: null,
        raw_text: '25/09/2026, 10:01 AM - سارة: محتاجة زنك\n25/09/2026, 10:02 AM - صيدلية دواء: غير متاح\n25/09/2026, 6:01 PM - سارة: محتاجة كالسيوم',
        review_status: 'pending',
      },
    ],
    sales_invoices: [
      { id: 'inv-A', invoice_number: 'A-100', customer_name: 'كريم', customer_code: '5001', branch: 'فرع شكري', staff_name: 'د أحمد', invoice_datetime: '2026-09-24T06:30:00.000Z', net_amount: 150 },
      { id: 'inv-B', invoice_number: 'B-200', customer_name: 'كريم', customer_code: '5001', branch: 'فرع شكري', staff_name: 'د منى', invoice_datetime: '2026-09-24T16:30:00.000Z', net_amount: 90 },
      { id: 'inv-X2', invoice_number: 'X-900', customer_name: 'كريم', customer_code: '5001', branch: 'فرع شكري', staff_name: 'د أحمد', invoice_datetime: '2026-09-20T10:00:00.000Z', net_amount: 300 },
    ],
    sales_invoice_items_v21: [
      { id: 'li-A1', invoice_id: 'inv-A', invoice_number: 'A-100', line_no: 1, product_id: 'p-pan', product_code: 'PAN', product_name: 'بانادول اكسترا', quantity: 2, unit_price: 75, line_total: 150 },
      { id: 'li-B1', invoice_id: 'inv-B', invoice_number: 'B-200', line_no: 1, product_id: 'p-vitc', product_code: 'VITC', product_name: 'فيتامين سي', quantity: 1, unit_price: 90, line_total: 90 },
      { id: 'li-X1', invoice_id: 'inv-X2', invoice_number: 'X-900', line_no: 1, product_id: 'p-zinc', product_code: 'ZNC', product_name: 'زنك', quantity: 3, unit_price: 100, line_total: 300 },
    ],
    products: [
      { id: 'p-pan', product_code: 'PAN', name: 'بانادول اكسترا', normalized_name: 'بانادول اكسترا', price: 75 },
      { id: 'p-vitc', product_code: 'VITC', name: 'فيتامين سي', normalized_name: 'فيتامين سي', price: 90 },
      { id: 'p-zinc', product_code: 'ZNC', name: 'زنك', normalized_name: 'زنك', price: 100 },
      { id: 'p-cal', product_code: 'CAL', name: 'كالسيوم', normalized_name: 'كالسيوم', price: 60 },
    ],
    sales_intelligence_invoice_staff_truth_v1: [
      { case_id: 'case-A', invoice_id: 'inv-A', invoice_number: 'A-100', invoice_staff_name_raw: 'د أحمد', canonical_staff_id: 'st-1', canonical_staff_name: 'د أحمد', resolution_status: 'resolved_by_unique_name', item_evidence_available: false },
      { case_id: 'case-B', invoice_id: 'inv-B', invoice_number: 'B-200', invoice_staff_name_raw: 'د منى', canonical_staff_id: 'st-2', canonical_staff_name: 'د منى', resolution_status: 'resolved_by_unique_name', item_evidence_available: false },
    ],
  };
}

async function open(caseId: string, options: { hiddenTables?: string[] } = {}) {
  const client = createInMemorySupabase(fixtureTables(), options);
  const bundle = await fetchQaCaseDetail(client, caseId);
  if (!bundle) throw new Error(`no bundle for ${caseId}`);
  return bundle;
}

function fingerprint(bundle: NonNullable<Awaited<ReturnType<typeof fetchQaCaseDetail>>>) {
  return {
    caseId: bundle.persisted.analysisRow.case_id,
    sourceId: bundle.conversation?.id ?? null,
    customerCode: bundle.conversation?.customerCode ?? null,
    outcome: bundle.canonicalTruth.outcome?.outcome ?? null,
    saleProofState: bundle.canonicalTruth.outcome?.saleProofState ?? null,
    isSaleCountable: bundle.canonicalTruth.outcome?.isSaleCountable ?? null,
    isRevenueCountable: bundle.canonicalTruth.outcome?.isRevenueCountable ?? null,
    isOrderConfirmed: bundle.canonicalTruth.outcome?.isOrderConfirmed ?? null,
    ledger: bundle.canonicalTruth.ledger.state,
    ledgerRevenue: bundle.canonicalTruth.ledger.revenue,
    invoice: bundle.canonicalTruth.attribution?.selectedInvoiceId ?? null,
    invoiceLineProducts: bundle.invoiceItemFacts.map((item) => item.productCode),
    staff: bundle.invoiceStaffTruth?.canonicalStaffName ?? null,
    catalogProducts: bundle.catalogProductMatches.map((match) => match.productCode),
    siblings: bundle.siblingCases.map((sibling) => sibling.caseId),
  };
}

describe('selected conversation loader — one case, one window truth', () => {
  it('case A renders its own canonical sale exactly as persisted', async () => {
    const a = await open('case-A');
    expect(fingerprint(a)).toEqual({
      caseId: 'case-A',
      sourceId: 'conv-1',
      customerCode: '5001',
      outcome: 'sale_proven',
      saleProofState: 'proven',
      isSaleCountable: true,
      isRevenueCountable: true,
      isOrderConfirmed: true,
      ledger: 'proven',
      ledgerRevenue: 150,
      invoice: 'inv-A',
      invoiceLineProducts: ['PAN'],
      staff: 'د أحمد',
      catalogProducts: ['PAN'],
      siblings: ['case-A', 'case-B'],
    });
    expect(canonicalTrustedInvoiceId(a.canonicalTruth)).toBe('inv-A');
  });

  it('case B: a proven invoice proof does not become a countable sale, a confirmed order or the V22 sale of case A', async () => {
    const b = await open('case-B');
    expect(fingerprint(b)).toEqual({
      caseId: 'case-B',
      sourceId: 'conv-1',
      customerCode: '5001',
      outcome: 'needs_review',
      saleProofState: 'proven',
      isSaleCountable: false,
      isRevenueCountable: false,
      isOrderConfirmed: false,
      // Same V22 case as A, but its proof belongs to case-A: never shown as B's sale.
      ledger: 'proof_belongs_to_other_case',
      ledgerRevenue: null,
      invoice: 'inv-B',
      invoiceLineProducts: ['VITC'],
      staff: 'د منى',
      catalogProducts: ['VITC'],
      siblings: ['case-A', 'case-B'],
    });
    const rows = Object.fromEntries(describeCanonicalCaseSaleTruth(b.canonicalTruth).map((row) => [row.key, row.value]));
    expect(rows.saleCountable).toBe('لا');
    expect(rows.revenueCountable).toBe('لا');
    expect(rows.orderConfirmed).toBe('لا');
    expect(rows.outcome).toBe('تحتاج مراجعة بشرية');
  });

  it('case C (other customer) has no sale proof and no invoice', async () => {
    const c = await open('case-C');
    expect(fingerprint(c)).toEqual({
      caseId: 'case-C',
      sourceId: 'conv-2',
      customerCode: '5002',
      outcome: 'open_opportunity',
      saleProofState: 'unknown',
      isSaleCountable: false,
      isRevenueCountable: false,
      isOrderConfirmed: false,
      ledger: 'not_proven',
      ledgerRevenue: null,
      invoice: null,
      invoiceLineProducts: [],
      staff: null,
      // The evening "كالسيوم" request belongs to case-D's interval, not to case-C.
      catalogProducts: ['ZNC'],
      siblings: ['case-C', 'case-D'],
    });
    expect(canonicalTrustedInvoiceId(c.canonicalTruth)).toBeNull();
  });

  it('a legacy analysis without a persisted outcome shows NOT ANALYZED, never a recomputed decision', async () => {
    const d = await open('case-D');
    expect(d.canonicalTruth.availability).toBe('outcome_not_persisted');
    expect(d.canonicalTruth.outcome).toBeNull();
    expect(d.canonicalTruth.ledger.state).toBe('v22_not_visible');
    const rows = describeCanonicalCaseSaleTruth(d.canonicalTruth);
    expect(rows.map((row) => row.key)).toEqual(['availability', 'ledger']);
    expect(rows[0].value).toContain('غير محللة بالمحرك الحالي');
  });

  it('opening A → B → C sequentially through the window flow never leaks a value between cases', async () => {
    const client = createInMemorySupabase(fixtureTables());
    const gate = createSelectedCaseRequestGate();
    let rendered: any;
    const sink: SelectedCaseDetailSink<any> = {
      setBundle: (bundle) => { rendered = bundle; },
      setError: () => undefined,
      setConfirmationMessage: () => undefined,
      setConfirmationError: () => undefined,
      setConfirming: () => undefined,
    };
    const expected: Record<string, ReturnType<typeof fingerprint>> = {};
    for (const caseId of ['case-A', 'case-B', 'case-C']) expected[caseId] = fingerprint(await open(caseId));

    let cleanup: (() => void) | null = null;
    for (const caseId of ['case-A', 'case-B', 'case-C', 'case-A']) {
      cleanup?.();
      let settle!: () => void;
      const settled = new Promise<void>((resolve) => { settle = resolve; });
      cleanup = openSelectedCase(gate, caseId, async (id, signal) => {
        const bundle = await fetchQaCaseDetail(client, id, { signal });
        settle();
        return bundle;
      }, sink);
      await settled;
      await Promise.resolve();
      expect(fingerprint(rendered)).toEqual(expected[caseId]);
    }
  });

  it('same customer, separate cases: product facts stay inside each case interval', async () => {
    const a = await open('case-A');
    const b = await open('case-B');
    const aProducts = a.catalogProductMatches.map((match) => match.productCode);
    const bProducts = b.catalogProductMatches.map((match) => match.productCode);
    expect(aProducts).toEqual(['PAN']);
    expect(bProducts).toEqual(['VITC']);
    // Customer-wide history (inv-X2, another invoice of the same customer) is never case evidence.
    for (const bundle of [a, b]) {
      expect(bundle.invoiceItemFacts.some((item) => item.invoiceId === 'inv-X2')).toBe(false);
      expect(bundle.catalogProductMatches.some((match) => match.productCode === 'ZNC')).toBe(false);
    }
  });

  it('viewer visibility never changes the business truth: hidden rows become explicit "not visible" states', async () => {
    const full = await open('case-A');
    const restricted = await open('case-A', {
      hiddenTables: ['whatsapp_customer_cases_v22', 'sales_invoices', 'sales_invoice_items_v21', 'customers'],
    });
    expect(restricted.canonicalTruth.outcome).toEqual(full.canonicalTruth.outcome);
    expect(restricted.canonicalTruth.attribution).toEqual(full.canonicalTruth.attribution);
    expect(full.canonicalTruth.ledger.state).toBe('proven');
    expect(restricted.canonicalTruth.ledger.state).toBe('v22_not_visible');
    expect(restricted.canonicalTruth.ledger.revenue).toBeNull();
  });

  it('the window never fetches invoice candidates or competing claims to decide a sale', async () => {
    const client = createInMemorySupabase(fixtureTables());
    await fetchQaCaseDetail(client, 'case-B');
    // Invoices are read only for the persisted selected invoice (header + lines); no candidate
    // window queries, and no competing-claim scan over other cases' attributions.
    const attributionReads = client.reads.filter((table) => table === 'sales_intelligence_current_attributions');
    expect(attributionReads.length).toBe(1);
  });
});

describe('canonical case truth reader', () => {
  it('rejects a persisted outcome recorded for another case id', () => {
    const truth = readCanonicalCaseSaleTruth({
      caseId: 'case-B',
      analysisRow: { analysis_id: 'an-B', case_id: 'case-B', evidence_snapshot: { canonicalSalesOutcome: outcome('case-A', { outcome: 'sale_proven', saleProofState: 'proven', isSaleCountable: true, isRevenueCountable: true }) } },
      attributionRow: null,
      linkedV22CaseId: null,
      v22Row: null,
    });
    expect(truth.outcome).toBeNull();
    expect(truth.availability).toBe('outcome_not_persisted');
    expect(truth.ledger.state).toBe('v22_not_linked');
  });

  it('keeps a revoked proof explicit and never countable', () => {
    const truth = readCanonicalCaseSaleTruth({
      caseId: 'case-A',
      analysisRow: { analysis_id: 'an-A', case_id: 'case-A', evidence_snapshot: { canonicalSalesOutcome: outcome('case-A', { outcome: 'needs_review', saleProofState: 'contradicted', isSaleCountable: false, isRevenueCountable: false }) } },
      attributionRow: null,
      linkedV22CaseId: 'v22-x',
      v22Row: { id: 'v22-x', verified_revenue: null, case_json: { canonicalSaleProof: { state: 'revoked', salesCaseId: 'case-A', reason: 'current_outcome_not_proven', revokedAt: '2026-10-01T00:00:00.000Z' } } },
    });
    expect(truth.ledger.state).toBe('revoked');
    expect(truth.ledger.revokeReason).toBe('current_outcome_not_proven');
    expect(truth.outcome?.isSaleCountable).toBe(false);
    expect(truth.outcome?.isOrderConfirmed).toBeNull();
  });
});
