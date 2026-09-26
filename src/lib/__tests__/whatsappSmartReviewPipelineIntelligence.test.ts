import { describe, expect, it } from 'vitest';
import type { WhatsAppConversationSession, WhatsAppParsedMessage } from '../whatsappConversationParser';
import { runSmartReviewPipeline } from '../whatsappSmartReviewPipeline';

function msg(id: string, at: string, direction: 'inbound' | 'outbound', text: string): WhatsAppParsedMessage {
  return { id, timestamp: new Date(at), rawTimestamp: at, sender: direction === 'outbound' ? 'You' : 'Customer', text, direction, kind: 'text', forwarded: false, raw: text };
}
function session(messages: WhatsAppParsedMessage[]): WhatsAppConversationSession {
  return { id: 's', startedAt: messages[0].timestamp, endedAt: messages[messages.length - 1].timestamp, messages, participants: ['You', 'Customer'], outboundStaffNames: [], customerName: 'عميل', mediaCount: 0 };
}

describe('whatsappSmartReviewPipeline deep intelligence', () => {
  it('keeps whole-conversation origin separate from the selected doctor scope', () => {
    const s = session([
      msg('cs1', '2026-09-17T10:00:00', 'outbound', 'مع حضرتك نور من خدمة عملاء صيدليات دواء، حابين نطمن على حضرتك'),
      msg('c1', '2026-09-17T10:01:00', 'inbound', 'محتاج الصنف ده موجود؟'),
      msg('d1', '2026-09-17T10:02:00', 'outbound', 'مع حضرتك د اسلام'),
      msg('d2', '2026-09-17T10:03:00', 'outbound', 'الصنف مش متوفر حاليا'),
      msg('d3', '2026-09-17T10:04:00', 'outbound', 'ممكن أرشح لحضرتك بديل مناسب ونشرح الفرق'),
    ]);
    const result = runSmartReviewPipeline(s, { staffName: 'اسلام', role: 'pharmacist', contextMessages: 1 });
    expect(result.conversationIntelligence?.entryOrigin).toBe('customer_service_outreach');
    expect(result.intelligence?.unavailableItem.detected).toBe(true);
    expect(result.intelligence?.unavailableItem.alternativeOffered).toBe(true);
    expect(result.review?.staffSummaries[0].suggestedReviewCriteria).toContain('unavailable_items');
  });

  it('surfaces sales and consultation communication findings as review evidence without inventing a sale', () => {
    const s = session([
      msg('d1', '2026-09-17T10:00:00', 'outbound', 'مع حضرتك د اسلام'),
      msg('c1', '2026-09-17T10:01:00', 'inbound', 'ابني عنده كحة، الدوا ده مناسب؟ ومحتاج علبة منه'),
      msg('d2', '2026-09-17T10:02:00', 'outbound', 'طريقة الاستخدام كذا وده بيساعد في كذا'),
    ]);
    const result = runSmartReviewPipeline(s, { staffName: 'اسلام', role: 'pharmacist' });
    const summary = result.review?.staffSummaries[0];
    expect(result.intelligence?.consultationCommunication).toBe('clear');
    expect(summary?.suggestedReviewCriteria).toContain('consultation_quality');
    expect(summary?.suggestedReviewCriteria).toContain('sales_closing');
    expect(summary?.outcome).not.toBe('invoice_verified_sale');
  });
});
