import { describe, expect, it } from 'vitest';
import { deriveSaleAttributionAssessment, type CaseAttributionContext } from '@/lib/salesIntelligence/saleAttributionEngine';
import type { CommercialConfirmationAssessment } from '@/lib/salesIntelligence/types';

const confirmation: CommercialConfirmationAssessment = {
  caseId: 'case-draft-final',
  basketId: 'basket-1',
  basketVersion: 1,
  summaryPresented: false,
  customerConfirmed: false,
  staffConfirmed: false,
  announcedTotalPresent: false,
  modificationAfterConfirmation: false,
  currentState: 'basket_in_progress',
  primaryMessageIds: [],
  ruleIds: [],
  confidence: { level: 'weakly_inferred', score: 0.6, ruleIds: [], evidence: [] },
  needsHumanReview: false,
  humanReviewReasons: [],
};

const ctx: CaseAttributionContext = {
  caseId: 'case-draft-final',
  customerId: 'customer-4250',
  customerPhone: null,
  branchNameRaw: 'فرع شكري',
  caseStartedAt: '2026-09-12T06:01:43Z',
  caseEndedAt: '2026-09-12T06:26:35Z',
  commercialConfirmation: confirmation,
  activeAnnouncedTotal: null,
  activeBasketValue: null,
  activeBasketItems: [],
  knownStaffIds: [],
  legacyMatchedInvoiceId: null,
  legacyMatchedInvoiceNumber: null,
  trustedInvoiceId: null,
  trustedInvoiceNumber: null,
};

describe('Sale Attribution — draft to final invoice truth', () => {
  it('rejects a zero unclosed draft and selects the paid final invoice instead', () => {
    const result = deriveSaleAttributionAssessment(ctx, [
      {
        id: 'draft-72367',
        invoice_number: '72367',
        customer_id: 'customer-4250',
        branch: 'فرع شكري',
        invoice_datetime: '2026-09-12T06:09:00Z',
        close_datetime: null,
        net_amount: 0,
      },
      {
        id: 'final-72368',
        invoice_number: '72368',
        customer_id: 'customer-4250',
        branch: 'فرع شكري',
        invoice_datetime: '2026-09-12T06:10:00Z',
        close_datetime: '2026-09-12T07:45:00Z',
        net_amount: 510,
      },
    ]);

    expect(result.selectedInvoiceId).toBe('final-72368');
    expect(result.selectedInvoiceNumber).toBe('72368');
    expect(result.alternativeCandidates.find((row) => row.invoiceId === 'draft-72367')?.disqualifiers).toContain('draft_zero_invoice');
  });

  it('does not promote a zero unclosed draft to a selected statistical transaction when it is the only candidate', () => {
    const result = deriveSaleAttributionAssessment(ctx, [
      {
        id: 'draft-only',
        invoice_number: '72367',
        customer_id: 'customer-4250',
        branch: 'فرع شكري',
        invoice_datetime: '2026-09-12T06:09:00Z',
        close_datetime: null,
        net_amount: 0,
      },
    ]);

    expect(result.selectedInvoiceId).toBeNull();
    expect(result.needsHumanReview).toBe(true);
    expect(result.humanReviewReasons).toContain('draft_zero_invoice_not_transaction_truth');
  });
});
