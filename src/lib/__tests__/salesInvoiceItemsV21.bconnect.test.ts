import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseSalesInvoiceItemsV21 } from '@/lib/salesInvoiceItemsV21';

describe('B-Connect sales invoice item parser', () => {
  it('parses the short Arabic headers and anchors Excel wall-clock time to Cairo', () => {
    const workbook = XLSX.utils.book_new();
    const rows = [
      ['B-Connect export'],
      ['فاتورة','نوع','كود','عميل','عددأصناف','صافى الفاتورة','خصم نسبة','خصم قيمة','مصاريف','م','ك.صنف','صنف','صلاحية','كمية','وحدة','مرتجع','سعر بيع','خصم صنف','خصم صنف%','تاريخ'],
      [73006,'توصيل منزلى',17777,'م محمد الكموني vip %',1,675,0,0,0,1,70271,'ISIS TEEN DERM GEL SENSITIVE 250ML','2028/10',1,'علبة',0,675,0,0,46281.05763888889],
    ];
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Sales Bills 10092026');
    const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

    const parsed = parseSalesInvoiceItemsV21(buffer, 'فرع شكري');
    expect(parsed.rows).toHaveLength(1);
    const item = parsed.rows[0];
    expect(item.invoiceNumber).toBe('73006');
    expect(item.customerCode).toBe('17777');
    expect(item.productCode).toBe('70271');
    expect(item.quantity).toBe(1);
    expect(item.unitPrice).toBe(675);
    expect(item.netLineAmount).toBe(675);
    expect(item.invoiceDate).toBe('2026-09-15T22:23:00.000Z');
  });
});
