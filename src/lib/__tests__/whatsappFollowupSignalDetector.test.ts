import { describe, expect, it } from 'vitest';
import { detectFollowupSignals } from '@/lib/whatsappFollowupSignalDetector';
import type { WhatsAppConversationSession, WhatsAppParsedMessage } from '@/lib/whatsappConversationParser';

function message(id: string, minute: number, direction: 'inbound' | 'outbound', text: string): WhatsAppParsedMessage {
  const timestamp = new Date(2026, 8, 17, 10, minute, 0);
  return {
    id,
    timestamp,
    rawTimestamp: timestamp.toISOString(),
    sender: direction === 'inbound' ? 'العميل' : 'د هبة',
    text,
    direction,
    kind: 'text',
    forwarded: false,
    raw: text,
  };
}

function session(messages: WhatsAppParsedMessage[]): WhatsAppConversationSession {
  return {
    id: 'session-1',
    startedAt: messages[0]?.timestamp || new Date(),
    endedAt: messages[messages.length - 1]?.timestamp || new Date(),
    messages,
    participants: ['العميل', 'د هبة'],
    outboundStaffNames: ['د هبة'],
    customerName: 'عميل تجريبي',
    mediaCount: 0,
  };
}

describe('WhatsApp follow-up signal detector', () => {
  it('does not turn a resolved customer phrase into a complaint', () => {
    const result = detectFollowupSignals(session([
      message('1', 0, 'inbound', 'خلاص تمام مفيش مشكلة حصل خير شكرا لحضرتك'),
    ]));
    expect(result.filter((item) => item.signalType === 'complaint')).toHaveLength(0);
  });

  it('keeps explicit complaints high confidence', () => {
    const result = detectFollowupSignals(session([
      message('1', 0, 'inbound', 'الطلب اتأخر جدا ومحدش رد علينا'),
      message('2', 1, 'outbound', 'حق حضرتك علينا'),
    ]));
    const complaint = result.find((item) => item.signalType === 'complaint');
    expect(complaint).toBeTruthy();
    expect(complaint?.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('detects a strong home-patient follow-up without relying on one generic word', () => {
    const result = detectFollowupSignals(session([
      message('1', 0, 'inbound', 'ابني عنده حرارة عالية وقيء من امبارح'),
    ]));
    const signal = result.find((item) => item.signalType === 'sick_person');
    expect(signal).toBeTruthy();
    expect(signal?.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('links a missing product to the preceding customer request and detects a later alternative', () => {
    const result = detectFollowupSignals(session([
      message('1', 0, 'inbound', 'عندكم سولوبريد 20؟'),
      message('2', 1, 'outbound', 'للأسف الصنف مش متوفر حاليا'),
      message('3', 2, 'outbound', 'ممكن نرشح لحضرتك ابيكوبريد كبديل'),
    ]));
    const missing = result.find((item) => item.signalType === 'missing_product');
    expect(missing?.requestedProductName).toContain('سولوبريد');
    expect(missing?.alternativeOffered).toBe(true);
    expect(missing?.alternativeProductName).toContain('ابيکوبريد'.replace('ک', 'ك'));
  });

  it('merges repeated identical signals within five minutes', () => {
    const result = detectFollowupSignals(session([
      message('1', 0, 'inbound', 'الخدمة وحشة ومفيش رد'),
      message('2', 2, 'inbound', 'الخدمة وحشة ومفيش رد'),
    ]));
    expect(result.filter((item) => item.signalType === 'complaint')).toHaveLength(1);
  });
});
