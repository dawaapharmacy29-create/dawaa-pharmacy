import { describe, expect, it } from 'vitest';
import { cleanCustomerName, readTaskSheets, sheetDateToIso, sheetSectionOf, whatsappNumber } from '../tasks';
import { buildTaskWorkbook, readTaskWorkbook, TASKS_SHEET, CASES_SHEET } from '../sheet';
import type { DailyTask } from '../api';

const today = '2026-11-20';

describe('sheetDateToIso', () => {
  it('reads the formats people type', () => {
    expect(sheetDateToIso('25/11', today)).toBe('2026-11-25');
    expect(sheetDateToIso('٢٥/١١/٢٠٢٦', today)).toBe('2026-11-25');
    expect(sheetDateToIso('2026-12-01', today)).toBe('2026-12-01');
    expect(sheetDateToIso(new Date(Date.UTC(2026, 10, 27)), today)).toBe('2026-11-27');
    expect(sheetDateToIso(46351, today)).toBe('2026-11-25');
  });
  it('rejects nonsense', () => {
    expect(sheetDateToIso('31/2', today)).toBeNull();
    expect(sheetDateToIso('بكرة', today)).toBeNull();
    expect(sheetDateToIso('', today)).toBeNull();
  });
});

describe('readTaskSheets', () => {
  const header = [
    'id',
    '#',
    'النوع',
    'الفرع',
    'الكود',
    'الاسم',
    'الموبايل',
    'السبب',
    'آخر تواصل',
    'المحاولة',
    'النتيجة',
    'ملاحظة',
    'المتابعة الجاية (اختياري)',
  ];
  const caseHeader = [
    'الفرع',
    'كود العميل',
    'اسم العميل',
    'الموبايل',
    'الدكتور',
    'المطلوب (من الجروب)',
    'النتيجة',
    'ملاحظة',
    'المتابعة الجاية (اختياري)',
  ];

  it('keeps rows with a result, flags unknown results and keeps doctor cases', () => {
    const row = (id: string, result: string, next = '') => [
      id,
      1,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      result,
      'n',
      next,
    ];
    const r = readTaskSheets(
      [header, row('a', 'مردش'), row('b', ''), row('c', 'حاجة تانية'), row('d', 'هيشتري', 'xx')],
      [
        caseHeader,
        ['الشامي', '123', '', '', 'د. أحمد', 'عاوز يتابع ضغطه', '', '', ''],
        ['', '55', '', '', '', 'x', '', '', ''],
        [],
      ],
      today
    );
    expect(r.updates.map((u) => u.id)).toEqual(['a', 'd']);
    expect(r.updates[1].next_date).toBeNull();
    expect(r.cases).toHaveLength(1);
    expect(r.cases[0]).toMatchObject({ branch: 'الشامي', customer_code: '123', doctor: 'د. أحمد' });
    expect(r.problems.map((p) => p.row)).toEqual([4, 5, 3]);
  });

  it('refuses a sheet whose headers changed', () => {
    const r = readTaskSheets([['x', 'y']], [], today);
    expect(r.updates).toHaveLength(0);
    expect(r.problems[0].row).toBe(1);
  });
});

describe('workbook round trip', () => {
  it('builds a sheet that reads back after filling it in', async () => {
    const task: DailyTask = {
      id: '00000000-0000-0000-0000-000000000001',
      queue_date: today,
      branch: 'فرع شكري',
      source: 'new_customer',
      priority: '2',
      customer_code: '9001',
      customer_name: 'عميل تجربة',
      customer_phone: '01000000000',
      reason: 'أول فاتورة',
      attempt_no: 1,
      assigned_staff_id: 's',
      assigned_name: 'x',
      result: null,
      result_label: null,
      result_note: null,
      next_followup_date: null,
      last_contact: null,
    };
    const blob = await buildTaskWorkbook([task], today, 'تجربة');
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    const ws = wb.getWorksheet(TASKS_SHEET)!;
    expect(ws.getColumn(1).hidden).toBe(true);
    // title, count, steps, spacer, header, section row, then the task
    const headerRow = ws.getRow(5).values as unknown[];
    const at = (name: string) => headerRow.indexOf(name);
    expect(String(ws.getCell(1, 2).value)).toContain('شيت مكالمات تجربة — فرع شكري');
    expect(String(ws.getCell(6, 2).value)).toContain('عملاء جداد');
    expect(ws.getCell(7, at('الاسم')).value).toBe('عميل تجربة');
    expect(ws.getCell(7, at('واتساب')).value).toMatchObject({ hyperlink: 'https://wa.me/201000000000' });
    expect(at('الفرع')).toBe(-1);
    ws.getCell(7, at('النتيجة')).value = 'اتسجل واتبعتت الترحيب';
    ws.getCell(7, at('ملاحظة')).value = { richText: [{ text: 'تمام ' }, { text: 'جدا' }] };
    ws.getCell(7, at('المتابعة الجاية (اختياري)')).value = new Date(Date.UTC(2026, 10, 27));
    const cs = wb.getWorksheet(CASES_SHEET)!;
    cs.getRow(2).values = ['شكري', '777', '', '', 'د. منى', 'محتاج متابعة سكر'];
    const r = await readTaskWorkbook((await wb.xlsx.writeBuffer()) as ArrayBuffer, today);
    expect(r.problems).toEqual([]);
    expect(r.updates).toEqual([
      { id: task.id, result: 'اتسجل واتبعتت الترحيب', note: 'تمام جدا', next_date: '2026-11-27' },
    ]);
    expect(r.cases[0]).toMatchObject({
      branch: 'شكري',
      customer_code: '777',
      reason: 'محتاج متابعة سكر',
    });
  }, 60_000);
});

describe('sheet helpers', () => {
  it('drops the branch bookkeeping tags from a customer name', () => {
    expect(cleanCustomerName('كريم محمد ش 17635 (P200 )', '17635')).toBe('كريم محمد');
    expect(cleanCustomerName('محمد يحيى ش 17886 P(150)', '17886')).toBe('محمد يحيى');
    expect(cleanCustomerName('بسنت ابو العزP250', '18671')).toBe('بسنت ابو العز');
    expect(cleanCustomerName('جودي ايمن300P', '5044')).toBe('جودي ايمن');
    expect(cleanCustomerName('د امل حسن(500p)', '3821')).toBe('د امل حسن');
    expect(cleanCustomerName('م علي النظامي %', '144')).toBe('م علي النظامي');
    expect(cleanCustomerName('المستشار راضي الشافعي شخصي ش 866', '866')).toBe('المستشار راضي الشافعي شخصي');
    expect(cleanCustomerName('منى محمد.', '19677')).toBe('منى محمد');
    expect(cleanCustomerName('19676', '19676')).toBe('19676');
  });

  it('turns an Egyptian mobile into a WhatsApp number and rejects the rest', () => {
    expect(whatsappNumber('01013559001')).toBe('201013559001');
    expect(whatsappNumber('+20 101 355 9001')).toBe('201013559001');
    expect(whatsappNumber('1013559001')).toBe('201013559001');
    expect(whatsappNumber('0402345678')).toBeNull();
    expect(whatsappNumber(null)).toBeNull();
  });

  it('puts follow-ups first and customers without a phone last', () => {
    expect(sheetSectionOf({ priority: '1', source: 'lost', customer_phone: '01013559001' })).toBe('followup');
    expect(sheetSectionOf({ priority: '7', source: 'lost', customer_phone: '01013559001' })).toBe('lost');
    expect(sheetSectionOf({ priority: '2', source: 'new_customer', customer_phone: null })).toBe('no_phone');
  });

  it('reads a sheet whose header sits under a title block', () => {
    const header = ['id', '#', 'الاسم', 'النتيجة', 'ملاحظة', 'المتابعة الجاية (اختياري)'];
    const r = readTaskSheets(
      [['', 'شيت مكالمات'], ['', 'النهارده 2 مكالمة'], [], header, ['', '1. عملاء جداد (1)'], ['a', 1, 'x', 'مردش', '', ''], ['b', 2, 'y', 'غلط', '', '']],
      [],
      today
    );
    expect(r.updates.map((u) => u.id)).toEqual(['a']);
    expect(r.problems).toEqual([{ sheet: 'المكالمات', row: 7, problem: 'النتيجة «غلط» مش من القايمة' }]);
  });
});
