import { describe, expect, it } from 'vitest';
import {
  cycleOf,
  dailySeries,
  expenseCategories,
  expenseLines,
  groupBy,
  closerKey,
  periodRange,
  previousRange,
  shiftMoney,
  totalsOf,
  change,
} from '../shiftHandoverLedger';

const base = {
  id: 'a',
  branch: 'فرع شكري',
  shift_type: 'صباحي',
  shift_date: '2026-11-02',
  submitted_by: 'د/ أحمد',
};

describe('shift handover ledger', () => {
  it('reads a handover the way DawaaWael does: cash for the accountant is cash minus cash spending', () => {
    const m = shiftMoney({
      total_sales: 10000,
      cash_sales: 7000,
      visa_sales: 1500,
      insta_sales: 1000,
      vodafone_sales: 500,
      other_sales: 0,
      cash_handover: 6800,
      total_expenses: 200,
      expenses: [{ category: 'نثريات', amount: 200, payment_source: 'cash' }],
    });
    expect(m.transfers).toBe(3000);
    expect(m.expenses).toBe(200);
    expect(m.toAccountant).toBe(6800);
    expect(m.operatingNet).toBe(9800);
    expect(m.cashVariance).toBe(0);
    expect(m.splitGap).toBe(0);
    expect(m.legacy).toBe(false);
  });

  it('spending paid by insta does not come off the drawer', () => {
    const m = shiftMoney({
      total_sales: 5000,
      cash_sales: 5000,
      cash_handover: 4900,
      expenses: [
        { category: 'نثريات', amount: 100 },
        { category: 'صيانة', amount: 300, payment_source: 'insta' },
      ],
    });
    expect(m.expenses).toBe(400);
    expect(m.cashExpenses).toBe(100);
    expect(m.toAccountant).toBe(4900);
  });

  it('old handovers: payment lines typed as expenses are payments, not spending', () => {
    const m = shiftMoney({
      total_sales: 20000,
      total_expenses: 6300,
      expenses: [
        { category: 'فيزا', amount: 4000 },
        { category: 'انستا', amount: 2000 },
        { category: 'نظافة', amount: 300 },
      ],
    });
    expect(m.legacy).toBe(true);
    expect(m.visa).toBe(4000);
    expect(m.insta).toBe(2000);
    expect(m.cash).toBe(14000);
    expect(m.expenses).toBe(300);
    expect(m.toAccountant).toBe(13700);
  });

  it('flags a split that does not add up and a cash handed over that differs', () => {
    const m = shiftMoney({
      total_sales: 1000,
      cash_sales: 600,
      visa_sales: 300,
      cash_handover: 500,
    });
    expect(m.splitGap).toBe(100);
    expect(m.cashVariance).toBe(-100);
  });

  it('a total with no lines is counted as cash spending', () => {
    const m = shiftMoney({ total_sales: 1000, cash_sales: 1000, total_expenses: 50, expenses: [] });
    expect(m.expenses).toBe(50);
    expect(m.toAccountant).toBe(950);
    expect(
      expenseLines([
        { ...base, total_sales: 1000, cash_sales: 1000, total_expenses: 50, expenses: [] },
      ])[0].category
    ).toBe('من غير تفاصيل');
  });

  it('adds up totals, days and groups by the person who closed', () => {
    const rows = [
      { ...base, total_sales: 1000, cash_sales: 1000 },
      {
        ...base,
        id: 'b',
        submitted_by: 'د احمد',
        shift_date: '2026-11-03',
        total_sales: 3000,
        cash_sales: 2000,
        visa_sales: 1000,
      },
      { ...base, id: 'c', submitted_by: 'د/ مي', total_sales: 500, cash_sales: 500 },
    ];
    const t = totalsOf(rows);
    expect(t.count).toBe(3);
    expect(t.days).toBe(2);
    expect(t.sales).toBe(4500);
    const people = groupBy(
      rows,
      (r) => closerKey(r.submitted_by),
      (r) => r.submitted_by
    );
    expect(people.length).toBe(2);
    expect(people[0].count).toBe(2);
    expect(people[0].avgSales).toBe(2000);
    expect(Math.round(people[0].transferShare)).toBe(25);
  });

  it('cycles run 26 → 25 and periods compare with the days just before', () => {
    expect(cycleOf('2026-11-13')).toEqual({ from: '2026-10-26', to: '2026-11-25' });
    expect(cycleOf('2026-11-26')).toEqual({ from: '2026-11-26', to: '2026-12-25' });
    expect(cycleOf('2026-01-10')).toEqual({ from: '2025-12-26', to: '2026-01-25' });
    expect(periodRange('prevCycle', '2026-11-13')).toEqual({
      from: '2026-09-26',
      to: '2026-10-25',
    });
    expect(periodRange('week', '2026-11-13')).toEqual({ from: '2026-11-07', to: '2026-11-13' });
    expect(previousRange({ from: '2026-11-07', to: '2026-11-13' })).toEqual({
      from: '2026-10-31',
      to: '2026-11-06',
    });
    expect(change(110, 100)).toBe(10);
    expect(change(5, 0)).toBe(null);
  });

  it('daily series keeps empty days and splits by branch', () => {
    const rows = [
      { ...base, total_sales: 1000, cash_sales: 1000 },
      { ...base, id: 'b', branch: 'فرع الشامي', total_sales: 400, cash_sales: 400 },
    ];
    const s = dailySeries(rows, { from: '2026-11-01', to: '2026-11-03' }, [
      'فرع شكري',
      'فرع الشامي',
    ]);
    expect(s.length).toBe(3);
    expect(s[0].sales).toBe(0);
    expect(s[1].byBranch['فرع شكري']).toBe(1000);
    expect(s[1].byBranch['فرع الشامي']).toBe(400);
  });

  it('expense categories add up with their share', () => {
    const lines = expenseLines([
      {
        ...base,
        total_sales: 1,
        cash_sales: 1,
        expenses: [
          { category: 'نظافة', amount: 30 },
          { category: 'نظافة', amount: 10 },
          { category: 'كهرباء', amount: 60 },
        ],
      },
    ]);
    const c = expenseCategories(lines);
    expect(c[0]).toMatchObject({ name: 'كهرباء', amount: 60, count: 1, share: 60 });
    expect(c[1]).toMatchObject({ name: 'نظافة', amount: 40, count: 2, max: 30 });
  });
});
