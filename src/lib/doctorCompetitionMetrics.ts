import { normalizeBranchName } from '@/lib/branch';
import { isCompletedFollowup } from '@/lib/customerFollowupCore';
import { getPharmacyCycleRange } from '@/lib/pharmacy-cycle';
import { withTimeout } from '@/lib/performance';
import { fetchSalesInvoicesPagedSafe } from '@/lib/salesInvoiceQueries';
import { getInvoiceAmount, getInvoiceBranch, getInvoiceDay, getInvoiceId, getInvoiceSellerName } from '@/lib/invoices/invoiceCore';
import { supabase } from '@/lib/supabase';

// سقف داخلي قصير لخطوة التجميع السريع (RPC) لوحدها. لو الـRPC اتأخر أو علّق، بنعدّي
// بسرعة على مسار الفواتير الاحتياطي بدل ما نستهلك أغلب مهلة الـ20 ثانية الكلية
// ونوصل لفشل تام بدون داعي — ده كان السبب الرئيسي لفشل تحميل القسم أحيانًا.
const AGGREGATE_TIMEOUT_MS = 8000;
// فترة المقارنة (growthRate) اختيارية بحتة — الحقل ده مش معروض في أي مكان في اللوحة
// حاليًا (تم التأكد بالبحث في كل الاستخدامات). قبل كده كانت فترة الحالية والسابقة
// بتتنفذا مع بعض في Promise.all واحد؛ لو أي واحدة فيهم اتأخرت، الاتنين كانوا
// بيتجاهلوا سوا ويقع القسم كله على مسار الفواتير الخام الأتقل *لفترتين* بدل واحدة —
// وده كان بيضاعف فرصة تجاوز مهلة الـ20 ثانية الكلية بدون أي فايدة ظاهرة للمستخدم.
// دلوقتي فترة الحالية هي المسار الحرج الوحيد؛ فترة المقارنة best-effort مستقل
// تمامًا بمهلة أقصر، ولو فشلت أو اتأخرت بتوصل "غير متاحة" من غير ما تفعّل مسار
// الفواتير الخام الأتقل خالص.
const PREVIOUS_AGGREGATE_TIMEOUT_MS = 5000;
// get_eligible_doctor_accounts كانت بتتنفذ من غير أي مهلة زمنية — لو تعلّقت لأي
// سبب كانت قادرة تستهلك كل الـ20 ثانية بمفردها من غير أي مسار احتياطي.
const ACCOUNTS_TIMEOUT_MS = 6000;

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
  competitionPoints: number;
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
    eligibleAccountsCount: number;
    salesSource: 'aggregate_rpc' | 'invoice_fallback';
  };
  range: { start: string; end: string };
  sourceHealth: Record<string, 'ready' | 'empty' | 'unavailable'>;
  errors: Record<string, string>;
};

export const MINIMUM_INVOICES_FOR_LEADERBOARD = 1;
export const MINIMUM_SALES_FOR_LEADERBOARD = 0;
export const MIN_AVG_INVOICE_THRESHOLD = 2;
export const ALL_BRANCHES = 'كل الفروع';

const PARTICIPATING_ROLES = new Set([
  'pharmacist',
  'shift_supervisor',
  'shift_supervisor_morning',
  'shift_supervisor_evening',
]);

const INVOICE_SELECT_DOCTOR_OPTIONS = [
  'id,invoice_number,invoice_no,invoice_date,sale_date,branch,branch_name,seller_name,normalized_seller_name,staff_name,staff_id,doctor_id,seller_id,employee_id,net_amount,net_total,total_amount,amount,gross_amount,gross_total,discounted_amount,customer_code,invoice_type,status,save_status',
  'id,invoice_number,invoice_no,invoice_date,sale_date,branch,branch_name,seller_name,normalized_seller_name,staff_name,net_amount,net_total,total_amount,amount,gross_amount,gross_total,discounted_amount,customer_code,invoice_type,status,save_status',
  'id,invoice_number,invoice_no,invoice_date,branch,branch_name,seller_name,staff_name,net_amount,total_amount,amount,discounted_amount,customer_code',
  'id,invoice_date,branch,seller_name,amount,total_amount,customer_code',
];

type Row = Record<string, unknown>;
type EligibleDoctor = { staffId: string; name: string; branch: string };
type DoctorSalesAggregate = {
  doctor_name?: string | null;
  branch?: string | null;
  sales_total?: number | string | null;
  invoices_count?: number | string | null;
};

const SYSTEM_GENERIC_CUSTOMER_CODES = new Set(['54', '12820', '10', '170', '5']);

function text(value: unknown) {
  return String(value ?? '').trim();
}

function num(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function truthy(value: unknown, fallback = false) {
  if (typeof value === 'boolean') return value;
  const normalized = text(value).toLowerCase();
  if (['true', '1', 'yes', 'active', 'نعم'].includes(normalized)) return true;
  if (['false', '0', 'no', 'inactive', 'لا'].includes(normalized)) return false;
  return fallback;
}

function localDateOnly(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function normalizePlain(value: unknown) {
  return text(value)
    .replace(/[ًٌٍَُِّْـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[.،,:;_\-/()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function normalizeDoctorName(value: unknown) {
  const cleaned = normalizePlain(value).replace(/^(?:الدكتور|دكتوره|دكتور|د\s*\/?|د\.|dr)\s*/i, '').trim();
  return cleaned ? `د/ ${cleaned}` : 'غير محدد';
}

function comparableDoctorName(value: unknown) {
  return normalizeDoctorName(value).replace(/^د\/\s*/, '').trim();
}

function firstNameKey(value: unknown) {
  return comparableDoctorName(value).split(' ').filter(Boolean)[0] || '';
}

function isUnknownDoctorName(value: unknown) {
  const comparable = comparableDoctorName(value);
  return !comparable || comparable === 'غير محدد' || comparable === 'غير محدد دكتور';
}

function rowStaffId(row: Row) {
  return text(row.staff_id || row.doctor_id || row.seller_id || row.employee_id || row.responsible_staff_id || row.reviewed_staff_id || row.assigned_staff_id);
}

function invoiceDate(row: Row) {
  return getInvoiceDay(row) || '';
}

function invoiceBranch(row: Row) {
  return normalizeBranchName(getInvoiceBranch(row)) || text(getInvoiceBranch(row)) || 'غير محدد';
}

function invoiceDoctor(row: Row) {
  return normalizeDoctorName(row.normalized_seller_name || row.staff_name || getInvoiceSellerName(row));
}

export function pickInvoiceAmount(row: Row) {
  return getInvoiceAmount(row);
}

function invoiceIdentityKey(row: Row) {
  const branch = invoiceBranch(row);
  const number = getInvoiceId(row);
  const day = invoiceDate(row);
  if (number) return `${branch}|${number}|${day}`;
  return getInvoiceId(row) || text(row.id);
}

function invoiceInvalid(row: Row) {
  const raw = `${text(row.invoice_type)} ${text(row.status)} ${text(row.save_status)}`.toLowerCase();
  return /return|refund|cancel|cancelled|مرتجع|الغاء|إلغاء|ملغي|invalid|failed|error|فشل|خطأ/.test(raw);
}

function isSystemGenericInvoice(row: Row) {
  return SYSTEM_GENERIC_CUSTOMER_CODES.has(text(row.customer_code));
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

function emptyDoctor(doctor: EligibleDoctor): Omit<DoctorCompetitionScore, 'overallScore' | 'competitionPoints'> {
  return {
    name: doctor.name,
    branch: doctor.branch,
    staffId: doctor.staffId || null,
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
    leaderboardEligible: true,
    avgInvoiceEligible: false,
    ineligibleReasons: [],
    reviewIssues: [],
  };
}

export function avgReview(row?: Pick<DoctorCompetitionScore, 'reviewCount' | 'reviewTotal'> | null) {
  return row?.reviewCount ? row.reviewTotal / row.reviewCount : 0;
}

async function safeSelect(table: string, build: (query: ReturnType<typeof supabase.from>) => unknown) {
  try {
    const result = await (build(supabase.from(table)) as PromiseLike<{ data: unknown; error: { message?: string } | null }>);
    if (result.error) return { data: [] as Row[], error: result.error.message || `تعذر تحميل ${table}` };
    return { data: ((result.data || []) as Row[]).filter(Boolean), error: null };
  } catch (error) {
    return { data: [] as Row[], error: error instanceof Error ? error.message : `تعذر تحميل ${table}` };
  }
}

async function safeSelectRpc(fn: string) {
  try {
    const result = await supabase.rpc(fn);
    if (result.error) return { data: [] as Row[], error: result.error.message || `تعذر تحميل ${fn}` };
    return { data: ((result.data || []) as Row[]).filter(Boolean), error: null };
  } catch (error) {
    return { data: [] as Row[], error: error instanceof Error ? error.message : `تعذر تحميل ${fn}` };
  }
}

async function fetchDoctorSalesRows(range: { start: string; end: string }, branch: string, errors: string[]) {
  const rows = (await fetchSalesInvoicesPagedSafe({
    startDate: range.start,
    endDate: range.end,
    branch: branch || undefined,
    selectOptions: INVOICE_SELECT_DOCTOR_OPTIONS,
    errors,
    noCache: true,
    pageSize: 1000,
  })) as Row[];
  return rows.filter(Boolean).filter((row) => {
    const day = invoiceDate(row);
    return day && day >= range.start && day <= range.end && !invoiceInvalid(row) && !isSystemGenericInvoice(row);
  });
}

async function fetchDoctorSalesAggregates(range: { start: string; end: string }, branch: string) {
  const { data, error } = await supabase.rpc('get_dashboard_doctor_sales_v171', {
    p_start: range.start,
    p_end: range.end,
    p_branch: branch || ALL_BRANCHES,
  });
  if (error) throw new Error(error.message || 'get_dashboard_doctor_sales_v171 failed');
  return (Array.isArray(data) ? data : data ? [data] : []).filter(Boolean) as DoctorSalesAggregate[];
}

function doctorAccountFromRow(row: Row): EligibleDoctor | null {
  // الدور والحالة (نشط/بيقدر يدخل) اتفلتروا فعلًا جوّه get_eligible_doctor_accounts
  // نفسها — هنا بس بنستخرج ونتحقق من الاسم والفرع.
  const branch = normalizeBranchName(row.branch) || text(row.branch);
  const staffId = text(row.staff_id);
  const name = normalizeDoctorName(row.name);
  if (!staffId || !branch || isUnknownDoctorName(name)) return null;
  return { staffId, name, branch };
}

function scoreKey(doctor: EligibleDoctor) {
  return doctor.staffId
    ? `staff:${doctor.staffId}|${doctor.branch}`
    : `name:${doctor.branch}|${comparableDoctorName(doctor.name)}`;
}

function calculateScores(rows: Array<Omit<DoctorCompetitionScore, 'overallScore' | 'competitionPoints'>>): DoctorCompetitionScore[] {
  const maxSales = Math.max(1, ...rows.map((row) => row.totalSales));
  const maxAvg = Math.max(1, ...rows.map((row) => row.avgInvoice));
  const maxIncentive = Math.max(1, ...rows.map((row) => row.incentiveValue + row.listItems * 20 + row.stagnantItems * 20));
  return rows.map((row) => {
    const salesScore = (row.totalSales / maxSales) * 50;
    const invoiceScore = (row.avgInvoice / maxAvg) * 20;
    const reviewScore = row.reviewCount ? (avgReview(row) / 100) * 15 : 0;
    const serviceScore = Math.min(10, row.completedFollowups * 2 + row.recoveredCustomers * 3);
    const incentiveScore = Math.min(5, ((row.incentiveValue + row.listItems * 20 + row.stagnantItems * 20) / maxIncentive) * 5);
    const overallScore = salesScore + invoiceScore + reviewScore + serviceScore + incentiveScore;
    return { ...row, overallScore, competitionPoints: Math.round(overallScore * 10) / 10 };
  });
}

function buildWinners(rows: DoctorCompetitionScore[]): DoctorCompetitionWinners {
  const sales = [...rows].filter((row) => row.totalSales > 0).sort((a, b) => b.totalSales - a.totalSales)[0] || null;
  const averageInvoice = [...rows].filter((row) => row.avgInvoiceEligible).sort((a, b) => b.avgInvoice - a.avgInvoice)[0] || null;
  const incentive = [...rows]
    .filter((row) => row.incentiveValue > 0 || row.listItems > 0 || row.stagnantItems > 0)
    .sort((a, b) => b.incentiveValue - a.incentiveValue)[0] || null;
  const stagnant = [...rows]
    .filter((row) => row.stagnantStatus === 'available' && row.stagnantItems > 0)
    .sort((a, b) => b.stagnantItems - a.stagnantItems || b.incentiveValue - a.incentiveValue)[0] || null;
  const reviews = [...rows].filter((row) => row.reviewCount).sort((a, b) => avgReview(b) - avgReview(a))[0] || null;
  const service = [...rows]
    .filter((row) => row.completedFollowups > 0 || row.recoveredCustomers > 0)
    .sort((a, b) => b.completedFollowups + b.recoveredCustomers - (a.completedFollowups + a.recoveredCustomers))[0] || null;
  const overall = [...rows].filter((row) => row.competitionPoints > 0).sort((a, b) => b.competitionPoints - a.competitionPoints)[0] || null;
  return { sales, averageInvoice, avgInvoice: averageInvoice, incentive, stagnant, reviews, conversation: reviews, service, customerService: service, overall };
}

export async function getDoctorCompetitionMetrics(params: DoctorCompetitionParams = {}): Promise<DoctorCompetitionMetrics> {
  const range = rangeForDoctorCompetition(params.period, params.customStart, params.customEnd);
  const previous = previousRange(range);
  const selectedBranch = params.branch && params.branch !== ALL_BRANCHES ? normalizeBranchName(params.branch) : '';
  const userBranch = params.userBranch ? normalizeBranchName(params.userBranch) : '';
  const canSeeAll = params.canSeeAllBranches === true;
  const errors: Record<string, string> = {};
  const sourceHealth: Record<string, 'ready' | 'empty' | 'unavailable'> = {};

  const allowBranch = (branch: string) => {
    const normalized = normalizeBranchName(branch || '');
    if (selectedBranch && normalized !== selectedBranch) return false;
    if (!canSeeAll && userBranch && normalized !== userBranch) return false;
    return true;
  };

  // staff_accounts محمي بـ RLS — لو دكتور عادي (مش مدير) فتح الصفحة، الاستعلام
  // المباشر بيرجّع حسابه هو بس. الدالة الآمنة دي بتتخطى القيد وتديّنا قائمة
  // الدكاترة المؤهلين كاملة بغض النظر عن مين فاتح الصفحة.
  //
  // بنشغّل قائمة الحسابات المؤهلة، وتجميع مبيعات الفترة الحالية، وتجميع مبيعات فترة
  // المقارنة — التلاتة مع بعض (مش بالتتابع) لأنهم مستقلين تمامًا عن بعض، وكل واحدة
  // منهم بمهلتها الداخلية الخاصة (settled) عشان فشل أو تأخر أي واحدة لا يوقف التانية.
  let salesSource: 'aggregate_rpc' | 'invoice_fallback' = 'aggregate_rpc';
  let salesAggregates: DoctorSalesAggregate[] | null = null;
  let previousAggregates: DoctorSalesAggregate[] = [];

  const settled = <T,>(promise: Promise<T>) =>
    promise.then((value) => ({ value, error: null as unknown })).catch((error) => ({ value: null as T | null, error }));

  const [accountResult, currentAggOutcome, previousAggOutcome] = await Promise.all([
    withTimeout(safeSelectRpc('get_eligible_doctor_accounts'), ACCOUNTS_TIMEOUT_MS, 'get_eligible_doctor_accounts timed out').catch(
      (error) => ({ data: [] as Row[], error: error instanceof Error ? error.message : String(error) })
    ),
    settled(withTimeout(fetchDoctorSalesAggregates(range, selectedBranch), AGGREGATE_TIMEOUT_MS, 'get_dashboard_doctor_sales_v171 timed out')),
    settled(withTimeout(fetchDoctorSalesAggregates(previous, selectedBranch), PREVIOUS_AGGREGATE_TIMEOUT_MS, 'get_dashboard_doctor_sales_v171 (previous) timed out')),
  ]);

  if (currentAggOutcome.value) {
    salesAggregates = currentAggOutcome.value;
  } else {
    salesSource = 'invoice_fallback';
    errors.sales_aggregate = currentAggOutcome.error instanceof Error ? currentAggOutcome.error.message : String(currentAggOutcome.error);
  }
  if (previousAggOutcome.value) previousAggregates = previousAggOutcome.value;

  if (accountResult.error) errors.staff_accounts = accountResult.error;
  const eligibleDoctors = accountResult.data
    .map(doctorAccountFromRow)
    .filter((row): row is EligibleDoctor => Boolean(row));
  sourceHealth.staff_accounts = accountResult.error ? 'unavailable' : eligibleDoctors.length ? 'ready' : 'empty';

  const map = new Map<string, Omit<DoctorCompetitionScore, 'overallScore' | 'competitionPoints'>>();
  const byStaff = new Map<string, EligibleDoctor>();
  const byNameGlobal = new Map<string, EligibleDoctor[]>();
  const byNameBranch = new Map<string, EligibleDoctor>();
  const firstNameGroups = new Map<string, EligibleDoctor[]>();

  for (const doctor of eligibleDoctors) {
    byStaff.set(doctor.staffId, doctor);
    const nameKey = comparableDoctorName(doctor.name);
    byNameGlobal.set(nameKey, [...(byNameGlobal.get(nameKey) || []), doctor]);
    byNameBranch.set(`${doctor.branch}|${nameKey}`, doctor);
    const first = firstNameKey(doctor.name);
    if (first) firstNameGroups.set(`${doctor.branch}|${first}`, [...(firstNameGroups.get(`${doctor.branch}|${first}`) || []), doctor]);
    if (allowBranch(doctor.branch)) map.set(scoreKey(doctor), emptyDoctor(doctor));
  }

  const resolveDoctor = (row: Row, branch: string): EligibleDoctor | null => {
    const direct = rowStaffId(row);
    const directDoctor = direct ? byStaff.get(direct) : null;
    if (directDoctor) return { ...directDoctor, branch };

    const name = invoiceDoctor(row);
    const nameKey = comparableDoctorName(name);
    const sameBranch = byNameBranch.get(`${branch}|${nameKey}`);
    if (sameBranch) return sameBranch;

    const globalCandidates = byNameGlobal.get(nameKey) || [];
    if (globalCandidates.length === 1) return { ...globalCandidates[0], branch };

    const first = firstNameKey(name);
    const branchCandidates = firstNameGroups.get(`${branch}|${first}`) || [];
    if (first && branchCandidates.length === 1) return branchCandidates[0];

    // ملحوظة: أي سطر "طوارئ" كان بيقبل أي اسم من الفواتير كدكتور وقت فشل تحميل
    // قائمة الحسابات المعتمدة اتشال عمدًا — كان بيسمح لعامل نظافة أو مساعد أو
    // حتى شريك (مدير مشتريات) يظهر في المسابقة وقت أي تعطل بسيط. الأفضل نعرض
    // قائمة ناقصة مؤقتًا على إننا نضيف موظف مش دكتور للمسابقة.
    return null;
  };

  const upsert = (doctor: EligibleDoctor) => {
    const key = scoreKey(doctor);
    const current = map.get(key) || emptyDoctor(doctor);
    map.set(key, current);
    return { key, current };
  };

  // ملحوظة: فترة المقارنة (السابقة) بترجع من الـRPC بس (فوق) ومفيهاش مسار فواتير
  // خام احتياطي — لو فشلت أو اتأخرت، growthRate بيبقى "غير متاح" وده تنازل مقبول
  // لأن الحقل ده مش معروض في أي مكان في اللوحة حاليًا؛ مفيش داعي لمضاعفة حجم
  // الفواتير الخام المطلوب تحميلها وقت استخدام مسار الفواتير الاحتياطي.
  const salesErrors: string[] = [];
  const [salesRows, reviewResult, followupResult, stagnantResult, listResult] = await Promise.all([
    salesSource === 'invoice_fallback' ? fetchDoctorSalesRows(range, selectedBranch, salesErrors).catch(() => [] as Row[]) : Promise.resolve([] as Row[]),
    safeSelect('conversation_sales_reviews', (query) => query.select('*').gte('conversation_date', range.start).lte('conversation_date', `${range.end}T23:59:59`).limit(5000)),
    safeSelect('daily_followups', (query) => query.select('*').gte('created_at', range.start).lte('created_at', `${range.end}T23:59:59`).limit(5000)),
    safeSelect('stagnant_medicine_dispenses', (query) => query.select('*').limit(5000)),
    safeSelect('incentive_medicine_sales', (query) => query.select('*').limit(5000)),
  ]);

  if (salesErrors.length) errors.sales_invoices = salesErrors.join(' | ');
  sourceHealth.sales_invoices = salesSource === 'aggregate_rpc'
    ? (salesAggregates?.length ? 'ready' : 'empty')
    : errors.sales_invoices ? 'unavailable' : salesRows.length ? 'ready' : 'empty';

  let invoiceRowsWithoutDoctorCount = 0;
  let salesInvoicesFetchedCount = 0;

  if (salesSource === 'aggregate_rpc') {
    for (const aggregate of salesAggregates || []) {
      const branch = normalizeBranchName(aggregate.branch || '') || text(aggregate.branch) || 'غير محدد';
      if (!allowBranch(branch)) continue;
      const invoiceCount = Math.max(0, Math.round(num(aggregate.invoices_count)));
      salesInvoicesFetchedCount += invoiceCount;
      const doctor = resolveDoctor({ normalized_seller_name: aggregate.doctor_name }, branch);
      if (!doctor) {
        invoiceRowsWithoutDoctorCount += invoiceCount;
        continue;
      }
      const { current } = upsert(doctor);
      current.totalSales += num(aggregate.sales_total);
      current.invoices += invoiceCount;
      current.linkedInvoiceCount += invoiceCount;
    }
  } else {
    salesInvoicesFetchedCount = salesRows.length;
    const invoiceSets = new Map<string, Set<string>>();
    for (const row of salesRows) {
      const branch = invoiceBranch(row);
      if (!allowBranch(branch)) continue;
      const doctor = resolveDoctor(row, branch);
      if (!doctor) {
        invoiceRowsWithoutDoctorCount += 1;
        continue;
      }
      const { key, current } = upsert(doctor);
      const set = invoiceSets.get(key) || new Set<string>();
      const invoiceKey = invoiceIdentityKey(row) || `${invoiceDate(row)}:${set.size}`;
      if (set.has(invoiceKey)) continue;
      set.add(invoiceKey);
      invoiceSets.set(key, set);
      current.totalSales += pickInvoiceAmount(row);
    }
    for (const [key, set] of invoiceSets) {
      const current = map.get(key);
      if (current) {
        current.invoices = set.size;
        current.linkedInvoiceCount = set.size;
      }
    }
  }

  const previousSales = new Map<string, number>();
  for (const aggregate of previousAggregates) {
    const branch = normalizeBranchName(aggregate.branch || '') || text(aggregate.branch) || 'غير محدد';
    if (!allowBranch(branch)) continue;
    const doctor = resolveDoctor({ normalized_seller_name: aggregate.doctor_name }, branch);
    if (!doctor) continue;
    const key = scoreKey(doctor);
    previousSales.set(key, (previousSales.get(key) || 0) + num(aggregate.sales_total));
  }

  if (reviewResult.error) errors.conversation_sales_reviews = reviewResult.error;
  sourceHealth.conversation_sales_reviews = reviewResult.error ? 'unavailable' : reviewResult.data.length ? 'ready' : 'empty';
  for (const row of reviewResult.data) {
    const branch = normalizeBranchName(row.branch) || text(row.branch);
    if (!allowBranch(branch)) continue;
    const doctor = resolveDoctor({ ...row, normalized_seller_name: row.staff_name || row.doctor_name || row.employee_name }, branch);
    if (!doctor) continue;
    const { current } = upsert(doctor);
    const score = num(row.final_score || row.score || row.quality_rating);
    if (score > 0) {
      current.reviewCount += 1;
      current.reviewTotal += score;
      if (score >= 90) current.excellentReviews += 1;
      if (score < 70) current.negativeReviews += 1;
    }
  }

  if (followupResult.error) errors.daily_followups = followupResult.error;
  sourceHealth.daily_followups = followupResult.error ? 'unavailable' : followupResult.data.length ? 'ready' : 'empty';
  for (const row of followupResult.data) {
    const branch = normalizeBranchName(row.branch) || text(row.branch);
    if (!allowBranch(branch)) continue;
    const doctor = resolveDoctor({ ...row, normalized_seller_name: row.responsible_name || row.assigned_doctor || row.assigned_to || row.created_by_name }, branch);
    if (!doctor) continue;
    const { current } = upsert(doctor);
    current.followups += 1;
    if (isCompletedFollowup(row)) current.completedFollowups += 1;
    if (truthy(row.purchase_after_followup)) {
      current.recoveredCustomers += 1;
      current.followupSales += num(row.purchase_amount);
    }
    const satisfaction = num(row.satisfaction_score || row.customer_satisfaction || row.rating);
    if (satisfaction > 0) {
      current.satisfactionCount += 1;
      current.satisfactionTotal += satisfaction;
    }
  }

  const incentiveAvailable = !stagnantResult.error && !listResult.error && Boolean(stagnantResult.data.length || listResult.data.length);
  sourceHealth.stagnant_medicine_dispenses = stagnantResult.error ? 'unavailable' : stagnantResult.data.length ? 'ready' : 'empty';
  sourceHealth.incentive_medicine_sales = listResult.error ? 'unavailable' : listResult.data.length ? 'ready' : 'empty';
  for (const row of [...stagnantResult.data, ...listResult.data]) {
    const branch = normalizeBranchName(row.branch) || text(row.branch);
    if (!allowBranch(branch)) continue;
    const doctor = resolveDoctor({ ...row, normalized_seller_name: row.staff_name || row.doctor_name || row.responsible_doctor_name || row.responsible_doctor }, branch);
    if (!doctor) continue;
    const { current } = upsert(doctor);
    current.stagnantStatus = 'available';
    if (stagnantResult.data.includes(row)) current.stagnantItems += 1;
    else current.listItems += 1;
    current.totalQuantity += num(row.quantity || row.sold_quantity || row.dispensed_quantity);
    current.incentiveValue += num(row.incentive_amount || row.reward_amount || row.total_incentive || row.amount);
  }

  const rawRows = [...map.entries()].map(([key, row]) => {
    const previousTotal = previousSales.get(key) || 0;
    row.avgInvoice = row.invoices ? row.totalSales / row.invoices : 0;
    row.avgInvoiceEligible = row.invoices >= MIN_AVG_INVOICE_THRESHOLD;
    row.growthRate = previousTotal ? ((row.totalSales - previousTotal) / previousTotal) * 100 : null;
    row.growthRateStatus = previousTotal ? 'available' : 'unavailable';
    row.stagnantStatus = incentiveAvailable ? row.stagnantStatus : 'disabled';
    row.leaderboardEligible = !isUnknownDoctorName(row.name);
    row.ineligibleReasons = row.leaderboardEligible ? [] : ['دكتور غير محدد'];
    return row;
  });

  const rows = calculateScores(rawRows)
    .filter((row) => row.leaderboardEligible && row.totalSales > MINIMUM_SALES_FOR_LEADERBOARD)
    .sort((a, b) => b.competitionPoints - a.competitionPoints || b.totalSales - a.totalSales);
  const eligibleRows = rows;
  const reviewRows = rows.filter(
    (row) => !row.avgInvoiceEligible || row.reviewIssues.length > 0 || row.ineligibleReasons.length > 0
  );
  const warnings = Object.entries(errors)
    .filter(([key]) => key !== 'sales_aggregate' || salesSource !== 'invoice_fallback')
    .map(([, message]) => message);
  const totalDoctorSales = rows.reduce((sum, row) => sum + row.totalSales, 0);

  if (salesSource === 'invoice_fallback' && errors.sales_aggregate) {
    warnings.push('تم استخدام مسار الفواتير الاحتياطي للمسابقة لأن التجميع السريع لم يكن متاحًا.');
  }
  if (invoiceRowsWithoutDoctorCount > 0) {
    warnings.push(`${invoiceRowsWithoutDoctorCount} فاتورة نظيفة في الفترة لا يمكن نسبها تلقائياً لدكتور مؤهل، وتم استبعادها من ترتيب المسابقة فقط.`);
  }

  return {
    rows,
    eligibleRows,
    reviewRows,
    winners: buildWinners(rows),
    status: errors.sales_invoices ? (rows.length ? 'partial' : 'failed') : rows.length ? 'ready' : 'empty',
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
      salesInvoicesFetchedCount,
      doctorSalesRowsCount: rows.length,
      totalDoctorSales,
      invoiceRowsWithoutDoctorCount,
      totalInvoicesCountFromDoctorRows: rows.reduce((sum, row) => sum + row.invoices, 0),
      invoiceCountMethod: salesSource === 'aggregate_rpc'
        ? 'canonical server-side doctor aggregate grouped by actual invoice branch; zero-value clean invoices are included by the dashboard RPC'
        : 'distinct clean invoice identity per staff_id and actual invoice branch; zero-value clean invoices count toward invoice count',
      topRawDoctorSalesPreview: rows.slice(0, 5).map((row) => `${row.name} · ${row.branch} · ${row.totalSales.toFixed(2)}`),
      noWinnersReasons: rows.length ? [] : ['لا توجد حسابات دكاترة مؤهلة أو مبيعات في النطاق الحالي'],
      eligibleAccountsCount: eligibleDoctors.length,
      salesSource,
    },
    range,
    sourceHealth,
    errors,
  };
}
