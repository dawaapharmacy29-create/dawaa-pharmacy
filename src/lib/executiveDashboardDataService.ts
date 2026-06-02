import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import {
  fetchExecutiveDashboardSummary,
  type DashboardActionItem,
  type DashboardSummary,
  type DeliveryPerformanceSummary,
  type FollowupPerformanceSummary,
  type SalesDailySummary,
  type StaffSalesSummary,
} from "@/lib/dashboardSummaryService";

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

export type ExecutiveDashboardData = {
  summary: DashboardSummary;
  kpis: DashboardSummary["normalizedKpis"];
  salesTrend: TrendPoint[];
  branchPerformance: BranchPerformancePoint[];
  doctorPerformance: StaffSalesSummary[];
  customerServiceImpact: FollowupPerformanceSummary[];
  customerAnalytics: DashboardSummary["customerIntelligence"];
  stagnantItems: OperationalTrackingItem[];
  listItems: OperationalTrackingItem[];
  deliveryPerformance: DeliveryPerformanceSummary[];
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
      select: "id,medicine_name,item_name,name,quantity_available,quantity,sold_quantity,dispensed_quantity,target_quantity,responsible_doctor,assigned_doctor,status",
      titleKeys: ["medicine_name", "item_name", "name"],
      valueKeys: ["quantity_available", "quantity"],
      targetKeys: ["target_quantity", "quantity_available", "quantity"],
      soldKeys: ["sold_quantity", "dispensed_quantity"],
      responsibleKeys: ["responsible_doctor", "assigned_doctor"],
      route: "/stagnant-medicines",
      source: "stagnant_medicines",
    }),
    fetchTrackingTable({
      table: "list_items",
      select: "id,item_name,medicine_name,name,target_quantity,sold_quantity,remaining_quantity,responsible_doctor,assigned_doctor,status",
      titleKeys: ["item_name", "medicine_name", "name"],
      valueKeys: ["remaining_quantity", "sold_quantity"],
      targetKeys: ["target_quantity"],
      soldKeys: ["sold_quantity"],
      responsibleKeys: ["responsible_doctor", "assigned_doctor"],
      route: "/list-items",
      source: "list_items",
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
  return {
    netSalesSource: summary.normalizedKpis.netSales.source,
    rpcNetSales: kpiNet,
    summaryNetSales,
    invoicesCount: summary.normalizedKpis.invoicesCount.value ?? summaryInvoices,
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
  const [summaryResult, trackingResult] = await Promise.allSettled([
    fetchExecutiveDashboardSummary(params),
    loadOperationalTracking(errorsBySection),
  ]);

  if (summaryResult.status === "rejected") {
    throw summaryResult.reason;
  }

  const summary = summaryResult.value;
  const tracking = trackingResult.status === "fulfilled" ? trackingResult.value : { stagnantItems: [], listItems: [] };
  if (trackingResult.status === "rejected") errorsBySection.operationalTracking = "تعذر تحميل متابعة الرواكد واللستة";

  const data: ExecutiveDashboardData = {
    summary,
    kpis: summary.normalizedKpis,
    salesTrend: buildSalesTrend(summary.dailySales, params.mode, params.startDate, params.endDate),
    branchPerformance: buildBranchPerformance(summary.dailySales),
    doctorPerformance: [...summary.staffSales].sort((a, b) => b.netTotal - a.netTotal).slice(0, 10),
    customerServiceImpact: summary.followupPerformance,
    customerAnalytics: summary.customerIntelligence,
    stagnantItems: tracking.stagnantItems,
    listItems: tracking.listItems,
    deliveryPerformance: summary.deliveryPerformance,
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
