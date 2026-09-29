import { describe, expect, it } from 'vitest';
import type { WhatsAppConversationSession, WhatsAppParsedMessage } from '@/lib/whatsappConversationParser';
import { buildWhatsAppCaseContextsV27 } from '@/lib/whatsappCaseContextV27';

function msg(id: string, at: string, direction: 'inbound'|'outbound', text: string): WhatsAppParsedMessage {
  const timestamp = new Date(at);
  return {
    id,
    timestamp,
    rawTimestamp: at,
    sender: direction === 'inbound' ? 'Customer' : 'You',
    text,
    direction,
    kind: 'text',
    forwarded: false,
    raw: text,
  };
}

function session(id: string, messages: WhatsAppParsedMessage[], staffNames: string[]): WhatsAppConversationSession {
  return {
    id,
    startedAt: messages[0].timestamp,
    endedAt: messages[messages.length - 1].timestamp,
    messages,
    participants: ['Customer','You'],
    outboundStaffNames: staffNames,
    customerName: 'ابراهيم الصياد',
    mediaCount: 0,
    missingMediaCount: 0,
    replyCount: 0,
    forwardedCount: 0,
  };
}

describe('WhatsAppCaseContextV27', () => {
  it('merges split sessions of the same delayed order into one case while preserving both doctors', () => {
    const rows = [
      session('s1', [
        msg('m1','2026-09-15T10:00:00','inbound','عايز الاوردر ده لو سمحت'),
        msg('m2','2026-09-15T10:01:00','outbound','مع حضرتك د اسلام، حاضر هظبط لحضرتك الطلب'),
      ], ['د اسلام']),
      session('s2', [
        msg('m3','2026-09-15T11:10:00','inbound','الاوردر اتأخر ولسه ماوصلش'),
        msg('m4','2026-09-15T11:12:00','outbound','مع حضرتك د مي، بنعتذر عن التأخير وبنتابع مع الفريق المختص'),
      ], ['د مي']),
    ];

    const result = buildWhatsAppCaseContextsV27(rows);
    expect(result.caseEngine.caseCount).toBe(1);
    expect(result.contexts).toHaveLength(1);
    expect(result.contexts[0].sessionIds).toEqual(['s1','s2']);
    expect(result.contexts[0].mergedSession.messages).toHaveLength(4);
    expect(result.contexts[0].mergedSession.outboundStaffNames).toEqual(expect.arrayContaining(['د اسلام','د مي']));
  });

  it('keeps unrelated far-apart orders as separate cases', () => {
    const rows = [
      session('s1', [
        msg('m1','2026-08-01T10:00:00','inbound','عايز اوردر'),
        msg('m2','2026-08-01T10:10:00','outbound','تم تأكيد الطلب'),
      ], ['د اسلام']),
      session('s2', [
        msg('m3','2026-08-25T10:00:00','inbound','محتاج اوردر جديد'),
        msg('m4','2026-08-25T10:05:00','outbound','تم تأكيد الطلب'),
      ], ['د مي']),
    ];
    const result = buildWhatsAppCaseContextsV27(rows);
    expect(result.caseEngine.caseCount).toBe(2);
  });
});
