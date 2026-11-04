import { describe, expect, it } from 'vitest';
import {
  GM_REVIEW_LABELS,
  gmReviewErrorMessage,
  gmReviewSummary,
  type GmReviewItem,
} from '../gmDailyReview';
import { gmReviewOrder } from '@/components/dashboard/GmDailyReviewPanel';

describe('gm daily review', () => {
  it('summarizes each branch in one line', () => {
    expect(
      gmReviewSummary({
        key: 'attendance',
        detail: [
          { branch: 'elshamy', pending: 0, missing: 0, late: 0 },
          { branch: 'shokry', pending: 2, missing: 1, late: 3 },
        ],
      })
    ).toEqual([
      'الشامي: 0 مستني مراجعة · 0 بصمة ناقصة · 0 متأخر',
      'شكري: 2 مستني مراجعة · 1 بصمة ناقصة · 3 متأخر',
    ]);
    expect(
      gmReviewSummary({ key: 'inventory', detail: [{ branch: 'shokry', status: 'not_planned' }] })
    ).toEqual(['شكري: ما اتخططش']);
    expect(
      gmReviewSummary({
        key: 'customers',
        detail: { open_requests: 4, big_customers_yesterday: 7 },
      })
    ).toEqual(['4 طلب مفتوح أكتر من يوم · 7 عميل اشترى بـ 500 ج امبارح']);
    expect(gmReviewSummary({ key: 'delivery', detail: {} })).toEqual([
      '⚠️ المزامنة مع تطبيق الدليفري متوقفة',
    ]);
  });

  it('lists the shifts still open per branch and a stopped sync', () => {
    const synced = new Date().toISOString();
    expect(
      gmReviewSummary({
        key: 'shifts',
        detail: {
          synced_at: synced,
          branches: [
            { branch: 'elshamy', yesterday_done: 3, missing: [] },
            {
              branch: 'shokry',
              yesterday_done: 2,
              missing: [{ day: '2026-11-01', shift: 'مسائي' }],
            },
          ],
        },
      })
    ).toEqual([
      'الشامي: امبارح 3/3',
      `شكري: امبارح 2/3 · ما اتقفلش: ${new Date('2026-11-01T12:00:00').toLocaleDateString('ar-EG', { weekday: 'short', day: 'numeric', month: 'numeric' })} مسائي`,
    ]);
    expect(
      gmReviewSummary({
        key: 'shifts',
        detail: {
          synced_at: synced,
          branches: [
            {
              branch: 'elshamy',
              yesterday_done: 2,
              missing: [
                {
                  day: '2026-11-01',
                  shift: 'ليلي',
                  doctors: [{ staff_id: '1', name: 'د عمر', source: 'schedule' }],
                },
                {
                  day: '2026-11-01',
                  shift: 'مسائي',
                  doctors: [
                    { staff_id: '2', name: 'د وليد', source: 'punch' },
                    { staff_id: '3', name: 'د علياء', source: 'punch' },
                  ],
                },
                { day: '2026-11-02', shift: 'ليلي', doctors: [] },
              ],
            },
          ],
        },
      })[0]
    ).toBe(
      `الشامي: امبارح 2/3 · ما اتقفلش: ${[
        `${new Date('2026-11-01T12:00:00').toLocaleDateString('ar-EG', { weekday: 'short', day: 'numeric', month: 'numeric' })} ليلي (د عمر (جدول من غير بصمة))`,
        `${new Date('2026-11-01T12:00:00').toLocaleDateString('ar-EG', { weekday: 'short', day: 'numeric', month: 'numeric' })} مسائي (د وليد، د علياء)`,
        `${new Date('2026-11-02T12:00:00').toLocaleDateString('ar-EG', { weekday: 'short', day: 'numeric', month: 'numeric' })} ليلي (مفيش بصمة ولا جدول)`,
      ].join('، ')}`
    );
    const stale = gmReviewSummary({ key: 'shifts', detail: { synced_at: null, branches: [] } });
    expect(stale).toEqual(['⚠️ المزامنة مع دواء وائل متوقفة']);
  });

  it('reads purchases, riders and collection transfers from the other apps', () => {
    const synced = new Date().toISOString();
    const oldest = new Date('2026-11-01T12:00:00').toLocaleDateString('ar-EG', {
      day: 'numeric',
      month: 'numeric',
    });
    expect(
      gmReviewSummary({
        key: 'purchases_handover',
        detail: {
          synced_at: synced,
          branches: [
            { branch: 'elshamy', pending: 0, value: 0, oldest: null, yesterday: 17 },
            { branch: 'shokry', pending: 3, value: 2500, oldest: '2026-11-01', yesterday: 20 },
          ],
        },
      })
    ).toEqual([
      'الشامي: مفيش فواتير مستنية · امبارح 17 فاتورة',
      `شكري: 3 فاتورة مستنية مراجعة (${(2500).toLocaleString('ar-EG')} ج) من ${oldest} · امبارح 20 فاتورة`,
    ]);
    const nov3 = new Date('2026-11-03T12:00:00').toLocaleDateString('ar-EG', {
      day: 'numeric',
      month: 'numeric',
    });
    expect(
      gmReviewSummary({
        key: 'delivery',
        detail: {
          synced_at: synced,
          branches: [
            {
              branch: 'فرع شكري',
              delivered: 62,
              failed: 0,
              errands: 24,
              pending_errands: 12,
              oldest_pending: '2026-11-03',
              stuck: 3,
            },
            {
              branch: 'فرع الشامي',
              delivered: 60,
              failed: 2,
              errands: 22,
              pending_errands: 0,
              oldest_pending: null,
              stuck: 0,
            },
          ],
        },
      })
    ).toEqual([
      `شكري: امبارح 62 أوردر اتسلم · 24 مشوار · 12 مشوار مستني اعتماد من ${nov3} · 3 أوردر لسه «متسجل» من قبل النهارده`,
      'الشامي: امبارح 60 أوردر اتسلم · 22 مشوار · 2 فشل',
    ]);
    const m = (n: number) => `${n.toLocaleString('ar-EG')} ج`;
    expect(
      gmReviewSummary({
        key: 'collection_transfers',
        detail: {
          synced_at: synced,
          branches: [
            { branch: 'elshamy', shifts: 0 },
            {
              branch: 'shokry',
              shifts: 2,
              vodafone: 5444,
              insta: 2010,
              visa: 40,
              other: 0,
              cash: 21100,
              variance: 1,
            },
          ],
        },
      })
    ).toEqual([
      'الشامي: مفيش تسليمات امبارح',
      `شكري: تحويلات ${m(7494)} (فودافون ${m(5444)}، إنستا ${m(2010)}، فيزا ${m(40)}) · نقدي للمحاسب ${m(21100)} · ⚠️ 1 شيفت فيه فرق نقدية`,
    ]);
    expect(gmReviewSummary({ key: 'collection_transfers', detail: { branches: [] } })).toEqual([
      '⚠️ المزامنة مع دواء وائل متوقفة',
    ]);
  });

  it('maps the RPC errors to Arabic messages', () => {
    expect(gmReviewErrorMessage({ message: 'not_authorized' })).toBe('الصفحة دي للمدير العام بس');
  });

  it('links every item to the app its data really comes from, never Dawaa Bills', () => {
    const urls = Object.values(GM_REVIEW_LABELS).flatMap((label) =>
      label.app ? [label.app.url] : []
    );
    expect(urls.every((url) => !url.includes('dawaabill'))).toBe(true);
    expect(GM_REVIEW_LABELS.delivery.app?.url).toBe(
      'https://dawaa-pharmacy-delivery.vercel.app/admin/trips'
    );
    expect(GM_REVIEW_LABELS.purchases_handover.app?.url).toBe(
      'https://dawaawael.base44.app/pending-invoices'
    );
    expect(GM_REVIEW_LABELS.shifts.app?.url).toBe('https://dawaawael.base44.app/shift-delivery');
    expect(GM_REVIEW_LABELS.collection_transfers.link).toBe('/shift-handovers');
  });

  it('puts problems first and finished items last', () => {
    const item = (key: string, done: boolean, state: 'done' | 'issue' | null = null) =>
      ({ key, done, state }) as unknown as GmReviewItem;
    expect(
      gmReviewOrder([item('a', true), item('b', false), item('c', true, 'issue')]).map((i) => i.key)
    ).toEqual(['c', 'b', 'a']);
  });
});
