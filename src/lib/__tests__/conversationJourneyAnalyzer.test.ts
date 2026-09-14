import { describe, expect, it } from 'vitest';
import { analyzeFullConversation } from '@/lib/conversationAnalysis/customerConversationIntelligence';

const OPTIONS = { staffNames: ['د هبة'], customerNames: ['عميل'] };

describe('full conversation intelligence', () => {
  it('detects a completed sale journey', () => {
    const raw = `[15/09/2026, 09:00 ص] عميل: صباح الخير، فيتامين د متوفر وبكام؟\n[15/09/2026, 09:01 ص] د هبة: صباح النور، مع حضرتك د هبة من صيدليات دواء. متوفر بسعر 250 جنيه\n[15/09/2026, 09:02 ص] د هبة: تحب نضيفه على أوردر حضرتك؟\n[15/09/2026, 09:03 ص] عميل: تمام ابعته\n[15/09/2026, 09:04 ص] د هبة: تم تأكيد الطلب وهيتم التوصيل، تحت أمر حضرتك في أي وقت`;
    const result = analyzeFullConversation(raw, OPTIONS);
    expect(result.journey.outcome).toBe('sold');
    expect(result.followupRequired).toBe(false);
    expect(result.commercialScore).toBeGreaterThan(50);
  });

  it('detects stockout dead-end as a lost sale', () => {
    const raw = `[15/09/2026, 09:00 ص] عميل: المنتج ده موجود؟\n[15/09/2026, 09:01 ص] د هبة: لا مش موجود حاليا`;
    const result = analyzeFullConversation(raw, OPTIONS);
    expect(result.journey.lostSales.some((x) => x.type === 'stockout_dead_end')).toBe(true);
    expect(result.priority).toBe('urgent');
  });

  it('requires human review when dosage is discussed', () => {
    const raw = `[15/09/2026, 09:00 ص] عميل: ابني عنده حرارة، الجرعة كام؟\n[15/09/2026, 09:01 ص] د هبة: الجرعة 5 مل مرتين يوميا بعد الأكل`;
    const result = analyzeFullConversation(raw, OPTIONS);
    expect(result.medicalSafety.hasMedicalContent).toBe(true);
    expect(result.medicalSafety.requiresHumanReview).toBe(true);
    expect(result.requiresHumanApproval).toBe(true);
  });
});
