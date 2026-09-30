// Sales Intelligence — Unified Case Intelligence read model.
//
// PROJECTION / COMPOSITION ONLY. Builds one readable object per commercial interaction from the
// canonical outputs the pipeline has ALREADY produced (Customer Need lifecycle, Basket, Commercial
// Confirmation, Journey, Attribution, Canonical Sales Outcome, Unavailable Demand, Lost Opportunity,
// Follow-up). It never re-analyses products, never re-decides sale/lost/follow-up, never resolves
// identity and never reads message text for meaning: messages are used only to look up a fact's
// sender by message id. Built once inside the pipeline; readers consume it and never run engines.
import type {
  ConversationInteractionV32,
  NormalizedConversationMessageV32,
} from '../whatsappConversationUnderstandingV32';
import type {
  CaseIntelligenceReviewReason,
  CaseIntelligenceStaffFact,
  CaseIntelligenceView,
  SalesIntelligenceCaseAnalysis,
} from './types';

export const CASE_INTELLIGENCE_VIEW_VERSION = 'case-intelligence-v3';

export interface BuildCaseIntelligenceContext {
  messages: NormalizedConversationMessageV32[];
  interaction: ConversationInteractionV32 | null;
  customerIdentityStatus?: 'resolved' | 'unresolved' | 'ambiguous' | 'contradicted';
  customerNameHint?: string | null;
  customerCodeHint?: string | null;
  staffIdBySender?: Record<string, string>;
}

type AnalysisWithoutView = Omit<SalesIntelligenceCaseAnalysis, 'caseIntelligence'>;

export function buildCaseIntelligenceView(
  analysis: AnalysisWithoutView,
  context: BuildCaseIntelligenceContext
): CaseIntelligenceView {
  const { conversationCase, customerNeed, commercialConfirmation, attribution, salesOutcome } = analysis;
  const messages = context.messages;
  const byId = new Map(messages.map((m) => [m.id, m]));
  const staffIdFor = (sender: string) => context.staffIdBySender?.[sender] ?? null;
  const identityStatus =
    context.customerIdentityStatus ??
    (conversationCase.customerId ? 'resolved' : 'not_provided');
  const identityResolved = identityStatus === 'resolved';

  // ---- Staff: participants are message facts; every fact is attributed to its own message sender.
  const participants = new Map<string, { sender: string; staffId: string | null; messageIds: string[] }>();
  for (const message of messages) {
    if (message.role !== 'staff' || !message.isMeaningful) continue;
    const row = participants.get(message.sender) ?? { sender: message.sender, staffId: staffIdFor(message.sender), messageIds: [] };
    row.messageIds.push(message.id);
    participants.set(message.sender, row);
  }
  const facts: CaseIntelligenceStaffFact[] = [];
  const pushFact = (fact: CaseIntelligenceStaffFact['fact'], messageId: string, source: CaseIntelligenceStaffFact['source'], productKey: string | null, staffId?: string | null) => {
    const message = byId.get(messageId);
    if (!message || message.role !== 'staff') return;
    facts.push({ fact, messageId, staffSender: message.sender, staffId: staffId ?? staffIdFor(message.sender), productKey, source });
  };
  for (const product of customerNeed.products) {
    for (const evidence of product.availabilityEvidence) {
      pushFact(`stated_${evidence.state}` as CaseIntelligenceStaffFact['fact'], evidence.messageId, 'customer_need', product.key, evidence.staffId);
    }
    for (const alternative of product.alternatives) {
      pushFact('offered_alternative', alternative.offerMessageId, 'customer_need', product.key, alternative.offeredByStaffId);
    }
    if (product.roles.includes('offered')) {
      for (const id of product.evidenceMessageIds) {
        if (byId.get(id)?.role === 'staff' && !product.availabilityEvidence.some((e) => e.messageId === id) && !product.alternatives.some((a) => a.offerMessageId === id)) {
          pushFact('offered_product', id, 'customer_need', product.key);
        }
      }
    }
  }
  if (commercialConfirmation.staffConfirmed) {
    for (const id of commercialConfirmation.primaryMessageIds) pushFact('confirmed_order', id, 'commercial_confirmation', null);
  }
  for (const staffFact of analysis.lostOpportunity.staffFacts) {
    if (staffFact.fact === 'awaiting_customer_reply') pushFact('awaiting_customer_reply', staffFact.messageId, 'lost_opportunity', null, staffFact.staffId);
  }
  for (const opportunity of analysis.followUp.opportunities) {
    if (opportunity.reason === 'staff_promised_check' || opportunity.reason === 'stock_check_pending') {
      for (const id of opportunity.evidenceMessageIds) {
        if (byId.get(id)?.role === 'staff') pushFact('promised_follow_up', id, 'follow_up', opportunity.productKey, opportunity.assignedStaffId);
      }
    }
  }
  const uniqueFacts = dedupeFacts(facts);

  // ---- Products: a cross-reference index over the need lifecycle (no evidence duplicated here).
  const products = customerNeed.products.map((product) => {
    const demand = analysis.unavailableDemand.find((d) => d.productKey === product.key) ?? null;
    const loss = analysis.lostOpportunity.productLosses.find((l) => l.productKey === product.key) ?? null;
    return {
      productKey: product.key,
      productNameRaw: product.productNameRaw,
      productId: product.productId,
      roles: product.roles,
      requestedQuantity: product.requestedQuantity,
      offeredQuantity: product.offeredQuantity,
      finalQuantity: product.finalQuantity,
      availability: product.availability,
      alternativeCount: product.alternatives.length,
      alternativeResponses: product.alternatives.map((a) => a.response),
      inFinalBasket: product.roles.includes('final_basket'),
      demandKey: demand?.demandKey ?? null,
      lossOutcome: loss?.outcome ?? null,
      lossReason: loss?.reason ?? null,
      followUpKeys: analysis.followUp.opportunities.filter((o) => o.productKey === product.key).map((o) => o.followUpKey),
    };
  });

  // ---- Basket: versions + active basket, straight from the basket owner.
  const active = analysis.activeBasket;
  const basket = {
    versions: analysis.basketHistory.map((b) => ({
      basketId: b.basketId,
      version: b.version,
      status: b.status,
      itemCount: (analysis.itemsByBasketId[b.basketId] ?? []).length,
      announcedTotal: b.announcedTotal?.amount ?? null,
      confirmedAt: b.confirmedAt,
      confirmedByCustomerAt: b.confirmedByCustomerAt,
    })),
    activeBasketId: active?.basketId ?? null,
    activeItems: active ? analysis.itemsByBasketId[active.basketId] ?? [] : [],
    announcedTotal: active?.announcedTotal?.amount ?? null,
    confirmed: Boolean(active && (active.status === 'confirmed' || active.confirmedByCustomerAt)),
  };

  // ---- Review: aggregation of canonical reasons only (no new rule).
  const reasons: CaseIntelligenceReviewReason[] = [];
  const addReason = (code: string, source: CaseIntelligenceReviewReason['source']) => {
    if (!reasons.some((r) => r.code === code)) reasons.push({ code, source });
  };
  const provenSale = salesOutcome.outcome === 'sale_proven' && salesOutcome.saleProofState === 'proven';
  const needReasonsResolvedByProvenInvoice = new Set([
    'customer_need_without_resolved_product_context',
    'customer_need_product_context_ambiguous',
  ]);

  if (!identityResolved) addReason('customer_identity_unresolved', 'customer_identity');
  analysis.humanReviewReasons.forEach((code) => addReason(code, 'pipeline'));
  customerNeed.humanReviewReasons.forEach((code) => {
    if (provenSale && needReasonsResolvedByProvenInvoice.has(code)) return;
    addReason(code, 'customer_need');
  });
  if (customerNeed.unlinkedAvailability.length) addReason('need.availability_statement_unlinked', 'customer_need');
  if (customerNeed.unlinkedAlternatives.length) addReason('need.alternative_offer_unlinked', 'customer_need');
  attribution.contradictions.forEach((code) => addReason(`sale.${code}`, 'sale_proof'));
  if (salesOutcome.saleProofState === 'contradicted') addReason('sale.proof_contradicted', 'sale_proof');
  if (analysis.journeyState.reviewRequired) addReason('journey.review_required', 'journey');
  if (analysis.lostOpportunity.state === 'unknown') addReason('lost.state_unknown', 'lost_opportunity');
  analysis.followUp.opportunities
    .filter((o) => o.status === 'blocked' && o.blocker)
    .forEach((o) => addReason(`follow_up.blocked.${o.blocker}`, 'follow_up'));

  const interaction = context.interaction;
  const allEvidence = new Set<string>([
    ...customerNeed.evidenceMessageIds,
    ...analysis.journeyState.evidenceMessageIds,
    ...commercialConfirmation.primaryMessageIds,
    ...analysis.unavailableDemand.flatMap((d) => d.evidenceMessageIds),
    ...analysis.lostOpportunity.evidenceMessageIds,
    ...analysis.followUp.opportunities.flatMap((o) => o.evidenceMessageIds),
  ]);

  return {
    version: CASE_INTELLIGENCE_VIEW_VERSION,
    caseId: analysis.caseId,
    conversationId: analysis.conversationId,
    sourceCaseIdV22: conversationCase.sourceCaseIdV22,
    interaction: {
      interactionId: interaction?.id ?? null,
      startedAt: conversationCase.startedAt,
      endedAt: conversationCase.endedAt,
      messageCount: messages.length,
      meaningfulMessageCount: messages.filter((m) => m.isMeaningful).length,
      messageIds: messages.map((m) => m.id),
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        sender: m.sender,
        at: m.timestamp.toISOString(),
        text: m.text,
        meaningful: m.isMeaningful,
      })),
      triggerMessageId: interaction?.triggerMessageId ?? null,
      segmentationReason: interaction?.segmentationReason ?? null,
      caseType: conversationCase.caseType,
      caseStatus: conversationCase.status,
      confidence: conversationCase.confidence,
    },
    customer: {
      customerId: identityResolved ? conversationCase.customerId : null,
      customerPhone: identityResolved ? conversationCase.customerPhone : null,
      customerName: identityResolved ? (context.customerNameHint?.trim() || null) : null,
      customerCode: identityResolved ? (context.customerCodeHint?.trim() || null) : null,
      identityStatus,
      blockers: identityResolved ? [] : ['customer_identity_unresolved'],
    },
    branch: { branchId: conversationCase.branchId, branchNameRaw: conversationCase.branchNameRaw },
    staff: {
      participants: [...participants.values()].map((p) => ({ ...p, messageCount: p.messageIds.length })),
      facts: uniqueFacts,
    },
    need: customerNeed,
    products,
    basket,
    journey: analysis.journeyState,
    sale: {
      confirmationState: commercialConfirmation.currentState,
      summaryPresented: commercialConfirmation.summaryPresented,
      customerConfirmed: commercialConfirmation.customerConfirmed,
      staffConfirmed: commercialConfirmation.staffConfirmed,
      confirmationMessageIds: commercialConfirmation.primaryMessageIds,
      invoiceCandidateIds: analysis.invoiceCandidateIds,
      selectedInvoiceId: attribution.selectedInvoiceId,
      selectedInvoiceNumber: attribution.selectedInvoiceNumber,
      attributionLevel: attribution.attributionLevel,
      proofState: salesOutcome.saleProofState,
      outcome: salesOutcome.outcome,
      isSaleCountable: salesOutcome.isSaleCountable,
      reasonCodes: salesOutcome.reasonCodes,
      contradictions: attribution.contradictions,
    },
    unavailableDemand: analysis.unavailableDemand,
    lostOpportunity: analysis.lostOpportunity,
    followUp: analysis.followUp,
    coachingEvidence: {
      staffReplied: participants.size > 0,
      unansweredRequestMessageIds: analysis.lostOpportunity.reason === 'staff_no_response' ? analysis.lostOpportunity.evidenceMessageIds : [],
      alternativeOfferedProductKeys: customerNeed.products.filter((p) => p.alternatives.length).map((p) => p.key),
      unavailableWithoutAlternativeProductKeys: analysis.unavailableDemand.filter((d) => !d.alternativeOffered).map((d) => d.productKey),
      delayComplaintMessageIds: analysis.lostOpportunity.reason === 'slow_response' ? analysis.lostOpportunity.evidenceMessageIds : [],
      clearClosing: commercialConfirmation.currentState === 'commercial_confirmation_complete',
      protocolCompliant: analysis.protocolAssessment.protocolCompliant,
      missingProtocolSteps: analysis.protocolAssessment.missingProtocolSteps,
      protocolApplicability: analysis.protocolAssessment.applicability ?? 'unknown',
    },
    evidenceSummary: {
      evidenceMessageIds: messages.map((m) => m.id).filter((id) => allEvidence.has(id)),
      sectionConfidence: {
        interaction: conversationCase.confidence.level,
        need: customerNeed.confidence.level,
        journey: analysis.journeyState.confidence.level,
        attribution: attribution.attributionLevel,
        lostOpportunity: analysis.lostOpportunity.confidence.level,
      },
    },
    review: { required: analysis.needsHumanReview || reasons.length > 0, reasons },
  };
}

function dedupeFacts(facts: CaseIntelligenceStaffFact[]): CaseIntelligenceStaffFact[] {
  const seen = new Set<string>();
  return facts.filter((fact) => {
    const key = `${fact.fact}|${fact.messageId}|${fact.productKey ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
