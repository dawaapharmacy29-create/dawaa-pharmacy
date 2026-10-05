import type { NormalizedConversationMessageV32 } from '../whatsappConversationUnderstandingV32';

const PAYMENT_CONTEXT_RX = /(?:رقم\s*التحويل|تحويل\s*(?:بنكي|فودافون|انستا|insta)?|فودافون\s*كاش|انستا\s*باي|instapay)/i;
const PAYMENT_PROOF_REQUEST_RX = /(?:صورة|سكرين|إثبات|اثبات)\s*(?:التحويل|الدفع)|(?:ابعت|ابعتي|ابعتلي|ابعتيلي|ارسل|ارسلي|استأذن|استاذن).{0,24}(?:صورة|سكرين).{0,20}(?:التحويل|الدفع)/i;
const TOTAL_QUESTION_RX = /(?:الحساب|الإجمالي|الاجمالي|المجموع).{0,18}(?:كام|قد\s*ايه|قد\s*إيه)|(?:كدا|كده)?\s*(?:هيبقا|هيبقى|يبقا|يبقى)\s*كام/i;
const COMPACT_AMOUNT_RX = /^\s*([0-9٠-٩۰-۹]+(?:[.,٫][0-9٠-٩۰-۹]+)?)\s*(?:جنيه|جنيها|ج(?:\.?م\.?)?)?\s*(?:ان\s*شاء\s*الله)?[.!، ]*$/i;
const PAYMENT_TEXT_PROOF_RX = /(?:صورة\s*التحويل|سكرين\s*(?:التحويل|الدفع)?|تم\s*التحويل|حولت|حوّلت|اتحول|تم\s*الدفع|دفعت)/i;
const PAYMENT_MEDIA_RX = /(?:image omitted|photo omitted|document omitted)/i;
const EXPLICIT_RECEIPT_ACK_RX = /^\s*(?:وصل(?:ت)?\s*(?:التحويل|الدفع|المبلغ)|تم\s*(?:الاستلام|استلام\s*(?:التحويل|الدفع|المبلغ)|وصول\s*(?:التحويل|الدفع|المبلغ))|استلمنا(?:\s*(?:التحويل|الدفع|المبلغ))?)(?:\b|[ .،!])/i;
const BARE_RECEIPT_ACK_RX = /^\s*وصل(?:ت)?(?:\b|[ .،!])/i;
const PAYMENT_CONTINUATION_RX = /(?:الحساب|الإجمالي|الاجمالي|المجموع).{0,18}(?:كام|قد\s*ايه|قد\s*إيه)|(?:اسف|آسف|اسفه|آسفه).{0,12}نسيت\s*(?:خالص)?|نسيت\s*خالص|تم\s*التحويل|حولت|حوّلت|اتحول|صورة\s*التحويل|سكرين\s*(?:التحويل|الدفع)?|تم\s*الدفع|دفعت/i;

const CONTEXT_TO_TOTAL_MAX_MS = 2 * 60 * 60 * 1000;
const TOTAL_TO_AMOUNT_MAX_MS = 45 * 60 * 1000;
const AMOUNT_TO_PROOF_MAX_MS = 45 * 60 * 1000;
const PROOF_TO_RECEIPT_MAX_MS = 20 * 60 * 1000;
const PAYMENT_CONTINUATION_MAX_MS = 24 * 60 * 60 * 1000;

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

function withinGap(
  earlier: NormalizedConversationMessageV32,
  later: NormalizedConversationMessageV32,
  maxMs: number
): boolean {
  const delta = later.timestamp.getTime() - earlier.timestamp.getTime();
  return delta >= 0 && delta <= maxMs;
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
    const proofWasRequested = PAYMENT_PROOF_REQUEST_RX.test(context.text);

    const totalQuestionIndex = ordered.findIndex(
      (m, i) =>
        i > start &&
        m.role === 'customer' &&
        m.isMeaningful &&
        TOTAL_QUESTION_RX.test(m.text) &&
        withinGap(context, m, CONTEXT_TO_TOTAL_MAX_MS)
    );
    if (totalQuestionIndex < 0) {
      best = { ...best, paymentContextMessageId: context.id, primaryMessageIds: [context.id] };
      continue;
    }

    const totalQuestion = ordered[totalQuestionIndex];
    let amountIndex = -1;
    let amount: number | null = null;
    for (let i = totalQuestionIndex + 1; i < ordered.length; i += 1) {
      const message = ordered[i];
      if (!withinGap(totalQuestion, message, TOTAL_TO_AMOUNT_MAX_MS)) break;
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
        totalQuestionMessageId: totalQuestion.id,
        primaryMessageIds: [context.id, totalQuestion.id],
      };
      continue;
    }

    const amountMessage = ordered[amountIndex];
    let proofIndex = -1;
    let proofKind: PaymentSettlementSignals['paymentProofKind'] = 'none';
    for (let i = amountIndex + 1; i < ordered.length; i += 1) {
      const message = ordered[i];
      if (!withinGap(amountMessage, message, AMOUNT_TO_PROOF_MAX_MS)) break;
      if (message.role !== 'customer') continue;
      if (PAYMENT_TEXT_PROOF_RX.test(message.text)) {
        proofIndex = i;
        proofKind = PAYMENT_MEDIA_RX.test(message.text) ? 'customer_media' : 'customer_text';
        break;
      }
      if (proofWasRequested && PAYMENT_MEDIA_RX.test(message.text)) {
        proofIndex = i;
        proofKind = 'customer_media';
        break;
      }
    }

    const proof = proofIndex >= 0 ? ordered[proofIndex] : null;
    let receiptIndex = -1;
    if (proof) {
      for (let i = proofIndex + 1; i < ordered.length; i += 1) {
        const message = ordered[i];
        if (!withinGap(proof, message, PROOF_TO_RECEIPT_MAX_MS)) break;
        if (message.role !== 'staff' || !message.isMeaningful) continue;
        const explicitAck = EXPLICIT_RECEIPT_ACK_RX.test(message.text);
        const contextBoundBareAck = BARE_RECEIPT_ACK_RX.test(message.text) && (proofKind === 'customer_text' || proofWasRequested);
        if (explicitAck || contextBoundBareAck) {
          receiptIndex = i;
          break;
        }
      }
    }

    const ids = [context.id, totalQuestion.id, amountMessage.id, proof?.id, receiptIndex >= 0 ? ordered[receiptIndex].id : null]
      .filter((value): value is string => Boolean(value));

    const result: PaymentSettlementSignals = {
      paymentContextMessageId: context.id,
      totalQuestionMessageId: totalQuestion.id,
      amountMessageId: amountMessage.id,
      announcedPaymentAmount: amount,
      paymentProofMessageId: proof?.id ?? null,
      paymentProofKind: proofKind,
      receiptAcknowledgementMessageId: receiptIndex >= 0 ? ordered[receiptIndex].id : null,
      completeSequence: Boolean(proof && receiptIndex >= 0),
      primaryMessageIds: ids,
    };
    if (result.completeSequence) return result;
    if (result.primaryMessageIds.length >= best.primaryMessageIds.length) best = result;
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
    (m) =>
      m.role === 'staff' &&
      m.isMeaningful &&
      PAYMENT_CONTEXT_RX.test(m.text) &&
      withinGap(m, message, PAYMENT_CONTINUATION_MAX_MS)
  );
  if (!priorPaymentContext) return false;
  if (PAYMENT_CONTINUATION_RX.test(message.text)) return true;
  return PAYMENT_MEDIA_RX.test(message.text) && PAYMENT_PROOF_REQUEST_RX.test(priorPaymentContext.text);
}
