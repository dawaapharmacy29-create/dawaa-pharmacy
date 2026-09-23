// Sales Intelligence QA — Sale Proof State projection from PERSISTED rows.
//
// READ ONLY, and a PURE data-marshalling layer — it maps already-persisted
// sales_intelligence_attributions / sales_intelligence_basket_invoice_matches /
// sales_intelligence_case_analyses rows into the exact typed inputs deriveSalesIntegrityAssessment()
// (Phase F, salesIntegrityEngine.ts) and deriveSaleProofState() (I.C.2, saleProofState.ts) already
// expect, then calls those REAL functions unchanged. This file NEVER reimplements any Sale Proof /
// integrity decision rule — see Final Pilot Readiness instructions: "ممنوع duplication لمنطق Sale
// Proof". Every `if` below is either a null-safety default or one of the two documented, logically
// EXACT reconstructions below — never a guess at what the real engine would have decided.
//
// Two narrow, exact reconstructions (both provably equivalent to what saleAttributionEngine.ts
// itself already guarantees, never an approximation):
//   - selectedCandidate.directInvoiceLink := (attribution_level === 'proven'). Exact by
//     deriveSaleAttributionAssessment's own construction: `directInvoiceLink` is the ONLY path to
//     `proven` (see saleAttributionEngine.ts's own `const level = directInvoiceLink ? 'proven' : ...`).
//   - selectedCandidate.branchMatch := branch_conflict ? 'mismatch' : 'unknown'. deriveSaleProofState()
//     only ever checks for the literal 'mismatch' value; collapsing the other three real BranchMatchKind
//     values (exact_canonical/normalized_alias_match/unknown) into 'unknown' here is exact for every
//     check that actually runs against it today.
//
// One acknowledged, narrow gap (documented, never hidden): selectedCandidate.disqualifiers is not
// persisted anywhere, so the rare "temporal inversion on an otherwise-trusted candidate" contradiction
// category can only ever be detected via a live pipeline re-run, never from this persisted projection
// alone. Every OTHER contradiction category deriveSaleProofState() defines is reconstructed exactly.
//
// commercialConfirmation/protocolAssessment below are intentionally minimal placeholders — by
// inspection, NONE of detectAttributionExceptions/detectHeaderExceptions/detectItemExceptions in
// salesIntegrityEngine.ts (the only three sub-detectors that can ever produce an exception type
// deriveSaleProofState() reads) consult commercialConfirmation or protocolAssessment at all. Any
// OTHER exception type these placeholders might spuriously produce (e.g. confirmation_protocol_
// incomplete, which DOES depend on them) is never in deriveSaleProofState()'s own contradiction
// sets, so it is silently and correctly ignored downstream — never surfaced as a false contradiction.
import { deriveSalesIntegrityAssessment } from '../salesIntegrityEngine';
import { deriveSaleProofState, type SaleProofAssessment } from '../saleProofState';
import type {
  BasketInvoiceMatch,
  CommercialConfirmationAssessment,
  CommercialConfirmationState,
  ConfidenceAssessment,
  ConfidenceLevel,
  OrderConfirmationProtocolAssessment,
  SaleAttributionAssessment,
  SaleAttributionCandidate,
} from '../types';

const EMPTY_CONFIDENCE: ConfidenceAssessment = { level: 'unknown', score: 0, ruleIds: [], evidence: [] };

function placeholderCommercialConfirmation(caseId: string, currentState: string | null): CommercialConfirmationAssessment {
  return {
    caseId,
    basketId: '',
    basketVersion: 1,
    summaryPresented: false,
    customerConfirmed: false,
    staffConfirmed: false,
    announcedTotalPresent: false,
    modificationAfterConfirmation: false,
    currentState: (currentState ?? 'unknown') as CommercialConfirmationState,
    primaryMessageIds: [],
    ruleIds: [],
    confidence: EMPTY_CONFIDENCE,
    needsHumanReview: false,
    humanReviewReasons: [],
  };
}

function placeholderProtocolAssessment(): OrderConfirmationProtocolAssessment {
  return {
    caseId: '',
    basketId: '',
    basketVersion: 1,
    summaryCompliant: false,
    announcedTotalCompliant: false,
    customerConfirmationCompliant: false,
    staffFinalConfirmationCompliant: false,
    protocolCompliant: false,
    missingProtocolSteps: [],
  };
}

/** Pure — no I/O. See module header for the exact reconstruction rules. */
export function projectSaleAttributionFromPersistedRow(
  attributionRow: Record<string, any> | null,
  fallbackCaseId: string
): SaleAttributionAssessment {
  if (!attributionRow) {
    return {
      caseId: fallbackCaseId,
      commercialConfirmationState: 'unknown',
      candidateCount: 0,
      selectedInvoiceId: null,
      selectedInvoiceNumber: null,
      selectedCandidate: null,
      alternativeCandidates: [],
      attributionLevel: 'unknown',
      confidence: EMPTY_CONFIDENCE,
      primaryEvidence: [],
      contradictions: [],
      needsHumanReview: false,
      humanReviewReasons: [],
      isOfficialForStaffEvaluation: false,
      legacyEvidenceUsed: false,
      ruleIds: [],
      hasAttributedInvoice: false,
      competingCaseIds: [],
    };
  }

  const attributionLevel = (attributionRow.attribution_level ?? 'unknown') as ConfidenceLevel;
  const isProven = attributionLevel === 'proven';
  const candidate: SaleAttributionCandidate | null = attributionRow.selected_invoice_id
    ? {
        caseId: fallbackCaseId,
        invoiceId: attributionRow.selected_invoice_id,
        invoiceNumber: attributionRow.selected_invoice_number ?? null,
        customerIdMatch: false,
        phoneMatch: false,
        identityConflict: attributionRow.identity_conflict ?? 'none',
        branchMatch: attributionRow.branch_conflict ? 'mismatch' : 'unknown',
        timeDistanceMinutes: null,
        timeMatchStrength: 'unknown',
        staffMatch: 'unknown',
        announcedTotalMatch: 'not_available',
        basketValueMatch: 'not_available',
        productMatch: 'unavailable',
        quantityMatch: 'unavailable',
        legacyEvidenceMatch: Boolean(attributionRow.legacy_evidence_used),
        directOrderLink: false,
        directInvoiceLink: isProven,
        evidence: [],
        ruleIds: attributionRow.rule_ids ?? [],
        confidenceAssessment: { level: attributionLevel, score: Number(attributionRow.confidence_score ?? 0), ruleIds: [], evidence: [] },
        disqualifiers: [],
      }
    : null;

  return {
    caseId: fallbackCaseId,
    commercialConfirmationState: 'unknown',
    candidateCount: attributionRow.candidate_count ?? 0,
    selectedInvoiceId: attributionRow.selected_invoice_id ?? null,
    selectedInvoiceNumber: attributionRow.selected_invoice_number ?? null,
    selectedCandidate: candidate,
    alternativeCandidates: [],
    attributionLevel,
    confidence: {
      level: attributionLevel,
      score: Number(attributionRow.confidence_score ?? 0),
      ruleIds: attributionRow.rule_ids ?? [],
      evidence: [],
    },
    primaryEvidence: attributionRow.primary_evidence ?? [],
    contradictions: attributionRow.contradictions ?? [],
    needsHumanReview: false,
    humanReviewReasons: [],
    isOfficialForStaffEvaluation: Boolean(attributionRow.is_official_for_staff_evaluation),
    legacyEvidenceUsed: Boolean(attributionRow.legacy_evidence_used),
    ruleIds: attributionRow.rule_ids ?? [],
    hasAttributedInvoice: attributionLevel === 'proven' || attributionLevel === 'strongly_inferred',
    competingCaseIds: attributionRow.competing_case_ids ?? [],
  };
}

/** Pure — no I/O. */
export function projectBasketInvoiceMatchFromPersistedRow(
  matchRow: Record<string, any> | null,
  fallbackCaseId: string
): BasketInvoiceMatch {
  if (!matchRow) {
    return {
      matchId: `${fallbackCaseId}:no-match`,
      caseId: fallbackCaseId,
      basketId: null,
      basketVersion: null,
      invoiceId: null,
      invoiceNumber: null,
      totalMatch: 'insufficient_data',
      itemMatch: 'insufficient_data',
      quantityMatch: 'insufficient_data',
      overallMatch: 'insufficient_data',
      headerEvidenceReady: false,
      itemEvidenceReady: false,
      integrityEvaluationScope: 'insufficient',
      differences: [],
      confidence: EMPTY_CONFIDENCE,
      needsHumanReview: false,
      humanReviewReasons: [],
      ruleIds: [],
    };
  }
  return {
    matchId: matchRow.id ?? `${fallbackCaseId}:match`,
    caseId: fallbackCaseId,
    basketId: matchRow.basket_id ?? null,
    basketVersion: matchRow.basket_version ?? null,
    invoiceId: matchRow.invoice_id ?? null,
    invoiceNumber: matchRow.invoice_number ?? null,
    totalMatch: matchRow.total_match ?? 'insufficient_data',
    itemMatch: matchRow.item_match ?? 'insufficient_data',
    quantityMatch: matchRow.quantity_match ?? 'insufficient_data',
    overallMatch: matchRow.overall_match ?? 'insufficient_data',
    headerEvidenceReady: Boolean(matchRow.header_evidence_ready),
    itemEvidenceReady: Boolean(matchRow.item_evidence_ready),
    integrityEvaluationScope: matchRow.integrity_evaluation_scope ?? 'insufficient',
    differences: matchRow.differences ?? [],
    confidence: EMPTY_CONFIDENCE,
    needsHumanReview: Boolean(matchRow.needs_human_review),
    humanReviewReasons: matchRow.human_review_reasons ?? [],
    ruleIds: [],
  };
}

/**
 * The single entry point QA pages call. Read-only; reuses deriveSalesIntegrityAssessment() and
 * deriveSaleProofState() completely unchanged — see module header for why the placeholder
 * commercialConfirmation/protocolAssessment inputs never affect the result.
 */
export function deriveSaleProofStateFromPersisted(
  caseId: string,
  analysisRow: Record<string, any> | null,
  attributionRow: Record<string, any> | null,
  matchRow: Record<string, any> | null
): SaleProofAssessment {
  const attribution = projectSaleAttributionFromPersistedRow(attributionRow, caseId);
  const basketInvoiceMatch = projectBasketInvoiceMatchFromPersistedRow(matchRow, caseId);
  const integrityAssessment = deriveSalesIntegrityAssessment({
    caseId,
    commercialConfirmation: placeholderCommercialConfirmation(caseId, analysisRow?.commercial_confirmation_state ?? null),
    protocolAssessment: placeholderProtocolAssessment(),
    attribution,
    basketInvoiceMatch,
  });
  return deriveSaleProofState({ attribution, basketInvoiceMatch, integrityAssessment });
}
