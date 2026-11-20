import { describe, expect, it } from 'vitest';
import { readTaskSheets, sheetDateToIso } from '../tasks';
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
    ws.getCell(2, 11).value = 'اتسجل واتبعتت الترحيب';
    ws.getCell(2, 12).value = { richText: [{ text: 'تمام ' }, { text: 'جدا' }] };
    ws.getCell(2, 13).value = new Date(Date.UTC(2026, 10, 27));
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
