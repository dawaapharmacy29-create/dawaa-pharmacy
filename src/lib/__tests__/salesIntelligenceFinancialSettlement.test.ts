import { describe, expect, it } from 'vitest';
import { deriveFinancialSettlementAssessment } from '@/lib/salesIntelligence/financialSettlementEngine';
import { deriveCanonicalSalesOutcome } from '@/lib/salesIntelligence/canonicalSalesOutcomeEngine';
import { deriveCommercialJourneyState } from '@/lib/salesIntelligence/commercialJourneyStateMachine';
import { deriveLostOpportunity } from '@/lib/salesIntelligence/lostOpportunityEngine';
import { parseWhatsAppExport } from '@/lib/whatsappConversationParser';
import { deriveSegmentedCases, runSalesIntelligencePipeline } from '@/lib/salesIntelligence/salesIntelligencePipeline';

// V15 regression lock: financial settlement may close an order operationally without inventing proven revenue.
const RAW = `[9/27/26, 9:03:34 PM] ابراهيم الصياد ٣٦٤٣: لوسمحت كنت محتاجه علبتين لبن هيرو بيبي نيوتروني دفنس 3
[9/27/26, 9:06:00 PM] You: جاري الارسال
[9/28/26, 2:52:09 AM] You: اتفضل رقم التحويل يا فندم
01028308235
استاذن حضرتك في صورة التحويل 🌸
[9/28/26, 3:08:01 AM] ابراهيم الصياد ٣٦٤٣: اسفه بجد نسيت خالص
[9/28/26, 3:08:09 AM] ابراهيم الصياد ٣٦٤٣: الحساب كام من فضلك
[9/28/26, 3:08:36 AM] You: 778 ان شاء الله
[9/28/26, 3:09:45 AM] ابراهيم الصياد ٣٦٤٣: [Forwarded] <image omitted>
[9/28/26, 3:10:40 AM] You: وصل شكرا جزيلا`;

function attribution(overrides: Record<string, unknown> = {}) {
  return {
    caseId: 'case-1',
    selectedInvoiceId: 'inv-74884',
    selectedInvoiceNumber: '74884',
    attributionLevel: 'strongly_inferred',
    isOfficialForStaffEvaluation: true,
    contradictions: [],
    confidence: { level: 'strongly_inferred', score: 0.9, ruleIds: [], evidence: [] },
    candidateCount: 1,
    selectedCandidate: null,
    primaryEvidence: [],
    competingCaseIds: [],
    legacyEvidenceUsed: false,
    needsHumanReview: false,
    humanReviewReasons: [],
    ...overrides,
  } as any;
}

describe('Sales Intelligence financial settlement', () => {
  it('closes an exact transfer settlement only when amount, proof, receipt and clean invoice attribution agree', () => {
    const messages = parseWhatsAppExport(RAW).map((m: any) => ({
      id: m.id,
      sender: m.sender,
      role: m.sender === 'You' ? 'staff' : 'customer',
      text: m.text,
      timestamp: m.timestamp,
      isMeaningful: !/image omitted/i.test(m.text),
    }));
    const result = deriveFinancialSettlementAssessment({
      caseId: 'case-1',
      messages: messages as any,
      attribution: attribution(),
      selectedInvoiceRow: { id: 'inv-74884', invoice_number: '74884', net_amount: 778 },
      customerIdentityStatus: 'resolved',
    });
    expect(result.status).toBe('settled');
    expect(result.amountMatch).toBe('exact');
    expect(result.announcedPaymentAmount).toBe(778);
    expect(result.invoiceAmount).toBe(778);
    expect(result.paymentProofDetected).toBe(true);
    expect(result.receiptAcknowledged).toBe(true);
    expect(result.needsHumanReview).toBe(false);
  });

  it('fails closed when the transfer amount conflicts with the selected invoice', () => {
    const messages = parseWhatsAppExport(RAW).map((m: any) => ({ id: m.id, sender: m.sender, role: m.sender === 'You' ? 'staff' : 'customer', text: m.text, timestamp: m.timestamp, isMeaningful: !/image omitted/i.test(m.text) }));
    const result = deriveFinancialSettlementAssessment({
      caseId: 'case-1', messages: messages as any, attribution: attribution(),
      selectedInvoiceRow: { id: 'inv-74884', invoice_number: '74884', net_amount: 700 },
      customerIdentityStatus: 'resolved',
    });
    expect(result.status).toBe('contradicted');
    expect(result.amountMatch).toBe('different');
    expect(result.needsHumanReview).toBe(true);
  });

  it('requires human review for a near payment/invoice amount match instead of auto-closing it', () => {
    const messages = parseWhatsAppExport(RAW).map((m: any) => ({ id: m.id, sender: m.sender, role: m.sender === 'You' ? 'staff' : 'customer', text: m.text, timestamp: m.timestamp, isMeaningful: !/image omitted/i.test(m.text) }));
    const result = deriveFinancialSettlementAssessment({
      caseId: 'case-1', messages: messages as any, attribution: attribution(),
      selectedInvoiceRow: { id: 'inv-74884', invoice_number: '74884', net_amount: 779 },
      customerIdentityStatus: 'resolved',
    });
    expect(result.status).toBe('pending');
    expect(result.amountMatch).toBe('near_match');
    expect(result.needsHumanReview).toBe(true);
    expect(result.ruleIds).toContain('financial_settlement.near_amount_requires_review');
  });

  it('propagates a financial amount contradiction into the case-level review gate', () => {
    const result = runSalesIntelligencePipeline({
      conversationId: 'ibrahim-financial-conflict',
      rawWhatsAppExportText: RAW,
      trustedConversationStartedAt: '2026-09-27T18:03:34.000Z',
      customerIdHint: 'cust-3643',
      customerPhoneHint: '01016891940',
      customerCodeHint: '3643',
      customerNameHint: 'ابراهيم الصياد',
      customerIdentityStatus: 'resolved',
      branchNameRawHint: 'فرع شكري',
      trustedInvoiceId: 'inv-74884',
      trustedInvoiceNumber: '74884',
      resolveInvoiceCandidates: () => [{
        id: 'inv-74884',
        invoice_number: '74884',
        customer_id: 'cust-3643',
        customer_code: '3643',
        customer_name: 'ابراهيم الصياد',
        customer_phone: '01016891940',
        branch_name: 'فرع شكري',
        invoice_datetime: '2026-09-27T18:06:00.000Z',
        close_datetime: '2026-09-28T00:11:00.000Z',
        net_amount: 700,
      }],
    });
    expect(result.caseAnalyses).toHaveLength(1);
    const analysis = result.caseAnalyses[0];
    expect(analysis.financialSettlement?.status).toBe('contradicted');
    expect(analysis.needsHumanReview).toBe(true);
    expect(analysis.humanReviewReasons).toContain('financial_settlement.payment_amount_conflicts_with_selected_invoice');
    expect(analysis.caseIntelligence.review.required).toBe(true);
  });

  it('does not treat payment-continuation messages as multiple independent customer requests', () => {
    const segmented = deriveSegmentedCases({
      conversationId: 'ibrahim',
      rawWhatsAppExportText: RAW,
      trustedConversationStartedAt: '2026-09-27T18:03:34.000Z',
      customerIdHint: 'a2fd0b6e-1562-438c-8f16-76a43539f792',
      customerPhoneHint: '01016891940',
    });
    expect(segmented.cases).toHaveLength(1);
    expect(segmented.cases[0].conversationCase.humanReviewReasons).not.toContain('possible_unsegmented_multiple_requests');
  });

  it('aligns settled-order journey and lost-opportunity truth without calling it a proven sale', () => {
    const salesOutcome = {
      caseId: 'case-1',
      outcome: 'order_confirmed_unproven',
      saleProofState: 'strongly_supported',
      isSaleCountable: false,
      isRevenueCountable: false,
      isOrderConfirmed: true,
      needsHumanReview: false,
      reasonCodes: ['outcome.financial_settlement_closed_sale_not_proven'],
    } as any;
    const settlement = {
      status: 'settled',
      primaryMessageIds: ['payment-context', 'amount', 'proof', 'receipt'],
      confidence: { level: 'strongly_inferred', score: 0.95, ruleIds: ['financial_settlement.exact_invoice_amount'], evidence: [] },
      needsHumanReview: false,
    } as any;
    const customerNeed = {
      caseId: 'case-1',
      primaryNeed: 'علبتين لبن',
      primaryNeedMessageId: 'need-1',
      products: [{ key: 'لبن', productNameRaw: 'لبن', roles: ['requested', 'final_basket'], alternatives: [], evidenceMessageIds: ['need-1'] }],
      unlinkedAvailability: [],
      unlinkedAlternatives: [],
      objections: [],
      unresolvedNeed: true,
      needDeclined: false,
      needDeclineMessageIds: [],
      evidenceMessageIds: ['need-1'],
      confidence: { level: 'strongly_inferred', score: 0.9, ruleIds: [], evidence: [] },
      needsHumanReview: false,
      humanReviewReasons: [],
    } as any;
    const commercial = {
      currentState: 'basket_in_progress',
      summaryPresented: false,
      customerConfirmed: false,
      staffConfirmed: false,
      primaryMessageIds: [],
    } as any;

    const journey = deriveCommercialJourneyState({
      caseId: 'case-1',
      messages: [],
      customerNeed,
      commercialConfirmation: commercial,
      salesOutcome,
      financialSettlement: settlement,
    });
    expect(journey.currentState).toBe('financially_settled');
    expect(journey.reasonCodes).toContain('journey.financial_settlement_closed_order_sale_proof_pending');

    const lost = deriveLostOpportunity({
      caseId: 'case-1',
      messages: [],
      customerNeed,
      unavailableDemand: [],
      commercialConfirmation: commercial,
      journeyState: journey,
      salesOutcome,
    });
    expect(lost.state).toBe('closed_order_unproven');
    expect(lost.waitingOn).toBeNull();
    expect(lost.recoverability).toBe('none');
    expect(salesOutcome.isSaleCountable).toBe(false);
    expect(salesOutcome.isRevenueCountable).toBe(false);
  });

  it('projects Ibrahim exact transfer settlement as invoiced/analyzed/closed without erasing the final-summary coaching gap', () => {
    const result = runSalesIntelligencePipeline({
      conversationId: 'ibrahim-v16',
      rawWhatsAppExportText: RAW,
      trustedConversationStartedAt: '2026-09-27T18:03:34.000Z',
      customerIdHint: 'cust-3643',
      customerPhoneHint: '01016891940',
      customerCodeHint: '3643',
      customerNameHint: 'ابراهيم الصياد',
      customerIdentityStatus: 'resolved',
      branchNameRawHint: 'فرع شكري',
      legacyMatchedInvoiceId: 'inv-74884',
      legacyMatchedInvoiceNumber: '74884',
      resolveInvoiceCandidates: () => [{
        id: 'inv-74884',
        invoice_number: '74884',
        customer_id: 'cust-3643',
        customer_code: '3643',
        customer_name: 'ابراهيم الصياد',
        customer_phone: '01016891940',
        branch_name: 'فرع شكري',
        invoice_datetime: '2026-09-27T18:06:00.000Z',
        close_datetime: '2026-09-28T00:11:00.000Z',
        net_amount: 778,
      }],
    });
    expect(result.caseAnalyses).toHaveLength(1);
    const analysis = result.caseAnalyses[0];
    expect(analysis.financialSettlement?.status).toBe('settled');
    expect(analysis.salesOutcome.outcome).toBe('order_confirmed_unproven');
    expect(analysis.salesOutcome.isSaleCountable).toBe(false);
    expect(analysis.salesOutcome.isRevenueCountable).toBe(false);
    expect(analysis.conversationCase.status).toBe('invoiced');
    expect(analysis.status).toBe('analyzed');
    expect(analysis.journeyState.currentState).toBe('financially_settled');
    expect(analysis.lostOpportunity.state).toBe('closed_order_unproven');
    expect(analysis.lostOpportunity.waitingOn).toBeNull();
    expect(analysis.followUp.decision).toBe('not_needed');
    expect(analysis.followUp.notNeededReason).toBe('financially_settled');
    expect(analysis.failureReasons).toContain('final_summary_missing');
    expect(analysis.needsHumanReview).toBe(false);
  });

  it('closes the order commercially without promoting statistical invoice evidence to proven revenue', () => {
    const outcome = deriveCanonicalSalesOutcome({
      caseId: 'case-1',
      caseType: 'sales_opportunity',
      commercialConfirmation: { currentState: 'basket_in_progress', customerConfirmed: false },
      saleProof: { state: 'strongly_supported', needsHumanReview: false } as any,
      financialSettlement: { status: 'settled' } as any,
      hasMeaningfulBasketItems: true,
      needsHumanReview: false,
    });
    expect(outcome.outcome).toBe('order_confirmed_unproven');
    expect(outcome.isOrderConfirmed).toBe(true);
    expect(outcome.isSaleCountable).toBe(false);
    expect(outcome.isRevenueCountable).toBe(false);
    expect(outcome.reasonCodes).toContain('outcome.financial_settlement_closed_sale_not_proven');
  });

  it('projects Mohamed exact official invoice as invoiced_unproven without inventing product identity or proven revenue', () => {
    const raw = `[9/26/26, 9:46:29 PM] محمد الجندي 5179: <image omitted>
[9/26/26, 9:46:41 PM] محمد الجندي 5179: عايزه من دا 4
[9/26/26, 9:46:46 PM] You: أهلًا وسهلًا بحضرتك\nمع حضرتك د دنيا
[9/26/26, 9:47:16 PM] محمد الجندي 5179: [Forwarded] <audio omitted>
[9/26/26, 9:47:25 PM] محمد الجندي 5179: وعايزه العلاج دا
[9/26/26, 9:50:02 PM] You: يعني كدا 4 علب لبن مع 2 نوع شراب اللي الدكتور بيقولهم في الريكورد
[9/26/26, 9:50:08 PM] You: مظبوط كدا ان شاء الله؟
[9/26/26, 9:50:12 PM] محمد الجندي 5179: ايوا
[9/26/26, 9:50:25 PM] محمد الجندي 5179: كدا هيبقا كام
[9/26/26, 9:50:44 PM] You: حالا هبلغ حضرتك
[9/26/26, 9:50:51 PM] محمد الجندي 5179: تمام
[9/26/26, 9:56:48 PM] You: 1579ج ان شاء الله
[9/26/26, 9:58:03 PM] محمد الجندي 5179: تمام
[9/26/26, 10:01:12 PM] You: جاري الارسال`;
    const result = runSalesIntelligencePipeline({
      conversationId: 'mohamed-v19',
      rawWhatsAppExportText: raw,
      trustedConversationStartedAt: '2026-09-26T18:46:29.000Z',
      customerIdHint: 'cust-5179',
      customerPhoneHint: '01012808732',
      customerCodeHint: '5179',
      customerNameHint: 'محمد الجندي2',
      customerIdentityStatus: 'resolved',
      branchNameRawHint: 'فرع شكري',
      resolveInvoiceCandidates: () => [{
        id: 'inv-74720',
        invoice_number: '74720',
        customer_id: 'cust-5179',
        customer_code: '5179',
        customer_name: 'محمد الجندي2',
        customer_phone: '01012808732',
        branch_name: 'فرع شكري',
        invoice_datetime: '2026-09-26T19:03:00.000Z',
        close_datetime: '2026-09-26T19:03:00.000Z',
        net_amount: 1579,
      }],
    });
    expect(result.caseAnalyses).toHaveLength(1);
    const analysis = result.caseAnalyses[0];
    expect(analysis.commercialConfirmation.currentState).toBe('commercial_confirmation_complete');
    expect(analysis.activeBasket?.announcedTotal?.amount).toBe(1579);
    expect(analysis.attribution.selectedInvoiceNumber).toBe('74720');
    expect(analysis.attribution.isOfficialForStaffEvaluation).toBe(true);
    expect(analysis.salesOutcome.reasonCodes).toContain('outcome.invoice_backed_order_closed_sale_not_proven');
    expect(analysis.salesOutcome.isSaleCountable).toBe(false);
    expect(analysis.salesOutcome.isRevenueCountable).toBe(false);
    expect(analysis.conversationCase.status).toBe('invoiced');
    expect(analysis.journeyState.currentState).toBe('invoiced_unproven');
    expect(analysis.lostOpportunity.state).toBe('closed_order_unproven');
    expect(analysis.lostOpportunity.waitingOn).toBeNull();
    expect(analysis.followUp.decision).toBe('not_needed');
    expect(analysis.followUp.notNeededReason).toBe('invoiced_unproven');
    expect(analysis.failureReasons).toContain('product_identity_unresolved');
    expect(analysis.humanReviewReasons).not.toContain('unresolved_product_identity');
    expect(analysis.needsHumanReview).toBe(false);
    expect(analysis.status).toBe('analyzed');
  });

  it('does not close a confirmed order as invoiced_unproven when the announced total differs from the invoice', () => {
    const raw = `[9/26/26, 9:46:41 PM] محمد الجندي 5179: عايزه من دا 4
[9/26/26, 9:50:02 PM] You: يعني كدا 4 علب لبن مع 2 نوع شراب اللي الدكتور بيقولهم في الريكورد
[9/26/26, 9:50:08 PM] You: مظبوط كدا؟
[9/26/26, 9:50:12 PM] محمد الجندي 5179: ايوا
[9/26/26, 9:50:25 PM] محمد الجندي 5179: كدا هيبقا كام
[9/26/26, 9:56:48 PM] You: 1579ج ان شاء الله
[9/26/26, 9:58:03 PM] محمد الجندي 5179: تمام
[9/26/26, 10:01:12 PM] You: جاري الارسال`;
    const result = runSalesIntelligencePipeline({
      conversationId: 'mohamed-v19-mismatch',
      rawWhatsAppExportText: raw,
      trustedConversationStartedAt: '2026-09-26T18:46:41.000Z',
      customerIdHint: 'cust-5179',
      customerPhoneHint: '01012808732',
      customerCodeHint: '5179',
      customerNameHint: 'محمد الجندي2',
      customerIdentityStatus: 'resolved',
      branchNameRawHint: 'فرع شكري',
      resolveInvoiceCandidates: () => [{
        id: 'inv-wrong', invoice_number: 'wrong', customer_id: 'cust-5179', customer_code: '5179',
        customer_name: 'محمد الجندي2', customer_phone: '01012808732', branch_name: 'فرع شكري',
        invoice_datetime: '2026-09-26T19:03:00.000Z', net_amount: 1700,
      }],
    });
    const analysis = result.caseAnalyses[0];
    expect(analysis.salesOutcome.reasonCodes).not.toContain('outcome.invoice_backed_order_closed_sale_not_proven');
    expect(analysis.journeyState.currentState).not.toBe('invoiced_unproven');
    expect(analysis.lostOpportunity.state).not.toBe('closed_order_unproven');
  });

});
