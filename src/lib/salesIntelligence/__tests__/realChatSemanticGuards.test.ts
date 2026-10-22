import { describe, expect, it } from 'vitest';
import { extractIntroducedStaffName, parseWhatsAppExport } from '@/lib/whatsappConversationParser';
import { isGenericDeicticProductPhrase } from '@/lib/salesIntelligence/caseBasketEngine';
import { runSalesIntelligencePipeline } from '@/lib/salesIntelligence/salesIntelligencePipeline';

// Synthetic examples only. Never commit customer exports or medical conversations.
describe('real-chat semantic guard regressions', () => {
  it.each([
    ['مع حضرتك نور     من خدمة عملاء صيدليات دواء.', 'نور'],
    ['مع حضرتك د/ نور من صيدليات دواء.', 'نور'],
    ['مع حضرتك دكتور أحمد\nتحت أمرك', 'أحمد'],
    ['مع حضرتك د اسلام\nخدمة التوصيل متاحة', 'اسلام'],
  ])('extracts the introduction without its service suffix: %s', (text, name) => {
    const message = parseWhatsAppExport(`[9/15/26, 9:00:00 AM] You: ${text}`)[0];
    expect(extractIntroducedStaffName(message)).toBe(name);
    expect(extractIntroducedStaffName({ ...message, direction: 'inbound' })).toBeNull();
  });

  it.each(['منهم شريطين', 'وشريط', 'علبة', 'كلها لون رصاصي'])(
    'keeps a non-identifying phrase out of product identity: %s', (phrase) => {
      expect(isGenericDeicticProductPhrase(phrase)).toBe(true);
    }
  );
  it.each(['شريط كيوتابكس', 'علبة هيرو بيبي 2', 'ديرما اكتيف'])(
    'preserves named products: %s', (phrase) => {
      expect(isGenericDeicticProductPhrase(phrase)).toBe(false);
    }
  );

  it('does not interpret an initial alternative cleanser description as a suitability objection', () => {
    const result = runSalesIntelligencePipeline({
      conversationId: 'synthetic-cleanser-request',
      rawWhatsAppExportText: `[9/15/26, 9:00:00 AM] Customer: Isis teenderm gel for sensitive skin بديل الغسول
[9/15/26, 9:01:00 AM] You: موجود يا فندم
[9/15/26, 9:02:00 AM] Customer: اه ابعته`,
      resolveInvoiceCandidates: () => [],
    });
    expect(result.caseAnalyses.length).toBeGreaterThan(0);
    for (const analysis of result.caseAnalyses) {
      expect(analysis.caseIntelligence?.need.objections.some(
        (objection) => objection.category === 'product_fit'
      )).toBe(false);
    }
  });
});
