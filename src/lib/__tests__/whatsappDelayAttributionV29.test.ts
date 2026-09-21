import { describe, expect, it } from 'vitest';
import type { WhatsAppConversationSession, WhatsAppParsedMessage } from '@/lib/whatsappConversationParser';
import { buildConversationTimingV28 } from '@/lib/whatsappConversationTimingV28';
import { buildDelayAttributionV29 } from '@/lib/whatsappDelayAttributionV29';

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
    id:'case-delay',
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

describe('DelayAttributionV29', () => {
  it('attributes explicit courier delay to delivery, not the current pharmacist', () => {
    const s=session([
      msg('c1','2026-09-15T10:00:00','inbound','عايز الاوردر'),
      msg('o1','2026-09-15T10:02:00','outbound','تم تأكيد الطلب وهيخرج مع المندوب','اسلام'),
      msg('c2','2026-09-15T11:00:00','inbound','المندوب لسه ماوصلش والاوردر متأخر'),
      msg('o2','2026-09-15T11:04:00','outbound','بنعتذر لحضرتك وبنتابع مع المندوب دلوقتي','مي'),
    ]);
    const timing=buildConversationTimingV28(s);
    const result=buildDelayAttributionV29(s,timing);
    expect(result.detected).toBe(true);
    expect(result.cause).toBe('delivery_delay');
    expect(result.caseResponsibility).toBe('delivery');
    expect(result.shouldPenalizeCurrentStaffAutomatically).toBe(false);
  });

  it('attributes a long unanswered customer turn to response delay when no operational cause is evident', () => {
    const s=session([
      msg('c1','2026-09-15T10:00:00','inbound','محتاج اعرف الطلب وصل لفين'),
      msg('o1','2026-09-15T10:18:00','outbound','بنعتذر عن التأخير وبنتابع لحضرتك','اسلام'),
    ]);
    const timing=buildConversationTimingV28(s);
    const result=buildDelayAttributionV29(s,timing);
    expect(result.detected).toBe(true);
    expect(result.cause).toBe('response_delay');
    expect(result.caseResponsibility).toBe('staff_response');
    expect(result.shouldPenalizeCurrentStaffAutomatically).toBe(false);
  });

  it('keeps ambiguous causes unassigned instead of inventing blame', () => {
    const s=session([
      msg('c1','2026-09-15T10:00:00','inbound','لسه الموضوع متأخر'),
      msg('o1','2026-09-15T10:02:00','outbound','هنتابع لحضرتك','اسلام'),
    ]);
    const timing=buildConversationTimingV28(s);
    const result=buildDelayAttributionV29(s,timing);
    expect(result.detected).toBe(true);
    expect(['external_or_unknown','pharmacy_fulfillment_delay','handoff_delay']).toContain(result.cause);
    expect(result.shouldPenalizeCurrentStaffAutomatically).toBe(false);
  });
});
