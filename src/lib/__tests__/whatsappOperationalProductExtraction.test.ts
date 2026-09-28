import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildUnifiedConversationIntelligence } from '@/lib/whatsappUnifiedIntelligenceV4';
import { buildWhatsAppOperationalIntelligenceV6 } from '@/lib/whatsappOperationalIntelligenceV6';

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
});
