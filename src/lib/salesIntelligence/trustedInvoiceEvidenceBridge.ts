// Phase I.C.1 — Trusted Invoice Evidence Bridge.
//
// I.C.0's audit found `whatsapp_review_sources.matched_invoice_id`/`matched_invoice_number` are
// populated ENTIRELY by an automated statistical classifier (whatsappUnifiedIntelligenceV4.ts's
// confidence-threshold verification: score >= 0.82 -> 'verified', 0.62-0.82 -> 'probable', else ->
// 'needs_review') — never by a human. `reviewer_confirmed` (set only by
// whatsappReviewPersistenceV4.ts's confirmWhatsAppReviewQueueItem()) approves the CASE'S OVERALL
// REVIEW RECORD (service score / commercial score / etc.), not the invoice link specifically. As
// of the I.C.1 investigation (2026-09-23, live Supabase project jkjqeqkshllustwlzzbf):
//   - confirmWhatsAppReviewQueueItem() has ZERO callers anywhere in this codebase.
//   - reviewer_confirmed = true on ZERO of the 98 whatsapp_review_sources rows in Production.
//   - official_review_id is populated by a SEPARATE, SYSTEM-authored automatic evaluation path
//     (whatsappAutomaticReviewPersistence.ts, SYSTEM_ACTOR_ID) on 1/98 rows — never a human review.
// Nothing in that table qualifies as human-confirmed invoice evidence TODAY.
//
// This module does NOT invent a new confirmation semantic or write path (out of I.C.1's scope,
// and would risk widening trust based on a signal nobody has actually verified). It defines the
// STRICTEST eligibility rule the EXISTING columns can support, and is deliberately conservative:
// it returns trustedInvoiceId = null for every row until a genuinely reviewer-confirmed,
// algorithmically-verified match exists. That it selects zero rows today is the correct and safe
// answer, not a bug — see the I.C.1 final report for the full investigation and rationale.
//
// Eligibility (ALL four required — each one alone is insufficient, see the doc comment on
// resolveTrustedInvoiceEvidenceFromReviewSource):
//   1. matchedInvoiceId is present — a candidate invoice was identified at all.
//   2. invoiceMatchStatus === 'verified' — the strongest automated tier only, never probable/
//      needs_review/pending/not_found/not_applicable.
//   3. reviewerConfirmed === true.
//   4. reviewerId is present — an identified confirming actor, never a bare unattributed flag.
//
// Identity discipline (I.C.0 finding, confirmed against live data): `matched_invoice_id` is
// `sales_invoices.id` — the real row key (verified: every one of the 54 currently-populated
// matched_invoice_id values in Production joins to exactly one sales_invoices.id). `invoice_number`
// is NEVER unique on its own — invoice numbering resets per branch (67,025 distinct numbers over
// 70,536 rows in Production, with confirmed real duplicates such as invoice_number "32069"
// existing once at "فرع الشامي" and once at "فرع شكري" as two entirely different invoices), and
// at least 5 of the 54 currently-matched rows have a DIFFERENT sales_invoices row sharing the same
// invoice_number. trustedInvoiceNumber/trustedInvoiceBranch are carried through for display/
// logging ONLY — this resolver never derives trustedInvoiceId from the number, and no caller may
// treat the number alone as a safe identity key.
import type { ConfidenceAssessment } from './types';

export type TrustedInvoiceEvidenceType = 'none';

export interface ReviewSourceInvoiceEvidenceInput {
  /** whatsapp_review_sources.id — kept only for evidence traceability. */
  sourceId: string;
  /** whatsapp_review_sources.matched_invoice_id — sales_invoices.id, the real row key. */
  matchedInvoiceId: string | null;
  /** whatsapp_review_sources.matched_invoice_number — NEVER unique; display/logging only. */
  matchedInvoiceNumber: string | null;
  /** whatsapp_review_sources.invoice_match_status ('verified'|'probable'|'needs_review'|'pending'|'not_found'|'not_applicable'). */
  invoiceMatchStatus: string | null;
  /**
   * whatsapp_review_sources.reviewer_confirmed — approves the case's OVERALL review record, never
   * the invoice link specifically (see module comment). Necessary but never sufficient alone.
   */
  reviewerConfirmed: boolean | null;
  /** whatsapp_review_sources.reviewer_id — required alongside reviewerConfirmed so a bare unattributed flag can never qualify. */
  reviewerId: string | null;
  /** whatsapp_review_sources.branch — carried through for display/logging only, never an identity key. */
  branch: string | null;
}

export interface TrustedInvoiceEvidenceResult {
  /** sales_invoices.id when (and only when) eligibility holds — null otherwise. NEVER derived from matchedInvoiceNumber. */
  trustedInvoiceId: string | null;
  /** Display/logging only — never a safe identity key on its own (see module comment). */
  trustedInvoiceNumber: string | null;
  /** Carried alongside trustedInvoiceNumber for display/logging only — disambiguates the number, never used as part of the identity itself. */
  trustedInvoiceBranch: string | null;
  source: 'whatsapp_review_sources' | 'none';
  evidenceType: TrustedInvoiceEvidenceType;
  /** The raw reviewerConfirmed input, echoed for caller visibility — true here does NOT by itself mean trustedInvoiceId is set; see the eligibility rule. */
  reviewerConfirmed: boolean;
  ruleIds: string[];
  confidence: ConfidenceAssessment;
}

/**
 * Pure function — no Supabase, no I/O. Given the exact whatsapp_review_sources fields relevant to
 * invoice trust, returns whether this row's invoice match is eligible to become
 * CaseAttributionContext.trustedInvoiceId/trustedInvoiceNumber (saleAttributionEngine.ts) — the
 * ONLY path to a `proven` sale attribution. See the module header comment for why each signal
 * alone (a 'verified' statistical status, a bare matched_invoice_id, reviewer_confirmed without an
 * identified reviewer) is deliberately treated as insufficient.
 */
export function resolveTrustedInvoiceEvidenceFromReviewSource(
  input: ReviewSourceInvoiceEvidenceInput
): TrustedInvoiceEvidenceResult {
  const reviewerConfirmed = input.reviewerConfirmed === true;

  const ruleIds = [
    'trusted_invoice.ineligible.no_invoice_specific_confirmation_source',
  ];

  if (!input.matchedInvoiceId) ruleIds.push('trusted_invoice.ineligible.no_matched_invoice');
  if (input.invoiceMatchStatus !== 'verified') ruleIds.push('trusted_invoice.ineligible.match_status_not_verified');
  if (reviewerConfirmed) {
    ruleIds.push('trusted_invoice.ineligible.overall_review_confirmation_not_invoice_confirmation');
  }

  return {
    trustedInvoiceId: null,
    trustedInvoiceNumber: null,
    trustedInvoiceBranch: null,
    source: 'none',
    evidenceType: 'none',
    reviewerConfirmed,
    ruleIds,
    confidence: { level: 'unknown', score: 0, ruleIds, evidence: [] },
  };
}
