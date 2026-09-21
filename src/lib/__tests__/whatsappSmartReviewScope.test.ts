import { describe, expect, it } from 'vitest';
import type { WhatsAppConversationSession, WhatsAppParsedMessage } from '../whatsappConversationParser';
import { applySmartReviewMessageScope } from '../whatsappSmartReviewScope';

function msg(id: string, at: string, direction: 'inbound' | 'outbound', text: string): WhatsAppParsedMessage {
  return { id, timestamp: new Date(at), rawTimestamp: at, sender: direction === 'outbound' ? 'You' : 'Customer', text, direction, kind: 'text', forwarded: false, raw: text };
}
function session(messages: WhatsAppParsedMessage[]): WhatsAppConversationSession {
  return { id: 's1', startedAt: messages[0].timestamp, endedAt: messages[messages.length - 1].timestamp, messages, participants: ['You','Customer'], outboundStaffNames: [], customerName: 'Customer', mediaCount: 0 };
}

describe('whatsappSmartReviewScope', () => {
  const s = session([
    msg('a1','2026-09-13T03:01:00','outbound','مع حضرتك د اسلام'),
    msg('c1','2026-09-13T03:02:00','inbound','محتاج واحد من ده'),
    msg('a2','2026-09-13T03:03:00','outbound','من عنيا لحضرتك'),
    msg('b1','2026-09-13T03:04:00','outbound','مع حضرتك د شبل'),
    msg('c2','2026-09-13T03:05:00','inbound','لسه الاوردر موصلش'),
    msg('b2','2026-09-13T03:06:00','outbound','انا متاسف لحضرتك عالتاخير'),
  ]);

  it('scopes by verified owner at message level', () => {
    const result = applySmartReviewMessageScope(s, { staffName: 'اسلام', role: 'pharmacist' });
    expect(result.inScopeMessageIds).toEqual(['a1','c1','a2']);
    expect(result.inScopeMessageIds).not.toContain('c2');
  });

  it('applies exact from/to inside ownership without leaking another doctor', () => {
    const result = applySmartReviewMessageScope(s, {
      staffName: 'شبل', role: 'pharmacist',
      from: new Date('2026-09-13T03:05:00'),
      to: new Date('2026-09-13T03:06:00'),
    });
    expect(result.inScopeMessageIds).toEqual(['c2','b2']);
    expect(result.inScopeMessageIds).not.toContain('b1');
  });

  it('keeps bounded context visible but outside scoring', () => {
    const result = applySmartReviewMessageScope(s, {
      staffName: 'شبل', role: 'pharmacist',
      from: new Date('2026-09-13T03:05:00'),
      to: new Date('2026-09-13T03:05:00'),
      contextMessages: 1,
    });
    expect(result.inScopeMessageIds).toEqual(['c2']);
    expect(result.contextMessageIds).toContain('b1');
    expect(result.contextMessageIds).toContain('b2');
    expect(result.scoredSession?.messages.map((m) => m.id)).toEqual(['c2']);
  });

  it('does not turn a long unrelated middle episode into context for disjoint ownership ranges', () => {
    const d = session([
      msg('a1','2026-09-13T03:01:00','outbound','مع حضرتك د اسلام'),
      msg('a2','2026-09-13T03:02:00','outbound','تمام'),
      msg('b1','2026-09-13T03:03:00','outbound','مع حضرتك د شبل'),
      msg('b2','2026-09-13T03:04:00','inbound','رسالة 1'),
      msg('b3','2026-09-13T03:05:00','outbound','رد 1'),
      msg('b4','2026-09-13T03:06:00','inbound','رسالة 2'),
      msg('b5','2026-09-13T03:07:00','outbound','رد 2'),
      msg('a3','2026-09-13T03:08:00','outbound','مع حضرتك د اسلام'),
      msg('a4','2026-09-13T03:09:00','outbound','تحت امرك'),
    ]);
    const result = applySmartReviewMessageScope(d, { staffName: 'اسلام', role: 'pharmacist', contextMessages: 1 });
    expect(result.contextMessageIds).toContain('b1');
    expect(result.contextMessageIds).toContain('b5');
    expect(result.contextMessageIds).not.toContain('b3');
  });

  it('blocks invalid time ranges and empty owner matches', () => {
    const invalid = applySmartReviewMessageScope(s, { from: new Date('2026-09-13T03:06:00'), to: new Date('2026-09-13T03:05:00') });
    expect(invalid.valid).toBe(false);
    const missing = applySmartReviewMessageScope(s, { staffName: 'غير موجود', role: 'pharmacist' });
    expect(missing.valid).toBe(false);
  });

  it('does not mutate the original session', () => {
    const before = s.messages.map((m) => m.id);
    applySmartReviewMessageScope(s, { staffName: 'اسلام', role: 'pharmacist' });
    expect(s.messages.map((m) => m.id)).toEqual(before);
  });
});
