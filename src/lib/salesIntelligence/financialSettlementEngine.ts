import type { InvoiceLike } from '../invoices/invoiceCore';
import { getInvoiceAmount } from '../invoices/invoiceCore';
import type { NormalizedConversationMessageV32 } from '../whatsappConversationUnderstandingV32';
import { detectPaymentSettlementSignals } from './paymentSettlementSignals';
import type { ConfidenceAssessment, EvidenceRef, FinancialSettlementAssessment, SaleAttributionAssessment } from './types';

function ref(messageId: string, description: string): EvidenceRef {
  return { sourceTable: 'whatsapp_review_sources', sourceId: '', messageIds: [messageId], description };
}

function confidence(level: ConfidenceAssessment['level'], score: number, ruleIds: string[], evidence: EvidenceRef[]): ConfidenceAssessment {
  return { level, score, ruleIds, evidence };
}

function clean(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function invoiceRowIdentity(row: InvoiceLike | null): { id: string | null; number: string | null } {
  if (!row) return { id: null, number: null };
  const raw = row as Record<string, unknown>;
  const number = clean(raw.invoice_number ?? raw.invoice_no) || null;
  const id = clean(raw.id ?? number) || null;
  return { id, number };
}

export interface FinancialSettlementInput {
  caseId: string;
  messages: NormalizedConversationMessageV32[];
  attribution: SaleAttributionAssessment;
  selectedInvoiceRow: InvoiceLike | null;
  customerIdentityStatus?: 'resolved' | 'unresolved' | 'ambiguous' | 'contradicted';
}

export function deriveFinancialSettlementAssessment(input: FinancialSettlementInput): FinancialSettlementAssessment {
  const signals = detectPaymentSettlementSignals(input.messages);
  const invoiceAmountRaw = input.selectedInvoiceRow ? getInvoiceAmount(input.selectedInvoiceRow) : 0;
  const invoiceAmount = invoiceAmountRaw > 0 ? invoiceAmountRaw : null;
  const announced = signals.announcedPaymentAmount;
  const delta = announced != null && invoiceAmount != null ? Math.abs(announced - invoiceAmount) : null;
  const amountMatch = delta == null
    ? 'not_available'
    : delta <= 0.5
      ? 'exact'
      : delta <= Math.max(2, invoiceAmount! * 0.01)
        ? 'near_match'
        : 'different';

  const selectedRow = invoiceRowIdentity(input.selectedInvoiceRow);
  const selectedInvoiceMatchesRow = Boolean(
    input.selectedInvoiceRow &&
    input.attribution.selectedInvoiceId &&
    selectedRow.id === input.attribution.selectedInvoiceId &&
    (
      !input.attribution.selectedInvoiceNumber ||
      !selectedRow.number ||
      selectedRow.number === input.attribution.selectedInvoiceNumber
    )
  );
  const identitySafe = input.customerIdentityStatus === undefined || input.customerIdentityStatus === 'resolved';
  const attributionStrong =
    Boolean(input.attribution.selectedInvoiceId) &&
    ['proven', 'strongly_inferred'].includes(input.attribution.attributionLevel) &&
    input.attribution.isOfficialForStaffEvaluation &&
    input.attribution.contradictions.length === 0 &&
    !input.attribution.needsHumanReview &&
    selectedInvoiceMatchesRow;
  const completePaymentEvidence =
    signals.completeSequence &&
    signals.paymentProofMessageId !== null &&
    signals.receiptAcknowledgementMessageId !== null;

  let status: FinancialSettlementAssessment['status'] = 'not_detected';
  let needsHumanReview = false;
  const ruleIds: string[] = [];

  if (!signals.paymentContextMessageId) {
    ruleIds.push('financial_settlement.no_payment_context');
  } else if (!selectedInvoiceMatchesRow && input.attribution.selectedInvoiceId) {
    status = 'pending';
    needsHumanReview = true;
    ruleIds.push('financial_settlement.selected_invoice_row_mismatch');
  } else if (amountMatch === 'different' && completePaymentEvidence && attributionStrong) {
    status = 'contradicted';
    needsHumanReview = true;
    ruleIds.push('financial_settlement.payment_amount_conflicts_with_selected_invoice');
  } else if (completePaymentEvidence && amountMatch === 'exact' && attributionStrong && identitySafe) {
    status = 'settled';
    ruleIds.push(
      'financial_settlement.exact_invoice_amount',
      'financial_settlement.customer_payment_proof_present',
      'financial_settlement.staff_receipt_acknowledged',
      'financial_settlement.strong_clean_invoice_attribution',
      'financial_settlement.selected_invoice_row_identity_confirmed'
    );
  } else {
    status = 'pending';
    if (!identitySafe) {
      needsHumanReview = true;
      ruleIds.push('financial_settlement.customer_identity_not_resolved');
    }
    if (!attributionStrong) ruleIds.push('financial_settlement.invoice_attribution_not_strong_clean');
    if (amountMatch === 'near_match') {
      needsHumanReview = true;
      ruleIds.push('financial_settlement.near_amount_requires_review');
    }
    // A real announced-vs-invoice mismatch is financially material even when the proof/receipt
    // sequence is still incomplete. Keep it pending (not contradicted until the full sequence
    // exists), but never let the discrepancy pass without human review.
    if (amountMatch === 'different' && selectedInvoiceMatchesRow) {
      needsHumanReview = true;
      ruleIds.push('financial_settlement.payment_amount_conflicts_with_selected_invoice');
    }
    if (amountMatch === 'not_available') ruleIds.push('financial_settlement.amount_not_reconciled');
    if (!signals.paymentProofMessageId) ruleIds.push('financial_settlement.customer_payment_proof_missing');
    if (!signals.receiptAcknowledgementMessageId) ruleIds.push('financial_settlement.staff_receipt_ack_missing');
  }

  const evidence: EvidenceRef[] = [];
  if (signals.paymentContextMessageId) evidence.push(ref(signals.paymentContextMessageId, 'الموظف أرسل سياق/بيانات التحويل.'));
  if (signals.totalQuestionMessageId) evidence.push(ref(signals.totalQuestionMessageId, 'العميل سأل عن إجمالي الحساب في سياق التسوية.'));
  if (signals.amountMessageId && announced != null) evidence.push(ref(signals.amountMessageId, `الموظف أعلن مبلغ التسوية: ${announced} جنيه.`));
  if (signals.paymentProofMessageId) evidence.push(ref(signals.paymentProofMessageId, `العميل أرسل إثبات دفع مرتبط بسياق التحويل (${signals.paymentProofKind}).`));
  if (signals.receiptAcknowledgementMessageId) evidence.push(ref(signals.receiptAcknowledgementMessageId, 'الصيدلية أقرت باستلام الدفع داخل نفس تسلسل التسوية.'));
  if (input.attribution.selectedInvoiceId) {
    evidence.push({
      sourceTable: 'sales_invoices',
      sourceId: input.attribution.selectedInvoiceId,
      description: invoiceAmount != null
        ? `الفاتورة المختارة ${input.attribution.selectedInvoiceNumber ?? ''} بقيمة ${invoiceAmount} جنيه، وتم التحقق من هوية صف الفاتورة المختار.`
        : `الفاتورة المختارة ${input.attribution.selectedInvoiceNumber ?? ''}.`,
    });
  }

  const level: ConfidenceAssessment['level'] = status === 'settled'
    ? 'strongly_inferred'
    : status === 'contradicted'
      ? 'unknown'
      : status === 'pending'
        ? 'weakly_inferred'
        : 'unknown';
  const score = status === 'settled' ? 0.95 : status === 'pending' ? 0.45 : 0;

  return {
    caseId: input.caseId,
    status,
    paymentMethod: signals.paymentContextMessageId ? 'transfer' : 'unknown',
    paymentContextDetected: Boolean(signals.paymentContextMessageId),
    totalQuestionDetected: Boolean(signals.totalQuestionMessageId),
    announcedPaymentAmount: announced,
    invoiceAmount,
    amountDifference: delta,
    amountMatch,
    paymentProofDetected: Boolean(signals.paymentProofMessageId),
    paymentProofKind: signals.paymentProofKind,
    receiptAcknowledged: Boolean(signals.receiptAcknowledgementMessageId),
    selectedInvoiceId: input.attribution.selectedInvoiceId,
    selectedInvoiceNumber: input.attribution.selectedInvoiceNumber,
    attributionLevel: input.attribution.attributionLevel,
    isOfficialInvoiceAttribution: input.attribution.isOfficialForStaffEvaluation && selectedInvoiceMatchesRow,
    primaryMessageIds: signals.primaryMessageIds,
    confidence: confidence(level, score, ruleIds, evidence),
    needsHumanReview,
    ruleIds,
  };
}
