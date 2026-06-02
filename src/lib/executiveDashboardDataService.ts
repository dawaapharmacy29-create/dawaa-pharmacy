import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import {
  fetchExecutiveDashboardSummary,
  type DashboardActionItem,
  type DashboardSummary,
  type DeliveryPerformanceSummary,
  type FollowupPerformanceSummary,
  type SalesDailySummary,
} from "@/lib/dashboardSummaryService";
import {
  fetchStaffIdentityRows,
  groupStaffSalesPerformance,
  type GroupedStaffSalesPerformance,
} from "@/lib/staffIdentityService";

type Row = Record<string, unknown>;

export type ExecutiveDashboardMode = "current" | "previous" | "custom";

export type TrendPoint = {
  key: string;
  label: string;
  netTotal: number;
  invoicesCount: number;
  avgInvoice: number;
  activeDays: number;
  uniqueCustomers: number;
};

export type BranchPerformancePoint = {
  branch: string;
  netTotal: number;
  invoicesCount: number;
  avgInvoice: number;
  uniqueCustomers: number;
  share: number;
  bestPeriod: string | null;
};

export type LastFiveDaysBranchPoint = {
  date: string;
  branch: string;
  netTotal: number;
  invoicesCount: number;
  avgInvoice: number;
  previousDayNetTotal: number | null;
  changePercent: number | null;
};

export type OperationalTrackingItem = {
  id: string;
  title: string;
  metric: string;
  value: number | null;
  progress: number | null;
  responsible: string | null;
  route: string;
  status: "ready" | "empty" | "unavailable";
  source: string;
  error?: string | null;
};

export type DashboardFunnelStep = {
  key: string;
  label: string;
  value: number | null;
  rate: number | null;
};

export type DashboardResultSlice = {
  key: string;
  label: string;
  value: number | null;
  color: string;
};

export type DashboardCustomerPreview = {
  name: string | null;
  code: string | null;
  phone: string | null;
  branch: string | null;
  segment: string | null;
  status: string | null;
  totalSpent: number | null;
  avgMonthly: number | null;
  lastPurchase: string | null;
  source: string;
  error: string | null;
};

export type DashboardInvoicePreview = {
  id: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  amount: number;
  branch: string | null;
};

export type ExecutiveDashboardData = {
  summary: DashboardSummary;
  kpis: DashboardSummary["normalizedKpis"];
  salesTrend: TrendPoint[];
  last5DaysByBranch: LastFiveDaysBranchPoint[];
  branchPerformance: BranchPerformancePoint[];
  doctorPerformance: GroupedStaffSalesPerformance[];
  followupFunnel: DashboardFunnelStep[];
  followupResults: DashboardResultSlice[];
  customerServiceImpact: FollowupPerformanceSummary[];
  customerAnalytics: DashboardSummary["customerIntelligence"];
  stagnantItems: OperationalTrackingItem[];
  listItems: OperationalTrackingItem[];
  stagnantTracking: OperationalTrackingItem[];
  listItemTracking: OperationalTrackingItem[];
  deliveryPerformance: DeliveryPerformanceSummary[];
  deliveryTracking: {
    totalOrders: number | null;
    deliverySales: number | null;
    topStaff: string | null;
    source: string;
  };
  customerPreview: DashboardCustomerPreview | null;
  latestInvoicesPreview: DashboardInvoicePreview[];
  dataHealth: DashboardSummary["dataHealth"];
  quickDecisionItems: DashboardActionItem[];
  sourceHealth: DashboardSummary["sourceHealth"];
  lastUpdated: string;
  errorsBySection: Record<string, string>;
  salesAccuracy: {
    netSalesSource: string;
    rpcNetSales: number | null;
    summaryNetSales: number | null;
    invoicesCount: number | null;
    mismatchPercent: number | null;
  };
};

const dashboardCache = new Map<string, ExecutiveDashboardData>();

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function readFirst(row: Row | null | undefined, keys: string[], fallback: unknown = null) {
  if (!row) return fallback;
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return fallback;
}

function dayLabel(value: string) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value || "غير محدد";
  return date.toLocaleDateString("ar-EG", { day: "numeric", month: "short" });
}

function monthLabel(value: string) {
  const date = new Date(`${value}-01T12:00:00`);
  if (Number.isNaN(date.getTime())) return value || "غير محدد";
  return date.toLocaleDateString("ar-EG", { month: "long", year: "numeric" });
}

function monthDiff(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth() + 1;
}

function buildSalesTrend(rows: SalesDailySummary[], mode: ExecutiveDashboardMode, startDate: string, endDate: string): TrendPoint[] {
  const groupByMonth = mode === "custom" && monthDiff(startDate, endDate) > 1;
  const byKey = new Map<string, TrendPoint>();

  for (const row of rows) {
    const key = groupByMonth ? String(row.saleDate || "").slice(0, 7) : row.saleDate;
    if (!key) continue;
    const current = byKey.get(key) || {
      key,
      label: groupByMonth ? monthLabel(key) : dayLabel(key),
      netTotal: 0,
      invoicesCount: 0,
      avgInvoice: 0,
      activeDays: 0,
      uniqueCustomers: 0,
    };
    current.netTotal += row.netTotal;
    current.invoicesCount += row.invoicesCount;
    current.uniqueCustomers += row.uniqueCustomers;
    if (row.netTotal > 0 || row.invoicesCount > 0) current.activeDays += 1;
    byKey.set(key, current);
  }

  return [...byKey.values()]
    .map((row) => ({ ...row, avgInvoice: row.invoicesCount ? row.netTotal / row.invoicesCount : 0 }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function buildBranchPerformance(rows: SalesDailySummary[]): BranchPerformancePoint[] {
  const byBranch = new Map<string, BranchPerformancePoint & { bestValue: number }>();
  for (const row of rows) {
    const branch = row.branch || "غير محدد";
    const current = byBranch.get(branch) || {
      branch,
      netTotal: 0,
      invoicesCount: 0,
      avgInvoice: 0,
      uniqueCustomers: 0,
      share: 0,
      bestPeriod: null,
      bestValue: 0,
    };
    current.netTotal += row.netTotal;
    current.invoicesCount += row.invoicesCount;
    current.uniqueCustomers += row.uniqueCustomers;
    if (row.netTotal > current.bestValue) {
      current.bestValue = row.netTotal;
      current.bestPeriod = row.saleDate;
    }
    byBranch.set(branch, current);
  }

  const total = [...byBranch.values()].reduce((sum, row) => sum + row.netTotal, 0);
  return [...byBranch.values()]
    .map(({ bestValue: _bestValue, ...row }) => ({
      ...row,
      avgInvoice: row.invoicesCount ? row.netTotal / row.invoicesCount : 0,
      share: total ? (row.netTotal / total) * 100 : 0,
    }))
    .sort((a, b) => b.netTotal - a.netTotal);
}

function buildLastFiveDaysByBranch(rows: SalesDailySummary[]): LastFiveDaysBranchPoint[] {
  const dates = [...new Set(rows.map((row) => row.saleDate).filter(Boolean))].sort().slice(-5);
  const byKey = new Map<string, LastFiveDaysBranchPoint>();
  for (const row of rows.filter((item) => dates.includes(item.saleDate))) {
    const branch = row.branch || "غير محدد";
    const key = `${row.saleDate}__${branch}`;
    const current = byKey.get(key) || {
      date: row.saleDate,
      branch,
      netTotal: 0,
      invoicesCount: 0,
      avgInvoice: 0,
      previousDayNetTotal: null,
      changePercent: null,
    };
    current.netTotal += row.netTotal;
    current.invoicesCount += row.invoicesCount;
    byKey.set(key, current);
  }
  const values = [...byKey.values()].map((row) => ({
    ...row,
    avgInvoice: row.invoicesCount ? row.netTotal / row.invoicesCount : 0,
  })).sort((a, b) => a.date.localeCompare(b.date) || a.branch.localeCompare(b.branch));

  for (const row of values) {
    const previousDate = dates[dates.indexOf(row.date) - 1];
    if (!previousDate) continue;
    const previous = values.find((candidate) => candidate.date === previousDate && candidate.branch === row.branch);
    if (!previous) continue;
    row.previousDayNetTotal = previous.netTotal;
    row.changePercent = previous.netTotal ? ((row.netTotal - previous.netTotal) / previous.netTotal) * 100 : null;
  }
  return values;
}

async function fetchTrackingTable(args: {
  table: string;
  select: string;
  titleKeys: string[];
  valueKeys: string[];
  targetKeys: string[];
  soldKeys: string[];
  responsibleKeys: string[];
  route: string;
  source: string;
}): Promise<{ rows: OperationalTrackingItem[]; error: string | null }> {
  if (!isSupabaseConfigured) return { rows: [], error: "Supabase غير متاح" };
  const { data, error } = await supabase.from(args.table).select(args.select).limit(60);
  if (error) return { rows: [], error: error.message };
  const rows = ((data ?? []) as Row[]).slice(0, 8).map((row, index) => {
    const sold = toNumber(readFirst(row, args.soldKeys, 0));
    const target = toNumber(readFirst(row, args.targetKeys, 0));
    const value = toNumber(readFirst(row, args.valueKeys, sold));
    return {
      id: String(readFirst(row, ["id"], `${args.table}-${index}`)),
      title: String(readFirst(row, args.titleKeys, "غير محدد")),
      metric: target ? `${sold.toLocaleString("ar-EG")} / ${target.toLocaleString("ar-EG")}` : value.toLocaleString("ar-EG"),
      value,
      progress: target > 0 ? Math.min(100, (sold / target) * 100) : null,
      responsible: readFirst(row, args.responsibleKeys, null) as string | null,
      route: args.route,
      status: "ready" as const,
      source: args.source,
    };
  });
  return { rows, error: null };
}

async function loadOperationalTracking(errorsBySection: Record<string, string>) {
  const [stagnantResult, listResult] = await Promise.allSettled([
    fetchTrackingTable({
      table: "stagnant_medicines",
      select: "id,product_name,medicine_name,quantity_available,total_quantity,remaining_quantity,sold_quantity,dispensed_quantity,target_min_quantity,target_min_percent,responsible_doctor,responsible_doctor_name,status",
      titleKeys: ["product_name", "medicine_name"],
      valueKeys: ["remaining_quantity", "quantity_available", "total_quantity"],
      targetKeys: ["target_min_quantity", "quantity_available", "total_quantity"],
      soldKeys: ["sold_quantity", "dispensed_quantity"],
      responsibleKeys: ["responsible_doctor_name", "responsible_doctor"],
      route: "/stagnant-medicines",
      source: "stagnant_medicines",
    }),
    fetchTrackingTable({
      table: "incentive_medicines",
      select: "id,product_name,current_quantity,sold_quantity,target_min_quantity,target_min_percent,doctor_id,responsible_doctor,branch,active",
      titleKeys: ["product_name"],
      valueKeys: ["current_quantity", "sold_quantity"],
      targetKeys: ["target_min_quantity", "current_quantity"],
      soldKeys: ["sold_quantity"],
      responsibleKeys: ["responsible_doctor", "doctor_id"],
      route: "/incentive-medicines",
      source: "incentive_medicines",
    }),
  ]);

  const stagnant = stagnantResult.status === "fulfilled" ? stagnantResult.value : { rows: [], error: String(stagnantResult.reason) };
  const list = listResult.status === "fulfilled" ? listResult.value : { rows: [], error: String(listResult.reason) };
  if (stagnant.error) errorsBySection.stagnantItems = "مصدر متابعة الرواكد غير متاح حاليًا";
  if (list.error) errorsBySection.listItems = "مصدر متابعة أصناف اللستة غير متاح حاليًا";
  return {
    stagnantItems: stagnant.rows,
    listItems: list.rows,
  };
}

function buildSalesAccuracy(summary: DashboardSummary) {
  const summaryNetSales = summary.dailySales.reduce((sum, row) => sum + row.netTotal, 0);
  const summaryInvoices = summary.dailySales.reduce((sum, row) => sum + row.invoicesCount, 0);
  const kpiNet = summary.kpis?.netSales ?? null;
  const mismatchPercent = kpiNet && summaryNetSales
    ? (Math.abs(kpiNet - summaryNetSales) / Math.max(Math.abs(summaryNetSales), 1)) * 100
    : null;
  return {
    netSalesSource: summary.normalizedKpis.netSales.source,
    rpcNetSales: kpiNet,
    summaryNetSales,
    invoicesCount: summary.normalizedKpis.invoicesCount.value ?? summaryInvoices,
    mismatchPercent,
  };
}

function sumFollowups(rows: FollowupPerformanceSummary[]) {
  return rows.reduce(
    (acc, row) => ({
      assignedCount: acc.assignedCount + row.assignedCount,
      completedCount: acc.completedCount + row.completedCount,
      overdueCount: acc.overdueCount + row.overdueCount,
      noAnswerCount: acc.noAnswerCount + row.noAnswerCount,
      postponedCount: acc.postponedCount + row.postponedCount,
      needsManagerCount: acc.needsManagerCount + row.needsManagerCount,
      purchaseAfterFollowupAmount: acc.purchaseAfterFollowupAmount + row.purchaseAfterFollowupAmount,
    }),
    {
      assignedCount: 0,
      completedCount: 0,
      overdueCount: 0,
      noAnswerCount: 0,
      postponedCount: 0,
      needsManagerCount: 0,
      purchaseAfterFollowupAmount: 0,
    },
  );
}

function buildFollowupFunnel(rows: FollowupPerformanceSummary[]): DashboardFunnelStep[] {
  const totals = sumFollowups(rows);
  const base = totals.assignedCount || null;
  const rate = (value: number) => (base ? (value / base) * 100 : null);
  return [
    { key: "prepared", label: "تجهيز المتابعة", value: totals.assignedCount, rate: rate(totals.assignedCount) },
    { key: "contacted", label: "تم التواصل", value: totals.completedCount, rate: rate(totals.completedCount) },
    { key: "interested", label: "مهتم", value: null, rate: null },
    { key: "purchased", label: "شراء بعد المتابعة", value: null, rate: null },
  ];
}

function buildFollowupResults(rows: FollowupPerformanceSummary[]): DashboardResultSlice[] {
  const totals = sumFollowups(rows);
  return [
    { key: "completed", label: "تم التواصل", value: totals.completedCount, color: "#00AFA5" },
    { key: "no_answer", label: "لم يرد", value: totals.noAnswerCount, color: "#EF4444" },
    { key: "postponed", label: "مؤجل", value: totals.postponedCount, color: "#F59E0B" },
    { key: "needs_manager", label: "يحتاج مدير", value: totals.needsManagerCount, color: "#8B5CF6" },
  ];
}

async function fetchCustomerPreview(branch: string): Promise<DashboardCustomerPreview> {
  let query = supabase
    .from("customer_metrics_summary")
    .select("customer_code,customer_name,customer_phone,branch,segment,customer_status,total_spent,avg_monthly,last_purchase")
    .not("customer_name", "is", null)
    .order("avg_monthly", { ascending: false })
    .limit(1);

  if (branch && branch !== "all") query = query.eq("branch", branch);

  const { data, error } = await query;
  if (error) {
    return {
      name: null,
      code: null,
      phone: null,
      branch: null,
      segment: null,
      status: null,
      totalSpent: null,
      avgMonthly: null,
      lastPurchase: null,
      source: "customer_metrics_summary",
      error: error.message,
    };
  }
  const row = (data?.[0] ?? null) as Row | null;
  return {
    name: readFirst(row, ["customer_name"], null) as string | null,
    code: readFirst(row, ["customer_code"], null) as string | null,
    phone: readFirst(row, ["customer_phone"], null) as string | null,
    branch: readFirst(row, ["branch"], null) as string | null,
    segment: readFirst(row, ["segment"], null) as string | null,
    status: readFirst(row, ["customer_status"], null) as string | null,
    totalSpent: row ? toNumber(readFirst(row, ["total_spent"], 0)) : null,
    avgMonthly: row ? toNumber(readFirst(row, ["avg_monthly"], 0)) : null,
    lastPurchase: readFirst(row, ["last_purchase"], null) as string | null,
    source: "customer_metrics_summary",
    error: null,
  };
}

async function fetchLatestInvoices(startDate: string, endDate: string, branch: string): Promise<{ rows: DashboardInvoicePreview[]; error: string | null }> {
  let query = supabase
    .from("sales_invoices")
    .select("id,invoice_number,invoice_no,invoice_date,net_amount,discounted_amount,amount,branch")
    .gte("invoice_date", startDate)
    .lt("invoice_date", `${endDate}T23:59:59`)
    .order("invoice_date", { ascending: false })
    .limit(5);

  if (branch && branch !== "all") query = query.eq("branch", branch);
  const { data, error } = await query;
  if (error) return { rows: [], error: error.message };
  return {
    rows: ((data ?? []) as Row[]).map((row) => ({
      id: String(readFirst(row, ["id"], crypto.randomUUID())),
      invoiceNumber: readFirst(row, ["invoice_number", "invoice_no"], null) as string | null,
      invoiceDate: readFirst(row, ["invoice_date"], null) as string | null,
      amount: toNumber(readFirst(row, ["net_amount", "discounted_amount", "amount"], 0)),
      branch: readFirst(row, ["branch"], null) as string | null,
    })),
    error: null,
  };
}

function buildDeliveryTracking(rows: DeliveryPerformanceSummary[]) {
  const totalOrders = rows.reduce((sum, row) => sum + row.deliveriesCount, 0);
  const deliverySales = rows.reduce((sum, row) => sum + row.deliverySalesTotal, 0);
  const topStaff = [...rows].sort((a, b) => b.deliveriesCount - a.deliveriesCount)[0]?.deliveryStaff || null;
  return {
    totalOrders,
    deliverySales,
    topStaff,
    source: "delivery_performance_summary",
  };
}

export async function loadExecutiveDashboardData(params: {
  startDate: string;
  endDate: string;
  branch: string;
  mode: ExecutiveDashboardMode;
  forceRefresh?: boolean;
}): Promise<ExecutiveDashboardData> {
  const key = JSON.stringify(params);
  if (!params.forceRefresh && dashboardCache.has(key)) return dashboardCache.get(key)!;

  const errorsBySection: Record<string, string> = {};
  const [summaryResult, trackingResult, staffIdentityResult] = await Promise.allSettled([
    fetchExecutiveDashboardSummary(params),
    loadOperationalTracking(errorsBySection),
    fetchStaffIdentityRows(),
  ]);

  if (summaryResult.status === "rejected") {
    throw summaryResult.reason;
  }

  const summary = summaryResult.value;
  const tracking = trackingResult.status === "fulfilled" ? trackingResult.value : { stagnantItems: [], listItems: [] };
  if (trackingResult.status === "rejected") errorsBySection.operationalTracking = "تعذر تحميل متابعة الرواكد واللستة";
  const staffIdentities = staffIdentityResult.status === "fulfilled" ? staffIdentityResult.value : [];
  if (staffIdentityResult.status === "rejected") errorsBySection.staffIdentity = "تعذر تحميل ربط الدكاترة بملفات الفريق";

  const data: ExecutiveDashboardData = {
    summary,
    kpis: summary.normalizedKpis,
    salesTrend: buildSalesTrend(summary.dailySales, params.mode, params.startDate, params.endDate),
    last5DaysByBranch: buildLastFiveDaysByBranch(summary.dailySales),
    branchPerformance: buildBranchPerformance(summary.dailySales),
    doctorPerformance: groupStaffSalesPerformance(summary.staffSales, staffIdentities).slice(0, 12),
    followupFunnel: buildFollowupFunnel(summary.followupPerformance),
    followupResults: buildFollowupResults(summary.followupPerformance),
    customerServiceImpact: summary.followupPerformance,
    customerAnalytics: summary.customerIntelligence,
    stagnantItems: tracking.stagnantItems,
    listItems: tracking.listItems,
    stagnantTracking: tracking.stagnantItems,
    listItemTracking: tracking.listItems,
    deliveryPerformance: summary.deliveryPerformance,
    deliveryTracking: buildDeliveryTracking(summary.deliveryPerformance),
    customerPreview: null,
    latestInvoicesPreview: [],
    dataHealth: summary.dataHealth,
    quickDecisionItems: summary.actionCenter,
    sourceHealth: summary.sourceHealth,
    lastUpdated: new Date().toISOString(),
    errorsBySection,
    salesAccuracy: buildSalesAccuracy(summary),
  };

  dashboardCache.set(key, data);
  return data;
}

export function clearExecutiveDashboardCache() {
  dashboardCache.clear();
}
