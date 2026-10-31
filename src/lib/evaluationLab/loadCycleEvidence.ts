import { supabase } from '@/lib/supabase';
import { fetchAllOrderedPages, type PageQuery } from '@/lib/fetchAllOrderedPages';
import { OFFICIAL_REVIEW_COLUMNS, conversationReviewScore100, selectOfficialConversationReviews } from '@/lib/evaluations/officialConversationReview';
import { staffIdentityKey } from '@/lib/staff/staffIdentityKey';
import { canonicalStaffRole } from '@/lib/staff/staffRoleCapabilities';
import { cairoDateBoundaryIso } from '@/lib/time/cairoDateBoundary';
import type { BrainRequest, LabEvidence } from './buildCycleScores';
import { selectInvoiceCycleWindow } from '@/lib/readModels/invoiceRecordReadModel';
import { invoiceShiftOf } from './catalog';
import { expectedInventoryWeeks, type InventoryItemEvidence, type InventorySessionEvidence } from './inventoryAccuracy';
import { FULFILLMENT_WINDOW_DAYS, matchRequestFulfillment, type FulfillmentItem, type FulfillmentResult } from './requestFulfillment';
import type { ViolationCategory } from './complianceFactor';

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

/**
 * Customer requests the Master Brain proposed from WhatsApp conversations that started in the
 * cycle. Read-only and bounded; null when this session cannot read the sources (the axis then
 * reports "not measurable" instead of failing the cycle).
 */
async function loadBrainRequests(startAt: string, endAt: string): Promise<BrainRequest[] | null> {
  try {
    const sources = await pages(() => supabase.from('whatsapp_review_sources')
      .select('id,conversation_started_at,conversation_ended_at')
      .gte('conversation_started_at', startAt).lt('conversation_started_at', endAt) as unknown as PageQuery, 20000, 'brain_sources');
    const bySource = new Map(sources.map((row) => [text(row.id), row]));
    const ids = [...bySource.keys()];
    const out: BrainRequest[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const actions = await pages(() => supabase.from('whatsapp_conversation_actions')
        .select('id,source_id,staff_id,customer_id,customer_code,customer_phone,product_code,product_name,status,target_table,target_id,payload')
        .eq('action_type', 'customer_request').in('source_id', chunk) as unknown as PageQuery, 20000, 'brain_requests');
      for (const row of actions) {
        const source = bySource.get(text(row.source_id));
        if (!source || !text(source.conversation_started_at)) continue;
        out.push({
          id: text(row.id),
          staffId: text(row.staff_id) || null,
          customerId: text(row.customer_id) || null,
          customerCode: text(row.customer_code) || null,
          customerPhone: text(row.customer_phone) || null,
          productCode: text(row.product_code) || null,
          productName: text(row.product_name) || null,
          status: text(row.status) || null,
          targetId: text(row.target_table) === 'customer_requests' ? text(row.target_id) || null : null,
          conversationStartedAt: text(source.conversation_started_at),
          conversationEndedAt: text(source.conversation_ended_at) || null,
          // Stored by the projector since identity-pending persistence; older rows fall back to the conversation window.
          requestedAt: text((row.payload as Record<string, unknown> | null)?.requestedAt) || null,
        });
      }
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Customer requests of the cycle matched to the invoice items of the same customers, from the
 * request time up to 14 days after the cycle end (read-only, bounded, chunked by customer code).
 * null when this session cannot read the items or the catalog.
 */
async function loadFulfillment(requestRows: Row[], startAt: string, endAt: string): Promise<FulfillmentResult[] | null> {
  try {
    const codes = [...new Set(requestRows.map((row) => text(row.customer_code)).filter((code) => code && !/^[0\s.-]*$/.test(code)))];
    const until = new Date(Math.min(Date.now(), Date.parse(endAt) + FULFILLMENT_WINDOW_DAYS * 864e5)).toISOString();
    const items: FulfillmentItem[] = [];
    for (let i = 0; i < codes.length; i += 100) {
      const chunk = codes.slice(i, i + 100);
      const rows = await pages(() => supabase.from('sales_invoice_items_v21')
        .select('id,invoice_id,invoice_date,customer_code,product_id,product_code,product_name,quantity')
        .in('customer_code', chunk).gte('invoice_date', new Date(Date.parse(startAt) - 36e5).toISOString()).lt('invoice_date', until) as unknown as PageQuery,
        20000, 'request_fulfillment_items');
      for (const row of rows) {
        items.push({
          customerCode: text(row.customer_code) || null,
          invoiceAt: text(row.invoice_date),
          invoiceId: text(row.invoice_id) || null,
          productId: text(row.product_id) || null,
          productCode: text(row.product_code) || null,
          productName: text(row.product_name) || null,
          quantity: row.quantity == null ? null : num(row.quantity),
        });
      }
    }
    return matchRequestFulfillment(requestRows.map((row) => ({
      id: text(row.id),
      customerCode: text(row.customer_code) || null,
      medicineName: text(row.medicine_name) || null,
      productCode: text(row.product_code) || null,
      quantity: row.quantity == null ? null : num(row.quantity),
      createdAt: text(row.created_at),
      status: text(row.status) || null,
    })), items);
  } catch {
    return null;
  }
}

/** The cycle before this one, per branch: valid invoices and net (growth). null when unreadable. */
async function loadPreviousBranchSales(cycle: LabCycle): Promise<Array<{ branch: string; invoices: number; net: number }> | null> {
  try {
    const shift = (day: string) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); };
    const rows = await dailyInvoiceWindows({ start: shift(cycle.start), endExclusive: cycle.start }, 'id,branch,net_amount,total_amount', 30000);
    const byBranch = new Map<string, { branch: string; invoices: number; net: number }>();
    for (const row of rows) {
      const net = num(row.net_amount ?? row.total_amount);
      if (net <= 0) continue;
      const branch = text(row.branch);
      const entry = byBranch.get(branch) || { branch, invoices: 0, net: 0 };
      entry.invoices += 1;
      entry.net += net;
      byBranch.set(branch, entry);
    }
    return [...byBranch.values()];
  } catch {
    return null;
  }
}

/** Monthly evaluation status per staff member for this cycle, from the official v5 RPC. */
async function loadTeamEvaluations(cycle: LabCycle, actorId: string | null, branches: string[]) {
  if (!actorId || !branches.length) return null;
  try {
    const month = `${cycle.endExclusive.slice(0, 7)}-01`;
    const rows: Array<{ staffId: string; branch: string | null; status: string | null; sentAt: string | null }> = [];
    for (const branch of branches) {
      const { data, error } = await supabase.rpc('list_staff_for_monthly_evaluation_v5', { p_actor_id: actorId, p_branch: branch, p_month: month });
      if (error) throw error;
      for (const row of (data || []) as Row[]) {
        if (text(row.staff_status) && !/^(active|نشط)$/i.test(text(row.staff_status))) continue;
        rows.push({ staffId: text(row.id), branch: text(row.branch) || branch, status: text(row.evaluation_status) || null, sentAt: text(row.sent_at) || null });
      }
    }
    return rows;
  } catch {
    return null;
  }
}

/** Compliance violations of the cycle (not withdrawn), through the scoped RPC; null when unreadable. */
async function loadViolations(cycle: LabCycle): Promise<LabEvidence['violations']> {
  try {
    const last = new Date(`${cycle.endExclusive}T12:00:00Z`);
    last.setUTCDate(last.getUTCDate() - 1);
    const { data, error } = await supabase.rpc('list_staff_violations_v1', { p_from: cycle.start, p_to: last.toISOString().slice(0, 10), p_branch: null });
    if (error) throw error;
    return ((data || []) as Row[])
      .filter((row) => !row.withdrawn)
      .map((row) => ({ staffId: text(row.staff_account_id), category: text(row.category) as ViolationCategory, points: num(row.points) }));
  } catch {
    return null;
  }
}

const CAIRO_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Weekly inventory counts of the cycle per branch, with the weeks expected since each branch started. */
async function loadInventoryCounts(cycle: LabCycle): Promise<LabEvidence['inventoryCounts']> {
  try {
    const { data: sessionRows, error } = await supabase
      .from('inventory_count_sessions')
      .select('id,branch,week_start,due_date,status,closed_at')
      .eq('count_type', 'weekly_items')
      .lt('week_start', cycle.endExclusive)
      .order('week_start', { ascending: true })
      .limit(2000);
    if (error) throw error;
    const all = (sessionRows || []) as Row[];
    const firstWeek = new Map<string, string>();
    for (const row of all) {
      const branch = text(row.branch);
      if (!firstWeek.has(branch)) firstWeek.set(branch, text(row.week_start));
    }
    const sessions: InventorySessionEvidence[] = all
      .filter((row) => text(row.week_start) >= cycle.start)
      .map((row) => ({
        id: text(row.id),
        branch: text(row.branch) || null,
        weekStart: text(row.week_start),
        dueDate: text(row.due_date) || null,
        status: text(row.status) || null,
        closedDay: text(row.closed_at) ? CAIRO_DAY.format(new Date(text(row.closed_at))) : null,
      }));
    const items: InventoryItemEvidence[] = [];
    const ids = sessions.map((s) => s.id);
    for (let i = 0; i < ids.length; i += 50) {
      const { data, error: itemError } = await supabase
        .from('inventory_count_items')
        .select('session_id,product_code,item_name,expected_qty,actual_qty,reviewed_qty,review_result,unit_price')
        .in('session_id', ids.slice(i, i + 50))
        .limit(20000);
      if (itemError) throw itemError;
      for (const row of (data || []) as Row[]) {
        const n = (value: unknown) => (value === null || value === undefined || value === '' ? null : Number(value));
        items.push({
          sessionId: text(row.session_id),
          productCode: text(row.product_code) || null,
          itemName: text(row.item_name) || null,
          expected: n(row.expected_qty),
          actual: n(row.actual_qty),
          reviewedQty: n(row.reviewed_qty),
          reviewResult: text(row.review_result) || null,
          unitPrice: n(row.unit_price),
        });
      }
    }
    const expectedWeeks = [...firstWeek.entries()].map(([branch, first]) => ({ branch, weeks: expectedInventoryWeeks(cycle, first) }));
    return { sessions, items, expectedWeeks };
  } catch {
    return null;
  }
}

/** Purchase invoices of the cycle (excluded ones left out). null when unreadable. */
async function loadPurchaseInvoices(cycle: LabCycle) {
  try {
    const rows = await pages(() => supabase.from('purchase_invoices')
      .select('id,branch,entered_by_staff_id,reviewed_at,status,excluded_at')
      .gte('invoice_date', cycle.start).lt('invoice_date', cycle.endExclusive) as unknown as PageQuery, 20000, 'purchase_invoices');
    return rows.filter((row) => !text(row.excluded_at)).map((row) => ({
      branch: text(row.branch) || null,
      enteredByStaffId: text(row.entered_by_staff_id) || null,
      reviewed: Boolean(text(row.reviewed_at)) || !/بانتظار المراجعة|pending/i.test(text(row.status)),
    }));
  } catch {
    return null;
  }
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

export async function loadCycleEvidence(cycle: LabCycle, options: { actorId?: string | null } = {}): Promise<LabEvidence> {
  // Cairo wall-clock boundaries (summer time aware) for timestamp columns.
  const startAt = cairoDateBoundaryIso(cycle.start);
  const endAt = cairoDateBoundaryIso(cycle.endExclusive);

  const [staffRows, aliasRows, invoiceRows, reviewRows, attendanceRows, requestRows, purchaseRows, targetRows, followupProbe, checklistProbe, ratingProbe] = await Promise.all([
    pages(() => supabase.from('staff').select('id,name,role,branch,active,is_active') as unknown as PageQuery, 2000, 'staff'),
    pages(() => supabase.from('staff_identity_aliases').select('id,staff_id,normalized_alias,active').eq('active', true) as unknown as PageQuery, 5000, 'aliases'),
    // invoice_date (Cairo boundaries), verified identical to sale_date for this table (0 rows differ).
    dailyInvoiceWindows(cycle, 'id,staff_id,net_amount,total_amount,customer_code,branch,delivery_staff,sale_date,invoice_datetime,line_items_count,discount_amount', 30000),
    pages(() => supabase.from('conversation_sales_reviews_canonical_v2')
      .select(['id', 'staff_id', 'doctor_id', ...OFFICIAL_REVIEW_COLUMNS].join(','))
      .gte('conversation_date', startAt).lt('conversation_date', endAt) as unknown as PageQuery, 10000, 'reviews'),
    parallelPages((columns, options) => supabase.from('attendance_daily_summary').select(columns, options)
      .gte('attendance_date', cycle.start).lt('attendance_date', cycle.endExclusive),
      'id,staff_id,attendance_date,resolution_status,first_in,late_minutes,scheduled_start_at,total_hours', 10000, 'attendance', ['staff_id', 'attendance_date']),
    pages(() => supabase.from('customer_requests')
      .select('id,source_recorded_staff_id,branch,created_at,closed_at,status,customer_id,customer_code,customer_phone,medicine_name,product_code,quantity')
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

  const brainRequests = await loadBrainRequests(startAt, endAt);
  const fulfillment = await loadFulfillment(requestRows, startAt, endAt);
  const [previousBranchSales, teamEvaluations, purchaseInvoices, inventoryCounts, violations] = await Promise.all([
    loadPreviousBranchSales(cycle),
    loadTeamEvaluations(cycle, options.actorId || null, [...new Set(targetRows.map((row) => text(row.branch_name)).filter(Boolean))]),
    loadPurchaseInvoices(cycle),
    loadInventoryCounts(cycle),
    loadViolations(cycle),
  ]);

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
      discount: row.discount_amount == null ? null : num(row.discount_amount),
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
      id: text(row.id),
      customerId: text(row.customer_id) || null,
      customerCode: text(row.customer_code) || null,
      customerPhone: text(row.customer_phone) || null,
      medicineName: text(row.medicine_name) || null,
      productCode: text(row.product_code) || null,
      quantity: row.quantity == null ? null : num(row.quantity),
    })),
    brainRequests,
    fulfillment,
    previousBranchSales,
    teamEvaluations,
    purchaseInvoices,
    inventoryCounts,
    violations,
    purchases: purchaseInvoices
      ? purchaseInvoices.map((row) => ({ enteredByStaffId: row.enteredByStaffId }))
      : purchaseRows ? purchaseRows.map((row) => ({ enteredByStaffId: text(row.entered_by_staff_id) || null })) : null,
    targets: targetRows.map((row) => ({ branch: text(row.branch_name), targetAmount: num(row.target_amount) })),
    dormantSources: [
      ...((followupProbe.count ?? 0) === 0 ? ['followups'] : []),
      ...((checklistProbe.count ?? 0) === 0 ? ['assistant_checklist'] : []),
      ...((ratingProbe.count ?? 0) === 0 ? ['delivery_ratings'] : []),
    ],
  };
}
