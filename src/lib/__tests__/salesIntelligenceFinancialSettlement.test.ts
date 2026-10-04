import { describe, expect, it } from 'vitest';
import { deriveFinancialSettlementAssessment } from '@/lib/salesIntelligence/financialSettlementEngine';
import { deriveCanonicalSalesOutcome } from '@/lib/salesIntelligence/canonicalSalesOutcomeEngine';
import { parseWhatsAppExport } from '@/lib/whatsappConversationParser';
import { deriveSegmentedCases } from '@/lib/salesIntelligence/salesIntelligencePipeline';

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
});
