import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildWhatsAppCaseContextsV27 } from '@/lib/whatsappCaseContextV27';
import { buildConversationTimingV28 } from '@/lib/whatsappConversationTimingV28';
import { buildDelayAttributionV29 } from '@/lib/whatsappDelayAttributionV29';
import { buildConversationFocusV30 } from '@/lib/whatsappConversationFocusV30';
import { buildEvaluationConversationV31 } from '@/lib/whatsappEvaluationConversationV31';
import { applySmartReviewMessageScope } from '@/lib/whatsappSmartReviewScope';
import { buildSmartOwnershipTimeline } from '@/lib/whatsappSmartReviewOwnership';
import { buildSmartConversationEvaluationV2 } from '@/lib/whatsappConversationEvaluationV2';
import { buildConversationUnderstandingV32 } from '@/lib/whatsappConversationUnderstandingV32';
import { evaluateResponseSpeedV32 } from '@/lib/whatsappResponseSpeedEvidenceV32';
import { evaluateUnderstandingV32 } from '@/lib/whatsappUnderstandingEvidenceV32';

// Golden Case: إبراهيم الصياد - محادثة حقيقية (whatsapp_review_sources id
// ace3b141-8c66-4bed-80f9-ee4eda07dc5a، فرع شكري، فاتورة حقيقية رقم 72981 بقيمة
// 1270ج). النص منسوخ حرفيًا من الـexport الأصلي (WhatsApp raw text) اللي اتراجع
// بشكل يدوي عبر Real Conversation Validation. القصة: اسلام استلم أوردر وأكده
// بالكامل، حذّر استباقيًا باحتمال تأخير بسيط بسبب مندوب، العميل وافق ("مفيش
// مشكله")، وبعد فجوة ~94 دقيقة دخل شبل واعتذر عن تأخير فعلي (المندوب مجاش).
// الاختبار ده تثبيت دائم (Regression) لكل الأحكام اللي اتراجعت يدويًا، مش مجرد
// فحص تشغيلي - أي تغيير مستقبلي في V27-V31/Timing/Delay لازم يفضل محقق الأحكام دي.

const IBRAHIM_RAW_EXPORT = `[9/12/26, 5:40:17 PM] You: مساء  الخيريا استاذ  ابراهيم🌷
مع حضرتك نور                                                                          من خدمة عملاء صيدليات دواء.💊🥼

نتمنى أن يكون طلب حضرتك وصل بصورة جيدة، وحابين نطمن على مستوى الخدمة ونعرف هل كانت التجربة بالشكل الذي يرضي حضرتك؟

1️⃣ ممتازة ومُرضية جدًا
2️⃣ جيدة بشكل عام
3️⃣ لدي ملاحظة على الخدمة

رأي حضرتك محل اهتمام وتقدير بالنسبة لنا، وبيساعدنا بشكل مستمر على الحفاظ على مستوى الخدمة وتطويره.

شكرًا لحضرتك، وإحنا تحت أمر حضرتك في أي وقت.🌹
[9/13/26, 2:59:05 AM] ابراهيم الصياد ٣٦٤٣: السلام عليكم
[9/13/26, 3:01:38 AM] You: وعليكم السلام ورحمه الله وبركاته
[9/13/26, 3:01:39 AM] You: أهلًا وسهلًا بحضرتك✨
نورتنا في صيدليات دواء 💚
مع حضرتك د اسلام
خدمة التوصيل متاحة على مدار ٢٤ ساعة 🚗
[9/13/26, 3:06:40 AM] ابراهيم الصياد ٣٦٤٣: <image omitted>
[9/13/26, 3:06:40 AM] ابراهيم الصياد ٣٦٤٣: محتاجه واحد من دا
[9/13/26, 3:09:19 AM] You: من عنيا لحضرتك
[9/13/26, 3:09:33 AM] You: حضرتك محتاجه حاجه تانيه مع الاوردر باذن الله ؟
[9/13/26, 3:11:31 AM] ابراهيم الصياد ٣٦٤٣: ايوا ممكن فوار للحموضه
[9/13/26, 3:12:05 AM] ابراهيم الصياد ٣٦٤٣: و٤ سرنجات ٥سم
[9/13/26, 3:12:38 AM] You: من عنيا لحضرتك
[9/13/26, 3:15:16 AM] You: هبعت لحضرتك دونوبرازول فوار باذن الله هنحتاج منه علبه ؟
[9/13/26, 3:49:08 AM] ابراهيم الصياد ٣٦٤٣: اه إنشاء الله
[9/13/26, 3:49:21 AM] You: تحت امر حضرتك يا فندم
حضرتك تؤمري بحاجة تانية
[9/13/26, 3:49:31 AM] ابراهيم الصياد ٣٦٤٣: <image omitted>
[9/13/26, 3:49:33 AM] ابراهيم الصياد ٣٦٤٣: لو سمحتي يه زي دا
[9/13/26, 3:51:36 AM] You: من عنيا حاضر
[9/13/26, 4:15:55 AM] You: ابعتهم لحضرتك على عنوان الششتاوي؟
[9/13/26, 4:16:25 AM] ابراهيم الصياد ٣٦٤٣: اه انشالله
[9/13/26, 4:18:02 AM] You: من عنيا حاضر بس استاذن حضرتك هجيب مندوب من الفرع التاني وابعتهم لحضرتك لان والله المندوب ال معايا فاوردر بعيد
[9/13/26, 4:18:23 AM] You: فعشان ماخرش حضرتك هطلب مندوب يجيبه لحضرتك
[9/13/26, 4:18:37 AM] You: فممكن يتاخر حاجه بسيطة بس
[9/13/26, 4:30:12 AM] ابراهيم الصياد ٣٦٤٣: مفيش مشكله
[9/13/26, 4:30:30 AM] You: صيدليات دواء تتشرف بخدمة حضرتك دائما 💚
الأقرب إليك… ونهتم بصحتك دائمًا. 🌿
[9/13/26, 6:04:57 AM] You: السلام عليكم ورحمه الله وبركاته
[9/13/26, 6:04:58 AM] You: أهلًا وسهلًا بحضرتك✨
نورتنا في صيدليات دواء 💚
مع حضرتك د شبل
خدمة التوصيل متاحة على مدار ٢٤ ساعة 🚗
[9/13/26, 6:05:12 AM] You: انا متاسف لحضرتك عالتاخير الكبير دا والله
[9/13/26, 6:06:15 AM] You: بس كان معايا ضغط كبير وكنت مستني مندوب من الفرع التاني وكان المفروض جايلي لكن حصله ظرف ومجالبيش
[9/13/26, 6:06:31 AM] You: المندوب بيحاول يتواصل مع حضرتك
[9/13/26, 7:31:05 AM] You: صيدليات دواء تتشرف بخدمة حضرتك دائما 💚
الأقرب إليك… ونهتم بصحتك دائمًا. 🌿
[9/13/26, 12:31:50 PM] You: You deleted this message
[9/13/26, 12:59:01 PM] You: أهلًا بحضرتك، مع حضرتك نور                                                       من خدمة عملاء صيدليات دواء 🌷

بنعتذر لحضرتك عن التأخير اللي حصل في طلب حضرتك، وبنقدّر جدًا تفهم حضرتك وصبرك معانا.
حبيت أتابع مع حضرتك وأطمن حضرتك إننا مهتمين جدًا بوصول طلب حضرتك ، وبنتابع مع الفريق المختص علشان يتم توصيله في أسرع وقت ممكن. لو حضرتك تحبي نبعت الاوردر

رضا حضرتك وثقتك في صيدليات دواء تهمنا جدًا، وإن شاء الله نقدر نعوّض حضرتك عن أي إزعاج حصل ونكون دائمًا عند حسن ظنك 🤍

شكرًا جدًا لتفهم حضرتك 🤍
[9/13/26, 1:27:24 PM] You: أهلًا وسهلًا بحضرتك✨
نورتنا في صيدليات دواء 💚
مع حضرتك د مي
خدمة التوصيل متاحة على مدار ٢٤ ساعة 🚗
`;

const REAL_INVOICE_72981 = {
  status: 'verified' as const,
  bestCandidate: {
    invoiceId: 'inv-72981',
    invoiceNumber: '72981',
    invoiceDate: '2026-09-13T04:15:00.000Z',
    branch: 'فرع شكري',
    sellerName: 'اسلام',
    customerCode: null,
    customerName: 'ابراهيم الصياد',
    amount: 1270,
    score: 95,
    confidence: 0.95,
    reasons: ['مطابقة فعلية في قاعدة البيانات'],
    matchedIdentityStrategies: ['customer_phone'],
  },
  candidates: [],
  verificationConfidence: 0.95,
  revenue: 1270,
  reason: 'invoice matched',
  warnings: [],
};

function buildIbrahimCase() {
  const messages = parseWhatsAppExport(IBRAHIM_RAW_EXPORT);
  const rawSessions = splitWhatsAppSessions(messages, 120);
  const caseContexts = buildWhatsAppCaseContextsV27(rawSessions);
  return caseContexts;
}

describe('Golden Case: إبراهيم الصياد (real conversation, whatsapp_review_sources ace3b141)', () => {
  it('merges the 3 exported sessions into exactly one case with all 33 real messages', () => {
    const caseContexts = buildIbrahimCase();
    expect(caseContexts.contexts).toHaveLength(1);
    expect(caseContexts.contexts[0].mergedSession.messages).toHaveLength(33);
    expect(caseContexts.contexts[0].mergedSession.outboundStaffNames).toEqual(
      expect.arrayContaining(['اسلام', 'شبل', 'مي'])
    );
  });

  it('gives اسلام and شبل fully independent ownership episodes and records the handoff between them', () => {
    const merged = buildIbrahimCase().contexts[0].mergedSession;
    const timeline = buildSmartOwnershipTimeline(merged, 120);
    const islamEpisode = timeline.episodes.find((e) => e.ownerName === 'اسلام');
    const shabalEpisode = timeline.episodes.find((e) => e.ownerName === 'شبل');
    expect(islamEpisode?.eligibleForScoring).toBe(true);
    expect(shabalEpisode?.eligibleForScoring).toBe(true);
    // مفيش تداخل: نفس الرسالة ميظهرش في الاثنين
    const overlap = (islamEpisode?.messageIds || []).filter((id) => shabalEpisode?.messageIds.includes(id));
    expect(overlap).toHaveLength(0);
    expect(timeline.handoffs.some((h) => h.from === 'اسلام' && h.to === 'شبل')).toBe(true);
  });

  it('scopes اسلام to order-taking only (never شبل\'s apology) and شبل to recovery only (never اسلام\'s order messages)', () => {
    const merged = buildIbrahimCase().contexts[0].mergedSession;
    const islamScope = applySmartReviewMessageScope(merged, { staffName: 'اسلام', contextMessages: 2 });
    const shabalScope = applySmartReviewMessageScope(merged, { staffName: 'شبل', contextMessages: 2 });
    expect(islamScope.valid).toBe(true);
    expect(shabalScope.valid).toBe(true);

    const islamText = islamScope.inScopeMessageIds.map((id) => merged.messages.find((m) => m.id === id)?.text || '').join(' ');
    const shabalText = shabalScope.inScopeMessageIds.map((id) => merged.messages.find((m) => m.id === id)?.text || '').join(' ');

    // اسلام: أخذ الأوردر وتأكيده - مفيش اعتذار شبل خالص جوه Scope بتاعه
    expect(islamText).toContain('من عنيا لحضرتك');
    expect(islamText).not.toContain('متاسف لحضرتك عالتاخير');
    // شبل: الاعتذار والمتابعة بس - مفيش رسائل استلام الأوردر بتاعة اسلام
    expect(shabalText).toContain('متاسف لحضرتك عالتاخير');
    expect(shabalText).not.toContain('محتاجه واحد من دا');
    expect(shabalText).not.toContain('دونوبرازول');

    // اسلام ما يتحملش أي حاجة بعد "مفيش مشكله" - توقيت Scope بتاعه لازم يوقف هناك
    const islamMessages = islamScope.inScopeMessageIds.map((id) => merged.messages.find((m) => m.id === id)!);
    const lastIslamMessage = islamMessages.slice().sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()).at(-1);
    const shabalIntro = merged.messages.find((m) => m.text.includes('مع حضرتك د شبل'));
    expect(lastIslamMessage!.timestamp.getTime()).toBeLessThan(shabalIntro!.timestamp.getTime());
  });

  it('classifies the delay cause as delivery, not unknown/customer, even though the customer never complained', () => {
    const merged = buildIbrahimCase().contexts[0].mergedSession;
    const timing = buildConversationTimingV28(merged);
    const delay = buildDelayAttributionV29(merged, timing);
    expect(delay.detected).toBe(true);
    expect(delay.cause).toBe('delivery_delay');
    expect(delay.caseResponsibility).toBe('delivery');
    expect(delay.shouldPenalizeCurrentStaffAutomatically).toBe(false);
  });

  it('verifies the sale against the real invoice 72981 only when invoice data is supplied - never from chat acceptance alone', () => {
    const merged = buildIbrahimCase().contexts[0].mergedSession;
    const timing = buildConversationTimingV28(merged);
    const delay = buildDelayAttributionV29(merged, timing);
    const islamScope = applySmartReviewMessageScope(merged, { staffName: 'اسلام', contextMessages: 2 });
    const focus = buildConversationFocusV30(merged, { scoredMessageIds: islamScope.inScopeMessageIds, timing, delayAttribution: delay });
    const staffTiming = buildConversationTimingV28(islamScope.scoredSession!);
    const v31 = buildEvaluationConversationV31(merged, { scoredMessageIds: islamScope.inScopeMessageIds, focus, staffTiming });

    const withoutInvoice = buildSmartConversationEvaluationV2(v31.session, {
      invoiceVerification: { status: 'not_found', bestCandidate: null, candidates: [], verificationConfidence: 0.5, revenue: null, reason: 'no invoice', warnings: [] },
      salesOpportunities: [],
      consultationCommunication: 'not_applicable',
    });
    expect(withoutInvoice.sale.outcome).not.toBe('invoice_verified_sale');

    const withInvoice = buildSmartConversationEvaluationV2(v31.session, {
      invoiceVerification: REAL_INVOICE_72981,
      salesOpportunities: [],
      consultationCommunication: 'not_applicable',
    });
    expect(withInvoice.sale.outcome).toBe('invoice_verified_sale');
    expect(withInvoice.sale.invoiceNumber).toBe('72981');
    expect(withInvoice.sale.revenue).toBe(1270);
  });

  it('never lets messages belonging to one staff member appear as SCORED in another staff member\'s snapshot', () => {
    const merged = buildIbrahimCase().contexts[0].mergedSession;
    const timing = buildConversationTimingV28(merged);
    const delay = buildDelayAttributionV29(merged, timing);
    const staffNames = ['اسلام', 'شبل'];
    const scopedByStaff = new Map(staffNames.map((name) => [name, applySmartReviewMessageScope(merged, { staffName: name, contextMessages: 2 }).inScopeMessageIds]));
    for (const name of staffNames) {
      const otherNames = staffNames.filter((n) => n !== name);
      for (const otherName of otherNames) {
        const overlap = scopedByStaff.get(name)!.filter((id) => scopedByStaff.get(otherName)!.includes(id));
        expect(overlap).toHaveLength(0);
      }
    }
    // مرجع فقط عشان delay يفضل مستخدم في أي تحسين مستقبلي بدون تحذير lint
    expect(delay.detected).toBe(true);
  });

  it('V32 Shadow Mode: never mistakes the opening greeting ("السلام عليكم") for the actual customer request', () => {
    const merged = buildIbrahimCase().contexts[0].mergedSession;
    const understanding = buildConversationUnderstandingV32(merged);

    const responseSpeed = evaluateResponseSpeedV32({ understanding });
    expect(responseSpeed.scoreBand).toBe('within_5');
    expect(responseSpeed.pointsEarned).toBe(10);

    const comprehension = evaluateUnderstandingV32({ understanding });
    const needClarity = comprehension.findings.find((f) => f.key === 'need_clarity');
    // البند الحقيقي هو "محتاجه واحد من دا" (طلب فعلي) - مش "السلام عليكم" (تحية بلا طلب).
    expect(needClarity?.fact).toContain('محتاجه واحد من دا');
    expect(needClarity?.fact).not.toContain('السلام عليكم');
    expect(comprehension.scoreBand).toBe('strong');
    expect(comprehension.pointsEarned).toBe(10);
  });
});
