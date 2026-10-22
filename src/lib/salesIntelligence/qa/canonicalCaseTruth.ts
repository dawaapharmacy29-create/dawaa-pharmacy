// Sales Intelligence QA — canonical sale truth for ONE selected case, READ ONLY.
//
// The selected-conversation window must render the business truth exactly as the canonical
// writers persisted it. It never re-runs the proof/outcome engines:
//   * conversation outcome  = sales_intelligence_case_analyses.evidence_snapshot.canonicalSalesOutcome
//                             of the CURRENT analysis (written by the server refresh pipeline);
//   * invoice attribution   = the current sales_intelligence_attributions row (same analysis);
//   * countable sale ledger = whatsapp_customer_cases_v22.case_json.canonicalSaleProof + verified_*
//                             (single writer: dawaa_reconcile_sales_intelligence_case_v22_v1).
//
// These are deliberately separate facts. saleProofState='proven' does NOT imply
// outcome='sale_proven', isSaleCountable, isRevenueCountable or isOrderConfirmed — each value is
// shown as persisted. Missing truth stays missing (NOT_ANALYZED / NOT_LINKED), never recomputed.
//
// One V22 case may be shared by several SI cases (segments of the same operation), so the ledger
// entry belongs to the selected case ONLY when canonicalSaleProof.salesCaseId equals its case id.
//
// Viewer authorization only decides whether a row is visible. A row hidden by RLS yields an
// explicit "not visible" state; it never produces a different business result.

import type { CanonicalSalesOutcome, CanonicalSalesOutcomeAssessment } from '../types';

const CANONICAL_SALES_OUTCOMES: ReadonlySet<string> = new Set<CanonicalSalesOutcome>([
  'sale_proven',
  'order_confirmed_unproven',
  'customer_confirmed_unproven',
  'open_opportunity',
  'customer_rejected',
  'information_only',
  'needs_review',
  'unknown',
]);

const SALE_PROOF_STATES: ReadonlySet<string> = new Set<
  CanonicalSalesOutcomeAssessment['saleProofState']
>(['proven', 'strongly_supported', 'weakly_supported', 'unknown', 'contradicted']);

export type CanonicalOutcomeAvailability =
  /** A current analysis exists and carries a valid canonicalSalesOutcome for this case. */
  | 'analyzed'
  /** No current analysis row is available for this case. */
  | 'not_analyzed'
  /** A current analysis exists but its engine version did not persist a canonical outcome. */
  | 'outcome_not_persisted';

export interface PersistedCanonicalSalesOutcome {
  outcome: CanonicalSalesOutcome;
  saleProofState: CanonicalSalesOutcomeAssessment['saleProofState'];
  isSaleCountable: boolean;
  isRevenueCountable: boolean;
  /** Conversation-side fact only; null when the persisting engine version did not record it. */
  isOrderConfirmed: boolean | null;
  needsHumanReview: boolean | null;
  reasonCodes: string[];
}

export type CanonicalSaleLedgerState =
  /** canonicalSaleProof.state='proven' and it belongs to this SI case. */
  | 'proven'
  /** canonicalSaleProof.state='revoked' for this SI case. */
  | 'revoked'
  /** A linked V22 case exists without a proof for this SI case. */
  | 'not_proven'
  /** The proof on the shared V22 case belongs to a different SI case (another segment). */
  | 'proof_belongs_to_other_case'
  /** The SI case has no linked Customer Case V22. */
  | 'v22_not_linked'
  /** The SI case links a V22 case the viewer cannot read (or that no longer exists). */
  | 'v22_not_visible';

export interface CanonicalSaleLedgerEntry {
  state: CanonicalSaleLedgerState;
  v22CaseId: string | null;
  /** Set only for state='proven'. */
  invoiceId: string | null;
  invoiceNumber: string | null;
  revenue: number | null;
  saleAt: string | null;
  proofAnalysisId: string | null;
  proofPipelineVersion: string | null;
  reconciledAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
}

export interface CanonicalCaseAttributionFact {
  attributionLevel: string | null;
  selectedInvoiceId: string | null;
  selectedInvoiceNumber: string | null;
  isOfficialForStaffEvaluation: boolean;
}

export interface CanonicalCaseSaleTruth {
  caseId: string;
  analysisId: string | null;
  pipelineVersion: string | null;
  availability: CanonicalOutcomeAvailability;
  outcome: PersistedCanonicalSalesOutcome | null;
  attribution: CanonicalCaseAttributionFact | null;
  ledger: CanonicalSaleLedgerEntry;
}

export interface CanonicalCaseTruthInput {
  caseId: string;
  analysisRow: Record<string, any> | null;
  attributionRow: Record<string, any> | null;
  /** sales_intelligence_cases.source_case_id_v22 of the selected case. */
  linkedV22CaseId: string | null;
  /** The linked whatsapp_customer_cases_v22 row as returned to this viewer, or null. */
  v22Row: Record<string, any> | null;
}

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Reads the persisted canonicalSalesOutcome exactly. Returns null when the value is absent, does
 * not have the canonical shape, or was persisted for a different case id.
 */
export function readPersistedCanonicalSalesOutcome(
  value: unknown,
  caseId: string
): PersistedCanonicalSalesOutcome | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (raw.caseId != null && String(raw.caseId) !== caseId) return null;
  if (typeof raw.outcome !== 'string' || !CANONICAL_SALES_OUTCOMES.has(raw.outcome)) return null;
  if (typeof raw.saleProofState !== 'string' || !SALE_PROOF_STATES.has(raw.saleProofState))
    return null;
  if (typeof raw.isSaleCountable !== 'boolean' || typeof raw.isRevenueCountable !== 'boolean')
    return null;
  return {
    outcome: raw.outcome as CanonicalSalesOutcome,
    saleProofState: raw.saleProofState as PersistedCanonicalSalesOutcome['saleProofState'],
    isSaleCountable: raw.isSaleCountable,
    isRevenueCountable: raw.isRevenueCountable,
    isOrderConfirmed: typeof raw.isOrderConfirmed === 'boolean' ? raw.isOrderConfirmed : null,
    needsHumanReview: typeof raw.needsHumanReview === 'boolean' ? raw.needsHumanReview : null,
    reasonCodes: Array.isArray(raw.reasonCodes) ? raw.reasonCodes.map((code) => String(code)) : [],
  };
}

function emptyLedger(
  state: CanonicalSaleLedgerState,
  v22CaseId: string | null
): CanonicalSaleLedgerEntry {
  return {
    state,
    v22CaseId,
    invoiceId: null,
    invoiceNumber: null,
    revenue: null,
    saleAt: null,
    proofAnalysisId: null,
    proofPipelineVersion: null,
    reconciledAt: null,
    revokedAt: null,
    revokeReason: null,
  };
}

export function readCanonicalSaleLedger(
  caseId: string,
  linkedV22CaseId: string | null,
  v22Row: Record<string, any> | null
): CanonicalSaleLedgerEntry {
  const v22CaseId = textOrNull(linkedV22CaseId);
  if (!v22CaseId) return emptyLedger('v22_not_linked', null);
  if (!v22Row || textOrNull(v22Row.id) !== v22CaseId)
    return emptyLedger('v22_not_visible', v22CaseId);

  const proof = v22Row.case_json?.canonicalSaleProof ?? v22Row.canonical_sale_proof ?? null;
  const proofState = textOrNull(proof?.state);
  const proofCaseId = textOrNull(proof?.salesCaseId);
  if (!proof || !proofState || (proofState !== 'proven' && proofState !== 'revoked')) {
    return emptyLedger('not_proven', v22CaseId);
  }
  // The writer always records salesCaseId; a proof without it cannot be attributed to a segment.
  if (proofCaseId !== caseId)
    return emptyLedger(proofCaseId ? 'proof_belongs_to_other_case' : 'not_proven', v22CaseId);

  if (proofState === 'revoked') {
    return {
      ...emptyLedger('revoked', v22CaseId),
      proofAnalysisId: textOrNull(proof.analysisId),
      proofPipelineVersion: textOrNull(proof.pipelineVersion),
      revokedAt: textOrNull(proof.revokedAt),
      revokeReason: textOrNull(proof.reason ?? proof.revokeReason),
    };
  }

  return {
    state: 'proven',
    v22CaseId,
    invoiceId: textOrNull(v22Row.verified_invoice_id) ?? textOrNull(proof.invoiceId),
    invoiceNumber: textOrNull(v22Row.verified_invoice_number) ?? textOrNull(proof.invoiceNumber),
    revenue: numberOrNull(v22Row.verified_revenue),
    saleAt: textOrNull(v22Row.verified_sale_at),
    proofAnalysisId: textOrNull(proof.analysisId),
    proofPipelineVersion: textOrNull(proof.pipelineVersion),
    reconciledAt: textOrNull(proof.reconciledAt),
    revokedAt: null,
    revokeReason: null,
  };
}

export function readCanonicalCaseSaleTruth(input: CanonicalCaseTruthInput): CanonicalCaseSaleTruth {
  const { caseId, analysisRow, attributionRow } = input;
  const analysisBelongsToCase = Boolean(
    analysisRow && String(analysisRow.case_id ?? caseId) === caseId
  );
  const outcome = analysisBelongsToCase
    ? readPersistedCanonicalSalesOutcome(
        analysisRow?.evidence_snapshot?.canonicalSalesOutcome,
        caseId
      )
    : null;
  const attributionBelongsToCase = Boolean(
    attributionRow &&
    analysisBelongsToCase &&
    String(attributionRow.case_id ?? caseId) === caseId &&
    (attributionRow.analysis_id == null ||
      String(attributionRow.analysis_id) === String(analysisRow?.analysis_id))
  );

  return {
    caseId,
    analysisId: analysisBelongsToCase ? textOrNull(analysisRow?.analysis_id) : null,
    pipelineVersion: analysisBelongsToCase ? textOrNull(analysisRow?.pipeline_version) : null,
    availability: !analysisBelongsToCase
      ? 'not_analyzed'
      : outcome
        ? 'analyzed'
        : 'outcome_not_persisted',
    outcome,
    attribution: attributionBelongsToCase
      ? {
          attributionLevel: textOrNull(attributionRow?.attribution_level),
          selectedInvoiceId: textOrNull(attributionRow?.selected_invoice_id),
          selectedInvoiceNumber: textOrNull(attributionRow?.selected_invoice_number),
          isOfficialForStaffEvaluation: attributionRow?.is_official_for_staff_evaluation === true,
        }
      : null,
    ledger: readCanonicalSaleLedger(caseId, input.linkedV22CaseId, input.v22Row),
  };
}
