import type { DailyTask } from './api';
import {
  ANSWER_COLUMNS,
  BRANCH_OPTIONS,
  CHANNEL_CHOICES,
  FOLLOWUP_CHOICES,
  OUTCOME_CHOICES,
  REACH_CHOICES,
  REASON_CHOICES,
  RESULT_HELP,
  RESULT_LABELS,
  SHEET_SECTIONS,
  choiceLabel,
  cleanCustomerName,
  readTaskSheets,
  sheetSectionOf,
  whatsappNumber,
  type SheetSectionKey,
} from './tasks';

// The daily Excel sheet: built from the day's tasks, filled in Excel, and read back on upload.
//
// «المكالمات» is a to-do list with as few words as possible: a title, the day's count, one line of instructions, then
// one block per kind of call in calling order. Each row shows who to call and why (short), the last purchase and the
// last follow-up, then the answers — every answer is a dropdown (how she reached the customer, did they answer, what
// came of it, why, when to follow up) so the upload stores codes that can be counted and compared. Only «اسم الصنف أو
// ملاحظة» is free text. A row turns green once «رد؟» is chosen. The first column holds the task id (hidden); the upload
// finds the header by its titles and matches answers by id, so rows can be sorted freely and block rows are skipped.

export const TASKS_SHEET = 'المكالمات';
export const CASES_SHEET = 'حالات الدكاترة';
const DOCTOR_CASE_ROWS = 60;
const HEADER_ROW = 5;

type Column = { header: string; width: number; key: string; answer?: boolean };

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

/** One short line per block: what the call is for. The opening lines to say are in «اقرأني». */
const SECTION_TODO: Record<SheetSectionKey, string> = {
  followup: 'كمّل على المتابعة اللي فاتت',
  doctor_case: 'نفّذ اللي الدكتور طلبه',
  new_customer: 'سجّله على تليفون الفرع وابعت الترحيب',
  big_invoice: 'اطمّن إن الطلب وصل وفاهم الجرعات',
  request: 'بلّغه بحالة الصنف اللي طلبه',
  regular_due: 'فكّره إن علاجه قرّب يخلص',
  declining: 'اسأله ليه قلّل واختار السبب',
  lost: 'اسأله ليه بطّل واختار السبب',
  no_phone: 'اطلب الرقم من الفرع',
};

const TEAL = 'FF0F766E';
const EDIT_FILL = 'FFFFF8DC';
const DONE_FILL = 'FFE3F5E8';
const GRID = { style: 'thin' as const, color: { argb: 'FFD0D7DE' } };
const BORDER = { top: GRID, left: GRID, bottom: GRID, right: GRID };
const DAYS = ['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'];

const listOf = (labels: readonly string[]) => `"${labels.join(',')}"`;
const resultsList = listOf(RESULT_LABELS);

type ExcelCell = { value: unknown };

function dayTitle(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const weekday = DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday} ${d}/${m}/${y}`;
}

const ddmm = (iso: string | null | undefined) => {
  if (!iso) return '';
  const [, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d}/${m}`;
};

function localPhone(phone: string | null): string {
  const wa = whatsappNumber(phone);
  return wa ? `0${wa.slice(2)}` : (phone ?? '');
}

/** The reason the database wrote, in a few words. Unknown wording is kept as is. */
export function shortReason(reason: string | null | undefined): string {
  const r = String(reason ?? '').trim();
  let m = r.match(/^أول شرا امبارح بـ (\d+) ج/);
  if (m) return `أول شرا امبارح · ${m[1]} ج`;
  m = r.match(/^اشترى امبارح بـ (\d+) ج/);
  if (m) return `فاتورة امبارح · ${m[1]} ج`;
  m = r.match(/^بيرجع كل (\d+) يوم وآخر شرا من (\d+) يوم/);
  if (m) return `بيشتري كل ${m[1]} يوم · فاتله ${m[2]}`;
  m = r.match(/^صرف آخر ٣٠ يوم (\d+) ج مقابل (\d+) ج/);
  if (m) return `الشهر ده ${m[1]} ج بدل ${m[2]} ج`;
  m = r.match(/^مااشتراش من (\d+) يوم/);
  if (m) return `مااشتراش من ${m[1]} يوم`;
  m = r.match(/^الصنف اتوفر: .*? — (.*)$/);
  if (m) return `الصنف اتوفر: ${m[1]}`;
  m = r.match(/^طلب مفتوح من (\S+): .*? — (.*)$/);
  if (m) return `طلب ${m[2]} من ${m[1]}`;
  m = r.match(/^متابعة: (.*)$/);
  if (m) return `المرة اللي فاتت: ${m[1]}`;
  return r;
}

function lastPurchase(t: DailyTask): string {
  if (!t.last_purchase_date) return '';
  const amount = Math.round(Number(t.last_purchase_amount ?? 0));
  const avg = Math.round(Number(t.avg_invoice ?? 0));
  const avgText = (t.invoices_150 ?? 0) > 1 && avg ? ` (متوسط ${avg})` : '';
  return `${ddmm(t.last_purchase_date)} · ${amount} ج${avgText}`;
}

function lastFollowup(t: DailyTask): string {
  if (!t.last_followup_date) return 'أول مرة';
  return [ddmm(t.last_followup_date), t.last_contact, t.last_followup_by].filter(Boolean).join(' · ');
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
    { key: 'n', header: '#', width: 4 },
    { key: 'name', header: 'الاسم', width: 22 },
    { key: 'code', header: 'الكود', width: 8 },
    ...(mixed ? [{ key: 'branch', header: 'الفرع', width: 8 }] : []),
    { key: 'phone', header: 'الموبايل', width: 13 },
    { key: 'wa', header: 'واتساب', width: 8 },
    { key: 'why', header: 'ليه بنكلّمه', width: 26 },
    { key: 'bought', header: 'آخر شرا', width: 20 },
    { key: 'last', header: 'آخر متابعة', width: 22 },
    { key: 'channel', header: ANSWER_COLUMNS.channel, width: 11, answer: true },
    { key: 'reach', header: ANSWER_COLUMNS.reach, width: 15, answer: true },
    { key: 'outcome', header: ANSWER_COLUMNS.outcome, width: 24, answer: true },
    { key: 'reason', header: ANSWER_COLUMNS.reason, width: 19, answer: true },
    { key: 'followup', header: ANSWER_COLUMNS.followup, width: 13, answer: true },
    { key: 'note', header: ANSWER_COLUMNS.note, width: 22, answer: true },
  ];
  const col = (key: string) => columns.findIndex((c) => c.key === key) + 1;
  const last = columns.length;
  const letter = (n: number) => ws.getColumn(n).letter;

  const ws = wb.addWorksheet(TASKS_SHEET, {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: HEADER_ROW, xSplit: col('name') }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });
  columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width;
  });
  ws.getColumn(1).hidden = true;

  const bySection = new Map<SheetSectionKey, DailyTask[]>();
  for (const t of tasks) {
    const key = sheetSectionOf(t);
    bySection.set(key, [...(bySection.get(key) ?? []), t]);
  }
  const sections = SHEET_SECTIONS.filter((s) => bySection.get(s.key)?.length);

  const banner = (
    row: number,
    text: string,
    opts: { size?: number; bold?: boolean; fill?: string; color?: string; height?: number }
  ) => {
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
    { bold: true }
  );
  banner(
    3,
    'املا الخانات الصفرا من السهم ▾ بس: اتواصلت إزاي ← رد؟ ← النتيجة (لو رد) ← السبب. الصف بيخضر لما تختار «رد؟». آخر اليوم احفظ وارفع الشيت.',
    { color: 'FF374151' }
  );
  ws.getRow(4).height = 6;

  const header = ws.getRow(HEADER_ROW);
  columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: c.answer ? 'FF5B4500' : 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.answer ? 'FFF5D76E' : TEAL } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = BORDER;
  });
  header.height = 26;

  const lists: Record<string, string> = {
    channel: listOf(CHANNEL_CHOICES.map((c) => c.label)),
    reach: listOf(REACH_CHOICES.map((c) => c.label)),
    outcome: listOf(OUTCOME_CHOICES.map((c) => c.label)),
    reason: listOf(REASON_CHOICES.map((c) => c.label)),
    followup: listOf(FOLLOWUP_CHOICES.map((c) => c.label)),
  };

  let r = HEADER_ROW;
  let n = 0;
  const firstData = HEADER_ROW + 1;
  sections.forEach((section, si) => {
    const rows = bySection.get(section.key)!;
    r += 1;
    banner(r, `${si + 1}. ${section.title.split(' (')[0]} (${rows.length}) — ${SECTION_TODO[section.key]}`, {
      bold: true,
      fill: SECTION_FILL[section.key],
    });
    for (const t of rows) {
      r += 1;
      n += 1;
      const row = ws.getRow(r);
      const wa = whatsappNumber(t.customer_phone);
      const values: Record<string, unknown> = {
        id: t.id,
        n,
        name: cleanCustomerName(t.customer_name, t.customer_code),
        code: t.customer_code ?? '',
        branch: t.branch.replace('فرع ', ''),
        phone: localPhone(t.customer_phone),
        wa: wa ? { text: 'افتح', hyperlink: `https://wa.me/${wa}` } : '',
        why: shortReason(t.reason) + (t.attempt_no > 1 ? ` (محاولة ${t.attempt_no})` : ''),
        bought: lastPurchase(t),
        last: lastFollowup(t),
        channel: choiceLabel(CHANNEL_CHOICES, t.contact_channel) ?? '',
        reach: choiceLabel(REACH_CHOICES, t.reach) ?? '',
        outcome: choiceLabel(OUTCOME_CHOICES, t.outcome) ?? '',
        reason: choiceLabel(REASON_CHOICES, t.reason_code) ?? '',
        followup: choiceLabel(FOLLOWUP_CHOICES, t.followup_choice) ?? '',
        note: t.result_note ?? '',
      };
      columns.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        cell.value = values[c.key] as never;
        cell.border = BORDER;
        cell.alignment = { vertical: 'middle', horizontal: 'right', wrapText: ['why', 'last', 'note'].includes(c.key) };
        if (c.answer) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EDIT_FILL } };
        if (lists[c.key])
          cell.dataValidation = {
            type: 'list',
            allowBlank: true,
            formulae: [lists[c.key]],
            showErrorMessage: true,
            errorStyle: 'stop',
            errorTitle: 'اختار من القايمة',
            error: 'دوس على السهم ▾ واختار من القايمة',
          };
      });
      row.getCell(col('n')).alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell(col('name')).font = { bold: true };
      if (wa) row.getCell(col('wa')).font = { color: { argb: 'FF0B7A3B' }, underline: true, bold: true };
      row.height = 30;
    }
  });
  const lastData = r;
  if (lastData >= firstData) {
    const reachCol = letter(col('reach'));
    ws.addConditionalFormatting({
      ref: `${letter(2)}${firstData}:${letter(last)}${lastData}`,
      rules: [
        {
          type: 'expression',
          priority: 1,
          formulae: [`$${reachCol}${firstData}<>""`],
          style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: DONE_FILL } } },
        },
      ],
    });
  }
  r += 2;
  banner(r, 'آخر اليوم: احفظ الملف، وافتح صفحة «شيت مهام اليوم» ودوس «ارفع الشيت بعد الشغل». الصف اللي من غير «رد؟» بيفضل مفتوح لبكرة.', {
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
    cs.getCell(row, 1).dataValidation = { type: 'list', allowBlank: true, formulae: [listOf(BRANCH_OPTIONS)] };
    cs.getCell(row, 7).dataValidation = { type: 'list', allowBlank: true, formulae: [resultsList] };
    cs.getCell(row, 9).numFmt = 'dd/mm/yyyy';
  }

  const help = wb.addWorksheet('اقرأني', { views: [{ rightToLeft: true }] });
  help.getColumn(1).width = 28;
  help.getColumn(2).width = 95;
  const lines: Array<[string, string, boolean?]> = [
    ['شيت مهام اليوم', `${owner} · ${branchText} · ${dayTitle(day)} · ${tasks.length} مكالمة`, true],
    ['', ''],
    ['إزاي تملا الصف', 'اختار من السهم ▾ في الخانات الصفرا بس، بالترتيب:', true],
    [ANSWER_COLUMNS.channel, 'كلمته مكالمة ولا واتساب ولا الاتنين.'],
    [ANSWER_COLUMNS.reach, 'رد ولا لأ. لو مردش أو مشغول أو مقفول السيستم يرجّعه بكرة لوحده (لحد ٣ مرات).'],
    [ANSWER_COLUMNS.outcome, 'بس لو رد: إيه اللي حصل في المكالمة.'],
    [ANSWER_COLUMNS.reason, 'لو قلّل أو بطّل أو عنده شكوى أو مش محتاج: ليه. ولو مفيش مشكلة اختار «مفيش مشكلة».'],
    [ANSWER_COLUMNS.followup, 'سيبها فاضية أو «السيستم يحدد»، إلا لو العميل طلب ميعاد معين.'],
    [ANSWER_COLUMNS.note, 'الخانة الوحيدة اللي بتكتب فيها: اسم الصنف اللي طلبه أو حاجة مهمة في سطر.'],
    ['', ''],
    ['تبدأ الكلام إزاي', '', true],
    ...SHEET_SECTIONS.filter((s) => s.say).map((s) => [s.title, `«${s.say}»`] as [string, string]),
    ['', ''],
    ['حالات الدكاترة', 'أي حالة الدكتور نزّلها على الجروب: اكتبها في شيت «حالات الدكاترة» (الفرع والكود والمطلوب لازم).'],
    ['تحذير', 'متغيرش عناوين الأعمدة ومتمسحش العمود المخفي، عشان الرفع يعرف كل صف.'],
    ['', ''],
    ['نتايج حالات الدكاترة', '', true],
    ...RESULT_LABELS.map((label) => [label, RESULT_HELP[label]] as [string, string]),
  ];
  lines.forEach(([a, b, title]) => {
    const row = help.addRow([a, b]);
    row.getCell(1).font = { bold: true, size: title ? 13 : 11 };
    row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
  });

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
