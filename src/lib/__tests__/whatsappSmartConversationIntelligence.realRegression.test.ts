import { describe, expect, it } from 'vitest';
import type { WhatsAppConversationSession, WhatsAppParsedMessage } from '../whatsappConversationParser';
import { analyzeSmartConversationDeep } from '../whatsappSmartConversationIntelligence';

function msg(id: string, at: string, direction: 'inbound'|'outbound', text: string): WhatsAppParsedMessage {
  return { id, timestamp: new Date(at), rawTimestamp: at, sender: direction === 'outbound' ? 'You' : 'Customer', text, direction, kind: 'text', forwarded: false, raw: text };
}
function session(messages: WhatsAppParsedMessage[]): WhatsAppConversationSession {
  return { id: 's', startedAt: messages[0].timestamp, endedAt: messages[messages.length - 1].timestamp, messages, participants: ['You','Customer'], outboundStaffNames: [], customerName: 'عميل', mediaCount: 0 };
}

describe('whatsapp smart intelligence regressions from real chats', () => {
  it('does not turn order acceptance or delivery-status questions into new missed sales opportunities', () => {
    const s = session([
      msg('c1','2026-09-15T21:31:16','inbound','موجود عندكم الغسول ده'),
      msg('o1','2026-09-15T21:32:09','outbound','موجود باذن الله يافندم'),
      msg('o2','2026-09-15T21:35:06','outbound','تحب نبعته لحضرتك باذن الله ؟'),
      msg('c2','2026-09-15T21:42:30','inbound','اه ابعته'),
      msg('o3','2026-09-15T21:42:57','outbound','من عنيا لحضرتك مسافة الطريق ويكون عند حضرتك'),
      msg('c3','2026-09-15T22:28:27','inbound','حضرتك بعت الاوردر'),
      msg('o4','2026-09-15T22:28:58','outbound','اه يا فندم المندوب في الطريق لحضرتك'),
    ]);
    const result = analyzeSmartConversationDeep(s);
    expect(result.salesOpportunities).toHaveLength(1);
    expect(result.salesOpportunities[0]?.handling).toBe('handled_well');
  });

  it('does not classify an explicit no-problem reply as a customer complaint', () => {
    const s = session([
      msg('o1','2026-09-13T04:18:37','outbound','ممكن يتاخر حاجة بسيطة بس'),
      msg('c1','2026-09-13T04:30:12','inbound','مفيش مشكله'),
      msg('o2','2026-09-13T06:05:12','outbound','انا متاسف لحضرتك عالتاخير الكبير دا والله'),
    ]);
    const result = analyzeSmartConversationDeep(s);
    expect(result.intentJourney).not.toContain('complaint');
    expect(result.followup.reason).not.toBe('service_issue');
  });

  it('counts confirmed dispatch as successful handling for a straightforward requested item', () => {
    const s = session([
      msg('c1','2026-09-10T18:47:20','inbound','وعاوزة شريط سيبرو برو'),
      msg('o1','2026-09-10T18:48:41','outbound','تحت امر حضرتك يا فندم حضرتك تؤمر بحاجة تانية'),
      msg('c2','2026-09-10T18:51:35','inbound','لاء شكرا'),
      msg('o2','2026-09-10T18:53:16','outbound','جاري الارسال نتشرف بخدمة حضرتك ٢٤ ساعه'),
    ]);
    const result = analyzeSmartConversationDeep(s);
    expect(result.salesOpportunities).toHaveLength(1);
    expect(result.salesOpportunities[0]?.handling).toBe('handled_well');
  });
});
