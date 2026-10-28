import { supabase } from '@/lib/supabase';
import { fetchAllOrderedPages, type PageQuery } from '@/lib/fetchAllOrderedPages';
import { OFFICIAL_REVIEW_COLUMNS, conversationReviewScore100, selectOfficialConversationReviews } from '@/lib/evaluations/officialConversationReview';
import { staffIdentityKey } from '@/lib/staff/staffIdentityKey';
import { canonicalStaffRole } from '@/lib/staff/staffRoleCapabilities';
import { cairoDateBoundaryIso } from '@/lib/time/cairoDateBoundary';
import type { LabEvidence } from './buildCycleScores';
import { selectInvoiceCycleWindow } from '@/lib/readModels/invoiceRecordReadModel';
import { invoiceShiftOf } from './catalog';

// Read-only, bounded evidence for one 26→25 cycle. Every read is filtered by the cycle and
// capped; a failed read throws (the lab shows the outage instead of scoring zeros).

type Row = Record<string, unknown>;
const text = (value: unknown) => String(value ?? '').trim();
const num = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);

async function pages(build: () => PageQuery, maxRows: number, label: string): Promise<Row[]> {
  const { data, error } = await fetchAllOrderedPages<Row>(build, { orderColumn: 'id', maxRows, limitError: `${label}_limit_reached` });
  if (error) throw new Error(`${label}: ${error.message || 'تعذر التحميل'}`);
  return data || [];
}

type CountedQuery = PromiseLike<{ count: number | null; error: { message?: string } | null }>;
type RangedQuery = { order: (column: string, options: { ascending: boolean }) => RangedQuery; range: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message?: string } | null }> };

const PAGE = 1000;
const CONCURRENCY = 6;

/**
 * Closed-cycle rows fetched page-parallel: one exact count, then every page at once (bounded
 * concurrency) instead of 1000-row pages one after another. A closed cycle does not change, so
 * the pages are consistent; rows are de-duplicated by id and the total must match the count.
 */
async function parallelPages(
  select: (columns: string, options?: { count: 'exact'; head: true }) => unknown,
  columns: string,
  maxRows: number,
  label: string,
  /** Deterministic order matching an index, so each page is an index range, not a table scan. */
  orderColumns: string[] = ['id'],
): Promise<Row[]> {
  const counted = await (select('id', { count: 'exact', head: true }) as CountedQuery);
  if (counted.error) throw new Error(`${label}: ${counted.error.message || 'تعذر العدّ'}`);
  const total = counted.count ?? 0;
  if (total > maxRows) throw new Error(`${label}_limit_reached`);
  const offsets = Array.from({ length: Math.ceil(total / PAGE) }, (_, i) => i * PAGE);
  const chunks: Row[][] = new Array(offsets.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, offsets.length) }, async () => {
    while (next < offsets.length) {
      const index = next++;
      const ordered = orderColumns.reduce((query, column) => query.order(column, { ascending: true }), select(columns) as RangedQuery);
      const { data, error } = await ordered.range(offsets[index], offsets[index] + PAGE - 1);
      if (error) throw new Error(`${label}: ${error.message || 'تعذر التحميل'}`);
      chunks[index] = (data || []) as Row[];
    }
  }));
  const rows = [...new Map(chunks.flat().map((row) => [text(row.id), row])).values()];
  if (rows.length !== total) throw new Error(`${label}: عدد الصفوف تغيّر أثناء التحميل (${rows.length}/${total})`);
  return rows;
}

const CAIRO_HOUR = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', hourCycle: 'h23' });
/** Shift of the invoice's real timestamp (invoice_date is often a date at midnight). */
function cairoShift(value: unknown): string | null {
  const at = Date.parse(text(value));
  return Number.isFinite(at) ? invoiceShiftOf(Number(CAIRO_HOUR.format(at))) : null;
}

/**
 * Cycle invoices read one Cairo day at a time (bounded concurrency) instead of deep offset pages:
 * each day is a short index range, so columns outside the covering index (invoice_datetime,
 * line_items_count) never force the database to walk every earlier row. A day larger than one
 * page continues with offset pages inside that day only. The total must match one exact count.
 */
async function dailyInvoiceWindows(cycle: LabCycle, columns: string, maxRows: number): Promise<Row[]> {
  const startAt = cairoDateBoundaryIso(cycle.start);
  const endAt = cairoDateBoundaryIso(cycle.endExclusive);
  const counted = await (selectInvoiceCycleWindow('id', { count: 'exact', head: true }, startAt, endAt) as unknown as CountedQuery);
  if (counted.error) throw new Error(`sales_invoices: ${counted.error.message || 'تعذر العدّ'}`);
  const total = counted.count ?? 0;
  if (total > maxRows) throw new Error('sales_invoices_limit_reached');
  const days: string[] = [];
  for (let at = Date.parse(`${cycle.start}T00:00:00Z`); at < Date.parse(`${cycle.endExclusive}T00:00:00Z`); at += 864e5) {
    days.push(new Date(at).toISOString().slice(0, 10));
  }
  const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);
  const chunks: Row[][] = new Array(days.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, days.length) }, async () => {
    while (next < days.length) {
      const index = next++;
      const from = cairoDateBoundaryIso(days[index]);
      const to = cairoDateBoundaryIso(nextDay(days[index]));
      const rows: Row[] = [];
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await (selectInvoiceCycleWindow(columns, undefined, from, to) as unknown as RangedQuery)
          .order('invoice_date', { ascending: true }).order('id', { ascending: true }).range(offset, offset + PAGE - 1);
        if (error) throw new Error(`sales_invoices: ${error.message || 'تعذر التحميل'}`);
        const page = (data || []) as Row[];
        rows.push(...page);
        if (page.length < PAGE) break;
      }
      chunks[index] = rows;
    }
  }));
  const rows = [...new Map(chunks.flat().map((row) => [text(row.id), row])).values()];
  if (rows.length !== total) throw new Error(`sales_invoices: عدد الصفوف تغيّر أثناء التحميل (${rows.length}/${total})`);
  return rows;
}

export interface LabCycle {
  /** Inclusive start (the 26th). */
  start: string;
  /** Exclusive end (the next 26th). */
  endExclusive: string;
}

export function closedCycles(count: number, today = new Date()): LabCycle[] {
  const cairo = new Date(today.toLocaleString('en-US', { timeZone: 'Africa/Cairo' }));
  // The current cycle ends on the next 26th; the newest closed cycle ended on the latest 26th <= today.
  let endYear = cairo.getFullYear();
  let endMonth = cairo.getMonth() + (cairo.getDate() >= 26 ? 0 : -1);
  const cycles: LabCycle[] = [];
  for (let i = 0; i < count; i += 1) {
    const end = new Date(Date.UTC(endYear, endMonth, 26));
    const start = new Date(Date.UTC(endYear, endMonth - 1, 26));
    cycles.push({ start: start.toISOString().slice(0, 10), endExclusive: end.toISOString().slice(0, 10) });
    endMonth -= 1;
    if (endMonth < 0) { endMonth += 12; endYear -= 1; }
  }
  return cycles;
}

export async function loadCycleEvidence(cycle: LabCycle): Promise<LabEvidence> {
  // Cairo wall-clock boundaries (summer time aware) for timestamp columns.
  const startAt = cairoDateBoundaryIso(cycle.start);
  const endAt = cairoDateBoundaryIso(cycle.endExclusive);

  const [staffRows, aliasRows, invoiceRows, reviewRows, attendanceRows, requestRows, purchaseRows, targetRows, followupProbe, checklistProbe, ratingProbe] = await Promise.all([
    pages(() => supabase.from('staff').select('id,name,role,branch,active,is_active') as unknown as PageQuery, 2000, 'staff'),
    pages(() => supabase.from('staff_identity_aliases').select('id,staff_id,normalized_alias,active').eq('active', true) as unknown as PageQuery, 5000, 'aliases'),
    // invoice_date (Cairo boundaries), verified identical to sale_date for this table (0 rows differ).
    dailyInvoiceWindows(cycle, 'id,staff_id,net_amount,total_amount,customer_code,branch,delivery_staff,sale_date,invoice_datetime,line_items_count', 30000),
    pages(() => supabase.from('conversation_sales_reviews_canonical_v2')
      .select(['id', 'staff_id', 'doctor_id', ...OFFICIAL_REVIEW_COLUMNS].join(','))
      .gte('conversation_date', startAt).lt('conversation_date', endAt) as unknown as PageQuery, 10000, 'reviews'),
    parallelPages((columns, options) => supabase.from('attendance_daily_summary').select(columns, options)
      .gte('attendance_date', cycle.start).lt('attendance_date', cycle.endExclusive),
      'id,staff_id,attendance_date,resolution_status,first_in,late_minutes,scheduled_start_at,total_hours', 10000, 'attendance', ['staff_id', 'attendance_date']),
    pages(() => supabase.from('customer_requests')
      .select('id,source_recorded_staff_id,branch,created_at,closed_at,status')
      .gte('created_at', startAt).lt('created_at', endAt) as unknown as PageQuery, 10000, 'customer_requests'),
    // Client sessions may not read this table; its axis then reports "not measurable" instead of failing the cycle.
    pages(() => supabase.from('base44_purchase_invoice_sync')
      .select('id,entered_by_staff_id,invoice_date')
      .gte('invoice_date', cycle.start).lt('invoice_date', cycle.endExclusive) as unknown as PageQuery, 20000, 'purchases').catch(() => null),
    pages(() => supabase.from('branch_sales_targets').select('id,branch_name,target_amount,active').eq('active', true) as unknown as PageQuery, 100, 'targets'),
    supabase.from('daily_followups').select('id', { count: 'exact', head: true }).gte('created_at', startAt).lt('created_at', endAt),
    // Activity probes: a source with no rows in the cycle is dormant (its axis is not measurable, never 0).
    supabase.from('staff_daily_checklist_submissions').select('id', { count: 'exact', head: true }).gte('submission_date', cycle.start).lt('submission_date', cycle.endExclusive),
    supabase.from('ratings').select('id', { count: 'exact', head: true }).gte('created_at', startAt).lt('created_at', endAt),
  ]);
  for (const [label, probe] of [['followups', followupProbe], ['assistant_checklist', checklistProbe], ['delivery_ratings', ratingProbe]] as const) {
    if (probe.error) throw new Error(`${label}: ${probe.error.message}`);
  }

  const staff = staffRows
    .filter((row) => row.active !== false && row.is_active !== false)
    .map((row) => ({ id: text(row.id), name: text(row.name), role: text(row.role), branch: text(row.branch) || null }));

  // Delivery labels carry a name, not an id: resolve only to a unique active courier.
  const couriers = staff.filter((person) => canonicalStaffRole(person.role) === 'delivery');
  const courierIds = new Set(couriers.map((c) => c.id));
  const ownersByKey = new Map<string, Set<string>>();
  const claim = (key: string, id: string) => { if (key) ownersByKey.set(key, (ownersByKey.get(key) || new Set()).add(id)); };
  for (const courier of couriers) claim(staffIdentityKey(courier.name), courier.id);
  for (const alias of aliasRows) if (courierIds.has(text(alias.staff_id))) claim(text(alias.normalized_alias), text(alias.staff_id));
  const courierFor = (label: unknown) => {
    const owners = ownersByKey.get(staffIdentityKey(String(label ?? '').replace(/\*+$/, '')));
    return owners && owners.size === 1 ? [...owners][0] : null;
  };

  const official = selectOfficialConversationReviews(reviewRows, { startDay: cycle.start, endDayExclusive: cycle.endExclusive }).rows;

  return {
    staff,
    invoices: invoiceRows.map((row) => ({
      staffId: text(row.staff_id) || null,
      net: num(row.net_amount ?? row.total_amount),
      date: text(row.sale_date).slice(0, 10),
      coded: text(row.customer_code) !== '',
      branch: text(row.branch) || null,
      deliveryStaffId: text(row.delivery_staff) ? courierFor(row.delivery_staff) : null,
      deliveryLabeled: text(row.delivery_staff) !== '',
      shift: cairoShift(row.invoice_datetime),
      items: row.line_items_count === null || row.line_items_count === undefined ? null : num(row.line_items_count),
    })),
    reviews: official.flatMap((row) => {
      const score = conversationReviewScore100(row);
      const staffId = text(row.staff_id) || text(row.doctor_id);
      return score === null || !staffId ? [] : [{ staffId, score }];
    }),
    attendance: attendanceRows.map((row) => ({
      staffId: text(row.staff_id),
      date: text(row.attendance_date),
      status: text(row.resolution_status) || null,
      hasFirstIn: text(row.first_in) !== '',
      scheduled: text(row.scheduled_start_at) !== '',
      lateMinutes: num(row.late_minutes),
    })),
    requests: requestRows.map((row) => ({
      // The recording employee; created_by is not a staff id.
      recordedStaffId: text(row.source_recorded_staff_id) || null,
      branch: text(row.branch) || null,
      createdAt: text(row.created_at),
      closedAt: text(row.closed_at) || null,
      status: text(row.status) || null,
    })),
    purchases: purchaseRows ? purchaseRows.map((row) => ({ enteredByStaffId: text(row.entered_by_staff_id) || null })) : null,
    targets: targetRows.map((row) => ({ branch: text(row.branch_name), targetAmount: num(row.target_amount) })),
    dormantSources: [
      ...((followupProbe.count ?? 0) === 0 ? ['followups'] : []),
      ...((checklistProbe.count ?? 0) === 0 ? ['assistant_checklist'] : []),
      ...((ratingProbe.count ?? 0) === 0 ? ['delivery_ratings'] : []),
    ],
  };
}
