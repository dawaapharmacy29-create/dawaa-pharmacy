// WhatsApp Master Brain hardening — sale proof regressions (synthetic data only).
//
// Shape of the audited production case (2026-10-26): exact customer code + name, invoice minutes
// after the conversation, same branch, a canonical product line with the same quantity, but the
// invoice was keyed by a different pharmacist. The automatic link was refused because of the
// seller. These tests pin the corrected rules without any real names or invoice numbers.
import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTION_FACTOR_WEIGHTS,
  buildAttributionCandidate,
  deriveSaleAttributionAssessment,
  type CaseAttributionContext,
  type InvoiceItemEvidenceProvider,
} from '@/lib/salesIntelligence/saleAttributionEngine';
import { deriveBasketInvoiceMatch } from '@/lib/salesIntelligence/basketInvoiceMatchingEngine';
import { deriveSaleProofStateFromPersisted } from '@/lib/salesIntelligence/qa/saleProofProjection';
import { readCanonicalCaseSaleTruth } from '@/lib/salesIntelligence/qa/canonicalCaseTruth';
import type { CaseBasket, CommercialConfirmationAssessment } from '@/lib/salesIntelligence/types';

const CONFIRMATION: CommercialConfirmationAssessment = {
  caseId: 'case-x',
  basketId: 'basket-1',
  basketVersion: 1,
  summaryPresented: true,
  customerConfirmed: true,
  staffConfirmed: true,
  announcedTotalPresent: false,
  modificationAfterConfirmation: false,
  currentState: 'commercial_confirmation_complete',
  primaryMessageIds: [],
  ruleIds: [],
  confidence: { level: 'strongly_inferred', score: 0.8, ruleIds: [], evidence: [] },
  needsHumanReview: false,
  humanReviewReasons: [],
};

function ctx(overrides: Partial<CaseAttributionContext> = {}): CaseAttributionContext {
  return {
    caseId: 'case-x',
    customerId: 'cust-A',
    customerPhone: '01000000001',
    customerCode: '9001',
    customerName: 'عميل اختبار',
    branchNameRaw: 'فرع شكري',
    caseStartedAt: '2026-09-27T14:50:00.000Z',
    caseEndedAt: '2026-09-27T15:10:00.000Z',
    commercialConfirmation: CONFIRMATION,
    activeAnnouncedTotal: null,
    activeBasketValue: null,
    activeBasketItems: [
      { productNameRaw: 'baby milk 2', productId: 'prod-milk', productCode: '50001', quantity: 1, resolutionStatus: 'proven' },
    ],
    knownStaffIds: ['staff-closer'],
    legacyMatchedInvoiceId: null,
    legacyMatchedInvoiceNumber: null,
    trustedInvoiceId: null,
    trustedInvoiceNumber: null,
    ...overrides,
  };
}

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-uuid-1',
    invoice_number: '10001',
    customer_id: 'cust-A',
    customer_code: '9001',
    customer_name: 'عميل اختبار',
    customer_phone: '01000000001',
    branch: 'فرع شكري',
    invoice_datetime: '2026-09-27T15:18:00.000Z',
    net_amount: 290,
    staff_id: 'staff-other-seller',
    ...overrides,
  };
}

const items: InvoiceItemEvidenceProvider = {
  getItemsForInvoice: () => [
    { productNameRaw: 'BABY MILK 2', productId: 'prod-milk', productCode: '50001', quantity: 1 },
    { productNameRaw: 'home delivery', productId: 'prod-delivery', productCode: '50002', quantity: 1 },
  ],
};

describe('sale proof: invoice seller is not a link condition', () => {
  it('links the uniquely matching invoice even when a different pharmacist issued it', () => {
    const result = deriveSaleAttributionAssessment(ctx(), [invoice()], items);
    expect(result.selectedInvoiceId).toBe('inv-uuid-1');
    expect(result.selectedCandidate?.directInvoiceLink).toBe(true);
    expect(result.attributionLevel).toBe('proven');
    expect(result.selectedCandidate?.staffMatch).toBe('different');
    expect(result.ruleIds).toContain('attribution.trusted.automatic_customer_code_name_time_items_unique');
  });

  it('a seller difference alone never lowers a statistical recommendation', () => {
    const noItems = deriveSaleAttributionAssessment(
      ctx({ activeBasketItems: [{ productNameRaw: 'baby milk 2', productId: 'prod-milk', productCode: '50001', quantity: 1, resolutionStatus: 'proven' }] }),
      [invoice({ id: '', invoice_number: '10001' })],
      items
    );
    // No stable id: not automatic proof, but the recommendation must not cite the seller as a gap.
    expect(noItems.selectedCandidate?.directInvoiceLink).toBe(false);
    expect(noItems.candidateRecommendation?.missing ?? []).not.toContain('بائع الفاتورة موظف مختلف عن المشارك في الحالة');
  });

  it('a different customer, name, or quantity still blocks automatic proof', () => {
    expect(deriveSaleAttributionAssessment(ctx(), [invoice({ customer_code: '9002' })], items).attributionLevel).not.toBe('proven');
    expect(deriveSaleAttributionAssessment(ctx(), [invoice({ customer_name: 'عميل آخر' })], items).attributionLevel).not.toBe('proven');
    const wrongQty: InvoiceItemEvidenceProvider = {
      getItemsForInvoice: () => [{ productNameRaw: 'BABY MILK 2', productId: 'prod-milk', productCode: '50001', quantity: 3 }],
    };
    expect(deriveSaleAttributionAssessment(ctx(), [invoice()], wrongQty).attributionLevel).not.toBe('proven');
  });
});

describe('sale proof: customer identity is counted once', () => {
  it('a customer_id match and a phone match of the same customer add one identity weight', () => {
    const both = buildAttributionCandidate(ctx({ activeBasketItems: [] }), invoice({ customer_code: null, customer_name: null }));
    const idOnly = buildAttributionCandidate(
      ctx({ activeBasketItems: [], customerPhone: null }),
      invoice({ customer_code: null, customer_name: null, customer_phone: null })
    );
    expect(both.customerIdMatch && both.phoneMatch).toBe(true);
    expect(both.confidenceAssessment.score).toBeCloseTo(idOnly.confidenceAssessment.score, 10);
    const phoneEvidence = both.evidence.find((item) => item.kind === 'same_phone');
    expect(phoneEvidence?.matched).toBe(true);
    expect(phoneEvidence?.weight).toBe(0);
  });

  it('a phone-only identity still carries its own weight', () => {
    const phoneOnly = buildAttributionCandidate(
      ctx({ activeBasketItems: [], customerId: null, customerCode: null, customerName: null }),
      invoice({ customer_id: null, customer_code: null, customer_name: null })
    );
    expect(phoneOnly.phoneMatch).toBe(true);
    expect(phoneOnly.evidence.find((item) => item.kind === 'same_phone')?.weight).toBe(ATTRIBUTION_FACTOR_WEIGHTS.phoneMatch);
  });
});

describe('sale proof: competing invoices abstain', () => {
  it('two invoices that both pass the strict automatic gate produce no proof and no official credit', () => {
    const result = deriveSaleAttributionAssessment(ctx(), [
      invoice(),
      invoice({ id: 'inv-uuid-2', invoice_number: '10002', invoice_datetime: '2026-09-27T15:12:00.000Z' }),
    ], items);
    expect(result.selectedCandidate?.directInvoiceLink).toBe(false);
    expect(result.attributionLevel).not.toBe('proven');
    expect(result.isOfficialForStaffEvaluation).toBe(false);
    expect(result.needsHumanReview).toBe(true);
    expect(result.humanReviewReasons).toContain('competing_invoices_for_case');
  });

  it('another case claiming the same invoice keeps it out of official evaluation', () => {
    const result = deriveSaleAttributionAssessment(ctx(), [invoice()], items, [{ caseId: 'case-other', invoiceId: 'inv-uuid-1' }]);
    expect(result.competingCaseIds).toEqual(['case-other']);
    expect(result.contradictions).toContain('competing_case_attribution');
  });
});

function basketWithoutTotal(): CaseBasket {
  return {
    basketId: 'basket-1',
    caseId: 'case-x',
    version: 1,
    status: 'confirmed',
    createdAt: '2026-09-27T14:55:00.000Z',
    confirmedAt: null,
    confirmedByCustomerAt: '2026-09-27T15:00:00.000Z',
    staffId: null,
    announcedTotal: null,
    sourceMessageIds: [],
    confidence: { level: 'strongly_inferred', score: 0.8, ruleIds: [], evidence: [] },
    supersededByBasketId: null,
  };
}

describe('sale proof: a missing announced total does not hide a well-identified invoice', () => {
  it('header evidence is ready from item + quantity + customer + timing evidence', () => {
    const attribution = deriveSaleAttributionAssessment(ctx(), [invoice()], items);
    const match = deriveBasketInvoiceMatch({
      caseId: 'case-x', baskets: [basketWithoutTotal()], itemsByBasketId: {}, attribution,
      invoiceRow: invoice(), itemEvidenceProvider: items,
    });
    expect(match.headerEvidenceReady).toBe(true);
    // No announced total -> no total comparison, so no invented total-gap finding.
    expect(match.totalMatch).toBe('insufficient_data');
    expect(match.differences.some((d) => d.type === 'total_mismatch')).toBe(false);
  });

  it('weak evidence (no canonical item+quantity line) keeps header evidence insufficient', () => {
    const noLines: InvoiceItemEvidenceProvider = { getItemsForInvoice: () => 'unavailable' };
    const attribution = deriveSaleAttributionAssessment(ctx(), [invoice()], noLines);
    const match = deriveBasketInvoiceMatch({
      caseId: 'case-x', baskets: [basketWithoutTotal()], itemsByBasketId: {}, attribution,
      invoiceRow: invoice(), itemEvidenceProvider: noLines,
    });
    expect(match.headerEvidenceReady).toBe(false);
    expect(match.integrityEvaluationScope).toBe('insufficient');
  });
});

describe('sale proof: persisted readers ignore superseded and mismatched evidence', () => {
  const attribution = {
    case_id: 'case-x', attribution_level: 'strongly_inferred', selected_invoice_id: 'inv-1',
    identity_conflict: 'none', branch_conflict: false, competing_case_ids: [], candidate_count: 1,
    is_official_for_staff_evaluation: true, is_current_evaluation: true, superseded_at: null,
  };

  it('a superseded attribution row projects as no attribution', () => {
    const proof = deriveSaleProofStateFromPersisted('case-x', null, { ...attribution, is_current_evaluation: false, superseded_at: '2026-10-01T00:00:00Z' }, null);
    expect(proof.state).toBe('unknown');
  });

  it('a basket match computed for another invoice is not evidence for the current selection', () => {
    const stale = { case_id: 'case-x', invoice_id: 'inv-OLD', integrity_evaluation_scope: 'header_and_items', item_evidence_ready: true, header_evidence_ready: true, differences: [] };
    const proof = deriveSaleProofStateFromPersisted('case-x', null, attribution, stale);
    expect(proof.itemEvidenceReady).toBe(false);
    expect(proof.invoiceEvidenceScope).toBe('insufficient');
  });

  it('canonical case truth never surfaces credit from a superseded attribution', () => {
    const truth = readCanonicalCaseSaleTruth({
      caseId: 'case-x',
      analysisRow: { case_id: 'case-x', analysis_id: 'a-1', evidence_snapshot: {} },
      attributionRow: { ...attribution, analysis_id: 'a-1', superseded_at: '2026-10-01T00:00:00Z' },
      linkedV22CaseId: null,
      v22Row: null,
    });
    expect(truth.attribution).toBeNull();
  });
});
