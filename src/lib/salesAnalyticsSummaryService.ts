import { normalizeBranchName } from "@/lib/branch";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { StaffSalesSummary } from "@/lib/dashboardSummaryService";
import { fetchStaffIdentityRows, groupStaffSalesPerformance } from "@/lib/staffIdentityService";

type Row = Record<string, unknown>;

export type SalesAnalyticsFilters = {
  startDate: string;
  endDate: string;
  branch?: string;
  doctor?: string;
};

export type SalesAnalyticsSummary = {
  kpis: {
    netSales: number;
    invoicesCount: number;
    avgInvoice: number;
    uniqueCustomers: number;
    activeDays: number;
  };
  dailyTrend: Array<{ date: string; netSales: number; invoicesCount: number; avgInvoice: number; uniqueCustomers: number }>;
  branchRows: Array<{ branch: string; netSales: number; invoicesCount: number; avgInvoice: number; uniqueCustomers: number; share: number }>;
  doctorRows: Array<{ staffId: string | null; doctor: string; branch: string | null; netSales: number; invoicesCount: number; avgInvoice: number; uniqueCustomers: number; duplicateWarning: string | null }>;
  customerCards: {
    important: number | null;
    stopped: number | null;
    threatened: number | null;
    invalidPhone: number | null;
  };
  dataHealth: {
    invoicesWithoutCustomer: number | null;
    invoicesWithoutDoctor: number | null;
    invoicesWithoutBranch: number | null;
  };
  sourceHealth: Array<{ source: string; status: "ready" | "empty" | "error"; message: string | null }>;
  errorsBySection: Record<string, string>;
};

const cache = new Map<string, SalesAnalyticsSummary>();

function isAll(value?: string | null) {
  return !value || value === "الكل" || value === "كل الفروع" || value === "all";
}

function dayAfter(date: string) {
  const next = new Date(`${date}T12:00:00`);
  next.setDate(next.getDate() + 1);
  return next.toISOString().slice(0, 10);
}

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function read(row: Row, keys: string[], fallback: unknown = null) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return fallback;
}

async function fetchAllSummaryRows(table: string, dateColumn: string, startDate: string, endDate: string, branch?: string, doctor?: string) {
  const rows: Row[] = [];
  let errorMessage: string | null = null;
  const pageSize = 1000;
  for (let from = 0; from < 10000; from += pageSize) {
    let query = supabase
      .from(table)
      .select("*")
      .gte(dateColumn, startDate)
      .lt(dateColumn, dayAfter(endDate))
      .range(from, from + pageSize - 1);
    if (!isAll(branch)) query = query.eq("branch", branch);
    if (doctor && !isAll(doctor) && table === "staff_sales_summary") query = query.eq("seller_name", doctor);
    const { data, error } = await query;
    if (error) {
      errorMessage = error.message;
      break;
    }
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < pageSize) break;
  }
  return { rows, error: errorMessage };
}

async function countCustomers(filter: (query: any) => any) {
  const { count, error } = await filter(supabase.from("customer_metrics_summary").select("final_customer_key", { count: "exact", head: true }));
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function countMissing(column: string, startDate: string, endDate: string, branch?: string) {
  let query = supabase
    .from("sales_invoices")
    .select("id", { count: "exact", head: true })
    .gte("invoice_date", startDate)
    .lt("invoice_date", dayAfter(endDate))
    .or(`${column}.is.null,${column}.eq.`);
  if (!isAll(branch)) query = query.eq("branch", branch);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function loadSalesAnalyticsSummary(filters: SalesAnalyticsFilters, forceRefresh = false): Promise<SalesAnalyticsSummary> {
  if (!isSupabaseConfigured) throw new Error("إعدادات Supabase غير موجودة.");
  const key = JSON.stringify(filters);
  if (!forceRefresh && cache.has(key)) return cache.get(key)!;

  const errorsBySection: Record<string, string> = {};
  const sourceHealth: SalesAnalyticsSummary["sourceHealth"] = [];
  const [salesResult, staffResult, staffIdentityResult, customerResult, healthResult] = await Promise.allSettled([
    fetchAllSummaryRows("sales_daily_summary", "sale_date", filters.startDate, filters.endDate, filters.branch),
    fetchAllSummaryRows("staff_sales_summary", "sale_date", filters.startDate, filters.endDate, filters.branch, filters.doctor),
    fetchStaffIdentityRows(),
    Promise.all([
      countCustomers((query) => query.in("segment", ["مهم جدًا", "مهم"])),
      countCustomers((query) => query.eq("customer_status", "متوقف")),
      countCustomers((query) => query.eq("customer_status", "مهدد بالتوقف")),
      countCustomers((query) => query.or("customer_phone.is.null,customer_phone.eq.,customer_phone.ilike.code:%")),
    ]),
    Promise.all([
      countMissing("customer_code", filters.startDate, filters.endDate, filters.branch),
      countMissing("seller_name", filters.startDate, filters.endDate, filters.branch),
      countMissing("branch", filters.startDate, filters.endDate, filters.branch),
    ]),
  ]);

  const salesRows = salesResult.status === "fulfilled" ? salesResult.value.rows : [];
  const staffRows = staffResult.status === "fulfilled" ? staffResult.value.rows : [];
  if (salesResult.status === "rejected" || salesResult.value.error) errorsBySection.sales = salesResult.status === "rejected" ? String(salesResult.reason) : salesResult.value.error || "";
  if (staffResult.status === "rejected" || staffResult.value.error) errorsBySection.doctors = staffResult.status === "rejected" ? String(staffResult.reason) : staffResult.value.error || "";

  sourceHealth.push({ source: "sales_daily_summary", status: salesRows.length ? "ready" : errorsBySection.sales ? "error" : "empty", message: errorsBySection.sales || null });
  sourceHealth.push({ source: "staff_sales_summary", status: staffRows.length ? "ready" : errorsBySection.doctors ? "error" : "empty", message: errorsBySection.doctors || null });

  const dailyTrend = salesRows
    .map((row) => ({
      date: String(read(row, ["sale_date"], "")),
      netSales: toNumber(read(row, ["net_total"])),
      invoicesCount: toNumber(read(row, ["invoices_count", "invoice_count"])),
      avgInvoice: toNumber(read(row, ["avg_invoice", "average_invoice"])),
      uniqueCustomers: toNumber(read(row, ["unique_customers", "customers_count"])),
      branch: normalizeBranchName(read(row, ["branch"], null)),
    }))
    .filter((row) => row.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  const netSales = dailyTrend.reduce((sum, row) => sum + row.netSales, 0);
  const invoicesCount = dailyTrend.reduce((sum, row) => sum + row.invoicesCount, 0);
  const uniqueCustomers = dailyTrend.reduce((sum, row) => sum + row.uniqueCustomers, 0);

  const byBranch = new Map<string, { branch: string; netSales: number; invoicesCount: number; uniqueCustomers: number }>();
  for (const row of dailyTrend) {
    const branch = row.branch || "غير محدد";
    const current = byBranch.get(branch) || { branch, netSales: 0, invoicesCount: 0, uniqueCustomers: 0 };
    current.netSales += row.netSales;
    current.invoicesCount += row.invoicesCount;
    current.uniqueCustomers += row.uniqueCustomers;
    byBranch.set(branch, current);
  }

  const staffIdentityRows = staffIdentityResult.status === "fulfilled" ? staffIdentityResult.value : [];
  const staffSalesRows = staffRows.map((row) => ({
    saleDate: String(read(row, ["sale_date"], "") || "").slice(0, 10),
    sellerName: read(row, ["seller_name", "doctor_name"], null) as string | null,
    branch: normalizeBranchName(read(row, ["branch"], null)),
    netTotal: toNumber(read(row, ["net_total"])),
    invoicesCount: toNumber(read(row, ["invoices_count", "invoice_count"])),
    avgInvoice: toNumber(read(row, ["avg_invoice"])),
    uniqueCustomers: toNumber(read(row, ["unique_customers", "customers_count"])),
  })) satisfies StaffSalesSummary[];

  const doctorRows = groupStaffSalesPerformance(staffSalesRows, staffIdentityRows)
    .map((row) => ({
      staffId: row.staffId,
      doctor: row.displayName,
      branch: row.branch,
      netSales: row.netTotal,
      invoicesCount: row.invoicesCount,
      avgInvoice: row.avgInvoice,
      uniqueCustomers: row.uniqueCustomers,
      duplicateWarning: row.duplicateWarning,
    }))
    .filter((row) => row.doctor && row.doctor !== "غير محدد")
    .sort((a, b) => b.netSales - a.netSales)
    .slice(0, 30);

  const data: SalesAnalyticsSummary = {
    kpis: {
      netSales,
      invoicesCount,
      avgInvoice: invoicesCount ? netSales / invoicesCount : 0,
      uniqueCustomers,
      activeDays: new Set(dailyTrend.filter((row) => row.netSales > 0).map((row) => row.date)).size,
    },
    dailyTrend,
    branchRows: [...byBranch.values()].map((row) => ({
      ...row,
      avgInvoice: row.invoicesCount ? row.netSales / row.invoicesCount : 0,
      share: netSales ? (row.netSales / netSales) * 100 : 0,
    })).sort((a, b) => b.netSales - a.netSales),
    doctorRows,
    customerCards: customerResult.status === "fulfilled"
      ? { important: customerResult.value[0], stopped: customerResult.value[1], threatened: customerResult.value[2], invalidPhone: customerResult.value[3] }
      : { important: null, stopped: null, threatened: null, invalidPhone: null },
    dataHealth: healthResult.status === "fulfilled"
      ? { invoicesWithoutCustomer: healthResult.value[0], invoicesWithoutDoctor: healthResult.value[1], invoicesWithoutBranch: healthResult.value[2] }
      : { invoicesWithoutCustomer: null, invoicesWithoutDoctor: null, invoicesWithoutBranch: null },
    sourceHealth,
    errorsBySection,
  };

  cache.set(key, data);
  return data;
}

export function clearSalesAnalyticsSummaryCache() {
  cache.clear();
}
