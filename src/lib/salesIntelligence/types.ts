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
// Phase 5 — Sale Attribution Engine
// ---------------------------------------------------------------------------

export type AttributionEvidenceKind =
  | 'same_customer_id'
  | 'same_phone'
  | 'same_branch'
  | 'time_proximity'
  | 'product_match'
  | 'quantity_match'
  | 'price_or_total_match'
  | 'same_staff'
  | 'direct_order_id'
  | 'direct_invoice_id';

export interface AttributionEvidenceItem {
  kind: AttributionEvidenceKind;
  matched: boolean;
  detail: string;
  weight: number;
}

/**
 * The AI never declares a sale by itself — see Phase A report §10/§12: sales_invoices carries NO
 * foreign key to customers/staff/branch today, so every link here is built and scored at the
 * application layer, not trusted from the schema. `isOfficialForStaffEvaluation` is a hard
 * invariant, not a UI choice: it must be false whenever confidence.level is 'weakly_inferred' or
 * 'unknown' — enforce this in the Phase D engine, not by convention.
 */
export interface SaleAttribution {
  attributionId: string;
  caseId: string;
  basketId: string | null;
  /** sales_invoices.id (note: text, not uuid, in the current schema). */
  candidateInvoiceId: string | null;
  candidateInvoiceNumber: string | null;
  confidence: ConfidenceAssessment;
  evidence: AttributionEvidenceItem[];
  ruleIds: string[];
  isOfficialForStaffEvaluation: boolean;
}

// ---------------------------------------------------------------------------
// Phase 6 — Matching Engine (Basket <-> Order <-> Invoice <-> Fulfillment)
// ---------------------------------------------------------------------------

export type MatchOutcome =
  | 'exact_match'
  | 'partial_match'
  | 'quantity_mismatch'
  | 'missing_item'
  | 'extra_item'
  | 'total_mismatch'
  | 'unexplained_difference'
  | 'explained_difference';

export interface BasketInvoiceDifference {
  /** A product name or 'total' — identifies which line the difference is about. */
  key: string;
  before: string | number | null;
  after: string | number | null;
  evidence: EvidenceRef[];
  responsibleStage: CaseStage | 'unknown';
  confidence: ConfidenceAssessment;
}

/**
 * Item-level matching (Missing/Extra/Quantity mismatch) is only possible once
 * `sales_invoice_items_v21` actually holds rows for the invoice in question — see Phase A report
 * §1/§10: that table's schema and import pipeline (src/lib/salesInvoiceItemsV21.ts) already
 * exist, but it is a manual Excel import, not populated automatically, and currently has 0 rows.
 * Until it is populated for a given invoice, this engine can only compare at the HEADER level
 * (announced total vs. sales_invoices.net_amount/total_amount) and must report `unknown` rather
 * than fabricate a per-item outcome.
 */
export interface BasketInvoiceMatch {
  matchId: string;
  caseId: string;
  basketId: string;
  invoiceId: string;
  outcome: MatchOutcome;
  differences: BasketInvoiceDifference[];
  confidence: ConfidenceAssessment;
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
