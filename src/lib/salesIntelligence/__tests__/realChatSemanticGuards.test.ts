import { describe, expect, it } from 'vitest';
import { extractIntroducedStaffName, parseWhatsAppExport } from '@/lib/whatsappConversationParser';
import { isGenericDeicticProductPhrase } from '@/lib/salesIntelligence/caseBasketEngine';
import { runSalesIntelligencePipeline } from '@/lib/salesIntelligence/salesIntelligencePipeline';
import { isAcceptanceOnly } from '@/lib/whatsappSemanticSignalsV32';

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

  it.each(['منهم شريطين', 'وشريط', 'علبة', 'كلها لون رصاصي', '٣ شهور', '3 شهور', 'شهرين', 'من ٠-٣ شهور'])(
    'keeps a non-identifying phrase out of product identity: %s', (phrase) => {
      expect(isGenericDeicticProductPhrase(phrase)).toBe(true);
    }
  );

  it('does not turn a bare no during product selection into a final need decline', () => {
    const result = runSalesIntelligencePipeline({
      conversationId: 'synthetic-bottle-selection',
      rawWhatsAppExportText: `[9/15/26, 9:00:00 AM] Customer: عايزة ببرونة نوع كويس
[9/15/26, 9:01:00 AM] You: محتاجاها في نفس رينج النوع الغالي؟
[9/15/26, 9:02:00 AM] Customer: لا
[9/15/26, 9:02:10 AM] Customer: اقل عادي
[9/15/26, 9:03:00 AM] You: سن كام
[9/15/26, 9:04:00 AM] Customer: ٣ شهور
[9/15/26, 9:05:00 AM] You: موجود نوع مناسب
[9/15/26, 9:06:00 AM] Customer: سعرها كام من فضلك
[9/15/26, 9:07:00 AM] You: 300 جنيه`,
      resolveInvoiceCandidates: () => [],
    });
    const analysis = result.caseAnalyses[0];
    expect(analysis.customerNeed.needDeclined).toBe(false);
    expect(analysis.customerNeed.needDeclineMessageIds).toEqual([]);
    expect(analysis.lostOpportunity.state).not.toBe('lost');
    expect(analysis.followUp.opportunities.some(row => row.suppressedBy === 'customer_final_decline')).toBe(false);
    expect(analysis.customerNeed.products.some(product => /^(?:٣|3) شهور$/.test(product.productNameRaw))).toBe(false);
  });

  it('retains an explicit order cancellation as a final decline', () => {
    const result = runSalesIntelligencePipeline({
      conversationId: 'synthetic-explicit-cancellation',
      rawWhatsAppExportText: `[9/15/26, 9:00:00 AM] Customer: عايز علبة فيتامين د
[9/15/26, 9:01:00 AM] You: موجود ب100 جنيه
[9/15/26, 9:02:00 AM] Customer: الغي الطلب خلاص مش عايز`,
      resolveInvoiceCandidates: () => [],
    });
    expect(result.caseAnalyses[0].customerNeed.needDeclined).toBe(true);
    expect(result.caseAnalyses[0].lostOpportunity.state).toBe('lost');
  });

  it('keeps a delayed addressed acceptance with its existing offer and doctor evidence', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايزة علبة فيتامين د
[9/15/26, 9:00:10 AM] You: مع حضرتك د تجريبي
[9/15/26, 9:01:00 AM] You: ابعتها لحضرتك؟
[9/15/26, 10:05:00 AM] Customer: ايوا يا دكتور
[9/15/26, 10:05:30 AM] Customer: وعايزة علبة فيتامين سي
[9/15/26, 10:06:00 AM] You: تم الارسال`;
    const introduction = parseWhatsAppExport(raw)[1];
    const result = runSalesIntelligencePipeline({
      conversationId: 'synthetic-delayed-acceptance',
      rawWhatsAppExportText: raw,
      staffIdByIntroductionMessageId: { [introduction.id]: 'synthetic-doctor' },
      staffProfilesById: { 'synthetic-doctor': { staffId: 'synthetic-doctor', name: 'د تجريبي', function: 'pharmacist', homeBranch: 'فرع شكري' } },
      resolveInvoiceCandidates: () => [],
    });
    expect(isAcceptanceOnly('ايوا يا دكتور')).toBe(true);
    expect(isAcceptanceOnly('ايوا يا دكتور وعايزة علبة كمان')).toBe(false);
    expect(result.caseAnalyses).toHaveLength(1);
    expect(result.caseAnalyses[0].caseIntelligence?.interaction.messageCount).toBe(6);
    expect(result.caseAnalyses[0].conversationCase.ownership?.owners[0]?.staffId).toBe('synthetic-doctor');
    expect(result.caseAnalyses[0].followUp.opportunities.some(row => row.reason === 'customer_no_response')).toBe(false);
  });
  it.each(['شريط كيوتابكس', 'علبة هيرو بيبي 2', 'ديرما اكتيف', 'ببرونة من ٠-٣ شهور'])(
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
