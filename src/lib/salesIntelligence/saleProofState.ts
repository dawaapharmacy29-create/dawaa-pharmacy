// Phase I.C.2 — Canonical Sale Proof State.
//
// Projection-only layer over Phase D attribution. It does NOT rescore invoice candidates,
// re-parse conversations, or infer item evidence. Core invariant:
//   a conversation can support a sale, but only trusted canonical invoice evidence can PROVE it.
// Statistical attribution is therefore capped below `proven`.
import type {
  AttributionEvidenceItem,
  ConfidenceAssessment,
  SaleAttributionAssessment,
} from './types';

export type SaleProofState =
  | 'proven'
  | 'strongly_supported'
  | 'weakly_supported'
  | 'unknown'
  | 'contradicted';

export type InvoiceEvidenceScope = 'header_only' | 'header_and_items';

export type SaleProofSource =
  | 'trusted_invoice'
  | 'statistical_invoice_attribution'
  | 'insufficient_invoice_evidence'
  | 'conflicting_invoice_evidence';

export interface SaleProofStateInput {
  attribution: SaleAttributionAssessment;
  /**
   * Canonical sales_invoices.id emitted by I.C.1's trusted-evidence contract.
   * Never pass invoice_number here: it is not globally unique across branches.
   */
  trustedInvoiceId?: string | null;
  /**
   * Optional caller-supplied trusted status fact. Production currently has no canonical
   * source for this; leaving it null must never be interpreted as a clean/active invoice.
   */
  invoiceStatusHint?: 'cancelled' | 'returned' | null;
}

export interface SaleProofAssessment {
  caseId: string;
  state: SaleProofState;
  proofSource: SaleProofSource;
  trustedInvoiceId: string | null;
  selectedInvoiceId: string | null;
  selectedInvoiceNumber: string | null;
  confidence: ConfidenceAssessment;
  attributionEvidence: AttributionEvidenceItem[];
  contradictions: string[];
  ruleIds: string[];
  invoiceEvidenceScope: InvoiceEvidenceScope;
  itemEvidenceReady: boolean;
  quantityEvidenceReady: boolean;
  needsHumanReview: boolean;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function hasHardConflict(input: SaleProofStateInput): string[] {
  const { attribution, invoiceStatusHint } = input;
  const candidate = attribution.selectedCandidate;
  const conflicts: string[] = [];

  if (
    attribution.contradictions.includes('identity_conflict') ||
    candidate?.identityConflict === 'phone_vs_customer_id_conflict'
  ) {
    conflicts.push('customer_identity_conflict');
  }

  if (attribution.contradictions.includes('competing_case_attribution') || attribution.competingCaseIds.length > 0) {
    conflicts.push('competing_case_attribution');
  }

  if (invoiceStatusHint === 'cancelled') conflicts.push('invoice_cancelled');
  if (invoiceStatusHint === 'returned') conflicts.push('invoice_returned');

  return unique(conflicts);
}

function trustedIdFrom(input: SaleProofStateInput): string | null {
  const candidate = input.attribution.selectedCandidate;
  const supplied = input.trustedInvoiceId ?? null;

  // I.C.1's canonical UUID/id is preferred. A Phase-D direct link is accepted only because
  // directInvoiceLink itself can only be produced from an upstream trustedInvoiceId.
  if (supplied && candidate?.directInvoiceLink && candidate.invoiceId === supplied) return supplied;
  if (!supplied && candidate?.directInvoiceLink) return candidate.invoiceId;
  return null;
}

export function deriveSaleProofState(input: SaleProofStateInput): SaleProofAssessment {
  const { attribution } = input;
  const candidate = attribution.selectedCandidate;
  const trustedInvoiceId = trustedIdFrom(input);
  const hardConflicts = hasHardConflict(input);
  const ambiguous =
    attribution.contradictions.includes('ambiguous_multiple_candidates') ||
    attribution.humanReviewReasons.includes('ambiguous_multiple_candidates');

  const itemEvidenceReady = Boolean(candidate && candidate.productMatch !== 'unavailable');
  const quantityEvidenceReady = Boolean(candidate && candidate.quantityMatch !== 'unavailable');
  const invoiceEvidenceScope: InvoiceEvidenceScope =
    itemEvidenceReady || quantityEvidenceReady ? 'header_and_items' : 'header_only';

  let state: SaleProofState;
  let proofSource: SaleProofSource;
  const ruleIds: string[] = [];

  if (hardConflicts.length > 0) {
    state = 'contradicted';
    proofSource = 'conflicting_invoice_evidence';
    ruleIds.push('sale_proof.contradicted.hard_evidence_conflict');
  } else if (trustedInvoiceId && candidate?.directInvoiceLink) {
    state = 'proven';
    proofSource = 'trusted_invoice';
    ruleIds.push('sale_proof.proven.trusted_canonical_invoice');
  } else if (!candidate || attribution.candidateCount === 0 || attribution.attributionLevel === 'unknown') {
    state = 'unknown';
    proofSource = 'insufficient_invoice_evidence';
    ruleIds.push('sale_proof.unknown.insufficient_invoice_evidence');
  } else if (attribution.attributionLevel === 'strongly_inferred' && !ambiguous) {
    state = 'strongly_supported';
    proofSource = 'statistical_invoice_attribution';
    ruleIds.push('sale_proof.strongly_supported.statistical_invoice_evidence');
  } else {
    state = 'weakly_supported';
    proofSource = 'statistical_invoice_attribution';
    ruleIds.push(
      ambiguous
        ? 'sale_proof.weakly_supported.ambiguous_invoice_candidates'
        : 'sale_proof.weakly_supported.partial_invoice_evidence'
    );
  }

  // Defensive invariant: nothing without a canonical trusted id may ever escape as proven,
  // even if an upstream object is malformed or a future refactor widens Phase D unexpectedly.
  if (state === 'proven' && !trustedInvoiceId) {
    state = 'unknown';
    proofSource = 'insufficient_invoice_evidence';
    ruleIds.push('sale_proof.guard.proven_requires_trusted_invoice_id');
  }

  const score =
    state === 'proven'
      ? 1
      : state === 'contradicted'
        ? Math.min(attribution.confidence.score, 0.49)
        : attribution.confidence.score;

  return {
    caseId: attribution.caseId,
    state,
    proofSource,
    trustedInvoiceId,
    selectedInvoiceId: attribution.selectedInvoiceId,
    selectedInvoiceNumber: attribution.selectedInvoiceNumber,
    confidence: {
      level:
        state === 'proven'
          ? 'proven'
          : state === 'strongly_supported'
            ? 'strongly_inferred'
            : state === 'weakly_supported' || state === 'contradicted'
              ? 'weakly_inferred'
              : 'unknown',
      score,
      ruleIds: unique([...attribution.confidence.ruleIds, ...ruleIds]),
      evidence: attribution.confidence.evidence,
    },
    attributionEvidence: attribution.primaryEvidence,
    contradictions: unique([...attribution.contradictions, ...hardConflicts]),
    ruleIds: unique([...attribution.ruleIds, ...ruleIds]),
    invoiceEvidenceScope,
    itemEvidenceReady,
    quantityEvidenceReady,
    needsHumanReview:
      attribution.needsHumanReview ||
      state === 'contradicted' ||
      (state === 'weakly_supported' && ambiguous),
  };
}
