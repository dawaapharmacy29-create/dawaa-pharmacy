import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildUnifiedConversationIntelligence } from '@/lib/whatsappUnifiedIntelligenceV4';
import { buildWhatsAppOperationalIntelligenceV6, mergeDeicticProductReferences, mergeProductSignalsByTruthV34 } from '@/lib/whatsappOperationalIntelligenceV6';

function analyze(raw: string) {
  const sessions = splitWhatsAppSessions(parseWhatsAppExport(raw), 120);
  expect(sessions.length).toBeGreaterThan(0);
  const session = sessions[0];
  const base = buildUnifiedConversationIntelligence(session);
  return buildWhatsAppOperationalIntelligenceV6(session, base);
}

describe('WhatsApp Operational Intelligence V6 product extraction', () => {
  it('keeps Hero Baby stage number as product identity and derives singular quantity from علبة', () => {
    const model = analyze(`[9/27/26, 6:14:25 PM] Customer: السلام عليكم عايزه علبه لبن هيرو بيبي 2
[9/27/26, 6:14:53 PM] You: تحت امر حضرتك
[9/27/26, 6:20:24 PM] You: تم الارسال`);
    const product = model.products.find((row) => row.rawName.includes('هيرو بيبي 2'));
    expect(product?.quantity).toBe(1);
  });

  it('derives dual quantity from علبتين without treating product variant 3 as quantity', () => {
    const model = analyze(`[9/27/26, 9:03:34 PM] Customer: لوسمحت كنت محتاجه علبتين لبن هيرو بيبي نيوتروني دفنس 3
[9/27/26, 9:09:58 PM] You: جاري الارسال`);
    const product = model.products.find((row) => row.rawName.includes('نيوتروني دفنس 3'));
    expect(product?.quantity).toBe(2);
  });

  it('does not classify generic service phrases as products', () => {
    const model = analyze(`[9/27/26, 8:00:00 PM] Customer: يادكتور
[9/27/26, 8:01:00 PM] Customer: الحاجات دي
[9/27/26, 8:02:00 PM] Customer: العلاج دا
[9/27/26, 8:03:00 PM] Customer: شكرا لاهتمامكم
[9/27/26, 8:04:00 PM] Customer: تبعت حد مالتمريض`);
    const names = model.products.map((row) => row.rawName);
    expect(names).not.toContain('يادكتور');
    expect(names).not.toContain('الحاجات دي');
    expect(names).not.toContain('العلاج دا');
    expect(names.some((name) => /اهتمامكم|التمريض/.test(name))).toBe(false);
  });

  it('blocks standalone greetings from product discovery', () => {
    const model = analyze(`[9/27/26, 8:00:00 PM] Customer: السلام عليكم يادكتور
[9/27/26, 8:01:00 PM] Customer: مساء الخير يا دكتور
[9/27/26, 8:02:00 PM] Customer: شكرا حضرتك
[9/27/26, 8:03:00 PM] Customer: الحمد لله بخير`);
    const names = model.products.map((row) => row.rawName);
    expect(names.some((name) => /السلام|مساء الخير|شكرا|الحمد/.test(name))).toBe(false);
  });

  it('keeps a real commercial request even when it starts with a greeting', () => {
    const model = analyze(`[9/27/26, 8:00:00 PM] Customer: السلام عليكم عايزه علبه لبن هيرو بيبي 2
[9/27/26, 8:01:00 PM] You: تحت امر حضرتك`);
    const product = model.products.find((row) => /هيرو بيبي 2/.test(row.rawName));
    expect(product).toBeTruthy();
    expect(product?.status).toBe('requested');
    expect(product?.mentionOrigin).toBe('customer_explicit');
    expect(product?.requestProven).toBe(true);
    expect(product?.quantity).toBe(1);
  });

  it('suppresses observed conversational fragments without suppressing real generic demand', () => {
    const noise = analyze(`[9/27/26, 8:00:00 PM] Customer: ده الا
[9/27/26, 8:01:00 PM] Customer: مينفعش من
[9/27/26, 8:02:00 PM] Customer: حسابه
[9/27/26, 8:03:00 PM] Customer: هبقا
[9/27/26, 8:04:00 PM] Customer: بحولهم و
[9/27/26, 8:05:00 PM] Customer: بس عشان انا مش مجبره
[9/27/26, 8:06:00 PM] Customer: ي دكتور`);
    expect(noise.products).toHaveLength(0);

    const demand = analyze(`[9/27/26, 8:10:00 PM] Customer: عايزه فوار للحموضه
[9/27/26, 8:11:00 PM] You: حاضر يا فندم`);
    expect(demand.products.some((row) => /فوار للحموضه/.test(row.rawName))).toBe(true);
  });

  it('classifies a generic need as recommendation intent instead of inventing a product', () => {
    const model = analyze(`[9/27/26, 8:12:00 PM] Customer: محتاج حاجه للارهاق والخمول
[9/27/26, 8:13:00 PM] You: ممكن نراجع السبب ونرشح المناسب`);
    expect(model.products).toHaveLength(0);
    expect(model.primaryIntent).toBe('doctor_recommendation');
  });

  it('treats جاري الارسال as operational closure without requiring follow-up', () => {
    const model = analyze(`[9/28/26, 6:51:56 AM] Customer: لو سمحت يادكتور عايزه الحاجات دي
[9/28/26, 6:54:34 AM] Customer: ايوه
[9/28/26, 6:58:45 AM] You: جاري الارسال
نتشرف ب خدمة حضرتك ٢٤ ساعه 🌸🌸`);
    expect(model.operationalOutcome).toBe('probable_sale');
    expect(model.followupPlan.required).toBe(false);
  });

  it('does not treat the official 24-hour delivery welcome as a product', () => {
    const model = analyze(`[9/28/26, 6:52:06 AM] You: أهلًا وسهلًا بحضرتك✨
نورتنا في صيدليات دواء 💚
مع حضرتك د شبل
خدمة التوصيل متاحة على مدار ٢٤ ساعة 🚗`);
    expect(model.products).toHaveLength(0);
  });

  it('trims fulfillment wording after an explicit outbound product mention', () => {
    const model = analyze(`[9/28/26, 6:55:01 AM] You: معلش بس في شريط بون كير هجيبه من الفرع التاني بس وييجي لحضرتك`);
    const product = model.products.find((row) => /بون كير/i.test(row.rawName));
    expect(product).toBeTruthy();
    expect(product?.rawName).toBe('بون كير');
    expect(product?.mentionOrigin).toBe('pharmacy_mention');
    expect(product?.requestProven).toBe(false);
  });

  it('does not invent products from Mahmoud Saleh image-reference requests and greetings', () => {
    const model = analyze(`[9/27/26, 8:25:21 PM] الحاج محمود صالح ٢٤٩٠: اهلا بيكي حبيبتي الحمد لله كله تمام
[9/27/26, 8:25:35 PM] الحاج محمود صالح ٢٤٩٠: لو سمحت يادكتور عايزه العلبه دي
[9/27/26, 8:25:49 PM] الحاج محمود صالح ٢٤٩٠: <image omitted>
[9/28/26, 6:51:56 AM] الحاج محمود صالح ٢٤٩٠: السلام عليكم
لو سمحت يادكتور عايزه الحاجات دي
[9/28/26, 6:51:59 AM] الحاج محمود صالح ٢٤٩٠: <image omitted>
[9/28/26, 6:52:05 AM] You: وعليكم السلام ورحمه الله وبركاته`);

    expect(model.products.some((row) => /السلام|دكتور|العلبه دي|العلبة دي|الحاجات دي/.test(row.rawName))).toBe(false);
    expect(model.customerRequests).toHaveLength(0);
  });

  it('keeps an explicit outbound fulfillment product as a mention, never a fabricated customer request', () => {
    const model = analyze(`[9/28/26, 6:51:56 AM] Customer: لو سمحت يادكتور عايزه الحاجات دي
[9/28/26, 6:51:59 AM] Customer: <image omitted>
[9/28/26, 6:55:01 AM] You: معلش بس في شريط بون كير هجيبه من الفرع التاني بس وييجي لحضرتك
[9/28/26, 6:58:45 AM] You: جاري الارسال`);

    const product = model.products.find((row) => /بون كير/i.test(row.rawName));
    expect(product).toBeTruthy();
    expect(product?.rawName.trim()).toBe('بون كير');
    expect(product?.sourceDirection).toBe('outbound');
    expect(product?.status).toBe('mentioned');
    expect(product?.mentionOrigin).toBe('pharmacy_mention');
    expect(product?.requestProven).toBe(false);
    expect(model.customerRequests.some((row) => /بون كير/i.test(row.productName || ''))).toBe(false);
  });

  it('merges quantity-only anaphora into the previous product instead of creating a fake product', () => {
    const model = analyze(`[9/27/26, 8:20:00 PM] Customer: عايزه فليكس لايكس
[9/27/26, 8:21:00 PM] Customer: منهم شريطين
[9/27/26, 8:22:00 PM] You: حاضر`);
    expect(model.products).toHaveLength(1);
    expect(model.products[0].rawName).toMatch(/فليكس لايكس/);
    expect(model.products[0].quantity).toBe(2);
  });

  it('rejects packaging and billing fragments while keeping a named packaged product', () => {
    const model = analyze(`[9/27/26, 8:20:00 PM] You: 30 قرص يا فندم في الشريط
[9/27/26, 8:21:00 PM] You: شريط ولا علبة حضرتك
[9/27/26, 8:22:00 PM] You: لو علبة الحساب 140 ان شاء الله
[9/27/26, 8:23:00 PM] Customer: لا لما ابعت حسابه
[9/27/26, 8:24:00 PM] You: عنيا ان شاء الله شريطين وشريطين ولا شريط وشريط
[9/27/26, 8:25:00 PM] Customer: محتاج شريط فليكس لايكس`);
    const names = model.products.map((row) => row.rawName);
    expect(names).not.toEqual(expect.arrayContaining(['في الشريط', 'ولا علبة', 'الحساب', 'لا لما', 'وشريط']));
    expect(names.some((name) => /فليكس لايكس/.test(name))).toBe(true);
  });

  it('rejects long Arabic explanation and symptom prose as product identities', () => {
    const model = analyze(`[9/27/26, 8:20:00 PM] You: هتخليك تخس وانت الحركة
[9/27/26, 8:21:00 PM] Customer: هو في وجع في عيني ف
[9/27/26, 8:22:00 PM] You: ده نوع فرنسي فعال
[9/27/26, 8:23:00 PM] You: تقدر تمشي عليها
[9/27/26, 8:24:00 PM] Customer: محتاج حقنه فيتامين د
[9/27/26, 8:25:00 PM] Customer: عايزه فوار للحموضه`);
    const names = model.products.map((row) => row.rawName);
    expect(names.some((name) => /هتخليك تخس|وجع في عيني|نوع فرنسي فعال|تمشي عليها/.test(name))).toBe(false);
    expect(names.some((name) => /حقنه فيتامين د/.test(name))).toBe(true);
    expect(names.some((name) => /فوار للحموضه/.test(name))).toBe(true);
  });

  it('rejects duration tails, price-list fragments, and generic recommendation placeholders as products', () => {
    const model = analyze(`[6/10/26, 9:23:11 AM] You: الحقنه ب 58 فيها امبولين هتاخد كل اسبوعين امبول يعني شهر
[6/10/26, 9:23:12 AM] You: يعني شهر
[6/10/26, 9:23:27 AM] You: البلسم ٣٢٠ الشامبو العادي ٣٠٠ الماسك ٣٦٠
[6/10/26, 9:23:40 AM] You: ارشح لحضرتك حاجه كويسة
[6/10/26, 9:24:00 AM] Customer: محتاج كريم كوريغا`);
    const names = model.products.map((row) => row.rawName);
    expect(names.some((name) => /يعني شهر|٣٠٠ الماسك ٣٦٠|لحضرتك حاجه كويسة/.test(name))).toBe(false);
    expect(names.some((name) => /كريم كوريغا/.test(name))).toBe(true);
  });

  it('does not turn lifestyle advice, dosage instructions, or recommendation placeholders into commercial recommendations', () => {
    const advice = analyze(`[9/27/26, 8:20:00 PM] Customer: افضل برنامج للدايت ايه
[9/27/26, 8:21:00 PM] You: حضرتك ممكن تستخدم نظام الصيام المتقطع
[9/27/26, 8:22:00 PM] You: ممكن تاخدها قرص بعد الفطار او بعد الغدا
[9/27/26, 8:23:00 PM] You: حضرتك تحب ارشح لك نوع كويس ؟`);
    expect(advice.recommendations).toHaveLength(0);
    expect(advice.products.some((row) => /الصيام المتقطع|قرص بعد الفطار|نوع كويس/.test(row.rawName))).toBe(false);
  });

  it('keeps generic recommendation consent separate from product acceptance', () => {
    const model = analyze(`[8/18/26, 8:21:33 AM] You: هو للاسف مش موجود عندي
[8/18/26, 8:21:52 AM] You: بس ممكن ادور لحضرتك عليه او ارشح لحضرتك حاجه كويسة
[8/18/26, 8:22:27 AM] Customer: تمام`);
    const unnamed = model.recommendations.find((row) => row.productName == null);
    expect(unnamed).toBeTruthy();
    expect(unnamed?.accepted).toBeNull();
    expect(model.followupPlan.reason || '').not.toMatch(/نتيجة ترشيح.*بعد الاستخدام/);
  });

  it('keeps a named pharmacy recommendation and customer acceptance as a real recommendation', () => {
    const model = analyze(`[9/27/26, 8:20:00 PM] Customer: محتاج مالتي فيتامين كويس
[9/27/26, 8:21:00 PM] You: ارشح لحضرتك شريط سنترم انرجي
[9/27/26, 8:22:00 PM] Customer: تمام ابعته`);
    expect(model.recommendations.some((row) => /سنترم انرجي/.test(row.productName || '') && row.accepted === true)).toBe(true);
  });

  it('keeps explicit customer demand above a higher-confidence pharmacy mention for the same catalog product', () => {
    const merged = mergeProductSignalsByTruthV34([
      {
        rawName: 'Bon Care',
        normalizedName: 'bon care',
        quantity: 1,
        status: 'requested',
        sourceDirection: 'inbound',
        evidenceMessageIds: ['customer-request'],
        confidence: 86,
        productId: 'p-bon',
        productCode: 'BON1',
        canonicalName: 'Bon Care',
        catalogConfidence: 'strongly_inferred',
        mentionOrigin: 'customer_explicit',
        requestProven: true,
      },
      {
        rawName: 'Bon Care',
        normalizedName: 'bon care',
        quantity: null,
        status: 'mentioned',
        sourceDirection: 'outbound',
        evidenceMessageIds: ['pharmacy-mention'],
        confidence: 98,
        productId: 'p-bon',
        productCode: 'BON1',
        canonicalName: 'Bon Care',
        catalogConfidence: 'proven',
        mentionOrigin: 'pharmacy_mention',
        requestProven: false,
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe('requested');
    expect(merged[0].mentionOrigin).toBe('customer_explicit');
    expect(merged[0].requestProven).toBe(true);
    expect(merged[0].evidenceMessageIds).toEqual(expect.arrayContaining(['customer-request', 'pharmacy-mention']));
  });

  it('does not promote a pharmacy-only product mention into customer demand during semantic merge', () => {
    const merged = mergeProductSignalsByTruthV34([
      {
        rawName: 'Bon Care',
        normalizedName: 'bon care',
        quantity: null,
        status: 'mentioned',
        sourceDirection: 'outbound',
        evidenceMessageIds: ['m1'],
        confidence: 98,
        productId: 'p-bon',
        productCode: 'BON1',
        canonicalName: 'Bon Care',
        catalogConfidence: 'proven',
        mentionOrigin: 'pharmacy_mention',
        requestProven: false,
      },
    ]);
    expect(merged[0].status).toBe('mentioned');
    expect(merged[0].requestProven).toBe(false);
  });

  it('merges category deictic references into a nearby canonical product', () => {
    const session = {
      id: 's-deictic',
      startedAt: new Date('2026-09-27T20:00:00Z'),
      endedAt: new Date('2026-09-27T20:01:00Z'),
      participants: ['Customer'],
      outboundStaffNames: [],
      customerName: 'Customer',
      mediaCount: 0,
      messages: [
        {
          id: 'm1', timestamp: new Date('2026-09-27T20:00:00Z'), rawTimestamp: '1',
          sender: 'Customer', text: 'كوريغا', direction: 'inbound' as const, kind: 'text' as const,
          forwarded: false, raw: 'كوريغا'
        },
        {
          id: 'm2', timestamp: new Date('2026-09-27T20:01:00Z'), rawTimestamp: '2',
          sender: 'Customer', text: 'العسل ده', direction: 'inbound' as const, kind: 'text' as const,
          forwarded: false, raw: 'العسل ده'
        },
      ],
    };
    const products = mergeDeicticProductReferences([
      {
        rawName: 'كوريغا', normalizedName: 'كوريغا', quantity: null, status: 'requested' as const,
        sourceDirection: 'inbound' as const, evidenceMessageIds: ['m1'], confidence: 92,
        productId: 'p1', productCode: 'C1', canonicalName: 'Corega'
      },
      {
        rawName: 'العسل ده', normalizedName: 'العسل ده', quantity: null, status: 'requested' as const,
        sourceDirection: 'inbound' as const, evidenceMessageIds: ['m2'], confidence: 80
      }
    ], session);

    expect(products).toHaveLength(1);
    expect(products[0].evidenceMessageIds).toContain('m2');
  });
});
