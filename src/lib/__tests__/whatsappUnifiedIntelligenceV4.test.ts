import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildUnifiedConversationIntelligence, summarizePortfolio } from '@/lib/whatsappUnifiedIntelligenceV4';
import { buildWhatsAppOperationalIntelligenceV6 } from '@/lib/whatsappOperationalIntelligenceV6';

function oneSession(raw: string) {
  const messages = parseWhatsAppExport(raw);
  const sessions = splitWhatsAppSessions(messages, 120);
  expect(sessions.length).toBeGreaterThan(0);
  return sessions[0];
}

describe('WhatsApp Review V4 unified intelligence', () => {
  it('parses a normal English/Windows export and detects a completed sale', () => {
    const session = oneSession(`[9/15/26, 9:00:00 AM] Customer: صباح الخير، فيتامين د متوفر وبكام؟\n[9/15/26, 9:01:00 AM] You: صباح النور، مع حضرتك د هبة من صيدليات دواء. متوفر بسعر 250 جنيه\n[9/15/26, 9:02:00 AM] You: تحب نضيفه على أوردر حضرتك؟\n[9/15/26, 9:03:00 AM] Customer: تمام ابعته\n[9/15/26, 9:04:00 AM] You: تم تأكيد الطلب وهيتم التوصيل، تحت أمر حضرتك في أي وقت`);
    const result = buildUnifiedConversationIntelligence(session);
    expect(result.outcome).toBe('sold');
    expect(result.followupRequired).toBe(false);
    expect(result.commercialEligible).toBe(true);
    expect(result.commercialScore).toBeGreaterThan(50);
    expect(result.serviceScore).toBeGreaterThan(60);
  });

  it('detects stockout without alternative as an urgent lost-sale risk', () => {
    const session = oneSession(`[9/15/26, 9:00:00 AM] Customer: المنتج ده موجود؟\n[9/15/26, 9:01:00 AM] You: لا مش موجود حاليا`);
    const result = buildUnifiedConversationIntelligence(session);
    expect(result.lostSales.some((x) => x.severity === 'high')).toBe(true);
    expect(result.priority).toBe('urgent');
    expect(result.followupRequired).toBe(true);
  });

  it('forces human approval for high-risk dosage context', () => {
    const session = oneSession(`[9/15/26, 9:00:00 AM] Customer: ابني عنده حرارة، جرعة طفل كام؟\n[9/15/26, 9:01:00 AM] You: الجرعة 5 مل مرتين يوميا بعد الأكل`);
    const result = buildUnifiedConversationIntelligence(session);
    expect(result.medicalSafetyFlags.some((x) => x.severity === 'high')).toBe(true);
    expect(result.requiresHumanApproval).toBe(true);
  });

  it('infers pharmacy sender when export does not label messages as You', () => {
    const session = oneSession(`[15/09/2026, 09:00 ص] أحمد: صباح الخير، المنتج متوفر؟\n[15/09/2026, 09:01 ص] صيدليات دواء: مساء الخير، مع حضرتك د هبة من صيدليات دواء. متوفر لحضرتك\n[15/09/2026, 09:02 ص] أحمد: تمام ابعته\n[15/09/2026, 09:03 ص] صيدليات دواء: تم تأكيد الطلب وهيتم التوصيل`);
    expect(session.messages.filter((m) => m.direction === 'outbound').length).toBeGreaterThan(0);
    expect(session.outboundStaffNames.length).toBeGreaterThan(0);
    expect(buildUnifiedConversationIntelligence(session).outcome).toBe('sold');
  });

  it('does not treat a customer availability question as pharmacy-confirmed availability', () => {
    const s = oneSession(`[9/15/26, 9:00:00 AM] Customer: المنتج متوفر؟
[9/15/26, 9:01:00 AM] You: لحظة أشوفه لحضرتك`);
    const result = buildUnifiedConversationIntelligence(s);
    expect(result.journeyStages.find((x) => x.key === 'need')?.detected).toBe(true);
    expect(result.journeyStages.find((x) => x.key === 'availability')?.detected).toBe(false);
  });

  it('does not classify a generic thank-you as customer acceptance', () => {
    const s = oneSession(`[9/15/26, 9:00:00 AM] Customer: المنتج متوفر؟
[9/15/26, 9:01:00 AM] You: متوفر يا فندم
[9/15/26, 9:02:00 AM] Customer: شكرا جدا
[9/15/26, 9:03:00 AM] You: تحت أمر حضرتك في أي وقت`);
    const result = buildUnifiedConversationIntelligence(s);
    expect(result.outcome).not.toBe('sold');
  });

  it('requires an outbound pharmacy close before chat outcome can be sold', () => {
    const s = oneSession(`[9/15/26, 9:00:00 AM] Customer: عايز فاتورة للطلب
[9/15/26, 9:01:00 AM] You: حاضر يا فندم بشوف لحضرتك`);
    const result = buildUnifiedConversationIntelligence(s);
    expect(result.journeyStages.find((x) => x.key === 'closing')?.detected).toBe(false);
    expect(result.outcome).not.toBe('sold');
  });

  it('does not mark stockout leakage from a customer question alone', () => {
    const s = oneSession(`[9/15/26, 9:00:00 AM] Customer: هو المنتج مش موجود؟
[9/15/26, 9:01:00 AM] You: لحظة أتأكد لحضرتك`);
    const result = buildUnifiedConversationIntelligence(s);
    expect(result.lostSales.some((x) => x.summary.includes('نقص/عدم توفر'))).toBe(false);
  });

  it('treats an anaphoric customer commitment plus sent-order message as a closed request', () => {
    const s = oneSession(`[12/22/25, 8:54:31 AM] Customer: كريم كوريغا متاح
[12/22/25, 8:57:44 AM] You: متاح
[12/22/25, 9:00:51 AM] Customer: هحتاجه علي العنوان سوق الحدادين
[12/22/25, 9:14:17 AM] You: تم الارسال
نتشرف ب خدمة حضرتك ٢٤ ساعه 🌸🌸`);
    const result = buildUnifiedConversationIntelligence(s);
    expect(result.outcome).toBe('sold');
    expect(result.journeyStages.find((x) => x.key === 'closing')?.detected).toBe(true);
  });

  it('keeps an answered price inquiry informational and does not infer medical intent from الماسك', () => {
    const s = oneSession(`[12/22/25, 2:08:06 PM] Customer: مجموعه كلاري بكام
[12/22/25, 2:09:22 PM] You: دقايق اشوف لحضرتك سعرها
[12/22/25, 2:13:55 PM] You: البلسم ٣٢٠
الشامبو العادي ٣٠٠
شامبو القشره ٣٢٠
سيروم التساقط ٣٥٠
بوستر شوت التساقط ٤٥٠
ليف ان كريم ٣٠٠
الماسك ٣٦٠
[12/22/25, 2:14:26 PM] You: في حال ان حضرتك محتاجه منتجين او اكتر هيكون عليهم خصم ان شاء الله
[12/22/25, 2:20:20 PM] You: المجموعة كامله يفندم هيكون سعرها ٢١٥٠ ان شاء الله`);
    const result = buildUnifiedConversationIntelligence(s);
    expect(result.outcome).toBe('unknown');
    expect(result.followupRequired).toBe(false);
    expect(result.medicalSafetyFlags).toHaveLength(0);
  });

  it('keeps delivery-now context non-urgent and does not invent a product name from generic eye-drop wording', () => {
    const s = oneSession(`[1/2/26, 7:22:07 PM] Customer: حضرتك انا دلوقتي في مكان اسمه استتش ممكن الدليفري يجيلي فيه بالقطره
[1/2/26, 7:24:30 PM] You: اهلا ب حضرتك يا فندم
[1/2/26, 7:24:57 PM] You: حضرتك تؤمر بحاجه تانيه معاه؟
[1/2/26, 7:26:10 PM] You: تم الارسال`);
    const base = buildUnifiedConversationIntelligence(s);
    const operational = buildWhatsAppOperationalIntelligenceV6(s, base);
    expect(operational.primaryIntent).toBe('customer_request');
    expect(operational.operationalOutcome).toBe('probable_sale');
    expect(operational.products).toHaveLength(0);
    expect(operational.customerRequests).toHaveLength(0);
    expect(operational.followupPlan.priority).not.toBe('urgent');
  });

  it('creates a portfolio summary for batch review', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: فيتامين د متوفر؟\n[9/15/26, 9:01:00 AM] You: مع حضرتك د هبة من صيدليات دواء. متوفر\n[9/15/26, 9:02:00 AM] Customer: تمام ابعته\n[9/15/26, 9:03:00 AM] You: تم تأكيد الطلب\n[9/15/26, 12:30:00 PM] Customer: منتج تاني موجود؟\n[9/15/26, 12:31:00 PM] You: لا مش موجود`;
    const sessions = splitWhatsAppSessions(parseWhatsAppExport(raw), 120);
    const portfolio = summarizePortfolio(sessions);
    expect(portfolio.sessions).toBe(2);
    expect(portfolio.salesEligible).toBeGreaterThan(0);
    expect(portfolio.urgent).toBeGreaterThan(0);
  });
});
