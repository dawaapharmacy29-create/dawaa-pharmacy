import { describe, expect, it } from 'vitest';
import type { WhatsAppConversationSession, WhatsAppParsedMessage } from '@/lib/whatsappConversationParser';
import { buildConversationTimingV28 } from '@/lib/whatsappConversationTimingV28';

function msg(id:string, at:string, direction:'inbound'|'outbound', text:string, sender?:string): WhatsAppParsedMessage {
  return {
    id,
    timestamp:new Date(at),
    rawTimestamp:at,
    sender:sender || (direction === 'inbound' ? 'Customer' : 'You'),
    text,
    direction,
    kind:'text',
    forwarded:false,
    raw:text,
  };
}
function session(messages:WhatsAppParsedMessage[]):WhatsAppConversationSession {
  return {
    id:'case-1',
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

describe('ConversationTimingV28', () => {
  it('measures customer turn response and delayed-order recovery across one case', () => {
    const s=session([
      msg('c1','2026-09-15T10:00:00','inbound','عايز الاوردر ده'),
      msg('o1','2026-09-15T10:03:00','outbound','حاضر هظبط الطلب','اسلام'),
      msg('c2','2026-09-15T11:10:00','inbound','الاوردر اتأخر ولسه ماوصلش'),
      msg('o2','2026-09-15T11:14:00','outbound','بنعتذر عن التأخير وبنتابع مع الفريق','مي'),
    ]);
    const result=buildConversationTimingV28(s);
    expect(result.responseSummary.customerTurns).toBe(2);
    expect(result.responseSummary.firstResponseSeconds).toBe(180);
    expect(result.responseSummary.medianResponseSeconds).toBe(210);
    expect(result.orderTimeline.requestToFirstResponseSeconds).toBe(180);
    expect(result.orderTimeline.problemToRecoverySeconds).toBe(240);
    expect(result.episodes.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps timing descriptive and exposes long gaps as episode boundaries', () => {
    const s=session([
      msg('c1','2026-09-15T10:00:00','inbound','محتاج صنف'),
      msg('o1','2026-09-15T10:01:00','outbound','متاح','اسلام'),
      msg('c2','2026-09-15T12:00:00','inbound','لسه الطلب ماوصلش'),
      msg('o2','2026-09-15T12:02:00','outbound','هنتابع لحضرتك','مي'),
    ]);
    const result=buildConversationTimingV28(s);
    expect(result.episodes).toHaveLength(2);
    expect(result.episodes[1].gapFromPreviousMinutes).toBeGreaterThanOrEqual(100);
    expect(result.responseSummary.within5mRate).toBe(100);
  });
});
