import { describe, expect, it } from 'vitest';
import { followupCandidates, itemTotals, parseItems, type GroupRequest } from '../groups';

describe('items and quantities in a request', () => {
  it('reads a quantity only next to a unit or a multiplier', () => {
    expect(parseItems('بانادول اكسترا ٢ علبة · كونكور 5')).toEqual([
      { name: 'بانادول اكسترا', qty: 2 },
      { name: 'كونكور 5', qty: null },
    ]);
    expect(parseItems('محتاجه علبتين ميرنا، فولتارين x3')).toEqual([
      { name: 'ميرنا', qty: 2 },
      { name: 'فولتارين', qty: 3 },
    ]);
    expect(parseItems('علبة اوجمنتين 1 جم')).toEqual([{ name: 'اوجمنتين 1 جم', qty: 1 }]);
    expect(parseItems(null)).toEqual([]);
  });

  it('leaves out the doctor signing the request and forwarded labels', () => {
    expect(parseItems('ACM NOVOPHANE · د دنيا')).toEqual([{ name: 'ACM NOVOPHANE', qty: null }]);
    expect(parseItems('ريجين فووم · د/علياء')).toEqual([{ name: 'ريجين فووم', qty: null }]);
    expect(parseItems('طلبات عملاء · [مُعاد توجيهها]')).toEqual([]);
  });

  it('sums the items across customers for the export', () => {
    const row = (fingerprint: string, code: string, items: GroupRequest['items']) =>
      ({
        fingerprint,
        customer_code: code,
        customer_phone: null,
        items,
        details: null,
      }) as GroupRequest;
    expect(
      itemTotals([
        row('a', '1', [{ name: 'ميرنا', qty: 2 }]),
        row('b', '2', [
          { name: 'ميرنا', qty: 1 },
          { name: 'كونكور', qty: null },
        ]),
      ])
    ).toEqual([
      { name: 'ميرنا', qty: 3, unknown: 0, customers: 2 },
      { name: 'كونكور', qty: 0, unknown: 1, customers: 1 },
    ]);
  });
});

describe('follow-up group export', () => {
  it('keeps the cases and any message with a customer, with the doctor named in it', () => {
    const chat = [
      '24/11/2026, 10:15 - صيدليات دواء الشامي: نتطمن على العميل 12781 د بسمله',
      '24/11/2026, 10:20 - صيدليات دواء الشامي: صباح الخير',
      '24/11/2026, 11:00 - د علا سامي: العميل ده 01012345678 محتاج متابعة',
    ].join('\n');
    const rows = followupCandidates(chat, [
      { staffId: 's1', name: 'د بسمله', branch: 'فرع الشامي' },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ customerCode: '12781', doctorId: 's1', likely: true });
    expect(rows[1]).toMatchObject({ customerPhone: '01012345678' });
    expect(rows[0].fingerprint).not.toBe(rows[1].fingerprint);
  });
});

describe('requests export', () => {
  it('writes one line per item and a totals sheet', async () => {
    const { exportRequestsWorkbook } = await import('../groups');
    const ExcelJS = (await import('exceljs')).default;
    const blob = await exportRequestsWorkbook(
      [
        {
          fingerprint: 'a',
          branch: 'فرع الشامي',
          sent_at: '2026-11-24T10:00:00Z',
          day: '2026-11-24',
          sender: 'د بسمله',
          doctor: 'د بسمله',
          customer_code: '12781',
          customer_phone: '01012345678',
          customer_name: 'منى',
          details: null,
          body: 'منى 12781 ميرنا ٢ علبة وكونكور',
          items: [
            { name: 'ميرنا', qty: 2 },
            { name: 'كونكور', qty: null },
          ],
          status: 'new',
          status_note: null,
          status_by: null,
          status_at: null,
          notify_task: false,
        },
      ],
      'اختبار'
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    expect(wb.worksheets.map((w) => w.name)).toEqual(['الطلبات', 'إجمالي الأصناف', 'عن الملف']);
    expect(wb.getWorksheet('الطلبات')!.rowCount).toBe(3);
    expect(wb.getWorksheet('إجمالي الأصناف')!.getRow(2).getCell(2).value).toBe(2);
  });
});
