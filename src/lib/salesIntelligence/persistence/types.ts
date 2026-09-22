// Sales Intelligence Phase H — Persistence Design Contracts.
//
// DESIGN ONLY. Pure TypeScript interfaces describing the PROPOSED storage shape for the B-G.3
// engine outputs (see ../types.ts for the semantic source of truth these rows are derived from).
// No Supabase client, no SQL, no migrations, no runtime logic anywhere in this file — see
// docs/SALES_INTELLIGENCE_PERSISTENCE_DESIGN.md for the full architecture this file supports.
//
// Every row type below carries the same three-part identity discipline: a stable primary key,
// an explicit `analysisVersion`/`pipelineVersion` pair (never inferred from a git SHA), and a
// `sourceHash` where reprocessing-safety matters — see the design doc's "Idempotency" and
// "Versioning" sections for why each exists.
import type {
  AttributionEvidenceItem,
  CaseStatus,
  CaseType,
  CommercialConfirmationState,
  ConfidenceLevel,
  DifferenceExplanationKind,
  EvidenceLevel,
  EvidenceRef,
  FieldMatchStatus,
  HistoricalClosureLevel,
  IntegrityEvaluationScope,
  OrderConfirmationProtocolApplicability,
  PipelineFailureReason,
  PipelineStatus,
  ProtocolPolicyComplianceState,
  SalesIntegrityExceptionType,
  SalesIntegritySeverity,
  SalesIntegrityStage,
} from '../types';

// ---------------------------------------------------------------------------
// Shared identity/versioning fields — mixed into every row type below rather than duplicated.
// `analysisVersion` is a per-row monotonic counter scoped to one caseId (see Idempotency in the
// design doc); `pipelineVersion`/`engineVersions` are the semantic-logic version, independent of
// any git SHA, so a reader can tell "which rule set produced this row" without a code checkout.
// ---------------------------------------------------------------------------
export interface PersistenceVersionFields {
  analysisVersion: number;
  pipelineVersion: string; // e.g. 'sales-intelligence-v1'
  /** Per-engine semantic version, only populated where a component's own semantics could diverge from the others (see design doc §18). */
  engineVersions: {
    caseSegmentation: string;
    historicalClosure: string;
    commercialConfirmation: string;
    protocolApplicability: string;
    attribution: string;
    basketInvoiceMatching: string;
    integrity: string;
  };
  /** Deterministic hash of the exact inputs this row was derived from (raw_text + invoice candidate ids + policy date) — see design doc "Idempotency". */
  sourceHash: string;
  analyzedAt: string;
  /** True only for the current, active analysis of this caseId — never more than one active row per caseId (see Idempotency). */
  isCurrent: boolean;
  /** Set when a newer analysisVersion supersedes this row — the old row is NEVER deleted or mutated, only marked. */
  supersededAt: string | null;
  supersededByAnalysisVersion: number | null;
}

// ---------------------------------------------------------------------------
// 1. sales_intelligence_case_analyses — one row per (caseId, analysisVersion).
// ---------------------------------------------------------------------------
export interface SalesIntelligenceCaseAnalysisRow extends PersistenceVersionFields {
  /** Synthetic surrogate PK — see design doc for why caseId+analysisVersion is the natural key but not the PK. */
  id: string;
  caseId: string;
  conversationId: string;
  sourceCaseIdV22: string | null;

  customerId: string | null;
  customerPhone: string | null;
  branchId: string | null;
  branchNameRaw: string | null;

  caseStartedAt: string;
  caseEndedAt: string | null;
  caseType: CaseType;
  caseStatus: CaseStatus;

  pipelineStatus: PipelineStatus;
  overallEvidenceLevel: EvidenceLevel;

  /** First-class, never collapsed into JSON — see design doc §14 on why these four stay separate columns. */
  historicalClosureLevel: HistoricalClosureLevel;
  commercialConfirmationState: CommercialConfirmationState;
  protocolApplicability: OrderConfirmationProtocolApplicability;
  protocolPolicyCompliance: ProtocolPolicyComplianceState;

  attributionLevel: ConfidenceLevel;
  integrityEvaluationScope: IntegrityEvaluationScope;

  needsHumanReview: boolean;
  humanReviewReasons: string[];
  failureReasons: PipelineFailureReason[];
  pipelineWarnings: string[];

  /**
   * Rich nested evidence — the full ConversationCase/EvidenceCompleteness/confidence structs,
   * kept as JSONB for drill-down (see design doc "Auditability"). Every field promoted to a
   * first-class column above is ALSO present here for full traceability; the column is the
   * queryable projection, this is the audit trail.
   */
  evidenceSnapshot: {
    conversationCaseConfidence: { level: ConfidenceLevel; score: number; ruleIds: string[] };
    evidenceCompleteness: Record<string, boolean | EvidenceLevel>;
    historicalClosureEvidence: EvidenceRef[];
    protocolApplicabilityRuleIds: string[];
  };
}

// ---------------------------------------------------------------------------
// 2. sales_intelligence_case_baskets — immutable version history.
// disabled_by_default: G.3 observed 0 real multi-version baskets (see design doc §3/§19).
// ---------------------------------------------------------------------------
export interface SalesIntelligenceCaseBasketRow extends PersistenceVersionFields {
  id: string;
  caseId: string;
  basketId: string;
  basketVersion: number;
  status: 'draft' | 'awaiting_confirmation' | 'confirmed' | 'superseded' | 'cancelled';
  /** Set once a newer version replaces this one — the row itself is NEVER mutated after write. */
  supersededByBasketId: string | null;
  createdAt: string;
  confirmedAt: string | null;
  confirmedByCustomerAt: string | null;
  staffId: string | null;
  announcedTotalAmount: number | null;
  announcedTotalMessageId: string | null;
  sourceMessageIds: string[];
}

export interface SalesIntelligenceCaseBasketItemRow extends PersistenceVersionFields {
  id: string;
  basketRowId: string; // FK -> SalesIntelligenceCaseBasketRow.id
  caseId: string;
  itemId: string;
  productNameRaw: string;
  productId: string | null;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  lineTotal: number | null;
  resolutionStatus: 'proven' | 'partially_proven' | 'missing' | 'contradicted' | 'unknown';
  sourceMessageId: string;
}

// ---------------------------------------------------------------------------
// 3. sales_intelligence_attributions — one row per (caseId, analysisVersion).
// competing_case_ids is FIRST-CLASS, persisted data — never recomputed lazily (see design doc §9).
// ---------------------------------------------------------------------------
export interface SalesIntelligenceAttributionRow extends PersistenceVersionFields {
  id: string;
  caseId: string;

  selectedInvoiceId: string | null;
  selectedInvoiceNumber: string | null;
  attributionLevel: ConfidenceLevel;
  confidenceScore: number;

  isOfficialForStaffEvaluation: boolean;

  /**
   * Persisted at write time from the batch-level cross-case resolution step (design doc §8/§9) —
   * NEVER computed by a later per-row query. Empty array is a real, meaningful "no competition
   * found", not "not yet computed".
   */
  competingCaseIds: string[];
  ambiguityStatus: 'none' | 'ambiguous_multiple_candidates';
  identityConflict: 'none' | 'phone_vs_customer_id_conflict';
  branchConflict: boolean;

  candidateCount: number;
  primaryEvidence: AttributionEvidenceItem[];
  contradictions: string[];
  ruleIds: string[];
  legacyEvidenceUsed: boolean;
}

// ---------------------------------------------------------------------------
// 4. sales_intelligence_basket_invoice_matches — one row per (caseId, analysisVersion).
// item-level fields must never imply matching exists while sales_invoice_items_v21 = 0 rows
// (see design doc §5) — itemEvidenceReady is the structural gate a reader MUST check first.
// ---------------------------------------------------------------------------
export interface SalesIntelligenceBasketInvoiceMatchRow extends PersistenceVersionFields {
  id: string;
  caseId: string;
  basketId: string | null;
  basketVersion: number | null;
  invoiceId: string | null;
  invoiceNumber: string | null;

  totalMatch: FieldMatchStatus;
  itemMatch: FieldMatchStatus;
  quantityMatch: FieldMatchStatus;
  overallMatch: FieldMatchStatus;

  headerEvidenceReady: boolean;
  itemEvidenceReady: boolean;
  integrityEvaluationScope: IntegrityEvaluationScope;

  differences: Array<{
    type: string;
    key: string;
    before: string | number | null;
    after: string | number | null;
    explanation: DifferenceExplanationKind;
  }>;

  needsHumanReview: boolean;
  humanReviewReasons: string[];
}

// ---------------------------------------------------------------------------
// 5. sales_integrity_exceptions — one row per canonical exception.
// disabled_by_default: G.3 observed 0 real exceptions (see design doc §6/§19) because
// headerEvidenceReady is essentially never true on real data — do not invent semantics for a
// path that has never actually fired.
// ---------------------------------------------------------------------------
export interface SalesIntegrityExceptionRow extends PersistenceVersionFields {
  exceptionId: string;
  caseId: string;
  type: SalesIntegrityExceptionType;
  stage: SalesIntegrityStage;
  severity: SalesIntegritySeverity;
  /** Engine output is always 'open' at write time — see human-review lifecycle (design doc §12) for how this can change AFTER persistence, via a separate table, never by mutating this row. */
  status: 'open' | 'reviewed' | 'resolved' | 'dismissed';

  summary: string;
  fact: string;
  interpretation: string;

  expectedValue: string | number | null;
  observedValue: string | number | null;
  difference: number | null;
  differencePercentage: number | null;
  explained: boolean;
  explanationKind: DifferenceExplanationKind | null;

  invoiceId: string | null;
  invoiceNumber: string | null;
  basketVersion: number | null;

  /** Traceability only — see SalesIntegrityException's own doc comment in ../types.ts. NEVER a fault/responsibility list. */
  involvedStaffIds: string[];

  sourceEvidence: EvidenceRef[];
  ruleIds: string[];
  integrityEvaluationScope: IntegrityEvaluationScope;
  needsHumanReview: boolean;
}

// ---------------------------------------------------------------------------
// 6. sales_intelligence_policy_config — one canonical config row (see design doc §7/§12).
// Historical facts (HistoricalCommercialClosure, CommercialConfirmation) never depend on this row
// — only ProtocolPolicyCompliance does, computed at analysis time from whichever date was active
// then. Changing this row must NEVER retroactively rewrite an already-persisted analysis's
// protocolPolicyCompliance; it only affects analyses run AFTER the change (see design doc §10).
// ---------------------------------------------------------------------------
export interface SalesIntelligencePolicyConfigRow {
  id: string; // singleton row id, e.g. 'default'
  enabled: boolean;
  /** null == "opted in, no date configured yet" (matches deriveProtocolPolicyComplianceState's own `null` semantics) — never a guessed/default date. */
  protocolPolicyEffectiveAt: string | null;
  policyVersion: number;
  updatedAt: string;
  updatedBy: string; // staff/user id — never a raw name string.
}

// ---------------------------------------------------------------------------
// 7. sales_intelligence_review_events — human-review lifecycle, kept SEPARATE from engine output
// (design doc §12). An engine row's own `needsHumanReview`/`humanReviewReasons` are immutable
// facts about what the pipeline found; a human's decision is a separate append-only event stream
// over those facts, never a mutation of the engine row itself.
// ---------------------------------------------------------------------------
export type ReviewSubjectKind =
  | 'attribution_ambiguity'
  | 'identity_conflict'
  | 'branch_conflict'
  | 'integrity_exception'
  | 'case_segmentation_ambiguity'
  | 'basket_conflict';

export type ReviewEventStatus = 'open' | 'reviewed' | 'resolved' | 'dismissed';

export interface SalesIntelligenceReviewEventRow {
  eventId: string;
  caseId: string;
  subjectKind: ReviewSubjectKind;
  /** Points at the specific row this review concerns (e.g. an exceptionId, or the caseId's own attribution row id) — never ambiguous about what was reviewed. */
  subjectRowId: string;
  status: ReviewEventStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  note: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Feature flags — see design doc §19. All default OFF except case-analysis persistence itself,
// which is "enabled only after review" (i.e. also starts false until a human turns it on).
// ---------------------------------------------------------------------------
export interface SalesIntelligenceFeatureFlags {
  caseAnalysisPersistenceEnabled: boolean;
  basketVersionWritesEnabled: boolean;
  integrityExceptionWritesEnabled: boolean;
  policyComplianceDashboardEnabled: boolean;
  staffEvaluationConsumptionEnabled: boolean;
}

export const DEFAULT_SALES_INTELLIGENCE_FEATURE_FLAGS: SalesIntelligenceFeatureFlags = {
  caseAnalysisPersistenceEnabled: false,
  basketVersionWritesEnabled: false,
  integrityExceptionWritesEnabled: false,
  policyComplianceDashboardEnabled: false,
  staffEvaluationConsumptionEnabled: false,
};

// ---------------------------------------------------------------------------
// Batch pipeline contracts — see design doc §8. Pure shape only; no I/O here.
// ---------------------------------------------------------------------------
export interface CaseBatchGroup {
  customerId: string | null;
  customerPhone: string | null;
  /** The union time window covering every case in this group — used for exactly ONE invoice-candidate fetch per group, never per case. */
  windowStartIso: string;
  windowEndIso: string;
  caseIds: string[];
}

/**
 * The output of step 6 in the batch pipeline (design doc §8) — cross-case competing-selection
 * resolution, computed ONCE per batch, BEFORE any attribution row is persisted. Mirrors the G.3
 * shadow harness's own two-pass pattern, but as a real batch-time step instead of a validation-only
 * harness.
 */
export interface CompetingCaseResolution {
  invoiceId: string;
  caseIds: string[];
}
