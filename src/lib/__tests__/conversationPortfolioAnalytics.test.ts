import { describe, expect, it } from 'vitest';
import { analyzeWhatsAppChat } from '@/lib/conversationAnalysis/whatsappChatAnalyzer';
import { buildConversationPortfolioSummary } from '@/lib/conversationAnalysis/conversationPortfolioAnalytics';

const good = `[15/09/2026, 09:00 ص] عميل: صباح الخير عاوز فيتامين د\n[15/09/2026, 09:01 ص] د أحمد: صباح النور، مع حضرتك د أحمد من صيدليات دواء، تحت أمر حضرتك\n[15/09/2026, 09:02 ص] د أحمد: متوفر، تحب نضيفه على الأوردر؟\n[15/09/2026, 09:03 ص] عميل: تمام\n[15/09/2026, 09:04 ص] د أحمد: تم تأكيد الطلب وهيتم التوصيل، تحت أمر حضرتك في أي وقت`;

const weak = `[15/09/2026, 10:00 ص] عميل: المنتج متوفر؟\n[15/09/2026, 10:25 ص] د أحمد: مش موجود\n[15/09/2026, 10:26 ص] عميل: طب ايه البديل؟`;

describe('conversationPortfolioAnalytics', () => {
  it('aggregates response and quality patterns across chats', () => {
    const items = [good, weak].map((raw, index) => ({
      id: String(index),
      label: `chat-${index + 1}.txt`,
      staffName: 'د أحمد',
      analysis: analyzeWhatsAppChat(raw, { staffNames: ['د أحمد'], customerNames: ['عميل'] }),
    }));
    const summary = buildConversationPortfolioSummary(items);
    expect(summary.conversations).toBe(2);
    expect(summary.avgFirstResponseSeconds).toBeGreaterThan(0);
    expect(summary.weakestCriteria.length).toBeGreaterThan(0);
    expect(summary.strongestCriteria.length).toBeGreaterThan(0);
    expect(summary.unansweredMessages).toBeGreaterThanOrEqual(1);
  });
});
