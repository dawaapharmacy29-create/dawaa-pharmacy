import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { libTotals, liberationPlan, liberationTicker, type Liberation } from '../liberation';
import { purchaseDayCard, withPurchaseDay } from '@/lib/purchaseReview/dailyItem';
import type { GmDailyReview } from '@/lib/gmDailyReview';

const base: Liberation = {
  today: '2026-11-26',
  upload: { day: '2026-11-26', kind: 'stock', by: null, at: null, batches_day: '2026-11-26' },
  capital: [
    {
      branch: 'فرع شكري',
      store: 'الرئيسي',
      kind: 'main',
      items: 10,
      value: 100_000,
      sale_value: 0,
      near_expiry: 5000,
      expired: 300,
    },
    {
      branch: 'فرع شكري',
      store: 'إكسبير',
      kind: 'expiry',
      items: 2,
      value: 2000,
      sale_value: 0,
      near_expiry: 0,
      expired: 2000,
    },
  ],
  trend: [],
  activity: [
    {
      branch: 'فرع شكري',
      items: 10,
      value: 100_000,
      active_items: 6,
      active_value: 60_000,
      slow_items: 2,
      slow_value: 15_000,
      dead_items: 2,
      dead_value: 20_000,
      new_items: 0,
      new_value: 5000,
      over_items: 1,
      over_value: 3000,
    },
  ],
  dead: [
    {
      branch: 'فرع شكري',
      code: '11',
      name: 'راكد أ',
      company: null,
      status: 'dead',
      qty: 4,
      doctor_qty: 0,
      value: 12_000,
      last_buy: null,
      last_sale: null,
      supplier: 'مورد',
      other_rate30: 3,
      other_qty: 0,
      action: 'transfer',
    },
  ],
  near_expiry: [
    {
      branch: 'فرع شكري',
      store: 'الرئيسي',
      kind: 'main',
      code: '22',
      name: 'قرب ب',
      qty: 10,
      expiry: '2027-01-10',
      days: 45,
      value: 5000,
      supplier: null,
      location: null,
      rate30: 2,
      other_rate30: 0,
      risk_qty: 7,
      risk_value: 3500,
      action: 'push_now',
    },
    {
      branch: 'فرع شكري',
      store: 'الرئيسي',
      kind: 'main',
      code: '33',
      name: 'سليم',
      qty: 2,
      expiry: '2027-05-01',
      days: 156,
      value: 400,
      supplier: null,
      location: null,
      rate30: 5,
      other_rate30: 0,
      risk_qty: 0,
      risk_value: 0,
      action: 'ok',
    },
  ],
  expired: [
    {
      branch: 'فرع شكري',
      store: 'الرئيسي',
      kind: 'main',
      code: '44',
      name: 'منتهي',
      qty: 1,
      value: 300,
      expiry: '2026-10-01',
      supplier: 'مورد',
      action: 'pull',
    },
  ],
  doctors: [
    {
      branch: 'فرع شكري',
      seller: 'د. سارة',
      value: 4000,
      near_value: 1000,
      heavy_value: 3000,
      qty: 10,
      items: 3,
      total: 40000,
      share: 10,
      top: [],
    },
  ],
};

describe('stock liberation', () => {
  it('adds up capital, activity and what is stuck', () => {
    const t = libTotals(base);
    expect(t.capital).toBe(100_000); // the expiry store is not working capital
    expect(t.activeShare).toBeCloseTo(0.6);
    expect(t.expiredShelf).toBe(300);
    expect(t.expiryStore).toBe(2000);
    expect(t.stuck).toBe(20_000 + 15_000 + 3000 + 3500 + 300 + 2000);
  });

  it('uses the server totals over every batch, not the capped lists', () => {
    const t = libTotals({
      ...base,
      totals: {
        near_rows: 1070,
        near_value: 224_982,
        near_risk: 190_497,
        near60_rows: 188,
        near60_risk: 42_919,
        expired_shelf_rows: 25,
        expired_shelf: 2075,
      },
    });
    expect(t.nearValue).toBe(224_982);
    expect(t.nearRisk).toBe(190_497);
    expect(t.expiredShelf).toBe(2075);
  });

  it('orders the plan: expired on the shelf, then soonest expiry, then dead; skips what sells in time', () => {
    const plan = liberationPlan(base);
    expect(plan.map((r) => r.code)).toEqual(['44', '22', '11']);
    expect(plan[1].value).toBe(3500);
  });

  it('builds a ticker with the urgent things first and the best doctor', () => {
    const tk = liberationTicker(base);
    expect(tk[0]).toContain('منتهي لسه على الرف');
    expect(tk.some((x) => x.includes('راكد أ'))).toBe(true);
    expect(tk.some((x) => x.includes('د. سارة'))).toBe(true);
  });
});

describe('yesterday purchase invoices in the daily list', () => {
  const review = {
    items: [{ key: 'purchases_handover', done: false }],
    total: 1,
    done: 0,
  } as unknown as GmDailyReview;
  const branch = {
    branch: 'فرع شكري',
    invoices: 3,
    net: 1000,
    ok: 2,
    fixed: 1,
    problem: 0,
    pending: 0,
    paper_no: 1,
    paper_unset: 0,
    problems: [],
    transfers: 0,
    transfer_problems: 0,
    last_upload: null,
  };

  it('goes before the purchases handover and is done when nothing is pending', () => {
    const r = withPurchaseDay(review, { day: '2026-11-25', branches: [branch] });
    expect(r.items.map((i) => i.key)).toEqual(['purchases_invoices', 'purchases_handover']);
    expect(r.items[0].done).toBe(true);
    expect(r.done).toBe(1);
  });

  it('is not done while invoices wait for review', () => {
    const r = withPurchaseDay(review, { day: '2026-11-25', branches: [{ ...branch, pending: 2 }] });
    expect(r.items[0].done).toBe(false);
    expect(
      purchaseDayCard({ day: '2026-11-25', branches: [{ ...branch, pending: 2 }] }).headline
    ).toContain('فاضل');
  });
});
