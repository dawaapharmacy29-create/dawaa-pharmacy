import { describe, expect, it } from 'vitest';
import { gmReviewErrorMessage, gmReviewSummary } from '../gmDailyReview';

describe('gm daily review', () => {
  it('summarizes each branch in one line', () => {
    expect(gmReviewSummary({
      key: 'attendance',
      detail: [{ branch: 'elshamy', pending: 0, missing: 0, late: 0 }, { branch: 'shokry', pending: 2, missing: 1, late: 3 }],
    })).toEqual(['الشامي: 0 مستني مراجعة · 0 بصمة ناقصة · 0 متأخر', 'شكري: 2 مستني مراجعة · 1 بصمة ناقصة · 3 متأخر']);
    expect(gmReviewSummary({ key: 'inventory', detail: [{ branch: 'shokry', status: 'not_planned' }] }))
      .toEqual(['شكري: ما اتخططش']);
    expect(gmReviewSummary({ key: 'customers', detail: { open_requests: 4, big_customers_yesterday: 7 } }))
      .toEqual(['4 طلب مفتوح أكتر من يوم · 7 عميل اشترى بـ 500 ج امبارح']);
    expect(gmReviewSummary({ key: 'delivery', detail: {} })).toEqual([]);
  });

  it('maps the RPC errors to Arabic messages', () => {
    expect(gmReviewErrorMessage({ message: 'not_authorized' })).toBe('الصفحة دي للمدير العام بس');
    expect(gmReviewErrorMessage({ message: 'invalid_url' })).toBe('الرابط لازم يبدأ بـ https://');
  });
});
