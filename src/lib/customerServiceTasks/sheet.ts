import type { DailyTask } from './api';
import { BRANCH_OPTIONS, RESULT_HELP, RESULT_LABELS, readTaskSheets, sourceLabel } from './tasks';

// The daily Excel sheet: built from the day's tasks, filled in Excel, and read back on upload. The first column of
// «المكالمات» holds the task id (hidden); the page matches results to tasks by it, so rows can be sorted freely.

export const TASKS_SHEET = 'المكالمات';
export const CASES_SHEET = 'حالات الدكاترة';
const DOCTOR_CASE_ROWS = 60;

const TASK_COLUMNS = [
  { header: 'id', width: 6 },
  { header: '#', width: 5 },
  { header: 'النوع', width: 18 },
  { header: 'الفرع', width: 11 },
  { header: 'الكود', width: 10 },
  { header: 'الاسم', width: 26 },
  { header: 'الموبايل', width: 15 },
  { header: 'السبب', width: 44 },
  { header: 'آخر تواصل', width: 26 },
  { header: 'المحاولة', width: 9 },
  { header: 'النتيجة', width: 22 },
  { header: 'ملاحظة', width: 34 },
  { header: 'المتابعة الجاية (اختياري)', width: 16 },
];

const CASE_COLUMNS = [
  { header: 'الفرع', width: 11 },
  { header: 'كود العميل', width: 12 },
  { header: 'اسم العميل', width: 24 },
  { header: 'الموبايل', width: 15 },
  { header: 'الدكتور', width: 16 },
  { header: 'المطلوب (من الجروب)', width: 44 },
  { header: 'النتيجة', width: 22 },
  { header: 'ملاحظة', width: 34 },
  { header: 'المتابعة الجاية (اختياري)', width: 16 },
];

const SOURCE_FILL: Record<string, string> = {
  doctor_case: 'FFFDE2E2',
  new_customer: 'FFDFF3E4',
  big_invoice: 'FFE0ECFF',
  request: 'FFFFF1D6',
  regular_due: 'FFF1F1F1',
  declining: 'FFFFE9D6',
  lost: 'FFEDE4FA',
};

const resultsList = `"${RESULT_LABELS.join(',')}"`;

type ExcelCell = { value: unknown };

export async function buildTaskWorkbook(
  tasks: DailyTask[],
  day: string,
  owner: string
): Promise<Blob> {
  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'صيدليات دواء';
  wb.created = new Date();

  const ws = wb.addWorksheet(TASKS_SHEET, {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
  });
  ws.columns = TASK_COLUMNS.map((c) => ({ header: c.header, width: c.width }));
  ws.getColumn(1).hidden = true;
  tasks.forEach((t, i) => {
    const row = ws.addRow([
      t.id,
      i + 1,
      sourceLabel(t.source),
      t.branch.replace('فرع ', ''),
      t.customer_code ?? '',
      t.customer_name,
      t.customer_phone ?? '',
      t.reason ?? '',
      t.last_contact ?? '',
      t.attempt_no > 1 ? t.attempt_no : '',
      t.result_label ?? '',
      t.result_note ?? '',
      '',
    ]);
    const fill = SOURCE_FILL[t.source];
    if (fill) row.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
  });
  styleSheet(ws, TASK_COLUMNS.length, Math.max(tasks.length + 1, 2), [11, 12, 13]);
  for (let r = 2; r <= tasks.length + 1; r += 1) {
    ws.getCell(r, 11).dataValidation = { type: 'list', allowBlank: true, formulae: [resultsList] };
    ws.getCell(r, 13).numFmt = 'dd/mm/yyyy';
    ws.getCell(r, 8).alignment = { wrapText: true, vertical: 'top' };
  }

  const cs = wb.addWorksheet(CASES_SHEET, {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
  });
  cs.columns = CASE_COLUMNS.map((c) => ({ header: c.header, width: c.width }));
  styleSheet(cs, CASE_COLUMNS.length, DOCTOR_CASE_ROWS + 1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  for (let r = 2; r <= DOCTOR_CASE_ROWS + 1; r += 1) {
    cs.getCell(r, 1).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`"${BRANCH_OPTIONS.join(',')}"`],
    };
    cs.getCell(r, 7).dataValidation = { type: 'list', allowBlank: true, formulae: [resultsList] };
    cs.getCell(r, 9).numFmt = 'dd/mm/yyyy';
  }

  const help = wb.addWorksheet('اقرأني', { views: [{ rightToLeft: true }] });
  help.getColumn(1).width = 26;
  help.getColumn(2).width = 90;
  const lines: Array<[string, string]> = [
    ['شيت مهام اليوم', `${owner} · ${day} · ${tasks.length} مهمة`],
    ['', ''],
    [
      'الترتيب',
      'ابدأ من فوق: حالات الدكاترة والمتابعات المستحقة، بعدين العملاء الجداد، بعدين الاطمئنان بعد الفواتير، بعدين النواقص، بعدين الباقي.',
    ],
    [
      'العميل الجديد',
      'سجّله على التليفون باسمه + كوده، وابعتله الرسالة الترحيبية، واختار «اتسجل واتبعتت الترحيب».',
    ],
    [
      'حالات الدكاترة',
      'أي حالة الدكتور نزّلها على الجروب: اكتبها في شيت «حالات الدكاترة» (الفرع والكود والمطلوب لازم).',
    ],
    [
      'آخر اليوم',
      'اختار النتيجة لكل صف اتعمل، واحفظ الشيت، وارفعه من نفس الصفحة. الصف اللي من غير نتيجة بيفضل مفتوح.',
    ],
    [
      'المتابعة الجاية',
      'سيبها فاضية والسيستم يحددها لوحده. لو العميل طلب ميعاد معين اكتبه (مثلاً 25/11).',
    ],
    ['تحذير', 'متغيرش عناوين الأعمدة ومتمسحش العمود المخفي، عشان الرفع يعرف كل صف.'],
    ['', ''],
    ['النتايج', ''],
    ...RESULT_LABELS.map((label) => [label, RESULT_HELP[label]] as [string, string]),
  ];
  lines.forEach(([a, b]) => {
    const row = help.addRow([a, b]);
    row.getCell(1).font = { bold: true };
    row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
  });
  help.getRow(1).font = { bold: true, size: 14 };

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function styleSheet(
  ws: import('exceljs').Worksheet,
  cols: number,
  rows: number,
  editable: number[]
) {
  const header = ws.getRow(1);
  header.height = 22;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  for (let r = 2; r <= rows; r += 1) {
    for (const c of editable) {
      ws.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFBEA' } };
    }
  }
  ws.autoFilter = { from: { row: 1, column: 2 }, to: { row: 1, column: cols } };
}

/** A cell as a plain value: rich text joined, formulas reduced to their result, hyperlinks to their text. */
export function plainCellValue(value: unknown): unknown {
  if (value == null) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    const v = value as { richText?: Array<{ text: string }>; result?: unknown; text?: unknown };
    if (Array.isArray(v.richText)) return v.richText.map((p) => p.text).join('');
    if ('result' in v) return plainCellValue(v.result);
    if ('text' in v) return plainCellValue(v.text);
    return null;
  }
  return value;
}

function matrix(ws: import('exceljs').Worksheet | undefined): unknown[][] {
  if (!ws) return [];
  const rows: unknown[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    const values: unknown[] = [];
    row.eachCell({ includeEmpty: true }, (cell: ExcelCell, c: number) => {
      values[c - 1] = plainCellValue(cell.value);
    });
    rows[n - 1] = values;
  });
  return Array.from(rows, (r) => r ?? []);
}

export async function readTaskWorkbook(file: ArrayBuffer, today: string) {
  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file);
  return readTaskSheets(
    matrix(wb.getWorksheet(TASKS_SHEET)),
    matrix(wb.getWorksheet(CASES_SHEET)),
    today
  );
}
