import { describe, expect, it } from 'vitest';
import type { WhatsAppConversationSession, WhatsAppParsedMessage } from '../whatsappConversationParser';
import { analyzeSmartConversationDeep } from '../whatsappSmartConversationIntelligence';

function msg(id: string, at: string, direction: 'inbound'|'outbound', text: string): WhatsAppParsedMessage {
  return { id, timestamp: new Date(at), rawTimestamp: at, sender: direction === 'outbound' ? 'You' : 'Customer', text, direction, kind: 'text', forwarded: false, raw: text };
}
function session(messages: WhatsAppParsedMessage[]): WhatsAppConversationSession {
  return { id: 's', startedAt: messages[0].timestamp, endedAt: messages[messages.length - 1].timestamp, messages, participants: ['You','Customer'], outboundStaffNames: [], customerName: 'عميل', mediaCount: 0 };
}

describe('whatsappSmartConversationIntelligence', () => {
  it('distinguishes customer service outreach from customer initiated request', () => {
    const outreach = session([
      msg('o1','2026-09-17T10:00:00','outbound','مساء الخير مع حضرتك نور من خدمة عملاء صيدليات دواء، حابين نطمن على مستوى الخدمة'),
      msg('c1','2026-09-17T10:02:00','inbound','الخدمة ممتازة'),
    ]);
    expect(analyzeSmartConversationDeep(outreach).entryOrigin).toBe('customer_service_outreach');
    expect(analyzeSmartConversationDeep(outreach).primaryIntent).toBe('service_followup');

    const request = session([
      msg('c1','2026-09-17T10:00:00','inbound','محتاج علبة من الصنف ده موجود؟'),
      msg('o1','2026-09-17T10:01:00','outbound','مع حضرتك د اسلام'),
    ]);
    expect(analyzeSmartConversationDeep(request).entryOrigin).toBe('customer_initiated');
    expect(analyzeSmartConversationDeep(request).intentJourney).toContain('product_request');
  });

  it('treats proactive customer-service apology for order delay as service recovery, not a product request', () => {
    const recovery = session([
      msg('o1','2026-09-17T10:00:00','outbound','أهلاً بحضرتك، مع حضرتك نور من خدمة عملاء صيدليات دواء. بنعتذر لحضرتك عن التأخير اللي حصل في طلب حضرتك وبنتابع مع الفريق المختص علشان يتم التوصيل في أسرع وقت ممكن.'),
      msg('c1','2026-09-17T10:04:00','inbound','تمام شكراً لحضرتك'),
    ]);
    const result = analyzeSmartConversationDeep(recovery);
    expect(result.entryOrigin).toBe('customer_service_outreach');
    expect(result.primaryIntent).toBe('service_recovery');
    expect(result.intentJourney).toContain('service_recovery');
    expect(result.intentJourney).not.toContain('product_request');
    expect(result.followup.detected).toBe(true);
    expect(result.followup.reason).toBe('service_issue');
  });

  it('tracks unavailable item alternative and customer request registration separately', () => {
    const s = session([
      msg('c1','2026-09-17T10:00:00','inbound','محتاج مونجارو 5'),
      msg('o1','2026-09-17T10:01:00','outbound','مع حضرتك د اسلام، الصنف مش متوفر حاليا'),
      msg('o2','2026-09-17T10:02:00','outbound','ممكن أرشح لحضرتك بديل مناسب ونشرح الفرق'),
      msg('o3','2026-09-17T10:03:00','outbound','تم تسجيل طلب حضرتك وخدمة العملاء هتتابع مع حضرتك'),
    ]);
    const result = analyzeSmartConversationDeep(s);
    expect(result.unavailableItem.detected).toBe(true);
    expect(result.unavailableItem.alternativeOffered).toBe(true);
    expect(result.unavailableItem.alternativeExplained).toBe(true);
    expect(result.unavailableItem.requestRegistered).toBe(true);
    expect(result.unavailableItem.customerToldRequestRegistered).toBe(true);
    expect(result.suggestedCriteria).toContain('unavailable_items');
    expect(result.suggestedCriteria).toContain('customer_request_registration');
  });

  it('evaluates consultation communication style without judging medical correctness', () => {
    const s = session([
      msg('c1','2026-09-17T10:00:00','inbound','ابني عنده كحة، الدوا ده مناسب؟'),
      msg('o1','2026-09-17T10:01:00','outbound','مع حضرتك د هدى'),
      msg('o2','2026-09-17T10:02:00','outbound','طريقة الاستخدام كذا، وده بيساعد في كذا، ولو الأعراض استمرت يفضل تراجعي الطبيب'),
    ]);
    const result = analyzeSmartConversationDeep(s);
    expect(result.primaryIntent).toBe('consultation');
    expect(result.consultationCommunication).toBe('clear');
    expect(result.suggestedCriteria).toContain('consultation_quality');
  });

  it('extracts structured customer request fields and requires confirmation when incomplete', () => {
    const complete = session([
      msg('o1','2026-09-17T10:00:00','outbound','طلب عميل\nاسم العميل: أحمد علي\nكود العميل: 4250\nرقم العميل: 01000000000\nاسم الصنف: فلورست\nالكمية: 2'),
    ]);
    const a = analyzeSmartConversationDeep(complete).customerRequest;
    expect(a.detected).toBe(true);
    expect(a.productName).toBe('فلورست');
    expect(a.customerCode).toBe('4250');
    expect(a.needsConfirmation).toBe(false);

    const incomplete = session([
      msg('o1','2026-09-17T10:00:00','outbound','طلب عميل\nالصنف: فلورست'),
    ]);
    expect(analyzeSmartConversationDeep(incomplete).customerRequest.needsConfirmation).toBe(true);
  });

  it('marks a product request as a missed sales opportunity when staff replies but does not guide or close', () => {
    const s = session([
      msg('c1','2026-09-17T10:00:00','inbound','محتاج الصنف ده موجود؟'),
      msg('o1','2026-09-17T10:01:00','outbound','ايوه موجود'),
    ]);
    const result = analyzeSmartConversationDeep(s);
    expect(result.salesOpportunities[0]?.handling).toBe('missed');
    expect(result.suggestedCriteria).toContain('sales_closing');
  });
});
