import { supabase } from '@/lib/supabase';
import { getPharmacyCycleRange } from '@/lib/pharmacy-cycle';

export type DoctorCompetitionPeriod = 'last30' | 'last90' | 'last_3_months' | 'cycle' | 'custom';

export type DoctorCompetitionParams = {
  period?: DoctorCompetitionPeriod;
  branch?: string | null;
  customStart?: string | null;
  customEnd?: string | null;
  userBranch?: string | null;
  canSeeAllBranches?: boolean;
};

export type DoctorCompetitionScore = {
  name: string;
  branch: string;
  totalSales: number;
  invoices: number;
  avgInvoice: number;
  growthRate: number;
  listItems: number;
  stagnantItems: number;
  incentiveValue: number;
  totalQuantity: number;
  linkedInvoiceCount: number;
  reviewCount: number;
  reviewTotal: number;
  excellentReviews: number;
  negativeReviews: number;
  followups: number;
  completedFollowups: number;
  recoveredCustomers: number;
  followupSales: number;
  satisfactionTotal: number;
  satisfactionCount: number;
  overallScore: number;
};

export type DoctorCompetitionWinners = {
  sales: DoctorCompetitionScore | null;
  averageInvoice: DoctorCompetitionScore | null;
  incentive: DoctorCompetitionScore | null;
  reviews: DoctorCompetitionScore | null;
  service: DoctorCompetitionScore | null;
  overall: DoctorCompetitionScore | null;
};

export type DoctorCompetitionMetrics = {
  rows: DoctorCompetitionScore[];
  winners: DoctorCompetitionWinners;
  range: { start: string; end: string };
  sourceHealth: Record<string, 'ready' | 'empty' | 'unavailable'>;
  errors: Record<string, string>;
};

export const MIN_AVG_INVOICE_THRESHOLD = 30;
export const ALL_BRANCHES = 'كل الفروع';

function num(value: unknown) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function text(value: unknown) {
  return String(value || '').trim();
}

function positiveNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function invoiceDate(row: Record<string, unknown>) {
  const value = text(row.sale_date || row.invoice_date || row.invoice_datetime || row.date || row.created_at);
  return value.slice(0, 10);
}

export function normalizeDoctorName(value: unknown) {
  const name = text(value);
  if (!name) return 'غير محدد';

  let normalized = name.replace(/\s+/g, ' ').trim();
  normalized = normalized.replace(/\([^)]*\)/g, '').trim();
  normalized = normalized
    .replace(/[\u064B-\u065F\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/^(?:الدكتور|دكتور|د\s*\/?|د\.)\s*/i, '')
    .replace(/[.،,:;_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return 'غير محدد';
  return `د/ ${normalized}`;
}

export function pickInvoiceAmount(row: Record<string, unknown>) {
  const candidates = [
    row.net_total,
    row.net_amount,
    row.discounted_amount,
    row.total_amount,
    row.amount,
    row.gross_total,
    row.gross_amount,
  ];

  for (const candidate of candidates) {
    const amount = positiveNumber(candidate);
    if (amount > 0) return amount;
  }

  return 0;
}

function invoiceAmount(row: Record<string, unknown>) {
  return pickInvoiceAmount(row);
}

function invoiceDoctor(row: Record<string, unknown>) {
  return normalizeDoctorName(
    row.normalized_seller_name ||
      row.seller_name ||
      row.staff_name ||
      row.doctor_name ||
      row.pharmacist_name ||
      row.cashier_name ||
      row.created_by_name ||
      row.user_name
  );
}

function invoiceBranch(row: Record<string, unknown>) {
  return text(row.branch_name || row.branch || row.store_branch) || 'غير محدد';
}

function invoiceTypeIndicatesReturnOrCancel(row: Record<string, unknown>) {
  const value = text(row.invoice_type).toLowerCase();
  return /return|refund|cancel|cancelled|مرتجع|إلغاء|ملغي/.test(value);
}

function invoiceStatusInvalid(row: Record<string, unknown>) {
  const saveStatus = text(row.save_status).toLowerCase();
  const importStatus = text(row.import_validation_status).toLowerCase();
  return /invalid|error|failed|خطأ|فشل/.test(saveStatus) || /invalid|error|failed|خطأ|فشل/.test(importStatus);
}

// لا يوجد عمود إلغاء صريح في sales_invoices، لذلك يتم الاستبعاد بقيمة صافية <= 0 وبـ invoice_type عند وجود دلالة نصية.

function localDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function currentCycle() {
  return getPharmacyCycleRange(new Date());
}

export function rangeForDoctorCompetition(period: DoctorCompetitionPeriod = 'cycle', customStart?: string | null, customEnd?: string | null) {
  const now = new Date();
  if (period === 'last30') {
    const start = new Date(now);
    start.setDate(start.getDate() - 30);
    return { start: localDateOnly(start), end: localDateOnly(now) };
  }
  if (period === 'last90' || period === 'last_3_months') {
    const start = new Date(now);
    start.setMonth(start.getMonth() - 3);
    return { start: localDateOnly(start), end: localDateOnly(now) };
  }
  if (period === 'custom') {
    const today = localDateOnly(now);
    return { start: customStart || today, end: customEnd || customStart || today };
  }
  return currentCycle();
}

function emptyDoctor(name: string, branch: string): Omit<DoctorCompetitionScore, 'overallScore'> {
  return {
    name,
    branch,
    totalSales: 0,
    invoices: 0,
    avgInvoice: 0,
    growthRate: 0,
    listItems: 0,
    stagnantItems: 0,
    incentiveValue: 0,
    totalQuantity: 0,
    linkedInvoiceCount: 0,
    reviewCount: 0,
    reviewTotal: 0,
    excellentReviews: 0,
    negativeReviews: 0,
    followups: 0,
    completedFollowups: 0,
    recoveredCustomers: 0,
    followupSales: 0,
    satisfactionTotal: 0,
    satisfactionCount: 0,
  };
}

export function avgReview(row?: Pick<DoctorCompetitionScore, 'reviewCount' | 'reviewTotal'> | null) {
  return row?.reviewCount ? row.reviewTotal / row.reviewCount : 0;
}

export function customerServiceAvg(row?: Pick<DoctorCompetitionScore, 'satisfactionCount' | 'satisfactionTotal'> | null) {
  return row?.satisfactionCount ? row.satisfactionTotal / row.satisfactionCount : 0;
}

function normalizeScores(rows: Array<Omit<DoctorCompetitionScore, 'overallScore'>>): DoctorCompetitionScore[] {
  const max = {
    sales: Math.max(1, ...rows.map((row) => row.totalSales)),
    avgInvoice: Math.max(1, ...rows.filter((row) => row.invoices >= MIN_AVG_INVOICE_THRESHOLD).map((row) => row.avgInvoice)),
    incentive: Math.max(1, ...rows.map((row) => row.incentiveValue + row.listItems * 100 + row.stagnantItems * 100)),
    review: Math.max(1, ...rows.map(avgReview)),
    service: Math.max(1, ...rows.map((row) => row.completedFollowups + row.recoveredCustomers * 2 + customerServiceAvg(row))),
  };
  return rows.map((row) => {
    const salesScore = (row.totalSales / max.sales) * 100;
    const avgInvoiceScore = row.invoices >= MIN_AVG_INVOICE_THRESHOLD ? (row.avgInvoice / max.avgInvoice) * 100 : 0;
    const incentiveScore = ((row.incentiveValue + row.listItems * 100 + row.stagnantItems * 100) / max.incentive) * 100;
    const reviewScore = (avgReview(row) / max.review) * 100;
    const serviceScore = ((row.completedFollowups + row.recoveredCustomers * 2 + customerServiceAvg(row)) / max.service) * 100;
    return {
      ...row,
      overallScore: salesScore * 0.3 + avgInvoiceScore * 0.2 + incentiveScore * 0.2 + reviewScore * 0.2 + serviceScore * 0.1,
    };
  });
}

async function safeSelect(table: string, build: (query: ReturnType<typeof supabase.from>) => unknown) {
  try {
    const result = await (build(supabase.from(table)) as PromiseLike<{ data: unknown; error: { message?: string } | null }>);
    if (result.error) return { data: [] as Record<string, unknown>[], error: result.error.message || `تعذر تحميل ${table}` };
    return { data: ((result.data || []) as Record<string, unknown>[]), error: null };
  } catch (error) {
    return { data: [] as Record<string, unknown>[], error: error instanceof Error ? error.message : `تعذر تحميل ${table}` };
  }
}

function buildWinners(rows: DoctorCompetitionScore[]): DoctorCompetitionWinners {
  return {
    sales: [...rows].sort((a, b) => b.totalSales - a.totalSales)[0] || null,
    averageInvoice: [...rows].filter((row) => row.invoices >= MIN_AVG_INVOICE_THRESHOLD).sort((a, b) => b.avgInvoice - a.avgInvoice)[0] || null,
    incentive: [...rows].sort((a, b) => b.incentiveValue + b.listItems + b.stagnantItems - (a.incentiveValue + a.listItems + a.stagnantItems))[0] || null,
    reviews: [...rows].filter((row) => row.reviewCount > 0).sort((a, b) => avgReview(b) - avgReview(a))[0] || null,
    service: [...rows].sort((a, b) => b.recoveredCustomers + b.completedFollowups - (a.recoveredCustomers + a.completedFollowups))[0] || null,
    overall: rows[0] || null,
  };
}

export async function getDoctorCompetitionMetrics(params: DoctorCompetitionParams = {}): Promise<DoctorCompetitionMetrics> {
  const range = rangeForDoctorCompetition(params.period, params.customStart, params.customEnd);
  const selectedBranch = params.branch && params.branch !== ALL_BRANCHES ? params.branch : '';
  const canSeeAll = params.canSeeAllBranches !== false;
  const map = new Map<string, Omit<DoctorCompetitionScore, 'overallScore'>>();
  const errors: Record<string, string> = {};
  const sourceHealth: Record<string, 'ready' | 'empty' | 'unavailable'> = {};
  const allowBranch = (branch: string) => {
    if (selectedBranch && branch !== selectedBranch) return false;
    if (!canSeeAll && params.userBranch && branch && branch !== params.userBranch) return false;
    return true;
  };
  const upsert = (name: string, branch: string) => {
    const key = `${name}|${branch}`;
    const current = map.get(key) || emptyDoctor(name, branch);
    map.set(key, current);
    return current;
  };

  const invoiceColumns = [
    'id',
    'invoice_no',
    'invoice_number',
    'invoice_date',
    'sale_date',
    'date',
    'created_at',
    'branch',
    'branch_name',
    'normalized_seller_name',
    'seller_name',
    'staff_name',
    'invoice_type',
    'save_status',
    'import_validation_status',
    'net_total',
    'net_amount',
    'discounted_amount',
    'total_amount',
    'amount',
    'gross_total',
    'gross_amount',
    'line_items_count',
    'raw_data',
  ].join(',');

  const [invoiceResult, reviewResult, followupResult] = await Promise.all([
    safeSelect('sales_invoices', (query) =>
      query
        .select(invoiceColumns)
        .gte('invoice_date', `${range.start}T00:00:00`)
        .lte('invoice_date', `${range.end}T23:59:59`)
        .limit(15000)
    ),
    safeSelect('conversation_sales_reviews', (query) => query.select('*').gte('conversation_date', range.start).lte('conversation_date', range.end).limit(4000)),
    safeSelect('daily_followups', (query) => query.select('*').gte('created_at', range.start).lte('created_at', `${range.end}T23:59:59`).limit(7000)),
  ]);

  const periodMidpoint = new Date(range.start);
  periodMidpoint.setTime((new Date(range.start).getTime() + new Date(range.end).getTime()) / 2);
  const firstHalfSales = new Map<string, number>();
  const secondHalfSales = new Map<string, number>();

  if (invoiceResult.error) errors.sales_invoices = invoiceResult.error;
  sourceHealth.sales_invoices = invoiceResult.error ? 'unavailable' : invoiceResult.data.length ? 'ready' : 'empty';
  for (const invoice of invoiceResult.data) {
    const day = invoiceDate(invoice);
    if (!day || day < range.start || day > range.end) continue;
    const amount = invoiceAmount(invoice);
    if (amount <= 0) continue;
    if (invoiceTypeIndicatesReturnOrCancel(invoice)) continue;
    if (invoiceStatusInvalid(invoice)) continue;

    const name = invoiceDoctor(invoice);
    const branch = invoiceBranch(invoice);
    if (!allowBranch(branch)) continue;
    const current = upsert(name, branch);
    current.totalSales += amount;
    current.invoices += 1;
    current.totalQuantity += num(invoice.line_items_count || (invoice.raw_data as Record<string, unknown> | undefined)?.quantity || (invoice.raw_data as Record<string, unknown> | undefined)?.qty);
    if ((invoice.raw_data as Record<string, unknown> | undefined)?.is_list_item || (invoice.raw_data as Record<string, unknown> | undefined)?.list_item || (invoice.raw_data as Record<string, unknown> | undefined)?.incentive_item) current.listItems += 1;
    if ((invoice.raw_data as Record<string, unknown> | undefined)?.is_stagnant || (invoice.raw_data as Record<string, unknown> | undefined)?.stagnant_item || (invoice.raw_data as Record<string, unknown> | undefined)?.slow_moving) current.stagnantItems += 1;
    if ((invoice.raw_data as Record<string, unknown> | undefined)?.is_list_item || (invoice.raw_data as Record<string, unknown> | undefined)?.list_item || (invoice.raw_data as Record<string, unknown> | undefined)?.incentive_item || (invoice.raw_data as Record<string, unknown> | undefined)?.is_stagnant || (invoice.raw_data as Record<string, unknown> | undefined)?.stagnant_item) {
      current.incentiveValue += amount;
      current.linkedInvoiceCount += 1;
    }
    const key = `${name}|${branch}`;
    if (new Date(`${day}T12:00:00`).getTime() <= periodMidpoint.getTime()) firstHalfSales.set(key, (firstHalfSales.get(key) || 0) + amount);
    else secondHalfSales.set(key, (secondHalfSales.get(key) || 0) + amount);
  }

  if (reviewResult.error) errors.conversation_sales_reviews = reviewResult.error;
  sourceHealth.conversation_sales_reviews = reviewResult.error ? 'unavailable' : reviewResult.data.length ? 'ready' : 'empty';
  for (const review of reviewResult.data) {
    const name = normalizeDoctorName(review.staff_name || review.doctor_name || review.employee_name || review.created_by_name);
    const branch = text(review.branch) || 'غير محدد';
    if (!allowBranch(branch)) continue;
    const current = upsert(name, branch);
    const score = num(review.final_score || review.score || review.quality_rating);
    if (score > 0) {
      current.reviewCount += 1;
      current.reviewTotal += score;
      if (score >= 90) current.excellentReviews += 1;
      if (score < 70) current.negativeReviews += 1;
    }
  }

  if (followupResult.error) errors.daily_followups = followupResult.error;
  sourceHealth.daily_followups = followupResult.error ? 'unavailable' : followupResult.data.length ? 'ready' : 'empty';
  for (const followup of followupResult.data) {
    const name = normalizeDoctorName(
      followup.responsible_name || followup.assigned_doctor || followup.assigned_to || followup.evaluated_by_name || followup.updated_by
    );
    const branch = text(followup.branch) || 'غير محدد';
    if (!allowBranch(branch)) continue;
    const current = upsert(name, branch);
    current.followups += 1;
    if (followup.completed_at || /تم|completed|closed|done/i.test(text(followup.status || followup.followup_status))) current.completedFollowups += 1;
    if (followup.purchase_after_followup) {
      current.recoveredCustomers += 1;
      current.followupSales += num(followup.purchase_amount);
    }
    const satisfaction = text(followup.customer_satisfaction);
    if (satisfaction === 'نعم' || satisfaction === 'راضي') {
      current.satisfactionTotal += 5;
      current.satisfactionCount += 1;
    } else if (satisfaction === 'لا') {
      current.satisfactionTotal += 1;
      current.satisfactionCount += 1;
    }
  }

  if (import.meta.env.DEV) {
    const invoiceRowsForDebug = invoiceResult.data.filter((invoice) => {
      const day = invoiceDate(invoice);
      return day && day >= range.start && day <= range.end && invoiceAmount(invoice) > 0;
    });
    console.info('[DoctorCompetitionMetrics] sales invoices loaded', {
      range,
      rowsFetched: invoiceResult.data.length,
      rowsUsed: invoiceRowsForDebug.length,
      netSales: invoiceRowsForDebug.reduce((sum, invoice) => sum + invoiceAmount(invoice), 0),
      sampleDoctors: invoiceRowsForDebug.slice(0, 5).map(invoiceDoctor),
      errors,
    });
  }

  const withAverages = [...map.entries()].map(([key, row]) => {
    const first = firstHalfSales.get(key) || 0;
    const second = secondHalfSales.get(key) || 0;
    return {
      ...row,
      avgInvoice: row.invoices ? row.totalSales / row.invoices : 0,
      growthRate: first ? ((second - first) / first) * 100 : second > 0 ? 100 : 0,
    };
  });
  const rows = normalizeScores(withAverages).sort((a, b) => b.overallScore - a.overallScore);
  return { rows, winners: buildWinners(rows), range, sourceHealth, errors };
}

export async function getDoctorCompetitionWinners(params: DoctorCompetitionParams = {}) {
  return (await getDoctorCompetitionMetrics(params)).winners;
}

export async function getDoctorCompetitionTopList(params: DoctorCompetitionParams & { limit?: number } = {}) {
  const metrics = await getDoctorCompetitionMetrics(params);
  return metrics.rows.slice(0, params.limit || 5);
}
