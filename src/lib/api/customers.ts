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
import { getCustomerFullProfile } from "@/lib/customerProfileService";

const DEFAULT_LIMIT = 30;
export const ALL_FILTER = "الكل";
const SUMMARY_TABLE = "customer_metrics_summary";

export function clearCustomersCache() {
  // Customers list reads customer_metrics_summary directly; this hook keeps import invalidation explicit.
}

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
  customerFlags: string[];
  isPseudoCustomer: boolean;
  hasValidPhone: boolean;
  purchaseAnalysis: PurchaseAnalysis | null;
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

  const mapped = ((data ?? []) as Row[]).map(normalizeCustomerMetric);
  
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

export async function getCustomerStats(): Promise<CustomerStats> {
  if (!isSupabaseConfigured) {
    throw new Error("إعدادات Supabase غير موجودة.");
  }

  if (import.meta.env.DEV) {
    console.log("[getCustomerStats] Starting stats calculation...");
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

  if (import.meta.env.DEV) {
    console.log("[getCustomerStats] Complete:", { total, veryImportant, important, medium, normal, newC, active, atRisk, stopped, noPurchase });
  }

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
  const updatePayload: Record<string, unknown> = {
    customer_notes: payload.customer_notes ?? undefined,
    whatsapp_notes: payload.whatsapp_notes ?? undefined,
    service_notes: payload.service_notes ?? undefined,
    team_notes: payload.team_notes ?? undefined,
    handling_notes: payload.handling_notes ?? undefined,
    address: payload.address ?? undefined,
    phone_alt: payload.phone_alt ?? undefined,
    whatsapp_phone: payload.whatsapp_phone ?? undefined,
  };

  if (payload.flags) {
    updatePayload.customer_flags = {
      ...(profile?.customer_flags || {}),
      ...payload.flags,
    };
  }

  if (!profile && !customer.customer_id && !customer.customer_code && !customer.customer_phone) {
    throw new Error("لا يوجد عميل صالح لتحديثه.");
  }

  let query = supabase.from("customers").update(updatePayload).select("*");
  if (profile?.id) {
    query = query.eq("id", profile.id);
  } else if (customer.customer_id && isUuidLike(customer.customer_id)) {
    query = query.eq("id", customer.customer_id);
  } else if (customer.customer_code) {
    query = query.eq("customer_code", customer.customer_code);
  } else if (customer.customer_phone) {
    query = query.eq("customer_phone", customer.customer_phone);
  }

  const { data, error } = await query.single();
  if (error) {
    throw new Error(error.message);
  }

  return data as CustomerProfile;
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

  const fullProfile = await getCustomerFullProfile({
    customer_code: customer.customer_code,
    customer_id: customer.customer_id,
    final_customer_key: customer.final_customer_key,
    customer_phone: customer.customer_phone || customer.phone,
    customer_name: customer.customer_name || customer.name,
  });

  const limitedInvoices = fullProfile.latestInvoices.slice(0, Math.min(invoiceLimit, 100));
  const limitedFollowups = fullProfile.latestFollowups.slice(0, 20);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const previousMonthDate = new Date();
  previousMonthDate.setMonth(previousMonthDate.getMonth() - 1);
  const previousMonth = previousMonthDate.toISOString().slice(0, 7);
  const currentMonthVisitsFromProfile = fullProfile.monthlyPurchaseTrend.find((row) => row.month === currentMonth)?.invoicesCount ?? 0;
  const previousMonthVisitsFromProfile = fullProfile.monthlyPurchaseTrend.find((row) => row.month === previousMonth)?.invoicesCount ?? 0;
  const avgMonthlyVisitsFromProfile = fullProfile.monthlyPurchaseTrend.length
    ? Math.round(fullProfile.monthlyPurchaseTrend.reduce((sum, row) => sum + row.invoicesCount, 0) / fullProfile.monthlyPurchaseTrend.length)
    : null;

  const frequencyStatusFromProfile = currentMonthVisitsFromProfile === 0 && previousMonthVisitsFromProfile >= 2
    ? "توقف عن الشراء"
    : currentMonthVisitsFromProfile * 2 <= previousMonthVisitsFromProfile && previousMonthVisitsFromProfile >= 2
      ? "انخفض الشراء"
      : currentMonthVisitsFromProfile === 0
        ? "يحتاج متابعة"
        : "طبيعي";

  const frequencyRecommendationFromProfile = frequencyStatusFromProfile === "توقف عن الشراء"
    ? "تابع العميل فورًا لاستعادة الشراء."
    : frequencyStatusFromProfile === "انخفض الشراء"
      ? "راجع سبب انخفاض الشراء وحدد متابعة قريبة."
      : "استمر في دعم العميل وسجل نتيجة التواصل.";

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
    customerFlags: customerFlagLabels(fullProfile.flags),
    isPseudoCustomer: fullProfile.dataHealth.isPseudoCustomer,
    hasValidPhone: fullProfile.dataHealth.hasValidPhone,
    purchaseAnalysis: {
      purchaseCountCurrentMonth: currentMonthVisitsFromProfile,
      purchaseCountPreviousMonth: previousMonthVisitsFromProfile,
      averageMonthlyPurchaseCount: avgMonthlyVisitsFromProfile || 0,
      purchaseFrequencyStatus: frequencyStatusFromProfile,
      recommendation: frequencyRecommendationFromProfile,
    },
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
      .select("invoice_number,invoice_no,invoice_date,net_amount,amount,gross_amount,seller_name,branch")
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
  };
}
