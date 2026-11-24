import { supabase } from '@/supabaseClient';
import { whatsappNumber } from './tasks';

// العميل الجديد خطوة بخطوة (صاحب الصيدلية 2026-11-25): كود بي كونكت ← تسجيل على تليفون الفرع ← رسالة الترحيب.
// - «عميل جديد»: اشترى أول مرة امبارح وعنده كود (أغلبه شكري، من ملف العملاء): التليفون والترحيب بس.
// - «مش متكود»: الدكتور كتب اسمه ورقمه في ملاحظة الفاتورة (أغلبه الشامي): يتكود على بي كونكت الأول.
// الصف بيتقفل لما الخطوات تخلص أو يتقفل بمشكلة؛ غير كده بيرجع بكرة باللي اتعمل فيه، لحد ٣ أيام. اللي اتقفل مابيرجعش تاني،
// ولما يشتري بكوده الجديد مابيتعملوش «عميل جديد» تاني (dawaa_cs_uncoded_note_tasks_build_v1).

export const ONBOARDING_SHEET = 'العملاء الجداد';

export type OnboardSaved = 'yes' | 'no';
export type OnboardWelcome = 'sent' | 'no_whatsapp' | 'pending';
export type OnboardProblem = 'wrong_number' | 'not_customer' | 'refused' | 'already_coded';

type Choice<T extends string> = { code: T; label: string };

export const SAVED_CHOICES: Choice<OnboardSaved>[] = [
  { code: 'yes', label: 'اتسجل' },
  { code: 'no', label: 'لسه' },
];
export const WELCOME_CHOICES: Choice<OnboardWelcome>[] = [
  { code: 'sent', label: 'اتبعتت' },
  { code: 'no_whatsapp', label: 'مالوش واتساب' },
  { code: 'pending', label: 'لسه' },
];
export const PROBLEM_CHOICES: Choice<OnboardProblem>[] = [
  { code: 'already_coded', label: 'متكود قبل كده' },
  { code: 'wrong_number', label: 'الرقم غلط' },
  { code: 'not_customer', label: 'مش عميل (رقم دكتور أو مندوب)' },
  { code: 'refused', label: 'العميل مش عاوز' },
];

const labelOf = <T extends string>(list: Choice<T>[], code: string | null | undefined) =>
  list.find((c) => c.code === code)?.label ?? '';
const codeOf = <T extends string>(list: Choice<T>[], label: string) =>
  list.find((c) => c.label === label)?.code ?? null;
export const savedLabel = (c: string | null | undefined) => labelOf(SAVED_CHOICES, c);
export const welcomeLabel = (c: string | null | undefined) => labelOf(WELCOME_CHOICES, c);
export const problemLabel = (c: string | null | undefined) => labelOf(PROBLEM_CHOICES, c);

export type Onboard = {
  code?: string;
  saved?: boolean;
  welcome?: OnboardWelcome;
  problem?: OnboardProblem;
  by?: string;
  at?: string;
};

export type OnboardingTask = {
  id: string;
  queue_date: string;
  branch: string;
  source: 'new_customer' | 'uncoded_note';
  customer_code: string | null;
  customer_name: string;
  customer_phone: string | null;
  /** The phone came from the customers file (the invoice had none). */
  phone_from_file?: boolean;
  attempt_no: number;
  assigned_name: string | null;
  result: string | null;
  carried_from_date: string | null;
  invoice: string | null;
  value: number | null;
  seller: string | null;
  invoice_at: string | null;
  note: string | null;
  items: Array<{ name: string; qty: number | null }> | null;
  onboard: Onboard | null;
  welcome: string;
  /** After the customers file is uploaded: was the code she wrote found, and with this phone? */
  code_check: { status: 'match' | 'other_phone' | 'not_yet'; name?: string } | null;
};

export type OnboardingUpdate = {
  id: string;
  code: string | null;
  saved: OnboardSaved | null;
  welcome: OnboardWelcome | null;
  problem: OnboardProblem | null;
  note: string;
};

export type OnboardingResult = {
  done: number;
  partial: number;
  warnings: Array<{ id: string; name?: string; why: string }>;
  skipped: Array<{ id?: string; name?: string; why: string }>;
};

function fail(message: string): Error {
  return new Error(message || 'حصلت مشكلة في الاتصال، جرّب تاني');
}

export async function loadOnboarding(
  day: string,
  opts: { staffAccountId?: string | null; all?: boolean } = {}
): Promise<OnboardingTask[]> {
  const { data, error } = await supabase.rpc('dawaa_cs_onboarding_list_v1', {
    p_date: day,
    p_staff_account_id: opts.staffAccountId ?? null,
    p_all: Boolean(opts.all),
  });
  if (error) throw fail(error.message);
  return (data ?? []) as OnboardingTask[];
}

export async function submitOnboarding(rows: OnboardingUpdate[]): Promise<OnboardingResult> {
  const { data, error } = await supabase.rpc('dawaa_cs_onboarding_submit_v1', { p_rows: rows });
  if (error) throw fail(error.message);
  return data as OnboardingResult;
}

/** Whether every step is done (or the row was closed with a problem). Mirrors dawaa_cs_onboarding_submit_v1. */
export function onboardingDone(
  source: string,
  o: {
    code?: string | null;
    saved?: boolean | null;
    welcome?: string | null;
    problem?: string | null;
  }
): boolean {
  if (o.problem) return true;
  return (
    !!o.saved &&
    (o.welcome === 'sent' || o.welcome === 'no_whatsapp') &&
    (source !== 'uncoded_note' || !!o.code)
  );
}

/** What is still missing, in the words the sheet uses. Empty when done. */
export function onboardingLeft(
  source: string,
  o: {
    code?: string | null;
    saved?: boolean | null;
    welcome?: string | null;
    problem?: string | null;
  }
): string[] {
  if (onboardingDone(source, o)) return [];
  const left: string[] = [];
  if (source === 'uncoded_note' && !o.code) left.push('الكود');
  if (!o.saved) left.push('التليفون');
  if (o.welcome !== 'sent' && o.welcome !== 'no_whatsapp') left.push('الترحيب');
  return left;
}

/** A WhatsApp link that opens the chat with the welcome message already written. */
export function welcomeLink(phone: string | null | undefined, text: string): string | null {
  const wa = whatsappNumber(phone);
  return wa ? `https://wa.me/${wa}?text=${encodeURIComponent(text)}` : null;
}

/** The column titles of the sheet; the upload finds each answer by its title. */
export const ONBOARD_COLUMNS = {
  code: '① الكود على بي كونكت',
  saved: '② اتسجل على التليفون؟',
  welcome: '③ رسالة الترحيب',
  problem: 'لو فيه مشكلة',
  note: 'ملاحظة',
} as const;

/** Hidden column: the code the sheet was exported with, so a pre-filled code is not counted as her work. */
export const ONBOARD_ORIGINAL_CODE = 'orig';

const text = (v: unknown) => (v == null ? '' : String(v).trim());
const digits = (v: string) =>
  v.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/\D/g, '');

/** Reads «العملاء الجداد» (a cell matrix). Only rows where something was filled count. */
export function readOnboardingSheet(rows: unknown[][]): {
  updates: OnboardingUpdate[];
  problems: Array<{ sheet: string; row: number; problem: string }>;
} {
  const problems: Array<{ sheet: string; row: number; problem: string }> = [];
  const updates: OnboardingUpdate[] = [];
  const headerAt = rows
    .slice(0, 12)
    .findIndex((r) => (r ?? []).map(text).includes(ONBOARD_COLUMNS.saved));
  if (headerAt < 0) return { updates, problems };
  const th = (rows[headerAt] ?? []).map(text);
  const c = {
    id: th.indexOf('id'),
    orig: th.indexOf(ONBOARD_ORIGINAL_CODE),
    code: th.indexOf(ONBOARD_COLUMNS.code),
    saved: th.indexOf(ONBOARD_COLUMNS.saved),
    welcome: th.indexOf(ONBOARD_COLUMNS.welcome),
    problem: th.indexOf(ONBOARD_COLUMNS.problem),
    note: th.indexOf(ONBOARD_COLUMNS.note),
  };
  if (c.id < 0) {
    problems.push({
      sheet: ONBOARDING_SHEET,
      row: headerAt + 1,
      problem: 'العمود المخفي اتمسح، الشيت مش هيتقري',
    });
    return { updates, problems };
  }
  const cell = (row: unknown[], at: number) => (at >= 0 ? text(row?.[at]) : '');
  rows.forEach((row, i) => {
    if (i <= headerAt) return;
    const id = cell(row, c.id);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return;
    const raw = {
      code: cell(row, c.code).replace(/^متكود\s*✔?\s*/, ''),
      saved: cell(row, c.saved),
      welcome: cell(row, c.welcome),
      problem: cell(row, c.problem),
      note: cell(row, c.note),
    };
    const original = digits(cell(row, c.orig));
    const changedCode = !!raw.code && digits(raw.code) !== original;
    if (!changedCode && !raw.saved && !raw.welcome && !raw.problem && !raw.note) return;
    const flag = (problem: string) =>
      problems.push({ sheet: ONBOARDING_SHEET, row: i + 1, problem });
    const saved = raw.saved ? codeOf(SAVED_CHOICES, raw.saved) : null;
    const welcome = raw.welcome ? codeOf(WELCOME_CHOICES, raw.welcome) : null;
    const problem = raw.problem ? codeOf(PROBLEM_CHOICES, raw.problem) : null;
    const bad = [
      raw.saved && !saved ? raw.saved : null,
      raw.welcome && !welcome ? raw.welcome : null,
      raw.problem && !problem ? raw.problem : null,
    ].filter(Boolean);
    if (bad.length) {
      flag(bad.map((b) => `«${b}» مش من القايمة`).join('، '));
      return;
    }
    const typed = raw.code ? digits(raw.code) : '';
    // الكود اللي كان مكتوب من الأول (العميل المتكود، أو كود اتكتب قبل كده) مش شغل جديد.
    const code = typed && typed === digits(cell(row, c.orig)) ? '' : typed;
    if (raw.code && !typed) {
      flag(`الكود «${raw.code}» لازم يبقى أرقام`);
      return;
    }
    updates.push({ id, code: code || null, saved, welcome, problem, note: raw.note });
  });
  return { updates, problems };
}
