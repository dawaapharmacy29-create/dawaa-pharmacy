// Canonical bridge from protected review-source confirmation fields to invoice evidence.
// matched_invoice_* and invoice_match_status are automated legacy suggestions;
// reviewer_confirmed approves the overall review, not a specific invoice link.
// Neither establishes trust. Only the dedicated invoice_link_confirmed record,
// exact sales_invoices.id, reviewer and timestamp provide invoice-link provenance.
// The confirmation RPC validates actor, scope, customer and current canonical
// selection before persisting these protected fields. An older unconfirmed
// suggestion cannot invalidate that audited decision. Invoice number/branch are
// descriptive only; the downstream engine still validates the actual invoice
// row, customer identity, branch conflicts and case ownership independently.
import type { ConfidenceAssessment } from './types';

export type TrustedInvoiceEvidenceType = 'none' | 'manual_invoice_link_confirmation';

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
   * the invoice link specifically. It is informational here and can never establish trust.
   */
  reviewerConfirmed: boolean | null;
  /** whatsapp_review_sources.reviewer_id — identifies the overall reviewer only; not invoice-link provenance. */
  reviewerId: string | null;
  /** whatsapp_review_sources.branch — carried through for display/logging only, never an identity key. */
  branch: string | null;
  /** Dedicated invoice-link confirmation fields. These confirm the exact invoice, not the overall review. */
  invoiceLinkConfirmed?: boolean | null;
  confirmedInvoiceId?: string | null;
  confirmedInvoiceNumber?: string | null;
  confirmedBy?: string | null;
  confirmedAt?: string | null;
}

export interface TrustedInvoiceEvidenceResult {
  /** Exact officially confirmed invoice row ID, or null when provenance is incomplete. */
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

/** Pure projection of dedicated protected approval provenance; never promotes a legacy suggestion. */
export function resolveTrustedInvoiceEvidenceFromReviewSource(
  input: ReviewSourceInvoiceEvidenceInput
): TrustedInvoiceEvidenceResult {
  const reviewerConfirmed = input.reviewerConfirmed === true;
  const invoiceLinkConfirmed = input.invoiceLinkConfirmed === true;
  const confirmedInvoiceId = String(input.confirmedInvoiceId || '').trim();
  const confirmedBy = String(input.confirmedBy || '').trim();
  const confirmedAt = String(input.confirmedAt || '').trim();
  const confirmedInvoiceNumber = String(input.confirmedInvoiceNumber || '').trim() || null;

  if (
    invoiceLinkConfirmed &&
    confirmedInvoiceId &&
    confirmedBy &&
    confirmedAt
  ) {
    const ruleIds = [
      'trusted_invoice.eligible.manual_invoice_link_confirmation',
      'trusted_invoice.rule.exact_invoice_id_confirmed',
      'trusted_invoice.rule.confirmed_by_present',
      'trusted_invoice.rule.confirmed_at_present',
      'trusted_invoice.rule.legacy_suggestion_does_not_override_manual_confirmation',
    ];
    return {
      trustedInvoiceId: confirmedInvoiceId,
      trustedInvoiceNumber: confirmedInvoiceNumber,
      trustedInvoiceBranch: input.branch || null,
      source: 'whatsapp_review_sources',
      evidenceType: 'manual_invoice_link_confirmation',
      reviewerConfirmed,
      ruleIds,
      confidence: { level: 'proven', score: 1, ruleIds, evidence: [] },
    };
  }

  const ruleIds = [
    'trusted_invoice.ineligible.no_invoice_specific_confirmation_source',
  ];

  if (!input.matchedInvoiceId) ruleIds.push('trusted_invoice.ineligible.no_matched_invoice');
  if (!invoiceLinkConfirmed) ruleIds.push('trusted_invoice.ineligible.invoice_link_not_confirmed');
  if (invoiceLinkConfirmed && !confirmedInvoiceId) ruleIds.push('trusted_invoice.ineligible.confirmed_invoice_id_missing');
  if (invoiceLinkConfirmed && !confirmedBy) ruleIds.push('trusted_invoice.ineligible.confirmed_by_missing');
  if (invoiceLinkConfirmed && !confirmedAt) ruleIds.push('trusted_invoice.ineligible.confirmed_at_missing');
  if (input.invoiceMatchStatus !== 'verified') ruleIds.push('trusted_invoice.ineligible.match_status_not_verified');
  if (!reviewerConfirmed) {
    ruleIds.push('trusted_invoice.ineligible.reviewer_not_confirmed');
  } else {
    ruleIds.push('trusted_invoice.ineligible.overall_review_confirmation_not_invoice_confirmation');
  }
  if (reviewerConfirmed && !input.reviewerId) {
    ruleIds.push('trusted_invoice.ineligible.reviewer_id_missing');
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
