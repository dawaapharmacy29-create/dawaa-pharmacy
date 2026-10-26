import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport } from '@/lib/whatsappConversationParser';
import { segmentWhatsAppExportCanonical } from '@/lib/whatsappCanonicalSegmentation';

function parse(lines: string[]) {
  return parseWhatsAppExport(lines.join('\n'));
}

const base = [
  '[9/27/26, 6:14:25 PM] حنان: عايزه علبه لبن هيرو بيبي 2',
  '[9/27/26, 6:14:53 PM] You: مع حضرتك د عمر',
  '[9/27/26, 6:20:24 PM] You: تم الارسال',
];

describe('canonical segmentation: distinct service issues', () => {
  it('separates a new courier-conduct complaint after a fulfilled order and identified staff handoff', () => {
    const rows = parse([
      ...base,
      '[9/27/26, 7:04:36 PM] حنان: السلام عليكم',
      '[9/27/26, 7:04:58 PM] You: مع حضرتك د دنيا',
      '[9/27/26, 7:06:52 PM] حنان: اي الطريقة السخيفة دي اللي بيتكلم بيها المندوب',
      '[9/27/26, 7:09:06 PM] حنان: مش مجبره ابعتلكم حاجه زي كدا',
      '[9/27/26, 7:08:31 PM] You: حق حضرتك علينا وهنراجع الموقف دا شي مش مقبول ابدا',
    ]);
    const result = segmentWhatsAppExportCanonical(rows, 'حنان ٧٦٦١.zip');
    expect(result.rawSessionCount).toBe(2);
    expect(result.caseContexts.contexts).toHaveLength(2);
    expect(result.caseContexts.contexts.map((c) => c.caseItem.type)).toEqual(['order', 'complaint']);
    expect(result.caseContexts.contexts[0].mergedSession.outboundStaffNames).toContain('عمر');
    expect(result.caseContexts.contexts[1].mergedSession.outboundStaffNames).toContain('دنيا');
    expect(result.caseContexts.contexts[1].mergedSession.outboundStaffNames).toHaveLength(1);
    expect(result.caseContexts.contexts[1].caseItem.orderIntent).toBe(false);
    expect(result.caseContexts.contexts[0].mergedSession.messages.some((m) => m.text.includes('السخيفة'))).toBe(false);
  });

  it('preserves an unfinished order and its later delivery-delay followup across staff changes', () => {
    const rows = parse([
      '[9/27/26, 6:14:25 PM] حنان: عايزه لبن هيرو',
      '[9/27/26, 6:14:53 PM] You: مع حضرتك د عمر',
      '[9/27/26, 7:04:36 PM] حنان: السلام عليكم',
      '[9/27/26, 7:04:58 PM] You: مع حضرتك د دنيا',
      '[9/27/26, 7:06:52 PM] حنان: الاوردر اتأخر ولسه ماوصلش',
    ]);
    const result = segmentWhatsAppExportCanonical(rows, 'حنان.zip');
    expect(result.caseContexts.contexts).toHaveLength(1);
  });

  it('does not split a completed order merely because a different doctor introduces themselves', () => {
    const rows = parse([
      ...base,
      '[9/27/26, 7:04:36 PM] حنان: السلام عليكم',
      '[9/27/26, 7:04:58 PM] You: مع حضرتك د دنيا',
      '[9/27/26, 7:06:52 PM] حنان: شكرا جدا وصلت الطلبية',
    ]);
    expect(segmentWhatsAppExportCanonical(rows, 'حنان.zip').caseContexts.contexts).toHaveLength(1);
  });
});
