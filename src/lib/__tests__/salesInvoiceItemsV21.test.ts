import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseSalesInvoiceItemsV21 } from '../salesInvoiceItemsV21';

function bconnectFile(rows: unknown[][]) {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['فواتير المبيعات من 04/11/2026 إلى 05/11/2026 لمخزن <<الكـــل>>'],
    [
      'فاتورة',
      'نوع',
      'كود',
      'عميل',
      'عددأصناف',
      'صافى الفاتورة',
      'م',
      'ك.صنف',
      'صنف',
      'كمية',
      'سعر بيع',
      'تاريخ',
    ],
    ...rows,
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Sales Bills');
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

describe('BConnect item detail import', () => {
  it('reads the banner/header format without guessing the branch from filename or invoice prefix', () => {
    const file = bconnectFile([
      [42776, 'كاش', 170, 'عميل', 1, 480, 1, 77837, 'Product A', 1, 480, 46330],
      [81256, 'كاش', 516, 'عميل آخر', 1, 190, 1, 80387, 'Product B', 2, 95, '2026-11-05 16:37:00'],
    ]);
    const parsed = parseSalesInvoiceItemsV21(file, '');
    expect(parsed.invalidRows).toBe(0);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows.map((row) => row.invoiceNumber)).toEqual(['42776', '81256']);
    expect(parsed.rows[0].branch).toBe('');
    expect(parsed.rows[1].invoiceDate).toBe('2026-11-05');
  });

  it('rejects incomplete invoice detail lines instead of creating inferred identities', () => {
    const file = bconnectFile([
      [42776, 'كاش', 170, 'عميل', 1, 480, 1, '', 'Product A', 1, 480, '2026-11-04'],
    ]);
    const parsed = parseSalesInvoiceItemsV21(file, 'الشامي');
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.invalidRows).toBe(1);
  });
});
