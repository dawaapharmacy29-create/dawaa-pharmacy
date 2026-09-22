// Sales Intelligence Phase H / H.0.1 — Persistence Design Contracts.
//
// DESIGN ONLY. Pure TypeScript interfaces describing the PROPOSED storage shape for the B-G.3
// engine outputs (see ../types.ts for the semantic source of truth these rows are derived from).
// No Supabase client, no SQL, no migrations, no runtime logic anywhere in this file — see
// docs/SALES_INTELLIGENCE_PERSISTENCE_DESIGN.md for the full architecture this file supports.
//
// H.0.1 CHANGE (see the design doc's "Phase H.0.1" section for the full rationale): Phase H's
// first draft used `case_id` as a general FK target inside a table where `case_id` was NOT unique
// (multiple analysis-version rows share one case_id). That is not a valid FK model. This revision
// introduces a STABLE case entity (`sales_intelligence_cases`, PK = case_id) separate from the
// VERSIONED analysis output, and makes `analysis_id` — never `case_id` — the provenance FK every
// dependent table points at. `case_id` is kept on dependent rows too, but only as a redundant,
// indexed column for debugging/filtering, never as the referential-integrity mechanism.
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
// 0. sales_intelligence_cases — the STABLE case entity. One row per globally unique commercial
// case, for its entire lifetime. This table answers "does this commercial case exist" — it is
// NEVER versioned and NEVER carries any engine-analysis output. `case_id` is a safe, stable FK
// target specifically because this table (unlike case_analyses) guarantees `case_id` uniqueness.
// ---------------------------------------------------------------------------
export interface SalesIntelligenceCaseRow {
  caseId: string; // PK. The same string the engines already compute (conversationId:interactionId[:session:N]).
  conversationId: string;
  sourceCaseIdV22: string | null;
  customerId: string | null;
  customerPhone: string | null;
  branchId: string | null;
  branchNameRaw: string | null;
  /** From the FIRST analysis that ever derived this case — case-level identity facts, not re-derived per analysis version (a re-analysis confirms/updates these via the batch job, but the row itself is the stable anchor). */
  caseStartedAt: string;
  caseEndedAt: string | null;
  /** First time any pipeline run produced this exact caseId. */
  firstSeenAt: string;
  /** Bumped every time a re-run (of any kind — full or evaluation-only) touches this case, even if it turns out to be a no-op. Lets an operator find recently-touched cases without joining every dependent table. */
  lastSeenAt: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Case-analysis provenance — the FULL semantic re-analysis dimension. A new row/version here
// means case segmentation, historical closure, commercial confirmation, or protocol applicability
// could genuinely have changed (see design doc "Reprocessing matrix"). Scoped to `caseId` because,
// unlike the tables below, `sales_intelligence_case_analyses` legitimately needs `case_id` to be
// its own versioning axis — `analysis_id` (surrogate) is still the PK and the FK target for every
// dependent table, but `(case_id, analysis_version)` is what a human reasons about.
// ---------------------------------------------------------------------------
export interface CaseAnalysisProvenanceFields {
  analysisId: string; // PK (uuid) — the ONLY valid FK target for dependent tables. Never case_id.
  caseId: string; // FK -> sales_intelligence_cases.case_id. Safe now: that table guarantees uniqueness.
  analysisVersion: number; // monotonic per case_id, starting at 1.
  pipelineVersion: string; // e.g. 'sales-intelligence-v1' — independent of any git SHA.
  /** Only the engines whose output lives ON the case_analyses row itself — case segmentation, historical closure, commercial confirmation, protocol applicability. Attribution/matching/integrity engine versions live on THEIR OWN dependent rows (see AnalysisDependentProvenanceFields) because they can be re-evaluated independently without bumping analysis_version — see the reprocessing matrix. */
  engineVersions: {
    caseSegmentation: string;
    historicalClosure: string;
    commercialConfirmation: string;
    protocolApplicability: string;
  };
  /**
   * H.0.1: renamed from `sourceHash` and NARROWED. Covers ONLY the inputs that could change
   * case segmentation / historical closure / commercial confirmation / protocol applicability:
   * a hash of the raw conversation source text, plus (where semantically material to
   * segmentation) the branch/identity mapping version active at analysis time. Deliberately
   * EXCLUDES: `protocol_policy_effective_at` (policy changes must never force a full
   * re-analysis — see §7/§10), resolved customer identity (affects attribution only, not case
   * segmentation/closure — see AnalysisDependentProvenanceFields.attributionInputHash), and
   * invoice candidate/item data (affects attribution/matching/integrity only).
   */
  semanticSourceHash: string;
  analyzedAt: string;
  /** True only for the current, active analysis of this caseId — never more than one per caseId. */
  isCurrent: boolean;
  supersededAt: string | null;
  /** H.0.1: points at the analysis_id (not a bare version number) that superseded this row — analysis_id is the stable reference, version numbers are only meaningful alongside their case_id. */
  supersededByAnalysisId: string | null;
}

// ---------------------------------------------------------------------------
// Analysis-dependent provenance — for tables whose content can be re-evaluated WITHOUT a full
// semantic re-analysis (attribution, basket-invoice matching, integrity exceptions). These get
// their OWN `evaluationVersion`, scoped within one `analysisId`, so e.g. "invoice item data
// finally became available" can bump matching/integrity's evaluation without touching case
// segmentation/closure or forcing a new case_analyses row (see design doc's reprocessing matrix
// and the explicit "matching/integrity-only" vs "full re-analysis" decision).
// ---------------------------------------------------------------------------
export interface AnalysisDependentProvenanceFields {
  id: string; // surrogate PK of this specific row.
  analysisId: string; // FK -> sales_intelligence_case_analyses.analysis_id — the REAL provenance pointer.
  caseId: string; // redundant, indexed, for debugging/filtering only — never the FK.
  evaluationVersion: number; // monotonic within (analysisId, this table).
  isCurrentEvaluation: boolean;
  evaluatedAt: string;
  supersededAt: string | null;
  supersededByEvaluationVersion: number | null;
}

// ---------------------------------------------------------------------------
// 1. sales_intelligence_case_analyses — one row per (caseId, analysisVersion). PK = analysisId.
// ---------------------------------------------------------------------------
export interface SalesIntelligenceCaseAnalysisRow extends CaseAnalysisProvenanceFields {
  caseType: CaseType;
  caseStatus: CaseStatus;

  pipelineStatus: PipelineStatus;
  overallEvidenceLevel: EvidenceLevel;

  /** First-class, never collapsed into JSON — see design doc on why these stay separate columns. */
  historicalClosureLevel: HistoricalClosureLevel;
  commercialConfirmationState: CommercialConfirmationState;
  protocolApplicability: OrderConfirmationProtocolApplicability;

  /**
   * H.0.1: the ONE field on this immutable-once-superseded row that IS updated in place — see
   * design doc §7/§16. A policy-date change never creates a new analysisVersion; it recomputes
   * this struct, in place, on the CURRENT row only, from already-stored `caseEndedAt` +
   * `protocolApplicability` against the new policy config. `policyConfigVersion` records exactly
   * which config produced the current value, so "why does this say non_compliant" is always
   * answerable without guessing which policy row was active.
   */
  policyCompliance: {
    state: ProtocolPolicyComplianceState;
    policyConfigVersion: number;
    computedAt: string;
  };

  /** Denormalized read-optimization ONLY — always equal to the current attribution row's own attributionLevel for this analysisId. Never the source of truth; see sales_intelligence_attributions. */
  attributionLevel: ConfidenceLevel;
  /** Denormalized read-optimization ONLY — mirrors the current basket-invoice-match row's own integrityEvaluationScope. */
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
// 2. sales_intelligence_case_baskets — immutable version history, provenance-tied to analysisId.
// disabled_by_default: G.3 observed 0 real multi-version baskets (see design doc §10/§19).
// H.0.1: `basket_version` (the CaseBasket's own version, from re-editing within one conversation)
// is a DIFFERENT axis than `analysisId`'s `analysisVersion` (a re-run of the semantic engines).
// One analysisId can own multiple basket_version rows (v1, v2, ... within that one analysis); a
// LATER analysisId (a full re-analysis) can reconstruct an entirely different basket history for
// the same case — both axes are preserved, never conflated.
// ---------------------------------------------------------------------------
export interface SalesIntelligenceCaseBasketRow {
  id: string; // surrogate PK
  analysisId: string; // FK -> sales_intelligence_case_analyses.analysis_id — the provenance pointer.
  caseId: string; // redundant, indexed, for debugging only.
  basketId: string; // the CaseBasket business id (stable across versions of the SAME basket, within this analysisId).
  basketVersion: number; // the basket's OWN version axis — distinct from analysisId/analysisVersion.
  status: 'draft' | 'awaiting_confirmation' | 'confirmed' | 'superseded' | 'cancelled';
  /** Set once a newer basket_version replaces this one — the row itself is NEVER mutated after write. */
  supersededByBasketId: string | null;
  createdAt: string;
  confirmedAt: string | null;
  confirmedByCustomerAt: string | null;
  staffId: string | null;
  announcedTotalAmount: number | null;
  announcedTotalMessageId: string | null;
  sourceMessageIds: string[];
}

export interface SalesIntelligenceCaseBasketItemRow {
  id: string;
  basketRowId: string; // FK -> SalesIntelligenceCaseBasketRow.id (which already carries analysisId/caseId).
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
// 3. sales_intelligence_attributions — one row per (analysisId, evaluationVersion).
// competing_case_ids is FIRST-CLASS, persisted data, and belongs to THIS EXACT evaluation — never
// recomputed lazily, and never stored only on the stable case entity (design doc §9/§15): if a
// later analysisId changes segmentation/attribution, the competing set is recomputed fresh and
// tied to the NEW evaluation, leaving the old evaluation's set exactly as it was.
// ---------------------------------------------------------------------------
export interface SalesIntelligenceAttributionRow extends AnalysisDependentProvenanceFields {
  /** The attribution engine's OWN version — separate from CaseAnalysisProvenanceFields.engineVersions because attribution can be re-evaluated (customer identity merge, branch mapping fix, new invoice candidates) without a full semantic re-analysis. */
  attributionEngineVersion: string;
  /**
   * H.0.1: attribution's OWN narrower input hash — covers resolved customer identity (id +
   * normalized phone), the candidate invoice id set actually used, and branch mapping — NOT the
   * raw conversation text (that's semanticSourceHash's job) and NOT policy date (irrelevant to
   * attribution). Changing any of these bumps evaluationVersion, never analysisVersion.
   */
  attributionInputHash: string;

  selectedInvoiceId: string | null;
  selectedInvoiceNumber: string | null;
  attributionLevel: ConfidenceLevel;
  confidenceScore: number;

  isOfficialForStaffEvaluation: boolean;

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
// 4. sales_intelligence_basket_invoice_matches — one row per (analysisId, evaluationVersion).
// item-level fields must never imply matching exists while sales_invoice_items_v21 = 0 rows
// (see design doc §5) — itemEvidenceReady is the structural gate a reader MUST check first.
// H.0.1: references the specific attribution row it was computed against (matching depends on
// attribution's selected invoice) — never re-derives or assumes which attribution is "current".
// ---------------------------------------------------------------------------
export interface SalesIntelligenceBasketInvoiceMatchRow extends AnalysisDependentProvenanceFields {
  /** FK -> SalesIntelligenceAttributionRow.id — the EXACT attribution evaluation this match was computed against, never "whichever is current now". */
  attributionRowId: string;
  matchingEngineVersion: string;

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
// 5. sales_integrity_exceptions — one row per canonical exception PER EVALUATION.
// disabled_by_default: G.3 observed 0 real exceptions (see design doc §11/§19) because
// headerEvidenceReady is essentially never true on real data — do not invent semantics for a
// path that has never actually fired.
// H.0.1: `exceptionId` is now deterministically derived from (analysisId, evaluationVersion,
// type, canonical subject) — NEVER from case_id alone. The same LOGICAL exception recurring
// across two different analyses (A1 and A2) gets two distinct persisted rows; a later evaluation
// of the SAME analysisId (e.g. once item data appears) also gets its own distinct row rather than
// overwriting the earlier evaluation's finding.
// ---------------------------------------------------------------------------
export interface SalesIntegrityExceptionRow extends AnalysisDependentProvenanceFields {
  /** Deterministic: hash(analysisId + evaluationVersion + type + canonicalSubject). See module comment above. */
  exceptionId: string;
  integrityEngineVersion: string;

  type: SalesIntegrityExceptionType;
  stage: SalesIntegrityStage;
  severity: SalesIntegritySeverity;
  /** Engine output is always 'open' at write time — see human-review lifecycle (design doc §13) for how this can change AFTER persistence, via a separate table, never by mutating this row. */
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
// 6. sales_intelligence_policy_config — one canonical config row (see design doc §7/§12/§16).
// Historical facts (historicalClosureLevel, commercialConfirmationState, protocolApplicability)
// never depend on this row — only SalesIntelligenceCaseAnalysisRow.policyCompliance does, and only
// its `state`/`policyConfigVersion`/`computedAt` sub-fields, updated in place (the one deliberate
// exception to "rows are never mutated after write" — see CaseAnalysisProvenanceFields).
// ---------------------------------------------------------------------------
export interface SalesIntelligencePolicyConfigRow {
  id: string; // singleton row id, e.g. 'default'
  enabled: boolean;
  /** null == "opted in, no date configured yet" (matches deriveProtocolPolicyComplianceState's own `null` semantics) — never a guessed/default date. */
  protocolPolicyEffectiveAt: string | null;
  /** H.0.1: distinct from the pipeline/engine semantic version — this increments only when the POLICY itself (date, or the underlying protocol-step requirements) changes, never when engine code changes. */
  policyConfigVersion: number;
  updatedAt: string;
  updatedBy: string; // staff/user id — never a raw name string.
}

// ---------------------------------------------------------------------------
// 7. sales_intelligence_review_events — human-review lifecycle, kept SEPARATE from engine output
// (design doc §13). H.0.1: now carries BOTH `caseId` and `analysisId` explicitly, so a review is
// permanently pinned to the exact analysis a manager actually looked at. If a later analysisId
// becomes current, the review is NEVER silently transferred — a reader compares this row's
// `analysisId` against the case's current `analysisId` (via sales_intelligence_cases /
// sales_intelligence_current_case_analyses) to derive `reviewed_analysis_superseded` at READ time;
// no such column is stored here, since it is fully derivable and would otherwise need updating
// every time a new analysis lands (a write-amplification pattern this design avoids elsewhere too).
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
  caseId: string; // kept for cross-analysis lookup ("show me every review this case has ever had").
  analysisId: string; // the EXACT analysis reviewed — pinned permanently, never updated to a newer analysisId.
  subjectKind: ReviewSubjectKind;
  /**
   * Points at the specific row this review concerns (an attribution row id, a match row id, or an
   * exceptionId) — no single DB-level FK type fits every subject kind, so referential integrity
   * is preserved by convention (subjectKind disambiguates which table subjectRowId belongs to)
   * rather than a native FK. See design doc §13 for why a fully-normalized per-kind FK set was
   * rejected (it would require a separate nullable FK column per subject kind, all-but-one always
   * null, for a marginal integrity gain over a documented, narrowly-enumerated subjectKind).
   */
  subjectRowId: string;
  status: ReviewEventStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  note: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Convenience read views — DESIGN ONLY, implemented as SQL VIEWs in H.1, never base tables and
// never a place new facts are written. See design doc §6. Same row shape as the underlying table,
// filtered/joined to "current" rows only, so a dashboard query never has to know about versioning.
// ---------------------------------------------------------------------------
export type SalesIntelligenceCurrentCaseAnalysisRow = SalesIntelligenceCaseAnalysisRow; // view: WHERE is_current = true
export type SalesIntelligenceCurrentAttributionRow = SalesIntelligenceAttributionRow; // view: JOIN current case_analyses, WHERE is_current_evaluation = true

// ---------------------------------------------------------------------------
// Feature flags — see design doc §15. All default OFF except case-analysis persistence itself,
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

// ---------------------------------------------------------------------------
// Reprocessing-trigger vocabulary — see design doc "Reprocessing matrix". A pure enum + the
// decision it maps to, so the (future) reprocessing job's dispatch logic has a typed contract to
// implement against rather than re-deriving this table from prose each time.
// ---------------------------------------------------------------------------
export type ReprocessingTrigger =
  | 'raw_conversation_changed'
  | 'case_segmentation_logic_changed'
  | 'customer_identity_merge'
  | 'branch_mapping_changed'
  | 'invoice_candidates_updated'
  | 'invoice_item_data_appeared'
  | 'semantic_pipeline_version_changed'
  | 'policy_effective_date_changed'
  | 'protocol_policy_version_changed';

export type ReprocessingScope =
  | 'full_semantic_reanalysis' // new sales_intelligence_case_analyses row (new analysisId)
  | 'attribution_only' // new sales_intelligence_attributions evaluation, same analysisId
  | 'matching_integrity_only' // new basket_invoice_matches / sales_integrity_exceptions evaluation, same analysisId, same attribution row
  | 'compliance_only' // in-place update of case_analyses.policyCompliance only, no new row anywhere
  | 'stable_case_identity_review_required'; // segmentation logic changed enough that sales_intelligence_cases rows themselves may need to be added/retired — never automatic, always a flagged batch-review step.

export const REPROCESSING_MATRIX: Record<ReprocessingTrigger, ReprocessingScope> = {
  raw_conversation_changed: 'full_semantic_reanalysis',
  case_segmentation_logic_changed: 'stable_case_identity_review_required',
  customer_identity_merge: 'attribution_only',
  branch_mapping_changed: 'attribution_only',
  invoice_candidates_updated: 'attribution_only',
  invoice_item_data_appeared: 'matching_integrity_only',
  semantic_pipeline_version_changed: 'full_semantic_reanalysis',
  policy_effective_date_changed: 'compliance_only',
  protocol_policy_version_changed: 'full_semantic_reanalysis',
};
