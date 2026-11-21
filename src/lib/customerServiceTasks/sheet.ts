import type { DailyTask } from './api';
import {
  ANSWER_COLUMNS,
  BRANCH_OPTIONS,
  CHANNEL_CHOICES,
  FOLLOWUP_CHOICES,
  OFFER_CHOICES,
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
const TEAL_DARK = 'FF115E59';
const TEAL_SOFT = 'FFE6F4F1';
const GOLD = 'FFE0B437';
const GOLD_SOFT = 'FFF7DC80';
const GOLD_INK = 'FF5B4500';
const INK = 'FF1F2937';
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

// Dates and amounts sit after the words, one fact per line, so Excel's right-to-left layout keeps them in order.
function lastPurchase(t: DailyTask): string {
  if (!t.last_purchase_date) return '';
  const amount = Math.round(Number(t.last_purchase_amount ?? 0));
  const avg = Math.round(Number(t.avg_invoice ?? 0));
  const avgLine = (t.invoices_150 ?? 0) > 1 && avg ? `\nمتوسط فاتورته ${avg} ج` : '';
  return `يوم ${ddmm(t.last_purchase_date)} بـ ${amount} ج${avgLine}`;
}

function lastFollowup(t: DailyTask): string {
  if (!t.last_followup_date) return 'أول مرة نكلّمه';
  const what = t.last_contact ? `: ${t.last_contact}` : '';
  const by = t.last_followup_by ? `\nمع ${t.last_followup_by}` : '';
  return `يوم ${ddmm(t.last_followup_date)}${what}${by}`;
}

const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } });
const RTL = { readingOrder: 'rtl' as const, vertical: 'middle' as const };

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
    { key: 'why', header: 'ليه بنكلّمه', width: 28 },
    { key: 'bought', header: 'آخر شرا', width: 19 },
    { key: 'last', header: 'آخر متابعة', width: 21 },
    { key: 'channel', header: ANSWER_COLUMNS.channel, width: 13, answer: true },
    { key: 'reach', header: ANSWER_COLUMNS.reach, width: 16, answer: true },
    { key: 'outcome', header: ANSWER_COLUMNS.outcome, width: 26, answer: true },
    { key: 'reason', header: ANSWER_COLUMNS.reason, width: 20, answer: true },
    { key: 'followup', header: ANSWER_COLUMNS.followup, width: 15, answer: true },
    { key: 'offer', header: ANSWER_COLUMNS.offer, width: 15, answer: true },
    { key: 'note', header: ANSWER_COLUMNS.note, width: 26, answer: true },
  ];
  const col = (key: string) => columns.findIndex((c) => c.key === key) + 1;
  const last = columns.length;
  const firstAnswer = columns.findIndex((c) => c.answer) + 1;
  const letter = (n: number) => ws.getColumn(n).letter;

  const ws = wb.addWorksheet(TASKS_SHEET, {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: HEADER_ROW, xSplit: col('name'), zoomScale: 100 }],
    pageSetup: {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      paperSize: 9,
      horizontalCentered: true,
      printTitlesRow: `4:${HEADER_ROW}`,
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    },
    headerFooter: { oddFooter: '&C&8صفحة &P من &N' },
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

  const band = (
    row: number,
    from: number,
    to: number,
    text: string,
    opts: { size?: number; bold?: boolean; fill?: string; color?: string; align?: 'right' | 'center' }
  ) => {
    if (to > from) ws.mergeCells(row, from, row, to);
    const cell = ws.getCell(row, from);
    cell.value = text;
    cell.font = { bold: opts.bold ?? false, size: opts.size ?? 11, color: { argb: opts.color ?? INK } };
    cell.alignment = { ...RTL, horizontal: opts.align ?? 'right', wrapText: true, indent: opts.align ? 0 : 1 };
    if (opts.fill) cell.fill = fill(opts.fill);
  };

  // 1–3: title, the day in one line, four short steps. 4: which side to read and which to fill. 5: the column titles.
  const branchText = mixed ? 'الفرعين' : (branches[0] ?? '');
  band(1, 2, last, `مكالمات خدمة العملاء  ·  ${owner}  ·  ${branchText}`, {
    size: 16,
    bold: true,
    fill: TEAL,
    color: 'FFFFFFFF',
  });
  ws.getRow(1).height = 32;
  band(2, 2, last, `${dayTitle(day)}  ·  ${tasks.length} مكالمة النهارده، ابدأ من أول قسم وانزل بالترتيب`, {
    size: 12,
    bold: true,
    fill: TEAL_SOFT,
    color: TEAL_DARK,
  });
  ws.getRow(2).height = 24;
  band(
    3,
    2,
    last,
    'الخطوات:   ① كلّم العميل أو ابعتله واتساب    ② اختار «رد؟»    ③ لو رد: اختار النتيجة والسبب    ④ آخر اليوم احفظ الملف وارفعه',
    { size: 11, color: 'FF374151', fill: 'FFF8FAFC' }
  );
  ws.getRow(3).height = 22;

  band(4, 2, firstAnswer - 1, 'بيانات العميل — للقراية بس', {
    bold: true,
    fill: TEAL_DARK,
    color: 'FFFFFFFF',
    align: 'center',
  });
  band(4, firstAnswer, last, '✍  اكتب هنا — دوس على الخانة واختار من السهم ▾', {
    bold: true,
    fill: GOLD,
    color: GOLD_INK,
    align: 'center',
  });
  ws.getRow(4).height = 22;

  const header = ws.getRow(HEADER_ROW);
  columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, size: 11, color: { argb: c.answer ? GOLD_INK : 'FFFFFFFF' } };
    cell.fill = fill(c.answer ? GOLD_SOFT : TEAL);
    cell.alignment = { ...RTL, horizontal: 'center', wrapText: true };
    cell.border = BORDER;
  });
  header.height = 30;

  const lists: Record<string, string> = {
    channel: listOf(CHANNEL_CHOICES.map((c) => c.label)),
    reach: listOf(REACH_CHOICES.map((c) => c.label)),
    outcome: listOf(OUTCOME_CHOICES.map((c) => c.label)),
    reason: listOf(REASON_CHOICES.map((c) => c.label)),
    followup: listOf(FOLLOWUP_CHOICES.map((c) => c.label)),
    offer: listOf(OFFER_CHOICES.map((c) => c.label)),
  };
  const prompts: Record<string, string> = {
    channel: 'مكالمة ولا واتساب؟',
    reach: 'رد ولا لأ؟ لو مردش هيرجعلك بكرة لوحده',
    outcome: 'بس لو رد: إيه اللي حصل؟',
    reason: 'لو قلّل أو بطّل أو عنده شكوى: ليه؟',
    followup: 'سيبها فاضية إلا لو العميل طلب ميعاد',
    offer: 'كوبون أو توصيل مجاني لو العميل محتاج سبب يرجع',
    note: 'اكتب اسم الصنف أو أي حاجة مهمة',
  };

  let r = HEADER_ROW;
  let n = 0;
  const firstData = HEADER_ROW + 1;
  sections.forEach((section, si) => {
    const rows = bySection.get(section.key)!;
    r += 1;
    const title = section.title.split(' (')[0];
    band(r, 2, last, `${si + 1}.  ${title}  (${rows.length})     ←  ${SECTION_TODO[section.key]}`, {
      bold: true,
      size: 12,
      fill: SECTION_FILL[section.key],
    });
    ws.getRow(r).height = 24;
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
        wa: wa ? { text: 'افتح واتساب', hyperlink: `https://wa.me/${wa}` } : '',
        why: shortReason(t.reason) + (t.attempt_no > 1 ? `\nمحاولة رقم ${t.attempt_no}` : ''),
        bought: lastPurchase(t),
        last: lastFollowup(t),
        channel: choiceLabel(CHANNEL_CHOICES, t.contact_channel) ?? '',
        reach: choiceLabel(REACH_CHOICES, t.reach) ?? '',
        outcome: choiceLabel(OUTCOME_CHOICES, t.outcome) ?? '',
        reason: choiceLabel(REASON_CHOICES, t.reason_code) ?? '',
        followup: choiceLabel(FOLLOWUP_CHOICES, t.followup_choice) ?? '',
        offer: choiceLabel(OFFER_CHOICES, t.offer) ?? '',
        note: t.result_note ?? '',
      };
      columns.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        cell.value = values[c.key] as never;
        cell.border = BORDER;
        cell.font = { size: 11, color: { argb: c.answer ? INK : 'FF374151' } };
        cell.alignment = { ...RTL, horizontal: c.answer ? 'center' : 'right', wrapText: true };
        cell.fill = fill(c.answer ? EDIT_FILL : n % 2 ? 'FFFFFFFF' : 'FFF7F9FA');
        if (lists[c.key] || c.key === 'note')
          cell.dataValidation = {
            ...(lists[c.key]
              ? {
                  type: 'list' as const,
                  allowBlank: true,
                  formulae: [lists[c.key]],
                  showErrorMessage: true,
                  errorStyle: 'stop' as const,
                  errorTitle: 'اختار من القايمة',
                  error: 'دوس على السهم ▾ واختار من القايمة',
                }
              : { type: 'any' as const, allowBlank: true }),
            showInputMessage: true,
            promptTitle: c.header,
            prompt: prompts[c.key],
          } as never;
      });
      row.getCell(col('n')).alignment = { ...RTL, horizontal: 'center' };
      row.getCell(col('n')).font = { size: 10, color: { argb: 'FF6B7280' } };
      row.getCell(col('name')).font = { bold: true, size: 12, color: { argb: INK } };
      row.getCell(col('code')).alignment = { ...RTL, horizontal: 'center' };
      row.getCell(col('phone')).alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell(col('wa')).alignment = { ...RTL, horizontal: 'center' };
      if (wa) row.getCell(col('wa')).font = { color: { argb: 'FF0B7A3B' }, underline: true, bold: true, size: 11 };
      row.getCell(firstAnswer).border = { ...BORDER, right: { style: 'medium', color: { argb: GOLD } } };
      const lines = Math.max(
        ...['why', 'bought', 'last'].map((k) => String(values[k] ?? '').split('\n').length),
        cleanCustomerName(t.customer_name, t.customer_code).length > 22 ? 2 : 1
      );
      row.height = Math.max(32, 16 * lines + 6);
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
  band(r, 2, last, '✔  خلصت؟ احفظ الملف، وافتح صفحة «شيت مهام اليوم» ودوس «ارفع الشيت بعد الشغل». أي صف من غير «رد؟» بيرجعلك بكرة.', {
    bold: true,
    size: 12,
    fill: TEAL_SOFT,
    color: TEAL_DARK,
  });
  ws.getRow(r).height = 26;
  band(r + 1, 2, last, 'الصف بيخضر لوحده لما تختار «رد؟». متغيرش عناوين الأعمدة. الكلام اللي تبدأ بيه كل مكالمة في شيت «اقرأني».', {
    size: 10,
    color: 'FF6B7280',
  });

  const cs = wb.addWorksheet(CASES_SHEET, {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
  });
  cs.columns = CASE_COLUMNS.map((c) => ({ header: c.header, width: c.width }));
  const csHeader = cs.getRow(1);
  csHeader.height = 30;
  csHeader.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } };
    cell.alignment = { ...RTL, horizontal: 'center', wrapText: true };
    cell.border = BORDER;
  });
  for (let row = 2; row <= DOCTOR_CASE_ROWS + 1; row += 1) {
    for (let c = 1; c <= CASE_COLUMNS.length; c += 1) {
      const cell = cs.getCell(row, c);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EDIT_FILL } };
      cell.border = BORDER;
      cell.alignment = { ...RTL, horizontal: 'right', wrapText: true };
    }
    cs.getRow(row).height = 24;
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
    [
      ANSWER_COLUMNS.offer,
      'لو هتدي العميل كوبون أو توصيل مجاني. الكوبون بيتعمل على كود العميل في برنامج البيع، وصلاحيته 10 أيام، وأقصى 200 ج للعميل في الدورة. ادّيه للي محتاج سبب يرجع: بطّل، قلّل، جديد، أو عنده شكوى. المنتظم مش محتاج كوبون.',
    ],
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
    row.getCell(1).font = { bold: true, size: title ? 13 : 11, color: { argb: title ? TEAL_DARK : INK } };
    row.getCell(1).alignment = { ...RTL, horizontal: 'right', wrapText: true };
    row.getCell(2).alignment = { ...RTL, horizontal: 'right', wrapText: true };
    if (title) {
      row.getCell(1).fill = fill(TEAL_SOFT);
      row.getCell(2).fill = fill(TEAL_SOFT);
      row.height = 24;
    }
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
