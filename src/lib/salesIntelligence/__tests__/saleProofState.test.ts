import { describe, expect, it } from 'vitest';
import { deriveSaleAttributionAssessment, type CaseAttributionContext } from '../saleAttributionEngine';
import { deriveSaleProofState } from '../saleProofState';
import type { CommercialConfirmationAssessment, SaleAttributionAssessment } from '../types';

const COMPLETE: CommercialConfirmationAssessment = {
  caseId: 'case-ic2',
  basketId: 'basket-ic2',
  basketVersion: 1,
  summaryPresented: true,
  customerConfirmed: true,
  staffConfirmed: true,
  announcedTotalPresent: true,
  modificationAfterConfirmation: false,
  currentState: 'commercial_confirmation_complete',
  primaryMessageIds: [],
  ruleIds: [],
  confidence: { level: 'strongly_inferred', score: 0.9, ruleIds: [], evidence: [] },
  needsHumanReview: false,
  humanReviewReasons: [],
};

function ctx(overrides: Partial<CaseAttributionContext> = {}): CaseAttributionContext {
  return {
    caseId: 'case-ic2',
    customerId: 'cust-1',
    customerPhone: '01012345678',
    branchNameRaw: 'فرع شكري',
    caseEndedAt: '2026-09-15T09:10:00.000Z',
    commercialConfirmation: COMPLETE,
    activeAnnouncedTotal: {
      amount: 180,
      currency: 'EGP',
      messageId: 'm-total',
      staffId: null,
      announcedAt: '2026-09-15T09:08:00.000Z',
      basketVersion: 1,
      supersededByTotalId: null,
    },
    activeBasketValue: null,
    activeBasketItems: [],
    knownStaffIds: [],
    legacyMatchedInvoiceId: null,
    legacyMatchedInvoiceNumber: null,
    trustedInvoiceId: null,
    trustedInvoiceNumber: null,
    ...overrides,
  };
}

function strongAttribution(): SaleAttributionAssessment {
  return deriveSaleAttributionAssessment(ctx(), [
    {
      id: 'inv-1',
      invoice_number: '32069',
      customer_id: 'cust-1',
      customer_phone: '01012345678',
      branch_name: 'فرع شكري',
      invoice_datetime: '2026-09-15T09:15:00.000Z',
      net_amount: 180,
    },
  ]);
}

describe('I.C.2 — Canonical Sale Proof State', () => {
  it('1. trusted canonical invoice -> proven', () => {
    const attribution = deriveSaleAttributionAssessment(ctx({ trustedInvoiceId: 'inv-1' }), [
      { id: 'inv-1', invoice_number: '32069', customer_id: 'cust-1', invoice_datetime: '2026-09-15T09:15:00.000Z', net_amount: 180 },
    ]);
    const proof = deriveSaleProofState({ attribution, trustedInvoiceId: 'inv-1' });
    expect(proof.state).toBe('proven');
    expect(proof.trustedInvoiceId).toBe('inv-1');
  });

  it('2. strong statistical match without trusted invoice -> strongly_supported, never proven', () => {
    const proof = deriveSaleProofState({ attribution: strongAttribution(), trustedInvoiceId: null });
    expect(proof.state).toBe('strongly_supported');
    expect(proof.state).not.toBe('proven');
  });

  it('3. weak statistical match -> weakly_supported', () => {
    const a = strongAttribution();
    const weak: SaleAttributionAssessment = {
      ...a,
      attributionLevel: 'weakly_inferred',
      confidence: { ...a.confidence, level: 'weakly_inferred', score: 0.45 },
    };
    expect(deriveSaleProofState({ attribution: weak }).state).toBe('weakly_supported');
  });

  it('4. no invoice candidates -> unknown', () => {
    const attribution = deriveSaleAttributionAssessment(ctx(), []);
    expect(deriveSaleProofState({ attribution }).state).toBe('unknown');
  });

  it('5. customer identity conflict -> contradicted', () => {
    const attribution = deriveSaleAttributionAssessment(ctx({ customerId: 'cust-A' }), [
      {
        id: 'inv-1',
        customer_id: 'cust-B',
        customer_phone: '01012345678',
        invoice_datetime: '2026-09-15T09:15:00.000Z',
      },
    ]);
    expect(deriveSaleProofState({ attribution }).state).toBe('contradicted');
  });

  it('6. complete commercial closure without trusted invoice is not proven', () => {
    const attribution = deriveSaleAttributionAssessment(ctx(), []);
    expect(attribution.commercialConfirmationState).toBe('commercial_confirmation_complete');
    expect(deriveSaleProofState({ attribution }).state).not.toBe('proven');
  });

  it('7. a fulfillment-style conversation signal alone cannot prove a sale', () => {
    const attribution = deriveSaleAttributionAssessment(ctx(), []);
    const proof = deriveSaleProofState({ attribution });
    expect(proof.state).toBe('unknown');
    expect(proof.proofSource).toBe('insufficient_invoice_evidence');
  });

  it('8. algorithmic verified/statistical attribution alone is never proven', () => {
    const proof = deriveSaleProofState({ attribution: strongAttribution(), trustedInvoiceId: null });
    expect(proof.state).toBe('strongly_supported');
    expect(proof.trustedInvoiceId).toBeNull();
  });

  it('9. competing candidate ambiguity cannot become proven', () => {
    const attribution = deriveSaleAttributionAssessment(ctx(), [
      { id: 'inv-a', customer_id: 'cust-1', customer_phone: '01012345678', branch_name: 'فرع شكري', invoice_datetime: '2026-09-15T09:15:00.000Z', net_amount: 180 },
      { id: 'inv-b', customer_id: 'cust-1', customer_phone: '01012345678', branch_name: 'فرع شكري', invoice_datetime: '2026-09-15T09:16:00.000Z', net_amount: 180 },
    ]);
    const proof = deriveSaleProofState({ attribution });
    expect(proof.state).toBe('weakly_supported');
    expect(proof.state).not.toBe('proven');
  });

  it('10. missing branch data is not a contradiction by itself', () => {
    const attribution = deriveSaleAttributionAssessment(ctx({ branchNameRaw: null }), [
      { id: 'inv-1', customer_id: 'cust-1', customer_phone: '01012345678', invoice_datetime: '2026-09-15T09:15:00.000Z', net_amount: 180 },
    ]);
    const proof = deriveSaleProofState({ attribution });
    expect(proof.state).not.toBe('contradicted');
  });

  it('11. unavailable item evidence stays explicitly header_only', () => {
    const proof = deriveSaleProofState({ attribution: strongAttribution() });
    expect(proof.invoiceEvidenceScope).toBe('header_only');
    expect(proof.itemEvidenceReady).toBe(false);
    expect(proof.quantityEvidenceReady).toBe(false);
  });

  it('12. a trusted direct invoice with a cross-customer identity conflict is contradicted, not blindly proven', () => {
    const attribution = deriveSaleAttributionAssessment(
      ctx({ customerId: 'cust-A', trustedInvoiceId: 'inv-1' }),
      [{ id: 'inv-1', customer_id: 'cust-B', customer_phone: '01012345678', invoice_datetime: '2026-09-15T09:15:00.000Z' }]
    );
    const proof = deriveSaleProofState({ attribution, trustedInvoiceId: 'inv-1' });
    expect(proof.state).toBe('contradicted');
  });

  it('13. invariant: trustedInvoiceId null => state is never proven', () => {
    const proof = deriveSaleProofState({ attribution: strongAttribution(), trustedInvoiceId: null });
    expect(proof.trustedInvoiceId).toBeNull();
    expect(proof.state).not.toBe('proven');
  });

  it('14. duplicate invoice numbers across branches never substitute for canonical invoice id', () => {
    const attribution = deriveSaleAttributionAssessment(ctx({ trustedInvoiceId: 'inv-shokry' }), [
      { id: 'inv-shami', invoice_number: '32069', customer_id: 'cust-1', branch_name: 'فرع الشامي', invoice_datetime: '2026-09-15T09:15:00.000Z' },
      { id: 'inv-shokry', invoice_number: '32069', customer_id: 'cust-1', branch_name: 'فرع شكري', invoice_datetime: '2026-09-15T09:16:00.000Z' },
    ]);
    const proof = deriveSaleProofState({ attribution, trustedInvoiceId: 'inv-shokry' });
    expect(proof.state).toBe('proven');
    expect(proof.trustedInvoiceId).toBe('inv-shokry');
    expect(proof.selectedInvoiceId).toBe('inv-shokry');
  });

  it('15. cancelled trusted invoice is contradicted rather than proven', () => {
    const attribution = deriveSaleAttributionAssessment(ctx({ trustedInvoiceId: 'inv-1' }), [
      { id: 'inv-1', customer_id: 'cust-1', invoice_datetime: '2026-09-15T09:15:00.000Z' },
    ]);
    expect(deriveSaleProofState({ attribution, trustedInvoiceId: 'inv-1', invoiceStatusHint: 'cancelled' }).state).toBe('contradicted');
  });
});
