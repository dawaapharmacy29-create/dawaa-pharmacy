import { describe, expect, it } from 'vitest';
import {
  branchOfStore,
  parseEPlusPurchases,
  reportDate,
  reportNumber,
} from '../purchaseReview/ePlusReport';
import {
  EXPECTED_STORES,
  billOf,
  cashPlan,
  monthRange,
  monthSummary,
  supplierBalances,
  uploadFreshness,
  type PurchaseReviewData,
  type ReviewLine,
} from '../purchaseReview/ledger';
import { purchaseReviewDaily, withPurchaseReview } from '../purchaseReview/dailyItem';
import { gmReviewCard } from '../gmReviewCard';
import type { GmDailyReview } from '../gmDailyReview';

const blank = (n: number) => Array.from({ length: n }, () => '');
function header(
  serial: string,
  at: string,
  code: string,
  name: string,
  net: string,
  user = 'د معاذ',
  note = ''
) {
  const row = blank(39);
  Object.assign(row, {
    0: 'ملاحظات',
    2: 'صافى الفاتورة',
    11: 'مسلسل',
    12: note,
    13: user,
    14: net,
    15: '0.00',
    16: '0.00',
    17: '0.00',
    18: '0.000',
    19: net,
    20: name,
    21: code,
    22: at,
    23: `${serial} `,
  });
  return row;
}
function total(serial: string, items: string, supplierNo = serial) {
  const row = blank(39);
  Object.assign(row, {
    6: 'الإجمالى',
    7: `${items} `,
    8: 'عدد الأصناف',
    9: supplierNo,
    10: 'رقم فاتورة المورد',
  });
  return row;
}
const item = () => Object.assign(blank(39), { 0: '%25.00 ', 14: 'PANADOL', 15: '54759' });
const section = (name: string) => Object.assign(blank(39), { 0: name });

const REPORT = [
  Object.assign(blank(39), {
    0: 'تم الإسترجاع حسب: تاريخ الإنشاء , المخزن مخزن د معاذ , النوع << الكل >>',
  }),
  Object.assign(blank(39), { 0: 'مخزن د معاذ', 1: 'موردين' }),
  section('آجل'),
  header('9870', '13/09/2026  12:33: ', '322', 'مخزن المدينة', '5,839.240'),
  item(),
  item(),
  total('9870', '2', 'A-55'),
  header(
    '9871',
    '01/10/2026  09:05: ',
    '38',
    'فارما اوفر سيز',
    '1,000.000',
    'د كريم',
    'اصناف د كريم'
  ),
  item(),
  total('9871', '1'),
  section('نقدى'),
  header('9872', '02/10/2026  23:59: ', '111', 'صيدليات', '150.500'),
  item(),
  total('9872', '1'),
  Object.assign(blank(39), {
    0: '1',
    2: '6,989.740',
    3: 'صافى الفواتير',
    10: 'الإجمــــــــالى  ',
  }),
];

describe('قراءة تقرير فواتير الشراء من ePlus', () => {
  it('reads numbers and dates as the report writes them', () => {
    expect(reportNumber('1,315.590')).toBe(1315.59);
    expect(reportNumber(' 22.55 $')).toBe(22.55);
    expect(reportNumber('%29.88 ')).toBe(29.88);
    expect(reportNumber('')).toBe(0);
    expect(reportDate('13/09/2026  00:05: ')).toBe('2026-09-13T00:05:00');
    expect(reportDate('1/9/2026')).toBe('2026-09-01T00:00:00');
    expect(reportDate('bad')).toBeNull();
  });

  it('puts each store in its branch: شكري + مخزن د.وائل, الشامي + مخزن د معاذ', () => {
    expect(branchOfStore('الادارة فرع شكري')).toBe('فرع شكري');
    expect(branchOfStore('مخزن د.وائل')).toBe('فرع شكري');
    expect(branchOfStore('الفرعية الشامي')).toBe('فرع الشامي');
    expect(branchOfStore('مخزن د معاذ')).toBe('فرع الشامي');
    expect(branchOfStore('مخزن تاني')).toBeNull();
  });

  it('reads every invoice with its section, supplier, totals and the report total', () => {
    const report = parseEPlusPurchases(REPORT);
    expect(report.store).toBe('مخزن د معاذ');
    expect(report.branch).toBe('فرع الشامي');
    expect(report.reportNet).toBe(6989.74);
    expect(report.firstDay).toBe('2026-09-13');
    expect(report.lastDay).toBe('2026-10-02');
    expect(report.invoices).toHaveLength(3);
    expect(report.invoices[0]).toMatchObject({
      serial: '9870',
      payment: 'credit',
      invoice_at: '2026-09-13T12:33:00',
      supplier_code: '322',
      supplier_name: 'مخزن المدينة',
      supplier_invoice_no: 'A-55',
      items: 2,
      net: 5839.24,
      entered_by: 'د معاذ',
    });
    expect(report.invoices[1]).toMatchObject({ supplier_invoice_no: null, note: 'اصناف د كريم' });
    expect(report.invoices[2]).toMatchObject({ payment: 'cash', net: 150.5 });
  });

  it('refuses a file that is not a purchases report or of an unknown store', () => {
    expect(() => parseEPlusPurchases([['تقرير مبيعات'], ['x']])).toThrow(/مش تقرير/);
    const other = REPORT.map((r) => [...r]);
    other[1][0] = 'مخزن تاني';
    expect(() => parseEPlusPurchases(other)).toThrow(/مش معروف/);
  });
});

describe('شهر المشتريات وفواتير الموردين', () => {
  it('the month runs from the 1st', () => {
    expect(monthRange('2026-11-13')).toEqual({
      from: '2026-11-01',
      to: '2026-11-30',
      key: '2026-11',
    });
    expect(monthRange('2026-01-05', -1)).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
      key: '2025-12',
    });
  });

  it('a supplier bill runs from its start day to the day before it next month', () => {
    expect(billOf('2026-11-13', 16)).toEqual({ from: '2026-10-16', to: '2026-11-15' });
    expect(billOf('2026-11-16', 16)).toEqual({ from: '2026-11-16', to: '2026-12-15' });
    expect(billOf('2026-11-13', 1)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(billOf('2027-01-05', 10)).toEqual({ from: '2026-12-10', to: '2027-01-09' });
  });
});

const line = (over: Partial<ReviewLine>): ReviewLine => ({
  day: '2026-10-20',
  branch: 'فرع شكري',
  store: 'الادارة فرع شكري',
  payment: 'credit',
  supplier_code: '38',
  invoices: 1,
  net: 100,
  ...over,
});

const data = (over: Partial<PurchaseReviewData> = {}): PurchaseReviewData => ({
  today: '2026-11-13',
  from: '2026-06-01',
  suppliers: [
    {
      code: '38',
      name: 'فارما اوفر سيز',
      month_start_day: 16,
      pay_after_days: 0,
      excluded: false,
      note: null,
    },
    {
      code: '322',
      name: 'مخزن المدينة',
      month_start_day: 10,
      pay_after_days: 3,
      excluded: false,
      note: null,
    },
    {
      code: '475',
      name: 'دواء الشامي',
      month_start_day: 1,
      pay_after_days: 0,
      excluded: true,
      note: null,
    },
  ],
  payments: [],
  uploads: [],
  lines: [],
  ...over,
});

describe('رصيد كل مورد والكاش المستحق', () => {
  it('groups credit invoices into bills, ignores cash and excluded suppliers', () => {
    const balances = supplierBalances(
      data({
        lines: [
          line({ day: '2026-09-20', net: 500 }),
          line({ day: '2026-10-10', net: 300 }),
          line({ day: '2026-10-20', net: 200 }),
          line({ day: '2026-10-21', net: 50, payment: 'cash' }),
          line({ day: '2026-10-21', net: 999, supplier_code: '475' }),
        ],
      })
    );
    expect(balances).toHaveLength(1);
    const [b] = balances;
    expect(b.credit).toBe(1000);
    expect(b.bills.map((x) => [x.from, x.amount, x.due, x.state])).toEqual([
      ['2026-09-16', 800, '2026-10-16', 'overdue'],
      ['2026-10-16', 200, '2026-11-16', 'due_soon'],
    ]);
    expect(b.overdue).toBe(800);
    // Still running (closes 15/11) but paid on 16/11, so it is due this week.
    expect(b.dueSoon).toBe(200);
    expect(b.running).toBe(0);
    expect(b.nextDue).toBe('2026-10-16');
  });

  it('payments settle the oldest bill first; paying more leaves them owing us', () => {
    const lines = [line({ day: '2026-09-20', net: 800 }), line({ day: '2026-10-20', net: 200 })];
    const pay = (amount: number) => ({
      id: String(amount),
      supplier_code: '38',
      branch: 'فرع شكري' as const,
      amount,
      paid_on: '2026-10-16',
      note: null,
    });
    const [part] = supplierBalances(data({ lines, payments: [pay(900)] }));
    expect(part.bills.map((x) => [x.paid, x.remaining, x.state])).toEqual([
      [800, 0, 'paid'],
      [100, 100, 'due_soon'],
    ]);
    expect(part.balance).toBe(100);
    const [over] = supplierBalances(data({ lines, payments: [pay(1200)] }));
    expect(over.balance).toBe(-200);
    expect(cashPlan([over], '2026-11-13').credits).toBe(200);
  });

  it('an old balance entered as a negative payment adds to what we owe', () => {
    const [b] = supplierBalances(
      data({
        lines: [line({ day: '2026-10-20', net: 200 })],
        payments: [
          {
            id: 'o',
            supplier_code: '38',
            branch: 'فرع شكري',
            amount: -300,
            paid_on: '2026-09-01',
            note: 'رصيد قديم',
          },
        ],
      })
    );
    expect(b.balance).toBe(500);
  });

  it('branches keep separate balances for the same supplier', () => {
    const balances = supplierBalances(
      data({
        lines: [line({ net: 100 }), line({ net: 40, branch: 'فرع الشامي', store: 'مخزن د معاذ' })],
      })
    );
    expect(balances.map((b) => [b.branch, b.balance])).toEqual([
      ['فرع شكري', 100],
      ['فرع الشامي', 40],
    ]);
  });

  it('marks a bill that started before the first uploaded day as partial', () => {
    const [b] = supplierBalances(
      data({ lines: [line({ day: '2026-09-13', net: 10 }), line({ day: '2026-09-20' })] })
    );
    expect(b.bills[0].partial).toBe(true);
  });

  it('the cash plan splits overdue, due this week, waiting and running bills', () => {
    const balances = supplierBalances(
      data({
        lines: [
          line({ day: '2026-09-20', net: 800 }),
          line({ day: '2026-10-20', net: 200 }),
          line({ day: '2026-10-12', net: 70, supplier_code: '322' }),
          line({ day: '2026-11-11', net: 30, supplier_code: '322' }),
        ],
      })
    );
    const plan = cashPlan(balances, '2026-11-13');
    // 322: bill 10/10 → 9/11, due 9/11 + 1 + 3 = 13/11 (due today, not overdue); its next bill
    // (10/11 → 9/12) is still running. 38: bill 16/10 → 15/11 is running but paid on 16/11.
    expect(plan).toMatchObject({ overdue: 800, dueSoon: 270, later: 0, running: 30, owed: 1100 });
    expect(plan.calendar.map((c) => [c.due, c.amount])).toEqual([
      ['2026-11-13', 870],
      ['2026-11-16', 200],
    ]);
    expect(plan.calendar[0].suppliers[0]).toMatchObject({ name: 'فارما اوفر سيز', overdue: true });
    expect(plan.calendar[1].suppliers[0]).toMatchObject({ overdue: false, running: true });
  });
});

describe('ملخص الشهر لكل فرع ومخزن', () => {
  it('adds each store to its branch with credit, cash and excluded apart', () => {
    const summary = monthSummary(
      data({
        lines: [
          line({ day: '2026-11-02', net: 100 }),
          line({ day: '2026-11-02', net: 40, store: 'مخزن د.وائل' }),
          line({ day: '2026-11-03', net: 25, payment: 'cash' }),
          line({ day: '2026-11-03', net: 500, supplier_code: '475' }),
          line({ day: '2026-10-31', net: 999 }),
          line({ day: '2026-11-05', net: 60, branch: 'فرع الشامي', store: 'الفرعية الشامي' }),
        ],
      }),
      monthRange('2026-11-13')
    );
    const [shokry, shami] = summary.branches;
    expect(shokry).toMatchObject({ credit: 140, cash: 25, excluded: 500, net: 165 });
    expect(shokry.stores.map((s) => s.store)).toEqual(['الادارة فرع شكري', 'مخزن د.وائل']);
    expect(shami.net).toBe(60);
    expect(summary.total).toMatchObject({ net: 225, credit: 200, cash: 25, excluded: 500 });
    expect(summary.suppliers[0]).toMatchObject({ code: '38', branch: 'فرع شكري', net: 165 });
    expect(summary.days.map((d) => d.day)).toEqual(['2026-11-02', '2026-11-03', '2026-11-05']);
  });

  it('says how many days each store report is behind', () => {
    const rows = uploadFreshness(
      [
        {
          store: 'مخزن د معاذ',
          branch: 'فرع الشامي',
          file_name: null,
          first_day: '2026-09-13',
          last_day: '2026-11-12',
          invoices: 1,
          net: 1,
          report_net: null,
          uploaded_at: '',
          uploaded_by: null,
        },
      ],
      '2026-11-13'
    );
    expect(rows.find((r) => r.store === 'مخزن د معاذ')?.daysBehind).toBe(1);
    expect(rows.find((r) => r.store === 'مخزن د.وائل')?.upload).toBeNull();
  });
});

describe('كارت المشتريات في مراجعتي اليومية', () => {
  const review = {
    day: '2026-11-13',
    yesterday: '2026-11-12',
    done: 0,
    total: 2,
    history: [],
    items: [
      {
        key: 'purchases_handover',
        kind: 'external',
        ok: false,
        done: false,
        detail: {},
        state: null,
        note: null,
        marked_by: null,
        marked_at: null,
      },
      {
        key: 'sales_upload',
        kind: 'auto',
        ok: true,
        done: true,
        detail: [],
        state: null,
        note: null,
        marked_by: null,
        marked_at: null,
      },
    ],
  } as unknown as GmDailyReview;

  it('shows what is overdue and due this week per branch, and the stale reports', () => {
    const daily = purchaseReviewDaily(
      data({
        lines: [line({ day: '2026-09-20', net: 800 }), line({ day: '2026-10-20', net: 200 })],
      })
    );
    expect(daily).toMatchObject({ overdue: 800, dueSoon: 200, owed: 1000 });
    expect(daily.stale).toHaveLength(4);
    const patched = withPurchaseReview(review, daily);
    expect(patched.items[0]).toMatchObject({ ok: false, done: false });
    expect(patched.done).toBe(1);
    const card = gmReviewCard(patched.items[0]);
    expect(card.headline).toContain('متأخر');
    expect(card.chips.map((c) => [c.label, c.bad])).toEqual([
      ['شكري', true],
      ['الشامي', false],
    ]);
    expect(card.warning).toContain('ملفات ePlus ناقصة');
  });

  it('is clean when nothing is overdue and all four reports reach yesterday', () => {
    const uploads = EXPECTED_STORES.map((s) => ({
      ...s,
      file_name: null,
      first_day: '2026-09-13',
      last_day: '2026-11-12',
      invoices: 1,
      net: 1,
      report_net: null,
      uploaded_at: '',
      uploaded_by: null,
    }));
    const daily = purchaseReviewDaily(
      data({ lines: [line({ day: '2026-11-02', net: 50, supplier_code: '322' })], uploads })
    );
    const patched = withPurchaseReview(review, daily);
    expect(patched.items[0]).toMatchObject({ ok: true, done: true });
    expect(gmReviewCard(patched.items[0]).warning).toBeUndefined();
  });

  it('keeps the old card when there is no purchase review data', () => {
    expect(withPurchaseReview(review, null)).toBe(review);
  });
});
