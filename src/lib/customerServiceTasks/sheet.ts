import type { DailyTask } from './api';
import {
  BRANCH_OPTIONS,
  RESULT_HELP,
  RESULT_LABELS,
  SHEET_SECTIONS,
  cleanCustomerName,
  readTaskSheets,
  sheetSectionOf,
  whatsappNumber,
  type SheetSectionKey,
} from './tasks';

// The daily Excel sheet: built from the day's tasks, filled in Excel, and read back on upload.
//
// «المكالمات» reads top to bottom like a to-do list: a title with whose sheet it is, the branch and the day, a one-line
// count of the day, the four steps, then one block per kind of call in calling order. Each block opens with what to
// do and an opening line to say; each row has the name (without the branch's bookkeeping tags), a WhatsApp link and
// the three cells to fill (yellow). The first column holds the task id (hidden); the upload finds the header row by
// its «id» and «النتيجة» cells and matches results by id, so rows can be sorted freely and the block rows are skipped.

export const TASKS_SHEET = 'المكالمات';
export const CASES_SHEET = 'حالات الدكاترة';
const DOCTOR_CASE_ROWS = 60;
const HEADER_ROW = 5;

type Column = { header: string; width: number; key: string };

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

const SECTION_FILL: Record<SheetSectionKey, string> = {
  followup: 'FFD5EFEA',
  doctor_case: 'FFFDE2E2',
  new_customer: 'FFDFF3E4',
  big_invoice: 'FFE0ECFF',
  request: 'FFFFF1D6',
  regular_due: 'FFEFEFEF',
  declining: 'FFFFE9D6',
  lost: 'FFEDE4FA',
  no_phone: 'FFE5E5E5',
};
const TEAL = 'FF0F766E';
const EDIT_FILL = 'FFFFF8DC';
const GRID = { style: 'thin' as const, color: { argb: 'FFD0D7DE' } };
const BORDER = { top: GRID, left: GRID, bottom: GRID, right: GRID };
const DAYS = ['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'];

const resultsList = `"${RESULT_LABELS.join(',')}"`;

type ExcelCell = { value: unknown };

function dayTitle(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const weekday = DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday} ${d}/${m}/${y}`;
}

function localPhone(phone: string | null): string {
  const wa = whatsappNumber(phone);
  return wa ? `0${wa.slice(2)}` : (phone ?? '');
}

export async function buildTaskWorkbook(
  tasks: DailyTask[],
  day: string,
  owner: string
): Promise<Blob> {
  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'صيدليات دواء';
  wb.created = new Date();

  const branches = [...new Set(tasks.map((t) => t.branch))];
  const mixed = branches.length > 1;
  const columns: Column[] = [
    { key: 'id', header: 'id', width: 6 },
    { key: 'n', header: '#', width: 5 },
    { key: 'name', header: 'الاسم', width: 24 },
    { key: 'code', header: 'الكود', width: 9 },
    ...(mixed ? [{ key: 'branch', header: 'الفرع', width: 9 }] : []),
    { key: 'phone', header: 'الموبايل', width: 14 },
    { key: 'wa', header: 'واتساب', width: 10 },
    { key: 'todo', header: 'المطلوب منك', width: 46 },
    { key: 'last', header: 'آخر تواصل', width: 20 },
    { key: 'result', header: 'النتيجة', width: 22 },
    { key: 'note', header: 'ملاحظة', width: 30 },
    { key: 'next', header: 'المتابعة الجاية (اختياري)', width: 14 },
  ];
  const col = (key: string) => columns.findIndex((c) => c.key === key) + 1;
  const last = columns.length;

  const ws = wb.addWorksheet(TASKS_SHEET, {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: HEADER_ROW }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });
  columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width;
  });
  ws.getColumn(1).hidden = true;

  // Group the tasks into the sheet's sections, in calling order.
  const bySection = new Map<SheetSectionKey, DailyTask[]>();
  for (const t of tasks) {
    const key = sheetSectionOf(t);
    bySection.set(key, [...(bySection.get(key) ?? []), t]);
  }
  const sections = SHEET_SECTIONS.filter((s) => bySection.get(s.key)?.length);

  const banner = (row: number, text: string, opts: { size?: number; bold?: boolean; fill?: string; color?: string; height?: number }) => {
    ws.mergeCells(row, 2, row, last);
    const cell = ws.getCell(row, 2);
    cell.value = text;
    cell.font = { bold: opts.bold ?? false, size: opts.size ?? 11, color: { argb: opts.color ?? 'FF1F2937' } };
    cell.alignment = { vertical: 'middle', horizontal: 'right', wrapText: true, readingOrder: 'rtl' };
    if (opts.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill } };
    ws.getRow(row).height = opts.height ?? 20;
  };

  const branchText = mixed ? 'الفرعين' : (branches[0] ?? '');
  banner(1, `شيت مكالمات ${owner} — ${branchText} — ${dayTitle(day)}`, {
    size: 15,
    bold: true,
    fill: TEAL,
    color: 'FFFFFFFF',
    height: 28,
  });
  banner(
    2,
    `النهارده ${tasks.length} مكالمة: ` +
      sections.map((s) => `${s.title.split(' (')[0]} ${bySection.get(s.key)!.length}`).join(' · '),
    { bold: true, height: 22 }
  );
  banner(
    3,
    '١) اتصل بالعميل أو دوس «افتح» في عمود واتساب   ٢) اختار النتيجة من القايمة   ٣) اكتب ملاحظة لو في حاجة مهمة   ٤) آخر اليوم احفظ الملف وارفعه من الصفحة',
    { color: 'FF374151', height: 22 }
  );
  ws.getRow(4).height = 6;

  const header = ws.getRow(HEADER_ROW);
  columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = BORDER;
  });
  header.height = 24;

  let r = HEADER_ROW;
  let n = 0;
  sections.forEach((section, si) => {
    const rows = bySection.get(section.key)!;
    r += 1;
    const say = section.say ? `\nقول: «${section.say}»` : '';
    banner(r, `${si + 1}. ${section.title} (${rows.length}) — ${section.todo}${say}`, {
      bold: true,
      fill: SECTION_FILL[section.key],
      height: say ? 36 : 22,
    });
    for (const t of rows) {
      r += 1;
      n += 1;
      const row = ws.getRow(r);
      const wa = whatsappNumber(t.customer_phone);
      const todo = (t.reason ?? '') + (t.attempt_no > 1 ? ` (محاولة ${t.attempt_no})` : '');
      const values: Record<string, unknown> = {
        id: t.id,
        n,
        name: cleanCustomerName(t.customer_name, t.customer_code),
        code: t.customer_code ?? '',
        branch: t.branch.replace('فرع ', ''),
        phone: localPhone(t.customer_phone),
        wa: wa ? { text: 'افتح', hyperlink: `https://wa.me/${wa}` } : '',
        todo,
        last: t.last_contact ?? '',
        result: t.result_label ?? '',
        note: t.result_note ?? '',
        next: '',
      };
      columns.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        cell.value = values[c.key] as never;
        cell.border = BORDER;
        cell.alignment = { vertical: 'middle', horizontal: 'right', wrapText: c.key === 'todo' || c.key === 'note' || c.key === 'last' };
      });
      row.getCell(col('n')).alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell(col('name')).font = { bold: true };
      if (wa) row.getCell(col('wa')).font = { color: { argb: 'FF0B7A3B' }, underline: true, bold: true };
      for (const key of ['result', 'note', 'next']) {
        row.getCell(col(key)).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EDIT_FILL } };
      }
      row.getCell(col('result')).dataValidation = { type: 'list', allowBlank: true, formulae: [resultsList] };
      row.getCell(col('next')).numFmt = 'dd/mm/yyyy';
      row.height = 30;
    }
  });
  r += 2;
  banner(r, 'آخر اليوم: احفظ الملف، وافتح صفحة «شيت مهام اليوم» ودوس «ارفع الشيت بعد الشغل». الصف اللي من غير نتيجة بيفضل مفتوح لبكرة.', {
    bold: true,
    color: TEAL,
  });

  const cs = wb.addWorksheet(CASES_SHEET, {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
  });
  cs.columns = CASE_COLUMNS.map((c) => ({ header: c.header, width: c.width }));
  const csHeader = cs.getRow(1);
  csHeader.height = 22;
  csHeader.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  for (let row = 2; row <= DOCTOR_CASE_ROWS + 1; row += 1) {
    for (let c = 1; c <= CASE_COLUMNS.length; c += 1) {
      const cell = cs.getCell(row, c);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EDIT_FILL } };
      cell.border = BORDER;
    }
    cs.getCell(row, 1).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`"${BRANCH_OPTIONS.join(',')}"`],
    };
    cs.getCell(row, 7).dataValidation = { type: 'list', allowBlank: true, formulae: [resultsList] };
    cs.getCell(row, 9).numFmt = 'dd/mm/yyyy';
  }

  const help = wb.addWorksheet('اقرأني', { views: [{ rightToLeft: true }] });
  help.getColumn(1).width = 26;
  help.getColumn(2).width = 90;
  const lines: Array<[string, string]> = [
    ['شيت مهام اليوم', `${owner} · ${branchText} · ${dayTitle(day)} · ${tasks.length} مكالمة`],
    ['', ''],
    ['الترتيب', 'امشي في شيت «المكالمات» من فوق لتحت: كل جزء مكتوب فوقه المطلوب منك وجملة تبدأ بيها الكلام.'],
    ['واتساب', 'دوس «افتح» في عمود واتساب، المحادثة هتفتح على رقم العميل على طول.'],
    ['العميل الجديد', 'سجّله على تليفون الفرع باسمه + كوده، وابعتله الرسالة الترحيبية، واختار «اتسجل واتبعتت الترحيب».'],
    ['حالات الدكاترة', 'أي حالة الدكتور نزّلها على الجروب: اكتبها في شيت «حالات الدكاترة» (الفرع والكود والمطلوب لازم).'],
    ['آخر اليوم', 'اختار النتيجة لكل صف اتعمل، واحفظ الشيت، وارفعه من نفس الصفحة. الصف اللي من غير نتيجة بيفضل مفتوح.'],
    ['المتابعة الجاية', 'سيبها فاضية والسيستم يحددها لوحده. لو العميل طلب ميعاد معين اكتبه (مثلاً 25/11).'],
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
