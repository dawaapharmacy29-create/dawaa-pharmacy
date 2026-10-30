import { describe, expect, it } from 'vitest';
import { matchCountedFileRows, parseWeeklyCountRows, weeklyCountErrorMessage } from '../weeklyInventoryCounts';

describe('weekly inventory count file', () => {
  it('reads the program columns by their Arabic names, Arabic digits and thousands separators', () => {
    const parsed = parseWeeklyCountRows([
      { 'كود الصنف': '1001', 'اسم الصنف': 'AUGMENTIN 1GM', 'الرصيد': '١٢', 'سعر البيع': '1,250' },
      { 'كود الصنف': '1002', 'اسم الصنف': 'PANADOL', 'الرصيد': 0, 'سعر البيع': '' },
    ]);
    expect(parsed.columns).toEqual({ code: 'كود الصنف', name: 'اسم الصنف', balance: 'الرصيد', price: 'سعر البيع' });
    expect(parsed.items).toEqual([
      { product_code: '1001', item_name: 'AUGMENTIN 1GM', expected_qty: '12', unit_price: '1250' },
      { product_code: '1002', item_name: 'PANADOL', expected_qty: '0', unit_price: null },
    ]);
  });

  it('skips rows without a name or a readable balance and drops duplicates', () => {
    const parsed = parseWeeklyCountRows([
      { 'الصنف': 'A', 'رصيد': '3' },
      { 'الصنف': '', 'رصيد': '3' },
      { 'الصنف': 'B', 'رصيد': 'غير معروف' },
      { 'الصنف': 'a', 'رصيد': '4' },
      { 'الصنف': '', 'رصيد': '' },
    ]);
    expect(parsed.items.map((item) => item.item_name)).toEqual(['A']);
    expect(parsed).toMatchObject({ skipped: 2, duplicates: 1 });
  });

  it('matches the counted file by code, then by name, and never reads the balance as the count', () => {
    const items = [
      { id: 'a', product_code: '1001', item_name: 'AUGMENTIN 1GM' },
      { id: 'b', product_code: null, item_name: 'PANADOL' },
      { id: 'c', product_code: '1003', item_name: 'CATAFLAM' },
    ];
    const match = matchCountedFileRows([
      { 'كود الصنف': '1001', 'اسم الصنف': 'AUGMENTIN 1GM', 'الرصيد': '10', 'الفعلي': '٩' },
      { 'كود الصنف': '', 'اسم الصنف': 'panadol', 'الرصيد': '5', 'الفعلي': '5' },
      { 'كود الصنف': '9999', 'اسم الصنف': 'صنف مش في الأسبوع', 'الرصيد': '1', 'الفعلي': '1' },
      { 'كود الصنف': '1003', 'اسم الصنف': 'CATAFLAM', 'الرصيد': '4', 'الفعلي': '' },
    ], items);
    expect(match.countedColumn).toBe('الفعلي');
    expect(match.counts).toEqual([{ item_id: 'a', actual_qty: '9' }, { item_id: 'b', actual_qty: '5' }]);
    expect(match).toMatchObject({ unmatched: ['صنف مش في الأسبوع'], missing: 1 });
    expect(matchCountedFileRows([{ 'اسم الصنف': 'PANADOL', 'الرصيد': '5' }], items)).toMatchObject({ countedColumn: null, counts: [] });
  });

  it('maps the RPC errors to Arabic messages', () => {
    expect(weeklyCountErrorMessage(new Error('items_not_counted:3'))).toBe('لسه فيه 3 صنف من غير كمية فعلية');
    expect(weeklyCountErrorMessage({ message: 'not_authorized' })).toBe('مش مسموح لك بالخطوة دي في الفرع ده');
  });
});
