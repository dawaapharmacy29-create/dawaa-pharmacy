import { describe, expect, it } from 'vitest';
import { resolveTrustedInvoiceEvidenceFromReviewSource } from '../trustedInvoiceEvidenceBridge';
import { reviewSourceRowToBatchConversation } from '../persistence/reviewSourceBatchAdapter';
import { runSalesIntelligencePipeline, type SalesIntelligencePipelineInput } from '../salesIntelligencePipeline';

describe('Trusted invoice evidence bridge — invoice-specific provenance required', () => {
  it('never promotes automated verified matching plus overall review confirmation into trusted invoice evidence', () => {
    const result = resolveTrustedInvoiceEvidenceFromReviewSource({
      sourceId: 'source-1',
      matchedInvoiceId: 'inv-uuid-1',
      matchedInvoiceNumber: '32069',
      invoiceMatchStatus: 'verified',
      reviewerConfirmed: true,
      reviewerId: 'reviewer-1',
      branch: 'فرع شكري',
    });

    expect(result.trustedInvoiceId).toBeNull();
    expect(result.trustedInvoiceNumber).toBeNull();
    expect(result.evidenceType).toBe('none');
    expect(result.confidence.level).toBe('unknown');
    expect(result.ruleIds).toContain('trusted_invoice.ineligible.no_invoice_specific_confirmation_source');
    expect(result.ruleIds).toContain('trusted_invoice.ineligible.overall_review_confirmation_not_invoice_confirmation');
  });

  it('keeps verified automatic matching without reviewer confirmation untrusted', () => {
    const result = resolveTrustedInvoiceEvidenceFromReviewSource({
      sourceId: 'source-2',
      matchedInvoiceId: 'inv-2',
      matchedInvoiceNumber: '123',
      invoiceMatchStatus: 'verified',
      reviewerConfirmed: false,
      reviewerId: null,
      branch: 'فرع الشامي',
    });
    expect(result.trustedInvoiceId).toBeNull();
    expect(result.ruleIds).toContain('trusted_invoice.ineligible.reviewer_not_confirmed');
  });

  it('never trusts invoice number alone', () => {
    const result = resolveTrustedInvoiceEvidenceFromReviewSource({
      sourceId: 'source-3',
      matchedInvoiceId: null,
      matchedInvoiceNumber: '32069',
      invoiceMatchStatus: 'verified',
      reviewerConfirmed: true,
      reviewerId: 'reviewer-1',
      branch: 'فرع شكري',
    });
    expect(result.trustedInvoiceId).toBeNull();
    expect(result.ruleIds).toContain('trusted_invoice.ineligible.no_matched_invoice');
  });

  it('adapter preserves legacy evidence but never turns the current review-source fields into trusted evidence', () => {
    const input = reviewSourceRowToBatchConversation({
      id: 'row-1',
      raw_text: 'x',
      conversation_started_at: '2026-09-15T06:46:45.000Z',
      matched_invoice_id: 'inv-uuid-1',
      matched_invoice_number: '32069',
      invoice_match_status: 'verified',
      reviewer_confirmed: true,
      reviewer_id: 'reviewer-1',
    });
    expect(input.legacyMatchedInvoiceId).toBe('inv-uuid-1');
    expect(input.legacyMatchedInvoiceNumber).toBe('32069');
    expect(input.trustedInvoiceId).toBeNull();
    expect(input.trustedInvoiceNumber).toBeNull();
  });
});

describe('Sale attribution still supports a future dedicated trusted-invoice source', () => {
  function baseInput(overrides: Partial<SalesIntelligencePipelineInput> = {}): SalesIntelligencePipelineInput {
    return {
      conversationId: 'conv-trusted-source',
      rawWhatsAppExportText: '',
      resolveInvoiceCandidates: () => [],
      ...overrides,
    };
  }

  it('can reach proven only when a trusted invoice id is supplied directly by a dedicated upstream source', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: إجمالي الحساب 180 جنيه
[9/15/26, 9:02:00 AM] Customer: ايوه تمام
[9/15/26, 9:03:00 AM] You: تم تأكيد الطلب وجاري الإرسال`;

    const result = runSalesIntelligencePipeline(baseInput({
      rawWhatsAppExportText: raw,
      trustedConversationStartedAt: '2026-09-15T06:00:00.000Z',
      customerIdHint: 'cust-1',
      trustedInvoiceId: 'trusted-invoice-1',
      trustedInvoiceNumber: '90001',
      resolveInvoiceCandidates: () => [{
        id: 'trusted-invoice-1',
        invoice_number: '90001',
        customer_id: 'cust-1',
        invoice_datetime: '2026-09-15T06:05:00.000Z',
        net_amount: 180,
      }],
    }));

    const analysis = result.caseAnalyses[0];
    expect(analysis.attribution.attributionLevel).toBe('proven');
    expect(analysis.attribution.selectedCandidate?.directInvoiceLink).toBe(true);
  });
});
