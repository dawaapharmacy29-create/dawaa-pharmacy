import { describe, expect, it } from 'vitest';
import { analyzeWhatsAppChat, parseWhatsAppExport } from '@/lib/conversationAnalysis/whatsappChatAnalyzer';

const SAMPLE = `[14/09/2026, 10:00 ص] عميل: صباح الخير، ممكن سعر فيتامين د؟
[14/09/2026, 10:02 ص] د أحمد: صباح النور يا فندم، مع حضرتك د أحمد من صيدليات دواء، تحت أمر حضرتك
[14/09/2026, 10:03 ص] د أحمد: لحظات هراجع السعر لحضرتك
[14/09/2026, 10:06 ص] د أحمد: متوفر الحمد لله، السعر 250 جنيه. تحب نضيفه على أوردر حضرتك؟
[14/09/2026, 10:08 ص] عميل: تمام ابعته
[14/09/2026, 10:09 ص] د أحمد: تم تأكيد الطلب وهيتم التوصيل، تحت أمر حضرتك في أي وقت`;

describe('whatsappChatAnalyzer', () => {
  it('parses exported WhatsApp lines and speaker roles', () => {
    const rows = parseWhatsAppExport(SAMPLE, { staffNames: ['د أحمد'], customerNames: ['عميل'] });
    expect(rows.length).toBe(6);
    expect(rows[0].role).toBe('customer');
    expect(rows[1].role).toBe('staff');
  });

  it('measures response time, follow-up and order confirmation', () => {
    const analysis = analyzeWhatsAppChat(SAMPLE, { staffNames: ['د أحمد'], customerNames: ['عميل'] });
    expect(analysis.metrics.firstResponseSeconds).toBe(120);
    expect(analysis.metrics.promisedFollowups).toBe(1);
    expect(analysis.metrics.missedPromisedFollowups).toBe(0);
    expect(analysis.metrics.detectedOrders).toBeGreaterThan(0);
    expect(analysis.criteria.find((x) => x.key === 'greeting')?.score).toBe(10);
    expect(analysis.criteria.find((x) => x.key === 'sales_closing')?.score).toBe(10);
  });

  it('flags a promised follow-up that is never completed', () => {
    const raw = `[14/09/2026, 10:00 ص] عميل: المنتج متوفر؟\n[14/09/2026, 10:01 ص] د أحمد: لحظات هراجع لحضرتك`;
    const analysis = analyzeWhatsAppChat(raw, { staffNames: ['د أحمد'], customerNames: ['عميل'] });
    expect(analysis.metrics.missedPromisedFollowups).toBe(1);
    expect(analysis.risks.some((x) => x.includes('وعد'))).toBe(true);
  });
});
