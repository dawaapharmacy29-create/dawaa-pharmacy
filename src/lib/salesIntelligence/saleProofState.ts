// Phase I.C.2 — Canonical Sale Proof State.
//
// A SMALL projection/interpretation layer over Phase D (saleAttributionEngine.ts), Phase E/E.1
// (basketInvoiceMatchingEngine.ts) and Phase F (salesIntegrityEngine.ts) — this module NEVER
// re-runs attribution, matching, or integrity reasoning, and never re-derives a fact those engines
// already computed. It only INTERPRETS their already-computed output into one canonical,
// invoice-truth-centric vocabulary:
//
//   Invoice proves the transaction. Conversation does not prove the transaction. Statistical
//   matching does not equal a proven sale.
//
// See the I.C.0 audit and I.C.1 (trustedInvoiceEvidenceBridge.ts) for the full investigation this
// builds on: `attribution.attributionLevel === 'proven'` already means exactly
// `attribution.selectedCandidate.directInvoiceLink === true` (saleAttributionEngine.ts sets level
// unconditionally to 'proven' whenever directInvoiceLink holds) — which in turn only ever holds
// when I.C.1's resolveTrustedInvoiceEvidenceFromReviewSource() judged the link eligible. As of
// I.C.1, that is zero rows in Production today.
//
// WHY NOT a blind rename (e.g. `strongly_inferred -> strongly_supported` and done): a
// `strongly_inferred`/`proven` attribution level can still carry a REAL, already-detected evidence
// conflict (a cross-customer identity conflict, a competing case claiming the same invoice, an
// unexplained total gap, a real branch mismatch on the TRUSTED candidate itself) that
// saleAttributionEngine.ts surfaces only as a side-channel `contradictions`/`disqualifiers` entry
// without ever downgrading `attributionLevel` itself (a directInvoiceLink candidate is ALWAYS
// `proven`, even mid-contradiction — see deriveSaleAttributionAssessment's own `top` selection).
// This module is the first place that conflict is turned into an outright DIFFERENT state
// (`contradicted`) rather than silently riding along inside a `proven`/`strongly_inferred` label.
//
// Mapping rules (see deriveSaleProofState's own doc comment for the exact precedence):
//   proven              <=> attribution.selectedCandidate.directInvoiceLink === true AND no
//                           contradiction was found against that exact candidate.
//   contradicted        := a real, already-computed evidence conflict exists against the selected
//                           candidate — cross-customer identity, cross-case invoice collision, a
//                           cancelled/returned invoice hint, an unexplained total/item/quantity
//                           mismatch, OR (only when the candidate IS a trusted/directInvoiceLink
//                           one) a branch mismatch or a temporal inversion. This OVERRIDES `proven`
//                           — see the invariant `trustedInvoiceId === null => state !== 'proven'`.
//   strongly_supported  := a real invoice candidate + clean, unambiguous, uncontested statistical
//                           evidence (attributionLevel === 'strongly_inferred' AND
//                           isOfficialForStaffEvaluation) — but NEVER `proven`; no trusted link.
//   weakly_supported     := real but incomplete/ambiguous/disqualified evidence — includes a
//                           `strongly_inferred` score that failed the clean/unambiguous gate above
//                           (deliberately downgraded, never blindly promoted).
//   unknown              := no invoice candidate, no selected invoice, or attributionLevel ===
//                           'unknown'. Conversation-side signals (commercial confirmation,
//                           historical closure, "تم الارسال"-style staff messages) are NEVER inputs
//                           to this module at all — there is structurally no way for them to move a
//                           case out of `unknown` here, by construction, not by a runtime check.
//
// Absence of data is never a contradiction: a null/unknown branch, an unresolved identity, or
// item/quantity evidence being unavailable (sales_invoice_items_v21 = 0 rows, unchanged since
// I.C.0/I.C.1) all surface as `unknown`/`weakly_supported`/`itemEvidenceReady: false` — never as
// `contradicted`. Only an ACTIVELY DETECTED conflicting fact does that.
import type {
  BasketInvoiceMatch,
  ConfidenceAssessment,
  ConfidenceLevel,
  EvidenceRef,
  IntegrityEvaluationScope,
  SaleAttributionAssessment,
  SalesIntegrityAssessment,
  SalesIntegrityExceptionType,
} from './types';

export type SaleProofState = 'proven' | 'strongly_supported' | 'weakly_supported' | 'unknown' | 'contradicted';

export type SaleProofSource =
  | 'trusted_invoice'
  | 'statistical_strong'
  | 'statistical_weak'
  | 'none'
  | 'trusted_invoice_with_contradiction'
  | 'statistical_with_contradiction';

export interface SaleProofStateInput {
  attribution: SaleAttributionAssessment;
  basketInvoiceMatch: BasketInvoiceMatch;
  integrityAssessment: SalesIntegrityAssessment;
}

export interface SaleProofAssessment {
  caseId: string;
  state: SaleProofState;
  /** Reuses the existing ConfidenceAssessment vocabulary for consistency with every other engine's output — see mapStateToConfidenceLevel's own doc comment for why `contradicted` maps to `unknown` here, never to a positive level. */
  confidence: ConfidenceAssessment;
  evidence: EvidenceRef[];
  /** Named contradiction categories (empty when state !== 'contradicted') — see CONTRADICTION_CATEGORY_BY_EXCEPTION_TYPE. */
  contradictions: string[];
  ruleIds: string[];
  proofSource: SaleProofSource;
  /** sales_invoices.id, non-null ONLY when state === 'proven' (see the invariant in this module's own tests). NEVER derived from invoice_number. */
  trustedInvoiceId: string | null;
  /** attribution.selectedInvoiceId as-is — the candidate Phase D actually picked, whatever the state (may differ from trustedInvoiceId when state !== 'proven'). */
  selectedInvoiceId: string | null;
  /** Display/logging only — mirrors attribution.selectedInvoiceNumber verbatim; NEVER unique on its own (I.C.0/I.C.1) — never used as an identity key. */
  selectedInvoiceNumber: string | null;
  /** Mirrors basketInvoiceMatch.integrityEvaluationScope verbatim — never re-derived. 'header_only' today because sales_invoice_items_v21 = 0 rows (I.C.0/I.C.1). */
  invoiceEvidenceScope: IntegrityEvaluationScope;
  /** Mirrors basketInvoiceMatch.itemEvidenceReady verbatim. Always false in Production today — never inferred from product text or the invoice total. */
  itemEvidenceReady: boolean;
  /** Same gate as itemEvidenceReady today (quantity comparison only ever runs once item identity is resolved — see basketInvoiceMatchingEngine.ts's own classifyItemsAndQuantities). Kept as its own field for forward compatibility if the two gates are ever split. */
  quantityEvidenceReady: boolean;
  /** True for `contradicted` (always), plus whatever attribution/basketInvoiceMatch/integrityAssessment already flagged — never re-derived, purely an OR over already-computed flags. */
  needsHumanReview: boolean;
}

// ---------------------------------------------------------------------------
// Contradiction detection — reads ALREADY-COMPUTED SalesIntegrityException entries (Phase F) plus
// one already-computed disqualifier flag (Phase D) — never re-derives identity/branch/time/amount
// comparisons itself. See the module header comment for why some types are unconditional and some
// are scoped to a trusted (directInvoiceLink) candidate only.
// ---------------------------------------------------------------------------

/**
 * Real, already-vetted evidence conflicts about the SPECIFIC selected candidate — never merely
 * "this candidate scored low". Applies whether or not the candidate is a trusted/directInvoiceLink
 * one: a cross-customer identity conflict or a second case independently claiming the exact same
 * invoice are conflicts on their own terms, not a function of how confident THIS case's own score
 * was. `unexplained_total_difference`/item-level exceptions are gated by
 * basketInvoiceMatchingEngine.ts on real header/item evidence being ready in the first place, so
 * they are never fired from absent data either.
 */
const UNCONDITIONAL_CONTRADICTION_EXCEPTION_TYPES: ReadonlySet<SalesIntegrityExceptionType> = new Set([
  'identity_conflict',
  'competing_case_attribution',
  'cancelled_invoice_linked_to_case',
  'returned_invoice_linked_to_case',
  'unexplained_total_difference',
  'confirmed_item_missing_from_invoice',
  'extra_invoice_item',
  'confirmed_quantity_mismatch',
]);

/**
 * Real for a statistical candidate too, but NOT unconditionally hard: branch mismatches are
 * expected and common in real data (I.C.0 — branch is deliberately not filtered at candidate
 * retrieval; a customer may message from one branch's number and buy at another), so
 * saleAttributionEngine.ts already reflects them as a scoring disqualifier rather than an outright
 * conflict. Only when the candidate IS a trusted (directInvoiceLink) one does a branch mismatch
 * become a genuine contradiction worth downgrading `proven` itself — "the supposedly authoritative
 * link doesn't add up," per the I.C.2 instructions' own "ضمن سياق trusted evidence" scoping.
 */
const TRUSTED_ONLY_CONTRADICTION_EXCEPTION_TYPES: ReadonlySet<SalesIntegrityExceptionType> = new Set([
  'branch_conflict',
]);

const CONTRADICTION_CATEGORY_BY_EXCEPTION_TYPE: Partial<Record<SalesIntegrityExceptionType, string>> = {
  identity_conflict: 'cross_customer_invoice_link',
  competing_case_attribution: 'cross_case_invoice_collision',
  cancelled_invoice_linked_to_case: 'cancelled_invoice_linked_to_case',
  returned_invoice_linked_to_case: 'returned_invoice_linked_to_case',
  unexplained_total_difference: 'unexplained_amount_conflict',
  confirmed_item_missing_from_invoice: 'item_evidence_conflict',
  extra_invoice_item: 'item_evidence_conflict',
  confirmed_quantity_mismatch: 'item_evidence_conflict',
  branch_conflict: 'cross_branch_invoice_link',
};

function detectContradictionCategories(input: SaleProofStateInput): string[] {
  const isTrustedCandidate = input.attribution.selectedCandidate?.directInvoiceLink === true;
  const categories = new Set<string>();

  for (const exception of input.integrityAssessment.exceptions) {
    if (UNCONDITIONAL_CONTRADICTION_EXCEPTION_TYPES.has(exception.type)) {
      categories.add(CONTRADICTION_CATEGORY_BY_EXCEPTION_TYPE[exception.type] as string);
    } else if (isTrustedCandidate && TRUSTED_ONLY_CONTRADICTION_EXCEPTION_TYPES.has(exception.type)) {
      categories.add(CONTRADICTION_CATEGORY_BY_EXCEPTION_TYPE[exception.type] as string);
    }
  }

  // Temporal inversion is not (yet) promoted to its own SalesIntegrityException — read directly
  // from the already-computed disqualifier on the selected candidate (saleAttributionEngine.ts),
  // never a re-derivation of the time distance itself. Scoped trusted-only for the same reason as
  // branch_conflict above.
  if (
    isTrustedCandidate &&
    input.attribution.selectedCandidate?.disqualifiers.includes('temporal_inversion_invoice_predates_case')
  ) {
    categories.add('temporal_inversion_conflict');
  }

  return Array.from(categories);
}

function collectContradictionEvidence(input: SaleProofStateInput, categories: string[]): EvidenceRef[] {
  const relevantTypes = new Set(
    Object.entries(CONTRADICTION_CATEGORY_BY_EXCEPTION_TYPE)
      .filter(([, category]) => categories.includes(category))
      .map(([type]) => type as SalesIntegrityExceptionType)
  );
  return input.integrityAssessment.exceptions
    .filter((e) => relevantTypes.has(e.type))
    .flatMap((e) => e.sourceEvidence);
}

/**
 * `contradicted` never reads as a positive signal to any legacy consumer that only checks
 * `confidence.level` (the pre-existing ConfidenceLevel vocabulary has no `contradicted` value) —
 * mapped to `unknown`, the one existing level that has never meant "supported".
 */
function mapStateToConfidenceLevel(state: SaleProofState): ConfidenceLevel {
  switch (state) {
    case 'proven':
      return 'proven';
    case 'strongly_supported':
      return 'strongly_inferred';
    case 'weakly_supported':
      return 'weakly_inferred';
    case 'unknown':
    case 'contradicted':
      return 'unknown';
  }
}

function scoreForState(state: SaleProofState): number {
  switch (state) {
    case 'proven':
      return 1;
    case 'strongly_supported':
      return 0.75;
    case 'weakly_supported':
      return 0.4;
    case 'unknown':
    case 'contradicted':
      return 0;
  }
}

/**
 * The single entry point. Pure function — no Supabase, no re-derivation of attribution/matching/
 * integrity facts, only interpretation of their already-computed output. Precedence, in order:
 *   1. A real contradiction against the selected candidate always wins, even over `proven` —
 *      see the module header comment and the `trustedInvoiceId === null => state !== 'proven'`
 *      invariant (locked by this module's own regression tests).
 *   2. `directInvoiceLink === true` with no contradiction -> `proven`. This is the ONLY path to
 *      `proven` — never conversation confidence, never a statistical score however high.
 *   3. No usable invoice at all (`unknown` attributionLevel, no selectedInvoiceId, or zero
 *      candidates) -> `unknown`.
 *   4. A clean, unambiguous, uncontested `strongly_inferred` attribution (the SAME gate
 *      saleAttributionEngine.ts already uses for `isOfficialForStaffEvaluation`) -> `strongly_supported`.
 *   5. Everything else with a real candidate (a `strongly_inferred` score that failed the clean
 *      gate above, or any `weakly_inferred` level) -> `weakly_supported` — deliberately never
 *      blindly promoted just because the raw score crossed a threshold.
 */
export function deriveSaleProofState(input: SaleProofStateInput): SaleProofAssessment {
  const { attribution, basketInvoiceMatch } = input;
  const candidate = attribution.selectedCandidate;
  const isTrustedCandidate = candidate?.directInvoiceLink === true;

  const contradictions = detectContradictionCategories(input);
  const ruleIds: string[] = [];
  let state: SaleProofState;
  let proofSource: SaleProofSource;

  if (contradictions.length > 0) {
    state = 'contradicted';
    proofSource = isTrustedCandidate ? 'trusted_invoice_with_contradiction' : 'statistical_with_contradiction';
    ruleIds.push('sale_proof.state.contradicted', ...contradictions.map((c) => `sale_proof.contradiction.${c}`));
  } else if (isTrustedCandidate) {
    state = 'proven';
    proofSource = 'trusted_invoice';
    ruleIds.push('sale_proof.state.proven', 'sale_proof.rule.trusted_invoice_link');
  } else if (attribution.candidateCount === 0 || !attribution.selectedInvoiceId || attribution.attributionLevel === 'unknown') {
    state = 'unknown';
    proofSource = 'none';
    ruleIds.push('sale_proof.state.unknown');
  } else if (attribution.attributionLevel === 'strongly_inferred' && attribution.isOfficialForStaffEvaluation) {
    state = 'strongly_supported';
    proofSource = 'statistical_strong';
    ruleIds.push('sale_proof.state.strongly_supported');
  } else {
    state = 'weakly_supported';
    proofSource = 'statistical_weak';
    ruleIds.push('sale_proof.state.weakly_supported');
  }

  const trustedInvoiceId = state === 'proven' ? attribution.selectedInvoiceId : null;

  const evidence: EvidenceRef[] =
    state === 'contradicted' ? collectContradictionEvidence(input, contradictions) : attribution.confidence.evidence;

  const needsHumanReview =
    state === 'contradicted' ||
    attribution.needsHumanReview ||
    basketInvoiceMatch.needsHumanReview ||
    input.integrityAssessment.needsHumanReview;

  return {
    caseId: attribution.caseId,
    state,
    confidence: {
      level: mapStateToConfidenceLevel(state),
      score: scoreForState(state),
      ruleIds,
      evidence,
    },
    evidence,
    contradictions,
    ruleIds,
    proofSource,
    trustedInvoiceId,
    selectedInvoiceId: attribution.selectedInvoiceId,
    selectedInvoiceNumber: attribution.selectedInvoiceNumber,
    invoiceEvidenceScope: basketInvoiceMatch.integrityEvaluationScope,
    itemEvidenceReady: basketInvoiceMatch.itemEvidenceReady,
    quantityEvidenceReady: basketInvoiceMatch.itemEvidenceReady,
    needsHumanReview,
  };
}
