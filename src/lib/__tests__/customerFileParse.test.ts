import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseCustomerFile } from '@/lib/invoiceImporter';

const toBuffer = (aoa: unknown[][]) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Sheet1');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
};

describe('parseCustomerFile', () => {
  it('reads the B-Connect customers report whose headers sit over other columns', () => {
    const header = [
      'العنوان',
      'موبايل',
      'تليفون',
      'آخر فاتورة بيع',
      'بداية التعامل',
      'الرصيد الحالى',
      'حد المسحوبات',
      'تابع لـ',
      'بداية التعامل',
      'إسـم العميــل',
      'كـود',
      '',
      '',
      '',
      '',
    ];
    const audit = (by: string) => [
      46351.99,
      'فى',
      by,
      'إنشاء',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ];
    const buf = toBuffer([
      header,
      [
        '',
        '',
        '',
        '',
        '01555951652',
        '',
        46351.99,
        '',
        46351,
        0,
        0,
        'غير تابع',
        'فرد',
        'أ*روان',
        '19773',
      ],
      audit('د دنيا الخولي'),
      [
        'حضانه ايلا',
        '',
        '01224772632',
        '',
        '01224772632',
        '',
        46351.3,
        '',
        46351,
        0,
        0,
        'غير تابع',
        'فرد',
        'ا دنيا',
        '19748',
      ],
      audit('محمد عمر'),
      ['', '', '', '', '', '', 0, '', 46351, 0, 0, 'غير تابع', 'فرد', 'ابراهيم ش', 19759],
      audit('هاجر'),
      [0, 'إجمالى مسحوبات العملاء', 3, 'عدد العملاء', '', '', '', '', '', '', '', '', '', '', ''],
      [
        'Page -1 of 1',
        'ePlus',
        46352,
        '-',
        0.48,
        'وقت الطباعة ',
        'Copyright © BConnect 2012',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
      ],
    ]);
    const r = parseCustomerFile(buf, 'العملاء.xlsx');
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => [x.code, x.name, x.phone])).toEqual([
      ['19773', 'أ*روان', '01555951652'],
      ['19748', 'ا دنيا', '01224772632'],
      ['19759', 'ابراهيم ش', ''],
    ]);
  });

  it('still reads a plain file with aligned headers', () => {
    const buf = toBuffer([
      ['الكود', 'اسم العميل', 'موبايل', 'العنوان'],
      ['101', 'محمد علي', '01012345678', 'شكري'],
      ['102', 'سارة', '1112345678', ''],
    ]);
    const r = parseCustomerFile(buf, 'c.xlsx');
    expect(r.rows.map((x) => [x.code, x.name, x.phone, x.address])).toEqual([
      ['101', 'محمد علي', '01012345678', 'شكري'],
      ['102', 'سارة', '01112345678', ''],
    ]);
  });
});
