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

  it('lists the shifts still open per branch and a stopped sync', () => {
    const synced = new Date().toISOString();
    expect(gmReviewSummary({ key: 'shifts', detail: { synced_at: synced, branches: [
      { branch: 'elshamy', yesterday_done: 3, missing: [] },
      { branch: 'shokry', yesterday_done: 2, missing: [{ day: '2026-11-01', shift: 'مسائي' }] },
    ] } })).toEqual([
      'الشامي: امبارح 3/3',
      `شكري: امبارح 2/3 · ما اتقفلش: ${new Date('2026-11-01T12:00:00').toLocaleDateString('ar-EG', { weekday: 'short', day: 'numeric', month: 'numeric' })} مسائي`,
    ]);
    expect(gmReviewSummary({ key: 'shifts', detail: { synced_at: synced, branches: [
      { branch: 'elshamy', yesterday_done: 2, missing: [
        { day: '2026-11-01', shift: 'ليلي', doctors: [{ staff_id: '1', name: 'د عمر', source: 'schedule' }] },
        { day: '2026-11-01', shift: 'مسائي', doctors: [{ staff_id: '2', name: 'د وليد', source: 'punch' }, { staff_id: '3', name: 'د علياء', source: 'punch' }] },
        { day: '2026-11-02', shift: 'ليلي', doctors: [] },
      ] },
    ] } })[0]).toBe(`الشامي: امبارح 2/3 · ما اتقفلش: ${[
      `${new Date('2026-11-01T12:00:00').toLocaleDateString('ar-EG', { weekday: 'short', day: 'numeric', month: 'numeric' })} ليلي (د عمر (جدول من غير بصمة))`,
      `${new Date('2026-11-01T12:00:00').toLocaleDateString('ar-EG', { weekday: 'short', day: 'numeric', month: 'numeric' })} مسائي (د وليد، د علياء)`,
      `${new Date('2026-11-02T12:00:00').toLocaleDateString('ar-EG', { weekday: 'short', day: 'numeric', month: 'numeric' })} ليلي (مفيش بصمة ولا جدول)`,
    ].join('، ')}`);
    const stale = gmReviewSummary({ key: 'shifts', detail: { synced_at: null, branches: [] } });
    expect(stale).toEqual(['⚠️ المزامنة مع تطبيق المشتريات متوقفة']);
  });

  it('maps the RPC errors to Arabic messages', () => {
    expect(gmReviewErrorMessage({ message: 'not_authorized' })).toBe('الصفحة دي للمدير العام بس');
    expect(gmReviewErrorMessage({ message: 'invalid_url' })).toBe('الرابط لازم يبدأ بـ https://');
  });
});
