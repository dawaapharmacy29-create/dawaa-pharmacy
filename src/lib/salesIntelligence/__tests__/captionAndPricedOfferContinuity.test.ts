import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport } from '@/lib/whatsappConversationParser';
import { buildConversationUnderstandingV32 } from '@/lib/whatsappConversationUnderstandingV32';
import { splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { extractPriceSignals } from '@/lib/whatsappSemanticSignalsV32';
import { runSalesIntelligencePipeline } from '../salesIntelligencePipeline';
import { analyzeConversationEvaluationFoundation } from '../conversationEvaluationFoundation';

// Synthetic fixture: preserve the dialogue pattern, never customer exports.
const opening = 'أهلًا وسهلًا بحضرتك\nنورتنا في صيدليات دواء\nمع حضرتك د تجريبي\nخدمة التوصيل متاحة على مدار ٢٤ ساعة';
function analyze(answer: string, time = '9:08:00 AM') {
  const raw = `[9/15/26, 9:00:00 AM] Customer: <image omitted> سلام عليكم عاوزه الدواء اللي في الصورة والمايه وسرنجه علاج
[9/15/26, 9:00:08 AM] You: وعليكم السلام ورحمه الله وبركاته
[9/15/26, 9:00:10 AM] You: ${opening}
[9/15/26, 9:02:00 AM] Customer: شريط فيتامين سي
[9/15/26, 9:03:00 AM] You: من عنيا حاضر
[9/15/26, 9:05:00 AM] You: جاري الارسال
[9/15/26, 9:06:00 AM] Customer: هو الجهاز الرقمي بكام
[9/15/26, 9:07:00 AM] You: سعره 60ج
[9/15/26, ${time}] Customer: ${answer}
[9/15/26, ${time}] You: من عنيا حاضر`;
  const intro = parseWhatsAppExport(raw).find(m => m.text === opening)!;
  return runSalesIntelligencePipeline({
    conversationId: 'synthetic-caption-price', rawWhatsAppExportText: raw,
    staffIdByIntroductionMessageId: { [intro.id]: 'test-doctor' },
    staffProfilesById: { 'test-doctor': { staffId: 'test-doctor', name: 'د تجريبي', function: 'pharmacist', homeBranch: 'فرع شكري' } },
    resolveInvoiceCandidates: () => [],
  });
}

describe('visible captions and bounded priced-offer decisions', () => {
  it('keeps visible caption text meaningful while media-only content stays unavailable', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: <image omitted> عايزة علبة فيتامين سي
[9/15/26, 9:00:10 AM] Customer: <voice message omitted>`;
    const session = splitWhatsAppSessions(parseWhatsAppExport(raw))[0];
    const messages = buildConversationUnderstandingV32(session).messages;
    expect(messages[0]).toMatchObject({ isMeaningful: true, isMediaPlaceholder: false, text: '<image omitted> عايزة علبة فيتامين سي' });
    expect(messages[1]).toMatchObject({ isMeaningful: false, isMediaPlaceholder: true });
    const result = runSalesIntelligencePipeline({ conversationId: 'caption-product', rawWhatsAppExportText: raw, resolveInvoiceCandidates: () => [] });
    expect(result.caseAnalyses[0].customerNeed.products.some(p => p.productNameRaw.includes('فيتامين سي'))).toBe(true);
    expect(result.caseAnalyses[0].caseIntelligence!.sale.isSaleCountable).toBe(false);
  });

  it.each(['عاوزه واحد', 'عاوزه واخ بس ياريت يكون مظبوط', 'محتاج ده'])(
    'keeps the decision %s with its offer, introduction and caption', answer => {
      const result = analyze(answer);
      expect(result.caseAnalyses).toHaveLength(1);
      const a = result.caseAnalyses[0];
      const view = a.caseIntelligence!;
      expect(view.interaction.messages[0].meaningful).toBe(true);
      expect(a.conversationCase.ownership?.owners[0]?.staffId).toBe('test-doctor');
      expect(a.conversationCase.ownership?.contributions.filter(c => c.staffId === 'test-doctor').flatMap(c => c.messageIds)).toContain(view.interaction.messages.at(-1)!.id);
      const items = analyzeConversationEvaluationFoundation(view).items;
      expect(items.find(i => i.key === 'greeting')?.selectedOption).toBe('official_full');
      expect(items.find(i => i.key === 'doctor_name')?.selectedOption).toBe('start');
      expect(view.sale.isSaleCountable).toBe(false);
    }
  );

  it.each([['عاوزه واحد', '10:00:00 AM'], ['عاوزه علبة شامبو', '9:08:00 AM'], ['عاوزه ممرض', '9:08:00 AM']])(
    'does not carry an earlier doctor into an independent request %s at %s', (answer, time) => {
      const cases = analyze(answer, time).caseAnalyses;
      expect(cases.length).toBeGreaterThan(1);
      expect(cases.at(-1)?.conversationCase.ownership?.owners).toEqual([]);
    }
  );

  it('recognizes compact Egyptian-pound prices without treating a dose as money', () => {
    const raw = `[9/15/26, 9:00:00 AM] You: سعره 60ج
[9/15/26, 9:01:00 AM] You: 60جرام
[9/15/26, 9:02:00 AM] You: 60جم`;
    const messages = buildConversationUnderstandingV32(splitWhatsAppSessions(parseWhatsAppExport(raw))[0]).messages;
    expect(extractPriceSignals(messages).map(s => s.messageId)).toEqual([messages[0].id, messages[2].id]);
  });
});
