import { searchCatalog, type CatalogIndex } from './productSearch';

// فهم رسالة جروب المتابعات (صاحب الصيدلية 2026-11-25): الدكتور بيكتب سطر زي «بنتها تعبانة نتطمن عليها 10240 د دنيا»
// أو «كانت طلبت تسعير اوجمنتين نكلمها بعد يومين». من الرسالة بنطلّع: نوع المتابعة، المطلوب من البنت تعمله بالظبط،
// المريض لو حد من أهل العميل، الأصناف، وميعاد المتابعة لو الدكتور حدده، وبنشيل الكود والرقم والتوقيع من الكلام.
// كله بيحصل في الصفحة من غير سيرفر، والبنت بتشوفه وتعدّله قبل ما يتسجل.

export type FollowupKind =
  | 'health'
  | 'treatment'
  | 'refill'
  | 'price'
  | 'shortage'
  | 'complaint'
  | 'win_back'
  | 'congrats'
  | 'register'
  | 'general';

export const FOLLOWUP_KINDS: Record<FollowupKind, string> = {
  health: 'نطمّن على الصحة',
  treatment: 'متابعة علاج',
  refill: 'تجديد علاج شهري',
  price: 'سأل على سعر وماشتراش',
  shortage: 'صنف ناقص',
  complaint: 'شكوى أو مشكلة',
  win_back: 'نرجّعه',
  congrats: 'تهنئة',
  register: 'تسجيل وتكويد',
  general: 'متابعة عامة',
};

export type FollowupUnderstanding = {
  kind: FollowupKind;
  /** The other kinds the message also mentions. */
  also: FollowupKind[];
  /** What to do on the call, in one sentence for the team. */
  action: string;
  /** The patient when it is someone of the customer's family ("بنتها"). */
  patient: string | null;
  female: boolean;
  items: string[];
  /** When the doctor asked for the follow-up, YYYY-MM-DD; null = as soon as possible. */
  dueDate: string | null;
  dueLabel: string | null;
  /** The doctor's words without the customer's code, number or the signature. */
  note: string;
  urgent: boolean;
};

const norm = (s: string) =>
  s
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

// كلمات كل نوع بعد التطبيع (ة/ه زي بعض). الترتيب مهم لما يتساووا: الأخص الأول.
// كل كلمة لازم تبقى أول الكلمة في الرسالة (ممكن قبلها و/ف/ب/ال)، عشان «برد» ماتلقطش «بردو».
const words = (...alts: string[]) =>
  new RegExp(`(?:^|\\s)(?:و|ف|ب|ال|وال|بال|لل)?(?:${alts.join('|')})`);
const KIND_WORDS: Array<[FollowupKind, RegExp]> = [
  [
    'complaint',
    words(
      'زعلان',
      'شكو[يى]',
      'اشتك',
      'مشكل',
      'مضايق',
      'اتضايق',
      'متضايق',
      'اتاخر',
      'غلط',
      'مرتجع',
      'يرجع الصنف',
      'خناق'
    ),
  ],
  [
    'shortage',
    words(
      'ناقص',
      'نواقص',
      'مش موجود',
      'مكانش موجود',
      'مش متوفر',
      'هنوفر',
      'نوفر',
      'اتوفر',
      'يتوفر',
      'لما يجي',
      'نجيبل',
      'طلبي[هة]',
      'اوردر'
    ),
  ],
  [
    'price',
    words(
      'تسعير',
      'سعر',
      'بكام',
      'غالي',
      'ماشتراش',
      'مشتراش',
      'ماشترتش',
      'ماخدش',
      'مخدش',
      'متردد',
      'هيفكر',
      'هتفكر'
    ),
  ],
  [
    'refill',
    words(
      'شهري',
      'كل شهر',
      'مزمن',
      'ريفيل',
      'refill',
      'هيخلص',
      'هتخلص',
      'قرب يخلص',
      'خلص العلاج',
      'خلصت العلاج',
      'ميعاد العلاج',
      'علاج الضغط',
      'علاج السكر',
      'انسولين',
      'insulin'
    ),
  ],
  [
    'treatment',
    words(
      'كورس',
      'جرع',
      'مضاد',
      'بيكمل',
      'تكمل',
      'يكمل',
      'علاج',
      'دوا',
      'بياخد',
      'بتاخد',
      'استخدام',
      'بيستخدم',
      'بتستخدم',
      'حقن',
      'ابر[هة]',
      'ريجيم'
    ),
  ],
  [
    'health',
    words(
      'تعبان',
      'عيان',
      'مريض',
      'حرار[هة]',
      'سخون',
      'برد(?!و)',
      'كح[هة]',
      'اسهال',
      'ترجيع',
      'وجع',
      'بيوجع',
      'عملي[هة]',
      'ولاد[هة]',
      'حامل',
      'نتطمن',
      'نطمن',
      'نطمئن',
      'اطمن',
      'اتحسن',
      'صحت'
    ),
  ],
  ['congrats', words('نبارك', 'مبروك', 'عيد ميلاد', 'مولود', 'خطوب[هة]', 'فرح(?!ان)', 'نجح')],
  [
    'register',
    words(
      'نكود',
      'نسجل',
      'يتكود',
      'يتسجل',
      'كود جديد',
      'مش متكود',
      'مالوش كود',
      'ملوش كود',
      'بيانات'
    ),
  ],
  [
    'win_back',
    words(
      'نكسب',
      'نرجّع',
      'نرجعه',
      'نرجعها',
      'بطل(?!ب)',
      'مبقاش',
      'مبقتش',
      'بقاله',
      'بقالها',
      'عميل قديم',
      'عميل[هة] قديم[هة]',
      'مختفي',
      'اختفى',
      'راح صيدلي'
    ),
  ],
];

const RELATIVES =
  /(?:^|\s)((?:بنت|ابن|جوز|زوج|مرات|ام|اب|مام|باب|والد|والدة|والده|اخت|اخو|ست|جد|جدة|جده|حما|حمات|طفل|طفله|بيبي|البيبي)(?:ها|ه|هم|تها|ته|تو)?)(?=\s|$)/;
const FEMALE =
  /(?:^|\s)(?:عليها|معاها|ليها|لها|بنتها|ابنها|جوزها|مامتها|باباها|اختها|اخوها|هي|كانت|طلبت|اشترت|بتاخد|تعبانه|زعلانه|مدام|الست|العميله|عميله|حامل|ولادتها|خدت|جت|سألت)(?=\s|$)/;
const URGENT = /ضروري|حالا|دلوقتي|فورا|مستعجل|بسرعه|بسرعة|مهم جدا|النهارده ضروري|urgent/;

const DAYS: Record<string, number> = {
  الاحد: 0,
  الحد: 0,
  الاتنين: 1,
  الاثنين: 1,
  التلات: 2,
  الثلاثاء: 2,
  التلاتاء: 2,
  الاربع: 3,
  الاربعاء: 3,
  الخميس: 4,
  الجمعه: 5,
  الجمعة: 5,
  السبت: 6,
};
const NUMBER_WORDS: Record<string, number> = {
  يوم: 1,
  يومين: 2,
  اسبوع: 7,
  اسبوعين: 14,
  شهر: 30,
  تلات: 3,
  تلاته: 3,
  ثلاثه: 3,
  اربع: 4,
  اربعه: 4,
  خمس: 5,
  خمسه: 5,
  ست: 6,
  سته: 6,
  عشر: 10,
  عشره: 10,
};

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The follow-up date the doctor asked for, counted from the day of the message. */
export function followupDue(text: string, sentDay: string): { date: string; label: string } | null {
  const t = norm(text);
  if (/بعد بكر[هة]/.test(t)) return { date: addDays(sentDay, 2), label: 'بعد بكرة' };
  if (/بكر[هة]|الصبح بدري/.test(t)) return { date: addDays(sentDay, 1), label: 'بكرة' };
  let m = t.match(/بعد\s+(\d{1,2})\s*(يوم|ايام|اسبوع|اسابيع|شهر)/);
  if (m) {
    const n = Number(m[1]) * (m[2].startsWith('اسب') ? 7 : m[2] === 'شهر' ? 30 : 1);
    return { date: addDays(sentDay, n), label: `بعد ${m[1]} ${m[2]}` };
  }
  m = t.match(
    /بعد\s+(يومين|يوم|اسبوعين|اسبوع|شهر|تلات|تلاته|ثلاثه|اربع|اربعه|خمس|خمسه|ست|سته|عشر|عشره)(?:\s+(ايام|يوم))?/
  );
  if (m)
    return {
      date: addDays(sentDay, NUMBER_WORDS[m[1]]),
      label: `بعد ${m[1]}${m[2] ? ` ${m[2]}` : ''}`,
    };
  if (/اخر الاسبوع/.test(t)) {
    const dow = new Date(`${sentDay}T12:00:00Z`).getUTCDay();
    return { date: addDays(sentDay, (4 - dow + 7) % 7 || 7), label: 'آخر الأسبوع' };
  }
  if (/الشهر الجاي|اول الشهر/.test(t)) return { date: addDays(sentDay, 30), label: 'الشهر الجاي' };
  m = t.match(
    /(?:يوم|اليوم)\s+(الاحد|الحد|الاتنين|الاثنين|التلات|الثلاثاء|الاربع|الاربعاء|الخميس|الجمعه|الجمعة|السبت)/
  );
  if (m) {
    const dow = new Date(`${sentDay}T12:00:00Z`).getUTCDay();
    return { date: addDays(sentDay, (DAYS[m[1]] - dow + 7) % 7 || 7), label: `يوم ${m[1]}` };
  }
  m = t.match(/(?:يوم|في|ميعاد)\s+(\d{1,2})\s*[/\-.]\s*(\d{1,2})(?!\d)/);
  if (m) {
    const [y] = sentDay.split('-').map(Number);
    const mm = Number(m[2]);
    const dd = Number(m[1]);
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      let date = `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
      if (date < sentDay) date = `${y + 1}${date.slice(4)}`;
      return { date, label: `يوم ${dd}/${mm}` };
    }
  }
  return null;
}

/** The doctor's words, without the customer's code or number, the doctor signing it, or the group's labels. */
export function cleanNote(body: string): string {
  return body
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/(?:\+?2)?0?1[0125][\d\s-]{8,11}\d/g, ' ')
    .replace(/[٠-٩\d]{3,7}/g, (m) => (/^\d{1,2}$/.test(m) ? m : ' '))
    .replace(/(?:^|\s)(?:د|دكتور[هة]?|dr)\s*[/.]?\s*[؀-ۿ]+(?:\s+[؀-ۿ]+)?\s*$/i, ' ')
    .replace(/(?:^|\s)(?:كود|رقم|الكود|الرقم|تليفون|موبايل)\s*[:：]?\s*(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const LATIN_STOP =
  /^(?:dr|the|and|for|tab|tabs|cap|caps|mg|ml|gm|syp|amp|vial|cream|gel|plus|extra|ok|follow|up)$/i;
const AR_STOP = new Set(
  'نتابع متابعه متابعة نتطمن نطمن عليها عليه معاها معاه العميل العميله عميل عميله الدكتور كانت كان طلبت طلب عايز عايزه محتاج محتاجه بعد بكره بكرة يوم النهارده امبارح علشان عشان ازاي هيا هيه ممكن لازم نكلم نكلمها نكلمه كلموها كلموه تعبانه تعبان بنتها ابنها جوزها الصنف الدوا العلاج'.split(
    ' '
  )
);

/** Product names in the message: Latin words, and Arabic words that are the spelling of a catalog name. */
export function mentionedItems(text: string, catalog?: CatalogIndex | null): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (name: string) => {
    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(name);
    }
  };
  const latin =
    text.match(
      /[A-Za-z][A-Za-z0-9.+\-]*(?:\s+(?:\d+(?:\.\d+)?\s*(?:mg|ml|gm|g|mcg)?|[A-Za-z][A-Za-z0-9.+\-]*))*/g
    ) ?? [];
  for (const phrase of latin) {
    const words = phrase.split(/\s+/).filter((w) => !LATIN_STOP.test(w));
    if (words.join('').replace(/[^A-Za-z]/g, '').length >= 3) push(words.join(' '));
  }
  if (catalog?.length) {
    for (const raw of norm(text).split(/[\s،,.!?؟:()]+/)) {
      const w = raw.replace(/^(?:وال|بال|لل|ال|و|ب)(?=[؀-ۿ]{4,})/, '');
      if (w.length < 4 || !/^[؀-ۿ]+$/.test(w) || AR_STOP.has(w) || AR_STOP.has(raw)) continue;
      if (KIND_WORDS.some(([, re]) => re.test(w)) || RELATIVES.test(` ${w} `)) continue;
      const hit = searchCatalog(catalog, w, 1)[0];
      // بس لو الكلمة هي اسم الصنف فعلاً (أول كلمة في اسمه)، مش أي حروف متشابهة.
      if (hit && hit.sold > 0 && firstWordMatches(hit.name, w))
        push(hit.name.split(/\s+/).slice(0, 2).join(' '));
    }
  }
  return out.slice(0, 6);
}

function firstWordMatches(name: string, arabicWord: string): boolean {
  const first = name.split(/[\s\d]+/).find((x) => x.length >= 3) ?? '';
  const sk = (s: string) =>
    s
      .toLowerCase()
      .replace(/ph/g, 'f')
      .replace(/[aeiouy]/g, '')
      .replace(/(.)\1+/g, '$1');
  const AR: Record<string, string> = {
    ب: 'b',
    ت: 't',
    ث: 's',
    ج: 'g',
    ح: 'h',
    خ: 'k',
    د: 'd',
    ذ: 'z',
    ر: 'r',
    ز: 'z',
    س: 's',
    ش: 's',
    ص: 's',
    ض: 'd',
    ط: 't',
    ظ: 'z',
    غ: 'g',
    ف: 'f',
    ق: 'k',
    ك: 'k',
    ل: 'l',
    م: 'm',
    ن: 'n',
    ه: 'h',
    و: '',
    ي: '',
    ا: '',
    ع: '',
    ة: '',
    ء: '',
    ئ: '',
    ؤ: '',
  };
  const fromAr = [...arabicWord]
    .map((c) => AR[c] ?? '')
    .join('')
    .replace(/(.)\1+/g, '$1');
  const latin = sk(first)
    .replace(/[^a-z]/g, '')
    .replace(/c/g, 'k')
    .replace(/q/g, 'k')
    .replace(/x/g, 'ks')
    .replace(/j/g, 'g')
    .replace(/v/g, 'f')
    .replace(/p/g, 'b')
    .replace(/z/g, 's')
    .replace(/w/g, '');
  return fromAr.replace(/z/g, 's').length >= 3 && latin === fromAr.replace(/z/g, 's');
}

function actionFor(
  kind: FollowupKind,
  f: boolean,
  patient: string | null,
  items: string[]
): string {
  const him = f ? 'ها' : 'ه';
  const to = f ? 'لها' : 'له';
  const who = patient ? `على ${patient}` : f ? 'عليها' : 'عليه';
  const what = items.length ? ` (${items.join('، ')})` : '';
  switch (kind) {
    case 'health':
      return `اطمّني ${who} واسألي عن الأخبار ولو محتاجين أي حاجة`;
    case 'treatment':
      return `اتأكدي إن${him} ماشي${f ? 'ة' : ''} على العلاج${what} صح و${f ? 'بتاخده' : 'بياخده'} في مواعيده، واسألي لو محتاج${f ? 'ة' : ''} يكمّل الكورس`;
    case 'refill':
      return `فكّري${him} إن العلاج${what} قرّب يخلص واعرضي نجهّز${to} التجديد`;
    case 'price':
      return `كلّمي${him} عن التسعير${what} اللي سأل${f ? 'ت' : ''} عليه واعرضي نجهّز${to} الطلب، ولو السعر هو المشكلة شوفي البديل أو الكريديت`;
    case 'shortage':
      return `بلّغي${him} بالصنف${what} أول ما يتوفر، أو اعرضي البديل`;
    case 'complaint':
      return `اسمعي المشكلة من${him} واعتذري وحلّيها، وبلّغي مدير الفرع لو محتاجة قرار`;
    case 'win_back':
      return `كلّمي${him} تعرفي ليه بعد عننا واعرضي علي${him} سبب يرجع (كوبون أو توصيل مجاني)`;
    case 'congrats':
      return `باركي${to} من الصيدلية`;
    case 'register':
      return `اتأكدي من بيانات${him} وكوّدي${him} وسجّلي الرقم وابعتي الترحيب`;
    default:
      return `تابعي مع${f ? 'اها' : 'اه'} في اللي الدكتور كاتبه${what}`;
  }
}

/** What the doctor wants done for this customer, read from the message. */
export function understandFollowup(
  body: string,
  sentDay: string,
  catalog?: CatalogIndex | null
): FollowupUnderstanding {
  const note = cleanNote(body);
  const t = ` ${norm(note)} `;
  const hits = KIND_WORDS.map(([kind, re]) => ({
    kind,
    n: (t.match(new RegExp(re.source, 'g')) ?? []).length,
  })).filter((h) => h.n > 0);
  // «نتطمن» بتيجي مع أي متابعة، فكلمات الصحة بنص وزن، والتعادل بيكسبه الأخص (ترتيب القايمة).
  const ranked = [...hits].sort((a, b) => {
    const weight = (k: FollowupKind) => (k === 'health' ? 0.5 : 1);
    return b.n * weight(b.kind) - a.n * weight(a.kind);
  });
  const kind: FollowupKind = ranked[0]?.kind ?? 'general';
  const patientMatch = t.match(RELATIVES);
  const patient = patientMatch ? patientMatch[1] : null;
  const female = FEMALE.test(t);
  const items = mentionedItems(note, catalog);
  const due = followupDue(note, sentDay);
  return {
    kind,
    also: ranked.slice(1).map((h) => h.kind),
    action: actionFor(kind, female, patient, items),
    patient,
    female,
    items,
    dueDate: due?.date ?? null,
    dueLabel: due?.label ?? null,
    note,
    urgent: URGENT.test(t),
  };
}

/** The task's line in the daily sheet: the kind and what to do, then the facts, then the doctor's own words. */
export function followupBrief(u: FollowupUnderstanding, doctor: string | null): string {
  const lines = [`${FOLLOWUP_KINDS[u.kind]}${u.urgent ? ' (ضروري)' : ''}: ${u.action}`];
  if (u.items.length) lines.push(`الأصناف: ${u.items.join('، ')}`);
  if (u.dueLabel) lines.push(`الميعاد: ${u.dueLabel}`);
  if (u.note) lines.push(`كلام ${doctor ? doctor.trim() : 'الدكتور'}: ${u.note}`);
  return lines.join('\n');
}

/** The same understanding with another kind chosen by the team: the action follows the kind. */
export function withKind(u: FollowupUnderstanding, kind: FollowupKind): FollowupUnderstanding {
  return { ...u, kind, action: actionFor(kind, u.female, u.patient, u.items) };
}
