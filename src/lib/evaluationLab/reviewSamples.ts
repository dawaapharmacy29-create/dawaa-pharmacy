// v7.1 weekly random reviews (owner 2026-11-17). The database draws the samples
// (generate_evaluation_review_batch_v1); this module decides which batches are due, carries the camera
// criteria and the monthly target suggestion, and wraps the RPCs. Batch windows are Cairo calendar days.
import { supabase } from '@/supabaseClient';

export type ReviewKind = 'invoice' | 'conversation';
export type SampleStatus = 'pending' | 'reviewed' | 'skipped' | 'expired' | 'to_review' | 'not_captured';
/** random: the weekly draw; manual: the owner picked it; replacement: the app's pick after the owner dropped one. */
export type SampleOrigin = 'random' | 'manual' | 'replacement';

/** Six things the owner checks on the camera: 2 excellent, 1 acceptable, 0 weak, null not visible. */
export const INVOICE_CRITERIA = [
  { key: 'greeting', label: 'الترحيب والاستقبال' },
  { key: 'consultation', label: 'سأل عن الحالة وقدّم نصيحة' },
  { key: 'suggestion', label: 'اقترح صنف إضافي مناسب' },
  { key: 'speed', label: 'ماسابش العميل مستني وسرعة الخدمة' },
  { key: 'check', label: 'راجع الصنف والجرعة مع العميل' },
  { key: 'closing', label: 'الإنهاء والوداع والمظهر' },
] as const;
export type InvoiceCriterion = (typeof INVOICE_CRITERIA)[number]['key'];
export type InvoiceCriteria = Partial<Record<InvoiceCriterion, 0 | 1 | 2 | null>>;

/** Same rule as save_evaluation_invoice_review_v1: earned ÷ possible over the visible criteria (at least 3). */
export function invoiceReviewScore(criteria: InvoiceCriteria): number | null {
  const values = Object.values(criteria).filter((v): v is 0 | 1 | 2 => v === 0 || v === 1 || v === 2);
  if (values.length < 3) return null;
  return Math.round((values.reduce((s, v) => s + v, 0) / (values.length * 2)) * 1000) / 10;
}

const DAY = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`);

/** Today on the Cairo calendar (YYYY-MM-DD). */
export function cairoToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** The latest window that starts on `startDow` (0 Sunday … 6 Saturday), lasts `days` days and ended before today. */
function lastWindow(today: string, startDow: number, days: number) {
  let start = dayMs(today) - days * DAY;
  while (new Date(start).getUTCDay() !== startDow) start -= DAY;
  return { start: isoDay(start), end: isoDay(start + (days - 1) * DAY) };
}

/**
 * Batches due today. Cameras keep 5 days, so invoices come twice a week: Sat–Tue (drawn from Wednesday)
 * and Wed–Fri (drawn from Saturday); a late invoice batch only draws the days the cameras still keep
 * (generate_evaluation_review_batch_v1). Conversations once a week: Sat–Fri (drawn from Saturday), only among
 * chats the capture folder already brought in; they have no camera limit, so a missed week is still drawn the next week.
 * Drawing is idempotent per batch, so calling this on every page open is safe.
 */
export function dueBatches(today: string): Array<{ kind: ReviewKind; start: string; end: string }> {
  const week = lastWindow(today, 6, 7);
  const previousWeek = { start: isoDay(dayMs(week.start) - 7 * DAY), end: isoDay(dayMs(week.end) - 7 * DAY) };
  return [
    ...[lastWindow(today, 6, 4), lastWindow(today, 3, 3)]
      .filter((batch) => dayMs(today) - dayMs(batch.end) <= 4 * DAY)
      .map((batch) => ({ kind: 'invoice' as const, ...batch })),
    ...[week, previousWeek]
      .filter((batch) => dayMs(today) - dayMs(batch.end) <= 11 * DAY)
      .map((batch) => ({ kind: 'conversation' as const, ...batch })),
  ];
}

/** The 26th → 25th cycle a Cairo day belongs to. */
export function cycleStartOf(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  if (d >= 26) return `${y}-${String(m).padStart(2, '0')}-26`;
  const prev = new Date(Date.UTC(y, m - 2, 26));
  return isoDay(prev.getTime());
}

export function nextCycleStart(cycleStart: string): string {
  const [y, m] = cycleStart.split('-').map(Number);
  return isoDay(Date.UTC(y, m, 26));
}

/**
 * Next cycle's suggestion (owner 2026-11-17): follow-ups climb +200 a cycle up to 1000; complete requests
 * grow 15% (they rise as WhatsApp, group and app tracking improves). The owner edits before approving.
 */
export function suggestCycleTargets(current: { followups: number | null; requests: number | null }) {
  const followups = current.followups ? Math.min(1000, Math.ceil((current.followups + 200) / 50) * 50) : 1000;
  const requests = current.requests ? Math.ceil((current.requests * 1.15) / 5) * 5 : null;
  return { followups, requests };
}

export interface ReviewSample {
  id: string;
  kind: ReviewKind;
  batchStart: string;
  staffId: string;
  staffName: string;
  branch: string | null;
  invoiceNumber: string | null;
  invoiceAt: string;
  net: number;
  items: number | null;
  stratum: 'small' | 'medium' | 'big';
  customerCode: string | null;
  customerName: string | null;
  customerPhone: string | null;
  deadline: string;
  status: SampleStatus;
  score: number | null;
  criteria: InvoiceCriteria | null;
  notes: string | null;
  reviewedAt: string | null;
  origin: SampleOrigin;
}

type Row = Record<string, unknown>;
const text = (v: unknown) => (v == null ? '' : String(v));

export async function generateDueBatches(today = cairoToday()) {
  let added = 0;
  for (const batch of dueBatches(today)) {
    const { data, error } = await supabase.rpc('generate_evaluation_review_batch_v1', { p_kind: batch.kind, p_batch_start: batch.start, p_batch_end: batch.end });
    if (error) throw new Error(error.message);
    added += Number(data) || 0;
  }
  return added;
}

export async function listReviewSamples(cycleStart: string): Promise<ReviewSample[]> {
  const { data, error } = await supabase.rpc('list_evaluation_review_samples_v1', { p_cycle_start: cycleStart });
  if (error) throw new Error(error.message);
  return ((data || []) as Row[]).map((row) => ({
    id: text(row.id),
    kind: text(row.kind) as ReviewKind,
    batchStart: text(row.batch_start),
    staffId: text(row.staff_id),
    staffName: text(row.staff_name),
    branch: text(row.branch) || null,
    invoiceNumber: text(row.invoice_number) || null,
    invoiceAt: text(row.invoice_at),
    net: Number(row.net) || 0,
    items: row.items == null ? null : Number(row.items),
    stratum: text(row.stratum) as ReviewSample['stratum'],
    customerCode: text(row.customer_code) || null,
    customerName: text(row.customer_name) || null,
    customerPhone: text(row.customer_phone) || null,
    deadline: text(row.deadline),
    status: text(row.status) as SampleStatus,
    score: row.score == null ? null : Number(row.score),
    criteria: (row.criteria as InvoiceCriteria | null) || null,
    notes: text(row.notes) || null,
    reviewedAt: text(row.reviewed_at) || null,
    origin: (text(row.origin) || 'random') as SampleOrigin,
  }));
}

/** Database error codes → what the owner sees. */
const REVIEW_ERRORS: Record<string, string> = {
  review_invoice_not_available: 'الفاتورة دي مش متاحة: الكاميرا مسحتها، أو مش لدكتور في التقييم، أو كود داخلي',
  review_invoice_already_sampled: 'الفاتورة دي متضافة للمراجعة قبل كده',
  review_chat_not_captured: 'المحادثة دي لسه ماوصلتش للعقل المدبر',
  review_sample_already_reviewed: 'العينة دي اتقيّمت خلاص، مينفعش تتشال',
  review_sample_not_found: 'العينة مش موجودة أو اتشالت قبل كده',
  review_samples_not_authorized: 'الصلاحية دي للمالك بس',
};
export function reviewErrorMessage(message: string): string {
  const code = Object.keys(REVIEW_ERRORS).find((key) => message.includes(key));
  return code ? REVIEW_ERRORS[code] : message;
}
const fail = (message: string) => new Error(reviewErrorMessage(message));

export interface ReviewCandidate {
  invoiceId: string;
  staffName: string;
  branch: string | null;
  invoiceNumber: string | null;
  invoiceAt: string;
  net: number;
  items: number | null;
  customerName: string | null;
  customerPhone: string | null;
  stratum: ReviewSample['stratum'];
  hasChat: boolean;
  sampled: boolean;
}

/** Invoices the owner can pick (cash still on the cameras / delivery orders of the last weeks), newest first. */
export async function searchReviewCandidates(kind: ReviewKind, query: string): Promise<ReviewCandidate[]> {
  const { data, error } = await supabase.rpc('search_evaluation_review_candidates_v1', { p_kind: kind, p_query: query.trim() || null });
  if (error) throw fail(error.message);
  return ((data || []) as Row[]).map((row) => ({
    invoiceId: text(row.invoice_id),
    staffName: text(row.staff_name),
    branch: text(row.branch) || null,
    invoiceNumber: text(row.invoice_number) || null,
    invoiceAt: text(row.invoice_at),
    net: Number(row.net) || 0,
    items: row.items == null ? null : Number(row.items),
    customerName: text(row.customer_name) || null,
    customerPhone: text(row.customer_phone) || null,
    stratum: text(row.stratum) as ReviewSample['stratum'],
    hasChat: row.has_chat === true,
    sampled: row.sampled === true,
  }));
}

export async function addReviewSample(kind: ReviewKind, invoiceId: string): Promise<string> {
  const { data, error } = await supabase.rpc('add_evaluation_review_sample_v1', { p_kind: kind, p_invoice_id: invoiceId });
  if (error) throw fail(error.message);
  return text(data);
}

/** Drops a sample with no review yet; with autoReplace the app picks another of the same doctor. Returns the replacement id or null. */
export async function excludeReviewSample(sampleId: string, autoReplace: boolean, note?: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('exclude_evaluation_review_sample_v1', {
    p_sample_id: sampleId, p_auto_replace: autoReplace, p_note: note?.trim() || null,
  });
  if (error) throw fail(error.message);
  return data ? text(data) : null;
}

export async function saveInvoiceReview(sampleId: string, criteria: InvoiceCriteria, notes: string, skip = false) {
  const { data, error } = await supabase.rpc('save_evaluation_invoice_review_v1', {
    p_sample_id: sampleId, p_criteria: skip ? {} : criteria, p_notes: notes || null, p_skip: skip,
  });
  if (error) throw new Error(error.message);
  return data == null ? null : Number(data);
}

export interface CycleTargetRow { branch: string; cycleStart: string; followups: number | null; requests: number | null; note: string | null }

export async function listCycleTargets(): Promise<CycleTargetRow[]> {
  const { data, error } = await supabase.rpc('list_evaluation_branch_cycle_targets_v1');
  if (error) throw new Error(error.message);
  return ((data || []) as Row[]).map((row) => ({
    branch: text(row.branch), cycleStart: text(row.cycle_start),
    followups: row.followups == null ? null : Number(row.followups),
    requests: row.requests == null ? null : Number(row.requests),
    note: text(row.note) || null,
  }));
}

export async function saveCycleTarget(row: { branch: string; cycleStart: string; followups: number; requests: number; note?: string }) {
  const { error } = await supabase.rpc('save_evaluation_branch_cycle_target_v1', {
    p_branch: row.branch, p_cycle_start: row.cycleStart, p_followups: row.followups, p_requests: row.requests, p_note: row.note || null,
  });
  if (error) throw new Error(error.message);
}
