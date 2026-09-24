// Sales Intelligence Phase H / H.0.1 / H.0.2 — Persistence Design Contracts.
//
// DESIGN ONLY. Pure TypeScript interfaces describing the PROPOSED storage shape for the B-G.3
// engine outputs (see ../types.ts for the semantic source of truth these rows are derived from).
// No Supabase client, no SQL, no migrations, no runtime logic anywhere in this file — see
// docs/SALES_INTELLIGENCE_PERSISTENCE_DESIGN.md for the full architecture this file supports.
//
// H.0.1: fixed a structural FK defect — `case_id` was used as a general FK target inside a table
// where it was NOT unique. Introduced `sales_intelligence_cases` (stable identity, PK = case_id,
// genuinely unique) and made `analysis_id` — never `case_id` — the provenance FK every dependent
// table points at.
//
// H.0.2 (this revision): fixed a historical-reproducibility defect in H.0.1 itself — H.0.1 still
// updated `protocolPolicyCompliance` IN PLACE on the (otherwise immutable) case_analyses row when
// policy config changed, which meant "what did A1 say under policy P1" became unanswerable once
// P2 overwrote it. `protocol_policy_compliance` is now split out into its own derived, versioned
// table (`sales_intelligence_policy_evaluations`) that references an IMMUTABLE `analysis_id` and
// an IMMUTABLE `policy_config_id` — `case_analyses` itself is now never mutated after write, full
// stop, no exceptions. `sales_intelligence_policy_config` is also now append-only/versioned rather
// than a single mutable row, for the same reason. See the design doc's "Phase H.0.2" section.
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
//
// H.0.2 identity-correction clarification (see design doc): `customerId`/`branchId` here are the
// CURRENT, CORRECTABLE canonical references — they may be updated later (a customer-identity
// merge, a branch-mapping fix) WITHOUT that being a semantic re-analysis. They are explicitly NOT
// the identity evidence a past analysis reasoned with — that snapshot lives on the analysis row
// itself (see `SalesIntelligenceCaseAnalysisRow.identityAtAnalysis` below), so correcting this
// table's pointer never destroys the evidence needed to explain an old, already-superseded
// analysis. Rule of thumb: `sales_intelligence_cases` = current canonical reference; the analysis
// row = identity facts/version actually used at that analysis's own time.
// ---------------------------------------------------------------------------
export interface SalesIntelligenceCaseRow {
  caseId: string; // PK. The same string the engines already compute (conversationId:interactionId[:session:N]).
  conversationId: string;
  sourceCaseIdV22: string | null;
  /** CURRENT canonical reference — correctable, e.g. by a later customer-identity merge. Never the sole record of what an old analysis saw (see module comment). */
  customerId: string | null;
  customerPhone: string | null;
  branchId: string | null;
  branchNameRaw: string | null;
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
//
// H.0.2: this row is now IMMUTABLE ONCE WRITTEN, full stop — no field on it is ever updated in
// place, not even policy compliance (which H.0.1 mistakenly still mutated in place; see
// SalesIntelligencePolicyEvaluationRow below for where that moved).
// ---------------------------------------------------------------------------
export interface CaseAnalysisProvenanceFields {
  analysisId: string; // PK (uuid) — the ONLY valid FK target for dependent tables. Never case_id.
  caseId: string; // FK -> sales_intelligence_cases.case_id. Safe now: that table guarantees uniqueness.
  analysisVersion: number; // monotonic per case_id, starting at 1.
  pipelineVersion: string; // e.g. 'sales-intelligence-v1' — independent of any git SHA.
  /** Only the engines whose output lives ON the case_analyses row itself — case segmentation, historical closure, commercial confirmation, protocol applicability. Attribution/matching/integrity engine versions live on THEIR OWN dependent rows because they can be re-evaluated independently without bumping analysis_version. */
  engineVersions: {
    caseSegmentation: string;
    historicalClosure: string;
    commercialConfirmation: string;
    protocolApplicability: string;
  };
  /**
   * Covers ONLY the inputs that could change case segmentation / historical closure / commercial
   * confirmation / protocol applicability: a hash of the raw conversation source text, plus
   * (where semantically material to segmentation) the branch/identity mapping version active at
   * analysis time. Deliberately EXCLUDES: `protocol_policy_effective_at` (policy changes must
   * never force a full re-analysis or mutate this row — see SalesIntelligencePolicyEvaluationRow),
   * resolved customer identity used for ATTRIBUTION purposes (see
   * AnalysisDependentProvenanceFields on SalesIntelligenceAttributionRow), and invoice
   * candidate/item data (affects attribution/matching/integrity only).
   */
  semanticSourceHash: string;
  analyzedAt: string;
  /** True only for the current, active analysis of this caseId — never more than one per caseId. */
  isCurrent: boolean;
  supersededAt: string | null;
  supersededByAnalysisId: string | null;
}

// ---------------------------------------------------------------------------
// Analysis-dependent provenance — for tables whose content can be re-evaluated WITHOUT a full
// semantic re-analysis (attribution, basket-invoice matching, integrity exceptions, policy
// evaluations). These get their OWN `evaluationVersion`, scoped within one `analysisId`, so e.g.
// "invoice item data finally became available" or "policy config changed" can bump the relevant
// evaluation without touching case segmentation/closure or forcing a new case_analyses row.
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
// H.0.2: fully immutable once written — see CaseAnalysisProvenanceFields's own comment. No
// `policyCompliance` field here anymore (moved to sales_intelligence_policy_evaluations).
// ---------------------------------------------------------------------------
export interface SalesIntelligenceCaseAnalysisRow extends CaseAnalysisProvenanceFields {
  caseType: CaseType;
  caseStatus: CaseStatus;

  pipelineStatus: PipelineStatus;
  overallEvidenceLevel: EvidenceLevel;

  /**
   * H.0.2: the identity facts/version actually used WHEN THIS ANALYSIS RAN — an immutable
   * snapshot, deliberately separate from `sales_intelligence_cases`'s own current/correctable
   * pointer fields (see that table's module comment). If a customer-identity merge later changes
   * `sales_intelligence_cases.customer_id`, THIS field on an already-superseded analysis stays
   * exactly what it was, so "what identity did A1 actually reason with" is always answerable.
   */
  identityAtAnalysis: {
    customerId: string | null;
    customerPhone: string | null;
    branchId: string | null;
    branchNameRaw: string | null;
  };

  caseStartedAt: string;
  caseEndedAt: string | null;

  /** SEMANTIC FACT — derived purely from conversation content, independent of any policy config. Never mixed with policy-derived state (see design doc's semantic-fact-vs-policy-evaluation split). */
  historicalClosureLevel: HistoricalClosureLevel;
  /** SEMANTIC FACT — Phase C's own formal state machine, independent of policy config. */
  commercialConfirmationState: CommercialConfirmationState;
  /**
   * SEMANTIC FACT — whether this case reached a stage where the 4-step protocol is meaningful to
   * evaluate at all. Derived from the conversation/commercial stage itself (historicalClosure +
   * commercialConfirmation + caseType), NOT from any policy config or effective date — this is
   * exactly why it stays here rather than moving to the policy-evaluation table alongside
   * `protocol_policy_compliance`: applicability is a fact about the CONVERSATION, compliance is a
   * fact about how that conversation reads AGAINST A POLICY, and only the latter can change
   * without the conversation itself changing.
   */
  protocolApplicability: OrderConfirmationProtocolApplicability;

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
    canonicalSalesOutcome: {
      caseId: string;
      outcome:
        | 'sale_proven'
        | 'order_confirmed_unproven'
        | 'customer_confirmed_unproven'
        | 'open_opportunity'
        | 'customer_rejected'
        | 'information_only'
        | 'needs_review'
        | 'unknown';
      saleProofState: 'proven' | 'strongly_supported' | 'weakly_supported' | 'unknown' | 'contradicted';
      isSaleCountable: boolean;
      isRevenueCountable: boolean;
      isOrderConfirmed: boolean;
      needsHumanReview: boolean;
      reasonCodes: string[];
    };
  };
}

// ---------------------------------------------------------------------------
// 2. sales_intelligence_case_baskets — immutable version history, provenance-tied to analysisId.
// disabled_by_default: G.3 observed 0 real multi-version baskets.
// `basket_version` (the CaseBasket's own version, from re-editing within one conversation) is a
// DIFFERENT axis than `analysisId`'s `analysisVersion` (a re-run of the semantic engines). One
// analysisId can own multiple basket_version rows (v1, v2, ... within that one analysis); a LATER
// analysisId (a full re-analysis) can reconstruct an entirely different basket history for the
// same case — both axes are preserved, never conflated.
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
// recomputed lazily, and never stored only on the stable case entity: if a later analysisId
// changes segmentation/attribution, the competing set is recomputed fresh and tied to the NEW
// evaluation, leaving the old evaluation's set exactly as it was.
// ---------------------------------------------------------------------------
export interface SalesIntelligenceAttributionRow extends AnalysisDependentProvenanceFields {
  /** The attribution engine's OWN version — separate from CaseAnalysisProvenanceFields.engineVersions because attribution can be re-evaluated (customer identity merge, branch mapping fix, new invoice candidates) without a full semantic re-analysis. */
  attributionEngineVersion: string;
  /**
   * Attribution's OWN narrower input hash — covers resolved customer identity (id + normalized
   * phone), the candidate invoice id set actually used, and branch mapping — NOT the raw
   * conversation text (that's semanticSourceHash's job) and NOT policy date (irrelevant to
   * attribution). Changing any of these bumps evaluationVersion, never analysisVersion.
   */
  attributionInputHash: string;
  /** The identity actually used for THIS evaluation — an immutable snapshot, same discipline as SalesIntelligenceCaseAnalysisRow.identityAtAnalysis, kept separately because attribution can be re-evaluated on a different identity snapshot than the one the semantic analysis itself recorded (e.g. a customer-identity merge lands after the semantic analysis but before attribution is re-run). */
  identityAtEvaluation: { customerId: string | null; customerPhone: string | null };

  selectedInvoiceId: string | null;
  selectedInvoiceNumber: string | null;
  attributionLevel: ConfidenceLevel;
  confidenceScore: number;

  /**
   * Staff-evaluation safety gate, part 1 of 2 (see module comment on
   * `StaffEvaluationSafetyRequirement` below for the full rule). Never true for
   * weakly_inferred/unknown attribution or unresolved ambiguity — unchanged from the engine's own
   * existing gate in saleAttributionEngine.ts.
   */
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
// item-level fields must never imply matching exists while sales_invoice_items_v21 = 0 rows —
// itemEvidenceReady is the structural gate a reader MUST check first. References the specific
// attribution row it was computed against (matching depends on attribution's selected invoice) —
// never re-derives or assumes which attribution is "current".
// ---------------------------------------------------------------------------
export interface SalesIntelligenceBasketInvoiceMatchRow extends AnalysisDependentProvenanceFields {
  /** FK -> SalesIntelligenceAttributionRow.id — the EXACT attribution evaluation this match was computed against, never "whichever is current now". */
  attributionRowId: string;
  matchingEngineVersion: string;
  /**
   * H.1B live-schema fix: matching's OWN input hash — covers the active basket state (items +
   * quantities actually evaluated) and the selected invoice's header/item fields, plus
   * matchingEngineVersion. NOT the raw conversation text (semanticSourceHash) and NOT the
   * attribution decision itself (attributionInputHash) — only what this specific match evaluation
   * was computed from. Idempotency key alongside (analysisId, attributionRowId, evaluationVersion).
   */
  matchingInputHash: string;

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
// disabled_by_default: G.3 observed 0 real exceptions, root-caused to `headerEvidenceReady`
// essentially never being true on real data — do not invent semantics for a path that has never
// actually fired.
// `exceptionId` is deterministically derived from (analysisId, evaluationVersion, type, canonical
// subject) — NEVER from case_id alone. The same LOGICAL exception recurring across two different
// analyses (A1 and A2) gets two distinct persisted rows; a later evaluation of the SAME analysisId
// (e.g. once item data appears) also gets its own distinct row rather than overwriting the earlier
// evaluation's finding.
// ---------------------------------------------------------------------------
export interface SalesIntegrityExceptionRow extends AnalysisDependentProvenanceFields {
  /** Deterministic: hash(analysisId + evaluationVersion + type + canonicalSubject). See module comment above. */
  exceptionId: string;
  integrityEngineVersion: string;

  type: SalesIntegrityExceptionType;
  stage: SalesIntegrityStage;
  severity: SalesIntegritySeverity;
  /** Engine output is always 'open' at write time — see human-review lifecycle for how this can change AFTER persistence, via a separate table, never by mutating this row. */
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
// 6. sales_intelligence_policy_config — H.0.2: now APPEND-ONLY/VERSIONED, never a single mutable
// row. Every change to the policy (effective date, enabled flag, or the underlying protocol-step
// requirements) creates a NEW row with a new `policyConfigId`/`policyConfigVersion`; the previous
// row is marked `isCurrent = false`/`supersededAt` and kept forever, exactly like case_analyses.
// This is what makes "which policy config produced this evaluation" a stable, permanent fact
// rather than a lookup into a value that may since have been overwritten.
// ---------------------------------------------------------------------------
export interface SalesIntelligencePolicyConfigRow {
  policyConfigId: string; // uuid PK — the real, permanent identity of one specific config.
  policyConfigVersion: number; // monotonic global counter, human-readable alongside policyConfigId.
  /** null == "opted in, no date configured yet" (matches deriveProtocolPolicyComplianceState's own `null` semantics) — never a guessed/default date. */
  protocolPolicyEffectiveAt: string | null;
  enabled: boolean;
  /** When THIS config version itself became the active one — distinct from protocolPolicyEffectiveAt, which is the date historical CASES are compared against, not when the config row was created. */
  effectiveFrom: string;
  supersededAt: string | null;
  isCurrent: boolean;
  createdAt: string;
  createdBy: string; // staff/user id — never a raw name string.
}

// ---------------------------------------------------------------------------
// 6b. sales_intelligence_policy_evaluations — H.0.2 NEW TABLE. The derived POLICY-EVALUATION
// output that H.0.1 mistakenly still stored in-place on the immutable case_analyses row. This is
// NOT another semantic analysis: it is a lightweight, versioned evaluation of ONE immutable
// analysis (`analysisId`) under ONE immutable policy config (`policyConfigId`). See design doc's
// "Phase H.0.2" section for the full policy-change lifecycle this enables:
//   Analysis A1 evaluated under Policy P1 -> Evaluation E1 (not_enforced, say).
//   Policy changes to P2 -> a NEW Evaluation E2 is created for the SAME A1 (e.g. non_compliant).
//   E1 remains, forever, exactly as it was — "what was visible under P1" stays answerable.
// A NEW analysis (A2, from an unrelated raw-text change) gets evaluated against whichever policy
// config is CURRENT at that time, producing its own initial evaluation — the two timelines
// (semantic re-analysis vs. policy re-evaluation) never interfere with each other.
// ---------------------------------------------------------------------------
export interface SalesIntelligencePolicyEvaluationRow {
  policyEvaluationId: string; // uuid PK
  analysisId: string; // FK -> sales_intelligence_case_analyses.analysis_id — the exact IMMUTABLE analysis being evaluated. Never changes for this row once written.
  caseId: string; // redundant, indexed, for debugging/filtering only — never the FK.
  policyConfigId: string; // FK -> sales_intelligence_policy_config.policy_config_id — the exact IMMUTABLE config version used.
  policyConfigVersion: number; // denormalized copy of the config's own version number, for cheap display without a join.
  /** Snapshot of the config's own effective date AT THE TIME this evaluation ran — denormalized for the same reason as policyConfigVersion (the config row itself is immutable too, so this never drifts, but keeping it here avoids a join for the single most commonly displayed field). */
  protocolPolicyEffectiveAt: string | null;
  /** Copied from the analysis at evaluation time, for audit/display convenience — NEVER authoritative; sales_intelligence_case_analyses.protocolApplicability is the one true source. */
  protocolApplicability: OrderConfirmationProtocolApplicability;
  /** POLICY-DERIVED EVALUATION — the one field this whole table exists to hold. */
  protocolPolicyCompliance: ProtocolPolicyComplianceState;
  evaluationVersion: number; // monotonic within analysisId, scoped to policy evaluations specifically (independent of attribution's/matching's own evaluationVersion counters).
  /** Deterministic hash of (analysisId's protocolApplicability + caseEndedAt + policyConfigId) — the exact inputs this evaluation was computed from. */
  policyInputHash: string;
  isCurrent: boolean;
  evaluatedAt: string;
  supersededAt: string | null;
  supersededByPolicyEvaluationId: string | null;
}

// ---------------------------------------------------------------------------
// 7. sales_intelligence_review_events — human-review lifecycle, kept SEPARATE from engine output.
// H.0.2: adds `policyEvaluationId` so a review of a policy-compliance finding stays pinned to the
// exact policy evaluation (E1), never silently reassigned when a later evaluation (E2) becomes
// current — same discipline as `analysisId` already had in H.0.1, now extended to this new axis.
// ---------------------------------------------------------------------------
export type ReviewSubjectKind =
  | 'attribution_ambiguity'
  | 'identity_conflict'
  | 'branch_conflict'
  | 'integrity_exception'
  | 'case_segmentation_ambiguity'
  | 'basket_conflict'
  | 'policy_compliance_finding';

export type ReviewEventStatus = 'open' | 'reviewed' | 'resolved' | 'dismissed';

export interface SalesIntelligenceReviewEventRow {
  eventId: string;
  caseId: string; // kept for cross-analysis lookup ("show me every review this case has ever had").
  analysisId: string; // the EXACT analysis reviewed — pinned permanently, never updated to a newer analysisId.
  /** Set only when subjectKind === 'policy_compliance_finding' — pins the review to the EXACT policy evaluation (E1) a manager looked at. Never reassigned to a later evaluation (E2) — see design doc §7. */
  policyEvaluationId: string | null;
  subjectKind: ReviewSubjectKind;
  /**
   * Points at the specific row this review concerns (an attribution row id, a match row id, an
   * exceptionId, or a policyEvaluationId) — no single DB-level FK type fits every subject kind, so
   * referential integrity is preserved by convention (subjectKind disambiguates which table
   * subjectRowId belongs to) rather than a native FK.
   */
  subjectRowId: string;
  status: ReviewEventStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  note: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Staff-evaluation safety — H.0.2 makes this STRUCTURALLY queryable rather than a UI convention
// (per the explicit instruction). Any future staff-KPI consumer MUST join through BOTH gates
// below; neither alone is sufficient. This type documents the join shape a real query/view would
// need to implement — it is not itself a table, just the contract H.1B's writers and any future
// KPI reader must honor.
//
// Concretely: "historical closure strongly_inferred" + "policy evaluation not_enforced" must NEVER
// become a protocol penalty, because gate 2 (currentPolicyEvaluation.protocolPolicyCompliance)
// is 'not_enforced', not 'non_compliant' — a KPI consumer that only checked gate 1
// (attribution.isOfficialForStaffEvaluation, or worse, historicalClosureLevel directly) would miss
// this and wrongly penalize. Both gates are required, always, with no exception.
// ---------------------------------------------------------------------------
export interface StaffEvaluationSafetyRequirement {
  /** Gate 1: correct/official semantic evidence. Must be true. */
  attributionIsOfficialForStaffEvaluation: boolean;
  /** Gate 2: a CURRENT, ENFORCED policy evaluation. Must equal 'compliant' or 'non_compliant' — 'not_enforced'/'not_applicable'/'not_reached'/'unknown' must NEVER be read as, or silently treated as equivalent to, a violation. */
  currentPolicyEvaluationCompliance: ProtocolPolicyComplianceState;
}

/** True only when BOTH structural gates hold — the ONLY condition under which a case may ever contribute to a staff protocol-compliance KPI. */
export function isActionableForStaffProtocolKpi(gates: StaffEvaluationSafetyRequirement): boolean {
  return (
    gates.attributionIsOfficialForStaffEvaluation &&
    (gates.currentPolicyEvaluationCompliance === 'compliant' || gates.currentPolicyEvaluationCompliance === 'non_compliant')
  );
}

// ---------------------------------------------------------------------------
// Convenience read views — DESIGN ONLY, implemented as SQL VIEWs in H.1A, never base tables and
// never a place new facts are written. Same row shape as the underlying table, filtered/joined to
// "current" rows only, so a dashboard query never has to know about versioning.
// ---------------------------------------------------------------------------
export type SalesIntelligenceCurrentCaseAnalysisRow = SalesIntelligenceCaseAnalysisRow; // view: WHERE is_current = true
export type SalesIntelligenceCurrentAttributionRow = SalesIntelligenceAttributionRow; // view: JOIN current case_analyses, WHERE is_current_evaluation = true
export type SalesIntelligenceCurrentPolicyEvaluationRow = SalesIntelligencePolicyEvaluationRow; // view: WHERE is_current = true, joined against current case_analyses via analysis_id

// ---------------------------------------------------------------------------
// Feature flags — all default OFF except case-analysis persistence itself, which is "enabled only
// after review" (i.e. also starts false until a human turns it on).
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
// Batch pipeline contracts. Pure shape only; no I/O here.
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
 * The output of the batch pipeline's cross-case competing-selection resolution step, computed
 * ONCE per batch, BEFORE any attribution row is persisted. Mirrors the G.3 shadow harness's own
 * two-pass pattern, but as a real batch-time step instead of a validation-only harness.
 */
export interface CompetingCaseResolution {
  invoiceId: string;
  caseIds: string[];
}

// ---------------------------------------------------------------------------
// Reprocessing-trigger vocabulary. A pure enum + the decision it maps to, so the (future)
// reprocessing job's dispatch logic has a typed contract to implement against rather than
// re-deriving this table from prose each time.
//
// H.0.2: `policy_effective_date_changed` and `protocol_policy_version_changed` now both map to
// `policy_evaluation_only` (a NEW SalesIntelligencePolicyEvaluationRow, never a mutation of
// case_analyses) rather than the old `compliance_only` in-place-mutation scope.
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
  | 'policy_evaluation_only' // new sales_intelligence_policy_evaluations row, same analysisId — case_analyses is NEVER mutated (H.0.2 fix)
  | 'stable_case_identity_review_required'; // segmentation logic changed enough that sales_intelligence_cases rows themselves may need to be added/retired — never automatic, always a flagged batch-review step.

export const REPROCESSING_MATRIX: Record<ReprocessingTrigger, ReprocessingScope> = {
  raw_conversation_changed: 'full_semantic_reanalysis',
  case_segmentation_logic_changed: 'stable_case_identity_review_required',
  customer_identity_merge: 'attribution_only',
  branch_mapping_changed: 'attribution_only',
  invoice_candidates_updated: 'attribution_only',
  // Line items now participate in BOTH invoice attribution and basket matching. Re-evaluate
  // attribution first; the normal dependent pass then recomputes matching/integrity against the
  // potentially changed selected invoice.
  invoice_item_data_appeared: 'attribution_only',
  semantic_pipeline_version_changed: 'full_semantic_reanalysis',
  policy_effective_date_changed: 'policy_evaluation_only',
  protocol_policy_version_changed: 'full_semantic_reanalysis',
};
