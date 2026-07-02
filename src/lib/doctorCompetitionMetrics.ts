import { supabase } from '@/lib/supabase';
import { normalizeBranchName } from '@/lib/branch';
import { getPharmacyCycleRange } from '@/lib/pharmacy-cycle';
import { fetchSalesInvoicesPagedSafe } from '@/lib/salesInvoiceQueries';

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

const INVOICE_SELECT_DOCTOR =
  'id,invoice_number,invoice_no,invoice_date,sale_date,branch,branch_name,seller_name,normalized_seller_name,staff_name,staff_id,net_amount,net_total,total_amount,amount,customer_code';

export function pickInvoiceAmount(row: Record<string, unknown>) {
  const candidates = [
    row.net_amount,
    row.net_total,
    row.total_amount,
    row.amount,
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
    row.normalized_seller_name || row.staff_name || row.seller_name || ''
  );
}

function rowStaffId(row: Record<string, unknown>) {
  return text(row.staff_id || row.doctor_id || row.seller_id || row.employee_id || row.responsible_staff_id);
}

function comparableDoctorName(name: string) {
  return normalizeDoctorName(name).replace(/^د\/\s*/, '').trim();
}

function isUnknownDoctorName(name: string) {
  const comparable = comparableDoctorName(name);
  return !comparable || comparable === 'غير محدد' || comparable === 'غير محدد دكتور';
}

function invoiceBranch(row: Record<string, unknown>) {
  return text(row.branch_name || row.branch || row.store_branch) || 'غير محدد';
}

function invoiceTypeIndicatesReturnOrCancel(row: Record<string, unknown>) {
  const value = text(row.invoice_type).toLowerCase();
  return /return|refund|cancel|cancelled|مرتجع|إلغاء|ملغي/.test(value);
}

function invoiceIdentityKey(row: Record<string, unknown>) {
  return String(row.invoice_number ?? row.invoice_no ?? row.id ?? '').trim();
}

function invoiceStatusInvalid(row: Record<string, unknown>) {
  const saveStatus = text(row.save_status).toLowerCase();
  const importStatus = text(row.import_validation_status).toLowerCase();
  return /invalid|error|failed|خطأ|فشل/.test(saveStatus) || /invalid|error|failed|خطأ|فشل/.test(importStatus);
}

interface DoctorSalesTruth {
  summary: { sales_total: number };
  doctorSales: Array<{
    doctor_name: string;
    branch: string;
    sales_total: number;
    invoices_count: number;
    avg_invoice: number;
    incentive_value: number;
    staffId?: string | null;
  }>;
  reconciliation: {
    rowsRead: number;
    selectedStartDate: string;
    selectedEndDate: string;
  };
  salesInvoicesFetchedCount: number;
  doctorSalesRowsCount: number;
  invoiceRowsWithoutDoctorCount: number;
  topRawDoctorSalesPreview: string[];
}

async function fetchDoctorSalesTruth(
  range: { start: string; end: string },
  branch: string,
  errors: string[]
): Promise<DoctorSalesTruth> {
  const rows = (await fetchSalesInvoicesPagedSafe({
    startDate: range.start,
    endDate: range.end,
    branch: branch || undefined,
    selectOptions: [INVOICE_SELECT_DOCTOR],
    errors,
    noCache: true,
  })) as Array<Record<string, unknown>>;

  const salesInvoicesFetchedCount = rows.length;
  const cycleRows = rows.filter((row) => {
    const day = invoiceDate(row);
    return (
      day &&
      day >= range.start &&
      day <= range.end &&
      !invoiceTypeIndicatesReturnOrCancel(row) &&
      !invoiceStatusInvalid(row) &&
      invoiceAmount(row) > 0
    );
  });

  const doctorMap = new Map<
    string,
    {
      doctor_name: string;
      branch: string;
      sales_total: number;
      invoices_count: number;
      avg_invoice: number;
      incentive_value: number;
      staffId?: string | null;
    }
  >();
  const doctorInvoiceKeys = new Map<string, Set<string>>();
  let allSalesTotal = 0;
  let invoiceRowsWithoutDoctorCount = 0;

  for (const row of cycleRows) {
    const staffId = rowStaffId(row);
    const displayName = row.normalized_seller_name || row.staff_name || row.seller_name || '';
    const doctor = normalizeDoctorName(displayName);
    const branchName = normalizeBranchName(row.branch || '') || invoiceBranch(row);
    const doctorKey = staffId ? `staff:${staffId}` : `name:${doctor}`;
    const invoiceId = invoiceIdentityKey(row);
    const invoiceCountKey = `${doctorKey}|${branchName}|${invoiceId}`;
    const amount = invoiceAmount(row);
    allSalesTotal += amount;
    if (!displayName) invoiceRowsWithoutDoctorCount += 1;

    const rowKey = `${doctorKey}__branch:${branchName}`;
    const doctorRow = doctorMap.get(rowKey) || {
      doctor_name: doctor,
      branch: branchName,
      sales_total: 0,
      invoices_count: 0,
      avg_invoice: 0,
      incentive_value: 0,
      staffId: staffId || null,
    };

    doctorRow.sales_total += amount;
    doctorMap.set(rowKey, doctorRow);
    if (invoiceId) {
      if (!doctorInvoiceKeys.has(rowKey)) doctorInvoiceKeys.set(rowKey, new Set());
      doctorInvoiceKeys.get(rowKey)?.add(invoiceCountKey);
    }
  }

  const doctorSales = [...doctorMap.values()].map((row) => ({
    ...row,
    invoices_count: doctorInvoiceKeys.get(
      row.staffId ? `staff:${row.staffId}__branch:${row.branch}` : `name:${row.doctor_name}__branch:${row.branch}`
    )?.size || 0,
    avg_invoice: row.invoices_count ? row.sales_total / row.invoices_count : 0,
  }));

  return {
    summary: { sales_total: allSalesTotal },
    doctorSales: doctorSales.sort((a, b) => b.sales_total - a.sales_total),
    reconciliation: {
      rowsRead: cycleRows.length,
      selectedStartDate: range.start,
      selectedEndDate: range.end,
    },
    salesInvoicesFetchedCount,
    doctorSalesRowsCount: doctorSales.length,
    invoiceRowsWithoutDoctorCount,
    topRawDoctorSalesPreview: doctorSales.slice(0, 5).map((row) => `${row.doctor_name} ${row.sales_total.toFixed(2)}`),
  };
}

// لا يوجد عمود إلغاء صريح في sales_invoices، لذلك يتم الاستبعاد بقيمة صافية <= 0 وبـ invoice_type عند وجود دلالة نصية.

function localDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function currentCycle() {
  return getPharmacyCycleRange();
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

function sourceDate(row: Record<string, unknown>) {
  return text(row.sale_date || row.invoice_date || row.dispense_date || row.sold_at || row.created_at || row.date).slice(0, 10);
}

function inRange(row: Record<string, unknown>, range: { start: string; end: string }) {
  const day = sourceDate(row);
  return !day || (day >= range.start && day <= range.end);
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

export function customerServiceAvg(row?: Pick<DoctorCompetitionScore, 'satisfactionCount' | 'satisfactionTotal'> | null) {
  return row?.satisfactionCount ? row.satisfactionTotal / row.satisfactionCount : 0;
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
    const incentiveScore = hasIncentiveData && row.stagnantStatus === 'available'
      ? ((row.incentiveValue + row.listItems * 100 + row.stagnantItems * 100) / max.incentive) * 100
      : 0;
    const reviewScore = (avgReview(row) / max.review) * 100;
    const serviceScore = ((row.completedFollowups + row.recoveredCustomers * 2 + customerServiceAvg(row)) / max.service) * 100;
    const incentiveWeight = hasIncentiveData ? 0.2 : 0;
    const totalWeight = 0.3 + 0.2 + incentiveWeight + 0.2 + 0.1;
    return {
      ...row,
      overallScore:
        (salesScore * 0.3 +
          avgInvoiceScore * 0.2 +
          incentiveScore * incentiveWeight +
          reviewScore * 0.2 +
          serviceScore * 0.1) /
        totalWeight,
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
  const sales = [...rows]
    .filter((row) => row.totalSales > 0 && row.invoices > 0)
    .sort((a, b) => b.totalSales - a.totalSales)[0] || null;
  const averageInvoice = [...rows]
    .filter((row) => row.avgInvoiceEligible)
    .sort((a, b) => b.avgInvoice - a.avgInvoice)[0] || null;
  const incentive = [...rows].filter((row) => row.stagnantStatus === 'available').sort((a, b) => b.incentiveValue + b.listItems + b.stagnantItems - (a.incentiveValue + a.listItems + a.stagnantItems))[0] || null;
  const reviews = [...rows].filter((row) => row.reviewCount > 0).sort((a, b) => avgReview(b) - avgReview(a))[0] || null;
  const service = [...rows].filter((row) => row.completedFollowups > 0 || row.recoveredCustomers > 0).sort((a, b) => b.recoveredCustomers + b.completedFollowups - (a.recoveredCustomers + a.completedFollowups))[0] || null;
  const overall = rows[0] || null;
  return {
    sales,
    averageInvoice,
    avgInvoice: averageInvoice,
    incentive,
    stagnant: incentive,
    reviews,
    conversation: reviews,
    service,
    customerService: service,
    overall,
  };
}

export async function getDoctorCompetitionMetrics(params: DoctorCompetitionParams = {}): Promise<DoctorCompetitionMetrics> {
  const range = rangeForDoctorCompetition(params.period, params.customStart, params.customEnd);
  const previous = previousRange(range);
  const selectedBranch = params.branch && params.branch !== ALL_BRANCHES ? normalizeBranchName(params.branch) : '';
  const userBranch = params.userBranch ? normalizeBranchName(params.userBranch) : '';
  const canSeeAll = params.canSeeAllBranches !== false;
  const map = new Map<string, Omit<DoctorCompetitionScore, 'overallScore'>>();
  const errors: Record<string, string> = {};
  const sourceHealth: Record<string, 'ready' | 'empty' | 'unavailable'> = {};
  const allowBranch = (branch: string) => {
    const normalizedBranch = normalizeBranchName(branch || '');
    if (selectedBranch && normalizedBranch !== selectedBranch) return false;
    if (!canSeeAll && userBranch && normalizedBranch && normalizedBranch !== userBranch) return false;
    return true;
  };
  const identityKey = (name: string, branch: string, staffId?: string | null) =>
    staffId ? `staff:${staffId}|${branch}` : `name:${name}|${branch}`;
  const upsert = (name: string, branch: string, staffId?: string | null) => {
    const key = identityKey(name, branch, staffId);
    const current = map.get(key) || emptyDoctor(name, branch);
    if (staffId) current.staffId = staffId;
    map.set(key, current);
    return current;
  };

  const [salesTruthResult, previousSalesTruthResult, reviewResult, followupResult, stagnantResult, listResult] = await Promise.all([
    (async () => {
      try {
        const truth = await fetchDoctorSalesTruth(range, selectedBranch, []);
        return { truth, error: null as string | null };
      } catch (error) {
        return {
          truth: null,
          error: error instanceof Error ? error.message : 'تعذر تحميل مبيعات الدكاترة من sales_invoices',
        };
      }
    })(),
    (async () => {
      try {
        const truth = await fetchDoctorSalesTruth(previous, selectedBranch, []);
        return { truth, error: null as string | null };
      } catch (error) {
        return {
          truth: null,
          error: error instanceof Error ? error.message : 'تعذر تحميل مبيعات الفترة السابقة',
        };
      }
    })(),
    safeSelect('conversation_sales_reviews', (query) => query.select('*').gte('conversation_date', range.start).lte('conversation_date', range.end).limit(4000)),
    safeSelect('daily_followups', (query) => query.select('*').gte('created_at', range.start).lte('created_at', `${range.end}T23:59:59`).limit(7000)),
    safeSelect('stagnant_medicine_dispenses', (query) => query.select('*').limit(5000)),
    safeSelect('incentive_medicine_sales', (query) => query.select('*').limit(5000)),
  ]);
  const previousSales = new Map<string, number>();

  if (salesTruthResult.error) errors.sales_invoices = salesTruthResult.error;
  const truth = salesTruthResult.truth;
  sourceHealth.sales_invoices = salesTruthResult.error ? 'unavailable' : truth?.doctorSales?.length ? 'ready' : 'empty';
  if (previousSalesTruthResult.error) errors.previous_sales_invoices = previousSalesTruthResult.error;

  for (const doctorRow of truth?.doctorSales || []) {
    const name = normalizeDoctorName(doctorRow.doctor_name);
    const branch = normalizeBranchName(doctorRow.branch || '') || text(doctorRow.branch) || 'غير محدد';
    if (!allowBranch(branch)) continue;
    const current = upsert(name, branch, doctorRow.staffId);
    current.totalSales += num(doctorRow.sales_total);
    current.invoices += num(doctorRow.invoices_count);
    current.avgInvoice = num(doctorRow.avg_invoice);
    current.incentiveValue += num(doctorRow.incentive_value);
  }

  for (const doctorRow of previousSalesTruthResult.truth?.doctorSales || []) {
    const name = normalizeDoctorName(doctorRow.doctor_name);
    const branch = normalizeBranchName(doctorRow.branch || '') || text(doctorRow.branch) || 'غير محدد';
    if (!allowBranch(branch)) continue;
    previousSales.set(identityKey(name, branch), (previousSales.get(identityKey(name, branch)) || 0) + num(doctorRow.sales_total));
  }

  if (import.meta.env.DEV) {
    const salesTotal = [...map.values()].reduce((sum, row) => sum + row.totalSales, 0);
    console.info('[DoctorCompetitionMetrics] sales source', {
      range,
      rowsRead: truth?.reconciliation?.rowsRead || 0,
      dashboardTotal: truth?.summary?.sales_total || 0,
      doctorRows: truth?.doctorSales?.length || 0,
      doctorSalesTotal: salesTotal,
      topDoctors: [...map.values()].slice(0, 5).map((row) => ({ name: row.name, branch: row.branch, sales: row.totalSales, invoices: row.invoices })),
    });
  }

  if (reviewResult.error) errors.conversation_sales_reviews = reviewResult.error;
  sourceHealth.conversation_sales_reviews = reviewResult.error ? 'unavailable' : reviewResult.data.length ? 'ready' : 'empty';
  for (const review of reviewResult.data) {
    const name = normalizeDoctorName(review.staff_name || review.doctor_name || review.employee_name || review.created_by_name);
    const branch = normalizeBranchName(review.branch || '') || text(review.branch) || 'غير محدد';
    if (!allowBranch(branch)) continue;
    const current = upsert(name, branch, rowStaffId(review));
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
    const branch = normalizeBranchName(followup.branch || '') || text(followup.branch) || 'غير محدد';
    if (!allowBranch(branch)) continue;
    const current = upsert(name, branch, rowStaffId(followup));
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

  if (stagnantResult.error) errors.stagnant_medicine_dispenses = stagnantResult.error;
  if (listResult.error) errors.incentive_medicine_sales = listResult.error;
  const stagnantRows = stagnantResult.data.filter((row) => inRange(row, range));
  const listRows = listResult.data.filter((row) => inRange(row, range));
  const incentiveAvailable = !stagnantResult.error && !listResult.error && (stagnantRows.length > 0 || listRows.length > 0);
  sourceHealth.stagnant_medicine_dispenses = stagnantResult.error ? 'unavailable' : stagnantRows.length ? 'ready' : 'empty';
  sourceHealth.incentive_medicine_sales = listResult.error ? 'unavailable' : listRows.length ? 'ready' : 'empty';

  for (const row of stagnantRows) {
    const staffId = rowStaffId(row);
    const name = normalizeDoctorName(row.staff_name || row.doctor_name || row.responsible_doctor_name || row.responsible_doctor);
    const branch = normalizeBranchName(row.branch || '') || text(row.branch) || 'غير محدد';
    if (!allowBranch(branch)) continue;
    const current = upsert(name, branch, staffId);
    current.stagnantStatus = 'available';
    current.stagnantItems += 1;
    current.totalQuantity += num(row.quantity || row.sold_quantity || row.dispensed_quantity);
    current.incentiveValue += num(row.incentive_amount || row.reward_amount || row.total_incentive || row.amount);
  }

  for (const row of listRows) {
    const staffId = rowStaffId(row);
    const name = normalizeDoctorName(row.staff_name || row.doctor_name || row.responsible_doctor_name || row.responsible_doctor);
    const branch = normalizeBranchName(row.branch || '') || text(row.branch) || 'غير محدد';
    if (!allowBranch(branch)) continue;
    const current = upsert(name, branch, staffId);
    current.stagnantStatus = 'available';
    current.listItems += 1;
    current.linkedInvoiceCount += num(row.invoices_count || row.linked_invoice_count);
    current.totalQuantity += num(row.quantity || row.sold_quantity);
    current.incentiveValue += num(row.incentive_amount || row.reward_amount || row.total_incentive || row.amount);
  }

  const rawRows = [...map.entries()];
  const branchesByName = new Map<string, Set<string>>();
  for (const [, row] of rawRows) {
    const key = comparableDoctorName(row.name);
    if (!branchesByName.has(key)) branchesByName.set(key, new Set());
    branchesByName.get(key)?.add(row.branch);
  }
  const similarNames = new Set<string>();
  const names = [...branchesByName.keys()].filter((name) => name && name !== 'غير محدد');
  for (const name of names) {
    for (const other of names) {
      if (name === other) continue;
      const shortEnough = name.split(' ').length <= 2 || other.split(' ').length <= 2;
      if (shortEnough && (name.includes(other) || other.includes(name))) {
        similarNames.add(name);
        similarNames.add(other);
      }
    }
  }

  const withAverages = rawRows.map(([key, row]) => {
    const previousTotal = previousSales.get(key) || 0;
    const reviewIssues = [...row.reviewIssues];
    const ineligibleReasons: string[] = [];
    const comparableName = comparableDoctorName(row.name);
    if (isUnknownDoctorName(row.name)) reviewIssues.push('دكتور غير محدد');
    if (row.branch === 'غير محدد' || row.branch === 'غير محدد الفرع') reviewIssues.push('فرع غير محدد');
    if (row.branch === 'متعدد الفروع') reviewIssues.push('متعدد الفروع');
    if (!row.staffId && (branchesByName.get(comparableName)?.size || 0) > 1) {
      reviewIssues.push('اسم مكرر في أكثر من فرع - يحتاج ربط دكتور');
    }
    if (!row.staffId && similarNames.has(comparableName)) {
      reviewIssues.push('أسماء متشابهة تحتاج ربط دكتور');
    }
    if (!previousTotal) reviewIssues.push('growth غير متاح');
    if (!incentiveAvailable) reviewIssues.push('الرواكد غير مربوطة');
    if (row.invoices > 0 && row.invoices < MIN_AVG_INVOICE_THRESHOLD) reviewIssues.push('عدد فواتير غير كاف للمقارنة بمتوسط الفاتورة');
    if (row.invoices > 0 && row.invoices < 5 && row.totalSales / row.invoices >= 10000) reviewIssues.push('متوسط فاتورة outlier');
    if (!row.totalSales && !row.reviewCount && !row.followups) reviewIssues.push('لا توجد مبيعات أو تقييمات أو متابعات');
    if (isUnknownDoctorName(row.name)) ineligibleReasons.push('دكتور غير محدد');
    if (row.branch === 'غير محدد' || row.branch === 'غير محدد الفرع' || row.branch === 'متعدد الفروع') {
      ineligibleReasons.push('فرع غير صالح');
    }
    if (row.totalSales <= 0) ineligibleReasons.push('لا توجد مبيعات في الفترة');
    const avgInvoiceEligible = row.invoices >= MIN_AVG_INVOICE_THRESHOLD;
    return {
      ...row,
      avgInvoice: row.invoices ? row.totalSales / row.invoices : 0,
      growthRate: previousTotal ? ((row.totalSales - previousTotal) / previousTotal) * 100 : null,
      growthRateStatus: previousTotal ? 'available' as const : 'unavailable' as const,
      stagnantStatus: incentiveAvailable ? row.stagnantStatus : 'disabled' as const,
      avgInvoiceEligible,
      leaderboardEligible: ineligibleReasons.length === 0,
      ineligibleReasons: Array.from(new Set(ineligibleReasons)),
      reviewIssues: Array.from(new Set(reviewIssues)),
    };
  });
  const rows = normalizeScores(withAverages).sort((a, b) => b.overallScore - a.overallScore);
  const eligibleRows = rows.filter((row) => row.leaderboardEligible);
  const reviewRows = [
    ...rows.filter((row) => !row.leaderboardEligible),
    ...eligibleRows.filter((row) => row.reviewIssues.length > 0),
  ].sort((a, b) => b.totalSales - a.totalSales);
  const warnings = Array.from(
    new Set([
      ...reviewRows.flatMap((row) => row.reviewIssues),
      ...reviewRows.flatMap((row) => row.ineligibleReasons),
      ...(eligibleRows.length === 0 && rows.length > 0 ? ['تم العثور على دكاترة في الفترة الحالية، لكن لا يوجد دكاترة مؤهلين لقائمة المنافسة الرئيسية.'] : []),
    ])
  );

  if (import.meta.env.DEV && eligibleRows.length === 0 && rows.length > 0) {
    console.warn('[DoctorCompetitionMetrics] no eligible winners', {
      range,
      totalRows: rows.length,
      reviewRows: reviewRows.length,
      warnings,
      errors,
      sourceHealth,
    });
  }

  const doctorSalesMissing = truth?.summary?.sales_total > 0 && rows.length === 0 && !errors.sales_invoices;
  if (doctorSalesMissing) {
    warnings.push('Dashboard sales exist but doctor sales aggregation returned zero');
  }

  const status = errors.sales_invoices
    ? 'failed'
    : rows.length && !eligibleRows.length
      ? 'partial'
      : eligibleRows.length
        ? (Object.keys(errors).length ? 'partial' : 'ready')
        : 'empty';
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
      salesInvoicesFetchedCount: truth?.salesInvoicesFetchedCount || 0,
      doctorSalesRowsCount: truth?.doctorSalesRowsCount || 0,
      totalDoctorSales: truth?.summary?.sales_total || 0,
      invoiceRowsWithoutDoctorCount: truth?.invoiceRowsWithoutDoctorCount || 0,
      totalInvoicesCountFromDoctorRows: truth?.doctorSales?.reduce((sum, row) => sum + (row.invoices_count || 0), 0) || 0,
      invoiceCountMethod: 'distinct invoice_number/invoice_no/id per doctor+branch',
      topRawDoctorSalesPreview: truth?.topRawDoctorSalesPreview || [],
      noWinnersReasons: [
        ...(eligibleRows.length === 0 && rows.length > 0 ? ['no eligible rows'] : []),
        ...(doctorSalesMissing ? ['Dashboard sales exist but doctor sales aggregation returned zero'] : []),
      ],
    },
    range,
    sourceHealth,
    errors,
  };
}

export async function getDoctorCompetitionWinners(params: DoctorCompetitionParams = {}) {
  return (await getDoctorCompetitionMetrics(params)).winners;
}

export async function getDoctorCompetitionTopList(params: DoctorCompetitionParams & { limit?: number } = {}) {
  const metrics = await getDoctorCompetitionMetrics(params);
  return metrics.rows.slice(0, params.limit || 5);
}
