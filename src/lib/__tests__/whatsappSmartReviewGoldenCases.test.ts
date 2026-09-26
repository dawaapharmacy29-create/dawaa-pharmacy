import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '../whatsappConversationParser';
import { analyzeSmartConversationDeep } from '../whatsappSmartConversationIntelligence';
import { buildSmartReviewQualityGate } from '../whatsappSmartReviewQualityGate';

function latestSession(raw: string) {
  const sessions = splitWhatsAppSessions(parseWhatsAppExport(raw), 120);
  const session = sessions.at(-1);
  if (!session) throw new Error('missing session');
  return session;
}

describe('whatsappSmartReview golden conversation quality gates', () => {
  it('customer product request + omitted image stays product/order but requires media confirmation', () => {
    const s = latestSession(`[9/13/26, 3:01:39 AM] You: أهلًا وسهلًا بحضرتك
مع حضرتك د اسلام
[9/13/26, 3:06:40 AM] Customer: <image omitted>
[9/13/26, 3:06:41 AM] Customer: محتاجه واحد من دا
[9/13/26, 3:09:19 AM] You: من عنيا لحضرتك
[9/13/26, 3:09:33 AM] You: حضرتك محتاجه حاجه تانيه مع الاوردر؟
[9/13/26, 3:11:31 AM] Customer: ايوا ممكن فوار للحموضه
[9/13/26, 4:15:55 AM] You: ابعتهم لحضرتك على العنوان؟`);
    const deep = analyzeSmartConversationDeep(s);
    const gate = buildSmartReviewQualityGate(s, deep);
    expect(deep.entryOrigin).toBe('customer_initiated');
    expect(deep.intentJourney).toContain('product_request');
    expect(deep.salesOpportunities.some((item) => item.handling === 'handled_well' || item.handling === 'partial')).toBe(true);
    expect(gate.humanReviewRequired).toBe(true);
    expect(gate.criticalMissingMediaMessageIds.length).toBeGreaterThan(0);
  });

  it('staff apology alone does not create a customer complaint', () => {
    const s = latestSession(`[9/13/26, 4:30:12 AM] Customer: مفيش مشكله
[9/13/26, 6:04:58 AM] You: أهلًا وسهلًا بحضرتك
مع حضرتك د شبل
[9/13/26, 6:05:12 AM] You: انا متاسف لحضرتك عالتاخير الكبير دا
[9/13/26, 6:06:31 AM] You: المندوب بيحاول يتواصل مع حضرتك`);
    const deep = analyzeSmartConversationDeep(s);
    expect(deep.intentJourney).not.toContain('complaint');
  });

  it('clear availability-to-close flow is treated as a well handled sales opportunity', () => {
    const s = latestSession(`[9/15/26, 9:31:05 PM] You: أهلًا وسهلًا بحضرتك
مع حضرتك د اسلام
[9/15/26, 9:31:16 PM] Customer: موجود عندكم الغسول ده
[9/15/26, 9:32:09 PM] You: موجود باذن الله
[9/15/26, 9:35:06 PM] You: تحب نبعته لحضرتك باذن الله ؟
[9/15/26, 9:42:30 PM] Customer: اه ابعته
[9/15/26, 9:42:57 PM] You: من عنيا لحضرتك مسافه الطريق ويكون عند حضرتك`);
    const deep = analyzeSmartConversationDeep(s);
    expect(deep.entryOrigin).toBe('customer_initiated');
    expect(deep.intentJourney).toContain('availability_check');
    expect(deep.salesOpportunities[0]?.handling).toBe('handled_well');
  });

  it('customer-service followup handed to pharmacist keeps the conversation origin and flags clinical voice blind spots', () => {
    const s = latestSession(`[9/15/26, 6:14:37 PM] You: مساء الخير
مع حضرتك نور من خدمة عملاء صيدليات دواء
حبيت أطمن على حضرتك، هل اعراض الكحه بدأت تخف؟
[9/15/26, 6:19:17 PM] Customer: لسه شويه كده كحه بسيطه بس في همدان
[9/15/26, 6:20:54 PM] You: هحوّل حضرتك حالًا لأحد الصيادلة
[9/15/26, 6:23:42 PM] You: أهلًا وسهلًا بحضرتك
مع حضرتك د دنيا
[9/15/26, 6:23:56 PM] You: حضرتك بتاخد علاج ايه حاليا؟
[9/15/26, 6:25:40 PM] Customer: <voice message omitted>
[9/15/26, 6:27:02 PM] You: الشراب اللي حضرتك جيبته مكتوب عليه طارد ولا مذيب للبلغم؟
[9/15/26, 6:41:19 PM] Customer: <voice message omitted>
[9/15/26, 6:46:43 PM] You: <voice message omitted>`);
    const deep = analyzeSmartConversationDeep(s);
    const gate = buildSmartReviewQualityGate(s, deep);
    expect(deep.entryOrigin).toBe('customer_service_outreach');
    expect(deep.primaryIntent).toBe('service_followup');
    expect(deep.intentJourney).toContain('consultation');
    expect(gate.humanReviewRequired).toBe(true);
  });
});
