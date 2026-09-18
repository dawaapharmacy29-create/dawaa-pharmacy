import { describe, expect, it } from 'vitest';
import {
  AUTOMATIC_REVIEW_REVIEWER_LABEL,
  isAutomaticReview,
  reviewerDisplayName,
} from '@/lib/conversationReviews';

describe('isAutomaticReview', () => {
  it('is true only for evaluation_kind === "automatic"', () => {
    expect(isAutomaticReview({ evaluation_kind: 'automatic' })).toBe(true);
    expect(isAutomaticReview({ evaluation_kind: 'واتساب' })).toBe(false);
    expect(isAutomaticReview({ evaluation_kind: null })).toBe(false);
    expect(isAutomaticReview({ evaluation_kind: undefined })).toBe(false);
    expect(isAutomaticReview(null)).toBe(false);
    expect(isAutomaticReview(undefined)).toBe(false);
  });

  it('does not treat "Automatic" (different case) or partial matches as automatic', () => {
    expect(isAutomaticReview({ evaluation_kind: 'Automatic' })).toBe(false);
    expect(isAutomaticReview({ evaluation_kind: 'automatic_system' })).toBe(false);
  });
});

describe('reviewerDisplayName', () => {
  it('shows the fixed system label for an automatic review, never the raw reviewer_name', () => {
    // reviewer_name هنا اسم حقيقي — بيمثل الحالة اللي الـ DB trigger
    // (bind_conversation_review_reviewer_v1) بيستبدل بيها reviewer_name باسم
    // أي موظف حقيقي مسجل دخول وقت الحفظ، حتى لو كان الحفظ آليًا بالكامل.
    // العرض لازم يعتمد على evaluation_kind بس، مش يثق في reviewer_name.
    const row = {
      evaluation_kind: 'automatic',
      reviewer_name: 'د. محمد صاحب جلسة الدخول اللي شغّل المراقبة التلقائية',
    };
    expect(reviewerDisplayName(row)).toBe(AUTOMATIC_REVIEW_REVIEWER_LABEL);
    expect(reviewerDisplayName(row)).not.toBe(row.reviewer_name);
  });

  it('shows the real reviewer name for a manual review', () => {
    const row = { evaluation_kind: 'واتساب', reviewer_name: 'سارة أحمد' };
    expect(reviewerDisplayName(row)).toBe('سارة أحمد');
  });

  it('falls back gracefully when reviewer_name is missing on a manual review', () => {
    expect(reviewerDisplayName({ evaluation_kind: 'واتساب', reviewer_name: null })).toBe('غير محدد');
    expect(reviewerDisplayName({ evaluation_kind: 'واتساب', reviewer_name: '' }, 'مراجع خدمة العملاء')).toBe(
      'مراجع خدمة العملاء'
    );
  });

  it('handles a missing row without throwing', () => {
    expect(reviewerDisplayName(null)).toBe('غير محدد');
    expect(reviewerDisplayName(undefined, '-')).toBe('-');
  });
});
