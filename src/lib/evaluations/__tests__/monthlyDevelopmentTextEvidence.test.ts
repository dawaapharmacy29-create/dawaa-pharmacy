import { describe, expect, it } from 'vitest';
import {
  isActionableDevelopmentIssue,
  isActionableTrainingRecommendation,
} from '@/lib/evaluations/monthlyDevelopmentTextEvidence';

describe('monthly development text evidence', () => {
  it('does not treat generic conversation score summaries as development issues', () => {
    for (const label of [
      'تقييم محادثة ممتاز',
      'تقييم محادثة قوي',
      'تقييم محادثة جيد بدون تأثير نقاط',
      'تقييم محادثة أقل من 85',
      'تقييم محادثة أقل من 80',
      'تقييم محادثة ضعيف',
      'تقييم محادثة حرج',
    ]) {
      expect(isActionableDevelopmentIssue(label)).toBe(false);
    }
  });

  it('keeps a real criterion shortfall as an actionable issue', () => {
    expect(isActionableDevelopmentIssue('سرعة الرد: أكثر من 10 دقائق')).toBe(true);
  });

  it('does not turn the no-training fallback into a repeated training recommendation', () => {
    expect(isActionableTrainingRecommendation('لا توجد توصية تدريب واضحة، استمر في متابعة جودة المحادثات.')).toBe(false);
  });

  it('keeps a real training recommendation', () => {
    expect(isActionableTrainingRecommendation('مراجعة الإغلاق ورسالة الختام في 3 محادثات جديدة')).toBe(true);
  });
});
