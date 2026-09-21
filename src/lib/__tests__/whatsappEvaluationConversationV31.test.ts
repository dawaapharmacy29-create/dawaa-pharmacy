import { describe, expect, it } from 'vitest';
import type { WhatsAppConversationSession, WhatsAppParsedMessage } from '@/lib/whatsappConversationParser';
import { buildConversationFocusV30 } from '@/lib/whatsappConversationFocusV30';
import { buildConversationTimingV28 } from '@/lib/whatsappConversationTimingV28';
import { buildEvaluationConversationV31 } from '@/lib/whatsappEvaluationConversationV31';

function msg(id:string, at:string, direction:'inbound'|'outbound', text:string, sender?:string): WhatsAppParsedMessage {
  return { id, timestamp:new Date(at), rawTimestamp:at, sender:sender || (direction==='inbound'?'Customer':'You'), text, direction, kind:'text', forwarded:false, raw:text };
}
function session(messages:WhatsAppParsedMessage[]):WhatsAppConversationSession {
  return { id:'case-v31', startedAt:messages[0].timestamp, endedAt:messages[messages.length-1].timestamp, messages, participants:['Customer','You'], outboundStaffNames:['د اسلام','د مي'], customerName:'ابراهيم الصياد', mediaCount:0, missingMediaCount:0, replyCount:0, forwardedCount:0 };
}

describe('EvaluationConversationV31', () => {
  it('keeps the staff-owned replies and the customer turns they answer while removing unrelated background', () => {
    const s=session([
      msg('c0','2026-09-15T09:00:00','inbound','صباح الخير'),
      msg('o0','2026-09-15T09:01:00','outbound','صباح النور','نور'),
      msg('c1','2026-09-15T10:00:00','inbound','عايز الاوردر'),
      msg('o1','2026-09-15T10:03:00','outbound','تم تأكيد الطلب','اسلام'),
      msg('x1','2026-09-15T10:10:00','outbound','رسالة تشغيلية داخلية غير مهمة','نور'),
      msg('c2','2026-09-15T11:10:00','inbound','الاوردر اتأخر'),
      msg('o2','2026-09-15T11:14:00','outbound','بنعتذر وبنتابع','مي'),
    ]);
    const timing=buildConversationTimingV28(s);
    const focus=buildConversationFocusV30(s,{scoredMessageIds:['o1'],evidenceMessageIds:['c1','o1'],timing});
    const result=buildEvaluationConversationV31(s,{scoredMessageIds:['o1'],evidenceMessageIds:['c1','o1'],focus,staffTiming:timing});
    expect(result.includedMessageIds).toContain('c1');
    expect(result.includedMessageIds).toContain('o1');
    expect(result.excludedMessageIds).toContain('x1');
    expect(result.includedCount).toBeLessThan(s.messages.length);
  });

  it('never includes deleted placeholders in the evaluation transcript', () => {
    const s=session([
      msg('d1','2026-09-15T10:00:00','outbound','You deleted this message','اسلام'),
      msg('c1','2026-09-15T10:01:00','inbound','عايز الطلب'),
      msg('o1','2026-09-15T10:02:00','outbound','حاضر','اسلام'),
    ]);
    const timing=buildConversationTimingV28(s);
    const focus=buildConversationFocusV30(s,{scoredMessageIds:['d1','o1'],timing});
    const result=buildEvaluationConversationV31(s,{scoredMessageIds:['d1','o1'],focus,staffTiming:timing});
    expect(result.includedMessageIds).not.toContain('d1');
  });
});
