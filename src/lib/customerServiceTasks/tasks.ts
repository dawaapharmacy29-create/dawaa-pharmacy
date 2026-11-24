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
  | 'lost'
  | 'uncoded_note';

export const SOURCE_LABELS: Record<TaskSource, string> = {
  doctor_case: 'حالة من الدكتور',
  new_customer: 'عميل جديد',
  big_invoice: 'اطمئنان بعد فاتورة',
  request: 'طلب نواقص',
  regular_due: 'منتظم ميعاده جه',
  declining: 'نشط وقلّل',
  lost: 'اختفى',
  uncoded_note: 'عميل مش متكود',
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

/**
 * The sections of the calls sheet, in calling order. Each tells the member what to do and an opening line to say.
 * A follow-up (priority 1) has its own section whatever its source; a customer with no usable phone goes last.
 */
export type SheetSectionKey = TaskSource | 'followup' | 'no_phone';
export const SHEET_SECTIONS: Array<{ key: SheetSectionKey; title: string; todo: string; say: string }> = [
  {
    key: 'followup',
    title: 'متابعات ميعادها النهارده',
    todo: 'ناس اتكلمنا معاهم قبل كده. اللي حصل المرة اللي فاتت مكتوب في «المطلوب منك».',
    say: 'أهلاً يا فندم، معاك خدمة عملاء صيدليات دواء، بنكمّل مع حضرتك على كلامنا اللي فات…',
  },
  {
    key: 'doctor_case',
    title: 'حالات طلبها الدكتور',
    todo: 'الدكتور طلب متابعة العميل ده: نفّذ المكتوب في «المطلوب منك».',
    say: 'دكتور الفرع طلب مني أطمّن على حضرتك بخصوص…',
  },
  {
    key: 'new_customer',
    title: 'عملاء جداد (أول مرة يشتروا امبارح)',
    todo: 'سجّل رقمه على تليفون الفرع بالاسم والكود، وابعتله رسالة الترحيب.',
    say: 'أهلاً بحضرتك في صيدليات دواء، ده رقم الفرع على واتساب للطلبات والتوصيل والاستشارات.',
  },
  {
    key: 'uncoded_note',
    title: 'عملاء مش متكودين (اسمهم ورقمهم في ملاحظة الفاتورة)',
    todo: 'كوّده على بي كونكت بالاسم والرقم، سجّله على تليفون الفرع، وابعتله رسالة الترحيب.',
    say: 'أهلاً بحضرتك في صيدليات دواء، سجّلنا رقم حضرتك عشان تطلب على واتساب الفرع وتوصلك العروض.',
  },
  {
    key: 'big_invoice',
    title: 'اطمئنان بعد فاتورة كبيرة امبارح',
    todo: 'اتأكد إن الطلب وصل كامل وإنه فاهم الجرعات.',
    say: 'حبينا نطمّن على حضرتك، الأدوية وصلت تمام؟ في أي استفسار عن الجرعات؟',
  },
  {
    key: 'request',
    title: 'طلبات نواقص',
    todo: 'لو الصنف اتوفر بلّغ الفرع يكلمه ويعمل الأوردر، ولو لسه طمّنه إننا بندوّر عليه.',
    say: 'بخصوص الصنف اللي حضرتك طلبته من الفرع…',
  },
  {
    key: 'regular_due',
    title: 'عملاء منتظمين ميعاد شراهم جه',
    todo: 'فكّره إن علاجه قرّب يخلص واعرض نجهزله الطلب ونوصله.',
    say: 'علاج حضرتك قرّب يخلص، تحب نجهزهولك ونبعتهولك؟',
  },
  {
    key: 'declining',
    title: 'عملاء شراهم قلّ',
    todo: 'اسأل في إيه: صنف ناقص؟ سعر؟ خدمة؟ واكتب السبب في الملاحظة.',
    say: 'بنطمّن على حضرتك، في حاجة مش عاجباك أو صنف مالقيتهوش عندنا؟',
  },
  {
    key: 'lost',
    title: 'عملاء بطّلوا يشتروا',
    todo: 'اسأل عن السبب واعرض خدمة التوصيل، واكتب السبب في الملاحظة.',
    say: 'وحشتنا يا فندم، في حاجة ضايقت حضرتك؟ نقدر نجهزلك أي طلب ونوصله لحد البيت.',
  },
  {
    key: 'no_phone',
    title: 'من غير رقم موبايل',
    todo: 'اطلب الرقم من الفرع أو دوّر عليه في قاعدة العملاء. لو مالقيتهوش اختار «رقم غلط».',
    say: '',
  },
];

/** An Egyptian mobile as the digits WhatsApp expects (20 + 10 digits), or null when it is not a mobile number. */
export function whatsappNumber(phone: string | null | undefined): string | null {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (/^01\d{9}$/.test(digits)) return `2${digits}`;
  if (/^201\d{9}$/.test(digits)) return digits;
  if (/^1\d{9}$/.test(digits)) return `20${digits}`;
  return null;
}

export function sheetSectionOf(task: { priority: string; source: string; customer_phone: string | null }): SheetSectionKey {
  if (!whatsappNumber(task.customer_phone)) return 'no_phone';
  if (task.priority === '1') return 'followup';
  return (SHEET_SECTIONS.some((s) => s.key === task.source) ? task.source : 'lost') as SheetSectionKey;
}

/**
 * The customer's name for the person calling: the branch's bookkeeping tags are dropped (points like "(P600)" or
 * "300P", the customer code repeated in the name, the branch letter «ش», "%" and trailing dots).
 */
export function cleanCustomerName(name: string, code?: string | null): string {
  let n = String(name ?? '');
  n = n.replace(
    /\(\s*[pP]\s*\d+\s*\)|\(\s*\d+\s*[pP]\s*\)|[pP]\s*\(\s*\d+\s*\)|\b[pP]\s?\d+\b|\d+\s?[pP]\b(?!\s*\()/g,
    ' '
  );
  const c = String(code ?? '').trim();
  if (/^\d+$/.test(c)) n = n.replace(new RegExp(`(^|\\D)${c}(?=\\D|$)`, 'g'), '$1 ');
  n = n.replace(/[()%]/g, ' ').replace(/(^|\s)ش(?=[\s.]|$)/g, '$1');
  n = n.replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim();
  return n || String(name ?? '').trim();
}

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

/**
 * The sheet's answers. Every cell the member fills is a dropdown, so each answer is a code the database can count:
 * how she reached the customer, whether the customer answered, what came of it, why (when it matters) and when to
 * follow up. The single «result» the follow-up dates use is derived from them in the database.
 */
type Choice = { code: string; label: string };
const choices = (pairs: Array<[string, string]>): Choice[] => pairs.map(([code, label]) => ({ code, label }));

export const CHANNEL_CHOICES = choices([
  ['call', 'مكالمة'],
  ['whatsapp', 'واتساب'],
  ['both', 'الاتنين'],
]);
export const REACH_CHOICES = choices([
  ['answered', 'رد'],
  ['no_answer', 'مردش'],
  ['busy', 'مشغول - كلمني بعدين'],
  ['phone_off', 'التليفون مقفول'],
  ['wrong_number', 'الرقم غلط'],
]);
export const OUTCOME_CHOICES = choices([
  ['satisfied', 'تمام وراضي'],
  ['will_buy', 'هيشتري أو هيعدّي على الفرع'],
  ['ordered', 'عمل أوردر واتحوّل للفرع'],
  ['wants_item', 'عاوز صنف مش موجود'],
  ['complaint', 'عنده شكوى'],
  ['not_needed', 'مش محتاج دلوقتي'],
  ['registered', 'اتسجل واتبعتله الترحيب'],
]);
export const REASON_CHOICES = choices([
  ['no_problem', 'مفيش مشكلة'],
  ['price', 'الأسعار'],
  ['item_missing', 'صنف كان ناقص'],
  ['other_pharmacy', 'بيشتري من صيدلية تانية'],
  ['delivery_late', 'التوصيل اتأخر'],
  ['service', 'المعاملة أو الخدمة'],
  ['order_error', 'غلط في الطلب'],
  ['treatment_done', 'العلاج خلص أو اتوقف'],
  ['moved_away', 'سافر أو عزّل'],
  ['personal', 'ظروف شخصية'],
]);
export const FOLLOWUP_CHOICES = choices([
  ['auto', 'السيستم يحدد'],
  ['tomorrow', 'بكرة'],
  ['two_days', 'بعد يومين'],
  ['week', 'بعد أسبوع'],
  ['two_weeks', 'بعد أسبوعين'],
  ['month', 'بعد شهر'],
  ['none', 'مفيش متابعة'],
]);
/** «العرض»: a coupon on the customer's code (the branch's monthly credit) or free delivery. */
export const OFFER_CHOICES = choices([
  ['none', 'مفيش'],
  ['c50', 'كوبون 50 ج'],
  ['c100', 'كوبون 100 ج'],
  ['c150', 'كوبون 150 ج'],
  ['c200', 'كوبون 200 ج'],
  ['free_delivery', 'توصيل مجاني'],
]);

export const choiceLabel = (list: Choice[], code: string | null | undefined) =>
  list.find((c) => c.code === code)?.label ?? null;
const choiceCode = (list: Choice[], label: string) => list.find((c) => c.label === label)?.code ?? null;

/** The column titles of the structured sheet; the upload finds each answer by its title. */
export const ANSWER_COLUMNS = {
  channel: 'اتواصلت إزاي',
  reach: 'رد؟',
  outcome: 'النتيجة',
  reason: 'السبب',
  followup: 'المتابعة الجاية',
  offer: 'العرض',
  note: 'اسم الصنف أو ملاحظة',
} as const;

export type TaskUpdate = {
  id: string;
  /** Old sheets only: one of RESULT_LABELS. */
  result?: string;
  channel?: string | null;
  reach?: string | null;
  outcome?: string | null;
  reason_code?: string | null;
  followup?: string | null;
  offer?: string | null;
  note: string;
  next_date: string | null;
};
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
  // The calls sheet opens with a title and a summary; its header is the first row with «id» and an answer column.
  const headerAt = Math.max(
    0,
    tasks.slice(0, 12).findIndex((row) => {
      const cells = (row ?? []).map(text);
      return cells.includes('id') && (cells.includes(ANSWER_COLUMNS.reach) || cells.includes('النتيجة'));
    })
  );
  const th = (tasks[headerAt] ?? []).map(text);
  const col = (name: string) => th.indexOf(name);
  const cId = col('id');
  const structured = col(ANSWER_COLUMNS.reach) >= 0;
  const flag = (i: number, problem: string) => problems.push({ sheet: 'المكالمات', row: i + 1, problem });

  if (cId < 0 || (!structured && col('النتيجة') < 0)) {
    problems.push({
      sheet: 'المكالمات',
      row: 1,
      problem: 'ده مش شيت المهام اللي اتحمل من الصفحة (عناوين الأعمدة اتغيرت)',
    });
  } else if (structured) {
    const c = {
      channel: col(ANSWER_COLUMNS.channel),
      reach: col(ANSWER_COLUMNS.reach),
      outcome: col(ANSWER_COLUMNS.outcome),
      reason: col(ANSWER_COLUMNS.reason),
      followup: col(ANSWER_COLUMNS.followup),
      offer: col(ANSWER_COLUMNS.offer),
      note: col(ANSWER_COLUMNS.note),
    };
    const cell = (row: unknown[], at: number) => (at >= 0 ? text(row?.[at]) : '');
    tasks.forEach((row, i) => {
      if (i <= headerAt) return;
      const id = cell(row, cId);
      const raw = {
        channel: cell(row, c.channel),
        reach: cell(row, c.reach),
        outcome: cell(row, c.outcome),
        reason: cell(row, c.reason),
        followup: cell(row, c.followup),
        offer: cell(row, c.offer),
      };
      if (!id || (!raw.reach && !raw.outcome)) return;
      const code = {
        channel: raw.channel ? choiceCode(CHANNEL_CHOICES, raw.channel) : null,
        reach: raw.reach ? choiceCode(REACH_CHOICES, raw.reach) : null,
        outcome: raw.outcome ? choiceCode(OUTCOME_CHOICES, raw.outcome) : null,
        reason: raw.reason ? choiceCode(REASON_CHOICES, raw.reason) : null,
        followup: raw.followup ? choiceCode(FOLLOWUP_CHOICES, raw.followup) : null,
        offer: raw.offer ? choiceCode(OFFER_CHOICES, raw.offer) : null,
      };
      const unknown = (Object.keys(code) as Array<keyof typeof code>).filter((k) => raw[k] && !code[k]);
      if (unknown.length) {
        flag(i, unknown.map((k) => `«${raw[k]}» مش من القايمة`).join('، '));
        return;
      }
      const reach = code.reach ?? 'answered';
      if (reach !== 'answered' && code.outcome) flag(i, 'النتيجة بتتسجل بس لو العميل رد؛ اتسجل «' + raw.reach + '»');
      if (code.outcome === 'complaint' && !code.reason) flag(i, 'الشكوى اتسجلت من غير سبب؛ اختار السبب المرة الجاية');
      updates.push({
        id,
        channel: code.channel,
        reach,
        outcome: reach === 'answered' ? code.outcome : null,
        reason_code: code.reason,
        followup: code.followup,
        offer: c.offer >= 0 ? code.offer : undefined,
        note: cell(row, c.note),
        next_date: null,
      });
    });
  } else {
    const [cResult, cNote, cNext] = [col('النتيجة'), col('ملاحظة'), col('المتابعة الجاية (اختياري)')];
    tasks.forEach((row, i) => {
      if (i <= headerAt) return;
      const id = text(row?.[cId]);
      const result = text(row?.[cResult]);
      if (!id || !result) return;
      if (!(RESULT_LABELS as readonly string[]).includes(result)) {
        flag(i, `النتيجة «${result}» مش من القايمة`);
        return;
      }
      const rawNext = cNext >= 0 ? row[cNext] : null;
      const next = sheetDateToIso(rawNext, today);
      if (text(rawNext) && !next) flag(i, 'تاريخ المتابعة مش مفهوم، اتساب للسيستم يحدده');
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
