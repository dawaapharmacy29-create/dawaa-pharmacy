import { describe, expect, it } from 'vitest';
import { reviewSourceRowToBatchConversation } from '../reviewSourceBatchAdapter';

describe('I.B.4 — whatsapp_review_sources -> batch input adapter', () => {
  it('preserves conversation_started_at as the only trusted date anchor', () => {
    const input = reviewSourceRowToBatchConversation({
      id: '2b17106c-fb69-4b4e-ad83-f5aa41303c86',
      raw_text: '[4:27 PM] **عبد الرحمن:** طلب',
      conversation_started_at: '2026-09-15T13:27:00+00:00',
      customer_id: 'cust-1',
      customer_phone: '01000000000',
      branch: 'فرع الشامي',
      matched_invoice_id: null,
      matched_invoice_number: null,
    });

    expect(input.conversationId).toBe('2b17106c-fb69-4b4e-ad83-f5aa41303c86');
    expect(input.trustedConversationStartedAt).toBe('2026-09-15T13:27:00+00:00');
    expect(input.branchNameRawHint).toBe('فرع الشامي');
  });

  it('never substitutes another timestamp when conversation_started_at is missing', () => {
    const input = reviewSourceRowToBatchConversation({
      id: 'source-without-date',
      raw_text: '[4:27 PM] **Customer:** hello',
      conversation_started_at: null,
    });

    expect(input.trustedConversationStartedAt).toBeNull();
  });
});
