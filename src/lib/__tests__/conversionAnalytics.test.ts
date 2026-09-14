import { describe, expect, it } from 'vitest';
import { analyzeFullConversation } from '@/lib/conversationAnalysis/customerConversationIntelligence';
import { buildConversionAnalytics, classifyConversionEligibility } from '@/lib/conversationAnalysis/conversionAnalytics';

const sold = `[15/09/2026, 09:00 ص] عميل: صباح الخير، المنتج متوفر وبكام؟\n[15/09/2026, 09:01 ص] د أحمد: صباح النور، متوفر وسعره 250 جنيه\n[15/09/2026, 09:02 ص] عميل: تمام ابعته\n[15/09/2026, 09:03 ص] د أحمد: تم تأكيد الطلب وهيتم التوصيل للعنوان`;

const notSold = `[15/09/2026, 10:00 ص] عميل: المنتج متوفر وبكام؟\n[15/09/2026, 10:01 ص] د أحمد: متوفر وسعره 250 جنيه\n[15/09/2026, 10:02 ص] عميل: غالي شوية\n[15/09/2026, 10:03 ص] د أحمد: تحت أمر حضرتك`;

const complaint = `[15/09/2026, 11:00 ص] عميل: الأوردر اتأخر ومحدش رد عليا\n[15/09/2026, 11:01 ص] د علي: حق حضرتك علينا، نعتذر وهنتابع مع المندوب\n[15/09/2026, 11:03 ص] د علي: تم الحل والمندوب في الطريق`;

describe('conversionAnalytics', () => {
  it('uses only eligible sales conversations in the conversion denominator', () => {
    const rows = [
      { id: '1', label: 'sold', branch: 'فرع الشامي', staffName: 'د أحمد', intelligence: analyzeFullConversation(sold, { staffNames: ['د أحمد'], customerNames: ['عميل'] }) },
      { id: '2', label: 'not-sold', branch: 'فرع الشامي', staffName: 'د أحمد', intelligence: analyzeFullConversation(notSold, { staffNames: ['د أحمد'], customerNames: ['عميل'] }) },
      { id: '3', label: 'complaint', branch: 'فرع شكري', staffName: 'د علي', intelligence: analyzeFullConversation(complaint, { staffNames: ['د علي'], customerNames: ['عميل'] }) },
    ];
    const result = buildConversionAnalytics(rows);
    expect(result.totalConversations).toBe(3);
    expect(result.eligibleConversations).toBe(2);
    expect(result.convertedConversations).toBe(1);
    expect(result.conversionRate).toBe(50);
    expect(result.byBranch.find((x) => x.label === 'فرع الشامي')?.conversionRate).toBe(50);
    expect(result.byDoctor.find((x) => x.label === 'د أحمد')?.conversionRate).toBe(50);
    expect(result.byBranch.find((x) => x.label === 'فرع شكري')?.eligible).toBe(0);
  });

  it('marks complaint flow as non-sales even if order words are present', () => {
    const item = { id: 'c', label: 'complaint', branch: 'فرع شكري', staffName: 'د علي', intelligence: analyzeFullConversation(complaint, { staffNames: ['د علي'], customerNames: ['عميل'] }) };
    expect(classifyConversionEligibility(item).salesEligible).toBe(false);
  });
});
