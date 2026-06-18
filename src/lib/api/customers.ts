import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import {
  normalizeCustomerSegment,
  normalizeCustomerStatus,
  isPseudoCustomer,
  isValidEgyptPhone,
  getBestCustomerPhone,
  customerFlagLabels,
} from "@/lib/customerAnalyticsService";
import { normalizeBranchName } from "@/lib/branch";
import { getCustomerFullProfile, clearCustomerProfileCache } from "@/lib/customerProfileService";
import type { Customer as CustomerDbType } from "@/types/database";
import { getInvoiceKey } from "@/lib/dawaa2027";
import { buildCustomerFlagsForDb, parseCustomerFlags } from "@/lib/customerFlags";
import { getCustomerCashbackSummary, getCustomerWelcomeStatus, getCustomerInvoiceClassifications, type CustomerCashbackSummary, type CustomerWelcomeStatus, type CustomerInvoiceClassificationRow } from "@/lib/api/customerLoyalty";

const DEFAULT_LIMIT = 30;
export const ALL_FILTER = "الكل";
const SUMMARY_TABLE = "dawaa_customer_metrics_app_view";
const RAW_SUMMARY_TABLE = "customer_metrics_summary";

export function clearCustomersCache() {
  // Customers list reads customer_metrics_summary directly; this hook keeps import invalidation explicit.
}

import type { CustomerMetric as CustomerMetricType, CustomerLike } from "@/types/domain";

type Row = Record<string, unknown>;

export type CustomerMetric = CustomerMetricType;

export interface GetCustomersOptions {
  search?: string;
  limit?: number;
  offset?: number;
  branch?: string;
  type?: string;
  status?: string;
  minTotal?: number;
  maxTotal?: number;
}

export interface CustomerStats {
  total: number;
  summaryTotal: number;
  veryImportant: number;
  important: number;
  medium: number;
  normal: number;
  newC: number;
  active: number;
  atRisk: number;
  stopped: number;
  noPurchase: number;
  vip: number;
  loyal: number;
}

export interface CustomerMonthlyAnalyticsRow {
  month: string;
  label: string;
  registeredCustomers: number | null;
  purchasedCustomers: number | null;
  veryImportant: number | null;
  important: number | null;
  medium: number | null;
  normal: number | null;
}

export interface CustomerMonthlyAnalytics {
  rows: CustomerMonthlyAnalyticsRow[];
  source: string;
  warnings: string[];
}

export interface CustomerInvoiceSummary {
  invoice_number: string | null;
  invoice_date: string | null;
  amount: number;
  seller_name: string | null;
  branch: string | null;
}

export interface CustomerFollowupSummary {
  id: string;
  status: string | null;
  assigned_to: string | null;
  responsible_name: string | null;
  notes: string | null;
  followup_result: string | null;
  created_at: string | null;
  followup_date: string | null;
  completed_at: string | null;
}


export interface CustomerActiveAlert {
  id: string;
  alert_type: string;
  title: string;
  description: string | null;
  priority: string | null;
  due_date: string | null;
  end_date: string | null;
  status: string | null;
}
export interface CustomerDetails {
  invoices: CustomerInvoiceSummary[];
  followups: CustomerFollowupSummary[];
  lastFollowup: CustomerFollowupSummary | null;
  topDoctor: string | null;
  lastServiceDoctor: string | null;
  lastFollowupReport: string | null;
  avgMonthlyVisits: number | null;
  currentMonthVisits: number | null;
  previousMonthVisits: number | null;
  purchaseFrequencyStatus: string | null;
  purchaseFrequencyRecommendation: string | null;
  customerNotes: string | null;
  whatsappNotes: string | null;
  serviceNotes: string | null;
  teamNotes: string | null;
  handlingNotes: string | null;
  address: string | null;
  phoneAlt: string | null;
  whatsappPhone: string | null;
  customerFlags: any;
  isPseudoCustomer: boolean;
  hasValidPhone: boolean;
  purchaseAnalysis: PurchaseAnalysis | null;
  activeAlerts: CustomerActiveAlert[];
  cashback: CustomerCashbackSummary | null;
  welcomeStatus: CustomerWelcomeStatus | null;
  invoiceClassifications: CustomerInvoiceClassificationRow[];
}

export interface PurchaseAnalysis {
  purchaseCountCurrentMonth: number;
  purchaseCountPreviousMonth: number;
  averageMonthlyPurchaseCount: number;
  purchaseFrequencyStatus: string;
  recommendation: string;
}

interface CustomerProfile {
  id: string;
  customer_code?: string | null;
  customer_phone?: string | null;
  phone?: string | null;
  notes?: string | null;
  whatsapp_notes?: string | null;
  customer_notes?: string | null;
  service_notes?: string | null;
  team_notes?: string | null;
  handling_notes?: string | null;
  address?: string | null;
  phone_alt?: string | null;
  whatsapp_phone?: string | null;
  customer_flags?: Record<string, boolean> | null;
  branch?: string | null;
}

function normalizeLimit(limit?: number) {
  if (!limit || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(limit, 100);
}

function toNumber(value: unknown) {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function readFirst(row: Row | null | undefined, keys: string[], fallback: unknown = null) {
  if (!row) return fallback;
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return fallback;
}

function isAll(value?: string | null) {
  return !value || value === ALL_FILTER || value === "كل العملاء" || value === "كل التصنيفات" || value === "كل الحالات" || value === "كل الفروع";
}

function isUuidLike(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value ?? "").trim());
}

function isoDateDaysAgo(days: number) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function normalizeSearchPattern(search: string) {
  const trimmed = search.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  const safe = trimmed.replace(/[%,()]/g, "").replace(/\*/g, "%");
  return safe.includes("%") ? safe : `%${safe}%`;
}

export function normalizeCustomerMetric(row: Row): CustomerMetric {
  const totalSpent = toNumber(readFirst(row, ["total_spent"], 0));
  const avgMonthly = toNumber(readFirst(row, ["avg_monthly"], 0));
  const firstPurchase = readFirst(row, ["first_purchase"], null) as string | null;
  const lastPurchase = readFirst(row, ["last_purchase"], null) as string | null;
  const invoicesCount = toNumber(readFirst(row, ["invoices_count"], 0));
  const segment = normalizeCustomerSegment(readFirst(row, ["segment"], null), totalSpent, avgMonthly);
  const status = invoicesCount <= 0 || !lastPurchase
    ? "بدون شراء"
    : normalizeCustomerStatus(readFirst(row, ["customer_status"], null), lastPurchase, firstPurchase);
  const customerId = readFirst(row, ["customer_id"], null) as string | null;
  const finalKey = readFirst(row, ["final_customer_key"], null) as string | null;
  const customerCode = readFirst(row, ["customer_code"], null) as string | null;
  const phone = readFirst(row, ["customer_phone"], null) as string | null;
  const name = readFirst(row, ["customer_name"], null) as string | null;

  return {
    id: String(finalKey || customerId || customerCode || phone || crypto.randomUUID()),
    final_customer_key: finalKey,
    customer_id: customerId,
    customer_code: customerCode,
    customer_name: name,
    customer_phone: phone,
    phone,
    name,
    branch: normalizeBranchName(readFirst(row, ["branch"], null)),
    invoices_count: invoicesCount,
    total_spent: totalSpent,
    total_purchases: totalSpent,
    avg_invoice: toNumber(readFirst(row, ["avg_invoice"], 0)),
    first_purchase: firstPurchase,
    last_purchase: lastPurchase,
    active_months: toNumber(readFirst(row, ["active_months"], 0)),
    avg_monthly: avgMonthly,
    segment,
    type: segment,
    customer_status: status,
    status,
    retention_status: status,
  };
}

function dateOnly(value?: string | null) {
  return String(value || "").slice(0, 10);
}

function isAfterDate(a?: string | null, b?: string | null) {
  const left = dateOnly(a);
  const right = dateOnly(b);
  if (!left) return false;
  if (!right) return true;
  return left > right;
}

function isBeforeDate(a?: string | null, b?: string | null) {
  const left = dateOnly(a);
  const right = dateOnly(b);
  if (!left) return false;
  if (!right) return true;
  return left < right;
}

function normalizeMetricAfterInvoicePatch(customer: CustomerMetric): CustomerMetric {
  const status = customer.invoices_count <= 0 || !customer.last_purchase
    ? "بدون شراء"
    : normalizeCustomerStatus(customer.customer_status, customer.last_purchase, customer.first_purchase);
  return { ...customer, customer_status: status, status, retention_status: status };
}

async function patchCustomerMetricsFromInvoices(customers: CustomerMetric[]) {
  const codes = [...new Set(customers.map((customer) => String(customer.customer_code || "").trim()).filter(Boolean))];
  if (!codes.length) return customers;

  const { data, error } = await supabase
    .from("sales_invoices")
    .select("id,customer_code,invoice_date,net_amount,discounted_amount,amount,gross_amount")
    .in("customer_code", codes)
    .limit(10000);

  if (error || !data?.length) return customers;

  const aggregates = new Map<string, { count: number; total: number; first: string | null; last: string | null; months: Set<string> }>();
  for (const row of (data || []) as Row[]) {
    const code = String(readFirst(row, ["customer_code"], "") || "").trim();
    if (!code) continue;
    const invoiceDate = dateOnly(readFirst(row, ["invoice_date"], null) as string | null);
    const current = aggregates.get(code) || { count: 0, total: 0, first: null, last: null, months: new Set<string>() };
    current.count += 1;
    current.total += toNumber(readFirst(row, ["net_amount", "discounted_amount", "amount", "gross_amount"], 0));
    if (invoiceDate) {
      if (isBeforeDate(invoiceDate, current.first)) current.first = invoiceDate;
      if (isAfterDate(invoiceDate, current.last)) current.last = invoiceDate;
      current.months.add(invoiceDate.slice(0, 7));
    }
    aggregates.set(code, current);
  }

  return customers.map((customer) => {
    const aggregate = aggregates.get(String(customer.customer_code || "").trim());
    if (!aggregate) return customer;
    const invoicesCount = Math.max(customer.invoices_count || 0, aggregate.count);
    const totalSpent = Math.max(customer.total_spent || 0, aggregate.total);
    const patched: CustomerMetric = {
      ...customer,
      invoices_count: invoicesCount,
      total_spent: totalSpent,
      total_purchases: totalSpent,
      avg_invoice: invoicesCount > 0 ? Math.max(customer.avg_invoice || 0, totalSpent / invoicesCount) : customer.avg_invoice,
      first_purchase: isBeforeDate(aggregate.first, customer.first_purchase) ? aggregate.first : customer.first_purchase,
      last_purchase: isAfterDate(aggregate.last, customer.last_purchase) ? aggregate.last : customer.last_purchase,
      active_months: Math.max(customer.active_months || 0, aggregate.months.size),
    };
    return normalizeMetricAfterInvoicePatch(patched);
  });
}

function applyBranchFilter<T>(query: T, branch?: string): T {
  if (isAll(branch)) return query;
  return (query as any).eq("branch", branch);
}

function normalizeSegmentLabel(value?: string | null) {
  const raw = String(value ?? "").trim().toLowerCase().replace("جدا", "جدًا").replace("جداً", "جدًا");
  if (["مهم جدًا", "vip", "very important"].includes(raw)) return "مهم جدًا";
  if (["مهم", "important"].includes(raw)) return "مهم";
  if (["متوسط", "medium"].includes(raw)) return "متوسط";
  return "عادي";
}

function applySegmentFilter<T>(query: T, segment?: string): T {
  if (isAll(segment)) return query;
  const normalized = normalizeSegmentLabel(segment);
  if (normalized === "مهم جدًا") return (query as any).gt("avg_monthly", 8000);
  if (normalized === "مهم") return (query as any).gt("avg_monthly", 4000).lte("avg_monthly", 8000);
  if (normalized === "متوسط") return (query as any).gt("avg_monthly", 1500).lte("avg_monthly", 4000);
  return (query as any).lte("avg_monthly", 1500);
}

function applyStatusFilter<T>(query: T, status?: string): T {
  if (isAll(status)) return query;
  const normalized = normalizeCustomerStatus(status, null, null);
  const activeCutoff = isoDateDaysAgo(45);
  const riskCutoff = isoDateDaysAgo(90);
  const newCutoff = isoDateDaysAgo(30);

  if (normalized === "بدون شراء") {
    return (query as any).or("invoices_count.lte.0,last_purchase.is.null");
  }
  if (normalized === "جديد") {
    return (query as any).gte("first_purchase", newCutoff).gt("invoices_count", 0);
  }
  if (normalized === "نشط") {
    return (query as any).gte("last_purchase", activeCutoff).lt("first_purchase", newCutoff).gt("invoices_count", 0);
  }
  if (normalized === "مهدد بالتوقف") {
    return (query as any).lt("last_purchase", activeCutoff).gte("last_purchase", riskCutoff).gt("invoices_count", 0);
  }
  if (normalized === "متوقف") {
    return (query as any).lt("last_purchase", riskCutoff).gt("invoices_count", 0);
  }
  return query;
}

function applySearch<T>(query: T, search?: string): T {
  const pattern = normalizeSearchPattern(search || "");
  if (!pattern) return query;
  const digits = String(search || "").replace(/[^\d٠-٩]/g, "");
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  const latinDigits = digits.replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)));
  const phonePattern = latinDigits.length >= 2 ? normalizeSearchPattern(latinDigits.includes("*") ? latinDigits : `*${latinDigits}*`) : null;
  const clauses = [
    `customer_code.ilike.${pattern}`,
    `customer_name.ilike.${pattern}`,
    `customer_phone.ilike.${phonePattern || pattern}`,
    `final_customer_key.ilike.${pattern}`,
  ];
  return (query as any).or(clauses.join(","));
}

function applyListFilters<T>(query: T, options: GetCustomersOptions): T {
  query = applyBranchFilter(query, options.branch);
  query = applySegmentFilter(query, options.type);
  query = applyStatusFilter(query, options.status);
  query = applySearch(query, options.search);
  if (typeof options.minTotal === "number" && Number.isFinite(options.minTotal)) {
    query = (query as any).gte("total_spent", options.minTotal);
  }
  if (typeof options.maxTotal === "number" && Number.isFinite(options.maxTotal)) {
    query = (query as any).lte("total_spent", options.maxTotal);
  }
  return query;
}

export async function getCustomers(options: GetCustomersOptions = {}) {
  if (!isSupabaseConfigured) {
    throw new Error("إعدادات Supabase غير موجودة. أضف VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY في ملف .env.");
  }

  const limit = normalizeLimit(options.limit);
  const offset = Math.max(options.offset ?? 0, 0);
  
  if (import.meta.env.DEV) {
    console.log("[getCustomers] Query Options:", { search: options.search, branch: options.branch, type: options.type, status: options.status, limit, offset });
  }
  
  let query = supabase
    .from(SUMMARY_TABLE)
    .select("final_customer_key,customer_id,customer_code,customer_name,customer_phone,branch,invoices_count,total_spent,avg_invoice,first_purchase,last_purchase,active_months,avg_monthly,segment,customer_status", { count: "exact" });

  query = applyListFilters(query, options);

  const { data, error, count } = await query
    .order("avg_monthly", { ascending: false, nullsFirst: false })
    .order("total_spent", { ascending: false, nullsFirst: false })
    .order("last_purchase", { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1);

  if (import.meta.env.DEV) {
    console.log("[getCustomers] Raw Supabase Response:", { 
      dataLength: data?.length ?? 0, 
      count, 
      hasError: !!error,
      errorMsg: error?.message,
      firstRow: data?.[0],
      filters: options,
    });
  }

  if (error) {
    console.error("[getCustomers] Supabase Error:", error);
    throw new Error(`customer_metrics_summary: ${error.message}`);
  }

  const mapped = await patchCustomerMetricsFromInvoices(((data ?? []) as Row[]).map(normalizeCustomerMetric));
  
  if (!options.search?.trim() && isAll(options.branch) && isAll(options.type) && isAll(options.status) && count === 0) {
    const fallback = await supabase
      .from(SUMMARY_TABLE)
      .select("final_customer_key,customer_name,segment,customer_status,avg_monthly")
      .order("avg_monthly", { ascending: false, nullsFirst: false })
      .limit(5);

    if (import.meta.env.DEV) {
      console.log("[getCustomers] Fallback probe query (no filters, zero results):", {
        fallbackCount: fallback.data?.length ?? 0,
        fallbackFirstRow: fallback.data?.[0],
        fallbackError: fallback.error?.message,
      });
    }
  }
  
  if (import.meta.env.DEV && mapped.length > 0) {
    console.log("[getCustomers] First Mapped Customer:", mapped[0]);
  }

  return {
    customers: mapped,
    count: count ?? 0,
    limit,
    offset,
  };
}

async function countRows(options: GetCustomersOptions = {}) {
  let query = supabase
    .from(SUMMARY_TABLE)
    .select("final_customer_key", { count: "exact", head: true });
  query = applyListFilters(query, options);
  const { count, error } = await query;
  if (import.meta.env.DEV && (options.type || options.status)) {
    console.log("[countRows]", options, "=>", count);
  }
  if (error) throw new Error(`customer_metrics_summary: ${error.message}`);
  return count ?? 0;
}

async function countRegisteredCustomers() {
  const { count, error } = await supabase
    .from("customers")
    .select("id", { count: "exact", head: true });
  if (error) throw new Error(`customers: ${error.message}`);
  return count ?? 0;
}

async function countLoyalCustomers() {
  const { count, error } = await supabase
    .from(SUMMARY_TABLE)
    .select("final_customer_key", { count: "exact", head: true })
    .gte("active_months", 6);
  if (error) throw new Error(`customer_metrics_summary: ${error.message}`);
  return count ?? 0;
}

function monthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function toDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function monthLabel(date: Date) {
  return date.toLocaleDateString("ar-EG", { month: "long", year: "numeric" });
}

async function safeCount(table: string, apply: (query: any) => any): Promise<{ count: number | null; warning?: string }> {
  try {
    const { count, error } = await apply(supabase.from(table).select("*", { count: "exact", head: true }));
    if (error) return { count: null, warning: `${table}: ${error.message}` };
    return { count: count ?? 0 };
  } catch (error) {
    return { count: null, warning: error instanceof Error ? `${table}: ${error.message}` : `${table}: تعذر العد` };
  }
}

export async function getCustomerMonthlyAnalytics(months = 6): Promise<CustomerMonthlyAnalytics> {
  if (!isSupabaseConfigured) {
    throw new Error("إعدادات Supabase غير موجودة.");
  }

  const safeMonths = Math.min(Math.max(months, 3), 12);
  const current = monthStart(new Date());
  const starts = Array.from({ length: safeMonths }, (_, index) => addMonths(current, index - safeMonths + 1));
  const warnings: string[] = [];

  const rows = await Promise.all(starts.map(async (start) => {
    const end = addMonths(start, 1);
    const startIso = toDateOnly(start);
    const endIso = toDateOnly(end);

    const [
      registered,
      purchased,
      veryImportant,
      important,
      medium,
      normal,
    ] = await Promise.all([
      safeCount("customers", (query) => query.gte("created_at", startIso).lt("created_at", endIso)),
      safeCount(SUMMARY_TABLE, (query) => query.gte("first_purchase", startIso).lt("first_purchase", endIso)),
      safeCount(SUMMARY_TABLE, (query) => applySegmentFilter(query.gte("first_purchase", startIso).lt("first_purchase", endIso), "مهم جدًا")),
      safeCount(SUMMARY_TABLE, (query) => applySegmentFilter(query.gte("first_purchase", startIso).lt("first_purchase", endIso), "مهم")),
      safeCount(SUMMARY_TABLE, (query) => applySegmentFilter(query.gte("first_purchase", startIso).lt("first_purchase", endIso), "متوسط")),
      safeCount(SUMMARY_TABLE, (query) => applySegmentFilter(query.gte("first_purchase", startIso).lt("first_purchase", endIso), "عادي")),
    ]);

    [registered, purchased, veryImportant, important, medium, normal].forEach((result) => {
      if (result.warning) warnings.push(result.warning);
    });

    return {
      month: startIso.slice(0, 7),
      label: monthLabel(start),
      registeredCustomers: registered.count,
      purchasedCustomers: purchased.count,
      veryImportant: veryImportant.count,
      important: important.count,
      medium: medium.count,
      normal: normal.count,
    };
  }));

  return {
    rows,
    source: "customers.created_at + daw من ملخص العملاء",
    warnings: Array.from(new Set(warnings)).slice(0, 4),
  };
}

export async function getCustomerStats(): Promise<CustomerStats> {
  if (!isSupabaseConfigured) {
    throw new Error("إعدادات Supabase غير موجودة.");
  }

  // مصدر أسرع وأكثر ثباتًا لكروت صفحة العملاء.
  // هذا يمنع مشكلة ظهور كل الكروت = 0 عندما تكون الفلاتر القديمة لا تطابق أسماء الأعمدة/القيم.
  try {
    const { data, error } = await supabase
      .from("dawaa_customer_dashboard_cards_check_v1")
      .select("card,value");

    if (!error && Array.isArray(data) && data.length) {
      const map = new Map<string, number>();
      for (const row of data as Array<{ card: string; value: number | string | null }>) {
        map.set(String(row.card), Number(row.value ?? 0) || 0);
      }

      const registeredTotal = map.get("إجمالي العملاء المسجلين") ?? 0;
      const summaryTotal = map.get("صفوف ملخص العملاء") ?? 0;
      const veryImportant = map.get("مهم جدًا") ?? 0;
      const important = map.get("مهم") ?? 0;
      const medium = map.get("متوسط") ?? 0;
      const normal = map.get("عادي") ?? 0;
      const newC = map.get("جديد") ?? 0;
      const active = map.get("نشط") ?? 0;
      const atRisk = map.get("مهدد بالتوقف") ?? 0;
      const stopped = map.get("متوقف") ?? 0;
      const noPurchase = map.get("بدون شراء") ?? 0;
      const loyal = map.get("عملاء دائمين +6 شهور") ?? 0;

      return {
        total: registeredTotal,
        summaryTotal,
        veryImportant,
        important,
        medium,
        normal,
        newC,
        active,
        atRisk,
        stopped,
        noPurchase,
        vip: veryImportant,
        loyal,
      };
    }

    if (error) {
      console.warn("[getCustomerStats] dashboard view failed, fallback to counts:", error.message);
    }
  } catch (error) {
    console.warn("[getCustomerStats] dashboard view exception, fallback to counts:", error);
  }

  const [
    registeredTotal,
    summaryTotal,
    veryImportant,
    important,
    medium,
    normal,
    newC,
    active,
    atRisk,
    stopped,
    noPurchase,
    loyal,
  ] = await Promise.all([
    countRegisteredCustomers(),
    countRows(),
    countRows({ type: "مهم جدًا" }),
    countRows({ type: "مهم" }),
    countRows({ type: "متوسط" }),
    countRows({ type: "عادي" }),
    countRows({ status: "جديد" }),
    countRows({ status: "نشط" }),
    countRows({ status: "مهدد بالتوقف" }),
    countRows({ status: "متوقف" }),
    countRows({ status: "بدون شراء" }),
    countLoyalCustomers(),
  ]);

  return {
    total: registeredTotal,
    summaryTotal,
    veryImportant,
    important,
    medium,
    normal,
    newC,
    active,
    atRisk,
    stopped,
    noPurchase,
    vip: veryImportant,
    loyal,
  };
}

async function getCustomerProfile(customer: CustomerMetric): Promise<CustomerProfile | null> {
  const customerId = customer.customer_id && isUuidLike(customer.customer_id) ? customer.customer_id : null;
  const customerCode = customer.customer_code ? customer.customer_code : null;
  const customerPhone = customer.customer_phone ? customer.customer_phone : null;

  if (!customerId && !customerCode && !customerPhone) return null;

  let query = supabase
    .from("customers")
    .select("id,customer_code,customer_phone,phone,notes,whatsapp_notes,customer_notes,service_notes,team_notes,handling_notes,address,phone_alt,whatsapp_phone,customer_flags,branch")
    .limit(1);

  if (customerId) {
    query = query.eq("id", customerId);
  } else if (customerCode) {
    query = query.eq("customer_code", customerCode);
  } else {
    query = query.or(`customer_phone.eq.${customerPhone},phone.eq.${customerPhone}`);
  }

  const { data, error } = await query;
  if (error) {
    console.warn("[getCustomerProfile] Supabase Error:", error.message);
    return null;
  }

  return (data?.[0] ?? null) as CustomerProfile | null;
}


async function saveDurableCustomerFlags(customer: CustomerMetric, flags: Record<string, boolean> | null | undefined, existingProfile?: CustomerProfile | null) {
  if (!flags) return null;
  const customerCode = String(customer.customer_code || existingProfile?.customer_code || "").trim() || null;
  const customerPhone = String(customer.customer_phone || customer.phone || existingProfile?.customer_phone || existingProfile?.phone || "").trim() || null;
  const customerName = String(customer.customer_name || customer.name || "").trim() || null;
  const customerId = customer.customer_id && isUuidLike(customer.customer_id) ? customer.customer_id : existingProfile?.id || null;
  const activeKeys = Object.entries(flags).filter(([, value]) => Boolean(value)).map(([key]) => key);
  const flagsJson = buildCustomerFlagsForDb(existingProfile?.customer_flags || {}, flags);

  const { data, error } = await supabase.rpc("dawaa_save_customer_important_tags_v1", {
    p_customer_id: customerId,
    p_customer_code: customerCode,
    p_customer_phone: customerPhone,
    p_customer_name: customerName,
    p_flags: flagsJson,
    p_tags: activeKeys,
  });

  if (error) {
    // fallback to customers table so the UI does not lose the selected flags
    if (existingProfile?.id) {
      const fallback = await supabase.from("customers").update({ customer_flags: flagsJson, updated_at: new Date().toISOString() }).eq("id", existingProfile.id).select("*").maybeSingle();
      if (fallback.error) throw new Error(fallback.error.message);
      return fallback.data as CustomerProfile | null;
    }
    throw new Error(error.message);
  }

  return (data && typeof data === "object" ? data : null) as CustomerProfile | null;
}


export type CustomerProfileUpdatePayload = {
  customer_notes?: string | null;
  whatsapp_notes?: string | null;
  service_notes?: string | null;
  team_notes?: string | null;
  handling_notes?: string | null;
  address?: string | null;
  phone_alt?: string | null;
  whatsapp_phone?: string | null;
  flags?: Record<string, boolean> | null;
};

export async function saveCustomerProfileNotes(customer: CustomerMetric, payload: CustomerProfileUpdatePayload) {
  if (!isSupabaseConfigured) {
    throw new Error("إعدادات Supabase غير موجودة.");
  }

  const profile = await getCustomerProfile(customer);
  const updatePayload: Record<string, unknown> = {};
  const assign = (key: string, value: unknown) => {
    if (value !== undefined) updatePayload[key] = value === "" ? null : value;
  };

  assign("customer_notes", payload.customer_notes ?? null);
  assign("whatsapp_notes", payload.whatsapp_notes ?? null);
  assign("service_notes", payload.service_notes ?? null);
  assign("team_notes", payload.team_notes ?? null);
  assign("handling_notes", payload.handling_notes ?? null);
  assign("address", payload.address ?? null);
  assign("phone_alt", payload.phone_alt ?? null);
  assign("whatsapp_phone", payload.whatsapp_phone ?? null);

  if (payload.flags) {
    updatePayload.customer_flags = buildCustomerFlagsForDb(profile?.customer_flags || {}, payload.flags);
  }

  const customerCode = String(customer.customer_code || "").trim() || null;
  const customerPhone = String(customer.customer_phone || customer.phone || "").trim() || null;
  const customerName = String(customer.customer_name || customer.name || "").trim() || "عميل بدون اسم";

  if (!profile && !customer.customer_id && !customerCode && !customerPhone) {
    throw new Error("لا يوجد عميل صالح لتحديثه.");
  }

  let saved: CustomerProfile | null = null;
  if (profile?.id) {
    const { data, error } = await supabase
      .from("customers")
      .update(updatePayload)
      .eq("id", profile.id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    saved = data as CustomerProfile | null;
  } else if (customer.customer_id && isUuidLike(customer.customer_id)) {
    const { data, error } = await supabase
      .from("customers")
      .update(updatePayload)
      .eq("id", customer.customer_id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    saved = data as CustomerProfile | null;
  } else if (customerCode) {
    const { data, error } = await supabase
      .from("customers")
      .update(updatePayload)
      .eq("customer_code", customerCode)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    saved = data as CustomerProfile | null;
  } else if (customerPhone) {
    const { data, error } = await supabase
      .from("customers")
      .update(updatePayload)
      .or(`customer_phone.eq.${customerPhone},phone.eq.${customerPhone},whatsapp_phone.eq.${customerPhone},phone_alt.eq.${customerPhone}`)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    saved = data as CustomerProfile | null;
  }

  // لو العميل موجود في الملخص فقط وليس له صف في customers، ننشئ صف آمن حتى لا تختفي الملاحظات عند إعادة الفتح.
  if (!saved) {
    const insertPayload = {
      customer_code: customerCode,
      name: customerName,
      phone: customerPhone,
      customer_phone: customerPhone,
      branch: customer.branch || null,
      ...updatePayload,
    };
    const { data, error } = await supabase
      .from("customers")
      .insert(insertPayload)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    saved = data as CustomerProfile | null;
  }

  if (payload.flags) {
    const durableSaved = await saveDurableCustomerFlags(customer, payload.flags, saved || profile);
    if (durableSaved) saved = { ...saved, ...durableSaved } as CustomerProfile;
  }

  clearCustomerProfileCache();
  if (!saved) throw new Error("تم الحفظ لكن تعذر قراءة صف العميل بعد التحديث.");
  return saved;
}

function customerInvoiceOrClauses(customer: CustomerMetric) {
  const code = String(customer.customer_code || "").trim();
  const phone = String(customer.customer_phone || customer.phone || "").replace(/[^0-9٠-٩]/g, "");
  const name = String(customer.customer_name || customer.name || "").trim();
  const clauses = [
    code ? `customer_code.eq.${code}` : "",
    phone ? `customer_phone.eq.${phone}` : "",
    phone ? `phone.eq.${phone}` : "",
    name ? `customer_name.eq.${name}` : "",
  ].filter(Boolean);
  return clauses.join(",");
}


type LiveCustomerInvoiceStats = {
  invoices: CustomerInvoiceSummary[];
  currentMonthVisits: number;
  previousMonthVisits: number;
  averageMonthlyVisits: number;
};

async function getLiveCustomerInvoiceStats(customer: CustomerMetric, invoiceLimit = 20): Promise<LiveCustomerInvoiceStats> {
  const clauses = customerInvoiceOrClauses(customer);
  if (!clauses) {
    return { invoices: [], currentMonthVisits: 0, previousMonthVisits: 0, averageMonthlyVisits: 0 };
  }

  try {
    const { data, error } = await supabase
      .from("dawaa_customer_invoice_stats_view")
      .select("id,invoice_key,invoice_no,invoice_number,invoice_date,sale_date,date,amount,seller_name,branch,customer_code,customer_name,customer_phone,phone")
      .or(clauses)
      .order("invoice_date", { ascending: false })
      .limit(2000);

    if (error || !data?.length) {
      return { invoices: [], currentMonthVisits: 0, previousMonthVisits: 0, averageMonthlyVisits: 0 };
    }

    const rows = (data || []) as Row[];
    const today = new Date();
    const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    const previousMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const previousMonth = `${previousMonthDate.getFullYear()}-${String(previousMonthDate.getMonth() + 1).padStart(2, "0")}`;
    const months = new Map<string, number>();

    const invoices = rows.map((row) => {
      const invoiceDate = String(readFirst(row, ["invoice_date", "sale_date", "date"], "") || "").slice(0, 10);
      const month = invoiceDate.slice(0, 7);
      if (month) months.set(month, (months.get(month) || 0) + 1);
      return {
        invoice_number: getInvoiceKey(row) || null,
        invoice_date: invoiceDate || null,
        amount: toNumber(readFirst(row, ["amount", "net_amount", "net_total", "total_amount", "gross_amount", "gross_total"], 0)),
        seller_name: readFirst(row, ["seller_name"], null) as string | null,
        branch: normalizeBranchName(readFirst(row, ["branch"], null)),
      };
    });

    const monthValues = [...months.values()];
    const averageMonthlyVisits = monthValues.length
      ? Math.round(monthValues.reduce((sum, value) => sum + value, 0) / monthValues.length)
      : 0;

    return {
      invoices: invoices.slice(0, Math.min(invoiceLimit, 100)),
      currentMonthVisits: months.get(currentMonth) || 0,
      previousMonthVisits: months.get(previousMonth) || 0,
      averageMonthlyVisits,
    };
  } catch {
    return { invoices: [], currentMonthVisits: 0, previousMonthVisits: 0, averageMonthlyVisits: 0 };
  }
}

function purchaseFrequencyStatus(current: number, previous: number) {
  if (current === 0 && previous >= 2) return "توقف عن الشراء";
  if (current * 2 <= previous && previous >= 2) return "انخفض الشراء";
  if (current === 0 && previous === 1) return "يحتاج متابعة";
  if (current === 0) return "بدون مشتريات هذا الشهر";
  return "طبيعي";
}

function purchaseFrequencyRecommendation(status: string) {
  if (status === "توقف عن الشراء") return "تابع العميل فوراً لاستعادة الشراء، وقدّم عرضاً شخصياً إذا أمكن.";
  if (status === "انخفض الشراء") return "راجع سبب انخفاض الأنشطة وراجع العروض المخصصة للعميل.";
  if (status === "يحتاج متابعة") return "اتصل بالعميل لتأكيد احتياجاته والتشجيع على الشراء القادم.";
  return "استمر في دعم العميل وقدم خدمات واضحة للحفاظ على العلاقة.";
}

async function getCustomerPurchaseFrequencyPatch(customer: CustomerMetric): Promise<PurchaseAnalysis | null> {
  const clauses = customerInvoiceOrClauses(customer);
  if (!clauses) return null;
  try {
    const { data, error } = await supabase
      .from("dawaa_customer_purchase_frequency_v2")
      .select("purchase_count_current_month,purchase_count_previous_month,average_monthly_purchase_count,purchase_frequency_status")
      .or(clauses)
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    const current = toNumber(readFirst(data as Row, ["purchase_count_current_month"], 0));
    const previous = toNumber(readFirst(data as Row, ["purchase_count_previous_month"], 0));
    const average = toNumber(readFirst(data as Row, ["average_monthly_purchase_count"], 0));
    const status = String(readFirst(data as Row, ["purchase_frequency_status"], purchaseFrequencyStatus(current, previous)) || purchaseFrequencyStatus(current, previous));
    return {
      purchaseCountCurrentMonth: current,
      purchaseCountPreviousMonth: previous,
      averageMonthlyPurchaseCount: average,
      purchaseFrequencyStatus: status,
      recommendation: purchaseFrequencyRecommendation(status),
    };
  } catch {
    return null;
  }
}

async function getCustomerActiveAlerts(customer: CustomerMetric): Promise<CustomerActiveAlert[]> {
  const clauses = [
    customer.customer_code ? `customer_code.eq.${customer.customer_code}` : "",
    customer.customer_phone ? `customer_phone.eq.${customer.customer_phone}` : "",
    customer.phone ? `customer_phone.eq.${customer.phone}` : "",
    customer.customer_id && isUuidLike(customer.customer_id) ? `customer_id.eq.${customer.customer_id}` : "",
  ].filter(Boolean).join(",");
  if (!clauses) return [];
  try {
    const { data, error } = await supabase
      .from("customer_active_alerts_view")
      .select("id,alert_type,title,description,priority,due_date,end_date,status")
      .or(clauses)
      .order("due_date", { ascending: true })
      .limit(20);
    if (error) return [];
    return (data || []) as CustomerActiveAlert[];
  } catch {
    return [];
  }
}

export async function createCustomerManualFollowup(customer: CustomerMetric, payload: { title: string; note?: string | null; due_date: string; followup_datetime?: string | null; priority?: string; source_invoice_number?: string | null; created_by?: string | null; created_by_name?: string | null; assigned_to?: string | null; responsible_name?: string | null; request_details?: string | null; request_type?: string | null; branch?: string | null; requested_by?: string | null; preferred_contact_method?: string | null; personality_note?: string | null; reason?: string | null }) {
  const requestPayload = {
    customer_code: customer.customer_code || null,
    customer_name: customer.customer_name || customer.name || null,
    customer_phone: customer.customer_phone || customer.phone || null,
    branch: payload.branch || customer.branch || null,
    title: payload.title,
    note: payload.note || null,
    due_date: payload.due_date,
    followup_datetime: payload.followup_datetime || null,
    priority: payload.priority || "normal",
    source_invoice_number: payload.source_invoice_number || null,
    created_by: payload.created_by || null,
    created_by_name: payload.created_by_name || null,
    assigned_to: payload.assigned_to || payload.responsible_name || null,
    request_details: payload.request_details || payload.note || null,
    request_type: payload.request_type || "doctor_requested_followup",
    requested_by: payload.requested_by || payload.created_by_name || null,
    preferred_contact_method: payload.preferred_contact_method || null,
    personality_note: payload.personality_note || null,
    reason: payload.reason || null,
  };

  const { error: rpcError } = await supabase.rpc("dawaa_create_customer_followup_request_v1", {
    p_payload: requestPayload as any,
  });

  if (!rpcError) return;

  // fallback آمن للنسخ القديمة من قاعدة البيانات
  const { error } = await supabase.from("customer_manual_followups").insert({
    customer_id: customer.customer_id && isUuidLike(customer.customer_id) ? customer.customer_id : null,
    customer_code: customer.customer_code,
    customer_name: customer.customer_name || customer.name,
    customer_phone: customer.customer_phone || customer.phone,
    branch: payload.branch || customer.branch,
    title: payload.title,
    note: payload.note || null,
    due_date: payload.due_date,
    followup_datetime: payload.followup_datetime || null,
    priority: payload.priority || "normal",
    source_invoice_number: payload.source_invoice_number || null,
    created_by: payload.created_by || null,
    created_by_name: payload.created_by_name || null,
  });
  if (error) throw new Error(error.message);
}

export async function createCustomerPersonalOffer(customer: CustomerMetric, payload: { title: string; description?: string | null; offer_value?: string | null; end_date?: string | null; created_by?: string | null; created_by_name?: string | null }) {
  const { error } = await supabase.from("customer_personal_offers").insert({
    customer_id: customer.customer_id && isUuidLike(customer.customer_id) ? customer.customer_id : null,
    customer_code: customer.customer_code,
    customer_name: customer.customer_name || customer.name,
    customer_phone: customer.customer_phone || customer.phone,
    branch: customer.branch,
    title: payload.title,
    description: payload.description || null,
    offer_value: payload.offer_value || null,
    end_date: payload.end_date || null,
    created_by: payload.created_by || null,
    created_by_name: payload.created_by_name || null,
  });
  if (error) throw new Error(error.message);
}


async function getCustomerDetailsFastRpc(customer: CustomerMetric, invoiceLimit = 20): Promise<CustomerDetails | null> {
  try {
    const { data, error } = await supabase.rpc("dawaa_get_customer_details_fast_v1", {
      p_customer_code: customer.customer_code || null,
      p_customer_phone: customer.customer_phone || customer.phone || null,
      p_customer_name: customer.customer_name || customer.name || null,
      p_invoice_limit: Math.min(Math.max(invoiceLimit || 20, 5), 50),
    });

    if (error || !data) {
      if (error) console.warn("[CustomerDetailsFastRpc] failed:", error.message);
      return null;
    }

    const payload = data as any;
    if (payload.success === false) return null;

    const invoices = Array.isArray(payload.invoices) ? payload.invoices : [];
    const followups = Array.isArray(payload.followups) ? payload.followups : [];
    const flags = payload.customerFlags || payload.customer_flags || {};

    const currentMonthVisits = Number(payload.currentMonthVisits ?? payload.current_month_visits ?? 0);
    const previousMonthVisits = Number(payload.previousMonthVisits ?? payload.previous_month_visits ?? 0);
    const avgMonthlyVisits = Number(payload.avgMonthlyVisits ?? payload.avg_monthly_visits ?? 0);
    const frequencyStatus = payload.purchaseFrequencyStatus || purchaseFrequencyStatus(currentMonthVisits, previousMonthVisits);
    const frequencyRecommendation = payload.purchaseFrequencyRecommendation || purchaseFrequencyRecommendation(frequencyStatus);

    return {
      invoices,
      followups,
      lastFollowup: followups[0] || null,
      topDoctor: payload.topDoctor || payload.top_doctor || null,
      lastServiceDoctor: payload.lastServiceDoctor || payload.last_service_doctor || null,
      lastFollowupReport: payload.lastFollowupReport || payload.last_followup_report || null,
      avgMonthlyVisits: avgMonthlyVisits || null,
      currentMonthVisits,
      previousMonthVisits,
      purchaseFrequencyStatus: frequencyStatus,
      purchaseFrequencyRecommendation: frequencyRecommendation,
      customerNotes: payload.customerNotes || payload.customer_notes || null,
      whatsappNotes: payload.whatsappNotes || payload.whatsapp_notes || null,
      serviceNotes: payload.serviceNotes || payload.service_notes || null,
      teamNotes: payload.teamNotes || payload.team_notes || null,
      handlingNotes: payload.handlingNotes || payload.handling_notes || null,
      address: payload.address || null,
      phoneAlt: payload.phoneAlt || payload.phone_alt || null,
      whatsappPhone: payload.whatsappPhone || payload.whatsapp_phone || null,
      customerFlags: parseCustomerFlags(flags),
      isPseudoCustomer: Boolean(payload.isPseudoCustomer ?? payload.is_pseudo_customer ?? false),
      hasValidPhone: Boolean(payload.hasValidPhone ?? payload.has_valid_phone ?? true),
      purchaseAnalysis: {
        purchaseCountCurrentMonth: currentMonthVisits,
        purchaseCountPreviousMonth: previousMonthVisits,
        averageMonthlyPurchaseCount: avgMonthlyVisits || 0,
        purchaseFrequencyStatus: frequencyStatus,
        recommendation: frequencyRecommendation,
      },
      activeAlerts: Array.isArray(payload.activeAlerts) ? payload.activeAlerts : [],
      cashback: payload.cashback || null,
      welcomeStatus: payload.welcomeStatus || null,
      invoiceClassifications: Array.isArray(payload.invoiceClassifications) ? payload.invoiceClassifications : [],
    };
  } catch (error) {
    console.warn("[CustomerDetailsFastRpc] exception:", error);
    return null;
  }
}

export async function getCustomerDetails(customer: CustomerMetric, invoiceLimit = 20): Promise<CustomerDetails> {
  if (!isSupabaseConfigured) {
    throw new Error("إعدادات Supabase غير موجودة.");
  }

  const fastDetails = await getCustomerDetailsFastRpc(customer, invoiceLimit);
  if (fastDetails) {
    const purchasePatch = await getCustomerPurchaseFrequencyPatch(customer);
    if (purchasePatch) {
      return {
        ...fastDetails,
        currentMonthVisits: purchasePatch.purchaseCountCurrentMonth,
        previousMonthVisits: purchasePatch.purchaseCountPreviousMonth,
        avgMonthlyVisits: purchasePatch.averageMonthlyPurchaseCount,
        purchaseFrequencyStatus: purchasePatch.purchaseFrequencyStatus,
        purchaseFrequencyRecommendation: purchasePatch.recommendation,
        purchaseAnalysis: purchasePatch,
      };
    }
    return fastDetails;
  }

  const fullProfile = await getCustomerFullProfile({
    customer_code: customer.customer_code,
    customer_id: customer.customer_id,
    final_customer_key: customer.final_customer_key,
    customer_phone: customer.customer_phone || customer.phone,
    customer_name: customer.customer_name || customer.name,
  });

  const limitedFollowups = fullProfile.latestFollowups.slice(0, 20);
  const [liveInvoiceStats, activeAlerts, cashback, welcomeStatus, invoiceClassifications] = await Promise.all([
    getLiveCustomerInvoiceStats(customer, invoiceLimit),
    getCustomerActiveAlerts(customer),
    getCustomerCashbackSummary(customer),
    getCustomerWelcomeStatus(customer),
    getCustomerInvoiceClassifications(customer, 12),
  ]);
  const limitedInvoices = liveInvoiceStats.invoices.length
    ? liveInvoiceStats.invoices
    : fullProfile.latestInvoices.slice(0, Math.min(invoiceLimit, 100));
  const currentMonth = new Date().toISOString().slice(0, 7);
  const previousMonthDate = new Date();
  previousMonthDate.setMonth(previousMonthDate.getMonth() - 1);
  const previousMonth = previousMonthDate.toISOString().slice(0, 7);
  const currentMonthVisitsFromProfile = Math.max(
    fullProfile.monthlyPurchaseTrend.find((row) => row.month === currentMonth)?.invoicesCount ?? 0,
    liveInvoiceStats.currentMonthVisits,
  );
  const previousMonthVisitsFromProfile = Math.max(
    fullProfile.monthlyPurchaseTrend.find((row) => row.month === previousMonth)?.invoicesCount ?? 0,
    liveInvoiceStats.previousMonthVisits,
  );
  const profileAverageMonthlyVisits = fullProfile.monthlyPurchaseTrend.length
    ? Math.round(fullProfile.monthlyPurchaseTrend.reduce((sum, row) => sum + row.invoicesCount, 0) / fullProfile.monthlyPurchaseTrend.length)
    : 0;
  const avgMonthlyVisitsFromProfile = Math.max(profileAverageMonthlyVisits, liveInvoiceStats.averageMonthlyVisits) || null;

  const frequencyStatusFromProfile = purchaseFrequencyStatus(currentMonthVisitsFromProfile, previousMonthVisitsFromProfile);
  const frequencyRecommendationFromProfile = purchaseFrequencyRecommendation(frequencyStatusFromProfile);

  const doctorTotalsFromProfile = new Map<string, { total: number; count: number }>();
  for (const invoice of limitedInvoices) {
    if (!invoice.seller_name) continue;
    const current = doctorTotalsFromProfile.get(invoice.seller_name) || { total: 0, count: 0 };
    current.total += invoice.amount;
    current.count += 1;
    doctorTotalsFromProfile.set(invoice.seller_name, current);
  }
  const topDoctorFromProfile = [...doctorTotalsFromProfile.entries()]
    .sort((a, b) => (b[1].total - a[1].total) || (b[1].count - a[1].count))[0]?.[0] || null;

  return {
    invoices: limitedInvoices,
    followups: limitedFollowups,
    lastFollowup: limitedFollowups[0] || null,
    topDoctor: topDoctorFromProfile,
    lastServiceDoctor: limitedFollowups[0]?.responsible_name || limitedFollowups[0]?.assigned_to || null,
    lastFollowupReport: limitedFollowups[0]?.followup_result || limitedFollowups[0]?.notes || null,
    avgMonthlyVisits: avgMonthlyVisitsFromProfile,
    currentMonthVisits: currentMonthVisitsFromProfile,
    previousMonthVisits: previousMonthVisitsFromProfile,
    purchaseFrequencyStatus: frequencyStatusFromProfile,
    purchaseFrequencyRecommendation: frequencyRecommendationFromProfile,
    customerNotes: fullProfile.notes.customerNotes || fullProfile.notes.notes,
    whatsappNotes: fullProfile.notes.whatsappNotes,
    serviceNotes: fullProfile.notes.serviceNotes,
    teamNotes: fullProfile.notes.teamNotes,
    handlingNotes: fullProfile.notes.handlingNotes,
    address: fullProfile.notes.address,
    phoneAlt: fullProfile.notes.phoneAlt,
    whatsappPhone: fullProfile.notes.whatsappPhone,
    customerFlags: parseCustomerFlags(fullProfile.flags as any),
    isPseudoCustomer: fullProfile.dataHealth.isPseudoCustomer,
    hasValidPhone: fullProfile.dataHealth.hasValidPhone,
    purchaseAnalysis: {
      purchaseCountCurrentMonth: currentMonthVisitsFromProfile,
      purchaseCountPreviousMonth: previousMonthVisitsFromProfile,
      averageMonthlyPurchaseCount: avgMonthlyVisitsFromProfile || 0,
      purchaseFrequencyStatus: frequencyStatusFromProfile,
      recommendation: frequencyRecommendationFromProfile,
    },
    activeAlerts,
    cashback,
    welcomeStatus,
    invoiceClassifications,
  };

  const invoiceClauses = customerInvoiceOrClauses(customer);
  const followupClauses = [
    customer.customer_code ? `customer_code.eq.${customer.customer_code}` : "",
    customer.customer_id ? `customer_id.eq.${customer.customer_id}` : "",
    customer.customer_phone ? `customer_phone.eq.${customer.customer_phone}` : "",
    customer.customer_name ? `customer_name.eq.${customer.customer_name}` : "",
  ].filter(Boolean).join(",");

  const today = new Date();
  const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const previousMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString().slice(0, 10);
  const previousMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0).toISOString().slice(0, 10);

  const invoiceQuery = invoiceClauses
    ? supabase
      .from("sales_invoices")
      .select("id,invoice_no,invoice_number,invoice_date,net_amount,amount,gross_amount,seller_name,branch")
      .or(invoiceClauses)
      .order("invoice_date", { ascending: false })
      .limit(Math.min(invoiceLimit, 100))
    : Promise.resolve({ data: [], error: null } as any);

  const currentMonthCountQuery = invoiceClauses
    ? supabase
      .from("sales_invoices")
      .select("id", { count: "exact", head: true })
      .or(invoiceClauses)
      .gte("invoice_date", currentMonthStart)
      .lte("invoice_date", today.toISOString().slice(0, 10))
    : Promise.resolve({ count: 0, error: null } as any);

  const previousMonthCountQuery = invoiceClauses
    ? supabase
      .from("sales_invoices")
      .select("id", { count: "exact", head: true })
      .or(invoiceClauses)
      .gte("invoice_date", previousMonthStart)
      .lte("invoice_date", previousMonthEnd)
    : Promise.resolve({ count: 0, error: null } as any);

  const followupQuery = followupClauses
    ? supabase
      .from("daily_followups")
      .select("id,status,assigned_to,responsible_name,notes,followup_result,created_at,followup_date,completed_at")
      .or(followupClauses)
      .order("created_at", { ascending: false })
      .limit(20)
    : Promise.resolve({ data: [], error: null } as any);

  const [profile, invoiceResult, currentMonthCountResult, previousMonthCountResult, followupResult] = await Promise.all([
    getCustomerProfile(customer),
    invoiceQuery,
    currentMonthCountQuery,
    previousMonthCountQuery,
    followupQuery,
  ]);

  if (invoiceResult.error) throw new Error(`sales_invoices: ${invoiceResult.error.message}`);
  if (currentMonthCountResult.error) throw new Error(`sales_invoices: ${currentMonthCountResult.error.message}`);
  if (previousMonthCountResult.error) throw new Error(`sales_invoices: ${previousMonthCountResult.error.message}`);
  if (followupResult.error) throw new Error(`daily_followups: ${followupResult.error.message}`);

  const invoices = ((invoiceResult.data ?? []) as Row[]).map((row) => ({
    invoice_number: getInvoiceKey(row) || null,
    invoice_date: readFirst(row, ["invoice_date"], null) as string | null,
    amount: toNumber(readFirst(row, ["net_amount", "amount", "gross_amount"], 0)),
    seller_name: readFirst(row, ["seller_name"], null) as string | null,
    branch: normalizeBranchName(readFirst(row, ["branch"], null)),
  }));

  const followups = ((followupResult.data ?? []) as Row[]).map((row) => ({
    id: String(readFirst(row, ["id"], crypto.randomUUID())),
    status: readFirst(row, ["status"], null) as string | null,
    assigned_to: readFirst(row, ["assigned_to"], null) as string | null,
    responsible_name: readFirst(row, ["responsible_name"], null) as string | null,
    notes: readFirst(row, ["notes"], null) as string | null,
    followup_result: readFirst(row, ["followup_result"], null) as string | null,
    created_at: readFirst(row, ["created_at"], null) as string | null,
    followup_date: readFirst(row, ["followup_date"], null) as string | null,
    completed_at: readFirst(row, ["completed_at"], null) as string | null,
  }));

  const doctorTotals = new Map<string, { total: number; count: number }>();
  for (const invoice of invoices) {
    if (!invoice.seller_name) continue;
    const current = doctorTotals.get(invoice.seller_name) || { total: 0, count: 0 };
    current.total += invoice.amount;
    current.count += 1;
    doctorTotals.set(invoice.seller_name, current);
  }

  const topDoctor = [...doctorTotals.entries()]
    .sort((a, b) => (b[1].total - a[1].total) || (b[1].count - a[1].count))[0]?.[0] || null;
  const lastFollowup = followups[0] || null;

  const currentMonthVisits = Number(currentMonthCountResult.count ?? 0);
  const previousMonthVisits = Number(previousMonthCountResult.count ?? 0);
  const avgMonthlyVisits = currentMonthVisits || previousMonthVisits ? Math.round((currentMonthVisits + previousMonthVisits) / 2) : null;

  function purchaseFrequencyStatus(current: number, previous: number) {
    if (current === 0 && previous >= 2) return "توقف عن الشراء";
    if (current * 2 <= previous && previous >= 2) return "انخفض الشراء";
    if (current === 0 && previous === 1) return "يحتاج متابعة";
    if (current === 0) return "بدون مشتريات هذا الشهر";
    return "طبيعي";
  }

  function purchaseFrequencyRecommendation(status: string) {
    if (status === "توقف عن الشراء") return "تابع العميل فوراً لاستعادة الشراء، وقدّم عرضاً شخصياً إذا أمكن.";
    if (status === "انخفض الشراء") return "راجع سبب انخفاض الأنشطة وراجع العروض المخصصة للعميل.";
    if (status === "يحتاج متابعة") return "اتصل بالعميل لتأكيد احتياجاته والتشجيع على الشراء القادم.";
    return "استمر في دعم العميل وقدم خدمات واضحة للحفاظ على العلاقة.";
  }

  const profilePhone = getBestCustomerPhone(
    { customer_phone: customer.customer_phone, phone: customer.phone, customer_code: customer.customer_code },
    customer,
    profile
      ? {
          whatsapp_phone: profile.whatsapp_phone || null,
          phone: profile.phone || null,
          phone_alt: profile.phone_alt || null,
          customer_phone: profile.customer_phone || null,
        }
      : null,
  );
  const isPseudo = isPseudoCustomer({
    customer_name: customer.customer_name,
    customer_phone: profilePhone,
    phone: profilePhone,
    customer_id: customer.customer_id,
    customer_code: customer.customer_code,
  });

  const validPhone = isValidEgyptPhone(profilePhone, customer.customer_code);
  const flags = customerFlagLabels(profile?.customer_flags as Record<string, boolean> | null);

  // Purchase analysis
  const purchaseAnalysis: PurchaseAnalysis | null = {
    purchaseCountCurrentMonth: currentMonthVisits,
    purchaseCountPreviousMonth: previousMonthVisits,
    averageMonthlyPurchaseCount: avgMonthlyVisits || 0,
    purchaseFrequencyStatus: purchaseFrequencyStatus(currentMonthVisits, previousMonthVisits),
    recommendation: purchaseFrequencyRecommendation(purchaseFrequencyStatus(currentMonthVisits, previousMonthVisits)),
  };

  return {
    invoices,
    followups,
    lastFollowup,
    topDoctor,
    lastServiceDoctor: lastFollowup?.responsible_name || lastFollowup?.assigned_to || null,
    lastFollowupReport: lastFollowup?.followup_result || lastFollowup?.notes || null,
    avgMonthlyVisits,
    currentMonthVisits,
    previousMonthVisits,
    purchaseFrequencyStatus: purchaseFrequencyStatus(currentMonthVisits, previousMonthVisits),
    purchaseFrequencyRecommendation: purchaseFrequencyRecommendation(purchaseFrequencyStatus(currentMonthVisits, previousMonthVisits)),
    customerNotes: profile?.customer_notes || profile?.notes || null,
    whatsappNotes: profile?.whatsapp_notes || null,
    serviceNotes: profile?.service_notes || null,
    teamNotes: profile?.team_notes || null,
    handlingNotes: profile?.handling_notes || null,
    address: profile?.address || null,
    phoneAlt: profile?.phone_alt || null,
    whatsappPhone: profile?.whatsapp_phone || null,
    customerFlags: flags,
    isPseudoCustomer: isPseudo,
    hasValidPhone: validPhone,
    purchaseAnalysis,
    activeAlerts: [],
    cashback: null,
    welcomeStatus: null,
    invoiceClassifications: [],
  };
}

