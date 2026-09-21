import { describe, expect, it } from 'vitest';
import type { WhatsAppConversationSession, WhatsAppParsedMessage } from '../whatsappConversationParser';
import { buildSmartConversationReviewResult } from '../whatsappSmartReviewResult';

function msg(id: string, at: string, direction: 'inbound' | 'outbound', text: string): WhatsAppParsedMessage {
  return { id, timestamp: new Date(at), rawTimestamp: at, sender: direction === 'outbound' ? 'You' : 'Customer', text, direction, kind: 'text', forwarded: false, raw: text };
}

function session(messages: WhatsAppParsedMessage[]): WhatsAppConversationSession {
  return { id: 's1', startedAt: messages[0].timestamp, endedAt: messages[messages.length - 1].timestamp, messages, participants: ['You','Customer'], outboundStaffNames: [], customerName: 'Customer', mediaCount: 0 };
}

describe('whatsappSmartReviewResult', () => {
  it('separates ownership summaries across pharmacist handoff', () => {
    // الفجوة بين a2 وb1 لازم تفضل أقل من عتبة إعادة تعيين الملكية (120 دقيقة
    // افتراضيًا في buildSmartOwnershipTimeline)، وإلا الانتقال بيتحسب "محادثة جديدة"
    // بدل Handoff فعلي - سلوك موثّق ومُختبر عمدًا في
    // whatsappSmartReviewOwnership.test.ts ("resets ownership after a long gap").
    const s = session([
      msg('a1','2026-09-13T03:01:39','outbound','مع حضرتك د اسلام'),
      msg('c1','2026-09-13T03:06:40','inbound','محتاج واحد من ده'),
      msg('a2','2026-09-13T03:09:19','outbound','من عنيا لحضرتك'),
      msg('b1','2026-09-13T03:12:00','outbound','مع حضرتك د شبل'),
      msg('b2','2026-09-13T03:12:15','outbound','انا متاسف لحضرتك عالتاخير'),
    ]);
    const result = buildSmartConversationReviewResult(s);
    expect(result.staffSummaries.map(x => x.staffName)).toEqual(['اسلام','شبل']);
    expect(result.handoffs).toHaveLength(1);
    // أهم نقطة: سؤال العميل اللي رد عليه اسلام (c1) لازم يفضل جوه تقييمه هو، مش يضيع
    // ولا ينتقل لشبل اللي جه بعده - العدالة في الـTiming محتاجة الـTurn الأصلي محفوظ هنا.
    expect(result.staffSummaries[0].messageIds).toContain('c1');
    expect(result.staffSummaries[1].messageIds).not.toContain('c1');
    expect(result.staffSummaries[1].suggestedReviewCriteria).toContain('order_delay_handling');
  });

  it('blocks official scoring when there are unassigned messages', () => {
    const s = session([
      msg('c0','2026-09-13T02:59:00','inbound','السلام عليكم'),
      msg('a1','2026-09-13T03:01:39','outbound','مع حضرتك د اسلام'),
      msg('c1','2026-09-13T03:06:40','inbound','محتاج واحد من ده'),
    ]);
    const result = buildSmartConversationReviewResult(s);
    expect(result.unassignedMessageIds).toContain('c0');
    expect(result.safeForOfficialScoring).toBe(false);
  });

  it('does not call an order a verified sale without invoice truth', () => {
    const s = session([
      msg('a1','2026-09-13T03:01:39','outbound','مع حضرتك د اسلام'),
      msg('c1','2026-09-13T03:06:40','inbound','محتاج واحد من ده'),
      msg('a2','2026-09-13T03:09:19','outbound','تمام هبعته لحضرتك'),
    ]);
    expect(buildSmartConversationReviewResult(s).staffSummaries[0].outcome).toBe('order_requested_unverified');
    expect(buildSmartConversationReviewResult(s,{ invoiceVerified: true }).staffSummaries[0].outcome).toBe('invoice_verified_sale');
  });

  it('keeps customer service and pharmacist summaries separate', () => {
    const s = session([
      msg('n1','2026-09-15T18:14:00','outbound','مع حضرتك نور من خدمة عملاء صيدليات دواء، حابين نطمن على حضرتك'),
      msg('c1','2026-09-15T18:16:00','inbound','عندي استفسار عن علاج'),
      msg('d1','2026-09-15T18:20:00','outbound','مع حضرتك د دنيا'),
      msg('c2','2026-09-15T18:23:00','inbound','الدواء ده مناسب؟'),
    ]);
    const result = buildSmartConversationReviewResult(s);
    expect(result.staffSummaries.map(x => x.role)).toEqual(['customer_service','pharmacist']);
  });
});
