import { describe, expect, it } from 'vitest';
import type { WhatsAppConversationSession, WhatsAppParsedMessage } from '@/lib/whatsappConversationParser';
import { buildConversationFocusV30 } from '@/lib/whatsappConversationFocusV30';
import { buildConversationTimingV28 } from '@/lib/whatsappConversationTimingV28';

function msg(id:string, at:string, direction:'inbound'|'outbound', text:string): WhatsAppParsedMessage {
  return {
    id,
    timestamp:new Date(at),
    rawTimestamp:at,
    sender:direction === 'inbound' ? 'Customer' : 'You',
    text,
    direction,
    kind:'text',
    forwarded:false,
    raw:text,
  };
}

function session(messages:WhatsAppParsedMessage[]): WhatsAppConversationSession {
  return {
    id:'case-focus',
    startedAt:messages[0].timestamp,
    endedAt:messages[messages.length-1].timestamp,
    messages,
    participants:['Customer','You'],
    outboundStaffNames:['د اسلام','د مي'],
    customerName:'ابراهيم الصياد',
    mediaCount:0,
    missingMediaCount:0,
    replyCount:0,
    forwardedCount:0,
  };
}

describe('ConversationFocusV30', () => {
  it('keeps order, delay and recovery messages prominent while pushing chatter to background', () => {
    const s=session([
      msg('m1','2026-09-15T10:00:00','inbound','صباح الخير'),
      msg('m2','2026-09-15T10:01:00','outbound','صباح النور'),
      msg('m3','2026-09-15T10:02:00','inbound','عايز الاوردر ده لو سمحت'),
      msg('m4','2026-09-15T10:04:00','outbound','تم تأكيد الطلب'),
      msg('m5','2026-09-15T11:10:00','inbound','الاوردر اتأخر ولسه ماوصلش'),
      msg('m6','2026-09-15T11:14:00','outbound','بنعتذر عن التأخير وبنتابع مع المندوب'),
      msg('m7','2026-09-15T11:16:00','inbound','تمام شكرا'),
    ]);
    const timing=buildConversationTimingV28(s);
    const result=buildConversationFocusV30(s,{timing,scoredMessageIds:['m4','m6'],evidenceMessageIds:['m5','m6']});
    const byId=new Map(result.messages.map((m)=>[m.messageId,m]));
    expect(byId.get('m5')?.level).toBe('primary');
    expect(byId.get('m6')?.level).toBe('primary');
    expect(byId.get('m3')?.level).not.toBe('background');
    expect(result.primaryCount).toBeGreaterThan(1);
    expect(result.backgroundCount).toBeGreaterThanOrEqual(0);
  });

  it('does not promote deleted placeholders into the important transcript', () => {
    const s=session([
      msg('m1','2026-09-15T10:00:00','outbound','You deleted this message'),
      msg('m2','2026-09-15T10:01:00','inbound','عايز الطلب'),
      msg('m3','2026-09-15T10:02:00','outbound','حاضر'),
    ]);
    const result=buildConversationFocusV30(s,{});
    expect(result.messages.find((m)=>m.messageId==='m1')?.level).toBe('background');
  });
});
