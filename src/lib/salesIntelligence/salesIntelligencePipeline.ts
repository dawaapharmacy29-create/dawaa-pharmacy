// Sales Intelligence Phase G — End-to-End Shadow Pipeline.
//
// PURE ORCHESTRATION ONLY. Composes the existing engines (Phases B-F) into one case-level result
// — never re-derives conversation understanding, basket state, commercial confirmation,
// attribution, or invoice matching. No Supabase calls anywhere in this file: invoice candidates
// are supplied via `resolveInvoiceCandidates`, a caller-injected SYNCHRONOUS callback (see
// invoiceCandidateRetrieval.ts for the actual read-only I/O boundary) so this module stays fully
// pure and unit-testable, exactly like every engine it composes.
import { parseWhatsAppExport, splitWhatsAppSessions } from '../whatsappConversationParser';
import {
  buildConversationUnderstandingV32,
  type ConversationInteractionV32,
  type ConversationUnderstandingV32,
  type NormalizedConversationMessageV32,
} from '../whatsappConversationUnderstandingV32';
import { deriveConversationCases } from './conversationCaseEngine';
import { buildCaseBaskets } from './caseBasketEngine';
import {
  assessOrderConfirmationProtocol,
  deriveCommercialConfirmationState,
  deriveOrderConfirmationProtocolApplicability,
} from './commercialConfirmationEngine';
import {
  deriveSaleAttributionAssessment,
  unavailableInvoiceItemEvidenceProvider,
  type CaseAttributionContext,
  type InvoiceItemEvidenceProvider,
} from './saleAttributionEngine';
import { deriveBasketInvoiceMatch, resolveActiveBasket, type DocumentedAdjustment } from './basketInvoiceMatchingEngine';
import { deriveSalesIntegrityAssessment } from './salesIntegrityEngine';
import { deriveHistoricalCommercialClosureAssessment } from './historicalCommercialClosureEngine';
import { deriveSaleProofState } from './saleProofState';
import { deriveCanonicalSalesOutcome } from './canonicalSalesOutcomeEngine';
import { deriveCustomerNeedModel } from './customerNeedModel';
import { deriveCommercialJourneyState } from './commercialJourneyStateMachine';
import { deriveUnavailableDemand } from './unavailableDemandEngine';
import { deriveLostOpportunity } from './lostOpportunityEngine';
import { deriveFollowUpOpportunities } from './followUpOpportunityEngine';
import { buildCaseIntelligenceView } from './caseIntelligenceView';
import {
  resolveProductMention,
  type PharmacyProductIndex,
} from './pharmacyProducts/pharmacyProductResolverV2';
import type { InvoiceLike } from '../invoices/invoiceCore';
import type { InvoiceCandidateQueryContext } from './invoiceCandidateRetrieval';
import type {
  CaseBasketItem,
  ConversationCase,
  EvidenceCompleteness,
  EvidenceLevel,
  PipelineFailureReason,
  PipelineStatus,
  SalesIntelligenceCaseAnalysis,
} from './types';

export interface SalesIntelligencePipelineInput {
  /** whatsapp_review_sources.id (or the root_source_id of a merged case) this raw text reads. */
  conversationId: string;
  rawWhatsAppExportText: string;
  /** Trusted persisted whatsapp_review_sources.conversation_started_at; used only as a date anchor for time-only markdown exports. */
  trustedConversationStartedAt?: string | null;
  sourceCaseIdV22?: string | null;
  customerIdHint?: string | null;
  customerPhoneHint?: string | null;
  customerNameHint?: string | null;
  customerCodeHint?: string | null;
  /**
   * Canonical Customer Identity status (canonicalCustomerIdentityResolver). When provided and not
   * 'resolved', the case can never be Sale Proof `proven` nor official staff attribution.
   */
  customerIdentityStatus?: 'resolved' | 'unresolved' | 'ambiguous' | 'contradicted';
  branchIdHint?: string | null;
  branchNameRawHint?: string | null;
  /** Known contributing staff ids for this conversation (Phase B StaffContribution.staffId) — conservative, may be empty. */
  knownStaffIds?: string[];
  /**
   * Canonical message-sender -> staff.id map resolved upstream by the staff identity owner. Used by
   * the Customer Need Model to attribute each availability/alternative statement to its own sender.
   * Omitted = senders stay raw with staffId null (never guessed).
   */
  staffIdBySender?: Record<string, string>;
  /** From an existing legacy adapter's own matched-invoice fields (e.g. whatsapp_review_sources.matched_invoice_id) — evidence only, never trusted as canonical. */
  legacyMatchedInvoiceId?: string | null;
  legacyMatchedInvoiceNumber?: string | null;
  /** An explicit, ALREADY-TRUSTED system link, when one exists upstream — the only path to `proven`. Never guessed. */
  trustedInvoiceId?: string | null;
  trustedInvoiceNumber?: string | null;
  /**
   * Called once per derived case with THAT CASE's own segmented facts (see
   * InvoiceCandidateQueryContext's own doc comment on why this must be case-level, never
   * conversation-level, timing). Returns the ALREADY-FETCHED candidate invoice rows — retrieval
   * (an I/O concern) is kept structurally separate from this pure orchestration module. A caller
   * typically pre-fetches via buildInvoiceCandidateQuery()/fetchInvoiceCandidates()
   * (invoiceCandidateRetrieval.ts) before invoking this pipeline.
   */
  resolveInvoiceCandidates: (context: InvoiceCandidateQueryContext) => InvoiceLike[];
  itemEvidenceProvider?: InvoiceItemEvidenceProvider;
  /** Optional canonical pharmacy catalog index. Used only to enrich basket item identity. */
  productIndex?: PharmacyProductIndex;
  documentedAdjustments?: DocumentedAdjustment[];
  invoiceCancelledOrReturned?: boolean;
  /** Caller-CONFIRMED only — never inferred here from ambiguous free-text status columns (mirrors Phase F's own field). */
  invoiceStatusHint?: 'cancelled' | 'returned' | null;
  competingSelections?: Array<{ caseId: string; invoiceId: string }>;
  /** Coarse transport partition retained only for stable legacy case-id envelopes; V32 owns analytical interaction boundaries. */
  sessionSplitGapMinutes?: number;
  /**
   * Phase G.1 — passed straight through to SalesIntegrityInput.protocolPolicyEffectiveAt (see its
   * own doc comment for the full 3-way undefined/null/date semantics). OMITTED by default,
   * preserving this pipeline's pre-G.1 behavior exactly.
   */
  protocolPolicyEffectiveAt?: string | null;
}

export interface SalesIntelligencePipelineResult {
  conversationId: string;
  sessionsProcessed: number;
  caseAnalyses: SalesIntelligenceCaseAnalysis[];
  /** Pipeline-level observations not tied to any single case (e.g. raw text produced zero messages). */
  pipelineWarnings: string[];
}

function messagesForMessageIds(
  understanding: ConversationUnderstandingV32,
  messageIds: string[]
): NormalizedConversationMessageV32[] {
  const ids = new Set(messageIds);
  return understanding.messages.filter((m) => ids.has(m.id));
}

/**
 * Sum of the active basket's own item line totals, when computable. caseBasketEngine.ts never
 * populates CaseBasketItem.lineTotal today (no unit-price resolution step exists yet) — this
 * returns null in production, exactly mirroring CaseAttributionContext.activeBasketValue's own
 * documented "null when unit prices aren't populated — never guessed" contract.
 */
function computeActiveBasketValue(items: CaseBasketItem[]): number | null {
  let sum = 0;
  let any = false;
  for (const item of items) {
    if (item.lineTotal != null) {
      sum += item.lineTotal;
      any = true;
    }
  }
  return any ? sum : null;
}

/**
 * Mirrors saleAttributionEngine.ts's own (private) getInvoiceRowId() lookup priority
 * (id, invoice_number, invoice_no) ONLY for re-finding, among the candidates this pipeline itself
 * already fetched, the exact row Phase D selected — never a re-derivation of attribution logic
 * itself. In the live `sales_invoices` schema `id` is always populated, so this is a stable lookup
 * key in practice; kept intentionally in sync with that private helper's own field priority.
 */
function invoiceRowLookupId(row: InvoiceLike): string {
  const value = row.id ?? row.invoice_number ?? row.invoice_no;
  return String(value ?? '').trim();
}

// ---------------------------------------------------------------------------
// Evidence completeness — a fixed, documented ratio over a set of CORE signals, never a
// free-floating guess. Item-level and fulfillment evidence are deliberately EXCLUDED from the
// core ratio: invoice-item evidence is available only for invoices whose lines were imported,
// while fulfillment evidence still has no authoritative source; including either as a mandatory
// would put a permanent ceiling on every real case regardless of how well everything else was
// evidenced. Their absence stays fully visible via their own EvidenceCompleteness fields and via
// SalesIntegrityAssessment.canEvaluateItemIntegrity/canEvaluateFulfillmentIntegrity.
// ---------------------------------------------------------------------------
function computeOverallEvidenceLevel(completeness: Omit<EvidenceCompleteness, 'overallEvidenceLevel'>): EvidenceLevel {
  if (!completeness.conversationAvailable) return 'insufficient';
  if (!completeness.basketDetected) {
    // No commercial basket at all — there is nothing to reason about a SALE with, though the
    // conversation itself (and customer identity) may still be well understood.
    return completeness.customerIdentityResolved ? 'low' : 'insufficient';
  }
  const coreSignals = [
    completeness.customerIdentityResolved,
    completeness.caseSegmentationConfident,
    completeness.finalBasketDetected,
    completeness.announcedTotalAvailable,
    completeness.customerConfirmationDetected,
    completeness.staffConfirmationDetected,
    completeness.invoiceCandidatesAvailable,
    completeness.invoiceAttributed,
  ];
  const ratio = coreSignals.filter(Boolean).length / coreSignals.length;
  if (ratio >= 0.85) return 'high';
  if (ratio >= 0.55) return 'medium';
  if (ratio >= 0.25) return 'low';
  return 'insufficient';
}

function enrichBasketProductIdentities(
  itemsByBasketId: Record<string, CaseBasketItem[]>,
  productIndex?: PharmacyProductIndex
): Record<string, CaseBasketItem[]> {
  if (!productIndex) return itemsByBasketId;

  return Object.fromEntries(
    Object.entries(itemsByBasketId).map(([basketId, items]) => [
      basketId,
      items.map((item) => {
        if (item.productId || item.resolutionStatus === 'contradicted' || item.resolutionStatus === 'missing') {
          return item;
        }

        const resolution = resolveProductMention(item.productNameRaw, productIndex);
        const selected = resolution.selected;
        if (!selected || !['proven', 'strongly_inferred'].includes(selected.confidence)) {
          return item;
        }

        return {
          ...item,
          productId: selected.product.productId,
          // Exact code is canonical proof. Exact canonical name / approved alias remains
          // partially proven even though we can safely carry the canonical id forward.
          resolutionStatus:
            selected.confidence === 'proven' ? 'proven' : 'partially_proven',
        };
      }),
    ])
  );
}

function analyzeOneCase(
  conversationCase: ConversationCase,
  scopedMessages: NormalizedConversationMessageV32[],
  input: SalesIntelligencePipelineInput,
  interaction: ConversationInteractionV32 | null = null
): SalesIntelligenceCaseAnalysis {
  const pipelineWarnings: string[] = [];

  const {
    baskets,
    itemsByBasketId: rawItemsByBasketId,
    summaryEvents,
    customerConfirmationEvents,
    staffFinalConfirmationEvents,
  } = buildCaseBaskets(conversationCase.caseId, scopedMessages);
  const itemsByBasketId = enrichBasketProductIdentities(rawItemsByBasketId, input.productIndex);

  const activeBasketResolution = resolveActiveBasket(baskets);
  const activeBasket = activeBasketResolution.outcome === 'selected' ? activeBasketResolution.basket : null;
  if (activeBasketResolution.outcome === 'needs_human_review') {
    pipelineWarnings.push('active_basket_conflict_multiple_non_superseded_versions');
  }

  const commercialConfirmation = deriveCommercialConfirmationState(
    conversationCase.caseId,
    baskets,
    summaryEvents,
    customerConfirmationEvents,
    staffFinalConfirmationEvents
  );

  // Phase G.1: a meaningful customer message alone can produce an empty 'draft' CaseBasket record
  // with no items (see buildCaseBaskets' own ongoing-basket-building fallback) — that artifact is
  // not real evidence of commercial intent. Computed once here and reused both for protocol
  // applicability and for evidenceCompleteness.basketDetected below.
  const hasMeaningfulBasketItems = baskets.some((basket) => (itemsByBasketId[basket.basketId] ?? []).length > 0);

  const activeItems = activeBasket ? (itemsByBasketId[activeBasket.basketId] ?? []) : [];
  const customerNeed = deriveCustomerNeedModel({
    caseId: conversationCase.caseId,
    messages: scopedMessages,
    baskets,
    itemsByBasketId,
    activeBasket,
    staffIdBySender: input.staffIdBySender,
  });
  const unavailableDemand = deriveUnavailableDemand({
    conversationCase,
    customerNeed,
    messages: scopedMessages,
    customerIdentityStatus: input.customerIdentityStatus,
  });
  const activeBasketValue = computeActiveBasketValue(activeItems);

  // Phase G.2 data flow (never reversed): conversation/case facts -> historical closure ->
  // applicability -> (+ policy date) -> compliance. historicalClosure is computed BEFORE
  // applicability and consumed BY it as one evidence source — applicability never writes back
  // into historicalClosure, and compliance (salesIntegrityEngine.ts) never feeds back into
  // applicability either.
  const historicalClosure = deriveHistoricalCommercialClosureAssessment(
    conversationCase.caseId,
    scopedMessages,
    commercialConfirmation,
    activeItems,
    activeBasket?.announcedTotal != null
  );

  const applicability = deriveOrderConfirmationProtocolApplicability({
    caseType: conversationCase.caseType,
    commercial: commercialConfirmation,
    hasMeaningfulBasketItems,
    historicalClosure,
  });
  const protocolAssessment = { ...assessOrderConfirmationProtocol(commercialConfirmation), applicability };

  // CRITICAL (Phase G instruction #2): the candidate-retrieval context uses THIS CASE's own
  // segmented startedAt/endedAt — never conversation-level (whatsapp_review_sources) timestamps.
  const candidateContext: InvoiceCandidateQueryContext = {
    caseId: conversationCase.caseId,
    customerId: conversationCase.customerId,
    customerPhone: conversationCase.customerPhone,
    customerCode: input.customerCodeHint ?? null,
    customerName: input.customerNameHint ?? null,
    branchNameRaw: conversationCase.branchNameRaw,
    caseStartedAt: conversationCase.startedAt,
    caseEndedAt: conversationCase.endedAt,
  };
  const invoiceCandidates = input.resolveInvoiceCandidates(candidateContext);

  const attributionCtx: CaseAttributionContext = {
    caseId: conversationCase.caseId,
    customerId: conversationCase.customerId,
    customerPhone: conversationCase.customerPhone,
    customerCode: input.customerCodeHint ?? null,
    customerName: input.customerNameHint ?? null,
    branchNameRaw: conversationCase.branchNameRaw,
    // Same rule as candidateContext above — this exact segmented case interval, never coarse
    // whole-thread timestamps.
    caseStartedAt: conversationCase.startedAt,
    caseEndedAt: conversationCase.endedAt,
    commercialConfirmation,
    activeAnnouncedTotal: activeBasket?.announcedTotal ?? null,
    activeBasketValue,
    activeBasketItems: activeItems.map((item) => ({
      productNameRaw: item.productNameRaw,
      productId: item.productId,
      quantity: item.quantity,
    })),
    knownStaffIds: input.knownStaffIds ?? [],
    legacyMatchedInvoiceId: input.legacyMatchedInvoiceId ?? null,
    legacyMatchedInvoiceNumber: input.legacyMatchedInvoiceNumber ?? null,
    trustedInvoiceId: input.trustedInvoiceId ?? null,
    trustedInvoiceNumber: input.trustedInvoiceNumber ?? null,
  };

  const itemEvidenceProvider = input.itemEvidenceProvider ?? unavailableInvoiceItemEvidenceProvider;
  const rawAttribution = deriveSaleAttributionAssessment(
    attributionCtx,
    invoiceCandidates,
    itemEvidenceProvider,
    input.competingSelections ?? []
  );

  const invoiceRow = rawAttribution.selectedInvoiceId
    ? (invoiceCandidates.find((row) => invoiceRowLookupId(row) === rawAttribution.selectedInvoiceId) ?? null)
    : null;
  if (rawAttribution.selectedInvoiceId && !invoiceRow) {
    pipelineWarnings.push('selected_invoice_row_not_found_in_candidate_pool');
  }

  const basketInvoiceMatch = deriveBasketInvoiceMatch({
    caseId: conversationCase.caseId,
    baskets,
    itemsByBasketId,
    attribution: rawAttribution,
    invoiceRow,
    itemEvidenceProvider,
    documentedAdjustments: input.documentedAdjustments,
    invoiceCancelledOrReturned: input.invoiceCancelledOrReturned,
  });

  const integrityAssessment = deriveSalesIntegrityAssessment({
    caseId: conversationCase.caseId,
    commercialConfirmation,
    protocolAssessment,
    attribution: rawAttribution,
    basketInvoiceMatch,
    invoiceStatusHint: input.invoiceStatusHint ?? null,
    knownStaffIds: input.knownStaffIds,
    caseEndedAt: conversationCase.endedAt,
    protocolPolicyEffectiveAt: input.protocolPolicyEffectiveAt,
  });

  const evidenceCompletenessBase: Omit<EvidenceCompleteness, 'overallEvidenceLevel'> = {
    conversationAvailable: scopedMessages.length > 0,
    customerIdentityResolved: Boolean(conversationCase.customerId) || Boolean(conversationCase.customerPhone),
    caseSegmentationConfident: !conversationCase.needsHumanReview,
    // A meaningful customer message alone can produce an empty 'draft' CaseBasket record with no
    // items (see buildCaseBaskets's own ongoing-basket-building fallback in caseBasketEngine.ts) —
    // that artifact is not real evidence of commercial intent, so this requires at least one item.
    basketDetected: hasMeaningfulBasketItems,
    finalBasketDetected: activeBasket !== null && activeBasket.status !== 'draft',
    announcedTotalAvailable: activeBasket?.announcedTotal != null,
    customerConfirmationDetected: commercialConfirmation.customerConfirmed,
    staffConfirmationDetected: commercialConfirmation.staffConfirmed,
    invoiceCandidatesAvailable: invoiceCandidates.length > 0,
    invoiceAttributed: rawAttribution.hasAttributedInvoice,
    invoiceItemsAvailable: basketInvoiceMatch.itemEvidenceReady,
    // Always false today — no fulfillment/delivery evidence source exists yet. A staff message
    // like "جاري الإرسال" is staff INTENT/confirmation (already captured as staffConfirmationDetected
    // via caseBasketEngine's STAFF_FINAL_CONFIRMATION_RX), never actual delivery fulfillment.
    fulfillmentEvidenceAvailable: false,
  };
  const evidenceCompleteness: EvidenceCompleteness = {
    ...evidenceCompletenessBase,
    overallEvidenceLevel: computeOverallEvidenceLevel(evidenceCompletenessBase),
  };

  const failureReasons: PipelineFailureReason[] = [];
  if (conversationCase.needsHumanReview) failureReasons.push('case_segmentation_uncertain');
  if (!conversationCase.customerId && !conversationCase.customerPhone) failureReasons.push('customer_identity_unresolved');
  if (!evidenceCompleteness.basketDetected) failureReasons.push('basket_not_detected');
  if (
    activeItems.some(
      (item) =>
        item.resolutionStatus === 'unknown' ||
        item.resolutionStatus === 'contradicted' ||
        (Boolean(input.productIndex) && !item.productId)
    )
  ) {
    failureReasons.push('product_identity_unresolved');
  }
  if (activeItems.some((item) => item.quantity == null)) failureReasons.push('quantity_unknown');
  if (evidenceCompleteness.basketDetected && !commercialConfirmation.summaryPresented) failureReasons.push('final_summary_missing');
  if (evidenceCompleteness.basketDetected && !commercialConfirmation.announcedTotalPresent) failureReasons.push('announced_total_missing');
  if (
    evidenceCompleteness.basketDetected &&
    !commercialConfirmation.customerConfirmed &&
    commercialConfirmation.currentState !== 'unknown' &&
    commercialConfirmation.currentState !== 'rejected'
  ) {
    failureReasons.push('customer_confirmation_uncertain');
  }
  if (commercialConfirmation.currentState === 'commercial_confirmation_complete' && invoiceCandidates.length === 0) {
    failureReasons.push('invoice_candidate_missing');
  }
  if (rawAttribution.contradictions.includes('ambiguous_multiple_candidates')) failureReasons.push('invoice_candidates_ambiguous');
  if (rawAttribution.hasAttributedInvoice && !basketInvoiceMatch.itemEvidenceReady) failureReasons.push('invoice_items_unavailable');
  if (commercialConfirmation.staffConfirmed && (input.knownStaffIds ?? []).length === 0) failureReasons.push('staff_identity_unresolved');
  if (!conversationCase.endedAt) failureReasons.push('conversation_timestamp_quality_issue');

  // A genuinely information-only conversation (Phase B's own classification, confirmed by no real
  // basket ever having been detected) is a valid, COMPLETE pipeline output — never forced into a
  // commercial case. Phase F's protocol/integrity findings describe adherence to the 4-step SALES
  // protocol; running them over an interaction that was never a sales interaction at all produces
  // real but MEANINGLESS "protocol incomplete" noise (e.g. "no final total" on a bare "thanks"
  // exchange) — found via this module's own dry-run. Every intermediate engine result is still
  // preserved on the returned analysis (never skipped), but that noise must not drive this specific
  // case's pipeline-level review flag or status.
  const isGenuinelyInformationOnly = conversationCase.caseType === 'information_only' && !evidenceCompleteness.basketDetected;

  const rawNeedsHumanReview =
    conversationCase.needsHumanReview ||
    commercialConfirmation.needsHumanReview ||
    rawAttribution.needsHumanReview ||
    basketInvoiceMatch.needsHumanReview ||
    (!isGenuinelyInformationOnly && integrityAssessment.needsHumanReview) ||
    activeBasketResolution.outcome === 'needs_human_review';

  const rawHumanReviewReasons = Array.from(
    new Set([
      ...conversationCase.humanReviewReasons,
      ...commercialConfirmation.humanReviewReasons,
      ...rawAttribution.humanReviewReasons,
      ...basketInvoiceMatch.humanReviewReasons,
      ...(isGenuinelyInformationOnly ? [] : integrityAssessment.humanReviewReasons),
      ...(activeBasketResolution.outcome === 'needs_human_review' ? ['active_basket_conflict'] : []),
    ])
  );

  const derivedSaleProof = deriveSaleProofState({
    attribution: rawAttribution,
    basketInvoiceMatch,
    integrityAssessment,
  });
  // Customer identity gate: identity !== resolved -> no Sale Proof, no official attribution.
  // Missing/ambiguous identity is absence of evidence (capped at strongly_supported); a
  // contradicted identity is a real contradiction.
  const identityStatus = input.customerIdentityStatus;
  const identityBlocked = identityStatus !== undefined && identityStatus !== 'resolved';
  const identityReason = `customer_identity_${identityStatus}`;
  const attribution = identityBlocked
    ? {
        ...rawAttribution,
        isOfficialForStaffEvaluation: false,
        humanReviewReasons: Array.from(new Set([...rawAttribution.humanReviewReasons, identityReason])),
      }
    : rawAttribution;
  const saleProof =
    identityBlocked && derivedSaleProof.state === 'proven'
      ? {
          ...derivedSaleProof,
          state: identityStatus === 'contradicted' ? ('contradicted' as const) : ('strongly_supported' as const),
          trustedInvoiceId: null,
          contradictions:
            identityStatus === 'contradicted'
              ? Array.from(new Set([...derivedSaleProof.contradictions, 'customer_identity_contradicted']))
              : derivedSaleProof.contradictions,
          ruleIds: Array.from(new Set([...derivedSaleProof.ruleIds, 'sale_proof.customer_identity_not_resolved'])),
          needsHumanReview: true,
        }
      : derivedSaleProof;
  // A clean proven invoice closes one very specific evidence gap: a media-bound request can have
  // no text-derived basket at all. "no_basket_state_for_case" must remain visible in the raw
  // commercial-confirmation evidence, but it is not a reason for a human task once the exact
  // transaction itself is proven by a trusted invoice.
  const reviewReasonsResolvedByProvenInvoice = new Set(['no_basket_state_for_case']);
  let humanReviewReasons = saleProof.state === 'proven'
    ? rawHumanReviewReasons.filter((reason) => !reviewReasonsResolvedByProvenInvoice.has(reason))
    : [...rawHumanReviewReasons];
  if (identityBlocked && !humanReviewReasons.includes(identityReason)) humanReviewReasons.push(identityReason);

  const unexplainedBooleanReviewFlag = rawNeedsHumanReview && rawHumanReviewReasons.length === 0;
  let needsHumanReview = humanReviewReasons.length > 0 || unexplainedBooleanReviewFlag;
  if (identityBlocked) needsHumanReview = true;

  const salesOutcome = deriveCanonicalSalesOutcome({
    caseId: conversationCase.caseId,
    caseType: conversationCase.caseType,
    commercialConfirmation,
    saleProof,
    hasMeaningfulBasketItems,
    needsHumanReview,
  });
  const journeyState = deriveCommercialJourneyState({
    caseId: conversationCase.caseId,
    messages: scopedMessages,
    customerNeed,
    commercialConfirmation,
    salesOutcome,
  });
  const lostOpportunity = deriveLostOpportunity({
    caseId: conversationCase.caseId,
    messages: scopedMessages,
    customerNeed,
    unavailableDemand,
    commercialConfirmation,
    journeyState,
    salesOutcome,
  });
  const followUp = deriveFollowUpOpportunities({
    conversationCase,
    messages: scopedMessages,
    customerNeed,
    unavailableDemand,
    lostOpportunity,
    salesOutcome,
    customerIdentityStatus: input.customerIdentityStatus,
    staffIdBySender: input.staffIdBySender,
  });

  let status: PipelineStatus;
  if (isGenuinelyInformationOnly) {
    status = 'analyzed';
  } else if (needsHumanReview) {
    status = 'needs_human_review';
  } else if (evidenceCompleteness.overallEvidenceLevel === 'insufficient') {
    status = 'insufficient_data';
  } else if (evidenceCompleteness.overallEvidenceLevel === 'low' || evidenceCompleteness.overallEvidenceLevel === 'medium') {
    status = 'partial';
  } else {
    status = 'analyzed';
  }

  const analysis = {
    caseId: conversationCase.caseId,
    conversationId: input.conversationId,
    conversationCase,
    customerNeed,
    unavailableDemand,
    basketHistory: baskets,
    itemsByBasketId,
    activeBasket,
    commercialConfirmation,
    protocolAssessment,
    historicalClosure,
    invoiceCandidateIds: invoiceCandidates.map(invoiceRowLookupId),
    attribution,
    basketInvoiceMatch,
    integrityAssessment,
    salesOutcome,
    journeyState,
    lostOpportunity,
    followUp,
    evidenceCompleteness,
    status,
    pipelineWarnings,
    needsHumanReview,
    humanReviewReasons,
    failureReasons,
  };
  return {
    ...analysis,
    caseIntelligence: buildCaseIntelligenceView(analysis, {
      messages: scopedMessages,
      interaction,
      customerIdentityStatus: input.customerIdentityStatus,
      staffIdBySender: input.staffIdBySender,
    }),
  };
}

export interface SegmentedCase {
  conversationCase: ConversationCase;
  scopedMessages: NormalizedConversationMessageV32[];
  /** The V32 interaction this case reads (segmentation owner) — carried for the read model only. */
  interaction: ConversationInteractionV32 | null;
}

export interface DeriveSegmentedCasesInput {
  conversationId: string;
  rawWhatsAppExportText: string;
  /** Trusted source date for time-only markdown; no fallback to created_at. */
  trustedConversationStartedAt?: string | null;
  sourceCaseIdV22?: string | null;
  customerIdHint?: string | null;
  customerPhoneHint?: string | null;
  branchIdHint?: string | null;
  branchNameRawHint?: string | null;
  sessionSplitGapMinutes?: number;
  /**
   * Senders the staff identity owner already knows are pharmacy staff (e.g. the keys of
   * staffIdBySender). Lets V32 treat named staff in group exports as staff instead of relying on
   * the parser's single-outbound-sender heuristic.
   */
  knownStaffSenders?: string[];
}

export interface DeriveSegmentedCasesResult {
  sessionsProcessed: number;
  cases: SegmentedCase[];
  pipelineWarnings: string[];
}

/**
 * Phase B segmentation only (parse -> split sessions -> deriveConversationCases), shared by
 * runSalesIntelligencePipeline() below AND by deriveCasesOnly() (H.1B addition — see that
 * function's own comment for why the batch service needs this split out). Extracted so there is
 * exactly ONE place the `:session:N` caseId-uniqueness fix (see the inline comment below) is
 * applied — duplicating it into a second call site would risk the two ever drifting apart and
 * silently producing mismatched caseIds between a batch service's pre-pass and its real pipeline
 * run. Still fully pure — no Supabase, no I/O (Phases B-G remain pure, H.1B instruction #3).
 */
export function deriveSegmentedCases(input: DeriveSegmentedCasesInput): DeriveSegmentedCasesResult {
  const pipelineWarnings: string[] = [];
  const cases: SegmentedCase[] = [];

  const parsedMessages = parseWhatsAppExport(input.rawWhatsAppExportText, {
    trustedConversationStartedAt: input.trustedConversationStartedAt ?? null,
  });
  if (parsedMessages.length === 0) {
    pipelineWarnings.push('raw_text_produced_no_parsed_messages');
    return { sessionsProcessed: 0, cases: [], pipelineWarnings };
  }

  // Keep the historical 120-minute transport partition ONLY as a stable case-id envelope.
  // Analytical interaction boundaries are now owned exclusively by V32 over the whole source,
  // so a delayed reply / delivery follow-up can cross a coarse transport boundary without
  // becoming a fake second commercial case.
  const coarseSessions = splitWhatsAppSessions(parsedMessages, input.sessionSplitGapMinutes ?? 120);
  if (coarseSessions.length === 0) {
    pipelineWarnings.push('no_sessions_derived_from_raw_text');
    return { sessionsProcessed: 0, cases: [], pipelineWarnings };
  }

  const semanticSession = splitWhatsAppSessions(parsedMessages, Number.MAX_SAFE_INTEGER)[0];
  if (!semanticSession) {
    pipelineWarnings.push('no_semantic_session_derived_from_raw_text');
    return { sessionsProcessed: coarseSessions.length, cases: [], pipelineWarnings };
  }

  if (input.knownStaffSenders?.length) {
    semanticSession.outboundStaffNames = Array.from(
      new Set([...(semanticSession.outboundStaffNames || []), ...input.knownStaffSenders])
    );
  }
  const understanding = buildConversationUnderstandingV32(semanticSession);
  const rawCases = deriveConversationCases({
    understanding,
    conversationId: input.conversationId,
    sourceCaseIdV22: input.sourceCaseIdV22 ?? null,
    customerIdHint: input.customerIdHint ?? null,
    customerPhoneHint: input.customerPhoneHint ?? null,
    branchIdHint: input.branchIdHint ?? null,
    branchNameRawHint: input.branchNameRawHint ?? null,
  });

  const coarseSessionIndexByMessageId = new Map<string, number>();
  coarseSessions.forEach((session, sessionIndex) => {
    session.messages.forEach((message) => coarseSessionIndexByMessageId.set(message.id, sessionIndex));
  });
  const localInteractionCountBySession = new Map<number, number>();
  let crossedCoarseBoundary = false;

  understanding.interactions.forEach((interaction, index) => {
    const rawCase = rawCases[index];
    const coarseSessionIndexes = Array.from(
      new Set(
        interaction.messageIds
          .map((messageId) => coarseSessionIndexByMessageId.get(messageId))
          .filter((value): value is number => typeof value === 'number')
      )
    ).sort((a, b) => a - b);
    const anchorSessionIndex = coarseSessionIndexes[0] ?? 0;
    const localInteractionIndex = localInteractionCountBySession.get(anchorSessionIndex) ?? 0;
    localInteractionCountBySession.set(anchorSessionIndex, localInteractionIndex + 1);
    if (coarseSessionIndexes.length > 1) crossedCoarseBoundary = true;

    // Preserve the historical session-qualified case-id shape whenever the source used to have
    // multiple coarse sessions. Unchanged boundaries therefore keep the same ids, while a true
    // semantic continuation simply consumes the later coarse fragment instead of inventing a
    // duplicate case.
    const conversationCase =
      coarseSessions.length > 1
        ? {
            ...rawCase,
            caseId: `${input.conversationId}:interaction:${localInteractionIndex}:session:${anchorSessionIndex}`,
          }
        : rawCase;
    const scopedMessages = messagesForMessageIds(understanding, interaction.messageIds);
    cases.push({ conversationCase, scopedMessages, interaction });
  });

  if (crossedCoarseBoundary) {
    pipelineWarnings.push('semantic_interaction_crossed_coarse_session_boundary');
  }

  return { sessionsProcessed: coarseSessions.length, cases, pipelineWarnings };
}
export type SalesIntelligenceSegmentationSource = Pick<
  SalesIntelligencePipelineInput,
  | 'conversationId'
  | 'rawWhatsAppExportText'
  | 'trustedConversationStartedAt'
  | 'sourceCaseIdV22'
  | 'customerIdHint'
  | 'customerPhoneHint'
  | 'branchIdHint'
  | 'branchNameRawHint'
  | 'sessionSplitGapMinutes'
  | 'staffIdBySender'
>;

/**
 * The ONE projection from a pipeline input to its segmentation input. runSalesIntelligencePipeline
 * uses it, and every pre-pass (deriveCasesOnly) must use it on the same pipeline input, so the
 * staff senders / identity hints that shape V32 interaction boundaries — and therefore caseIds —
 * can never differ between a pre-pass and the real run.
 */
export function segmentationInputFromPipelineInput(
  input: SalesIntelligenceSegmentationSource
): DeriveSegmentedCasesInput {
  return {
    conversationId: input.conversationId,
    rawWhatsAppExportText: input.rawWhatsAppExportText,
    trustedConversationStartedAt: input.trustedConversationStartedAt ?? null,
    sourceCaseIdV22: input.sourceCaseIdV22 ?? null,
    customerIdHint: input.customerIdHint ?? null,
    customerPhoneHint: input.customerPhoneHint ?? null,
    branchIdHint: input.branchIdHint ?? null,
    branchNameRawHint: input.branchNameRawHint ?? null,
    sessionSplitGapMinutes: input.sessionSplitGapMinutes,
    knownStaffSenders: Object.keys(input.staffIdBySender ?? {}),
  };
}

/**
 * H.1B addition: segmentation-only output (ConversationCase[], no basket/attribution/matching/
 * integrity) for the customer-grouped batch service's pre-pass — it needs each case's own
 * customerId/branchNameRaw/startedAt/endedAt to group conversations by canonical customer and
 * compute a bounded per-group time window BEFORE fetching any invoice candidates (H.1B instruction
 * #12: "fetch candidate invoices ONCE per customer/time-window group"), which is only possible once
 * segmentation has already run. Reuses deriveSegmentedCases() (same function
 * runSalesIntelligencePipeline() itself calls), so the caseIds this produces are GUARANTEED
 * identical to what the real pipeline run will later produce for the same input — never a
 * re-implementation that could drift.
 */
export function deriveCasesOnly(input: DeriveSegmentedCasesInput): {
  sessionsProcessed: number;
  cases: ConversationCase[];
  pipelineWarnings: string[];
} {
  const result = deriveSegmentedCases(input);
  return {
    sessionsProcessed: result.sessionsProcessed,
    cases: result.cases.map((c) => c.conversationCase),
    pipelineWarnings: result.pipelineWarnings,
  };
}

/**
 * Runs the full B-F pipeline over one raw WhatsApp export/thread, producing one
 * SalesIntelligenceCaseAnalysis per ConversationCase derived from it (a single thread can contain
 * more than one independent commercial case, and a raw text with a large time gap can itself
 * split into more than one session — see splitWhatsAppSessions()). Never forces every conversation
 * into a commercial case: an information-only conversation is a complete, valid, non-error output.
 */
export function runSalesIntelligencePipeline(input: SalesIntelligencePipelineInput): SalesIntelligencePipelineResult {
  const segmented = deriveSegmentedCases(segmentationInputFromPipelineInput(input));
  const caseAnalyses = segmented.cases.map(({ conversationCase, scopedMessages, interaction }) =>
    analyzeOneCase(conversationCase, scopedMessages, input, interaction)
  );

  return {
    conversationId: input.conversationId,
    sessionsProcessed: segmented.sessionsProcessed,
    caseAnalyses,
    pipelineWarnings: segmented.pipelineWarnings,
  };
}
