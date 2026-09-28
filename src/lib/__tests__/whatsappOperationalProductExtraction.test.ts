import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildUnifiedConversationIntelligence } from '@/lib/whatsappUnifiedIntelligenceV4';
import { buildWhatsAppOperationalIntelligenceV6, mergeDeicticProductReferences } from '@/lib/whatsappOperationalIntelligenceV6';

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

  it('merges quantity-only anaphora into the previous product instead of creating a fake product', () => {
    const model = analyze(`[9/27/26, 8:20:00 PM] Customer: عايزه فليكس لايكس
[9/27/26, 8:21:00 PM] Customer: منهم شريطين
[9/27/26, 8:22:00 PM] You: حاضر`);
    expect(model.products).toHaveLength(1);
    expect(model.products[0].rawName).toMatch(/فليكس لايكس/);
    expect(model.products[0].quantity).toBe(2);
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
