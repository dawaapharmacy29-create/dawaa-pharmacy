// Customer service daily tasks: the labels shared by the page and the Excel sheet, and the pure helpers that turn
// sheet cells into what the database expects. The next follow-up date is decided in the database
// (dawaa_cs_task_next_date_v1) unless the sheet sets one, so it is not computed here.

export type TaskSource =
  | 'new_customer'
  | 'big_invoice'
  | 'doctor_case'
  | 'request'
  | 'regular_due'
  | 'declining'
  | 'lost';

export const SOURCE_LABELS: Record<TaskSource, string> = {
  doctor_case: 'حالة من الدكتور',
  new_customer: 'عميل جديد',
  big_invoice: 'اطمئنان بعد فاتورة',
  request: 'طلب نواقص',
  regular_due: 'منتظم ميعاده جه',
  declining: 'نشط وقلّل',
  lost: 'اختفى',
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source as TaskSource] ?? source;
}

/** The results the sheet offers, in the order of its dropdown. The database maps each label to its code. */
export const RESULT_LABELS = [
  'اتسجل واتبعتت الترحيب',
  'اتكلم وتمام',
  'مردش',
  'اتبعتت رسالة',
  'هيشتري',
  'عاوز صنف',
  'اتبلغ الفرع',
  'شكوى',
  'مش محتاج',
  'رقم غلط',
] as const;
export type ResultLabel = (typeof RESULT_LABELS)[number];

export const RESULT_HELP: Record<ResultLabel, string> = {
  'اتسجل واتبعتت الترحيب':
    'للعميل الجديد: اتسجل على التليفون باسمه وكوده واتبعتله الترحيب. المتابعة بعد ٧ أيام.',
  'اتكلم وتمام':
    'التواصل تم ومفيش مشكلة. المتابعة على حسب نوعه (نشط قلّل بعد ١٤ يوم، اختفى بعد ٣٠ يوم).',
  مردش: 'بيرجع تاني بكرة، لحد ٣ محاولات.',
  'اتبعتت رسالة': 'اتبعتله رسالة واتساب. عميل جديد: المتابعة بعد ٧ أيام، غيره بعد يومين.',
  هيشتري: 'قال هيشتري: نتأكد بعد يومين.',
  'عاوز صنف': 'طلب صنف: سجّله في طلبات العملاء. المتابعة بعد يومين.',
  'اتبلغ الفرع': 'الصنف اتوفر والفرع اتبلغ يكلمه: المتابعة بعد يومين.',
  شكوى: 'العميل زعلان: بتظهر للمدير النهارده، والمتابعة بكرة.',
  'مش محتاج': 'مش عاوز تواصل دلوقتي: مفيش متابعة.',
  'رقم غلط': 'الرقم غلط: مفيش متابعة، وصحّح الرقم في السيستم لو عرفته.',
};

export const BRANCH_OPTIONS = ['شكري', 'الشامي'] as const;

/** A sheet date cell (Date, Excel serial, "25/11", "25/11/2026" or "2026-11-25") as YYYY-MM-DD, or null. */
export function sheetDateToIso(value: unknown, today: string): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 30000 && value < 80000) {
    const ms = Math.round((value - 25569) * 86_400_000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  const text = String(value)
    .trim()
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = text.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/);
  if (m) {
    const year = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : +today.slice(0, 4);
    return valid(year, +m[2], +m[1]);
  }
  return null;
}

function valid(y: number, mo: number, d: number): string | null {
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d)
    return null;
  return date.toISOString().slice(0, 10);
}

export type TaskUpdate = { id: string; result: string; note: string; next_date: string | null };
export type DoctorCase = {
  branch: string;
  customer_code: string;
  customer_name: string;
  phone: string;
  doctor: string;
  reason: string;
  result: string;
  note: string;
  next_date: string | null;
};
export type SheetProblem = { sheet: string; row: number; problem: string };

const text = (v: unknown) => (v == null ? '' : String(v).trim());

/**
 * Reads the two working sheets as cell matrices (row 1 = headers). The tasks sheet keeps the task id in its first
 * (hidden) column; a row counts only when a result was chosen. A doctor's case counts when it has a code and a reason.
 */
export function readTaskSheets(
  tasks: unknown[][],
  cases: unknown[][],
  today: string
): { updates: TaskUpdate[]; cases: DoctorCase[]; problems: SheetProblem[] } {
  const header = (rows: unknown[][]) => (rows[0] ?? []).map(text);
  const problems: SheetProblem[] = [];
  const updates: TaskUpdate[] = [];
  const th = header(tasks);
  const col = (name: string) => th.indexOf(name);
  const [cId, cResult, cNote, cNext] = [
    col('id'),
    col('النتيجة'),
    col('ملاحظة'),
    col('المتابعة الجاية (اختياري)'),
  ];
  if (cId < 0 || cResult < 0) {
    problems.push({
      sheet: 'المكالمات',
      row: 1,
      problem: 'ده مش شيت المهام اللي اتحمل من الصفحة (عناوين الأعمدة اتغيرت)',
    });
  } else {
    tasks.slice(1).forEach((row, i) => {
      const id = text(row[cId]);
      const result = text(row[cResult]);
      if (!id || !result) return;
      if (!(RESULT_LABELS as readonly string[]).includes(result)) {
        problems.push({
          sheet: 'المكالمات',
          row: i + 2,
          problem: `النتيجة «${result}» مش من القايمة`,
        });
        return;
      }
      const rawNext = cNext >= 0 ? row[cNext] : null;
      const next = sheetDateToIso(rawNext, today);
      if (text(rawNext) && !next)
        problems.push({
          sheet: 'المكالمات',
          row: i + 2,
          problem: 'تاريخ المتابعة مش مفهوم، اتساب للسيستم يحدده',
        });
      updates.push({ id, result, note: cNote >= 0 ? text(row[cNote]) : '', next_date: next });
    });
  }

  const out: DoctorCase[] = [];
  const ch = header(cases);
  const cc = (name: string) => ch.indexOf(name);
  const idx = {
    branch: cc('الفرع'),
    code: cc('كود العميل'),
    name: cc('اسم العميل'),
    phone: cc('الموبايل'),
    doctor: cc('الدكتور'),
    reason: cc('المطلوب (من الجروب)'),
    result: cc('النتيجة'),
    note: cc('ملاحظة'),
    next: cc('المتابعة الجاية (اختياري)'),
  };
  if (cases.length && idx.code >= 0) {
    cases.slice(1).forEach((row, i) => {
      const code = text(row[idx.code]);
      const reason = text(row[idx.reason]);
      if (!code && !reason) return;
      const branch = text(row[idx.branch]);
      if (!code || !reason || !(BRANCH_OPTIONS as readonly string[]).includes(branch)) {
        problems.push({
          sheet: 'حالات الدكاترة',
          row: i + 2,
          problem: 'لازم الفرع والكود والمطلوب',
        });
        return;
      }
      const result = text(row[idx.result]);
      if (result && !(RESULT_LABELS as readonly string[]).includes(result)) {
        problems.push({
          sheet: 'حالات الدكاترة',
          row: i + 2,
          problem: `النتيجة «${result}» مش من القايمة`,
        });
        return;
      }
      out.push({
        branch,
        customer_code: code,
        customer_name: text(row[idx.name]),
        phone: text(row[idx.phone]),
        doctor: text(row[idx.doctor]),
        reason,
        result,
        note: text(row[idx.note]),
        next_date: sheetDateToIso(row[idx.next], today),
      });
    });
  }
  return { updates, cases: out, problems };
}
