import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { normalizeCustomerSegment, normalizeCustomerStatus } from "@/lib/customerAnalyticsService";
import { normalizeBranchName } from "@/lib/branch";

const DEFAULT_LIMIT = 30;
export const ALL_FILTER = "الكل";
const SUMMARY_TABLE = "customer_metrics_summary";

type Row = Record<string, unknown>;

export type CustomerMetric = {
  id: string;
  final_customer_key: string | null;
  customer_id: string | null;
  customer_code: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  phone: string | null;
  name: string | null;
  branch: string | null;
  invoices_count: number;
  total_spent: number;
  total_purchases: number;
  avg_invoice: number;
  first_purchase: string | null;
  last_purchase: string | null;
  active_months: number;
  avg_monthly: number;
  segment: string;
  type: string;
  customer_status: string;
  status: string;
  retention_status: string;
};

export interface GetCustomersOptions {
  search?: string;
  limit?: number;
  offset?: number;
  branch?: string;
  type?: string;
  status?: string;
}

export interface CustomerStats {
  total: number;
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

export interface CustomerDetails {
  invoices: CustomerInvoiceSummary[];
  followups: CustomerFollowupSummary[];
  lastFollowup: CustomerFollowupSummary | null;
  topDoctor: string | null;
  lastServiceDoctor: string | null;
  lastFollowupReport: string | null;
  avgMonthlyVisits: number | null;
  currentMonthVisits: number | null;
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
  return !value || value === ALL_FILTER || value === "كل العملاء" || value === "كل التصنيفات" || value === "كل الحالات";
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
    id: String(customerId || finalKey || customerCode || phone || crypto.randomUUID()),
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
  return query;
}

export async function getCustomers(options: GetCustomersOptions = {}) {
  if (!isSupabaseConfigured) {
    throw new Error("إعدادات Supabase غير موجودة. أضف VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY في ملف .env.");
  }

  const limit = normalizeLimit(options.limit);
  const offset = Math.max(options.offset ?? 0, 0);
  let query = supabase
    .from(SUMMARY_TABLE)
    .select("final_customer_key,customer_id,customer_code,customer_name,customer_phone,branch,invoices_count,total_spent,avg_invoice,first_purchase,last_purchase,active_months,avg_monthly,segment,customer_status", { count: "exact" });

  query = applyListFilters(query, options);

  const { data, error, count } = await query
    .order("avg_monthly", { ascending: false, nullsFirst: false })
    .order("total_spent", { ascending: false, nullsFirst: false })
    .order("last_purchase", { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1);

  if (error) throw new Error(`customer_metrics_summary: ${error.message}`);

  return {
    customers: ((data ?? []) as Row[]).map(normalizeCustomerMetric),
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
  if (error) throw new Error(`customer_metrics_summary: ${error.message}`);
  return count ?? 0;
}

export async function getCustomerStats(): Promise<CustomerStats> {
  if (!isSupabaseConfigured) {
    throw new Error("إعدادات Supabase غير موجودة.");
  }

  const [
    total,
    veryImportant,
    important,
    medium,
    normal,
    newC,
    active,
    atRisk,
    stopped,
    noPurchase,
  ] = await Promise.all([
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
  ]);

  return {
    total,
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
  };
}

function customerInvoiceOrClauses(customer: CustomerMetric) {
  const clauses = [
    customer.customer_id && isUuidLike(customer.customer_id) ? `customer_id.eq.${customer.customer_id}` : "",
    customer.customer_code ? `customer_code.eq.${customer.customer_code}` : "",
    customer.customer_phone ? `customer_phone.eq.${customer.customer_phone}` : "",
    customer.customer_phone ? `phone.eq.${customer.customer_phone}` : "",
  ].filter(Boolean);
  return clauses.join(",");
}

export async function getCustomerDetails(customer: CustomerMetric, invoiceLimit = 20): Promise<CustomerDetails> {
  if (!isSupabaseConfigured) {
    throw new Error("إعدادات Supabase غير موجودة.");
  }

  const invoiceClauses = customerInvoiceOrClauses(customer);
  const followupClauses = [
    customer.customer_code ? `customer_code.eq.${customer.customer_code}` : "",
    customer.customer_id ? `customer_id.eq.${customer.customer_id}` : "",
    customer.customer_phone ? `customer_phone.eq.${customer.customer_phone}` : "",
    customer.customer_name ? `customer_name.eq.${customer.customer_name}` : "",
  ].filter(Boolean).join(",");

  const invoiceQuery = invoiceClauses
    ? supabase
      .from("sales_invoices")
      .select("invoice_number,invoice_no,invoice_date,net_amount,amount,gross_amount,seller_name,branch")
      .or(invoiceClauses)
      .order("invoice_date", { ascending: false })
      .limit(Math.min(invoiceLimit, 50))
    : Promise.resolve({ data: [], error: null } as any);

  const followupQuery = followupClauses
    ? supabase
      .from("daily_followups")
      .select("id,status,assigned_to,responsible_name,notes,followup_result,created_at,followup_date,completed_at")
      .or(followupClauses)
      .order("created_at", { ascending: false })
      .limit(20)
    : Promise.resolve({ data: [], error: null } as any);

  const [invoiceResult, followupResult] = await Promise.all([invoiceQuery, followupQuery]);
  if (invoiceResult.error) throw new Error(`sales_invoices: ${invoiceResult.error.message}`);
  if (followupResult.error) throw new Error(`daily_followups: ${followupResult.error.message}`);

  const invoices = ((invoiceResult.data ?? []) as Row[]).map((row) => ({
    invoice_number: readFirst(row, ["invoice_number", "invoice_no"], null) as string | null,
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

  return {
    invoices,
    followups,
    lastFollowup,
    topDoctor,
    lastServiceDoctor: lastFollowup?.responsible_name || lastFollowup?.assigned_to || null,
    lastFollowupReport: lastFollowup?.followup_result || lastFollowup?.notes || null,
    avgMonthlyVisits: null,
    currentMonthVisits: null,
  };
}
