from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def read(path):
    return (ROOT / path).read_text(encoding='utf-8')

def write(path, text):
    (ROOT / path).write_text(text, encoding='utf-8')

def replace_once(path, old, new):
    text = read(path)
    if old not in text:
        raise SystemExit(f'needle not found in {path}: {old[:120]!r}')
    if text.count(old) != 1:
        raise SystemExit(f'needle not unique in {path}: count={text.count(old)}')
    write(path, text.replace(old, new, 1))

# 1) Shared payment-settlement signal owner.
write('src/lib/salesIntelligence/paymentSettlementSignals.ts', r'''import type { NormalizedConversationMessageV32 } from '../whatsappConversationUnderstandingV32';

const PAYMENT_CONTEXT_RX = /(?:رقم\s*التحويل|تحويل\s*(?:بنكي|فودافون|انستا|insta)?|فودافون\s*كاش|انستا\s*باي|instapay)/i;
const TOTAL_QUESTION_RX = /(?:الحساب|الإجمالي|الاجمالي|المجموع).{0,18}(?:كام|قد\s*ايه|قد\s*إيه)|(?:كدا|كده)?\s*(?:هيبقا|هيبقى|يبقا|يبقى)\s*كام/i;
const COMPACT_AMOUNT_RX = /^\s*([0-9٠-٩۰-۹]+(?:[.,٫][0-9٠-٩۰-۹]+)?)\s*(?:جنيه|جنيها|ج(?:\.?م\.?)?)?\s*(?:ان\s*شاء\s*الله)?[.!، ]*$/i;
const PAYMENT_PROOF_RX = /(?:image omitted|photo omitted|document omitted|صورة\s*التحويل|سكرين\s*(?:التحويل)?|تم\s*التحويل|حولت|حوّلت|اتحول|تم\s*الدفع)/i;
const RECEIPT_ACK_RX = /^\s*(?:وصل(?:ت)?|تم\s*(?:الاستلام|استلام\s*التحويل|وصول\s*التحويل)|استلمنا)(?:\b|[ .،!])/i;
const PAYMENT_CONTINUATION_RX = /(?:الحساب|الإجمالي|الاجمالي|المجموع).{0,18}(?:كام|قد\s*ايه|قد\s*إيه)|(?:اسف|آسف|اسفه|آسفه).{0,12}نسيت\s*(?:خالص)?|نسيت\s*خالص|تم\s*التحويل|حولت|حوّلت|اتحول|صورة\s*التحويل/i;

function asciiDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace('٫', '.')
    .replace(',', '.');
}

function parseCompactAmount(text: string): number | null {
  const match = asciiDigits(text.trim()).match(COMPACT_AMOUNT_RX);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export interface PaymentSettlementSignals {
  paymentContextMessageId: string | null;
  totalQuestionMessageId: string | null;
  amountMessageId: string | null;
  announcedPaymentAmount: number | null;
  paymentProofMessageId: string | null;
  paymentProofKind: 'customer_media' | 'customer_text' | 'none';
  receiptAcknowledgementMessageId: string | null;
  completeSequence: boolean;
  primaryMessageIds: string[];
}

export function detectPaymentSettlementSignals(messages: NormalizedConversationMessageV32[]): PaymentSettlementSignals {
  const ordered = [...messages].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  let best: PaymentSettlementSignals = {
    paymentContextMessageId: null,
    totalQuestionMessageId: null,
    amountMessageId: null,
    announcedPaymentAmount: null,
    paymentProofMessageId: null,
    paymentProofKind: 'none',
    receiptAcknowledgementMessageId: null,
    completeSequence: false,
    primaryMessageIds: [],
  };

  for (let start = 0; start < ordered.length; start += 1) {
    const context = ordered[start];
    if (context.role !== 'staff' || !context.isMeaningful || !PAYMENT_CONTEXT_RX.test(context.text)) continue;

    const totalQuestionIndex = ordered.findIndex(
      (m, i) => i > start && m.role === 'customer' && m.isMeaningful && TOTAL_QUESTION_RX.test(m.text)
    );
    if (totalQuestionIndex < 0) {
      best = { ...best, paymentContextMessageId: context.id, primaryMessageIds: [context.id] };
      continue;
    }

    let amountIndex = -1;
    let amount: number | null = null;
    for (let i = totalQuestionIndex + 1; i < ordered.length; i += 1) {
      const message = ordered[i];
      if (message.role !== 'staff' || !message.isMeaningful) continue;
      const parsed = parseCompactAmount(message.text);
      if (parsed != null) {
        amountIndex = i;
        amount = parsed;
        break;
      }
    }
    if (amountIndex < 0) {
      best = {
        ...best,
        paymentContextMessageId: context.id,
        totalQuestionMessageId: ordered[totalQuestionIndex].id,
        primaryMessageIds: [context.id, ordered[totalQuestionIndex].id],
      };
      continue;
    }

    const proofIndex = ordered.findIndex(
      (m, i) => i > amountIndex && m.role === 'customer' && PAYMENT_PROOF_RX.test(m.text)
    );
    const receiptIndex = proofIndex < 0 ? -1 : ordered.findIndex(
      (m, i) => i > proofIndex && m.role === 'staff' && m.isMeaningful && RECEIPT_ACK_RX.test(m.text)
    );
    const proof = proofIndex >= 0 ? ordered[proofIndex] : null;
    const ids = [context.id, ordered[totalQuestionIndex].id, ordered[amountIndex].id, proof?.id, receiptIndex >= 0 ? ordered[receiptIndex].id : null]
      .filter((value): value is string => Boolean(value));

    const result: PaymentSettlementSignals = {
      paymentContextMessageId: context.id,
      totalQuestionMessageId: ordered[totalQuestionIndex].id,
      amountMessageId: ordered[amountIndex].id,
      announcedPaymentAmount: amount,
      paymentProofMessageId: proof?.id ?? null,
      paymentProofKind: proof ? (/image omitted|photo omitted|document omitted/i.test(proof.text) ? 'customer_media' : 'customer_text') : 'none',
      receiptAcknowledgementMessageId: receiptIndex >= 0 ? ordered[receiptIndex].id : null,
      completeSequence: Boolean(proof && receiptIndex >= 0),
      primaryMessageIds: ids,
    };
    if (result.completeSequence) return result;
    best = result;
  }

  return best;
}

export function isCustomerPaymentSettlementContinuation(
  messages: NormalizedConversationMessageV32[],
  messageId: string
): boolean {
  const ordered = [...messages].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const index = ordered.findIndex((m) => m.id === messageId);
  if (index < 0) return false;
  const message = ordered[index];
  if (message.role !== 'customer') return false;
  const priorPaymentContext = [...ordered.slice(0, index)].reverse().find(
    (m) => m.role === 'staff' && m.isMeaningful && PAYMENT_CONTEXT_RX.test(m.text) &&
      message.timestamp.getTime() - m.timestamp.getTime() <= 24 * 60 * 60 * 1000
  );
  if (!priorPaymentContext) return false;
  return PAYMENT_CONTINUATION_RX.test(message.text) || PAYMENT_PROOF_RX.test(message.text);
}
''')

# 2) Financial settlement engine: invoice-backed but never Sale Proof owner.
write('src/lib/salesIntelligence/financialSettlementEngine.ts', r'''import type { InvoiceLike } from '../invoices/invoiceCore';
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

  const identitySafe = input.customerIdentityStatus === undefined || input.customerIdentityStatus === 'resolved';
  const attributionStrong =
    Boolean(input.attribution.selectedInvoiceId) &&
    ['proven', 'strongly_inferred'].includes(input.attribution.attributionLevel) &&
    input.attribution.isOfficialForStaffEvaluation &&
    input.attribution.contradictions.length === 0;
  const completePaymentEvidence =
    signals.completeSequence &&
    signals.paymentProofMessageId !== null &&
    signals.receiptAcknowledgementMessageId !== null;

  let status: FinancialSettlementAssessment['status'] = 'not_detected';
  let needsHumanReview = false;
  const ruleIds: string[] = [];

  if (!signals.paymentContextMessageId) {
    ruleIds.push('financial_settlement.no_payment_context');
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
      'financial_settlement.strong_clean_invoice_attribution'
    );
  } else {
    status = 'pending';
    if (!identitySafe) {
      needsHumanReview = true;
      ruleIds.push('financial_settlement.customer_identity_not_resolved');
    }
    if (!attributionStrong) ruleIds.push('financial_settlement.invoice_attribution_not_strong_clean');
    if (amountMatch === 'near_match') ruleIds.push('financial_settlement.near_amount_requires_review');
    if (amountMatch === 'not_available') ruleIds.push('financial_settlement.amount_not_reconciled');
    if (!signals.paymentProofMessageId) ruleIds.push('financial_settlement.customer_payment_proof_missing');
    if (!signals.receiptAcknowledgementMessageId) ruleIds.push('financial_settlement.staff_receipt_ack_missing');
  }

  const evidence: EvidenceRef[] = [];
  if (signals.paymentContextMessageId) evidence.push(ref(signals.paymentContextMessageId, 'الموظف أرسل سياق/بيانات التحويل.'));
  if (signals.totalQuestionMessageId) evidence.push(ref(signals.totalQuestionMessageId, 'العميل سأل عن إجمالي الحساب في سياق التسوية.'));
  if (signals.amountMessageId && announced != null) evidence.push(ref(signals.amountMessageId, `الموظف أعلن مبلغ التسوية: ${announced} جنيه.`));
  if (signals.paymentProofMessageId) evidence.push(ref(signals.paymentProofMessageId, `العميل أرسل إثبات دفع (${signals.paymentProofKind}).`));
  if (signals.receiptAcknowledgementMessageId) evidence.push(ref(signals.receiptAcknowledgementMessageId, 'الصيدلية أقرت صراحة باستلام الدفع.'));
  if (input.attribution.selectedInvoiceId) {
    evidence.push({
      sourceTable: 'sales_invoices',
      sourceId: input.attribution.selectedInvoiceId,
      description: invoiceAmount != null
        ? `الفاتورة المختارة ${input.attribution.selectedInvoiceNumber ?? ''} بقيمة ${invoiceAmount} جنيه.`
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
    isOfficialInvoiceAttribution: input.attribution.isOfficialForStaffEvaluation,
    primaryMessageIds: signals.primaryMessageIds,
    confidence: confidence(level, score, ruleIds, evidence),
    needsHumanReview,
    ruleIds,
  };
}
''')

# 3) Types: additive / backwards-compatible.
types_path = 'src/lib/salesIntelligence/types.ts'
financial_types = r'''
// ---------------------------------------------------------------------------
// Financial Settlement — invoice-backed payment reconciliation, separate from Sale Proof.
// A settled payment may close the commercial journey while Sale Proof remains only strongly_supported.
// ---------------------------------------------------------------------------
export type FinancialSettlementStatus = 'settled' | 'pending' | 'contradicted' | 'not_detected';
export type FinancialAmountMatch = 'exact' | 'near_match' | 'different' | 'not_available';

export interface FinancialSettlementAssessment {
  caseId: string;
  status: FinancialSettlementStatus;
  paymentMethod: 'transfer' | 'unknown';
  paymentContextDetected: boolean;
  totalQuestionDetected: boolean;
  announcedPaymentAmount: number | null;
  invoiceAmount: number | null;
  amountDifference: number | null;
  amountMatch: FinancialAmountMatch;
  paymentProofDetected: boolean;
  paymentProofKind: 'customer_media' | 'customer_text' | 'none';
  receiptAcknowledged: boolean;
  selectedInvoiceId: string | null;
  selectedInvoiceNumber: string | null;
  attributionLevel: ConfidenceLevel;
  isOfficialInvoiceAttribution: boolean;
  primaryMessageIds: string[];
  confidence: ConfidenceAssessment;
  needsHumanReview: boolean;
  ruleIds: string[];
}
'''
needle = "  ruleIds: string[];\n}\n\n// ---------------------------------------------------------------------------\n// Phase D — Sale Attribution Engine"
replace_once(types_path, needle, "  ruleIds: string[];\n}\n" + financial_types + "\n// ---------------------------------------------------------------------------\n// Phase D — Sale Attribution Engine")
replace_once(types_path,
  "  historicalClosure: HistoricalCommercialClosureAssessment;\n  /** ids of the invoice rows",
  "  historicalClosure: HistoricalCommercialClosureAssessment;\n  /** Invoice-backed transfer/payment reconciliation. Separate from formal protocol and Sale Proof. */\n  financialSettlement?: FinancialSettlementAssessment;\n  /** ids of the invoice rows")
# Case Intelligence view's sale projection stays backwards compatible for existing fixture builders.
replace_once(types_path,
  "    reasonCodes: string[];\n    contradictions: string[];\n  };",
  "    reasonCodes: string[];\n    contradictions: string[];\n    financialSettlement?: FinancialSettlementAssessment | null;\n  };")

# 4) Conversation-case ambiguity: payment settlement messages are continuations, not new requests.
case_path = 'src/lib/salesIntelligence/conversationCaseEngine.ts'
replace_once(case_path,
  "} from '../whatsappSemanticSignalsV32';\nimport type { CaseStatus",
  "} from '../whatsappSemanticSignalsV32';\nimport { isCustomerPaymentSettlementContinuation } from './paymentSettlementSignals';\nimport type { CaseStatus")
replace_once(case_path,
  "  if (requestMessages.length < 2) return false;\n  for (let i = 1; i < requestMessages.length; i += 1) {\n    const prev = requestMessages[i - 1];\n    const curr = requestMessages[i];",
  "  const independentRequests = requestMessages.filter(\n    (message) => !isCustomerPaymentSettlementContinuation(messages, message.id)\n  );\n  if (independentRequests.length < 2) return false;\n  for (let i = 1; i < independentRequests.length; i += 1) {\n    const prev = independentRequests[i - 1];\n    const curr = independentRequests[i];")

# 5) Canonical outcome: financial settlement closes the order but never invents Sale Proof/revenue.
outcome_path = 'src/lib/salesIntelligence/canonicalSalesOutcomeEngine.ts'
replace_once(outcome_path,
  "  CommercialConfirmationState,\n} from './types';",
  "  CommercialConfirmationState,\n  FinancialSettlementAssessment,\n} from './types';")
replace_once(outcome_path,
  "  saleProof: SaleProofAssessment;\n  hasMeaningfulBasketItems: boolean;",
  "  saleProof: SaleProofAssessment;\n  financialSettlement?: FinancialSettlementAssessment;\n  hasMeaningfulBasketItems: boolean;")
replace_once(outcome_path,
  "    saleProof,\n    hasMeaningfulBasketItems,",
  "    saleProof,\n    financialSettlement,\n    hasMeaningfulBasketItems,")
insert_after_rejection = """  if (commercialConfirmation.currentState === 'rejected') {\n    return {\n      ...base,\n      outcome: 'customer_rejected',\n      isSaleCountable: false,\n      isRevenueCountable: false,\n      isOrderConfirmed: false,\n      reasonCodes: ['outcome.customer_rejected'],\n    };\n  }\n\n"""
financial_outcome = insert_after_rejection + """  if (financialSettlement?.status === 'settled') {\n    return {\n      ...base,\n      outcome: 'order_confirmed_unproven',\n      isSaleCountable: false,\n      isRevenueCountable: false,\n      isOrderConfirmed: true,\n      reasonCodes: ['outcome.financial_settlement_closed_sale_not_proven'],\n    };\n  }\n\n"""
replace_once(outcome_path, insert_after_rejection, financial_outcome)

# 6) Pipeline wiring.
pipeline_path = 'src/lib/salesIntelligence/salesIntelligencePipeline.ts'
replace_once(pipeline_path,
  "import { deriveHistoricalCommercialClosureAssessment } from './historicalCommercialClosureEngine';\nimport { deriveSaleProofState }",
  "import { deriveHistoricalCommercialClosureAssessment } from './historicalCommercialClosureEngine';\nimport { deriveFinancialSettlementAssessment } from './financialSettlementEngine';\nimport { deriveSaleProofState }")
# derive financial settlement after invoice match.
needle = """  const basketInvoiceMatch = deriveBasketInvoiceMatch({\n    caseId: conversationCase.caseId,\n    baskets,\n    itemsByBasketId,\n    attribution: rawAttribution,\n    invoiceRow,\n    itemEvidenceProvider,\n    documentedAdjustments: input.documentedAdjustments,\n    invoiceCancelledOrReturned: input.invoiceCancelledOrReturned,\n  });\n\n  const integrityAssessment = deriveSalesIntegrityAssessment({"""
replacement = """  const basketInvoiceMatch = deriveBasketInvoiceMatch({\n    caseId: conversationCase.caseId,\n    baskets,\n    itemsByBasketId,\n    attribution: rawAttribution,\n    invoiceRow,\n    itemEvidenceProvider,\n    documentedAdjustments: input.documentedAdjustments,\n    invoiceCancelledOrReturned: input.invoiceCancelledOrReturned,\n  });\n\n  const financialSettlement = deriveFinancialSettlementAssessment({\n    caseId: conversationCase.caseId,\n    messages: scopedMessages,\n    attribution: rawAttribution,\n    selectedInvoiceRow: invoiceRow,\n    customerIdentityStatus: input.customerIdentityStatus,\n  });\n\n  const integrityAssessment = deriveSalesIntegrityAssessment({"""
replace_once(pipeline_path, needle, replacement)
# evidence completeness: exact financial reconciliation can resolve segmentation doubt and supplies a real announced amount.
replace_once(pipeline_path,
  "    caseSegmentationConfident: !conversationCase.needsHumanReview,",
  "    caseSegmentationConfident: !conversationCase.needsHumanReview || financialSettlement.status === 'settled',")
replace_once(pipeline_path,
  "    announcedTotalAvailable: activeBasket?.announcedTotal != null,",
  "    announcedTotalAvailable: activeBasket?.announcedTotal != null || financialSettlement.announcedPaymentAmount != null,")
# failure reasons: resolved payment continuation is not a segmentation failure; settled payment is stronger than bare customer text confirmation.
replace_once(pipeline_path,
  "  if (conversationCase.needsHumanReview) failureReasons.push('case_segmentation_uncertain');",
  "  if (conversationCase.needsHumanReview && financialSettlement.status !== 'settled') failureReasons.push('case_segmentation_uncertain');")
replace_once(pipeline_path,
  "  if (evidenceCompleteness.basketDetected && !commercialConfirmation.announcedTotalPresent) failureReasons.push('announced_total_missing');",
  "  if (evidenceCompleteness.basketDetected && !commercialConfirmation.announcedTotalPresent && financialSettlement.announcedPaymentAmount == null) failureReasons.push('announced_total_missing');")
replace_once(pipeline_path,
  "    !commercialConfirmation.customerConfirmed &&\n    commercialConfirmation.currentState !== 'unknown' &&",
  "    !commercialConfirmation.customerConfirmed &&\n    financialSettlement.status !== 'settled' &&\n    commercialConfirmation.currentState !== 'unknown' &&")
# filter false segmentation review once exact financial settlement resolves the apparent second request.
needle = """  const reviewReasonsResolvedByProvenInvoice = new Set(['no_basket_state_for_case']);\n  const humanReviewReasons = saleProof.state === 'proven'\n    ? rawHumanReviewReasons.filter((reason) => !reviewReasonsResolvedByProvenInvoice.has(reason))\n    : [...rawHumanReviewReasons];"""
replacement = """  const reviewReasonsResolvedByProvenInvoice = new Set(['no_basket_state_for_case']);\n  const reviewReasonsResolvedByFinancialSettlement = new Set(['possible_unsegmented_multiple_requests']);\n  let humanReviewReasons = saleProof.state === 'proven'\n    ? rawHumanReviewReasons.filter((reason) => !reviewReasonsResolvedByProvenInvoice.has(reason))\n    : [...rawHumanReviewReasons];\n  if (financialSettlement.status === 'settled') {\n    humanReviewReasons = humanReviewReasons.filter(\n      (reason) => !reviewReasonsResolvedByFinancialSettlement.has(reason)\n    );\n  }"""
replace_once(pipeline_path, needle, replacement)
# outcome input.
replace_once(pipeline_path,
  "    saleProof,\n    hasMeaningfulBasketItems,",
  "    saleProof,\n    financialSettlement,\n    hasMeaningfulBasketItems,")
# analysis object.
replace_once(pipeline_path,
  "    protocolAssessment,\n    historicalClosure,\n    invoiceCandidateIds:",
  "    protocolAssessment,\n    historicalClosure,\n    financialSettlement,\n    invoiceCandidateIds:")

# 7) Read model + persisted evidence make the financial details visible/auditable.
view_path = 'src/lib/salesIntelligence/caseIntelligenceView.ts'
replace_once(view_path,
  "      contradictions: attribution.contradictions,\n    },",
  "      contradictions: attribution.contradictions,\n      financialSettlement: analysis.financialSettlement ?? null,\n    },")
replace_once(view_path,
  "    ...analysis.followUp.opportunities.flatMap((o) => o.evidenceMessageIds),\n  ]);",
  "    ...analysis.followUp.opportunities.flatMap((o) => o.evidenceMessageIds),\n    ...(analysis.financialSettlement?.primaryMessageIds ?? []),\n  ]);")
mapper_path = 'src/lib/salesIntelligence/persistence/mappers.ts'
replace_once(mapper_path,
  "      canonicalSalesOutcome: analysis.salesOutcome,\n    },",
  "      canonicalSalesOutcome: analysis.salesOutcome,\n      financialSettlement: analysis.financialSettlement ?? null,\n    },")

# 8) Journey label stays type-compatible but no longer says the invoice is missing when it was financially settled.
journey_path = 'src/lib/salesIntelligence/commercialJourneyStateMachine.ts'
replace_once(journey_path,
  "      awaiting_invoice: ['journey.order_confirmed_sale_not_yet_proven', 'strongly_inferred', 0.9],",
  "      awaiting_invoice: [\n        input.salesOutcome.reasonCodes.includes('outcome.financial_settlement_closed_sale_not_proven')\n          ? 'journey.financial_settlement_closed_canonical_sale_proof_pending'\n          : 'journey.order_confirmed_sale_not_yet_proven',\n        'strongly_inferred',\n        0.9,\n      ],")

# 9) Version bump forces immutable re-analysis and identifies segmentation semantic change.
versions_path = 'src/lib/salesIntelligence/persistence/versions.ts'
replace_once(versions_path,
  "// Preview sync marker: V14 canonical journey bridge and generated serverless transport verified together; retry after Vercel build-rate window.\n",
  "// v15 (2026-10-04): invoice-backed financial settlement closes transfer-paid orders without\n// fabricating formal protocol compliance or Sale Proof; payment-continuation request ambiguity is suppressed only under explicit transfer context.\n")
replace_once(versions_path, "export const PIPELINE_VERSION = 'sales-intelligence-v14';", "export const PIPELINE_VERSION = 'sales-intelligence-v15';")
replace_once(versions_path,
  "caseSegmentation: 'case-segmentation-v9-payment-settlement-continuation',",
  "caseSegmentation: 'case-segmentation-v10-payment-continuation-ambiguity-safe',")

# 10) Focused regression tests inside the configured lightweight runner.
write('src/lib/__tests__/salesIntelligenceFinancialSettlement.test.ts', r'''import { describe, expect, it } from 'vitest';
import { deriveFinancialSettlementAssessment } from '@/lib/salesIntelligence/financialSettlementEngine';
import { deriveCanonicalSalesOutcome } from '@/lib/salesIntelligence/canonicalSalesOutcomeEngine';
import { parseWhatsAppExport } from '@/lib/whatsappConversationParser';
import { buildConversationUnderstandingV32 } from '@/lib/whatsappConversationUnderstandingV32';
import { deriveConversationCases } from '@/lib/salesIntelligence/conversationCaseEngine';

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
    const messages = parseWhatsAppExport(RAW);
    const understanding = buildConversationUnderstandingV32(messages as any);
    const cases = deriveConversationCases({
      understanding,
      conversationId: 'ibrahim',
      customerIdHint: 'a2fd0b6e-1562-438c-8f16-76a43539f792',
      customerPhoneHint: '01016891940',
    });
    expect(cases).toHaveLength(1);
    expect(cases[0].humanReviewReasons).not.toContain('possible_unsegmented_multiple_requests');
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
''')

runner_path = 'scripts/run-tests.cjs'
replace_once(runner_path,
  "  'src/lib/__tests__/whatsappGoldenCaseIbrahimAlSayyad.test.ts',\n",
  "  'src/lib/__tests__/whatsappGoldenCaseIbrahimAlSayyad.test.ts',\n  'src/lib/__tests__/salesIntelligenceFinancialSettlement.test.ts',\n")

print('financial settlement V15 patch applied')
