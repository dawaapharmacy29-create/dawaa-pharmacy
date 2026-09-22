// Sales Intelligence Phase C — Commercial Confirmation State.
//
// Pure derivation layer only — takes the ALREADY-COMPUTED output of buildCaseBaskets()
// (caseBasketEngine.ts) and combines it into one canonical "is this case's current basket
// commercially settled inside the conversation" answer. Deliberately does NOT re-scan messages:
// every fact used here (basket status/confirmedAt/confirmedByCustomerAt/announcedTotal, and the
// three Phase C event arrays) was already derived once, during the SAME walk, by
// buildCaseBaskets() — re-deriving it here would create a second, competing source of truth.
//
// `commercial_confirmation_complete` is never "sold" — see CommercialConfirmationState in
// types.ts. A sale is only ever confirmed later by order/invoice evidence (a future phase).
import type {
  CaseBasket,
  CommercialConfirmationAssessment,
  CommercialConfirmationState,
  ConfidenceAssessment,
  CustomerConfirmationEvent,
  EvidenceRef,
  FinalBasketSummaryEvent,
  StaffFinalConfirmationEvent,
} from './types';

function assessment(
  level: ConfidenceAssessment['level'],
  score: number,
  ruleIds: string[],
  evidence: EvidenceRef[]
): ConfidenceAssessment {
  return { level, score, ruleIds, evidence };
}

/**
 * Assesses the CURRENT (latest, never-superseded) basket version of a case. A version that was
 * confirmed and later superseded by a customer edit stays historically true on its own row —
 * `modificationAfterConfirmation` records that fact, but the new version must independently earn
 * its own summary/confirmation/staff-confirmation to read `commercial_confirmation_complete`.
 */
export function deriveCommercialConfirmationState(
  caseId: string,
  baskets: CaseBasket[],
  summaryEvents: FinalBasketSummaryEvent[],
  customerConfirmationEvents: CustomerConfirmationEvent[],
  staffFinalConfirmationEvents: StaffFinalConfirmationEvent[]
): CommercialConfirmationAssessment {
  if (baskets.length === 0) {
    return {
      caseId,
      basketId: '',
      basketVersion: 0,
      summaryPresented: false,
      customerConfirmed: false,
      staffConfirmed: false,
      announcedTotalPresent: false,
      modificationAfterConfirmation: false,
      currentState: 'unknown',
      primaryMessageIds: [],
      ruleIds: ['commercial.state.no_basket'],
      confidence: assessment('unknown', 0.2, ['commercial.state.no_basket'], []),
      needsHumanReview: false,
      humanReviewReasons: [],
    };
  }

  const latest = baskets[baskets.length - 1];
  const latestSummaryEvent = summaryEvents.filter((e) => e.basketVersion === latest.version).pop() ?? null;
  const latestConfirmationEvent =
    customerConfirmationEvents.filter((e) => e.basketVersion === latest.version).pop() ?? null;
  const latestStaffConfirmationEvent =
    staffFinalConfirmationEvents.filter((e) => e.basketVersion === latest.version).pop() ?? null;

  const summaryPresented = latestSummaryEvent !== null;
  const customerConfirmed = latest.confirmedByCustomerAt !== null || latest.status === 'confirmed';
  const staffConfirmed = latest.confirmedAt !== null;
  const announcedTotalPresent = latest.announcedTotal !== null;
  // Was an EARLIER version of this same case customer-confirmed before being superseded? That is
  // the fact this flag records — never re-used as permission for the CURRENT version.
  const modificationAfterConfirmation = baskets.some(
    (b, i) => i < baskets.length - 1 && b.confirmedByCustomerAt !== null
  );

  const ruleIds: string[] = [];
  const humanReviewReasons: string[] = [];

  let currentState: CommercialConfirmationState;
  if (latest.status === 'cancelled') {
    // WHOLE_BASKET_REJECTION_RX is the only path that produces this today — a customer-initiated
    // rejection of the presented basket. 'cancelled' is reserved for a future explicit
    // administrative/staff cancellation event this phase does not produce.
    currentState = 'rejected';
    ruleIds.push('commercial.state.rejected_whole_basket');
  } else if (staffConfirmed && customerConfirmed && summaryPresented) {
    currentState = 'commercial_confirmation_complete';
    ruleIds.push('commercial.state.complete');
  } else if (customerConfirmed && !staffConfirmed) {
    currentState = 'customer_confirmed';
    ruleIds.push('commercial.state.customer_confirmed_awaiting_staff');
  } else if (modificationAfterConfirmation && !customerConfirmed) {
    currentState = 'modified_after_confirmation';
    ruleIds.push('commercial.state.modified_after_confirmation');
  } else if (summaryPresented && !customerConfirmed) {
    // 'final_summary_presented' and 'awaiting_customer_confirmation' describe the same moment in
    // this engine (a summary always immediately puts the basket in a waiting state) — the more
    // actionable name is reported; see the Phase C ambiguities note in the report.
    currentState = 'awaiting_customer_confirmation';
    ruleIds.push('commercial.state.awaiting_customer_confirmation');
  } else if (latest.status === 'draft') {
    currentState = 'basket_in_progress';
    ruleIds.push('commercial.state.basket_in_progress');
  } else {
    currentState = 'unknown';
    ruleIds.push('commercial.state.unresolved');
    humanReviewReasons.push('commercial_confirmation_state_unresolved');
  }
  const needsHumanReview = humanReviewReasons.length > 0;

  const primaryMessageIds = Array.from(
    new Set(
      [
        latestSummaryEvent?.messageId,
        latestConfirmationEvent?.messageId,
        latestStaffConfirmationEvent?.messageId,
      ].filter((id): id is string => Boolean(id))
    )
  );
  if (primaryMessageIds.length === 0) primaryMessageIds.push(...latest.sourceMessageIds);

  const evidence: EvidenceRef[] = [
    ...(latestSummaryEvent ? latestSummaryEvent.evidence : []),
    ...(latestConfirmationEvent ? latestConfirmationEvent.evidence : []),
    ...(latestStaffConfirmationEvent ? latestStaffConfirmationEvent.evidence : []),
  ];

  const level: ConfidenceAssessment['level'] =
    currentState === 'unknown'
      ? 'unknown'
      : currentState === 'commercial_confirmation_complete'
        ? 'strongly_inferred'
        : 'weakly_inferred';
  const score =
    currentState === 'unknown' ? 0.3 : currentState === 'commercial_confirmation_complete' ? 0.85 : 0.55;

  return {
    caseId,
    basketId: latest.basketId,
    basketVersion: latest.version,
    summaryPresented,
    customerConfirmed,
    staffConfirmed,
    announcedTotalPresent,
    modificationAfterConfirmation,
    currentState,
    primaryMessageIds,
    ruleIds,
    confidence: assessment(level, score, ruleIds, evidence),
    needsHumanReview,
    humanReviewReasons,
  };
}
