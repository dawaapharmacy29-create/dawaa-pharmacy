import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import {
  getBestCustomerPhone,
  isPseudoCustomer,
  isUuidLike,
  isValidEgyptPhone,
  normalizeCustomerSegment,
  normalizeCustomerStatus,
} from "@/lib/customerAnalyticsService";
import { normalizeBranchName } from "@/lib/branch";
import type { CustomerMetric, CustomerFollowupSummary, CustomerInvoiceSummary } from "@/lib/api/customers";

type Row = Record<string, unknown>;

export type CustomerFullProfileParams = {
  customer_code?: string | null;
  customer_id?: string | null;
  final_customer_key?: string | null;
  customer_phone?: string | null;
  customer_name?: string | null;
  signal?: AbortSignal;
  forceRefresh?: boolean;
};

export type CustomerProfileNotes = {
  customerNotes: string | null;
  whatsappNotes: string | null;
  serviceNotes: string | null;
  teamNotes: string | null;
  handlingNotes: string | null;
  notes: string | null;
  address: string | null;
  phoneAlt: string | null;
  whatsappPhone: string | null;
};

export type MonthlyPurchaseTrendRow = {
  month: string;
  invoicesCount: number;
  netTotal: number;
  avgInvoice: number;
};

export type CustomerProfileDataHealth = {
  hasMetrics: boolean;
  hasCustomerRecord: boolean;
  hasValidPhone: boolean;
  isPseudoCustomer: boolean;
  invoicesLoaded: boolean;
  followupsLoaded: boolean;
  missingCustomerCode: boolean;
};

export type CustomerFullProfile = {
  profile: Row | null;
  metrics: CustomerMetric | null;
  flags: Record<string, boolean> | null;
  notes: CustomerProfileNotes;
  latestInvoices: CustomerInvoiceSummary[];
  latestFollowups: CustomerFollowupSummary[];
  monthlyPurchaseTrend: MonthlyPurchaseTrendRow[];
  recommendations: string[];
  dataHealth: CustomerProfileDataHealth;
  errorsBySection: Record<string, string>;
  displayPhone: string | null;
};

const profileCache = new Map<string, CustomerFullProfile>();

export function normalizeCustomerCode(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw || isUuidLike(raw)) return "";
  return raw.replace(/^code:/i, "").trim();
}

export function normalizeCustomerKey(value: unknown) {
  return String(value ?? "").trim();
}

export function normalizePhone(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw || raw.toLowerCase().startsWith("code:")) return "";
  return raw.replace(/[^\d+]/g, "");
}

export function safeNumber(value: unknown, fallback = 0) {
  const numeric = Number(value ?? fallback);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function formatCurrencyEGP(value: unknown) {
  return `${safeNumber(value).toLocaleString("ar-EG", { maximumFractionDigits: 0 })} جنيه`;
}

export function formatDateArabic(value: unknown) {
  if (!value) return "غير محدد";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleDateString("ar-EG");
}

function friendlyError(message: unknown) {
  const value = String(message || "").toLowerCase();
  if (value.includes("timeout")) return "استغرق تحميل هذا الجزء وقتًا طويلًا";
  if (value.includes("does not exist") || value.includes("not found")) return "مصدر هذا الجزء غير متاح";
  if (value.includes("permission denied")) return "لا توجد صلاحية لقراءة هذا الجزء";
  return "تعذر تحميل هذا الجزء الآن";
}

function readFirst(row: Row | null | undefined, keys: string[], fallback: unknown = null) {
  if (!row) return fallback;
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return fallback;
}

function cacheKey(params: CustomerFullProfileParams) {
  return [
    normalizeCustomerCode(params.customer_code),
    normalizeCustomerKey(params.customer_id),
    normalizeCustomerKey(params.final_customer_key),
    normalizePhone(params.customer_phone),
    normalizeCustomerKey(params.customer_name),
  ].filter(Boolean).join("|") || "unknown";
}

function withAbort<T>(query: T, signal?: AbortSignal): T {
  const maybe = query as any;
  if (signal && maybe && typeof maybe.abortSignal === "function") return maybe.abortSignal(signal);
  return query;
}

function metricsOrClauses(params: CustomerFullProfileParams) {
  const code = normalizeCustomerCode(params.customer_code);
  const phone = normalizePhone(params.customer_phone);
  const finalKey = normalizeCustomerKey(params.final_customer_key);
  const customerId = normalizeCustomerKey(params.customer_id);
  return [
    code ? `customer_code.eq.${code}` : "",
    finalKey ? `final_customer_key.eq.${finalKey}` : "",
    customerId && isUuidLike(customerId) ? `customer_id.eq.${customerId}` : "",
    phone ? `customer_phone.eq.${phone}` : "",
  ].filter(Boolean).join(",");
}

function customerOrClauses(params: CustomerFullProfileParams, metrics?: CustomerMetric | null) {
  const code = normalizeCustomerCode(params.customer_code || metrics?.customer_code);
  const phone = normalizePhone(params.customer_phone || metrics?.customer_phone);
  const customerId = normalizeCustomerKey(params.customer_id || metrics?.customer_id);
  const name = normalizeCustomerKey(params.customer_name || metrics?.customer_name);
  return [
    code ? `customer_code.eq.${code}` : "",
    customerId && isUuidLike(customerId) ? `id.eq.${customerId}` : "",
    phone ? `phone.eq.${phone}` : "",
    phone ? `whatsapp_phone.eq.${phone}` : "",
    phone ? `phone_alt.eq.${phone}` : "",
    name ? `name.eq.${name}` : "",
  ].filter(Boolean).join(",");
}

function activityOrClauses(params: CustomerFullProfileParams, metrics?: CustomerMetric | null, profile?: Row | null) {
  const code = normalizeCustomerCode(params.customer_code || metrics?.customer_code || profile?.customer_code);
  const phone = normalizePhone(params.customer_phone || metrics?.customer_phone || profile?.phone || profile?.whatsapp_phone || profile?.phone_alt);
  const customerId = normalizeCustomerKey(params.customer_id || metrics?.customer_id || profile?.id);
  const name = normalizeCustomerKey(params.customer_name || metrics?.customer_name || profile?.name);
  return [
    customerId && isUuidLike(customerId) ? `customer_id.eq.${customerId}` : "",
    code ? `customer_code.eq.${code}` : "",
    phone ? `customer_phone.eq.${phone}` : "",
    phone ? `phone.eq.${phone}` : "",
    name ? `customer_name.eq.${name}` : "",
  ].filter(Boolean).join(",");
}

function normalizeMetric(row: Row | null): CustomerMetric | null {
  if (!row) return null;
  const totalSpent = safeNumber(readFirst(row, ["total_spent"], 0));
  const avgMonthly = safeNumber(readFirst(row, ["avg_monthly"], 0));
  const firstPurchase = readFirst(row, ["first_purchase"], null) as string | null;
  const lastPurchase = readFirst(row, ["last_purchase"], null) as string | null;
  const invoicesCount = safeNumber(readFirst(row, ["invoices_count"], 0));
  const segment = normalizeCustomerSegment(readFirst(row, ["segment"], null), totalSpent, avgMonthly);
  const status = invoicesCount <= 0 || !lastPurchase
    ? "بدون شراء"
    : normalizeCustomerStatus(readFirst(row, ["customer_status"], null), lastPurchase, firstPurchase);
  const finalKey = readFirst(row, ["final_customer_key"], null) as string | null;
  const customerId = readFirst(row, ["customer_id"], null) as string | null;
  const customerCode = readFirst(row, ["customer_code"], null) as string | null;
  const phone = readFirst(row, ["customer_phone"], null) as string | null;
  const name = readFirst(row, ["customer_name"], null) as string | null;
  return {
    id: String(finalKey || customerId || customerCode || phone || name || "unknown"),
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
    avg_invoice: safeNumber(readFirst(row, ["avg_invoice"], 0)),
    first_purchase: firstPurchase,
    last_purchase: lastPurchase,
    active_months: safeNumber(readFirst(row, ["active_months"], 0)),
    avg_monthly: avgMonthly,
    segment,
    type: segment,
    customer_status: status,
    status,
    retention_status: status,
  };
}

function mapInvoice(row: Row): CustomerInvoiceSummary {
  return {
    invoice_number: readFirst(row, ["invoice_number", "invoice_no"], null) as string | null,
    invoice_date: readFirst(row, ["invoice_date", "invoice_datetime", "created_at"], null) as string | null,
    amount: safeNumber(readFirst(row, ["net_amount", "discounted_amount", "amount", "gross_amount"], 0)),
    seller_name: readFirst(row, ["seller_name"], null) as string | null,
    branch: normalizeBranchName(readFirst(row, ["branch"], null)),
  };
}

function mapFollowup(row: Row): CustomerFollowupSummary {
  return {
    id: String(readFirst(row, ["id"], crypto.randomUUID())),
    status: readFirst(row, ["followup_status", "status", "contact_status"], null) as string | null,
    assigned_to: readFirst(row, ["assigned_to", "assigned_doctor"], null) as string | null,
    responsible_name: readFirst(row, ["responsible_name"], null) as string | null,
    notes: readFirst(row, ["followup_notes", "notes"], null) as string | null,
    followup_result: readFirst(row, ["followup_result", "contact_result"], null) as string | null,
    created_at: readFirst(row, ["created_at"], null) as string | null,
    followup_date: readFirst(row, ["followup_datetime", "followup_date", "date"], null) as string | null,
    completed_at: readFirst(row, ["completed_at"], null) as string | null,
  };
}

function buildTrend(rows: Row[]): MonthlyPurchaseTrendRow[] {
  const byMonth = new Map<string, { invoicesCount: number; netTotal: number }>();
  for (const row of rows) {
    const month = String(readFirst(row, ["invoice_date", "invoice_datetime", "created_at"], "") || "").slice(0, 7);
    if (!month) continue;
    const current = byMonth.get(month) || { invoicesCount: 0, netTotal: 0 };
    current.invoicesCount += 1;
    current.netTotal += safeNumber(readFirst(row, ["net_amount", "discounted_amount", "amount", "gross_amount"], 0));
    byMonth.set(month, current);
  }
  return [...byMonth.entries()]
    .map(([month, value]) => ({
      month,
      invoicesCount: value.invoicesCount,
      netTotal: value.netTotal,
      avgInvoice: value.invoicesCount ? value.netTotal / value.invoicesCount : 0,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

function buildNotes(profile: Row | null): CustomerProfileNotes {
  return {
    customerNotes: readFirst(profile, ["customer_notes"], null) as string | null,
    whatsappNotes: readFirst(profile, ["whatsapp_notes"], null) as string | null,
    serviceNotes: readFirst(profile, ["service_notes"], null) as string | null,
    teamNotes: readFirst(profile, ["team_notes"], null) as string | null,
    handlingNotes: readFirst(profile, ["handling_notes"], null) as string | null,
    notes: readFirst(profile, ["notes"], null) as string | null,
    address: readFirst(profile, ["address"], null) as string | null,
    phoneAlt: readFirst(profile, ["phone_alt"], null) as string | null,
    whatsappPhone: readFirst(profile, ["whatsapp_phone"], null) as string | null,
  };
}

function buildRecommendations(metric: CustomerMetric | null, profile: Row | null, displayPhone: string | null) {
  const flags = (readFirst(profile, ["customer_flags"], null) || {}) as Record<string, boolean>;
  const items: string[] = [];
  if (!displayPhone) items.push("العميل بدون رقم صحيح، ابدأ باستكمال بيانات التواصل.");
  if (metric?.segment === "مهم جدًا") items.push("ابدأ برسالة تقدير لأن العميل مهم جدًا.");
  if (metric?.customer_status === "متوقف") items.push("العميل متوقف، اسأله بلطف عن سبب التوقف.");
  if (metric?.customer_status === "مهدد بالتوقف") items.push("العميل مهدد بالتوقف، حدد متابعة قريبة ولا تتركه يسقط.");
  if (flags.no_delivery) items.push("لا تضف توصيل لهذا العميل.");
  if (flags.no_substitutes) items.push("لا تقترح بدائل إلا بعد موافقة العميل.");
  if (flags.price_sensitive) items.push("وضح السعر والقيمة قبل عرض الاختيارات.");
  if (flags.prefers_call) items.push("يفضل الاتصال بدل واتساب.");
  if (flags.needs_manager || flags.complains_often) items.push("راجع آخر شكوى أو ملاحظة قبل التواصل.");
  if (!items.length) items.push("متابعة عادية مع تسجيل نتيجة واضحة وتحديد خطوة قادمة.");
  return items.slice(0, 5);
}

async function safeSection<T>(section: string, task: () => Promise<T>, errorsBySection: Record<string, string>, fallback: T): Promise<T> {
  try {
    return await task();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errorsBySection[section] = friendlyError(message);
    if (import.meta.env.DEV) console.warn(`[customerProfileService.${section}]`, error);
    return fallback;
  }
}

export async function getCustomerFullProfile(params: CustomerFullProfileParams): Promise<CustomerFullProfile> {
  if (!isSupabaseConfigured) {
    throw new Error("إعدادات Supabase غير موجودة.");
  }

  const key = cacheKey(params);
  if (!params.forceRefresh && profileCache.has(key)) return profileCache.get(key)!;

  const errorsBySection: Record<string, string> = {};
  const metricsClauses = metricsOrClauses(params);

  const metrics = await safeSection("metrics", async () => {
    if (!metricsClauses) return null;
    const query = withAbort(
      supabase
        .from("customer_metrics_summary")
        .select("final_customer_key,customer_id,customer_code,customer_name,customer_phone,branch,invoices_count,total_spent,avg_invoice,first_purchase,last_purchase,active_months,avg_monthly,segment,customer_status")
        .or(metricsClauses)
        .limit(1),
      params.signal,
    );
    const { data, error } = await query;
    if (error) throw error;
    return normalizeMetric((data?.[0] ?? null) as Row | null);
  }, errorsBySection, null);

  const customerClauses = customerOrClauses(params, metrics);
  const profile = await safeSection("profile", async () => {
    if (!customerClauses) return null;
    const query = withAbort(
      supabase
        .from("customers")
        .select("id,customer_code,name,phone,customer_phone,whatsapp_phone,phone_alt,address,notes,customer_notes,whatsapp_notes,service_notes,team_notes,handling_notes,customer_flags,branch")
        .or(customerClauses)
        .limit(1),
      params.signal,
    );
    const { data, error } = await query;
    if (error) throw error;
    return (data?.[0] ?? null) as Row | null;
  }, errorsBySection, null);

  const displayPhone = getBestCustomerPhone(
    {
      customer_code: metrics?.customer_code || params.customer_code || (profile?.customer_code as string | null) || null,
      customer_phone: params.customer_phone || metrics?.customer_phone || null,
      phone: params.customer_phone || null,
    },
    metrics,
    profile
      ? {
          whatsapp_phone: readFirst(profile, ["whatsapp_phone"], null) as string | null,
          phone: readFirst(profile, ["phone"], null) as string | null,
          phone_alt: readFirst(profile, ["phone_alt"], null) as string | null,
          customer_phone: readFirst(profile, ["customer_phone"], null) as string | null,
        }
      : null,
  );

  const activityClauses = activityOrClauses(params, metrics, profile);

  const [latestInvoices, latestFollowups, trendRows] = await Promise.all([
    safeSection("latestInvoices", async () => {
      if (!activityClauses) return [];
      const query = withAbort(
        supabase
          .from("sales_invoices")
          .select("invoice_number,invoice_no,invoice_date,invoice_datetime,created_at,net_amount,discounted_amount,amount,gross_amount,seller_name,branch")
          .or(activityClauses)
          .order("invoice_date", { ascending: false })
          .limit(10),
        params.signal,
      );
      const { data, error } = await query;
      if (error) throw error;
      return ((data ?? []) as Row[]).map(mapInvoice);
    }, errorsBySection, [] as CustomerInvoiceSummary[]),
    safeSection("latestFollowups", async () => {
      if (!activityClauses) return [];
      const query = withAbort(
        supabase
          .from("daily_followups")
          .select("id,status,followup_status,assigned_to,assigned_doctor,responsible_name,notes,followup_notes,followup_result,contact_result,created_at,followup_date,followup_datetime,date,completed_at,contact_status")
          .or(activityClauses)
          .order("created_at", { ascending: false })
          .limit(10),
        params.signal,
      );
      const { data, error } = await query;
      if (error) throw error;
      return ((data ?? []) as Row[]).map(mapFollowup);
    }, errorsBySection, [] as CustomerFollowupSummary[]),
    safeSection("monthlyPurchaseTrend", async () => {
      if (!activityClauses) return [];
      const query = withAbort(
        supabase
          .from("sales_invoices")
          .select("invoice_date,invoice_datetime,created_at,net_amount,discounted_amount,amount,gross_amount")
          .or(activityClauses)
          .order("invoice_date", { ascending: false })
          .limit(180),
        params.signal,
      );
      const { data, error } = await query;
      if (error) throw error;
      return buildTrend((data ?? []) as Row[]);
    }, errorsBySection, [] as MonthlyPurchaseTrendRow[]),
  ]);

  const notes = buildNotes(profile);
  const flags = (readFirst(profile, ["customer_flags"], null) || null) as Record<string, boolean> | null;
  const result: CustomerFullProfile = {
    profile,
    metrics,
    flags,
    notes,
    latestInvoices,
    latestFollowups,
    monthlyPurchaseTrend: trendRows,
    recommendations: buildRecommendations(metrics, profile, displayPhone),
    dataHealth: {
      hasMetrics: Boolean(metrics),
      hasCustomerRecord: Boolean(profile),
      hasValidPhone: Boolean(displayPhone && isValidEgyptPhone(displayPhone, metrics?.customer_code || params.customer_code)),
      isPseudoCustomer: isPseudoCustomer({
        customer_name: metrics?.customer_name || (profile?.name as string | null) || params.customer_name,
        customer_phone: displayPhone,
        phone: displayPhone,
        customer_id: metrics?.customer_id || (profile?.id as string | null),
        customer_code: metrics?.customer_code || params.customer_code,
      }),
      invoicesLoaded: !errorsBySection.latestInvoices,
      followupsLoaded: !errorsBySection.latestFollowups,
      missingCustomerCode: !normalizeCustomerCode(metrics?.customer_code || params.customer_code || profile?.customer_code),
    },
    errorsBySection,
    displayPhone,
  };

  profileCache.set(key, result);
  return result;
}

export function clearCustomerProfileCache() {
  profileCache.clear();
}
