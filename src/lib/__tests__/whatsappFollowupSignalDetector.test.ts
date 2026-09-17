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

  it('keeps a resolved strong complaint but lowers its confidence', () => {
    const result = detectFollowupSignals(session([
      message('1', 0, 'inbound', 'الطلب اتأخر جدا ومحدش رد علينا'),
      message('2', 1, 'outbound', 'حق حضرتك علينا وتم حل الموضوع'),
      message('3', 2, 'inbound', 'حصل خير شكرا'),
    ]));
    const complaint = result.find((item) => item.signalType === 'complaint');
    expect(complaint).toBeTruthy();
    expect(complaint?.confidence).toBeLessThan(0.8);
  });

  it('does not convert a generic tired phrase into a patient follow-up without medical context', () => {
    const result = detectFollowupSignals(session([
      message('1', 0, 'inbound', 'انا تعبان من الشغل النهارده'),
      message('2', 1, 'outbound', 'ربنا يعين حضرتك'),
    ]));
    expect(result.some((item) => item.signalType === 'sick_person')).toBe(false);
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

  it('creates a separate opportunity when the customer asks to be contacted once stock returns', () => {
    const result = detectFollowupSignals(session([
      message('1', 0, 'inbound', 'عايز فلورست'),
      message('2', 1, 'outbound', 'للأسف مش متوفر حاليا'),
      message('3', 2, 'inbound', 'اول ما يتوفر كلموني لو سمحت'),
    ]));
    expect(result.some((item) => item.signalType === 'missing_product')).toBe(true);
    expect(result.some((item) => item.signalType === 'other_opportunity')).toBe(true);
  });

  it('downgrades a missing-stock signal after an explicit customer decline', () => {
    const result = detectFollowupSignals(session([
      message('1', 0, 'inbound', 'محتاج الصنف ده'),
      message('2', 1, 'outbound', 'الصنف مش موجود حاليا'),
      message('3', 2, 'inbound', 'خلاص مش محتاج شكرا'),
    ]));
    const missing = result.find((item) => item.signalType === 'missing_product');
    expect(missing).toBeTruthy();
    expect(missing?.confidence).toBeLessThan(0.7);
  });

  it('merges repeated identical signals within five minutes', () => {
    const result = detectFollowupSignals(session([
      message('1', 0, 'inbound', 'الخدمة وحشة ومفيش رد'),
      message('2', 2, 'inbound', 'الخدمة وحشة ومفيش رد'),
    ]));
    expect(result.filter((item) => item.signalType === 'complaint')).toHaveLength(1);
  });
});
