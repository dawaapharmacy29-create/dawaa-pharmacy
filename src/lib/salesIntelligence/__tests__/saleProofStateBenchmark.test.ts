import { describe, expect, it } from 'vitest';
import { deriveSaleAttributionAssessment, type CaseAttributionContext } from '../saleAttributionEngine';
import { deriveSaleProofState } from '../saleProofState';
import type { CommercialConfirmationAssessment } from '../types';

const confirmation: CommercialConfirmationAssessment = {
  caseId: 'bench',
  basketId: 'basket',
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

function context(trustedInvoiceId: string | null = null): CaseAttributionContext {
  return {
    caseId: 'bench',
    customerId: 'cust',
    customerPhone: null,
    branchNameRaw: 'فرع شكري',
    caseEndedAt: '2026-09-15T10:00:00.000Z',
    commercialConfirmation: confirmation,
    activeAnnouncedTotal: null,
    activeBasketValue: null,
    activeBasketItems: [],
    knownStaffIds: [],
    legacyMatchedInvoiceId: null,
    legacyMatchedInvoiceNumber: null,
    trustedInvoiceId,
    trustedInvoiceNumber: null,
  };
}

function runContractBenchmark() {
  const trusted = deriveSaleProofState({
    attribution: deriveSaleAttributionAssessment(context('inv-trusted'), [
      { id: 'inv-trusted', customer_id: 'cust', branch_name: 'فرع شكري', invoice_datetime: '2026-09-15T10:05:00.000Z' },
    ]),
    trustedInvoiceId: 'inv-trusted',
  });

  const statistical = deriveSaleProofState({
    attribution: deriveSaleAttributionAssessment(context(), [
      { id: 'inv-stat', customer_id: 'cust', branch_name: 'فرع شكري', invoice_datetime: '2026-09-15T10:05:00.000Z' },
    ]),
  });

  const conversationOnly = deriveSaleProofState({
    attribution: deriveSaleAttributionAssessment(context(), []),
  });

  const conflicted = deriveSaleProofState({
    attribution: deriveSaleAttributionAssessment({ ...context(), customerId: 'cust-A', customerPhone: '01012345678' }, [
      { id: 'inv-conflict', customer_id: 'cust-B', customer_phone: '01012345678', invoice_datetime: '2026-09-15T10:05:00.000Z' },
    ]),
  });

  const cases = [trusted, statistical, conversationOnly, conflicted];
  return {
    states: cases.map((c) => c.state),
    falseProvenSale: cases.filter((c) => c.state === 'proven' && !c.trustedInvoiceId).length,
    provenWithoutTrustedInvoice: cases.filter((c) => c.state === 'proven' && c.trustedInvoiceId == null).length,
    conversationOnlyProven: conversationOnly.state === 'proven' ? 1 : 0,
    statisticalOnlyProven: statistical.state === 'proven' ? 1 : 0,
    contradictionClassificationErrors: conflicted.state === 'contradicted' ? 0 : 1,
  };
}

describe('I.C.2 deterministic Sale Proof contract benchmark', () => {
  it('keeps all safety-critical false-proof metrics at zero', () => {
    const result = runContractBenchmark();
    expect(result.falseProvenSale).toBe(0);
    expect(result.provenWithoutTrustedInvoice).toBe(0);
    expect(result.conversationOnlyProven).toBe(0);
    expect(result.statisticalOnlyProven).toBe(0);
    expect(result.contradictionClassificationErrors).toBe(0);
  });

  it('is deterministic across repeated evaluations', () => {
    expect(runContractBenchmark()).toEqual(runContractBenchmark());
  });
});
