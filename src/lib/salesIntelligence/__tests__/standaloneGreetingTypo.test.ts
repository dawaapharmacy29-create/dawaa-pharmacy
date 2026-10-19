import { describe, expect, it } from 'vitest';
import { isGreetingOnly, isRequestCandidate } from '@/lib/whatsappSemanticSignalsV32';
import { runSalesIntelligencePipeline } from '@/lib/salesIntelligence/salesIntelligencePipeline';
import type { NormalizedConversationMessageV32 } from '@/lib/whatsappConversationUnderstandingV32';

const candidate = (text: string) => isRequestCandidate({
  text, role: 'customer', isMeaningful: true,
} as NormalizedConversationMessageV32);

describe('standalone greeting spelling tolerance', () => {
  it.each(['سلام عليكم', 'السلام عليكم', 'اللسلام عليكم', 'اللسلام عليكم!', 'واللسلام عليكم ورحمة الله وبركاته'])(
    'does not create a customer request from greeting alone: %s', (text) => {
      expect(isGreetingOnly(text)).toBe(true);
      expect(candidate(text)).toBe(false);
    }
  );
  it.each([
    'اللسلام عليكم عايزة لبن هيرو بيبي 2',
    'السلام عليكم عندكم بانادول؟',
    'اللسلام عليكم المندوب اتأخر ومحتاج اعرف هيوصل امتى',
    'اللسلام عليكم ابني عنده كحة وحرارة',
  ])('preserves substantive needs after greeting: %s', (text) => {
    expect(isGreetingOnly(text)).toBe(false);
    expect(candidate(text)).toBe(true);
  });
  it('projects the actual product need instead of the preceding typo greeting', () => {
    const result = runSalesIntelligencePipeline({
      conversationId: 'synthetic-greeting-typo-need',
      rawWhatsAppExportText: `[10/19/26, 9:00:00 AM] Customer: اللسلام عليكم
[10/19/26, 9:01:00 AM] You: وعليكم السلام تحت أمرك
[10/19/26, 9:02:00 AM] Customer: عايزة لبن هيرو بيبي 2
[10/19/26, 9:03:00 AM] You: هراجع التوفر وأرد على حضرتك`,
      resolveInvoiceCandidates: () => [],
    });
    expect(result.caseAnalyses.length).toBeGreaterThan(0);
    const needs = result.caseAnalyses.map(a => a.caseIntelligence?.need.primaryNeed);
    expect(needs).not.toContain('اللسلام عليكم');
    expect(needs).toContain('عايزة لبن هيرو بيبي 2');
    for (const analysis of result.caseAnalyses) {
      expect(analysis.caseIntelligence?.sale.isSaleCountable).toBe(false);
    }
  });
});

