import { describe, expect, it } from 'vitest';
import { parseEPlusPurchases } from '../purchaseReview/ePlusReport';

// نفس شكل تقرير «فواتير الشراء» التفصيلي من ePlus: سطر الفاتورة، وتحته الأصناف، وبعدهم «الإجمالى».
const blank = (n: number) => Array.from({ length: n }, () => '');
const HEADER_LABELS = [
  'ن.الربح',
  'الربح',
  'خ.إضافى',
  'س.البيع',
  'إج.س.شراء',
  'س.شراء',
  'إج.ض.مبيعات',
  'ض.مبيعات',
  'سعر المرتجع',
  'كمية المرتجع',
  'بونص',
  'كمية',
  'ت.صلاحية',
  'الإسم',
  'الكود',
];
const header = Object.assign(blank(39), {
  0: 'ملاحظات',
  2: 'صافى الفاتورة',
  11: 'مسلسل',
  13: 'د كريم',
  14: '410.000',
  19: '410.000',
  20: 'دواء الشامي',
  21: '475',
  22: '25/11/2026  04:05: ',
  23: '22011 ',
  ...Object.fromEntries(HEADER_LABELS.map((l, i) => [24 + i, l])),
});
const line = (code: string, name: string, qty: string, buy: string, sell: string, bonus = '0 ') =>
  Object.assign(blank(39), {
    0: '%20.00 ',
    1: '20.00',
    2: '%0.00 ',
    3: sell,
    4: ` ${(Number(buy) * Number(qty)).toFixed(2)}`,
    5: buy,
    6: '0.00 ',
    7: '0.000',
    8: buy,
    9: '0.00',
    10: bonus,
    11: `${qty} `,
    13: ' 11/2027',
    14: name,
    15: code,
    16: ' 0.00',
    17: `$${(Number(buy) * Number(qty)).toFixed(2)} `,
    18: `$${(Number(sell) * Number(qty)).toFixed(2)} `,
  });
const total = Object.assign(blank(39), {
  6: 'الإجمالى',
  7: '2 ',
  8: 'عدد الأصناف',
  9: '22011',
  10: 'رقم فاتورة المورد',
});
const REPORT = [
  ['تم الإسترجاع حسب: تاريخ الإنشاء , المخزن الادارة فرع شكري , النوع << الكل >>'],
  ['الادارة فرع شكري', 'موردين'],
  ['آجل'],
  header,
  line('64766', 'pampers  premium 1 60 pcs', '1.00', '350.000', '420.00'),
  line('47724', 'INDERAL 40 MG 50 TAB', '0.50', '72.000', '100.00', '1 '),
  total,
];

describe('أصناف فاتورة الشراء', () => {
  it('keeps each item line with its quantity, prices, bonus and expiry', () => {
    const [inv] = parseEPlusPurchases(REPORT).invoices;
    expect(inv.serial).toBe('22011');
    expect(inv.items).toBe(2);
    expect(inv.lines).toHaveLength(2);
    expect(inv.lines?.[0]).toEqual({
      line_no: 1,
      code: '64766',
      name: 'pampers premium 1 60 pcs',
      qty: 1,
      bonus: 0,
      return_qty: 0,
      buy_price: 350,
      buy_total: 350,
      sell_price: 420,
      sell_total: 420,
      profit: 20,
      profit_pct: 20,
      expiry: '11/2027',
    });
    expect(inv.lines?.[1]).toMatchObject({
      line_no: 2,
      code: '47724',
      qty: 0.5,
      bonus: 1,
      buy_total: 36,
    });
  });

  it('a report without item lines has no lines', () => {
    const [inv] = parseEPlusPurchases([...REPORT.slice(0, 4), total]).invoices;
    expect(inv.lines).toBeUndefined();
  });
});
