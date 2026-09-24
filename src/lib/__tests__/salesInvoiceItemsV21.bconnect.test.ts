import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseSalesInvoiceItemsV21 } from '@/lib/salesInvoiceItemsV21';

const headers = ['فاتورة','نوع','كود','عميل','عددأصناف','صافى الفاتورة','خصم نسبة','خصم قيمة','مصاريف','م','ك.صنف','صنف','صلاحية','كمية','وحدة','مرتجع','سعر بيع','خصم صنف','خصم صنف%','تاريخ'];

function workbookBuffer(rows: unknown[][]) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ['فواتير المبيعات من 21/09/2026 إلى 23/09/2026 لمخزن <<الكـــل>>'],
    headers,
    ...rows,
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, 'Sales Bills 21092026');
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

describe('B-Connect sales invoice item parser', () => {
  it('treats سعر بيع as gross LINE value, not unit price, and does not invent one branch for مخزن الكل', () => {
    const buffer = workbookBuffer([
      [36024,'توصيل منزلى',8951,'انس عبد الله ش',2,154.51,10,0,0,1,80368,'STOMICOPE 30 CAP','2028/10',0.34,'علبة',0,85.68,0,0,46286.00555555556],
      [36024,'توصيل منزلى',8951,'انس عبد الله ش',2,154.51,10,0,0,2,70033,'DIAFLOZIMET 10/1000 MG 30 TAB','2029/05',1,'شريط',0,86,0,0,46286.00555555556],
    ]);

    const parsed = parseSalesInvoiceItemsV21(buffer, 'فرع شكري');
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.warnings.join(' ')).toContain('مخزن');

    const first = parsed.rows[0];
    expect(first.branch).toBeNull();
    expect(first.grossLineAmount).toBe(85.68);
    expect(first.unitPrice).toBeCloseTo(252, 6);
    expect(first.effectiveQuantity).toBeCloseTo(0.34, 6);

    const totalNet = parsed.rows.reduce((sum, row) => sum + Number(row.netLineAmount || 0), 0);
    expect(totalNet).toBeCloseTo(154.51, 6);
    expect(first.netLineAmount).toBeLessThan(first.grossLineAmount || 0);
  });

  it('removes a fully returned line from effective sold quantity and net value', () => {
    const buffer = workbookBuffer([
      [36380,'توصيل منزلى',11209,'مهندس ماهر الصاوي ش',2,29,0,0,0,1,11277,'OTRIVIN BABY SALINE','2029/01',1,'زجاجة',1,20,0,0,46288.49930555555],
      [36380,'توصيل منزلى',11209,'مهندس ماهر الصاوي ش',2,29,0,0,0,2,58263,'TRIMED FLU 20 TAB','2028/10',1,'شريط',0,29,0,0,46288.49930555555],
    ]);

    const parsed = parseSalesInvoiceItemsV21(buffer, 'فرع الشامي');
    expect(parsed.rows[0].effectiveQuantity).toBe(0);
    expect(parsed.rows[0].netLineAmount).toBe(0);
    expect(parsed.rows[1].effectiveQuantity).toBe(1);
    expect(parsed.rows[1].netLineAmount).toBeCloseTo(29, 6);
  });
});
