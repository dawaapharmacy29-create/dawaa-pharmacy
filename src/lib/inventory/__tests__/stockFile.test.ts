import { describe, expect, it } from 'vitest';
import { excelDay, parseStockRows } from '../stockFile';

const blank = Array(19).fill('');
const head = (code: string, name: string, total: number) => [
  'الإجمالى',
  'الوحدة',
  'الشركة المنتجة',
  'الإسم',
  'الكود',
  total,
  'علبة',
  'BPI',
  name,
  code,
  'موقع الصنف',
  'ت.الصلاحية',
  'تشغيلة',
  'ت.الشراء',
  'س.البيع',
  'س.التكلفة',
  'الكمية',
  'إسم المورد',
  'الكود',
];

describe('stock files from B-Connect', () => {
  it('reads the batches report by position (store titles, item lines, a line per batch)', () => {
    const rows = [
      ['تم الإسترجاع حسب:الوحدة كبرى', ...blank.slice(1)],
      ['الادارة فرع شكري', 'المخزن', ...blank.slice(2)],
      head('8579', 'CONTROLOC 40MG14TAB', 15),
      ['.', 47300, '', 46336.5, 188, 151.05, 12, 'مخزن سونيستا فارما', '61', ...blank.slice(9)],
      ['A3', 47270, '', 46310.2, 188, 151.05, 3, 'فارما اوفر سيز', '9', ...blank.slice(9)],
      blank,
      head('79693', 'توصيل منزلي', 7190),
      ['.', '', '', 46000, 0, 1.66, 7190, 'جرد', '1', ...blank.slice(9)],
      blank,
      ['مخزن د.وائل', 'المخزن', ...blank.slice(2)],
      head('62106', 'EREC 100 MG 12 TAB', 240),
      ['.', 47300, '', 46302, 144, 106.52, 240, 'فارما اوفر سيز', '9', ...blank.slice(9)],
      ['Page -1 of 1', 'E-pharmacy Plus', 46352, '-', 0.54, 'وقت الطباعة ', ...blank.slice(6)],
    ];
    const f = parseStockRows(rows);
    expect(f.kind).toBe('batches');
    expect(f.printedDay).toBe('2026-11-26');
    // خدمة التوصيل مش صنف.
    expect(f.rows.map((r) => r.c)).toEqual(['8579', '8579', '62106']);
    expect(f.rows[0]).toMatchObject({
      s: 'الادارة فرع شكري',
      q: 12,
      k: 151.05,
      p: 188,
      sp: 'مخزن سونيستا فارما',
      l: null,
    });
    expect(f.rows[1].l).toBe('A3');
    expect(f.rows[0].e).toBe(excelDay(47300));
    expect(f.rows[2].s).toBe('مخزن د.وائل');
    expect(f.stores).toEqual([
      { store: 'الادارة فرع شكري', items: 1, qty: 15 },
      { store: 'مخزن د.وائل', items: 1, qty: 240 },
    ]);
  });

  it('reads the per-store balance report (a column per store, header starting with الإجمالى)', () => {
    const rows = [
      [
        'الإجمالى',
        'م. د معاذ',
        'الفرعية الشامي',
        'م. د.وائل',
        'الادارة فرع شكري',
        'الوحدة',
        'الشركة',
        'إسم الصنف',
        'الكود',
      ],
      [0, 0, 0, 0, 0, 'علبة', 'غير معرفة', 'zero item', '26797'],
      [2.5, 0, 1, 0, 1.5, 'علبة', 'BPI', '3 FLY 1200 20 CAP', '80207'],
      [127, 127, 0, 0, 0, 'علبة', 'ادويا', 'EREC 100 MG 12 TAB', '62106'],
      ['ePlus', 'Page -1 of 1', 'Copyright', 46352, '-', 0.5, 'وقت الطباعة ', '', ''],
    ];
    const f = parseStockRows(rows);
    expect(f.kind).toBe('summary');
    expect(f.rows).toEqual([
      { s: 'الفرعية الشامي', c: '80207', n: '3 FLY 1200 20 CAP', co: 'BPI', u: 'علبة', q: 1 },
      { s: 'الادارة فرع شكري', c: '80207', n: '3 FLY 1200 20 CAP', co: 'BPI', u: 'علبة', q: 1.5 },
      { s: 'م. د معاذ', c: '62106', n: 'EREC 100 MG 12 TAB', co: 'ادويا', u: 'علبة', q: 127 },
    ]);
  });

  it('refuses another report', () => {
    expect(() =>
      parseStockRows([
        ['الكود', 'الاسم'],
        ['1', 'x'],
      ])
    ).toThrow(/رصيد الأصناف/);
  });

  it('turns Excel serial days and dd/mm/yyyy into ISO days', () => {
    expect(excelDay(46352)).toBe('2026-11-26');
    expect(excelDay('5/1/2027')).toBe('2027-01-05');
    expect(excelDay('')).toBeNull();
  });
});
