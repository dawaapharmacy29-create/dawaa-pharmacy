// Sales Intelligence Phase B.1 — Conversation Case Engine.
//
// Pure functions only — no Supabase calls, no mutation. Segmentation reuses V32's own
// ConversationInteractionV32 boundaries (time-gap + topic-shift-marker) rather than inventing a
// second segmentation pass; this module's job is to CLASSIFY each interaction into a commercial
// case (type/status/confidence), not to re-decide where one interaction ends and the next begins.
import type {
  ConversationInteractionV32,
  ConversationUnderstandingV32,
  NormalizedConversationMessageV32,
} from '../whatsappConversationUnderstandingV32';
import {
  extractAcceptanceSignals,
  extractConfirmationSignals,
  extractPriceSignals,
  extractProductReferenceSignals,
  extractQuantitySignals,
  extractRejectionSignals,
  extractRequestSignals,
  isSubstantiveConfirmationSignal,
} from '../whatsappSemanticSignalsV32';
import type { CaseStatus, CaseType, ConfidenceAssessment, ConfidenceLevel, ConversationCase, EvidenceRef } from './types';

export interface DeriveConversationCasesInput {
  understanding: ConversationUnderstandingV32;
  /** whatsapp_review_sources.id (or the root_source_id of the merged case) this conversation reads. */
  conversationId: string;
  sourceCaseIdV22?: string | null;
  customerIdHint?: string | null;
  customerPhoneHint?: string | null;
  branchIdHint?: string | null;
  branchNameRawHint?: string | null;
  createdFrom?: ConversationCase['createdFrom'];
}

function messagesForInteraction(
  understanding: ConversationUnderstandingV32,
  interaction: ConversationInteractionV32
): NormalizedConversationMessageV32[] {
  const ids = new Set(interaction.messageIds);
  return understanding.messages.filter((m) => ids.has(m.id));
}

function evidenceRef(messages: NormalizedConversationMessageV32[], description: string): EvidenceRef {
  return {
    sourceTable: 'whatsapp_review_sources',
    sourceId: '',
    messageIds: messages.map((m) => m.id),
    description,
  };
}

/**
 * Two or more distinct customer requests with no staff reply in between, inside the SAME V32
 * interaction, are a real segmentation-ambiguity signal: V32 didn't find a time-gap or a topic
 * marker to split them, but nothing confirms they are the same commercial need either. Flag for
 * human review rather than silently merging or silently splitting — per instruction #14/#15.
 */
function hasUnresolvedMultipleRequests(
  messages: NormalizedConversationMessageV32[],
  requestMessages: NormalizedConversationMessageV32[]
): boolean {
  if (requestMessages.length < 2) return false;
  for (let i = 1; i < requestMessages.length; i += 1) {
    const prev = requestMessages[i - 1];
    const curr = requestMessages[i];
    const staffReplyBetween = messages.some(
      (m) =>
        m.role === 'staff' &&
        m.isMeaningful &&
        m.timestamp.getTime() > prev.timestamp.getTime() &&
        m.timestamp.getTime() < curr.timestamp.getTime()
    );
    if (!staffReplyBetween) return true;
  }
  return false;
}

function deriveCaseForInteraction(
  understanding: ConversationUnderstandingV32,
  interaction: ConversationInteractionV32,
  input: DeriveConversationCasesInput
): ConversationCase {
  const messages = messagesForInteraction(understanding, interaction);
  const requestSignals = extractRequestSignals(messages);
  const requestMessages = requestSignals
    .map((s) => messages.find((m) => m.id === s.messageId))
    .filter((m): m is NormalizedConversationMessageV32 => Boolean(m));
  const confirmationSignals = extractConfirmationSignals(messages).filter(isSubstantiveConfirmationSignal);
  const quantitySignals = extractQuantitySignals(messages);
  const priceSignals = extractPriceSignals(messages);
  const productReferenceSignals = extractProductReferenceSignals(messages).filter((s) => s.extractedValue !== 'unknown');
  const acceptanceSignals = extractAcceptanceSignals(messages);
  const rejectionSignals = extractRejectionSignals(messages);

  const hasRequest = requestSignals.length > 0;
  const hasCommercialSignal =
    quantitySignals.length > 0 || priceSignals.length > 0 || productReferenceSignals.length > 0 || confirmationSignals.length > 0;

  let caseType: CaseType;
  let status: CaseStatus;
  let score: number;
  const ruleIds: string[] = [];

  if (!hasRequest) {
    caseType = 'information_only';
    status = 'information_only';
    score = 0.9;
    ruleIds.push('case.classification.no_request_signal');
  } else if (!hasCommercialSignal) {
    caseType = 'sales_opportunity';
    status = 'sales_opportunity';
    score = 0.65;
    ruleIds.push('case.classification.request_without_commercial_signal');
  } else {
    caseType = 'sales_opportunity';
    // Refined further (basket_building -> customer_confirmed -> ...) once a CaseBasket is
    // attached — see deriveCaseStatusFromBasket() in caseBasketEngine.ts.
    status = 'basket_building';
    score = 0.8;
    ruleIds.push('case.classification.request_with_commercial_signal');
  }

  let needsHumanReview = false;
  const humanReviewReasons: string[] = [];
  let level: ConfidenceLevel = hasRequest ? (hasCommercialSignal ? 'strongly_inferred' : 'weakly_inferred') : 'proven';

  // Classification certainty can be 100% only when the conversation itself contains a complete,
  // explicit commercial journey: a real request + product/commercial evidence + explicit customer
  // acceptance + substantive confirmation/fulfillment intent, with no rejection conflict. This
  // proves the CASE TYPE (sales opportunity), not the SALE itself and never upgrades SaleProof.
  const explicitCommercialJourney =
    hasRequest &&
    hasCommercialSignal &&
    acceptanceSignals.length > 0 &&
    confirmationSignals.length > 0 &&
    rejectionSignals.length === 0;

  if (explicitCommercialJourney) {
    level = 'proven';
    score = 1;
    ruleIds.push('case.classification.explicit_commercial_journey');
  }

  if (hasUnresolvedMultipleRequests(messages, requestMessages)) {
    needsHumanReview = true;
    humanReviewReasons.push('possible_unsegmented_multiple_requests');
    level = 'weakly_inferred';
    score = Math.min(score, 0.4);
    ruleIds.push('case.ambiguity.unresolved_multiple_requests_no_staff_reply_between');
  }

  // A rejection with no matching acceptance/confirmation nearby, alongside otherwise-commercial
  // content, is worth a human look rather than a guessed 'lost' classification this early.
  if (rejectionSignals.length > 0 && acceptanceSignals.length > 0 && confirmationSignals.length === 0) {
    needsHumanReview = true;
    humanReviewReasons.push('conflicting_acceptance_and_rejection_no_confirmation');
    level = 'weakly_inferred';
    score = Math.min(score, 0.45);
    ruleIds.push('case.ambiguity.conflicting_accept_reject_signals');
  }

  const evidence: EvidenceRef[] = [
    evidenceRef(
      requestMessages,
      hasRequest
        ? `${requestMessages.length} رسالة طلب/استفسار حقيقية من العميل في هذا التفاعل.`
        : 'لا توجد رسالة طلب حقيقية من العميل في هذا التفاعل (تحية/شكر/إقرار فقط).'
    ),
  ];
  if (hasCommercialSignal) {
    evidence.push(
      evidenceRef(
        messages,
        `إشارات تجارية: كمية=${quantitySignals.length}, سعر=${priceSignals.length}, مرجع منتج=${productReferenceSignals.length}, تأكيد=${confirmationSignals.length}.`
      )
    );
  }

  return {
    caseId: `${input.conversationId}:${interaction.id}`,
    conversationId: input.conversationId,
    sourceCaseIdV22: input.sourceCaseIdV22 ?? null,
    customerId: input.customerIdHint ?? null,
    customerPhone: input.customerPhoneHint ?? null,
    branchId: input.branchIdHint ?? null,
    branchNameRaw: input.branchNameRawHint ?? null,
    startedAt: interaction.startedAt.toISOString(),
    endedAt: interaction.endedAt.toISOString(),
    primaryIntent: caseType,
    caseType,
    status,
    confidence: { level, score, ruleIds, evidence } satisfies ConfidenceAssessment,
    createdFrom: input.createdFrom ?? 'v32_shadow',
    needsHumanReview,
    humanReviewReasons,
  };
}

/**
 * A single WhatsApp conversation can contain more than one independent commercial case — this
 * derives one ConversationCase per V32 interaction (never merges/splits interactions itself).
 */
export function deriveConversationCases(input: DeriveConversationCasesInput): ConversationCase[] {
  return input.understanding.interactions.map((interaction) => deriveCaseForInteraction(input.understanding, interaction, input));
}
