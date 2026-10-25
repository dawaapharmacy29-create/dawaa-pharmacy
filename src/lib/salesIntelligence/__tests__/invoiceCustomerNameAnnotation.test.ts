// Bracketed B-Connect commercial annotations on the invoice customer name are ignored; any other
// bracketed text is part of the name and a real difference still blocks the automatic link.
import { describe, expect, it } from 'vitest';
import {
  deriveSaleAttributionAssessment,
  type CaseAttributionContext,
  type InvoiceItemEvidenceProvider,
} from '@/lib/salesIntelligence/saleAttributionEngine';
import type { CommercialConfirmationAssessment } from '@/lib/salesIntelligence/types';

const CONFIRMED: CommercialConfirmationAssessment = {
  caseId: 'case-1',
  basketId: 'basket-1',
  basketVersion: 1,
  summaryPresented: true,
  customerConfirmed: true,
  staffConfirmed: true,
  announcedTotalPresent: true,
  modificationAfterConfirmation: false,
  currentState: 'commercial_confirmation_complete',
  primaryMessageIds: [],
  ruleIds: [],
  confidence: { level: 'strongly_inferred', score: 0.85, ruleIds: [], evidence: [] },
  needsHumanReview: false,
  humanReviewReasons: [],
};
const ITEM = { productNameRaw: 'Trimed', productId: 'p-trimed', quantity: 1 };
const ctx: CaseAttributionContext = {
  caseId: 'case-1',
  customerId: 'cust-2490',
  customerPhone: '01100742008',
  customerCode: '2490',
  customerName: 'محمود صالح',
  branchNameRaw: 'فرع شكري',
  caseStartedAt: '2026-09-28T03:50:00.000Z',
  caseEndedAt: '2026-09-28T03:58:00.000Z',
  commercialConfirmation: CONFIRMED,
  activeAnnouncedTotal: null,
  activeBasketValue: null,
  activeBasketItems: [{ ...ITEM, resolutionStatus: 'proven' as const }],
  knownStaffIds: [],
  legacyMatchedInvoiceId: null,
  legacyMatchedInvoiceNumber: null,
  trustedInvoiceId: null,
  trustedInvoiceNumber: null,
};
const items: InvoiceItemEvidenceProvider = { getItemsForInvoice: () => [ITEM] };
const assess = (customerName: string) =>
  deriveSaleAttributionAssessment(
    ctx,
    [
      {
        id: 'inv-1',
        invoice_number: 'N-1',
        customer_id: 'cust-2490',
        customer_code: '2490',
        customer_name: customerName,
        customer_phone: '01100742008',
        branch: 'فرع شكري',
        invoice_datetime: '2026-09-28T03:56:00.000Z',
        net_amount: 300,
      },
    ],
    items
  );

describe('invoice customer name annotations', () => {
  it.each([
    'محمود صالح (P 500)',
    'محمود صالح(P500)',
    'محمود صالح (200p)',
    'محمود صالح (10%)',
    'محمود صالح ( 5 % )',
    'محمود صالح (DISC)',
    'محمود صالح (points)',
    'محمود صالح (بوينتس)',
    'محمود صالح (VIP)',
    'محمود صالح (P)',
  ])('ignores the commercial annotation in %s', (name) => {
    expect(assess(name).attributionLevel).toBe('proven');
  });

  it.each([
    'محمود صالح (تبع ممدوح)',
    'محمود صالح (م السروجي)',
    'محمود صالح (بيت)',
    'محمود صالح (DOUBLE CHECK)',
  ])('keeps other bracketed text as part of the name: %s is not automatically linked', (name) => {
    const assessment = assess(name);
    expect(assessment.attributionLevel).not.toBe('proven');
  });

  it('a genuinely different name stays different with or without an annotation', () => {
    expect(assess('محمود سالم (P 500)').attributionLevel).not.toBe('proven');
    expect(assess('أحمد صالح').attributionLevel).not.toBe('proven');
  });
});
