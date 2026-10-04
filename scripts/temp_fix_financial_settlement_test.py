from pathlib import Path

path = Path('src/lib/__tests__/salesIntelligenceFinancialSettlement.test.ts')
text = path.read_text(encoding='utf-8')
text = text.replace(
    "import { buildConversationUnderstandingV32 } from '@/lib/whatsappConversationUnderstandingV32';\nimport { deriveConversationCases } from '@/lib/salesIntelligence/conversationCaseEngine';",
    "import { deriveSegmentedCases } from '@/lib/salesIntelligence/salesIntelligencePipeline';"
)
old = """  it('does not treat payment-continuation messages as multiple independent customer requests', () => {
    const messages = parseWhatsAppExport(RAW);
    const understanding = buildConversationUnderstandingV32(messages as any);
    const cases = deriveConversationCases({
      understanding,
      conversationId: 'ibrahim',
      customerIdHint: 'a2fd0b6e-1562-438c-8f16-76a43539f792',
      customerPhoneHint: '01016891940',
    });
    expect(cases).toHaveLength(1);
    expect(cases[0].humanReviewReasons).not.toContain('possible_unsegmented_multiple_requests');
  });
"""
new = """  it('does not treat payment-continuation messages as multiple independent customer requests', () => {
    const segmented = deriveSegmentedCases({
      conversationId: 'ibrahim',
      rawWhatsAppExportText: RAW,
      trustedConversationStartedAt: '2026-09-27T18:03:34.000Z',
      customerIdHint: 'a2fd0b6e-1562-438c-8f16-76a43539f792',
      customerPhoneHint: '01016891940',
    });
    expect(segmented.cases).toHaveLength(1);
    expect(segmented.cases[0].conversationCase.humanReviewReasons).not.toContain('possible_unsegmented_multiple_requests');
  });
"""
if old not in text:
    raise SystemExit('financial settlement ambiguity test block not found')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('financial settlement ambiguity test aligned with real segmentation path')
