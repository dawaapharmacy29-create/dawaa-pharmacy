import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { phoneSearchTokens } from "@/lib/phone";
import { matchesOrderedSegments } from "@/lib/utils";
import type { Customer } from "@/types/database";

const DEFAULT_LIMIT = 50;
const ALL_FILTER = "الكل";
const PRIMARY_TABLE = "customer_analysis";
const FALLBACK_SEARCH_COLUMNS = ["name", "phone", "customer_name", "customer_phone", "full_name", "phone_number", "mobile"];
type CustomerQueryBuilder = ReturnType<ReturnType<typeof supabase.from>["select"]>;

export interface GetCustomersOptions {
  search?: string;
  limit?: number;
  offset?: number;
  branch?: string;
  type?: string;
}

export interface CustomerStats {
  total: number;
  vip: number;
  atRisk: number;
  newC: number;
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
  notes: string | null;
  created_at: string | null;
  followup_date?: string | null;
}

export interface CustomerDetails {
  invoices: CustomerInvoiceSummary[];
  followups: CustomerFollowupSummary[];
  lastFollowup: CustomerFollowupSummary | null;
  topDoctor: string | null;
  lastServiceDoctor: string | null;
  lastFollowupReport: string | null;
}

function normalizeLimit(limit?: number) {
  if (!limit || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(limit, 100);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "تعذر الاتصال بقاعدة البيانات";
}

function toNumber(value: unknown) {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function readFirst(record: Record<string, unknown>, keys: string[], fallback: unknown = null) {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return fallback;
}

function normalizeArabicType(value?: string | null) {
  return value?.replace("جداً", "جدا").replace("جدًّا", "جدا") ?? "";
}

function normalizeBranchName(value: unknown) {
  const branch = String(value ?? "").trim();
  if (!branch) return null;
  if (branch.includes("شكري")) return "فرع شكري";
  if (branch.includes("شامي") || branch.includes("الشامى")) return "فرع الشامي";
  return branch;
}

function branchFilterValues(branch: string) {
  if (branch.includes("شكري")) return ["فرع شكري", "شكري", "الادارة فرع شكري"];
  if (branch.includes("شامي") || branch.includes("الشامى")) return ["فرع الشامي", "الشامي", "الشامى", "الفرعية الشامي"];
  return [branch];
}

function normalizeCustomer(record: Record<string, unknown>): Customer {
  const customerCode = readFirst(record, ["customer_code", "code"], null) as string | null;
  return {
    ...record,
    id: String(readFirst(record, ["id", "customer_id", "customer_code", "phone"], "")),
    customer_code: customerCode,
    name: String(readFirst(record, ["name", "customer_name", "full_name"], "عميل بدون اسم")),
    phone: String(readFirst(record, ["phone", "customer_phone", "phone_number", "mobile"], "")),
    branch: normalizeBranchName(readFirst(record, ["branch", "branch_name"], null)),
    type: readFirst(record, ["type", "customer_type", "segment", "priority"], null) as string | null,
    avg_monthly: toNumber(readFirst(record, ["avg_monthly", "average_monthly", "monthly_avg", "avgMonthly"], 0)),
    total_purchases: toNumber(readFirst(record, ["total_purchases", "total_spent", "total_amount", "purchases_total"], 0)),
    total_invoices: toNumber(readFirst(record, ["total_invoices", "invoice_count", "orders_count"], 0)),
    avg_invoice: toNumber(readFirst(record, ["avg_invoice", "average_invoice", "avg_order_value"], 0)),
    clv: toNumber(readFirst(record, ["clv", "customer_lifetime_value"], 0)),
    risk_score: toNumber(readFirst(record, ["risk_score", "risk", "days_inactive"], 0)),
    retention_status: readFirst(record, ["retention_status", "status"], null) as string | null,
    last_purchase: readFirst(record, ["last_purchase", "last_purchase_date", "last_order_date"], null) as string | null,
    first_purchase: readFirst(record, ["first_purchase", "first_purchase_date", "created_at"], null) as string | null,
    notes: readFirst(record, ["notes", "note"], null) as string | null,
    whatsapp_notes: readFirst(record, ["whatsapp_notes", "whatsapp_note"], null) as string | null,
    created_at: readFirst(record, ["created_at"], null) as string | null,
    updated_at: readFirst(record, ["updated_at"], null) as string | null,
  } as Customer;
}

function applyCustomerFilters(query: CustomerQueryBuilder, options: GetCustomersOptions) {
  if (options.branch && options.branch !== ALL_FILTER) query = query.in("branch", branchFilterValues(options.branch));
  if (options.type && options.type !== ALL_FILTER) query = query.eq("segment", options.type);
  return query;
}

function isMissingColumnError(error: { message?: string } | null) {
  const message = error?.message?.toLowerCase() || "";
  return message.includes("does not exist") || message.includes("schema cache");
}

function uniqCustomers(records: Customer[]) {
  const seen = new Set<string>();
  return records.filter((customer) => {
    const key = customer.customer_code || customer.id || `${customer.name}:${customer.phone}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function searchTerms(search?: string) {
  const raw = search?.replace(/\*/g, " ").replace(/\s+/g, " ").trim();
  if (!raw) return [];
  const phoneTokens = phoneSearchTokens(raw);
  return Array.from(new Set([raw, phoneTokens.local, phoneTokens.last4, phoneTokens.last5, phoneTokens.whatsapp]))
    .map((term) => term.replace(/[%(),]/g, "").trim())
    .filter((term) => term.length >= 2);
}

/** بحث محسّن بالأولوية: كود تام ← كود يبدأ ← اسم يبدأ ← اسم يشمل ← هاتف */
async function rankedCustomerSearch(options: GetCustomersOptions, limit: number, offset: number) {
  const raw = options.search!.trim();
  const table = PRIMARY_TABLE;
  const scored = new Map<string, { customer: Customer; rank: number }>();

  /** نمط مثل `ا*س*ل*ا*م`: نجلب مرشحين بعرض أول قطعة ثم نفلتر محليًا */
  const starParts = raw.split("*").map((s) => s.trim()).filter(Boolean);
  if (raw.includes("*") && starParts.length >= 2) {
    const first = starParts[0];
    if (first.length >= 1) {
      const { data: broad, error: broadErr } = await supabase.from(table).select("*").ilike("name", `%${first}%`).limit(200);
      if (!broadErr && broad?.length) {
        let list = (broad as Record<string, unknown>[]).map(normalizeCustomer).filter((c) => matchesOrderedSegments(c.name, raw));
        list = list.filter((customer) => {
          const branchMatch = !options.branch || options.branch === ALL_FILTER || customer.branch === options.branch;
          const typeMatch =
            !options.type || options.type === ALL_FILTER || normalizeArabicType(customer.type) === normalizeArabicType(options.type);
          return branchMatch && typeMatch;
        });
        const total = list.length;
        return {
          customers: list.slice(offset, offset + limit),
          count: total,
          limit,
          offset,
        };
      }
    }
  }

  const merge = (rows: Record<string, unknown>[], rank: number) => {
    for (const row of rows) {
      const customer = normalizeCustomer(row);
      const key = String(customer.customer_code || customer.id || `${customer.phone}:${customer.name}`);
      const prev = scored.get(key);
      if (!prev || rank < prev.rank) scored.set(key, { customer, rank });
    }
  };

  const startsStar = raw.endsWith("*") && !raw.startsWith("*");
  const endsStar = raw.startsWith("*") && !raw.endsWith("*");
  const bothStar = raw.startsWith("*") && raw.endsWith("*") && raw.length > 2;

  let nameCore = raw;
  if (startsStar) nameCore = raw.slice(0, -1).trim();
  else if (endsStar) nameCore = raw.slice(1).trim();
  else if (bothStar) nameCore = raw.slice(1, -1).trim();

  const digitsOnly = raw.replace(/\*/g, "").replace(/\s+/g, "").replace(/[^\d٠-٩]/g, "");
  const latinDigits = digitsOnly.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));

  if (latinDigits.length >= 2 && latinDigits.length <= 10) {
    const { data: exactCode } = await supabase.from(table).select("*").eq("customer_code", latinDigits).limit(15);
    merge((exactCode ?? []) as Record<string, unknown>[], 1);
    const { data: swCode } = await supabase.from(table).select("*").ilike("customer_code", `${latinDigits}%`).limit(35);
    merge((swCode ?? []) as Record<string, unknown>[], 2);
  }

  if (nameCore.length >= 1) {
    let namePattern = `%${nameCore}%`;
    let rank = 4;
    if (startsStar) {
      namePattern = `${nameCore}%`;
      rank = 3;
    } else if (endsStar) {
      namePattern = `%${nameCore}`;
      rank = 4;
    } else if (bothStar) {
      namePattern = `%${nameCore}%`;
      rank = 4;
    }

    const { data: nameRows } = await supabase.from(table).select("*").ilike("name", namePattern).limit(45);
    merge((nameRows ?? []) as Record<string, unknown>[], rank);
  }

  const phoneTokens = phoneSearchTokens(raw.replace(/\*/g, " "));
  for (const tok of [phoneTokens.local, phoneTokens.last4, phoneTokens.last5].filter((x) => x && String(x).length >= 2)) {
    const { data: ph } = await supabase.from(table).select("*").ilike("phone", `%${tok}%`).limit(35);
    merge((ph ?? []) as Record<string, unknown>[], 5);
    const { data: ph2, error: e2 } = await supabase.from(table).select("*").ilike("phone2", `%${tok}%`).limit(20);
    if (!e2) merge((ph2 ?? []) as Record<string, unknown>[], 5);
  }

  let list = [...scored.values()]
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return (b.customer.total_purchases ?? 0) - (a.customer.total_purchases ?? 0);
    })
    .map((item) => item.customer);

  list = list.filter((customer) => {
    const branchMatch = !options.branch || options.branch === ALL_FILTER || customer.branch === options.branch;
    const typeMatch =
      !options.type || options.type === ALL_FILTER || normalizeArabicType(customer.type) === normalizeArabicType(options.type);
    return branchMatch && typeMatch;
  });

  const total = list.length;
  return {
    customers: list.slice(offset, offset + limit),
    count: total,
    limit,
    offset,
  };
}

async function getFallbackCustomersBySearch(options: GetCustomersOptions, limit: number, offset: number) {
  const terms = searchTerms(options.search);
  if (!options.search?.trim()) return null;
  if (terms.length === 0) return { customers: [], count: 0, limit, offset };

  const found: Customer[] = [];

  for (const term of terms) {
    for (const column of FALLBACK_SEARCH_COLUMNS) {
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .ilike(column, `%${term}%`)
        .range(0, limit + offset - 1);

      if (error) {
        if (isMissingColumnError(error)) continue;
        throw new Error(error.message);
      }

      found.push(...((data ?? []) as Record<string, unknown>[]).map(normalizeCustomer));
      if (uniqCustomers(found).length >= limit + offset) break;
    }
    if (uniqCustomers(found).length >= limit + offset) break;
  }

  const customers = uniqCustomers(found);
  return {
    customers: customers.slice(offset, offset + limit),
    count: customers.length,
    limit,
    offset,
  };
}

async function getAnalysisCustomers(options: GetCustomersOptions, limit: number, offset: number) {
  if (options.search?.trim()) {
    return rankedCustomerSearch(options, limit, offset);
  }

  let query = supabase
    .from(PRIMARY_TABLE)
    .select("*", { count: "exact" })
    .order("total_spent", { ascending: false })
    .range(offset, offset + limit - 1);

  query = applyCustomerFilters(query, options);

  const { data, error, count } = await query;
  if (error) throw error;

  return {
    customers: ((data ?? []) as Record<string, unknown>[]).map(normalizeCustomer),
    count: count ?? 0,
    limit,
    offset,
  };
}

async function getFallbackCustomers(options: GetCustomersOptions, limit: number, offset: number) {
  const searchResult = await getFallbackCustomersBySearch(options, limit, offset);
  if (searchResult) return searchResult;

  const { data, error, count } = await supabase
    .from("customers")
    .select("*", { count: "exact" })
    .range(offset, offset + limit - 1);

  if (error) throw new Error(error.message);
  const mapped = ((data ?? []) as Record<string, unknown>[]).map(normalizeCustomer);
  const filtered = mapped.filter((customer) => {
    const branchMatch = !options.branch || options.branch === ALL_FILTER || customer.branch === options.branch;
    const typeMatch = !options.type || options.type === ALL_FILTER || normalizeArabicType(customer.type) === normalizeArabicType(options.type);
    return branchMatch && typeMatch;
  });

  return { customers: filtered, count: count ?? 0, limit, offset };
}

async function countCustomers(options: GetCustomersOptions = {}) {
  if (!isSupabaseConfigured) return 0;

  let query = supabase
    .from(PRIMARY_TABLE)
    .select("customer_code", { count: "exact", head: true });

  query = applyCustomerFilters(query, options);

  const { count: cPrimary, error } = await query;
  if (error) throw new Error(error.message);

  const { count: cRaw, error: errRaw } = await supabase.from("customers").select("id", { count: "exact", head: true });
  const alt = errRaw ? 0 : (cRaw ?? 0);

  /** بعض العملاء قد يكونون في جدول `customers` الكامل دون أن يُحدَّث `customer_analysis` بعد */
  return Math.max(cPrimary ?? 0, alt);
}

export async function getCustomers(options: GetCustomersOptions = {}) {
  if (!isSupabaseConfigured) {
    throw new Error("إعدادات Supabase غير موجودة. أضف VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY في ملف .env.");
  }

  const limit = normalizeLimit(options.limit);
  const offset = Math.max(options.offset ?? 0, 0);

  try {
    return await getAnalysisCustomers(options, limit, offset);
  } catch (error) {
    const message = getErrorMessage(error);
    // أي خطأ في customer_analysis لا يوقف البحث؛ نرجع مباشرة لجدول customers الأقل تعقيدًا.
    if (isMissingColumnError(error as { message?: string }) || message.includes("400") || message.includes("Bad Request")) {
      return getFallbackCustomers(options, limit, offset);
    }
    throw new Error(message);
  }
}

export async function getCustomerById(id: string) {
  if (!isSupabaseConfigured) {
    throw new Error("إعدادات Supabase غير موجودة.");
  }

  const { data, error } = await supabase
    .from(PRIMARY_TABLE)
    .select("*")
    .eq("customer_code", id)
    .single();

  if (error) throw new Error(error.message);
  return normalizeCustomer(data as Record<string, unknown>);
}

function getCustomerLookup(customer: Customer) {
  const code = customer.customer_code || customer.id;
  const phone = customer.phone || "";
  return { code, phone };
}

export async function getCustomerDetails(customer: Customer): Promise<CustomerDetails> {
  if (!isSupabaseConfigured) {
    throw new Error("إعدادات Supabase غير موجودة.");
  }

  const { code, phone } = getCustomerLookup(customer);

  const [invoiceResult, followupResult] = await Promise.all([
    supabase
      .from("sales_invoices")
      .select("invoice_number, invoice_date, amount, seller_name, branch")
      .or(`customer_code.eq.${code},customer_phone.eq.${phone}`)
      .order("invoice_date", { ascending: false })
      .limit(200),
    supabase
      .from("daily_followups")
      .select("*")
      .or(`customer_id.eq.${code},customer_phone.eq.${phone},customer_name.eq.${customer.name}`)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  if (invoiceResult.error && !isMissingColumnError(invoiceResult.error)) {
    throw new Error(invoiceResult.error.message);
  }
  if (followupResult.error && !isMissingColumnError(followupResult.error)) {
    throw new Error(followupResult.error.message);
  }

  const invoices = ((invoiceResult.data ?? []) as Record<string, unknown>[]).map((row) => ({
    invoice_number: readFirst(row, ["invoice_number"], null) as string | null,
    invoice_date: readFirst(row, ["invoice_date"], null) as string | null,
    amount: toNumber(readFirst(row, ["amount"], 0)),
    seller_name: readFirst(row, ["seller_name"], null) as string | null,
    branch: normalizeBranchName(readFirst(row, ["branch"], null)),
  }));

  const doctorScores = new Map<string, { count: number; total: number }>();
  for (const invoice of invoices) {
    if (!invoice.seller_name) continue;
    const current = doctorScores.get(invoice.seller_name) || { count: 0, total: 0 };
    current.count += 1;
    current.total += invoice.amount;
    doctorScores.set(invoice.seller_name, current);
  }

  const topDoctor = [...doctorScores.entries()]
    .sort((a, b) => (b[1].total - a[1].total) || (b[1].count - a[1].count))[0]?.[0] || null;

  const followups = ((followupResult.data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(readFirst(row, ["id"], "")),
    status: readFirst(row, ["status"], null) as string | null,
    assigned_to: readFirst(row, ["assigned_to"], null) as string | null,
    notes: readFirst(row, ["notes"], null) as string | null,
    created_at: readFirst(row, ["created_at"], null) as string | null,
    followup_date: readFirst(row, ["followup_date"], null) as string | null,
  }));

  const lastFollowup = followups[0] || null;

  return {
    invoices,
    followups,
    lastFollowup,
    topDoctor,
    lastServiceDoctor: lastFollowup?.assigned_to || null,
    lastFollowupReport: lastFollowup?.notes || null,
  };
}

export async function getCustomerStats(): Promise<CustomerStats> {
  const safeCount = async (query: PromiseLike<{ count: number | null; error: { message: string } | null }>) => {
    const { count, error } = await query;
    if (error) return 0;
    return count ?? 0;
  };

  try {
    const [total, vip, newC, atRiskLost, atRiskWarning] = await Promise.all([
      countCustomers(),
      safeCount(supabase
        .from(PRIMARY_TABLE)
        .select("customer_code", { count: "exact", head: true })
        .in("segment", ["مهم جداً", "مهم جدا", "مهم جدًّا"])),
      safeCount(supabase
        .from(PRIMARY_TABLE)
        .select("customer_code", { count: "exact", head: true })
        .eq("status", "جديد")
      ),
      safeCount(supabase
        .from(PRIMARY_TABLE)
        .select("customer_code", { count: "exact", head: true })
        .eq("status", "مفقود")
      ),
      safeCount(supabase
        .from(PRIMARY_TABLE)
        .select("customer_code", { count: "exact", head: true })
        .eq("status", "معرض للفقدان")
      ),
    ]);

    return { total, vip, newC, atRisk: atRiskLost + atRiskWarning };
  } catch (error) {
    throw new Error(getErrorMessage(error));
  }
}
