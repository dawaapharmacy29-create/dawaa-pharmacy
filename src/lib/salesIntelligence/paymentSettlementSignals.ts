import type { NormalizedConversationMessageV32 } from '../whatsappConversationUnderstandingV32';

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
