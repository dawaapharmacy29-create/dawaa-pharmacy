import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildConversationUnderstandingV32 } from '@/lib/whatsappConversationUnderstandingV32';
import { evaluateOrderConfirmationV32 } from '@/lib/whatsappOrderConfirmationEvidenceV32';

// V32.2 Golden Dataset Expansion — Egyptian colloquial semantics. Each case below was dry-run
// against the actual implementation before being locked in as an assertion, per this phase's
// "analyze before you regex" and "test evidence, not just score" requirements.

function understandingOf(raw: string) {
  const sessions = splitWhatsAppSessions(parseWhatsAppExport(raw), 120);
  expect(sessions.length).toBeGreaterThan(0);
  return buildConversationUnderstandingV32(sessions[0]);
}

describe('OrderConfirmationEvidenceV32.2 — Golden Dataset Expansion', () => {
  it('treats "من عنيا لحضرتك" as a real confirmation when it is contextually linked to the customer\'s order request', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د 1 علبة توصيل, رقمي 01012345678
[9/15/26, 9:01:00 AM] You: من عنيا لحضرتك, هبعتلك خلال ساعة, الدفع كاش`;
    const result = evaluateOrderConfirmationV32({ understanding: understandingOf(raw) });
    expect(result.applicable).toBe(true);
    const item = result.findings.find((f) => f.key === 'item');
    expect(item?.status).toBe('proven');
    expect(item?.provenance).toBe('mutual_confirmation');
    const quantity = result.findings.find((f) => f.key === 'quantity');
    expect(quantity?.status).toBe('proven');
    expect(quantity?.provenance).toBe('mutual_confirmation');
  });

  it('does NOT treat a bare "حاضر" answering a price question as an order confirmation (context matters more than the phrase)', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: السعر كام؟
[9/15/26, 9:01:00 AM] You: حاضر`;
    const result = evaluateOrderConfirmationV32({ understanding: understandingOf(raw) });
    expect(result.applicable).toBe(false);
  });

  it('marks a quantity the customer added AFTER an unrelated explicit confirmation as customer-stated but unconfirmed, not proven', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د توصيل, رقمي 01012345678
[9/15/26, 9:01:00 AM] You: تم تسجيل طلبك, الدفع كاش
[9/15/26, 9:02:00 AM] Customer: ممكن كمان تحطلي 2 علبة مش واحدة`;
    const result = evaluateOrderConfirmationV32({ understanding: understandingOf(raw) });
    const quantity = result.findings.find((f) => f.key === 'quantity');
    expect(quantity?.status).toBe('partially_proven');
    expect(quantity?.provenance).toBe('customer_statement');
  });

  it('an explicit "تم تسجيل الطلب" retroactively confirms values the customer already stated earlier in the same turn', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د 1 علبة توصيل, رقمي 01012345678
[9/15/26, 9:01:00 AM] You: تم تسجيل طلبك, الدفع كاش`;
    const result = evaluateOrderConfirmationV32({ understanding: understandingOf(raw) });
    const phone = result.findings.find((f) => f.key === 'phone');
    expect(phone?.status).toBe('proven');
    expect(phone?.provenance).toBe('mutual_confirmation');
  });

  it('an early confirmation phrase before all details are gathered still leaves the missing critical items missing', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د
[9/15/26, 9:01:00 AM] You: من عنيا لحضرتك`;
    const result = evaluateOrderConfirmationV32({ understanding: understandingOf(raw) });
    expect(result.scoreBand).toBe('important_missing');
    const phone = result.findings.find((f) => f.key === 'phone');
    expect(phone?.status).toBe('missing');
  });

  it('treats phone proven from a trusted customer_profile-equivalent order context, never as missing from chat text', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د توصيل
[9/15/26, 9:01:00 AM] You: من عنيا لحضرتك, الدفع كاش, هيوصل خلال ساعة, العنوان: شارع البحر`;
    const result = evaluateOrderConfirmationV32({
      understanding: understandingOf(raw),
      order: { deliveryMethod: 'delivery', phone: '01098765432' },
    });
    const phone = result.findings.find((f) => f.key === 'phone');
    expect(phone?.status).toBe('proven');
    expect(phone?.source).toBe('order');
    expect(phone?.provenance).toBe('order_record');
  });

  it('"حاضر" alone never counts as delivery timing or payment confirmation even inside an otherwise-applicable order', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د 1 علبة توصيل, رقمي 01012345678
[9/15/26, 9:01:00 AM] You: من عنيا لحضرتك
[9/15/26, 9:02:00 AM] You: حاضر`;
    const result = evaluateOrderConfirmationV32({ understanding: understandingOf(raw) });
    const timing = result.findings.find((f) => f.key === 'deliveryTiming');
    const payment = result.findings.find((f) => f.key === 'paymentMethod');
    expect(timing?.status).toBe('missing');
    expect(payment?.status).toBe('missing');
  });

  it('"خلاص ابعته" from the customer is an acceptance, not itself a staff confirmation of any checklist item', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د توصيل, رقمي 01012345678
[9/15/26, 9:01:00 AM] You: متوفر بسعر 90 جنيه, هيوصل خلال ساعة, الدفع كاش
[9/15/26, 9:02:00 AM] Customer: خلاص ابعته
[9/15/26, 9:03:00 AM] You: تم تسجيل طلبك`;
    const understanding = understandingOf(raw);
    const result = evaluateOrderConfirmationV32({ understanding });
    expect(result.applicable).toBe(true);
    // "خلاص ابعته" is a customer message; it must never itself be picked as a staff confirmation
    // message id for any finding.
    const allEvidenceIds = result.findings.flatMap((f) => f.evidenceMessageIds);
    const acceptanceMessage = understanding.messages.find((m) => m.text.includes('خلاص ابعته'));
    expect(allEvidenceIds).not.toContain(acceptanceMessage?.id);
  });

  it('pickup order (no delivery signal) correctly marks address/area/deliveryFee/deliveryTiming as not_applicable, never missing', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د 1 علبة, رقمي 01012345678
[9/15/26, 9:01:00 AM] You: تم تسجيل طلبك, الدفع كاش, السعر 90 جنيه`;
    const result = evaluateOrderConfirmationV32({ understanding: understandingOf(raw) });
    ['address', 'area', 'deliveryFee', 'deliveryTiming'].forEach((key) => {
      const finding = result.findings.find((f) => f.key === key);
      expect(finding?.status).toBe('not_applicable');
    });
    expect(result.scoreBand).toBe('full');
  });

  it('keeps primaryMessageIds minimal (never the full transcript) when every item is proven', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د 1 علبة توصيل, رقمي 01012345678
[9/15/26, 9:01:00 AM] You: تم تسجيل طلبك: فيتامين د 1 علبة، السعر 250 جنيه، مصاريف التوصيل 20 جنيه، الدفع كاش، العنوان: شارع البحر الدقي، هيوصل خلال ساعة`;
    const result = evaluateOrderConfirmationV32({ understanding: understandingOf(raw) });
    expect(result.scoreBand).toBe('full');
    expect(result.primaryMessageIds.length).toBeLessThanOrEqual(3);
  });

  it('every finding carries a ruleId so a reviewer can trace the exact rule that produced it', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د 1 علبة توصيل, رقمي 01012345678
[9/15/26, 9:01:00 AM] You: من عنيا لحضرتك, الدفع كاش, هيوصل خلال ساعة, العنوان: شارع البحر`;
    const result = evaluateOrderConfirmationV32({ understanding: understandingOf(raw) });
    result.findings.forEach((f) => {
      expect(typeof f.ruleId).toBe('string');
      expect((f.ruleId || '').length).toBeGreaterThan(0);
    });
  });
});
