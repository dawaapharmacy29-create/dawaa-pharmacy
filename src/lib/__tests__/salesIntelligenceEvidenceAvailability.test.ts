import { describe, expect, it } from 'vitest';
import {
  deriveSaleAttributionAssessment,
  type CaseAttributionContext,
  type InvoiceItemEvidenceProvider,
} from '@/lib/salesIntelligence/saleAttributionEngine';
import { deriveBasketInvoiceMatch } from '@/lib/salesIntelligence/basketInvoiceMatchingEngine';
import { buildInvoiceItemEvidenceProvider } from '@/lib/salesIntelligence/invoiceItemEvidenceRepository';
import { reviewSourceRowToBatchConversation } from '@/lib/salesIntelligence/persistence/reviewSourceBatchAdapter';
import { evaluateCanonicalSourceGate } from '@/lib/salesIntelligence/persistence/canonicalSourceGate';
import type { CommercialConfirmationAssessment } from '@/lib/salesIntelligence/types';

const confirmation: CommercialConfirmationAssessment = {
  caseId: 'mohamed-case', basketId: 'basket:1', basketVersion: 1,
  summaryPresented: true, customerConfirmed: true, staffConfirmed: true,
  announcedTotalPresent: true, modificationAfterConfirmation: false,
  currentState: 'commercial_confirmation_complete', primaryMessageIds: [], ruleIds: [],
  confidence: { level: 'strongly_inferred', score: 0.9, ruleIds: [], evidence: [] },
  needsHumanReview: false, humanReviewReasons: [],
};

const invoice74720 = {
  id: 'invoice-74720', invoice_number: '74720', customer_id: 'cust-5179',
  customer_code: '5179', customer_name: 'محمد الجندي(P500)', customer_phone: '01012808732',
  branch: 'فرع شكري', invoice_datetime: '2026-09-26T19:03:00.000Z', net_amount: 1579,
};

const provider: InvoiceItemEvidenceProvider = {
  getItemsForInvoice: () => [
    { productNameRaw: 'BEBELAC EC MILK', quantity: 4, lineTotal: 1500 },
    { productNameRaw: 'FLAGYL SUSP', quantity: 1, lineTotal: 26 },
  ],
};

function total1579() {
  return { amount: 1579, currency: 'EGP' as const, messageId: 'total', staffId: null,
    announcedAt: '2026-09-26T18:56:48.000Z', basketVersion: 1, supersededByTotalId: null };
}

function baseCtx(item: CaseAttributionContext['activeBasketItems'][number]): CaseAttributionContext {
  return {
    caseId: 'mohamed-case', customerId: 'cust-5179', customerPhone: '01012808732',
    customerCode: '5179', customerName: 'محمد الجندي', branchNameRaw: 'فرع شكري',
    caseStartedAt: '2026-09-26T18:46:29.000Z', caseEndedAt: '2026-09-26T19:01:12.000Z',
    commercialConfirmation: confirmation, activeAnnouncedTotal: total1579(), activeBasketValue: null,
    activeBasketItems: [item], knownStaffIds: ['staff-donia'], legacyMatchedInvoiceId: null,
    legacyMatchedInvoiceNumber: null, trustedInvoiceId: null, trustedInvoiceNumber: null,
  };
}

function basket(item: any) {
  return {
    basketId: 'basket:1', caseId: 'mohamed-case', version: 1, status: 'confirmed' as const,
    createdAt: '2026-09-26T18:50:02.000Z', confirmedAt: '2026-09-26T19:01:12.000Z',
    confirmedByCustomerAt: '2026-09-26T18:50:12.000Z', staffId: null, announcedTotal: total1579(),
    sourceMessageIds: [], confidence: { level: 'strongly_inferred' as const, score: 0.9, ruleIds: [], evidence: [] },
    supersededByBasketId: null, item,
  };
}

describe('Sales Intelligence evidence availability hardening', () => {
  it('passes persisted SMART REVIEW staff_id into knownStaffIds', () => {
    const result = reviewSourceRowToBatchConversation({
      id: 'source-1', raw_text: 'x', conversation_started_at: '2026-09-26T18:46:29.000Z',
      customer_id: 'cust-5179', customer_phone: '01012808732', customer_name: 'محمد الجندي',
      customer_code: '5179', branch: 'فرع شكري', staff_id: 'staff-donia',
    });
    expect(result.knownStaffIds).toEqual(['staff-donia']);
  });

  it('rejects a coarse review source when finer V22-owned sources contain the real order and payment continuation', () => {
    const orderText = '[9/27/26, 9:03:34 PM] ابراهيم: علبتين لبن\n[9/27/26, 9:06:00 PM] You: جاري الارسال';
    const paymentText = '[9/28/26, 2:52:09 AM] You: رقم التحويل\n[9/28/26, 3:10:40 AM] You: وصل شكرا جزيلا';
    const coarseText = `${orderText}\n${paymentText}`;
    const coarse = {
      id: 'coarse', review_status: 'ready_detailed', source_filename: 'ibrahim.zip',
      conversation_started_at: '2026-09-27T18:03:05.000Z',
      conversation_ended_at: '2026-09-28T00:10:40.000Z', raw_text: coarseText,
    };
    const order = {
      id: 'order', review_status: 'ready_detailed', source_filename: 'ibrahim.zip',
      conversation_started_at: '2026-09-27T18:03:05.000Z',
      conversation_ended_at: '2026-09-27T18:15:35.000Z', raw_text: orderText,
    };
    const payment = {
      id: 'payment', review_status: 'ready_detailed', source_filename: 'ibrahim.zip',
      conversation_started_at: '2026-09-27T23:52:09.000Z',
      conversation_ended_at: '2026-09-28T00:10:40.000Z', raw_text: paymentText,
    };
    const decision = evaluateCanonicalSourceGate(coarse, {
      siblings: [coarse, order, payment],
      v22CaseIdsBySource: new Map([
        ['coarse', ['legacy-coarse-case']],
        ['order', ['canonical-order-case']],
        ['payment', ['canonical-payment-case']],
      ]),
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.reason).toBe('superseded_by_finer_canonical_sources');
    expect(decision.supersedingSourceIds).toEqual(['order', 'payment']);
  });

  it('aggregates split lines for the same actual invoice product before quantity comparison', () => {
    const splitLineProvider = buildInvoiceItemEvidenceProvider(
      [invoice74720] as any[],
      [
        {
          invoice_id: 'invoice-74720', invoice_number: '74720', branch: 'فرع شكري',
          product_code: '30088', product_name: 'BEBELAC EC MILK', quantity: 3,
          unit_price: 1125, line_total: 1388.154467309195,
        },
        {
          invoice_id: 'invoice-74720', invoice_number: '74720', branch: 'فرع شكري',
          product_code: '30088', product_name: 'BEBELAC EC MILK', quantity: 1,
          unit_price: 375, line_total: 154.23938525657724,
        },
        {
          invoice_id: 'invoice-74720', invoice_number: '74720', branch: 'فرع شكري',
          product_code: '36426', product_name: 'FLAGYL SUSP', quantity: 1,
          unit_price: 26, line_total: 10.693930711122688,
        },
      ] as any[]
    );
    const invoiceItems = splitLineProvider.getItemsForInvoice('invoice-74720', '74720');
    expect(invoiceItems).not.toBe('unavailable');
    if (invoiceItems === 'unavailable') return;
    const milk = invoiceItems.find((item) => item.productCode === '30088');
    expect(milk?.quantity).toBe(4);

    const resolvedMilk = {
      productNameRaw: 'BEBELAC EC MILK', productId: null, quantity: 4, resolutionStatus: 'proven' as const,
    };
    const attribution = deriveSaleAttributionAssessment(baseCtx(resolvedMilk), [invoice74720], splitLineProvider);
    expect(attribution.selectedInvoiceNumber).toBe('74720');
    expect(attribution.selectedCandidate?.productMatch).toBe('available_match');
    expect(attribution.selectedCandidate?.quantityMatch).toBe('available_match');

    const b = basket(resolvedMilk);
    const match = deriveBasketInvoiceMatch({
      caseId: 'mohamed-case', baskets: [b],
      itemsByBasketId: { 'basket:1': [{
        itemId: 'milk-4', basketId: 'basket:1', productNameRaw: 'BEBELAC EC MILK',
        productId: null, quantity: 4, unit: null, unitPrice: null, lineTotal: null,
        sourceMessageId: 'milk-request', confidence: { level: 'proven', score: 0.9, ruleIds: [], evidence: [] },
        resolutionStatus: 'proven',
      }] },
      attribution, invoiceRow: invoice74720, itemEvidenceProvider: splitLineProvider,
    });
    expect(match.quantityMatch).toBe('exact');
    expect(match.differences.some((d) => d.type === 'quantity_mismatch')).toBe(false);
  });

  it('treats unresolved media product identity as unavailable evidence, not a product contradiction', () => {
    const unresolved = { productNameRaw: 'عايزه من دا 4', productId: null, quantity: 4, resolutionStatus: 'unknown' as const };
    const attribution = deriveSaleAttributionAssessment(baseCtx(unresolved), [invoice74720], provider);
    expect(attribution.selectedInvoiceNumber).toBe('74720');
    expect(attribution.attributionLevel).toBe('strongly_inferred');
    expect(attribution.selectedCandidate?.productMatch).toBe('unavailable');

    const b = basket(unresolved);
    const match = deriveBasketInvoiceMatch({
      caseId: 'mohamed-case', baskets: [b],
      itemsByBasketId: { 'basket:1': [{
        itemId: 'i1', basketId: 'basket:1', productNameRaw: unresolved.productNameRaw,
        productId: null, quantity: 4, unit: null, unitPrice: null, lineTotal: null,
        sourceMessageId: 'm1', confidence: { level: 'unknown', score: 0.3, ruleIds: [], evidence: [] },
        resolutionStatus: 'unknown',
      }] },
      attribution, invoiceRow: invoice74720, itemEvidenceProvider: provider,
    });
    expect(match.totalMatch).toBe('exact');
    expect(match.itemMatch).toBe('insufficient_data');
    expect(match.quantityMatch).toBe('insufficient_data');
    expect(match.differences.some((d) => d.type === 'missing_item' || d.type === 'extra_item')).toBe(false);
    expect(match.humanReviewReasons).toContain('unresolved_product_identity');
  });

  it('keeps a genuinely resolved but different product as a real mismatch', () => {
    const known = { productNameRaw: 'KNOWN PRODUCT', productId: null, quantity: 1, resolutionStatus: 'proven' as const };
    const attribution = deriveSaleAttributionAssessment(baseCtx(known), [invoice74720], provider);
    expect(attribution.selectedCandidate?.productMatch).toBe('available_mismatch');
    expect(attribution.attributionLevel).toBe('weakly_inferred');

    const b = basket(known);
    const match = deriveBasketInvoiceMatch({
      caseId: 'mohamed-case', baskets: [b],
      itemsByBasketId: { 'basket:1': [{
        itemId: 'i2', basketId: 'basket:1', productNameRaw: known.productNameRaw,
        productId: null, quantity: 1, unit: null, unitPrice: null, lineTotal: null,
        sourceMessageId: 'm2', confidence: { level: 'proven', score: 0.9, ruleIds: [], evidence: [] },
        resolutionStatus: 'proven',
      }] },
      attribution, invoiceRow: invoice74720, itemEvidenceProvider: provider,
    });
    expect(match.itemMatch).toBe('mismatch');
    expect(match.differences.some((d) => d.type === 'missing_item')).toBe(true);
    expect(match.differences.some((d) => d.type === 'extra_item')).toBe(true);
  });
});