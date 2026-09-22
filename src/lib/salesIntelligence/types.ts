// Dawaa Sales Intelligence & Sales Integrity Engine — Phase A: Architecture + Contracts only.
//
// PURE TYPE DEFINITIONS. No engine logic, no Supabase calls, no migrations here — see the
// Phase A report sent alongside this file for the data-mapping rationale, the existing tables
// each type builds on top of (never duplicates), and the open questions for review before
// Phase B starts. Nothing in this file is wired into the app yet; it is additive and inert.
//
// FACT / INFERENCE / INTERPRETATION SEPARATION (mirrors the V32 evidence-contract philosophy in
// src/lib/whatsappCriterionEvidenceV32.ts): every conclusion this engine reaches carries a
// ConfidenceAssessment with typed evidence and rule ids — never a bare boolean or a free-text
// verdict. A `weakly_inferred` or `unknown` confidence must never be treated as a proven fact by
// any downstream consumer (see SaleAttribution.isOfficialForStaffEvaluation).

// ---------------------------------------------------------------------------
// Shared evidence/confidence vocabulary
// ---------------------------------------------------------------------------

/** How certain this engine is about a derived conclusion — never invented, always rule-traceable. */
export type ConfidenceLevel = 'proven' | 'strongly_inferred' | 'weakly_inferred' | 'unknown';

/** A pointer to the actual row(s)/message(s) a conclusion is grounded in — never paraphrased away. */
export interface EvidenceRef {
  /** The table the fact was read from, e.g. 'whatsapp_review_sources', 'sales_invoices', 'sales_invoice_items_v21'. */
  sourceTable: string;
  sourceId: string;
  messageIds?: string[];
  /** An objective statement of what was read — no judgment language (same rule as V32's `fact` field). */
  description: string;
}

export interface ConfidenceAssessment {
  level: ConfidenceLevel;
  /** 0-1, produced by a deterministic, documented formula — never a free-floating model guess. */
  score: number;
  /** Which named rule(s) produced this assessment — lets a reviewer trace "why" to exact code. */
  ruleIds: string[];
  evidence: EvidenceRef[];
}

// ---------------------------------------------------------------------------
// Phase 1 — Conversation Case Engine
// ---------------------------------------------------------------------------

export type CaseType =
  | 'information_only'
  | 'sales_opportunity'
  | 'complaint'
  | 'follow_up'
  | 'mixed'
  | 'unknown';

export type CaseStatus =
  | 'information_only'
  | 'sales_opportunity'
  | 'basket_building'
  | 'awaiting_customer_confirmation'
  | 'customer_confirmed'
  | 'sent_for_fulfillment'
  | 'invoiced'
  | 'delivered'
  | 'lost'
  | 'cancelled'
  | 'unknown';

/**
 * A single independent commercial journey inside a conversation. NOT a 1:1 replacement for
 * `whatsapp_customer_cases_v22` (that table's "case" is a session-merging/message-grouping
 * concept with no basket model — see the Phase A report §6). `sourceCaseIdV22` links back to it
 * for traceability; a v22 case may in principle contain more than one ConversationCase later,
 * but Phase B starts 1:1 for simplicity.
 */
export interface ConversationCase {
  caseId: string;
  /** == whatsapp_review_sources.id (or its root_source_id) for the conversation this case reads. */
  conversationId: string;
  sourceCaseIdV22: string | null;
  /** customers.id once resolved — never invented when phone-only match is ambiguous (see report §9). */
  customerId: string | null;
  customerPhone: string | null;
  /** branches.id — a real FK, unlike the free-text `branch`/`branch_name` columns on legacy tables. */
  branchId: string | null;
  /** The raw text branch label as it actually appears in source rows — kept even after branchId resolves. */
  branchNameRaw: string | null;
  startedAt: string;
  endedAt: string | null;
  primaryIntent: CaseType;
  caseType: CaseType;
  status: CaseStatus;
  confidence: ConfidenceAssessment;
  createdFrom: 'v32_shadow' | 'manual_review' | 'backfill';
  needsHumanReview: boolean;
  humanReviewReasons: string[];
}

// ---------------------------------------------------------------------------
// Case Stage Events — append-only, mirrors the customer_requests / customer_request_events
// canonical-state + event-log pattern already in production (see Phase A report §7).
// ---------------------------------------------------------------------------

export type CaseStage =
  | 'need_detected'
  | 'product_identified'
  | 'availability_known'
  | 'price_presented'
  | 'basket_built'
  | 'final_basket_presented'
  | 'customer_confirmed'
  | 'staff_confirmed'
  | 'order_created'
  | 'invoice_created'
  | 'fulfilled'
  | 'delivered'
  | 'repeat_purchase';

export interface CaseStageEvent {
  eventId: string;
  caseId: string;
  stage: CaseStage;
  occurredAt: string;
  evidence: EvidenceRef[];
  confidence: ConfidenceAssessment;
  notes: string | null;
}

// ---------------------------------------------------------------------------
// Phase 2 — Structured Basket Engine
// ---------------------------------------------------------------------------

export type BasketStatus = 'draft' | 'awaiting_confirmation' | 'confirmed' | 'superseded' | 'cancelled';

/**
 * A specific version of a case's basket. A customer edit (add/remove/change quantity) after an
 * earlier confirmation NEVER mutates this row — it produces a new CaseBasket with
 * version = previous + 1, and the previous row's status becomes 'superseded'. Only the highest
 * version with status='confirmed' is the `final_confirmed_basket`.
 */
export interface CaseBasket {
  basketId: string;
  caseId: string;
  version: number;
  status: BasketStatus;
  createdAt: string;
  /** When the staff sent the "تم تأكيد الطلب..." final confirmation for this exact version. */
  confirmedAt: string | null;
  /** When the customer's own confirmation for this exact version was evidenced. */
  confirmedByCustomerAt: string | null;
  staffId: string | null;
  announcedTotal: AnnouncedTotal | null;
  sourceMessageIds: string[];
  confidence: ConfidenceAssessment;
  /** Set on the row once a newer version replaces it. */
  supersededByBasketId: string | null;
}

export type ItemResolutionStatus = 'proven' | 'partially_proven' | 'missing' | 'contradicted' | 'unknown';

export interface CaseBasketItem {
  itemId: string;
  basketId: string;
  /** The product name exactly as typed/said — a fact, never normalized away. */
  productNameRaw: string;
  /** products.id once resolved — an interpretation layered on top of productNameRaw, kept separate. */
  productId: string | null;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  lineTotal: number | null;
  sourceMessageId: string;
  confidence: ConfidenceAssessment;
  resolutionStatus: ItemResolutionStatus;
}

// ---------------------------------------------------------------------------
// Phase 3/4 — Order Confirmation Protocol + Announced Total
// ---------------------------------------------------------------------------

/**
 * The total the staff told the customer, tied to the exact basket version it was announced for.
 * If the basket changes after this total was announced, the OLD AnnouncedTotal is superseded —
 * never silently reused against a newer basket.
 */
export interface AnnouncedTotal {
  amount: number;
  currency: 'EGP';
  messageId: string;
  staffId: string | null;
  announcedAt: string;
  basketVersion: number;
  supersededByTotalId: string | null;
}

// ---------------------------------------------------------------------------
// Phase C — Final Confirmation + Announced Total + Commercial Confirmation State
//
// This is the canonical commercial state INSIDE the conversation, established before any
// invoice/order linking is attempted (Phase D). "commercial_confirmation_complete" is never
// "sold" — a sale is only ever confirmed later by order/invoice evidence (Phase 5/6/9).
// ---------------------------------------------------------------------------

/**
 * The moment a staff message qualifies as a genuine consolidated order recap — never every
 * product-list mention. One event per (basketId, basketVersion): a later final summary for the
 * same version is a re-presentation, not a second event (see deriveCommercialConfirmationState).
 */
export interface FinalBasketSummaryEvent {
  eventId: string;
  caseId: string;
  basketId: string;
  basketVersion: number;
  staffId: string | null;
  messageId: string;
  presentedAt: string;
  evidence: EvidenceRef[];
  ruleIds: string[];
  confidence: ConfidenceAssessment;
}

/**
 * A customer confirmation CONTEXTUALLY LINKED to a specific final-basket-summary/version — never
 * a bare "تمام" credited to a basket merely because one exists earlier in the conversation.
 */
export interface CustomerConfirmationEvent {
  eventId: string;
  caseId: string;
  basketId: string;
  basketVersion: number;
  messageId: string;
  confirmedAt: string;
  relatedSummaryMessageId: string | null;
  evidence: EvidenceRef[];
  ruleIds: string[];
  confidence: ConfidenceAssessment;
}

/**
 * Distinct from CustomerConfirmationEvent: this is the STAFF's own final "order registered /
 * being prepared" message, which only ever fires after a customer confirmation exists for the
 * same basket version. Reaching this means `commercial_confirmation_complete`, never `sold`.
 */
export interface StaffFinalConfirmationEvent {
  eventId: string;
  caseId: string;
  basketId: string;
  basketVersion: number;
  staffId: string | null;
  messageId: string;
  confirmedAt: string;
  evidence: EvidenceRef[];
  ruleIds: string[];
  confidence: ConfidenceAssessment;
}

/**
 * Phase C.1: trimmed to only states `deriveCommercialConfirmationState` can actually produce —
 * see the Phase C.1 report for the reachability audit. Three states from the original Phase C
 * draft were removed, each for a documented reason, not silently:
 *   - `final_summary_presented` — a summary event always immediately implies "now waiting on the
 *     customer" in this engine; the raw fact is already exposed via `summaryPresented` and the
 *     FinalBasketSummaryEvent record itself, so a separate state was pure redundancy.
 *   - `staff_confirmed` — structurally, by caseBasketEngine's own invariants, staff confirmation
 *     can only ever be observed together with customer confirmation AND a presented summary for
 *     the same version (isStaffFinalConfirmation only fires once `status === 'confirmed'`), which
 *     is exactly `commercial_confirmation_complete`'s own condition — never a distinct moment.
 *   - `cancelled` — reserved for a future explicit administrative/staff cancellation event; Phase
 *     C has no source for it (only a customer-initiated whole-basket rejection, `rejected`, exists
 *     today). Re-add it in whichever future phase actually produces that event.
 * `unknown` stays: reachable via the "no basket at all" guard (e.g. a case whose only messages
 * are automated/non-meaningful) — see the reachability tests.
 */
export type CommercialConfirmationState =
  | 'basket_in_progress'
  | 'awaiting_customer_confirmation'
  | 'customer_confirmed'
  | 'modified_after_confirmation'
  | 'commercial_confirmation_complete'
  | 'rejected'
  | 'unknown';

/**
 * Assessed against the CURRENT (latest, non-superseded) basket version only. A version that was
 * confirmed and later superseded by a customer modification stays historically true on its own
 * (superseded) CaseBasket row — it is never re-used as "permission" for the new version, which
 * must independently reach its own summary/confirmation/staff-confirmation before this can read
 * `commercial_confirmation_complete` again.
 */
export interface CommercialConfirmationAssessment {
  caseId: string;
  basketId: string;
  basketVersion: number;
  summaryPresented: boolean;
  customerConfirmed: boolean;
  staffConfirmed: boolean;
  announcedTotalPresent: boolean;
  /** True when an earlier version of THIS case was customer-confirmed and then superseded. */
  modificationAfterConfirmation: boolean;
  currentState: CommercialConfirmationState;
  primaryMessageIds: string[];
  ruleIds: string[];
  confidence: ConfidenceAssessment;
  needsHumanReview: boolean;
  humanReviewReasons: string[];
}

/**
 * Phase C.1: deliberately SEPARATE from CommercialConfirmationAssessment. Commercial truth
 * (`commercial_confirmation_complete`) never requires an announced total — an older/organic
 * conversation can have a real summary + real customer acceptance + real staff "جاري الإرسال"
 * with no total ever stated aloud, and that IS a completed commercial confirmation. Protocol
 * compliance is a stricter, separate, operational lens for measuring staff adherence to the
 * FULL 4-step pharmacy protocol (summary + total + customer confirmation + staff confirmation)
 * — a case can be `commercial_confirmation_complete: true` while `protocolCompliant: false`.
 * Never conflate the two: protocol non-compliance is a coaching signal, not a reason to doubt
 * that a sale was commercially agreed.
 */
export interface OrderConfirmationProtocolAssessment {
  caseId: string;
  basketId: string;
  basketVersion: number;
  summaryCompliant: boolean;
  announcedTotalCompliant: boolean;
  customerConfirmationCompliant: boolean;
  staffFinalConfirmationCompliant: boolean;
  protocolCompliant: boolean;
  missingProtocolSteps: string[];
}

// ---------------------------------------------------------------------------
// Phase D — Sale Attribution Engine
//
// CORE RULE: the AI never proves that a sale happened — an invoice/order is what proves a
// commercial transaction occurred. This engine only proves or estimates whether a REAL invoice
// belongs to a specific ConversationCase. `commercial_confirmation_complete` (Phase C) never by
// itself upgrades an attribution past `weakly_inferred` — see deriveSaleAttributionAssessment's
// own doc comment in saleAttributionEngine.ts. sales_invoices carries no FK to customers/staff/
// branch in the live schema (see the Phase D schema investigation) — every link here is built and
// scored at the application layer, never trusted from a schema relationship that doesn't exist.
// ---------------------------------------------------------------------------

export type AttributionEvidenceKind =
  | 'same_customer_id'
  | 'same_phone'
  | 'same_branch'
  | 'time_proximity'
  | 'product_match'
  | 'quantity_match'
  | 'announced_total_match'
  | 'basket_value_match'
  | 'same_staff'
  | 'compatible_staff'
  | 'direct_order_id'
  | 'direct_invoice_id'
  | 'legacy_v17_match'
  | 'identity_conflict'
  | 'branch_mismatch'
  | 'temporal_inversion';

export interface AttributionEvidenceItem {
  kind: AttributionEvidenceKind;
  matched: boolean;
  detail: string;
  weight: number;
}

/** Exact canonical identity vs phone-only vs name-only vs an unresolved conflict between sources. */
export type IdentityConflictStatus = 'none' | 'phone_vs_customer_id_conflict';

export type BranchMatchKind = 'exact_canonical' | 'normalized_alias_match' | 'mismatch' | 'unknown';

/** Centralized, documented time-distance bands — see TIME_MATCH_BANDS in saleAttributionEngine.ts. */
export type TimeMatchStrength = 'very_strong' | 'strong' | 'moderate' | 'weak' | 'very_weak' | 'unknown';

/** Reused for both announced-total-vs-invoice and basket-value-vs-invoice comparisons. */
export type AmountMatchKind = 'exact' | 'near_match' | 'different' | 'not_available';

/**
 * A different staff member on the invoice must never auto-disqualify a candidate (one doctor may
 * advise, another may close/invoice) — see the Phase D spec §12. `compatible` is reported (rather
 * than collapsing to `different`) only when the case itself already shows more than one
 * contributing staff member, i.e. a multi-staff case where a third closer is plausible.
 */
export type StaffCompatibility = 'same' | 'compatible' | 'different' | 'unknown';

/** Driven by an InvoiceItemEvidenceProvider — 'unavailable' whenever sales_invoice_items_v21 has
 * no rows for this invoice, which is the common case today. Never faked from the header total. */
export type ProductEvidenceAvailability = 'available_match' | 'available_mismatch' | 'unavailable';

/**
 * One invoice's candidacy for a specific ConversationCase, with every evidence dimension kept
 * separately inspectable — never collapsed into a single opaque score. Not all fields need to be
 * populated: a header-only invoice with no item rows leaves productMatch/quantityMatch
 * 'unavailable' rather than guessing.
 */
export interface SaleAttributionCandidate {
  caseId: string;
  /** sales_invoices.id — text, not uuid, in the live schema (see Phase D schema investigation). */
  invoiceId: string;
  invoiceNumber: string | null;
  /** Exact canonical customers.id match between the case and this invoice row. */
  customerIdMatch: boolean;
  /** Exact normalized-Egyptian-mobile match (src/lib/customers/customerIdentity.ts, reused). */
  phoneMatch: boolean;
  identityConflict: IdentityConflictStatus;
  branchMatch: BranchMatchKind;
  timeDistanceMinutes: number | null;
  timeMatchStrength: TimeMatchStrength;
  staffMatch: StaffCompatibility;
  announcedTotalMatch: AmountMatchKind;
  basketValueMatch: AmountMatchKind;
  productMatch: ProductEvidenceAvailability;
  quantityMatch: ProductEvidenceAvailability;
  /** True only when V17's own matched_invoice_id/number equals THIS candidate — never sufficient alone. */
  legacyEvidenceMatch: boolean;
  /** Always false today — no `orders` table exists in the live schema (see investigation). Kept for forward compatibility. */
  directOrderLink: boolean;
  /** True only when the caller supplies an explicit, already-trusted system link (e.g. whatsapp_review_sources.matched_invoice_id) that equals this candidate. The only path to `proven`. */
  directInvoiceLink: boolean;
  evidence: AttributionEvidenceItem[];
  ruleIds: string[];
  confidenceAssessment: ConfidenceAssessment;
  /** Named reasons this candidate's level was capped or flagged — never silently dropped. */
  disqualifiers: string[];
}

/**
 * The case-level result of Phase D. `hasAttributedInvoice` is the ONLY outcome-adjacent signal
 * this phase exposes — never `sold`/`lost`/etc. (Phase 9's job). `isOfficialForStaffEvaluation`
 * is a hard gate: false for anything short of `proven` or a clean, unambiguous, uncontested
 * `strongly_inferred` — see the gate's own implementation for the exact conditions.
 */
export interface SaleAttributionAssessment {
  caseId: string;
  commercialConfirmationState: CommercialConfirmationState;
  candidateCount: number;
  selectedInvoiceId: string | null;
  selectedInvoiceNumber: string | null;
  selectedCandidate: SaleAttributionCandidate | null;
  alternativeCandidates: SaleAttributionCandidate[];
  attributionLevel: ConfidenceLevel;
  confidence: ConfidenceAssessment;
  primaryEvidence: AttributionEvidenceItem[];
  contradictions: string[];
  needsHumanReview: boolean;
  humanReviewReasons: string[];
  isOfficialForStaffEvaluation: boolean;
  legacyEvidenceUsed: boolean;
  ruleIds: string[];
  /** Phase D stops here — no sold/lost/outcome classification (that is a later phase's job). */
  hasAttributedInvoice: boolean;
  /** Other caseIds independently attributed to the SAME invoice — flagged, never auto-resolved. */
  competingCaseIds: string[];
}

// ---------------------------------------------------------------------------
// Phase E — Basket <-> Invoice Matching Engine
//
// Compares the case's CURRENT (latest, never-superseded) basket version against the invoice
// Phase D already selected — never re-derives attribution, never touches a superseded basket
// version or its total. Never assigns staff fault: differences are facts about WHAT differs,
// never WHO is responsible — see BasketInvoiceDifference's own doc comment.
// ---------------------------------------------------------------------------

/**
 * A single field-level match verdict, reused across total/item/quantity/overall so every
 * dimension speaks the same vocabulary. Not every state is reachable for every field — see each
 * classifier's own doc comment in basketInvoiceMatchingEngine.ts for which ones it actually
 * produces (mirrors the Phase C.1 reachability discipline: never leave an unreachable state
 * undocumented).
 */
export type FieldMatchStatus = 'exact' | 'near_match' | 'partial' | 'mismatch' | 'insufficient_data';

export type BasketInvoiceDifferenceType =
  | 'missing_item'
  | 'extra_item'
  | 'quantity_mismatch'
  | 'total_mismatch'
  | 'explained_difference'
  | 'unexplained_difference';

/** A documented reason a total (or item) difference exists — only ever set when real evidence backs it, never guessed. */
export type DifferenceExplanationKind = 'delivery_fee' | 'discount' | 'cashback' | 'documented_edit' | 'none';

/**
 * A single detected difference between the basket and the invoice — a FACT about what differs,
 * never a verdict about who caused it. No staff id, no fault language, no "employee error" ever
 * appears here or anywhere in this engine's output.
 */
export interface BasketInvoiceDifference {
  type: BasketInvoiceDifferenceType;
  /** A product name (normalized as typed) or 'total' — identifies which line the difference is about. */
  key: string;
  /** The basket-side value (quantity, or amount for 'total'). */
  before: string | number | null;
  /** The invoice-side value. */
  after: string | number | null;
  explanation: DifferenceExplanationKind;
  evidence: EvidenceRef[];
  confidence: ConfidenceAssessment;
}

/**
 * The case-level result of Phase E. Total/item/quantity are tracked SEPARATELY — an exact
 * `totalMatch` alone can never promote `overallMatch` to 'exact' (a header-only invoice with no
 * item evidence caps `overallMatch` at 'partial' at best; see rollupOverallMatch's own comment).
 * When Phase D's attribution is `unknown`, every field here is `insufficient_data` — Phase E never
 * guesses an invoice to compare against.
 */
export interface BasketInvoiceMatch {
  matchId: string;
  caseId: string;
  basketId: string | null;
  basketVersion: number | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  totalMatch: FieldMatchStatus;
  itemMatch: FieldMatchStatus;
  quantityMatch: FieldMatchStatus;
  overallMatch: FieldMatchStatus;
  /** True only when a real InvoiceItemEvidenceProvider returned rows — never assumed. */
  itemEvidenceAvailable: boolean;
  differences: BasketInvoiceDifference[];
  confidence: ConfidenceAssessment;
  needsHumanReview: boolean;
  humanReviewReasons: string[];
  ruleIds: string[];
}

// ---------------------------------------------------------------------------
// Phase 7 — Sales Integrity Engine
// ---------------------------------------------------------------------------

/**
 * Naming is deliberate: these are `operational_exception`s, never an accusation. `relatedStaffId`
 * records who touched the relevant stage as a FACT (for drill-down), not a verdict — see
 * instruction #15: never load an employee with fault from weak inference.
 */
export type IntegrityExceptionType =
  | 'confirmed_item_not_in_order'
  | 'order_item_not_in_invoice'
  | 'invoice_item_not_delivered'
  | 'quantity_mismatch'
  | 'price_mismatch'
  | 'total_mismatch'
  | 'confirmed_order_without_invoice'
  | 'invoice_without_case'
  | 'unrecorded_post_confirmation_edit'
  | 'confirmed_basket_not_sent_for_fulfillment'
  | 'order_without_customer_final_confirmation'
  | 'staff_said_sending_without_order_or_invoice';

export interface SalesIntegrityException {
  exceptionId: string;
  caseId: string;
  type: IntegrityExceptionType;
  detectedAt: string;
  evidence: EvidenceRef[];
  confidence: ConfidenceAssessment;
  relatedStaffId: string | null;
  status: 'open' | 'investigating' | 'explained' | 'dismissed';
}

// ---------------------------------------------------------------------------
// Phase 8 — Stock / Balance Investigation Support (flags only, never a verdict)
// ---------------------------------------------------------------------------

export type StockInvestigationFlagType =
  | 'possible_unregistered_item'
  | 'possible_invoice_omission'
  | 'possible_fulfillment_mismatch'
  | 'stock_investigation_required';

export interface StockInvestigationFlag {
  flagId: string;
  caseId: string;
  type: StockInvestigationFlagType;
  evidence: EvidenceRef[];
  confidence: ConfidenceAssessment;
}

// ---------------------------------------------------------------------------
// Phase 9 — Sales Outcome Engine
// ---------------------------------------------------------------------------

export type SalesOutcome =
  | 'sold'
  | 'pending'
  | 'customer_declined_price'
  | 'out_of_stock'
  | 'alternative_rejected'
  | 'no_alternative_offered'
  | 'customer_stopped_replying'
  | 'staff_no_reply'
  | 'delivery_issue'
  | 'customer_will_buy_later'
  | 'information_only'
  | 'cancelled'
  | 'unknown';

/**
 * `whatsapp_sales_opportunities_v17` already tracks a per-conversation opportunity stage/status
 * with invoice-matching fields (matched_invoice_number/matched_invoice_item_id) — see Phase A
 * report §9. CaseOutcome is meant to consume/extend that existing signal, not recompute a
 * competing answer to "did this conversation convert" from zero.
 */
export interface CaseOutcome {
  caseId: string;
  outcome: SalesOutcome;
  determinedAt: string;
  confidence: ConfidenceAssessment;
  /** SaleAttribution.attributionId — required whenever outcome === 'sold'. */
  supportingAttributionId: string | null;
  lossReason: string | null;
}

// ---------------------------------------------------------------------------
// Phase 10 — Doctor Contribution Model
// ---------------------------------------------------------------------------

export type StaffRoleInCase =
  | 'conversation_owner'
  | 'need_identifier'
  | 'product_advisor'
  | 'alternative_provider'
  | 'closer'
  | 'order_confirmer'
  | 'follow_up_owner';

/**
 * staffId is always `staff.id` (uuid) — the canonical row, never a raw name string. Resolution
 * from a chat sender name to this id must go through the existing fuzzy/normalized matching in
 * src/lib/staff/staffIdentityResolver.ts (see Phase A report §5), never a fresh ad hoc lookup.
 */
export interface StaffContribution {
  contributionId: string;
  caseId: string;
  staffId: string;
  roles: StaffRoleInCase[];
  evidence: EvidenceRef[];
  /** True only for the person responsible at final_confirmation/order_creation — see Phase 10 spec. */
  isSaleOwner: boolean;
}
