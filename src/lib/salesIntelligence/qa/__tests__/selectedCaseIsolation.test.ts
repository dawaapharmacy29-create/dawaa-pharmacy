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

import { fixtureTables, outcome } from './selectedCaseFixtures.testkit';

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
    // A stored analysis from an older engine says so and points to an explicit single-source refresh.
    const stale = Object.fromEntries(describeCanonicalCaseSaleTruth({ ...b.canonicalTruth, pipelineVersion: 'sales-intelligence-v19' }).map((row) => [row.key, row.value]));
    expect(stale.analysisVersion).toContain('تحليل قديم (V19)');
    expect(stale.analysisVersion).toContain('أعد تحليل هذا المصدر وحده');
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
