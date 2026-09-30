import { describe, expect, it } from 'vitest';
import { buildOfficialReviewSuggestion } from '@/lib/whatsappReviewScoring';
import type { WhatsAppConversationSession, WhatsAppParsedMessage } from '@/lib/whatsappConversationParser';

function msg(id: string, minute: number, direction: 'inbound' | 'outbound', text: string): WhatsAppParsedMessage {
  return {
    id,
    timestamp: new Date(Date.UTC(2026, 8, 24, 12, minute, 0)),
    rawTimestamp: String(minute),
    sender: direction === 'inbound' ? 'Customer' : 'You',
    text,
    direction,
    kind: 'text',
    forwarded: false,
    raw: text,
  };
}

function session(messages: WhatsAppParsedMessage[]): WhatsAppConversationSession {
  return {
    id: 's-review',
    startedAt: messages[0].timestamp,
    endedAt: messages[messages.length - 1].timestamp,
    messages,
    participants: ['Customer', 'You'],
    outboundStaffNames: ['د أحمد'],
    customerName: 'Customer',
    mediaCount: 0,
  };
}

function item(messages: WhatsAppParsedMessage[], key: string) {
  return buildOfficialReviewSuggestion(session(messages)).items.find((row) => row.key === key)!;
}

describe('WhatsApp review responsibility guard', () => {
  it('makes sales_closing not applicable when customer disappears after pharmacy offer', () => {
    const messages = [
      msg('m1', 0, 'inbound', 'عايز Isis teenderm gel'),
      msg('m2', 1, 'outbound', 'موجود يا فندم والسعر 250 جنيه'),
    ];
    const salesClosing = item(messages, 'sales_closing');
    expect(salesClosing.status).toBe('not_applicable');
    expect(salesClosing.pointsEarned).toBeNull();
    expect(salesClosing.reason).toMatch(/العميل|لا يُحتسب/);
  });

  it('makes sales_closing not applicable when stockout is the blocker', () => {
    const messages = [
      msg('m1', 0, 'inbound', 'الصنف موجود؟'),
      msg('m2', 1, 'outbound', 'للأسف مش موجود حاليا'),
    ];
    const salesClosing = item(messages, 'sales_closing');
    expect(salesClosing.status).toBe('not_applicable');
    expect(salesClosing.reason).toMatch(/المخزون/);
  });

  it('keeps accepted but unconfirmed order as human review, never automatic deduction', () => {
    const messages = [
      msg('m1', 0, 'inbound', 'عايز Isis teenderm gel'),
      msg('m2', 1, 'outbound', 'موجود يا فندم'),
      msg('m3', 2, 'inbound', 'تمام ابعته'),
    ];
    const salesClosing = item(messages, 'sales_closing');
    expect(salesClosing.status).toBe('review_required');
    expect(salesClosing.pointsEarned).toBeNull();
  });

  it('does not open unavailable_items from a customer question alone', () => {
    const messages = [
      msg('m1', 0, 'inbound', 'الصنف مش موجود عندكم؟'),
      msg('m2', 1, 'outbound', 'هراجع لحضرتك'),
    ];
    const unavailable = item(messages, 'unavailable_items');
    expect(unavailable.status).toBe('not_applicable');
  });

  it('still scores first response speed objectively when measurable', () => {
    const messages = [
      msg('m1', 0, 'inbound', 'محتاج صنف'),
      msg('m2', 7, 'outbound', 'حاضر يا فندم'),
    ];
    const response = item(messages, 'first_response_speed');
    expect(response.status).toBe('assessed');
    expect(response.selectedOption).toBe('five_to_10');
    expect(response.pointsEarned).toBe(5);
  });
});
