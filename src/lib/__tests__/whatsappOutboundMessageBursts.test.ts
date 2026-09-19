import { describe, expect, it } from 'vitest';
import type { WhatsAppConversationSession, WhatsAppParsedMessage } from '@/lib/whatsappConversationParser';
import type { WhatsAppParticipantRoleModelV15 } from '@/lib/whatsappParticipantRoleResolverV15';
import { groupOutboundBursts, computeStaffBurstEffort } from '@/lib/whatsappOutboundMessageBursts';

function msg(id: string, at: string, direction: 'inbound' | 'outbound', text: string): WhatsAppParsedMessage {
  return {
    id,
    timestamp: new Date(at),
    rawTimestamp: at,
    sender: direction === 'inbound' ? 'عميل تجريبي' : 'أحمد',
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
    startedAt: messages[0].timestamp,
    endedAt: messages[messages.length - 1].timestamp,
    messages,
    participants: ['عميل تجريبي', 'أحمد'],
    outboundStaffNames: ['أحمد'],
    customerName: 'عميل تجريبي',
    mediaCount: 0,
  };
}

function rolesFor(messages: WhatsAppParsedMessage[], staffId = 'staff-1', staffName = 'أحمد'): WhatsAppParticipantRoleModelV15 {
  return {
    version: 'whatsapp-participant-role-v15',
    messages: messages.map((m) => ({
      messageId: m.id,
      sender: m.sender,
      role: m.direction === 'inbound' ? 'customer' : 'customer_service',
      accountId: m.direction === 'outbound' ? staffId : null,
      staffId: m.direction === 'outbound' ? staffId : null,
      staffName: m.direction === 'outbound' ? staffName : null,
      branch: m.direction === 'outbound' ? 'الفرع الرئيسي' : null,
      confidence: 95,
      reason: 'test',
    })),
    staff: [{ accountId: staffId, staffId, staffName, role: 'customer_service', branch: 'الفرع الرئيسي', confidence: 95 }],
  };
}

describe('groupOutboundBursts', () => {
  it('groups 3 consecutive messages from the same staff into one burst, and marks it replied', () => {
    const messages = [
      msg('m1', '2026-09-01T10:00:00', 'outbound', 'أهلًا بحضرتك'),
      msg('m2', '2026-09-01T10:00:20', 'outbound', 'إزاي أقدر أساعدك؟'),
      msg('m3', '2026-09-01T10:00:40', 'outbound', 'تحت أمرك'),
      msg('m4', '2026-09-01T10:02:00', 'inbound', 'شكرا، عايز فيتامين د'),
    ];
    const s = session(messages);
    const bursts = groupOutboundBursts(s, rolesFor(messages));
    expect(bursts).toHaveLength(1);
    expect(bursts[0].messageCount).toBe(3);
    expect(bursts[0].gotReply).toBe(true);
    expect(bursts[0].replyLatencySeconds).toBe(80); // من آخر رسالة في الـburst (10:00:40) لأول رد (10:02:00)
  });

  it('a burst with no customer reply is not counted as replied', () => {
    const messages = [
      msg('m1', '2026-09-01T10:00:00', 'outbound', 'أهلًا بحضرتك'),
      msg('m2', '2026-09-01T10:00:20', 'outbound', 'تحت أمرك في أي وقت'),
    ];
    const s = session(messages);
    const bursts = groupOutboundBursts(s, rolesFor(messages));
    expect(bursts).toHaveLength(1);
    expect(bursts[0].messageCount).toBe(2);
    expect(bursts[0].gotReply).toBe(false);
    expect(bursts[0].replyLatencySeconds).toBeNull();
  });

  it('computes a burst-level (not message-level) reply rate per staff member', () => {
    const messages = [
      msg('m1', '2026-09-01T10:00:00', 'outbound', 'أهلًا بحضرتك'),
      msg('m2', '2026-09-01T10:00:20', 'outbound', 'إزاي أقدر أساعدك؟'),
      msg('m3', '2026-09-01T10:00:40', 'outbound', 'تحت أمرك'),
      msg('m4', '2026-09-01T10:02:00', 'inbound', 'شكرا، عايز فيتامين د'),
      msg('m5', '2026-09-01T10:03:00', 'outbound', 'تمام هظبطلك الطلب'),
    ];
    const s = session(messages);
    const roles = rolesFor(messages);
    const bursts = groupOutboundBursts(s, roles);
    // burst 1 (m1-m3) replied by m4; burst 2 (m5) has no reply since the session ends.
    expect(bursts).toHaveLength(2);
    const effort = computeStaffBurstEffort(bursts);
    expect(effort).toHaveLength(1);
    expect(effort[0].outboundMessages).toBe(4); // 3 + 1 individual messages, for diagnostics
    expect(effort[0].burstCount).toBe(2);
    expect(effort[0].repliedBursts).toBe(1);
    expect(effort[0].burstReplyRatePct).toBe(50);
  });
});
