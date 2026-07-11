import { normalizeBranchName } from '@/lib/branch';
import { getPharmacyCycleRange } from '@/lib/pharmacy-cycle';
import { fetchSalesInvoicesPagedSafe } from '@/lib/salesInvoiceQueries';
import { getInvoiceAmount, getInvoiceBranch, getInvoiceDay, getInvoiceId, getInvoiceSellerName } from '@/lib/invoices/invoiceCore';
import { supabase } from '@/lib/supabase';

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
  staffId?: string | null;
  totalSales: number;
  invoices: number;
  avgInvoice: number;
  growthRate: number | null;
  growthRateStatus: 'available' | 'unavailable';
  listItems: number;
  stagnantItems: number;
  stagnantStatus: 'available' | 'disabled';
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
  leaderboardEligible: boolean;
  avgInvoiceEligible: boolean;
  ineligibleReasons: string[];
  reviewIssues: string[];
};

export type DoctorCompetitionWinners = {
  sales: DoctorCompetitionScore | null;
  averageInvoice: DoctorCompetitionScore | null;
  avgInvoice: DoctorCompetitionScore | null;
  incentive: DoctorCompetitionScore | null;
  stagnant: DoctorCompetitionScore | null;
  reviews: DoctorCompetitionScore | null;
  conversation: DoctorCompetitionScore | null;
  service: DoctorCompetitionScore | null;
  customerService: DoctorCompetitionScore | null;
  overall: DoctorCompetitionScore | null;
};

export type DoctorCompetitionMetrics = {
  rows: DoctorCompetitionScore[];
  eligibleRows: DoctorCompetitionScore[];
  reviewRows: DoctorCompetitionScore[];
  winners: DoctorCompetitionWinners;
  status: 'ready' | 'empty' | 'partial' | 'failed';
  warnings: string[];
  metadata: {
    minimumInvoicesForLeaderboard: number;
    minimumSalesForLeaderboard: number;
    minimumInvoicesForAvgInvoice: number;
    stagnantEnabled: boolean;
    previousRange: { start: string; end: string };
    requestedPeriod: DoctorCompetitionPeriod;
    selectedBranch: string | null;
    hasReviewData: boolean;
    hasFollowupData: boolean;
    hasIncentiveData: boolean;
    salesInvoicesFetchedCount: number;
    doctorSalesRowsCount: number;
    totalDoctorSales: number;
    invoiceRowsWithoutDoctorCount: number;
    topRawDoctorSalesPreview: string[];
    noWinnersReasons: string[];
    totalInvoicesCountFromDoctorRows: number;
    invoiceCountMethod: string;
  };
  range: { start: string; end: string };
  sourceHealth: Record<string, 'ready' | 'empty' | 'unavailable'>;
  errors: Record<string, string>;
};

export const MINIMUM_INVOICES_FOR_LEADERBOARD = 10;
export const MINIMUM_SALES_FOR_LEADERBOARD = 3000;
export const MIN_AVG_INVOICE_THRESHOLD = 30;
export const ALL_BRANCHES = 'كل الفروع';

const INVOICE_SELECT_DOCTOR_OPTIONS = [
  'id,invoice_number,invoice_no,invoice_date,sale_date,branch,branch_name,seller_name,normalized_seller_name,staff_name,staff_id,doctor_id,seller_id,employee_id,net_amount,net_total,total_amount,amount,gross_amount,gross_total,discounted_amount,customer_code,invoice_type,status,save_status',
  'id,invoice_number,invoice_no,invoice_date,sale_date,branch,branch_name,seller_name,normalized_seller_name,staff_name,net_amount,net_total,total_amount,amount,gross_amount,gross_total,discounted_amount,customer_code,invoice_type,status,save_status',
  'id,invoice_number,invoice_no,invoice_date,branch,branch_name,seller_name,staff_name,net_amount,total_amount,amount,discounted_amount,customer_code',
  'id,invoice_date,branch,seller_name,amount,total_amount,customer_code',
];

type Row = Record<string, unknown>;

function text(value: unknown) {
  return String(value ?? '').trim();
}

function num(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function localDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizePlain(value: unknown) {
  return text(value)
    .replace(/[ًٌٍَُِّْـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[.،,:;_\-/()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeDoctorName(value: unknown) {
  const cleaned = normalizePlain(value).replace(/^(?:الدكتور|دكتور|د\s*\/?|د\.)\s*/i, '').trim();
  return cleaned ? `د/ ${cleaned}` : 'غير محدد';
}

function comparableDoctorName(name: string) {
  return normalizeDoctorName(name).replace(/^د\/\s*/, '').trim();
}

function isUnknownDoctorName(name: string) {
  const comparable = comparableDoctorName(name);
  return !comparable || comparable === 'غير محدد' || comparable === 'غير محدد دكتور';
}

function invoiceDate(row: Row) {
  return getInvoiceDay(row) || '';
}

function invoiceBranch(row: Row) {
  return normalizeBranchName(getInvoiceBranch(row)) || getInvoiceBranch(row) || 'غير محدد';
}

function invoiceDoctor(row: Row) {
  return normalizeDoctorName(row.normalized_seller_name || row.staff_name || getInvoiceSellerName(row));
}

function rowStaffId(row: Row) {
  return text(row.staff_id || row.doctor_id || row.seller_id || row.employee_id || row.responsible_staff_id || row.reviewed_staff_id || row.assigned_staff_id);
}

export function pickInvoiceAmount(row: Row) {
  return getInvoiceAmount(row);
}

function invoiceAmount(row: Row) {
  return pickInvoiceAmount(row);
}

function invoiceIdentityKey(row: Row) {
  return getInvoiceId(row) || text(row.id);
}

function invoiceInvalid(row: Row) {
  const raw = `${text(row.invoice_type)} ${text(row.status)} ${text(row.save_status)}`.toLowerCase();
  return /return|refund|cancel|cancelled|مرتجع|الغاء|إلغاء|ملغي|invalid|failed|error|فشل|خطأ/.test(raw);
}

export function rangeForDoctorCompetition(period: DoctorCompetitionPeriod = 'cycle', customStart?: string | null, customEnd?: string | null) {
  const now = new Date();
  if (period === 'last30') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
    start.setDate(start.getDate() - 30);
    return { start: localDateOnly(start), end: localDateOnly(now) };
  }
  if (period === 'last90' || period === 'last_3_months') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
    start.setMonth(start.getMonth() - 3);
    return { start: localDateOnly(start), end: localDateOnly(now) };
  }
  if (period === 'custom') return { start: customStart || localDateOnly(now), end: customEnd || customStart || localDateOnly(now) };
  return getPharmacyCycleRange(now);
}

function previousRange(range: { start: string; end: string }) {
  const start = new Date(`${range.start}T12:00:00`);
  const end = new Date(`${range.end}T12:00:00`);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  const previousEnd = new Date(start);
  previousEnd.setDate(previousEnd.getDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setDate(previousStart.getDate() - days + 1);
  return { start: localDateOnly(previousStart), end: localDateOnly(previousEnd) };
}

function emptyDoctor(name: string, branch: string): Omit<DoctorCompetitionScore, 'overallScore'> {
  return {
    name,
    branch,
    staffId: null,
    totalSales: 0,
    invoices: 0,
    avgInvoice: 0,
    growthRate: null,
    growthRateStatus: 'unavailable',
    listItems: 0,
    stagnantItems: 0,
    stagnantStatus: 'disabled',
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
    leaderboardEligible: false,
    avgInvoiceEligible: false,
    ineligibleReasons: [],
    reviewIssues: [],
  };
}

export function avgReview(row?: Pick<DoctorCompetitionScore, 'reviewCount' | 'reviewTotal'> | null) {
  return row?.reviewCount ? row.reviewTotal / row.reviewCount : 0;
}

function customerServiceAvg(row?: Pick<DoctorCompetitionScore, 'satisfactionCount' | 'satisfactionTotal'> | null) {
  return row?.satisfactionCount ? row.satisfactionTotal / row.satisfactionCount : 0;
}

async function safeSelect(table: string, build: (query: ReturnType<typeof supabase.from>) => unknown) {
  try {
    const result = await (build(supabase.from(table)) as PromiseLike<{ data: unknown; error: { message?: string } | null }>);
    if (result.error) return { data: [] as Row[], error: result.error.message || `تعذر تحميل ${table}` };
    return { data: (result.data || []) as Row[], error: null };
  } catch (error) {
    return { data: [] as Row[], error: error instanceof Error ? error.message : `تعذر تحميل ${table}` };
  }
}

function delayFallback<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs);
    promise
      .then((value) => resolve(value))
      .catch(() => resolve(fallback))
      .finally(() => clearTimeout(timer));
  });
}

async function fetchDoctorSalesRows(range: { start: string; end: string }, branch: string, errors: string[]) {
  const rows = (await fetchSalesInvoicesPagedSafe({
    startDate: range.start,
    endDate: range.end,
    branch: branch || undefined,
    selectOptions: INVOICE_SELECT_DOCTOR_OPTIONS,
    errors,
    noCache: false,
    pageSize: 1000,
  })) as Row[];
  return rows.filter((row) => {
    const day = invoiceDate(row);
    return day && day >= range.start && day <= range.end && !invoiceInvalid(row) && invoiceAmount(row) > 0;
  });
}

function buildWinners(rows: DoctorCompetitionScore[]): DoctorCompetitionWinners {
  const sales = [...rows].filter((row) => row.totalSales > 0).sort((a, b) => b.totalSales - a.totalSales)[0] || null;
  const averageInvoice = [...rows].filter((row) => row.avgInvoiceEligible).sort((a, b) => b.avgInvoice - a.avgInvoice)[0] || null;
  const incentive = [...rows].filter((row) => row.stagnantStatus === 'available').sort((a, b) => b.incentiveValue + b.listItems + b.stagnantItems - (a.incentiveValue + a.listItems + a.stagnantItems))[0] || null;
  const reviews = [...rows].filter((row) => row.reviewCount > 0).sort((a, b) => avgReview(b) - avgReview(a))[0] || null;
  const service = [...rows].filter((row) => row.completedFollowups > 0 || row.recoveredCustomers > 0).sort((a, b) => b.recoveredCustomers + b.completedFollowups - (a.recoveredCustomers + a.completedFollowups))[0] || null;
  const overall = rows[0] || null;
  return { sales, averageInvoice, avgInvoice: averageInvoice, incentive, stagnant: incentive, reviews, conversation: reviews, service, customerService: service, overall };
}

function normalizeScores(rows: Array<Omit<DoctorCompetitionScore, 'overallScore'>>): DoctorCompetitionScore[] {
  const hasIncentiveData = rows.some((row) => row.stagnantStatus === 'available');
  const max = {
    sales: Math.max(1, ...rows.map((row) => row.totalSales)),
    avgInvoice: Math.max(1, ...rows.filter((row) => row.invoices >= MIN_AVG_INVOICE_THRESHOLD).map((row) => row.avgInvoice)),
    incentive: Math.max(1, ...rows.map((row) => row.stagnantStatus === 'available' ? row.incentiveValue + row.listItems * 100 + row.stagnantItems * 100 : 0)),
    review: Math.max(1, ...rows.map(avgReview)),
    service: Math.max(1, ...rows.map((row) => row.completedFollowups + row.recoveredCustomers * 2 + customerServiceAvg(row))),
  };
  return rows.map((row) => {
    const salesScore = (row.totalSales / max.sales) * 100;
    const avgInvoiceScore = row.invoices >= MIN_AVG_INVOICE_THRESHOLD ? (row.avgInvoice / max.avgInvoice) * 100 : 0;
    const incentiveScore = hasIncentiveData && row.stagnantStatus === 'available' ? ((row.incentiveValue + row.listItems * 100 + row.stagnantItems * 100) / max.incentive) * 100 : 0;
    const reviewScore = (avgReview(row) / max.review) * 100;
    const serviceScore = ((row.completedFollowups + row.recoveredCustomers * 2 + customerServiceAvg(row)) / max.service) * 100;
    const incentiveWeight = hasIncentiveData ? 0.2 : 0;
    const totalWeight = 0.3 + 0.2 + incentiveWeight + 0.2 + 0.1;
    return { ...row, overallScore: (salesScore * 0.3 + avgInvoiceScore * 0.2 + incentiveScore * incentiveWeight + reviewScore * 0.2 + serviceScore * 0.1) / totalWeight };
  });
}

export async function getDoctorCompetitionMetrics(params: DoctorCompetitionParams = {}): Promise<DoctorCompetitionMetrics> {
  const range = rangeForDoctorCompetition(params.period, params.customStart, params.customEnd);
  const previous = previousRange(range);
  const selectedBranch = params.branch && params.branch !== ALL_BRANCHES ? normalizeBranchName(params.branch) : '';
  const userBranch = params.userBranch ? normalizeBranchName(params.userBranch) : '';
  const canSeeAll = params.canSeeAllBranches !== false;
  const errors: Record<string, string> = {};
  const sourceHealth: Record<string, 'ready' | 'empty' | 'unavailable'> = {};
  const map = new Map<string, Omit<DoctorCompetitionScore, 'overallScore'>>();
  const invoiceRowsWithoutDoctor = { count: 0 };

  const allowBranch = (branch: string) => {
    const normalized = normalizeBranchName(branch || '');
    if (selectedBranch && normalized !== selectedBranch) return false;
    if (!canSeeAll && userBranch && normalized && normalized !== userBranch) return false;
    return true;
  };
  const identityKey = (name: string, branch: string, staffId?: string | null) => staffId ? `staff:${staffId}|${branch}` : `name:${name}|${branch}`;
  const upsert = (name: string, branch: string, staffId?: string | null) => {
    const key = identityKey(name, branch, staffId);
    const current = map.get(key) || emptyDoctor(name, branch);
    if (staffId) current.staffId = staffId;
    map.set(key, current);
    return current;
  };

  const salesErrors: string[] = [];
  const [salesRows, reviewResult, followupResult, stagnantResult, listResult] = await Promise.all([
    fetchDoctorSalesRows(range, selectedBranch, salesErrors).catch((error) => {
      errors.sales_invoices = error instanceof Error ? error.message : 'تعذر تحميل مبيعات الدكاترة';
      return [] as Row[];
    }),
    safeSelect('conversation_sales_reviews', (query) => query.select('*').gte('conversation_date', range.start).lte('conversation_date', `${range.end}T23:59:59`).limit(2500)),
    safeSelect('daily_followups', (query) => query.select('*').gte('created_at', range.start).lte('created_at', `${range.end}T23:59:59`).limit(3500)),
    safeSelect('stagnant_medicine_dispenses', (query) => query.select('*').limit(2500)),
    safeSelect('incentive_medicine_sales', (query) => query.select('*').limit(2500)),
  ]);
  if (salesErrors.length) errors.sales_invoices = salesErrors.join(' | ');

  const previousRows = await delayFallback(fetchDoctorSalesRows(previous, selectedBranch, []), 2200, [] as Row[]);
  const previousSales = new Map<string, number>();

  for (const row of salesRows) {
    const branch = invoiceBranch(row);
    if (!allowBranch(branch)) continue;
    const staffId = rowStaffId(row);
    const rawName = row.normalized_seller_name || row.staff_name || getInvoiceSellerName(row);
    const name = invoiceDoctor(row);
    if (!rawName) invoiceRowsWithoutDoctor.count += 1;
    const current = upsert(name, branch, staffId);
    const amount = invoiceAmount(row);
    current.totalSales += amount;
    current.incentiveValue += Math.round(amount / 1000) * 3;
    const invoiceKey = invoiceIdentityKey(row);
    if (invoiceKey) current.linkedInvoiceCount += 1;
    current.invoices += invoiceKey ? 1 : 0;
  }

  for (const row of previousRows) {
    const branch = invoiceBranch(row);
    if (!allowBranch(branch)) continue;
    const name = invoiceDoctor(row);
    const key = identityKey(name, branch, rowStaffId(row));
    previousSales.set(key, (previousSales.get(key) || 0) + invoiceAmount(row));
  }
  sourceHealth.sales_invoices = errors.sales_invoices ? 'unavailable' : salesRows.length ? 'ready' : 'empty';

  if (reviewResult.error) errors.conversation_sales_reviews = reviewResult.error;
  sourceHealth.conversation_sales_reviews = reviewResult.error ? 'unavailable' : reviewResult.data.length ? 'ready' : 'empty';
  for (const review of reviewResult.data) {
    const branch = normalizeBranchName(review.branch || '') || text(review.branch) || 'غير محدد';
    if (!allowBranch(branch)) continue;
    const current = upsert(normalizeDoctorName(review.staff_name || review.doctor_name || review.employee_name || review.created_by_name), branch, rowStaffId(review));
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
    const branch = normalizeBranchName(followup.branch || '') || text(followup.branch) || 'غير محدد';
    if (!allowBranch(branch)) continue;
    const current = upsert(normalizeDoctorName(followup.responsible_name || followup.assigned_doctor || followup.assigned_to || followup.evaluated_by_name || followup.updated_by), branch, rowStaffId(followup));
    current.followups += 1;
    if (followup.completed_at || /تم|completed|closed|done/i.test(text(followup.status || followup.followup_status))) current.completedFollowups += 1;
    if (followup.purchase_after_followup) {
      current.recoveredCustomers += 1;
      current.followupSales += num(followup.purchase_amount);
    }
  }

  const stagnantRows = stagnantResult.data;
  const listRows = listResult.data;
  const incentiveAvailable = !stagnantResult.error && !listResult.error && (stagnantRows.length > 0 || listRows.length > 0);
  sourceHealth.stagnant_medicine_dispenses = stagnantResult.error ? 'unavailable' : stagnantRows.length ? 'ready' : 'empty';
  sourceHealth.incentive_medicine_sales = listResult.error ? 'unavailable' : listRows.length ? 'ready' : 'empty';

  for (const row of stagnantRows) {
    const branch = normalizeBranchName(row.branch || '') || text(row.branch) || 'غير محدد';
    if (!allowBranch(branch)) continue;
    const current = upsert(normalizeDoctorName(row.staff_name || row.doctor_name || row.responsible_doctor_name || row.responsible_doctor), branch, rowStaffId(row));
    current.stagnantStatus = 'available';
    current.stagnantItems += 1;
    current.totalQuantity += num(row.quantity || row.sold_quantity || row.dispensed_quantity);
    current.incentiveValue += num(row.incentive_amount || row.reward_amount || row.total_incentive || row.amount);
  }

  for (const row of listRows) {
    const branch = normalizeBranchName(row.branch || '') || text(row.branch) || 'غير محدد';
    if (!allowBranch(branch)) continue;
    const current = upsert(normalizeDoctorName(row.staff_name || row.doctor_name || row.responsible_doctor_name || row.responsible_doctor), branch, rowStaffId(row));
    current.stagnantStatus = 'available';
    current.listItems += 1;
    current.totalQuantity += num(row.quantity || row.sold_quantity);
    current.incentiveValue += num(row.incentive_amount || row.reward_amount || row.total_incentive || row.amount);
  }

  const rawRows = [...map.entries()].map(([key, row]) => {
    const previousTotal = previousSales.get(key) || 0;
    const ineligibleReasons: string[] = [];
    const reviewIssues: string[] = [...row.reviewIssues];
    row.invoices = Math.max(0, row.invoices);
    row.avgInvoice = row.invoices ? row.totalSales / row.invoices : 0;
    if (isUnknownDoctorName(row.name)) ineligibleReasons.push('دكتور غير محدد');
    if (!row.totalSales) ineligibleReasons.push('لا توجد مبيعات في الفترة');
    if (row.totalSales > 0 && row.totalSales < MINIMUM_SALES_FOR_LEADERBOARD) reviewIssues.push('مبيعات أقل من حد المنافسة');
    if (row.invoices > 0 && row.invoices < MINIMUM_INVOICES_FOR_LEADERBOARD) reviewIssues.push('عدد فواتير قليل');
    if (!previousTotal) reviewIssues.push('growth غير متاح');
    if (!incentiveAvailable) reviewIssues.push('الرواكد غير مربوطة');
    return {
      ...row,
      growthRate: previousTotal ? ((row.totalSales - previousTotal) / previousTotal) * 100 : null,
      growthRateStatus: previousTotal ? 'available' as const : 'unavailable' as const,
      stagnantStatus: incentiveAvailable ? row.stagnantStatus : 'disabled' as const,
      avgInvoiceEligible: row.invoices >= MIN_AVG_INVOICE_THRESHOLD,
      leaderboardEligible: ineligibleReasons.length === 0,
      ineligibleReasons: Array.from(new Set(ineligibleReasons)),
      reviewIssues: Array.from(new Set(reviewIssues)),
    };
  });

  const rows = normalizeScores(rawRows).sort((a, b) => b.overallScore - a.overallScore);
  const eligibleRows = rows.filter((row) => row.leaderboardEligible);
  const reviewRows = [...rows.filter((row) => !row.leaderboardEligible), ...eligibleRows.filter((row) => row.reviewIssues.length > 0)].sort((a, b) => b.totalSales - a.totalSales);
  const warnings = Array.from(new Set([...reviewRows.flatMap((row) => row.reviewIssues), ...reviewRows.flatMap((row) => row.ineligibleReasons)]));
  const status = errors.sales_invoices ? 'partial' : rows.length && eligibleRows.length ? 'ready' : rows.length ? 'partial' : 'empty';
  const totalDoctorSales = rows.reduce((sum, row) => sum + row.totalSales, 0);

  return {
    rows,
    eligibleRows,
    reviewRows,
    winners: buildWinners(rows),
    status,
    warnings,
    metadata: {
      minimumInvoicesForLeaderboard: MINIMUM_INVOICES_FOR_LEADERBOARD,
      minimumSalesForLeaderboard: MINIMUM_SALES_FOR_LEADERBOARD,
      minimumInvoicesForAvgInvoice: MIN_AVG_INVOICE_THRESHOLD,
      stagnantEnabled: incentiveAvailable,
      previousRange: previous,
      requestedPeriod: params.period || 'cycle',
      selectedBranch: selectedBranch || null,
      hasReviewData: sourceHealth.conversation_sales_reviews === 'ready',
      hasFollowupData: sourceHealth.daily_followups === 'ready',
      hasIncentiveData: incentiveAvailable,
      salesInvoicesFetchedCount: salesRows.length,
      doctorSalesRowsCount: rows.length,
      totalDoctorSales,
      invoiceRowsWithoutDoctorCount: invoiceRowsWithoutDoctor.count,
      totalInvoicesCountFromDoctorRows: rows.reduce((sum, row) => sum + row.invoices, 0),
      invoiceCountMethod: 'distinct invoice_number/invoice_no/id per doctor+branch where available',
      topRawDoctorSalesPreview: rows.slice(0, 5).map((row) => `${row.name} ${row.totalSales.toFixed(2)}`),
      noWinnersReasons: eligibleRows.length === 0 && rows.length > 0 ? ['no eligible rows'] : [],
    },
    range,
    sourceHealth,
    errors,
  };
}
