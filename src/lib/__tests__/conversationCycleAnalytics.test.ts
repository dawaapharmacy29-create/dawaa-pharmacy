import { describe, expect, it } from 'vitest';
import { analyzeFullConversation } from '@/lib/conversationAnalysis/customerConversationIntelligence';
import { buildConversationCycleAnalytics } from '@/lib/conversationAnalysis/conversationCycleAnalytics';

function sold(date: string) {
  return `[${date}, 09:00 ص] عميل: صباح الخير، المنتج متوفر وبكام؟\n[${date}, 09:01 ص] د أحمد: صباح النور، متوفر وتحت أمر حضرتك\n[${date}, 09:02 ص] عميل: تمام ابعته\n[${date}, 09:03 ص] د أحمد: تم تأكيد الطلب وهيتم التوصيل`;
}

function lost(date: string) {
  return `[${date}, 10:00 ص] عميل: المنتج متوفر وبكام؟\n[${date}, 10:02 ص] د أحمد: مش موجود\n[${date}, 10:03 ص] عميل: تمام شكرا`;
}

function item(id: string, raw: string, branch: string) {
  const intelligence = analyzeFullConversation(raw, { staffNames: ['د أحمد'], customerNames: ['عميل'] });
  return {
    id,
    label: `${id}.txt`,
    branch,
    staffName: 'د أحمد',
    intelligence,
    conversationAt: intelligence.base.messages.find((m) => m.timestamp)?.timestamp || null,
  };
}

describe('conversationCycleAnalytics', () => {
  it('uses pharmacy cycle 26 to 25 and compares conversion rate', () => {
    const rows = [
      item('current-sold', sold('14/09/2026'), 'فرع الشامي'),
      item('current-lost', lost('15/09/2026'), 'فرع الشامي'),
      item('previous-sold', sold('20/08/2026'), 'فرع الشامي'),
    ];
    const result = buildConversationCycleAnalytics(rows, new Date(2026, 8, 15, 12, 0, 0));
    expect(result.current.cycleStart).toBe('2026-08-26');
    expect(result.current.cycleEnd).toBe('2026-09-25');
    expect(result.previous.cycleStart).toBe('2026-07-26');
    expect(result.previous.cycleEnd).toBe('2026-08-25');
    expect(result.current.conversion.eligibleConversations).toBe(2);
    expect(result.current.conversion.conversionRate).toBe(50);
    expect(result.previous.conversion.conversionRate).toBe(100);
    expect(result.conversionChangePp).toBe(-50);
    expect(result.byBranch[0].label).toBe('فرع الشامي');
    expect(result.byDoctor[0].label).toBe('د أحمد');
  });
});
