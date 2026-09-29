// Phase I.B.4 — canonical adapter from whatsapp_review_sources rows into H.1B batch inputs.
//
// This adapter is deliberately pure: no Supabase calls, no writes. Its purpose is to make the
// trusted conversation_started_at date anchor structurally hard to forget when historical
// time-only markdown sources are reprocessed.
//
// I.C.1 addition: also resolves trustedInvoiceId/trustedInvoiceNumber via
// resolveTrustedInvoiceEvidenceFromReviewSource() (trustedInvoiceEvidenceBridge.ts) — the only
// path to a `proven` sale attribution (saleAttributionEngine.ts). See that module's own header
// comment for the full eligibility rule and why matched_invoice_id/invoice_match_status alone are
// never sufficient. legacyMatchedInvoiceId/legacyMatchedInvoiceNumber (evidence-only, pre-existing)
// are left completely unchanged.
import { resolveTrustedInvoiceEvidenceFromReviewSource } from '../trustedInvoiceEvidenceBridge';
import { extractTrailingCustomerCodeFromDisplayName, normalizeDawaaCustomerCode } from '../../customers/customerIdentity';
import type { BatchConversationInput } from './batchPersistenceService';

export interface WhatsAppReviewSourceBatchRow {
  id: string;
  raw_text: string | null;
  /** Canonical Customer Case V22 pointer resolved by the server orchestrator; null when absent/ambiguous. */
  source_case_id_v22?: string | null;
  conversation_started_at: string | null;
  customer_id?: string | null;
  customer_phone?: string | null;
  customer_name?: string | null;
  customer_code?: string | null;
  branch?: string | null;
  matched_invoice_id?: string | null;
  matched_invoice_number?: string | null;
  /** I.C.1 additions — see trustedInvoiceEvidenceBridge.ts's own eligibility rule. */
  invoice_match_status?: string | null;
  reviewer_confirmed?: boolean | null;
  reviewer_id?: string | null;
  invoice_link_confirmed?: boolean | null;
  invoice_link_confirmed_invoice_id?: string | null;
  invoice_link_confirmed_invoice_number?: string | null;
  invoice_link_confirmed_by?: string | null;
  invoice_link_confirmed_at?: string | null;
}

/**
 * Converts one persisted WhatsApp source to the exact input the Sales Intelligence batch service
 * expects. No date is inferred: if conversation_started_at is absent, the trusted anchor remains
 * null and a time-only markdown export will continue to fail explicitly rather than fabricate a
 * date.
 */
export function reviewSourceRowToBatchConversation(
  row: WhatsAppReviewSourceBatchRow
): BatchConversationInput {
  const trustedEvidence = resolveTrustedInvoiceEvidenceFromReviewSource({
    sourceId: row.id,
    matchedInvoiceId: row.matched_invoice_id ?? null,
    matchedInvoiceNumber: row.matched_invoice_number ?? null,
    invoiceMatchStatus: row.invoice_match_status ?? null,
    reviewerConfirmed: row.reviewer_confirmed ?? null,
    reviewerId: row.reviewer_id ?? null,
    branch: row.branch ?? null,
    invoiceLinkConfirmed: row.invoice_link_confirmed ?? null,
    confirmedInvoiceId: row.invoice_link_confirmed_invoice_id ?? null,
    confirmedInvoiceNumber: row.invoice_link_confirmed_invoice_number ?? null,
    confirmedBy: row.invoice_link_confirmed_by ?? null,
    confirmedAt: row.invoice_link_confirmed_at ?? null,
  });

  return {
    conversationId: row.id,
    sourceCaseIdV22: row.source_case_id_v22 ?? null,
    rawWhatsAppExportText: row.raw_text ?? '',
    trustedConversationStartedAt: row.conversation_started_at ?? null,
    customerIdHint: row.customer_id ?? null,
    customerPhoneHint: row.customer_phone ?? null,
    customerNameHint: row.customer_name ?? null,
    customerCodeHint:
      normalizeDawaaCustomerCode(row.customer_code) ||
      extractTrailingCustomerCodeFromDisplayName(row.customer_name) ||
      null,
    branchNameRawHint: row.branch ?? null,
    legacyMatchedInvoiceId: row.matched_invoice_id ?? null,
    legacyMatchedInvoiceNumber: row.matched_invoice_number ?? null,
    trustedInvoiceId: trustedEvidence.trustedInvoiceId,
    trustedInvoiceNumber: trustedEvidence.trustedInvoiceNumber,
  };
}
