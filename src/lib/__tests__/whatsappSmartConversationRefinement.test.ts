import { describe, expect, it } from 'vitest';
import type { WhatsAppConversationSession, WhatsAppParsedMessage } from '../whatsappConversationParser';
import { analyzeSmartConversationDeep } from '../whatsappSmartConversationIntelligence';
import { refineSmartDeepConversationAnalysis } from '../whatsappSmartConversationRefinement';

function msg(id: string, at: string, direction: 'inbound'|'outbound', text: string): WhatsAppParsedMessage {
  return { id, timestamp: new Date(at), rawTimestamp: at, sender: direction === 'outbound' ? 'You' : 'Customer', text, direction, kind: 'text', forwarded: false, raw: text };
}
function session(messages: WhatsAppParsedMessage[]): WhatsAppConversationSession {
  return { id: 's', startedAt: messages[0].timestamp, endedAt: messages[messages.length - 1].timestamp, messages, participants: ['You','Customer'], outboundStaffNames: [], customerName: 'عميل', mediaCount: 0 };
}

describe('whatsapp smart conversation refinement', () => {
  it('keeps a product-order conversation as product request when heartburn is only a requested product indication', () => {
    const s = session([
      msg('c1','2026-09-13T03:06:40','inbound','محتاجه واحد من دا'),
      msg('o1','2026-09-13T03:09:19','outbound','من عنيا لحضرتك'),
      msg('c2','2026-09-13T03:11:31','inbound','ايوا ممكن فوار للحموضه'),
      msg('o2','2026-09-13T03:15:16','outbound','هبعت لحضرتك دونوبرازول فوار باذن الله'),
    ]);
    const refined = refineSmartDeepConversationAnalysis(s, analyzeSmartConversationDeep(s));
    expect(refined.primaryIntent).toBe('product_request');
    expect(refined.intentJourney).not.toContain('consultation');
    expect(refined.consultationCommunication).toBe('not_applicable');
    expect(refined.suggestedCriteria).not.toContain('consultation_quality');
  });

  it('preserves a real symptom-led consultation', () => {
    const s = session([
      msg('c1','2026-09-14T01:17:21','inbound','مغص ف بطنى وف المعدة'),
      msg('o1','2026-09-14T01:17:33','outbound','تمام حضرتك في اسهال او امساك'),
      msg('c2','2026-09-14T01:17:45','inbound','لاء بس حاسة بغثيان'),
    ]);
    const refined = refineSmartDeepConversationAnalysis(s, analyzeSmartConversationDeep(s));
    expect(refined.primaryIntent).toBe('consultation');
    expect(refined.intentJourney).toContain('consultation');
  });

  it('preserves service followup as the primary intent when customer service starts the session', () => {
    const s = session([
      msg('o1','2026-09-14T18:10:10','outbound','مع حضرتك نور من خدمة عملاء صيدليات دواء حابين نطمن على حضرتك'),
      msg('c1','2026-09-14T18:16:08','inbound','الحمد لله تمام'),
    ]);
    const refined = refineSmartDeepConversationAnalysis(s, analyzeSmartConversationDeep(s));
    expect(refined.primaryIntent).toBe('service_followup');
  });
});
