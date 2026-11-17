import { describe, expect, it } from 'vitest';
import {
  branchOfStore,
  fillSupplierCodes,
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
  normalizeName,
  payList,
  reviewIssues,
  supplierRows,
  supplierBalances,
  suggestSupplier,
  treasuryItems,
  uploadFreshness,
  type PurchaseReviewData,
  type ReviewLine,
} from '../purchaseReview/ledger';
import { purchaseReviewDaily, withPurchaseReview } from '../purchaseReview/dailyItem';
import { dashboardPurchases } from '../purchaseReview/dashboardSummary';
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
    expect(patched.total).toBe(3);
    expect(patched.done).toBe(1);
    const card = gmReviewCard(patched.items[0]);
    expect(card.headline).toContain('متأخر');
    expect(card.chips.map((c) => [c.label, c.bad])).toEqual([
      ['شكري', true],
      ['الشامي', false],
    ]);
    // The reports have their own item, «ملفات المشتريات», right after it.
    expect(card.warning).toBeUndefined();
    expect(patched.items[1]).toMatchObject({ key: 'purchases_upload', ok: false, done: false });
    const files = gmReviewCard(patched.items[1]);
    expect(files.headline).toContain('مش واصلة لامبارح');
    expect(files.chips.map((c) => [c.label, c.value, c.bad])).toEqual(
      EXPECTED_STORES.map((s) => [s.store, 'ما اترفعش', true])
    );
  });

  it('turns «ملفات المشتريات» green only when every store reaches yesterday', () => {
    const uploads = EXPECTED_STORES.map((s, i) => ({
      ...s,
      file_name: null,
      first_day: '2026-09-13',
      last_day: i === 3 ? '2026-11-11' : '2026-11-12',
      invoices: 1,
      net: 1,
      report_net: null,
      uploaded_at: '',
      uploaded_by: null,
    }));
    const late = withPurchaseReview(review, purchaseReviewDaily(data({ uploads })));
    const files = gmReviewCard(late.items[1]);
    expect(late.items[1].done).toBe(false);
    expect(files.chips.filter((c) => c.bad).map((c) => c.label)).toEqual(['مخزن د معاذ']);
    const fresh = withPurchaseReview(
      review,
      purchaseReviewDaily(
        data({ uploads: uploads.map((u) => ({ ...u, last_day: '2026-11-12' })) })
      )
    );
    expect(fresh.items[1]).toMatchObject({ key: 'purchases_upload', ok: true, done: true });
    expect(gmReviewCard(fresh.items[1]).headline).toContain('واصلة لحد امبارح');
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

describe('تاريخ المتابعة والاستثناء والدفع من الخزنة', () => {
  const lines = [
    line({ day: '2026-09-20', net: 800 }), // bill 16/9 → due 16/10
    line({ day: '2026-10-20', net: 200 }), // bill 16/10 → due 16/11
  ];

  it('bills due before the tracking day count as settled, and so do payments before it', () => {
    const [b] = supplierBalances(
      data({
        lines,
        track_from: '2026-11-01',
        payments: [
          {
            id: 'a',
            supplier_code: '38',
            branch: 'فرع شكري',
            amount: 800,
            paid_on: '2026-10-16',
            note: null,
          },
          {
            id: 'b',
            supplier_code: '38',
            branch: 'فرع شكري',
            amount: -50,
            paid_on: '2026-10-01',
            note: null,
          },
        ],
      })
    );
    expect(b.bills.map((x) => x.from)).toEqual(['2026-10-16']);
    expect(b.credit).toBe(200);
    // The 800 paid before the tracking day is ignored; the opening balance (-50) still counts.
    expect(b.paid).toBe(-50);
    expect(b.balance).toBe(250);
  });

  it('an excluded invoice leaves the debt and shows as excluded in the month', () => {
    const withFlag = [...lines, line({ day: '2026-10-21', net: 70, excluded: true })];
    const [b] = supplierBalances(data({ lines: withFlag }));
    expect(b.credit).toBe(1000);
    const month = monthSummary(data({ lines: withFlag }), { from: '2026-10-01', to: '2026-10-31' });
    expect(month.total.excluded).toBe(70);
    expect(month.total.credit).toBe(200);
  });

  it('treasury cash linked to a supplier pays that supplier in that branch only', () => {
    const d = data({
      lines,
      track_from: '2026-10-01',
      treasury: [
        {
          id: '1',
          branch: 'فرع شكري',
          category: 'فارما اوفر سيز',
          amount: 800,
          day: '2026-10-16',
          description: null,
        },
        {
          id: '2',
          branch: 'فرع الشامي',
          category: 'فارما اوفر سيز',
          amount: 500,
          day: '2026-10-16',
          description: null,
        },
        {
          id: '3',
          branch: 'فرع شكري',
          category: 'حسان',
          amount: 40,
          day: '2026-10-17',
          description: null,
        },
        {
          id: '4',
          branch: 'فرع شكري',
          category: 'فارما اوفر سيز',
          amount: 999,
          day: '2026-09-01',
          description: null,
        },
      ],
      links: [{ category: 'فارما اوفر سيز', supplier_code: '38', ignored: false }],
    });
    const balances = supplierBalances(d);
    const shokry = balances.find((b) => b.branch === 'فرع شكري')!;
    expect(shokry.paid).toBe(800);
    expect(shokry.fromTreasury).toBe(800);
    expect(shokry.balance).toBe(200);
    expect(shokry.bills[0].state).toBe('paid');
    // The Shami branch paid with no invoices there: it owes us.
    expect(balances.find((b) => b.branch === 'فرع الشامي')!.balance).toBe(-500);

    const items = treasuryItems(d);
    expect(items.map((i) => [i.category, i.total, Boolean(i.link)])).toEqual([
      ['فارما اوفر سيز', 1300, true],
      ['حسان', 40, false],
    ]);
  });

  it('suggests the supplier a treasury item pays, and stays quiet when unsure', () => {
    const suppliers = [
      ['322', 'مخزن المدينة'],
      ['317', 'المدينة المنورة اكسسوار'],
      ['295', 'كيان اكسسوار'],
      ['74', 'المتحدة  للتوزيع'],
      ['208', 'مخزن الحياه'],
      ['290', 'الحياه اكسسوار'],
      ['309', 'مخزن سونيستا فارما'],
      ['471', 'مخزن المعداوي'],
      ['301', 'سوفيكو فارم'],
    ].map(([code, name]) => ({
      code,
      name,
      month_start_day: 1,
      pay_after_days: 0,
      excluded: false,
      note: null,
    }));
    const pick = (category: string) => suggestSupplier(category, suppliers)?.code ?? null;
    expect(pick('مخزن المدينه')).toBe('322');
    expect(pick('كيان')).toBe('295');
    expect(pick('المتحده')).toBe('74');
    expect(pick('مخزن الحياه')).toBe('208');
    expect(pick('مخزن سونيستا')).toBe('309');
    expect(pick('مخزن المعداوى')).toBe('471');
    expect(pick('سوفيكو')).toBe('301');
    expect(pick('حسان')).toBeNull();
  });
});

describe('الدفع مقدّم قبل تاريخ المتابعة', () => {
  it('a payment well after the last settled bill fell due pays the next bill; a late one does not', () => {
    const pay = (amount: number, paid_on: string) => ({
      id: paid_on,
      supplier_code: '38',
      branch: 'فرع شكري' as const,
      amount,
      paid_on,
      note: null,
    });
    const [b] = supplierBalances(
      data({
        lines: [line({ day: '2026-09-20', net: 800 }), line({ day: '2026-10-20', net: 200 })],
        track_from: '2026-11-01',
        // 800 and 20 pay the bill due 16/10 (on time and late); 150 on 31/10 is an advance on the next one.
        payments: [
          pay(800, '2026-10-16'),
          pay(20, '2026-10-25'),
          pay(150, '2026-10-31'),
          pay(30, '2026-09-01'),
        ],
      })
    );
    expect(b.paid).toBe(150);
    expect(b.balance).toBe(50);
  });
});

describe('صفحة المراجعة المبسطة', () => {
  // Today 13/11. فارما: الشامي bill 16/9 unpaid (due 16/10), شكري bill 16/10 still running (due 16/11).
  // المدينة: both branches bill 10/10 (due 13/11); شكري paid 600 against 100 → لينا 500.
  const d = data({
    lines: [
      line({ day: '2026-09-20', branch: 'فرع الشامي', store: 'مخزن د معاذ', net: 3000 }),
      line({ day: '2026-10-20', net: 500 }),
      line({ day: '2026-10-15', supplier_code: '322', net: 100 }),
      line({
        day: '2026-10-15',
        supplier_code: '322',
        branch: 'فرع الشامي',
        store: 'مخزن د معاذ',
        net: 4000,
      }),
    ],
    payments: [
      {
        id: 'p',
        supplier_code: '322',
        branch: 'فرع شكري',
        amount: 600,
        paid_on: '2026-11-05',
        note: null,
      },
    ],
  });
  const balances = supplierBalances(d);

  it('lists who to pay this week, one row per supplier, overdue first', () => {
    const list = payList(balances, d.today);
    expect(list.map((i) => [i.code, i.amount, i.overdue, i.due])).toEqual([
      ['38', 3500, true, '2026-10-16'],
      ['322', 4000, false, '2026-11-13'],
    ]);
    expect(list[0].running).toBe(true);
    expect(list[0].branches.map((b) => b.branch).sort()).toEqual(['فرع الشامي', 'فرع شكري']);
    // The other branch's credit is shown next to what is due.
    expect(list[1].credits).toEqual([{ branch: 'فرع شكري', amount: 500 }]);
  });

  it('puts both branches of a supplier in one row', () => {
    const rows = supplierRows(balances);
    expect(rows.map((r) => [r.code, r.balance, r.branches.length])).toEqual([
      ['322', 3500, 2],
      ['38', 3500, 2],
    ]);
  });

  it('asks about a credit and about an old bill with nothing paid on it', () => {
    const issues = reviewIssues(balances, d.today);
    expect(issues.map((i) => i.kind)).toEqual(['unpaid', 'credit']);
    const [unpaid, credit] = issues;
    if (unpaid.kind !== 'unpaid' || credit.kind !== 'credit') throw new Error('kinds');
    expect(unpaid.bill.remaining).toBe(3000);
    expect(unpaid.late).toBe(28);
    expect(credit.balance.balance).toBe(-500);
    expect(credit.otherBranchOwes).toBe(4000);
  });
});

describe('فترة الدفع (من يوم لحد يوم)', () => {
  const pharma = (today: string) =>
    supplierBalances(
      data({
        today,
        suppliers: [
          {
            code: '38',
            name: 'فارما اوفر سيز',
            month_start_day: 16,
            pay_after_days: 15,
            pay_until_days: 68,
            excluded: false,
            note: null,
          },
        ],
        lines: [line({ day: '2026-10-20', net: 1000 })],
      })
    )[0].bills[0];

  it('opens on the first day and is late only after the last one', () => {
    expect(pharma('2026-11-20')).toMatchObject({
      due: '2026-12-01',
      last: '2027-01-23',
      state: 'waiting',
    });
    expect(pharma('2026-11-25').state).toBe('due_soon');
    expect(pharma('2027-01-10').state).toBe('due_soon');
    expect(pharma('2027-01-23').state).toBe('due_soon');
    expect(pharma('2027-01-24').state).toBe('overdue');
  });

  it('lists it to pay with its last day, and counts lateness from that day', () => {
    const b = supplierBalances(
      data({
        today: '2026-12-05',
        suppliers: [
          {
            code: '38',
            name: 'فارما اوفر سيز',
            month_start_day: 16,
            pay_after_days: 15,
            pay_until_days: 68,
            excluded: false,
            note: null,
          },
        ],
        lines: [line({ day: '2026-10-20', net: 1000 })],
      })
    );
    const [item] = payList(b, '2026-12-05');
    expect(item).toMatchObject({ due: '2026-12-01', last: '2027-01-23', overdue: false });
    expect(reviewIssues(b, '2026-12-05')).toEqual([]);
  });
});

describe('مورد بيتدفع حسب الكاش (فترة طويلة)', () => {
  it('a payment two weeks after the old bill opened pays the next one, even inside its long window', () => {
    const [b] = supplierBalances(
      data({
        today: '2026-11-16',
        track_from: '2026-11-01',
        suppliers: [
          {
            code: '38',
            name: 'ايفا',
            month_start_day: 1,
            pay_after_days: 0,
            pay_until_days: 30,
            excluded: false,
            note: null,
          },
        ],
        lines: [line({ day: '2026-09-13', net: 300 }), line({ day: '2026-10-04', net: 700 })],
        payments: [
          {
            id: '1',
            supplier_code: '38',
            branch: 'فرع شكري',
            amount: 700,
            paid_on: '2026-10-21',
            note: null,
          },
        ],
      })
    );
    expect(b.balance).toBe(0);
    expect(b.bills.map((x) => [x.from, x.state])).toEqual([['2026-10-01', 'paid']]);
  });
});

describe('تقرير الشراء مجمّع بالمورد', () => {
  const H = [
    'المستخدم',
    'الصافى',
    'ض.إضافة',
    'مصاريف',
    'خصم %',
    'خصم قيمة',
    'ق.المرتجع',
    'ق.الفاتورة',
    'العدد',
    'مسلسل',
    'التاريخ',
  ];
  const rows = [
    ['تم الإسترجاع حسب: تاريخ الإنشاء , المخزن الادارة فرع شكري , النوع << الكل >> , موردين'],
    ['ابن سينا', 'موردين'],
    ['الادارة فرع شكري', 'آجل'],
    H,
    [
      'د عمر',
      '109.830',
      '0.00',
      '0.00',
      '0.00',
      '10.570',
      '0.000',
      '120.400',
      '1',
      '21488 ',
      '13/11/2026  22:40: ',
    ],
    ['109.830', '0.00', '0.00', '10.570', '0.000', '120.400', 'آجل', 'إجمـــالى:'],
    ['امتنان', 'موردين'],
    ['الادارة فرع شكري', 'نقدى'],
    H,
    [
      'د اميرة',
      '770.080',
      '0.00',
      '0.00',
      '0.00',
      '9.000',
      '0.000',
      '779.080',
      '3',
      '21506 ',
      '14/11/2026  16:01: ',
    ],
    [
      '879.910',
      '0.00',
      '0.00',
      '19.570',
      '0.000',
      '899.480',
      '2',
      'الإجمالى :',
      '879.91',
      'الإجمالى النهائى',
    ],
  ];

  it('reads one invoice per line under its supplier and section, then fills codes from the names', () => {
    const report = parseEPlusPurchases(rows);
    expect(report).toMatchObject({
      store: 'الادارة فرع شكري',
      branch: 'فرع شكري',
      reportNet: 879.91,
      needsCodes: true,
    });
    expect(
      report.invoices.map((i) => [
        i.serial,
        i.payment,
        i.invoice_at,
        i.supplier_name,
        i.net,
        i.discount,
        i.gross,
        i.items,
      ])
    ).toEqual([
      ['21488', 'credit', '2026-11-13T22:40:00', 'ابن سينا', 109.83, 10.57, 120.4, 1],
      ['21506', 'cash', '2026-11-14T16:01:00', 'امتنان', 770.08, 9, 779.08, 3],
    ]);
    const { report: filled, unknown } = fillSupplierCodes(
      report,
      [{ code: '29', name: 'ابن سينا' }],
      (n) => normalizeName(n, false)
    );
    expect(filled.invoices.map((i) => i.supplier_code)).toEqual(['29', 'امتنان']);
    expect(unknown).toEqual(['امتنان']);
  });
});

describe('صافي المشتريات في الداشبورد من ملفات ePlus', () => {
  const shamy = { branch: 'فرع الشامي' as const, store: 'الفرعية الشامي' };
  const lines = [
    line({ day: '2026-11-02', net: 1000 }),
    line({ day: '2026-11-03', net: 50, payment: 'cash' }),
    line({ day: '2026-11-03', net: 700, supplier_code: '475' }),
    line({ day: '2026-11-04', net: 80, excluded: true }),
    line({ ...shamy, day: '2026-11-05', net: 300, supplier_code: '322', invoices: 2 }),
    line({ day: '2026-10-31', net: 999 }),
    line({ day: '2026-11-13', net: 5 }),
  ];

  it('counts credit and cash, less internal codes and excluded invoices, per branch', () => {
    const s = dashboardPurchases(data({ lines }), { from: '2026-11-01', to: '2026-11-12' });
    expect(s.branches[0]).toMatchObject({
      branch: 'فرع شكري',
      gross: 1830,
      internal: 700,
      excluded: 80,
      credit: 1000,
      cash: 50,
      net: 1050,
      invoices: 2,
    });
    expect(s.branches[1]).toMatchObject({ branch: 'فرع الشامي', net: 300, invoices: 2 });
    expect(s.total).toMatchObject({ gross: 2130, net: 1350 });
    expect(s.internalSuppliers).toEqual(['دواء الشامي']);
  });

  it('says which stores do not reach the end of the period (yesterday when it runs to today)', () => {
    const s = dashboardPurchases(data({ lines }), { from: '2026-11-01', to: '2026-11-13' });
    // Yesterday is 12/11: «الادارة فرع شكري» reaches 13/11, the others have nothing or stop earlier.
    expect(s.behind.map((b) => [b.store, b.last_day])).toEqual([
      ['مخزن د.وائل', null],
      ['الفرعية الشامي', '2026-11-05'],
      ['مخزن د معاذ', null],
    ]);
    const old = dashboardPurchases(data({ lines }), { from: '2026-11-01', to: '2026-11-04' });
    // الفرعية الشامي reaches 5/11, past the end of this period.
    expect(old.behind.map((b) => b.store)).toEqual(['مخزن د.وائل', 'مخزن د معاذ']);
  });
});
