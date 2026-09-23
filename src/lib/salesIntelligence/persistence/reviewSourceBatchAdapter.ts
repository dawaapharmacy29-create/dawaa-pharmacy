// Phase I.B.4 — canonical adapter from whatsapp_review_sources rows into H.1B batch inputs.
//
// This adapter is deliberately pure: no Supabase calls, no writes. Its purpose is to make the
// trusted conversation_started_at date anchor structurally hard to forget when historical
// time-only markdown sources are reprocessed.
import type { BatchConversationInput } from './batchPersistenceService';

export interface WhatsAppReviewSourceBatchRow {
  id: string;
  raw_text: string | null;
  conversation_started_at: string | null;
  customer_id?: string | null;
  customer_phone?: string | null;
  branch?: string | null;
  matched_invoice_id?: string | null;
  matched_invoice_number?: string | null;
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
  return {
    conversationId: row.id,
    rawWhatsAppExportText: row.raw_text ?? '',
    trustedConversationStartedAt: row.conversation_started_at ?? null,
    customerIdHint: row.customer_id ?? null,
    customerPhoneHint: row.customer_phone ?? null,
    branchNameRawHint: row.branch ?? null,
    legacyMatchedInvoiceId: row.matched_invoice_id ?? null,
    legacyMatchedInvoiceNumber: row.matched_invoice_number ?? null,
  };
}
