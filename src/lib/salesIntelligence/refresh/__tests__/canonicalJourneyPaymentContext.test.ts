// Regression boundary: canonical fine sources may be reassembled only for an explicit same-journey payment continuation.
import { describe, expect, it } from 'vitest';
import {
  buildCanonicalAnalysisConversations,
  type V22AnalysisContext,
} from '../canonicalRefreshService';

describe('canonical analysis journey payment-context assembly', () => {
  const sourceMap = new Map([
    ['order-source', 'order-case'],
    ['payment-source', 'payment-case'],
  ]);
  const v22 = new Map<string, V22AnalysisContext>([
    ['order-case', {
      id: 'order-case',
      journeyId: 'journey-1',
      customerId: 'customer-3643',
      caseType: 'order',
      orderIntent: true,
      orderConfirmed: true,
    }],
    ['payment-case', {
      id: 'payment-case',
      journeyId: 'journey-1',
      customerId: 'customer-3643',
      caseType: 'followup',
      orderIntent: false,
      orderConfirmed: false,
    }],
  ]);

  const order = {
    id: 'order-source',
    source_filename: 'ابراهيم الصياد ٣٦٤٣ (1).zip',
    raw_text: '[9/27/26, 9:03:34 PM] Customer: علبتين لبن هيرو بيبي\n[9/27/26, 9:06:00 PM] You: جاري الارسال',
    conversation_started_at: '2026-09-27T18:03:34Z',
    conversation_ended_at: '2026-09-27T18:15:35Z',
    customer_id: 'customer-3643',
    customer_code: '3643',
    customer_name: 'ابراهيم الصياد',
    customer_phone: '01016891940',
  };

  const payment = {
    id: 'payment-source',
    source_filename: 'ابراهيم الصياد ٣٦٤٣ (1).zip',
    raw_text: '[9/28/26, 2:52:09 AM] You: اتفضل رقم التحويل يا فندم 01028308235\n[9/28/26, 3:08:09 AM] Customer: الحساب كام من فضلك\n[9/28/26, 3:10:40 AM] You: وصل شكرا جزيلا',
    conversation_started_at: '2026-09-27T23:52:09Z',
    conversation_ended_at: '2026-09-28T00:10:40Z',
    customer_id: 'customer-3643',
    customer_code: '3643',
    customer_name: 'ابراهيم الصياد',
    customer_phone: '01016891940',
  };

  it('feeds one order-anchor conversation to V9 with the payment-settlement context', () => {
    const conversations = buildCanonicalAnalysisConversations([order, payment], sourceMap, v22);
    expect(conversations).toHaveLength(1);
    expect(conversations[0].conversationId).toBe('order-source');
    expect(conversations[0].sourceCaseIdV22).toBe('order-case');
    expect(conversations[0].rawWhatsAppExportText).toContain('علبتين لبن هيرو بيبي');
    expect(conversations[0].rawWhatsAppExportText).toContain('رقم التحويل');
    expect(conversations[0].rawWhatsAppExportText).toContain('وصل شكرا جزيلا');
  });

  it('fails closed for a generic followup with no explicit payment handoff', () => {
    const generic = { ...payment, raw_text: '[9/28/26, 2:52:09 AM] You: مساء الخير يا فندم' };
    const conversations = buildCanonicalAnalysisConversations([order, generic], sourceMap, v22);
    expect(conversations).toHaveLength(2);
  });

  it('fails closed when the same journey contains more than one order anchor', () => {
    const contexts = new Map(v22);
    contexts.set('payment-case', {
      ...v22.get('payment-case')!,
      caseType: 'order',
      orderIntent: true,
    });
    const conversations = buildCanonicalAnalysisConversations([order, payment], sourceMap, contexts);
    expect(conversations).toHaveLength(2);
  });
});
