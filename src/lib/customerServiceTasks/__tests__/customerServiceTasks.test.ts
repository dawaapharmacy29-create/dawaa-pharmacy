import { describe, expect, it } from 'vitest';
import { cleanCustomerName, readTaskSheets, sheetDateToIso, sheetSectionOf, whatsappNumber } from '../tasks';
import { buildTaskWorkbook, readTaskWorkbook, shortReason, TASKS_SHEET, CASES_SHEET } from '../sheet';
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
      last_purchase_date: '2026-11-20',
      last_purchase_amount: 600,
      avg_invoice: 492.4,
      invoices_150: 8,
    };
    const blob = await buildTaskWorkbook([task], today, 'تجربة');
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    const ws = wb.getWorksheet(TASKS_SHEET)!;
    expect(ws.getColumn(1).hidden).toBe(true);
    // title, the day, steps, read/fill band, header, section row, then the task
    const headerRow = ws.getRow(5).values as unknown[];
    const at = (name: string) => headerRow.indexOf(name);
    expect(String(ws.getCell(1, 2).value)).toContain('مكالمات خدمة العملاء  ·  تجربة  ·  فرع شكري');
    expect(String(ws.getCell(6, 2).value)).toContain('عملاء جداد');
    expect(ws.getCell(7, at('الاسم')).value).toBe('عميل تجربة');
    expect(ws.getCell(7, at('واتساب')).value).toMatchObject({ hyperlink: 'https://wa.me/201000000000' });
    expect(at('الفرع')).toBe(-1);
    expect(ws.getCell(7, at('ليه بنكلّمه')).value).toBe('أول فاتورة');
    expect(ws.getCell(7, at('آخر شرا')).value).toBe('يوم 20/11 بـ 600 ج\nمتوسط فاتورته 492 ج');
    expect(ws.getCell(7, at('آخر متابعة')).value).toBe('أول مرة نكلّمه');
    // every answer except the note is a dropdown
    for (const name of ['اتواصلت إزاي', 'رد؟', 'النتيجة', 'السبب', 'المتابعة الجاية', 'العرض']) {
      const v = ws.getCell(7, at(name)).dataValidation;
      expect(v?.type).toBe('list');
      expect(String(v?.formulae?.[0]).length).toBeLessThan(255);
    }
    ws.getCell(7, at('اتواصلت إزاي')).value = 'مكالمة';
    ws.getCell(7, at('رد؟')).value = 'رد';
    ws.getCell(7, at('النتيجة')).value = 'اتسجل واتبعتله الترحيب';
    ws.getCell(7, at('المتابعة الجاية')).value = 'بعد أسبوع';
    ws.getCell(7, at('العرض')).value = 'كوبون 100 ج';
    ws.getCell(7, at('اسم الصنف أو ملاحظة')).value = { richText: [{ text: 'تمام ' }, { text: 'جدا' }] };
    const cs = wb.getWorksheet(CASES_SHEET)!;
    cs.getRow(2).values = ['شكري', '777', '', '', 'د. منى', 'محتاج متابعة سكر'];
    const r = await readTaskWorkbook((await wb.xlsx.writeBuffer()) as ArrayBuffer, today);
    expect(r.problems).toEqual([]);
    expect(r.updates).toEqual([
      {
        id: task.id,
        channel: 'call',
        reach: 'answered',
        outcome: 'registered',
        reason_code: null,
        followup: 'week',
        offer: 'c100',
        note: 'تمام جدا',
        next_date: null,
      },
    ]);
    expect(r.cases[0]).toMatchObject({
      branch: 'شكري',
      customer_code: '777',
      reason: 'محتاج متابعة سكر',
    });
  }, 60_000);
});

describe('structured answers', () => {
  const header = ['id', '#', 'الاسم', 'اتواصلت إزاي', 'رد؟', 'النتيجة', 'السبب', 'المتابعة الجاية', 'اسم الصنف أو ملاحظة'];
  const read = (...rows: unknown[][]) => readTaskSheets([['', 'شيت'], header, ...rows], [], today);

  it('turns the chosen labels into codes', () => {
    const r = read(
      ['a', 1, 'x', 'واتساب', 'مردش', '', '', '', ''],
      ['b', 2, 'y', '', '', 'عنده شكوى', 'التوصيل اتأخر', 'بكرة', 'اتأخر ساعتين'],
      ['c', 3, 'z', 'مكالمة', '', '', '', '', 'ملاحظة من غير رد'],
      ['', '', '2. عملاء بطّلوا (1)']
    );
    expect(r.problems).toEqual([]);
    expect(r.updates).toEqual([
      { id: 'a', channel: 'whatsapp', reach: 'no_answer', outcome: null, reason_code: null, followup: null, note: '', next_date: null },
      { id: 'b', channel: null, reach: 'answered', outcome: 'complaint', reason_code: 'delivery_late', followup: 'tomorrow', note: 'اتأخر ساعتين', next_date: null },
    ]);
  });

  it('reads the offer when the sheet has the column', () => {
    const h = [...header.slice(0, 8), 'العرض', header[8]];
    const r = readTaskSheets(
      [h, ['a', 1, 'x', 'مكالمة', 'رد', 'تمام وراضي', '', '', 'توصيل مجاني', ''], ['b', 2, 'y', '', 'رد', '', '', '', 'كوبون 500', '']],
      [],
      today
    );
    expect(r.updates.map((u) => u.offer)).toEqual(['free_delivery']);
    expect(r.problems[0].problem).toContain('«كوبون 500» مش من القايمة');
  });

  it('flags typed words that are not in the lists and outcomes without an answer', () => {
    const r = read(
      ['a', 1, 'x', '', 'رد كويس', '', '', '', ''],
      ['b', 2, 'y', '', 'مردش', 'تمام وراضي', '', '', ''],
      ['c', 3, 'z', '', 'رد', 'عنده شكوى', '', '', '']
    );
    expect(r.updates.map((u) => [u.id, u.outcome])).toEqual([
      ['b', null],
      ['c', 'complaint'],
    ]);
    expect(r.problems.map((p) => p.row)).toEqual([3, 4, 5]);
    expect(r.problems[0].problem).toContain('«رد كويس» مش من القايمة');
  });
});

describe('sheet helpers', () => {
  it('shortens the reasons the database writes', () => {
    expect(shortReason('بيرجع كل 14 يوم وآخر شرا من 18 يوم')).toBe('بيشتري كل 14 يوم · فاتله 18');
    expect(shortReason('مااشتراش من 106 يوم')).toBe('مااشتراش من 106 يوم');
    expect(shortReason('حاجة تانية')).toBe('حاجة تانية');
    expect(shortReason(null)).toBe('');
  });

  it('drops the branch bookkeeping tags from a customer name', () => {
    expect(cleanCustomerName('كريم محمد ش 17635 (P200 )', '17635')).toBe('كريم محمد');
    expect(cleanCustomerName('محمد يحيى ش 17886 P(150)', '17886')).toBe('محمد يحيى');
    expect(cleanCustomerName('بسنت ابو العزP250', '18671')).toBe('بسنت ابو العز');
    expect(cleanCustomerName('جودي ايمن300P', '5044')).toBe('جودي ايمن');
    expect(cleanCustomerName('د امل حسن(500p)', '3821')).toBe('د امل حسن');
    expect(cleanCustomerName('م علي النظامي %', '144')).toBe('م علي النظامي');
    expect(cleanCustomerName('المستشار راضي الشافعي شخصي ش 866', '866')).toBe('المستشار راضي الشافعي شخصي');
    expect(cleanCustomerName('منى محمد.', '19677')).toBe('منى محمد');
    expect(cleanCustomerName('احمد راغب ش.P(100)', '1200')).toBe('احمد راغب');
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
