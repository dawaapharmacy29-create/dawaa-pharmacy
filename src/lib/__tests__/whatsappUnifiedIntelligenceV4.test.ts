import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildUnifiedConversationIntelligence, summarizePortfolio } from '@/lib/whatsappUnifiedIntelligenceV4';
import { buildWhatsAppOperationalIntelligenceV6, enrichWhatsAppOperationalProductsV6 } from '@/lib/whatsappOperationalIntelligenceV6';
import { enrichWhatsAppOperationalJourneysV7 } from '@/lib/whatsappProductJourneyV7';

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

  it('captures a named recommendation without treating best-product wording or image request as recovery or purchase intent', async () => {
    const s = oneSession(`[1/5/26, 7:46:51 AM] Customer: افضل منتج لتخسيس ايه
[1/5/26, 7:48:34 AM] Customer: ٣٤
[1/5/26, 7:48:45 AM] Customer: وفي ضغط
[1/5/26, 7:50:42 AM] You: ممكن ارشح لحضرتك منتج اكياس اسمه limitless chromax كويس جدا وبيسد الشهيه لو عملنا معاه نظام غذائي هتكون نتيجته كويسه جدا
[1/5/26, 7:51:25 AM] Customer: طب ممكن شكله
[1/5/26, 7:51:27 AM] Customer: وسعره
[1/5/26, 7:52:51 AM] You: 375 باذن الله`);
    const base = buildUnifiedConversationIntelligence(s);
    const operational = await enrichWhatsAppOperationalProductsV6(
      buildWhatsAppOperationalIntelligenceV6(s, base),
      s
    );
    expect(operational.primaryIntent).toBe('doctor_recommendation');
    expect(operational.secondaryIntents).toContain('medical_consultation');
    expect(operational.secondaryIntents).not.toContain('customer_request');
    expect(operational.customerState).toBe('unknown');
    expect(operational.operationalOutcome).toBe('unknown');
    expect(operational.products.some((p) => p.rawName.toLowerCase() === 'limitless chromax' && p.status === 'recommended')).toBe(true);
  });

  it('keeps an initial named recommendation distinct from an alternative offer', async () => {
    const s = oneSession(`[1/5/26, 7:46:51 AM] Customer: افضل منتج لتخسيس ايه
[1/5/26, 7:48:45 AM] Customer: وفي ضغط
[1/5/26, 7:50:42 AM] You: ممكن ارشح لحضرتك منتج اكياس اسمه limitless chromax كويس جدا وبيسد الشهيه
[1/5/26, 7:51:25 AM] Customer: طب ممكن شكله
[1/5/26, 7:51:27 AM] Customer: وسعره
[1/5/26, 7:52:51 AM] You: 375 باذن الله`);
    const base = buildUnifiedConversationIntelligence(s);
    const withProducts = await enrichWhatsAppOperationalProductsV6(
      buildWhatsAppOperationalIntelligenceV6(s, base),
      s
    );
    const operational = enrichWhatsAppOperationalJourneysV7(s, withProducts);
    const journey = operational.productJourney.journeys.find((j) => j.productName.toLowerCase() === 'limitless chromax');
    expect(journey?.events.some((e) => e.stage === 'recommended')).toBe(true);
    expect(journey?.events.some((e) => e.stage === 'alternative_offered')).toBe(false);
  });

  it('keeps image-only stockout and alternative as evidence without inventing product or followup from terminal gratitude', async () => {
    const s = oneSession(`[1/5/26, 2:26:30 PM] Customer: دي موجوده
[1/5/26, 2:26:38 PM] Customer: <image omitted>
[1/5/26, 2:32:56 PM] You: ثواني اشوفه لحضرتك
[1/5/26, 3:03:42 PM] You: للاسف يا فندم مش متوفره
[1/5/26, 3:04:20 PM] You: هي صنف مستورد مش بينزل مصر
[1/5/26, 3:04:44 PM] You: لو حضرتك تحب ممكن ارشح ل حضرتك حاحة زيها
[1/5/26, 3:06:29 PM] Customer: زي
[1/5/26, 3:08:19 PM] You: <image omitted>
[1/5/26, 3:27:55 PM] You: تحت امر حضرتك في اي وقت يا فندم
[1/5/26, 3:28:16 PM] Customer: الف شكر 🌷`);
    const base = buildUnifiedConversationIntelligence(s);
    const withProducts = await enrichWhatsAppOperationalProductsV6(
      buildWhatsAppOperationalIntelligenceV6(s, base),
      s
    );
    const operational = enrichWhatsAppOperationalJourneysV7(s, withProducts);
    expect(operational.products).toHaveLength(0);
    expect(operational.recommendations.some((r) => r.productName == null)).toBe(true);
    expect(operational.evidence.stockUnavailable.messageIds.length).toBeGreaterThan(0);
    expect(operational.evidence.alternativeOffered.messageIds.length).toBeGreaterThan(0);
    expect(operational.followupPlan.required).toBe(false);
    expect(operational.operationalOutcome).toBe('unknown');
  });

  it('treats a customer-requested vitamin recommendation with image options as unnamed recommendations, not a sale', async () => {
    const s = oneSession(`[4/17/26, 1:55:08 PM] Customer: ممكن اعرف مكان الصيدليه
[4/17/26, 1:55:57 PM] Customer: وهستاذنك ترشحلي افضل فيتامين للشعر او للجسم كله بس اهمهم الشعر
[4/17/26, 2:20:00 PM] You: هقترح على حضرتك افضل الانواع اللي في الصيدليه وهصورهم لحضرتك
[4/17/26, 2:50:46 PM] You: <image omitted> دا يا فندم ب1950 دا نوع مستورد كورس علاج 3 شهور كل يوم كبسوله
[4/17/26, 2:52:01 PM] You: <image omitted> دا كمان مستورد العبوه ٦٠ كبسوله ب ١٢٠٠
[4/17/26, 2:52:28 PM] You: <image omitted> دا كمان نوع مستورد ب ٥٩٠
[4/17/26, 2:57:21 PM] Customer: ده يكفي ٣ شهور
[4/17/26, 2:57:43 PM] Customer: ولا كل شهر ٢٠٠٠ج😂🤦‍♂️
[4/17/26, 3:01:01 PM] You: اه يا فندم يكفي 3 شهور لو حضرتك اخدتي كبسوله مره واحده في اليوم
[4/17/26, 3:13:01 PM] You: حضرتك عندك استفسار عن اي حاجه فيهم او حابب نوفر لحضرؤتك حاجه منهم
[4/17/26, 3:13:17 PM] You: او حتى اقترح انواع تانيه بفئات سعريه اققل؟`);
    const base = buildUnifiedConversationIntelligence(s);
    const withProducts = await enrichWhatsAppOperationalProductsV6(
      buildWhatsAppOperationalIntelligenceV6(s, base),
      s
    );
    const operational = enrichWhatsAppOperationalJourneysV7(s, withProducts);
    expect(operational.primaryIntent).toBe('doctor_recommendation');
    expect(operational.operationalOutcome).toBe('unknown');
    expect(operational.products).toHaveLength(0);
    expect(operational.recommendations.filter((r) => r.productName == null)).toHaveLength(3);
    expect(operational.followupPlan.required).toBe(false);
    expect(operational.evidence.saleClose.messageIds).toHaveLength(0);
  });

  it('extracts a named deodorant product mention without turning usage inquiry into purchase intent', async () => {
    const s = oneSession(`[4/17/26, 6:15:20 PM] Customer: مزيل فانتمورا
[4/17/26, 6:15:20 PM] Customer: متاح للبشره بردو
[4/17/26, 6:26:20 PM] You: لا يا فندم دا مزيل عرق هيتسخدم بس في منطقه تحت الابط
[4/17/26, 6:26:28 PM] Customer: تمام
[4/17/26, 6:26:32 PM] You: نتشرف ب خدمة حضرتك ٢٤ ساعه 🌸🌸`);
    const base = buildUnifiedConversationIntelligence(s);
    const operational = await enrichWhatsAppOperationalProductsV6(
      buildWhatsAppOperationalIntelligenceV6(s, base),
      s
    );
    expect(operational.primaryIntent).toBe('product_inquiry');
    expect(operational.operationalOutcome).toBe('unknown');
    expect(operational.followupPlan.required).toBe(false);
    expect(operational.products.some((p) => p.rawName === 'فانتمورا' && p.status === 'mentioned')).toBe(true);
    expect(operational.customerRequests).toHaveLength(0);
  });

  it('keeps proactive service checkin positive while treating image usage question as non-commercial inquiry', async () => {
    const s = oneSession(`[4/27/26, 5:53:55 PM] You: كنت حابه اطمن على حضرتك ان شاء الله تكون بخير وافضل حال واسأل حضرتك عن خدماتنا هل كل حاجه ماشية بشكل يرضي حضرتك
[4/27/26, 6:21:37 PM] Customer: لا والله كله تمام من خدمه وأسلوب وأشخاص ذوق في كل تعامل بصراحه ربنا يباركلكم ويحفظكم
[4/27/26, 7:54:33 PM] Customer: <image omitted>
[4/27/26, 7:54:49 PM] Customer: ممكن بعد اذنك توضيح عن المنتج ده
[4/27/26, 7:55:11 PM] Customer: واستعماله ازاي
[4/27/26, 7:58:41 PM] You: عباره عن لوشن مطلف للجلد
[4/27/26, 8:09:57 PM] You: حضرتك تقدر تستخدمه كأنه كريم مرطب
[4/27/26, 8:10:26 PM] Customer: ولا الاتنين مع بعض`);
    const base = buildUnifiedConversationIntelligence(s);
    const withProducts = await enrichWhatsAppOperationalProductsV6(
      buildWhatsAppOperationalIntelligenceV6(s, base),
      s
    );
    const operational = enrichWhatsAppOperationalJourneysV7(s, withProducts);
    expect(operational.primaryIntent).toBe('proactive_checkin');
    expect(operational.secondaryIntents).toContain('product_inquiry');
    expect(operational.customerState).toBe('improved');
    expect(operational.operationalOutcome).toBe('checkin_complete');
    expect(operational.products).toHaveLength(0);
    expect(operational.customerRequests).toHaveLength(0);
    expect(operational.followupPlan.required).toBe(false);
    expect(operational.productJourney.saleLeakageCount).toBe(0);
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
