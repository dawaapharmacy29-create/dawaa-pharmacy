import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildConversationUnderstandingV32 } from '@/lib/whatsappConversationUnderstandingV32';
import { evaluateOrderConfirmationV32 } from '@/lib/whatsappOrderConfirmationEvidenceV32';

function understandingOf(raw: string) {
  const sessions = splitWhatsAppSessions(parseWhatsAppExport(raw), 120);
  expect(sessions.length).toBeGreaterThan(0);
  return buildConversationUnderstandingV32(sessions[0]);
}

const FULL_CONFIRMATION = `[9/15/26, 9:00:00 AM] Customer: عايز أوردر توصيل فيتامين د
[9/15/26, 9:01:00 AM] You: تم تسجيل طلبك: فيتامين د 1 علبة، السعر 250 جنيه، مصاريف التوصيل 20 جنيه، الدفع كاش، العنوان: شارع البحر الدقي، رقم التليفون 01012345678، هيوصل خلال ساعة`;

describe('OrderConfirmationEvidenceV32 (Shadow Mode — Golden Cases)', () => {
  it('scores full (10/10) when every applicable item is confirmed', () => {
    const result = evaluateOrderConfirmationV32({ understanding: understandingOf(FULL_CONFIRMATION) });
    expect(result.applicable).toBe(true);
    expect(result.scoreBand).toBe('full');
    expect(result.pointsEarned).toBe(10);
    expect(result.findings.every((f) => f.status === 'proven' || f.status === 'not_applicable')).toBe(true);
  });

  it('scores minor_missing (7/10) when one non-critical item is missing', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز أوردر توصيل فيتامين د
[9/15/26, 9:01:00 AM] You: تم تسجيل طلبك: فيتامين د 1 علبة، السعر 250 جنيه، مصاريف التوصيل 20 جنيه، الدفع كاش، العنوان: شارع البحر الدقي، رقم التليفون 01012345678`;
    const result = evaluateOrderConfirmationV32({ understanding: understandingOf(raw) });
    expect(result.scoreBand).toBe('minor_missing');
    expect(result.pointsEarned).toBe(7);
    const timing = result.findings.find((f) => f.key === 'deliveryTiming');
    expect(timing?.status).toBe('missing');
  });

  it('scores important_missing (0/10) when a critical item (phone) is missing', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز أوردر توصيل فيتامين د
[9/15/26, 9:01:00 AM] You: تم تسجيل طلبك: فيتامين د 1 علبة، السعر 250 جنيه، مصاريف التوصيل 20 جنيه، الدفع كاش، العنوان: شارع البحر الدقي، هيوصل خلال ساعة`;
    const result = evaluateOrderConfirmationV32({ understanding: understandingOf(raw) });
    expect(result.scoreBand).toBe('important_missing');
    expect(result.pointsEarned).toBe(0);
    const phone = result.findings.find((f) => f.key === 'phone');
    expect(phone?.status).toBe('missing');
  });

  it('treats an item proven only from trusted order metadata as proven, never as missing', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز أوردر توصيل فيتامين د
[9/15/26, 9:01:00 AM] You: تم تسجيل طلبك: فيتامين د 1 علبة، السعر 250 جنيه، مصاريف التوصيل 20 جنيه، الدفع كاش، رقم التليفون 01012345678، هيوصل خلال ساعة`;
    const result = evaluateOrderConfirmationV32({
      understanding: understandingOf(raw),
      order: { deliveryMethod: 'delivery', address: 'شارع البحر - الدقي', area: 'الدقي' },
    });
    expect(result.scoreBand).toBe('full');
    expect(result.pointsEarned).toBe(10);
    const address = result.findings.find((f) => f.key === 'address');
    expect(address?.status).toBe('proven');
    expect(address?.source).toBe('order');
    expect(address?.evidenceMessageIds.length).toBe(0);
  });

  it('flags a contradiction instead of silently trusting either source when order data conflicts with the chat', () => {
    const result = evaluateOrderConfirmationV32({
      understanding: understandingOf(FULL_CONFIRMATION),
      order: { deliveryMethod: 'delivery', phone: '01099999999' },
    });
    const phone = result.findings.find((f) => f.key === 'phone');
    expect(phone?.status).toBe('contradicted');
    expect(result.contradictionMessageIds.length).toBe(1);
    expect(result.needsHumanReview).toBe(true);
    expect(result.scoreBand).toBe('important_missing');
  });

  it('is not applicable when there is no order/confirmation signal in the chat and no order context', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز أسأل عن سعر فيتامين د
[9/15/26, 9:01:00 AM] You: السعر 250 جنيه`;
    const result = evaluateOrderConfirmationV32({ understanding: understandingOf(raw) });
    expect(result.applicable).toBe(false);
    expect(result.pointsEarned).toBeNull();
  });
});
