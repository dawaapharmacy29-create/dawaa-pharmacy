// Sales Intelligence — Commercial Journey State Machine.
//
// Collapses existing canonical evidence into one readable state. It never creates sale truth:
// sale_proven is reachable only when CanonicalSalesOutcome already proved it.
import type { NormalizedConversationMessageV32 } from '../whatsappConversationUnderstandingV32';
import { extractClarificationQuestionSignals } from '../whatsappSemanticSignalsV32';
import type {
  CanonicalSalesOutcomeAssessment,
  CommercialConfirmationAssessment,
  CommercialJourneyState,
  CommercialJourneyStateAssessment,
  ConfidenceAssessment,
  ConfidenceLevel,
  CustomerNeedModel,
  EvidenceRef,
  FinancialSettlementAssessment,
} from './types';

export interface DeriveCommercialJourneyStateInput {
  caseId: string;
  messages: NormalizedConversationMessageV32[];
  customerNeed: CustomerNeedModel;
  commercialConfirmation: CommercialConfirmationAssessment;
  salesOutcome: CanonicalSalesOutcomeAssessment;
  financialSettlement?: FinancialSettlementAssessment | null;
}

function ref(messageId: string, description: string): EvidenceRef {
  return { sourceTable: 'whatsapp_review_sources', sourceId: '', messageIds: [messageId], description };
}
function assess(level: ConfidenceLevel, score: number, ruleId: string, evidence: EvidenceRef[] = []): ConfidenceAssessment {
  return { level, score, ruleIds: [ruleId], evidence };
}

const PROGRESSION: CommercialJourneyState[] = [
  'need_identified',
  'clarifying',
  'offer_made',
  'basket_building',
  'awaiting_customer_confirmation',
  'customer_confirmed',
  'awaiting_invoice',
  'invoiced_unproven',
  'financially_settled',
  'sale_proven',
];

export function deriveCommercialJourneyState(input: DeriveCommercialJourneyStateInput): CommercialJourneyStateAssessment {
  const clarifications = extractClarificationQuestionSignals(input.messages);
  const offered = input.customerNeed.products.some((p) => p.roles.includes('offered'));
  const basketBuilt = input.customerNeed.products.some((p) => p.roles.includes('final_basket') || p.roles.includes('requested'));
  // Need decline is owned by the Customer Need model: rejecting an alternative is not declining the need.
  const declined = input.salesOutcome.outcome === 'customer_rejected' || input.customerNeed.needDeclined;
  const financiallySettled =
    input.financialSettlement?.status === 'settled' &&
    input.salesOutcome.outcome === 'order_confirmed_unproven' &&
    input.salesOutcome.reasonCodes.includes('outcome.financial_settlement_closed_sale_not_proven');
  const invoiceBackedClosed =
    input.salesOutcome.outcome === 'order_confirmed_unproven' &&
    input.salesOutcome.reasonCodes.includes('outcome.invoice_backed_order_closed_sale_not_proven');
  const operationallyClosed = financiallySettled || invoiceBackedClosed;

  const reached = new Set<CommercialJourneyState>();
  const evidenceIds = new Set<string>();
  if (input.customerNeed.primaryNeedMessageId) {
    reached.add('need_identified');
    evidenceIds.add(input.customerNeed.primaryNeedMessageId);
  }
  if (clarifications.length) {
    reached.add('clarifying');
    clarifications.forEach((s) => evidenceIds.add(s.messageId));
  }
  if (offered) {
    reached.add('offer_made');
    input.customerNeed.products.filter((p) => p.roles.includes('offered'))
      .flatMap((p) => p.evidenceMessageIds).forEach((id) => evidenceIds.add(id));
  }
  if (basketBuilt) {
    reached.add('basket_building');
    input.customerNeed.products.flatMap((p) => p.evidenceMessageIds).forEach((id) => evidenceIds.add(id));
  }
  if (input.commercialConfirmation.summaryPresented) reached.add('awaiting_customer_confirmation');
  if (input.commercialConfirmation.customerConfirmed) reached.add('customer_confirmed');
  if (financiallySettled) {
    reached.add('financially_settled');
    input.financialSettlement?.primaryMessageIds.forEach((id) => evidenceIds.add(id));
  } else if (invoiceBackedClosed) {
    reached.add('invoiced_unproven');
  } else if (input.commercialConfirmation.staffConfirmed || input.salesOutcome.outcome === 'order_confirmed_unproven') {
    reached.add('awaiting_invoice');
  }
  input.commercialConfirmation.primaryMessageIds.forEach((id) => evidenceIds.add(id));
  if (input.salesOutcome.outcome === 'sale_proven') reached.add('sale_proven');

  let currentState: CommercialJourneyState = 'unknown';
  let confidence = assess('unknown', 0.1, 'journey.no_reliable_state_evidence');
  const reasonCodes: string[] = [];

  if (input.salesOutcome.outcome === 'information_only') {
    currentState = 'information_only';
    reasonCodes.push('journey.information_only_from_canonical_outcome');
    confidence = assess('proven', 0.95, reasonCodes[0]);
  } else if (input.salesOutcome.outcome === 'sale_proven') {
    currentState = 'sale_proven';
    reasonCodes.push('journey.sale_proven_only_from_canonical_outcome');
    confidence = assess('proven', 1, reasonCodes[0]);
  } else if (financiallySettled) {
    currentState = 'financially_settled';
    reasonCodes.push('journey.financial_settlement_closed_order_sale_proof_pending');
    confidence = {
      level: 'strongly_inferred',
      score: Math.max(0.95, input.financialSettlement?.confidence.score ?? 0),
      ruleIds: [reasonCodes[0]],
      evidence: input.financialSettlement?.confidence.evidence ?? [],
    };
  } else if (invoiceBackedClosed) {
    currentState = 'invoiced_unproven';
    reasonCodes.push('journey.invoice_backed_order_closed_sale_proof_pending');
    confidence = assess('strongly_inferred', 0.95, reasonCodes[0]);
  } else if (declined) {
    currentState = 'customer_declined';
    reasonCodes.push('journey.customer_declined_from_customer_evidence');
    const declineId = input.customerNeed.needDeclineMessageIds[0];
    const declineMessage = declineId ? input.messages.find((m) => m.id === declineId) : undefined;
    confidence = assess(
      'strongly_inferred',
      0.9,
      reasonCodes[0],
      declineId ? [ref(declineId, `رفض صريح من العميل: "${(declineMessage?.text ?? '').slice(0, 120)}".`)] : []
    );
  } else {
    for (const state of PROGRESSION) if (reached.has(state)) currentState = state;
    const states: Partial<Record<CommercialJourneyState, [string, ConfidenceLevel, number]>> = {
      awaiting_invoice: [
        input.salesOutcome.reasonCodes.includes('outcome.financial_settlement_closed_sale_not_proven')
          ? 'journey.financial_settlement_closed_canonical_sale_proof_pending'
          : 'journey.order_confirmed_sale_not_yet_proven',
        'strongly_inferred',
        0.9,
      ],
      customer_confirmed: ['journey.customer_confirmed_waiting_staff_or_invoice', 'strongly_inferred', 0.85],
      awaiting_customer_confirmation: ['journey.final_basket_presented_waiting_customer', 'strongly_inferred', 0.8],
      basket_building: ['journey.basket_evidence_present', 'strongly_inferred', 0.75],
      offer_made: ['journey.staff_offer_present', 'strongly_inferred', 0.7],
      clarifying: ['journey.clarification_in_progress', 'strongly_inferred', 0.7],
      need_identified: ['journey.customer_need_identified', 'strongly_inferred', 0.7],
    };
    const row = states[currentState];
    if (row) {
      reasonCodes.push(row[0]);
      confidence = assess(row[1], row[2], row[0]);
    } else {
      reasonCodes.push('journey.no_reliable_state_evidence');
    }
  }

  return {
    caseId: input.caseId,
    currentState,
    reachedStates: [
      ...(currentState === 'information_only' ? (['information_only'] as CommercialJourneyState[]) : []),
      ...PROGRESSION.filter((state) => reached.has(state)),
      ...(declined ? (['customer_declined'] as CommercialJourneyState[]) : []),
    ],
    evidenceMessageIds: Array.from(evidenceIds),
    reasonCodes,
    confidence,
    reviewRequired:
      input.salesOutcome.needsHumanReview ||
      (!operationallyClosed && input.salesOutcome.outcome !== 'sale_proven' && input.customerNeed.needsHumanReview) ||
      input.salesOutcome.outcome === 'needs_review',
  };
}
