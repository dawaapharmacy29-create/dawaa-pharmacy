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
  sourceCaseIdV22?: string | null;
  customerIdHint?: string | null;
  customerPhoneHint?: string | null;
  branchIdHint?: string | null;
  branchNameRawHint?: string | null;
  /** Known contributing staff ids for this conversation (Phase B StaffContribution.staffId) — conservative, may be empty. */
  knownStaffIds?: string[];
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
  documentedAdjustments?: DocumentedAdjustment[];
  invoiceCancelledOrReturned?: boolean;
  /** Caller-CONFIRMED only — never inferred here from ambiguous free-text status columns (mirrors Phase F's own field). */
  invoiceStatusHint?: 'cancelled' | 'returned' | null;
  competingSelections?: Array<{ caseId: string; invoiceId: string }>;
  /** Passed through to splitWhatsAppSessions() — defaults to its own default (120 minutes). */
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
// core ratio: both are known to be universally unavailable in production today (Phase E/F
// precedent — sales_invoice_items_v21 has 0 rows, no fulfillment source exists), so including them
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

function analyzeOneCase(
  conversationCase: ConversationCase,
  scopedMessages: NormalizedConversationMessageV32[],
  input: SalesIntelligencePipelineInput
): SalesIntelligenceCaseAnalysis {
  const pipelineWarnings: string[] = [];

  const { baskets, itemsByBasketId, summaryEvents, customerConfirmationEvents, staffFinalConfirmationEvents } =
    buildCaseBaskets(conversationCase.caseId, scopedMessages);

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

  const applicability = deriveOrderConfirmationProtocolApplicability({
    caseType: conversationCase.caseType,
    commercial: commercialConfirmation,
    hasMeaningfulBasketItems,
  });
  const protocolAssessment = { ...assessOrderConfirmationProtocol(commercialConfirmation), applicability };

  const activeItems = activeBasket ? (itemsByBasketId[activeBasket.basketId] ?? []) : [];
  const activeBasketValue = computeActiveBasketValue(activeItems);

  const historicalClosure = deriveHistoricalCommercialClosureAssessment(
    conversationCase.caseId,
    scopedMessages,
    commercialConfirmation,
    activeItems,
    activeBasket?.announcedTotal != null
  );

  // CRITICAL (Phase G instruction #2): the candidate-retrieval context uses THIS CASE's own
  // segmented startedAt/endedAt — never conversation-level (whatsapp_review_sources) timestamps.
  const candidateContext: InvoiceCandidateQueryContext = {
    caseId: conversationCase.caseId,
    customerId: conversationCase.customerId,
    customerPhone: conversationCase.customerPhone,
    branchNameRaw: conversationCase.branchNameRaw,
    caseStartedAt: conversationCase.startedAt,
    caseEndedAt: conversationCase.endedAt,
  };
  const invoiceCandidates = input.resolveInvoiceCandidates(candidateContext);

  const attributionCtx: CaseAttributionContext = {
    caseId: conversationCase.caseId,
    customerId: conversationCase.customerId,
    customerPhone: conversationCase.customerPhone,
    branchNameRaw: conversationCase.branchNameRaw,
    // Same rule as candidateContext above — the case's own segmented endedAt, never the coarse
    // whole-thread conversation_ended_at.
    caseEndedAt: conversationCase.endedAt,
    commercialConfirmation,
    activeAnnouncedTotal: activeBasket?.announcedTotal ?? null,
    activeBasketValue,
    activeBasketItems: activeItems.map((item) => ({ productNameRaw: item.productNameRaw, quantity: item.quantity })),
    knownStaffIds: input.knownStaffIds ?? [],
    legacyMatchedInvoiceId: input.legacyMatchedInvoiceId ?? null,
    legacyMatchedInvoiceNumber: input.legacyMatchedInvoiceNumber ?? null,
    trustedInvoiceId: input.trustedInvoiceId ?? null,
    trustedInvoiceNumber: input.trustedInvoiceNumber ?? null,
  };

  const itemEvidenceProvider = input.itemEvidenceProvider ?? unavailableInvoiceItemEvidenceProvider;
  const attribution = deriveSaleAttributionAssessment(
    attributionCtx,
    invoiceCandidates,
    itemEvidenceProvider,
    input.competingSelections ?? []
  );

  const invoiceRow = attribution.selectedInvoiceId
    ? (invoiceCandidates.find((row) => invoiceRowLookupId(row) === attribution.selectedInvoiceId) ?? null)
    : null;
  if (attribution.selectedInvoiceId && !invoiceRow) {
    pipelineWarnings.push('selected_invoice_row_not_found_in_candidate_pool');
  }

  const basketInvoiceMatch = deriveBasketInvoiceMatch({
    caseId: conversationCase.caseId,
    baskets,
    itemsByBasketId,
    attribution,
    invoiceRow,
    itemEvidenceProvider,
    documentedAdjustments: input.documentedAdjustments,
    invoiceCancelledOrReturned: input.invoiceCancelledOrReturned,
  });

  const integrityAssessment = deriveSalesIntegrityAssessment({
    caseId: conversationCase.caseId,
    commercialConfirmation,
    protocolAssessment,
    attribution,
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
    invoiceAttributed: attribution.hasAttributedInvoice,
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
  if (activeItems.some((item) => item.resolutionStatus === 'unknown' || item.resolutionStatus === 'contradicted')) {
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
  if (attribution.contradictions.includes('ambiguous_multiple_candidates')) failureReasons.push('invoice_candidates_ambiguous');
  if (attribution.hasAttributedInvoice && !basketInvoiceMatch.itemEvidenceReady) failureReasons.push('invoice_items_unavailable');
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

  const needsHumanReview =
    conversationCase.needsHumanReview ||
    commercialConfirmation.needsHumanReview ||
    attribution.needsHumanReview ||
    basketInvoiceMatch.needsHumanReview ||
    (!isGenuinelyInformationOnly && integrityAssessment.needsHumanReview) ||
    activeBasketResolution.outcome === 'needs_human_review';

  const humanReviewReasons = Array.from(
    new Set([
      ...conversationCase.humanReviewReasons,
      ...commercialConfirmation.humanReviewReasons,
      ...attribution.humanReviewReasons,
      ...basketInvoiceMatch.humanReviewReasons,
      ...(isGenuinelyInformationOnly ? [] : integrityAssessment.humanReviewReasons),
      ...(activeBasketResolution.outcome === 'needs_human_review' ? ['active_basket_conflict'] : []),
    ])
  );

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

  return {
    caseId: conversationCase.caseId,
    conversationId: input.conversationId,
    conversationCase,
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
    evidenceCompleteness,
    status,
    pipelineWarnings,
    needsHumanReview,
    humanReviewReasons,
    failureReasons,
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
  const pipelineWarnings: string[] = [];
  const caseAnalyses: SalesIntelligenceCaseAnalysis[] = [];

  const parsedMessages = parseWhatsAppExport(input.rawWhatsAppExportText);
  if (parsedMessages.length === 0) {
    pipelineWarnings.push('raw_text_produced_no_parsed_messages');
    return { conversationId: input.conversationId, sessionsProcessed: 0, caseAnalyses: [], pipelineWarnings };
  }

  const sessions = splitWhatsAppSessions(parsedMessages, input.sessionSplitGapMinutes ?? 120);
  if (sessions.length === 0) {
    pipelineWarnings.push('no_sessions_derived_from_raw_text');
    return { conversationId: input.conversationId, sessionsProcessed: 0, caseAnalyses: [], pipelineWarnings };
  }

  for (const session of sessions) {
    const understanding = buildConversationUnderstandingV32(session);
    const cases = deriveConversationCases({
      understanding,
      conversationId: input.conversationId,
      sourceCaseIdV22: input.sourceCaseIdV22 ?? null,
      customerIdHint: input.customerIdHint ?? null,
      customerPhoneHint: input.customerPhoneHint ?? null,
      branchIdHint: input.branchIdHint ?? null,
      branchNameRawHint: input.branchNameRawHint ?? null,
    });

    // deriveConversationCases() maps 1:1, in order, over understanding.interactions — see its own
    // implementation in conversationCaseEngine.ts. Zipping by index is exact, never a re-parse of
    // the caseId string.
    understanding.interactions.forEach((interaction, index) => {
      const conversationCase = cases[index];
      const scopedMessages = messagesForMessageIds(understanding, interaction.messageIds);
      caseAnalyses.push(analyzeOneCase(conversationCase, scopedMessages, input));
    });
  }

  return {
    conversationId: input.conversationId,
    sessionsProcessed: sessions.length,
    caseAnalyses,
    pipelineWarnings,
  };
}
