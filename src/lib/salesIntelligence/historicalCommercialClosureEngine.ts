// Sales Intelligence Phase G.1 — Historical Commercial Closure Engine.
//
// Conversation-level ONLY. Deliberately SEPARATE from CommercialConfirmationAssessment (Phase C's
// own strict, formal-marker-driven state machine — left completely UNCHANGED by this module) and
// from OrderConfirmationProtocolAssessment (the NEW Dawaa policy). This engine recognizes ORGANIC,
// real Dawaa closing language that never produces a formal FinalBasketSummaryEvent/
// StaffFinalConfirmationEvent, WITHOUT loosening either of those strict Phase C markers.
//
// NOT invoice proof. NOT sale proof. NOT protocol compliance. NOT a sold outcome. Phase D's own
// invoice evidence remains required for sale attribution — this assessment is never consumed by
// saleAttributionEngine.ts (see the Phase G.1 report's own "attribution safety" section).
//
// Every marker below is backed by a REAL example manually found in the Phase G real-data shadow
// sample (read-only, Supabase project jkjqeqkshllustwlzzbf) — see the Phase G.1 report for the
// exact conversation ids and quoted lines. This module deliberately does NOT attempt incremental
// multi-message quantity reconstruction: a real example in that same sample showed a customer
// stating "شريطين" (two strips) and then correcting it to "شريط وشريط" (one and one) across
// several turns — genuine correction risk that makes new quantity-parsing regex unsafe here. This
// engine only reads the CaseBasket state buildCaseBaskets() ALREADY produced; it never re-parses
// quantities or product identity itself.
import {
  extractAcceptanceSignals,
  extractProductReferenceSignals,
  extractRequestSignals,
  isSubstantiveConfirmationSignal,
} from '../whatsappSemanticSignalsV32';
import type { NormalizedConversationMessageV32 } from '../whatsappConversationUnderstandingV32';
import type {
  CaseBasketItem,
  CommercialConfirmationAssessment,
  ConfidenceAssessment,
  EvidenceRef,
  HistoricalClosureLevel,
  HistoricalCommercialClosureAssessment,
} from './types';

// Real example (conversation a312def1...): a bare "ابعته" as the customer's OWN, standalone
// message — not prefixed by تمام/اه/ايوه, which V32's own ACCEPTANCE_RX requires before "ابعته".
const HISTORICAL_BARE_SEND_ACCEPTANCE_RX = /^ابعت(?:ه|ها|هم|يه|يهم)?[!.، ]*$/i;

// Real examples: "تم الارسال"/"تم الإرسال" (completed-tense fulfillment — common in real staff
// phrasing) is NOT covered by caseBasketEngine's own STAFF_FINAL_CONFIRMATION_RX, which only
// covers the in-progress "جاري الإرسال" tense. "من عنيا"/"عنيا حاضر"/bare "عنيا" is a real
// Egyptian-Arabic commitment idiom ("consider it done/on me") used as a genuine fulfillment-intent
// marker. "جاري الإرسال/التجهيز" and "تم تأكيد الطلب/تسجيل" are reused here (not modified in
// caseBasketEngine.ts) since, for HISTORICAL purposes, we want to recognize them wherever they
// appear — not only inside Phase C's own state-machine gate (which requires a prior formal
// customer confirmation before that formal event can fire at all).
const HISTORICAL_STAFF_FULFILLMENT_RX =
  /جاري\s*(?:التجهيز|الإرسال|الارسال)|تم\s*(?:تأكيد\s*الطلب|تسجيل(?:\s*طلبك)?|الإرسال|الارسال)|من\s*عني[اى]|عني[اى]\s*حاضر|^عني[اى][!.، ]*$/i;

function assessment(level: ConfidenceAssessment['level'], score: number, ruleIds: string[], evidence: EvidenceRef[]): ConfidenceAssessment {
  return { level, score, ruleIds, evidence };
}

function refFor(message: NormalizedConversationMessageV32, description: string): EvidenceRef {
  return { sourceTable: 'whatsapp_review_sources', sourceId: '', messageIds: [message.id], description };
}

/**
 * `scopedMessages` must be the SAME per-case message scope the rest of the pipeline already uses
 * (one V32 interaction's messages) — this engine never re-segments a conversation.
 * `activeItems` is the ALREADY-BUILT CaseBasket's own item list (buildCaseBaskets, unmodified).
 */
export function deriveHistoricalCommercialClosureAssessment(
  caseId: string,
  scopedMessages: NormalizedConversationMessageV32[],
  commercial: CommercialConfirmationAssessment,
  activeItems: CaseBasketItem[],
  announcedValueAvailable: boolean
): HistoricalCommercialClosureAssessment {
  const customerMessages = scopedMessages.filter((m) => m.role === 'customer' && m.isMeaningful);
  const staffMessages = scopedMessages.filter((m) => m.role === 'staff' && m.isMeaningful);

  const requestSignals = extractRequestSignals(scopedMessages);
  const productRefSignals = extractProductReferenceSignals(scopedMessages);
  const purchaseIntentDetected = requestSignals.length > 0 || productRefSignals.length > 0 || activeItems.length > 0;

  const acceptanceSignalMessages = extractAcceptanceSignals(scopedMessages)
    .filter(isSubstantiveConfirmationSignal)
    .map((s) => scopedMessages.find((m) => m.id === s.messageId))
    .filter((m): m is NormalizedConversationMessageV32 => Boolean(m));
  const bareSendMessages = customerMessages.filter((m) => HISTORICAL_BARE_SEND_ACCEPTANCE_RX.test(m.text));
  const customerAcceptanceMessages = Array.from(new Set([...acceptanceSignalMessages, ...bareSendMessages]));
  const customerAcceptanceDetected = customerAcceptanceMessages.length > 0;

  const fulfillmentMessages = staffMessages.filter((m) => HISTORICAL_STAFF_FULFILLMENT_RX.test(m.text));
  const staffFulfillmentIntentDetected = fulfillmentMessages.length > 0;

  const basketReconstructable = activeItems.some(
    (item) => item.resolutionStatus === 'proven' || item.resolutionStatus === 'partially_proven'
  );

  // "تمام with several unresolved products must remain ambiguous. No guessing." — never
  // auto-promote to strongly_inferred when more than one distinct basket item is in play at once.
  const multipleUnresolvedProducts = activeItems.length > 1;

  let closureLevel: HistoricalClosureLevel;
  let needsHumanReview = false;
  const ruleIds: string[] = [];

  if (commercial.currentState === 'commercial_confirmation_complete') {
    closureLevel = 'explicit';
    ruleIds.push('historical_closure.explicit_via_formal_protocol');
  } else if (!purchaseIntentDetected) {
    closureLevel = 'unknown';
    ruleIds.push('historical_closure.no_purchase_intent');
  } else if (customerAcceptanceDetected && staffFulfillmentIntentDetected) {
    if (multipleUnresolvedProducts) {
      closureLevel = 'weakly_inferred';
      needsHumanReview = true;
      ruleIds.push('historical_closure.ambiguous_multiple_unresolved_products');
    } else {
      closureLevel = 'strongly_inferred';
      ruleIds.push('historical_closure.customer_acceptance_and_staff_fulfillment_intent');
    }
  } else if (customerAcceptanceDetected || staffFulfillmentIntentDetected) {
    closureLevel = 'weakly_inferred';
    ruleIds.push('historical_closure.partial_signal_only');
  } else {
    closureLevel = 'not_closed';
    ruleIds.push('historical_closure.purchase_intent_without_closure');
  }

  const confidenceByLevel: Record<HistoricalClosureLevel, { level: ConfidenceAssessment['level']; score: number }> = {
    explicit: { level: 'proven', score: 0.95 },
    strongly_inferred: { level: 'strongly_inferred', score: 0.7 },
    weakly_inferred: { level: 'weakly_inferred', score: 0.4 },
    not_closed: { level: 'strongly_inferred', score: 0.75 },
    unknown: { level: 'unknown', score: 0.2 },
  };

  const evidenceMessages = [...customerAcceptanceMessages, ...fulfillmentMessages];
  const evidence: EvidenceRef[] = evidenceMessages.map((m) =>
    refFor(m, `${m.role === 'customer' ? 'إشارة قبول تاريخية من العميل' : 'إشارة نية تنفيذ تاريخية من الموظف'}: "${m.text.slice(0, 120)}".`)
  );

  const { level, score } = confidenceByLevel[closureLevel];

  return {
    caseId,
    purchaseIntentDetected,
    customerAcceptanceDetected,
    staffFulfillmentIntentDetected,
    basketReconstructable,
    announcedValueAvailable,
    closureLevel,
    primaryMessageIds: Array.from(new Set(evidenceMessages.map((m) => m.id))),
    confidence: assessment(level, score, ruleIds, evidence),
    needsHumanReview,
    ruleIds,
  };
}
