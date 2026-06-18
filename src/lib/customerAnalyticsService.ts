import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { getSalesValue } from "@/lib/analyticsService";
import { cleanEgyptianPhone } from "@/lib/whatsapp";

type AnyRow = Record<string, any>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidLike(value: unknown) {
  return UUID_RE.test(String(value ?? "").trim());
}

export function cleanCustomerCode(value: unknown) {
  const code = String(value ?? "").trim();
  if (!code || isUuidLike(code)) return "";
  return code;
}

// تصنيف العملاء حسب المشتريات الشهرية:
// مهم جدًا: >= 8000 شهريًا | مهم: >= 4000 | متوسط: >= 1500 | عادي: < 1500
export function normalizeCustomerSegment(value: unknown, _totalSpent = 0, avgMonthly = 0) {
  const raw = String(value ?? "").trim().toLowerCase().replace("جداً", "جدًا").replace("جدا", "جدًا");
  // توحيد القيم القديمة، لكن الحكم النهائي يكون من avg_monthly إذا كان متاحًا.
  const avg = Number(avgMonthly || 0);
  if (avg > 8000) return "مهم جدًا";
  if (avg > 4000) return "مهم";
  if (avg > 1500) return "متوسط";
  if (avg >= 0) return "عادي";
  if (["مهم جدًا", "مهم جدا", "vip", "very important"].includes(raw)) return "مهم جدًا";
  if (["مهم", "important"].includes(raw)) return "مهم";
  if (["متوسط", "medium"].includes(raw)) return "متوسط";
  return "عادي";
}

export function normalizeCustomerStatus(value: unknown, lastPurchase?: string | null, firstPurchase?: string | null) {
  const raw = String(value ?? "").trim().toLowerCase().replace("معرض للفقدان", "مهدد بالتوقف").replace("مفقود", "متوقف");
  if (["جديد", "new"].includes(raw)) return "جديد";
  if (["نشط", "active", "محتفظ", "retained"].includes(raw)) return "نشط";
  if (["مهدد بالتوقف", "at risk", "risk", "معرض للتوقف"].includes(raw)) return "مهدد بالتوقف";
  if (["متوقف", "lost", "stopped"].includes(raw)) return "متوقف";
  if (!lastPurchase) return "بدون شراء";

  const last = new Date(lastPurchase).getTime();
  if (Number.isNaN(last)) return "بدون شراء";
  const days = Math.floor((Date.now() - last) / 86400000);
  const first = firstPurchase ? new Date(firstPurchase).getTime() : NaN;
  const firstDays = Number.isNaN(first) ? 999 : Math.floor((Date.now() - first) / 86400000);
  if (firstDays <= 30) return "جديد";
  if (days <= 45) return "نشط";
  if (days <= 90) return "مهدد بالتوقف";
  return "متوقف";
}

export function normalizeCustomerPriority(value: unknown, segment?: string | null, status?: string | null) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (["عالية", "high"].includes(raw)) return "عالية";
  if (["متوسطة", "medium"].includes(raw)) return "متوسطة";
  if (["عادية", "normal", "low"].includes(raw)) return "عادية";
  if (segment === "مهم جدًا" || (segment === "مهم" && ["متوقف", "مهدد بالتوقف"].includes(status || ""))) return "عالية";
  if (segment === "مهم" || segment === "متوسط" || ["متوقف", "مهدد بالتوقف"].includes(status || "")) return "متوسطة";
  return "عادية";
}

const CUSTOMER_FLAG_LABELS: Record<string, string> = {
  high_value: "عالي القيمة",
  price_sensitive: "حساس للسعر",
  no_delivery: "لا توصيل",
  no_substitutes: "لا بدائل",
  needs_special_handling: "يحتاج تعامل خاص",
  vip: "VIP",
  callback_required: "متابعة لاحقة",
  blacklisted: "محظور",
};

export function customerFlagLabels(flags?: Record<string, boolean> | { important_tags?: string[] } | null) {
  if (!flags || typeof flags !== "object") return [];
  const activeKeys = Array.isArray((flags as any).important_tags)
    ? (flags as any).important_tags.map((key: unknown) => String(key))
    : Object.entries(flags as Record<string, boolean>).filter(([, value]) => Boolean(value)).map(([key]) => key);
  return activeKeys.map((key) => CUSTOMER_FLAG_LABELS[key] || key);
}

export function isValidEgyptPhone(phone?: string | null, customerCode?: string | null) {
  const trimmed = String(phone || "").trim().toLowerCase();
  if (!trimmed) return false;
  if (trimmed.startsWith("code:")) return false;

  const codeDigits = String(customerCode || "").replace(/\D/g, "");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return false;
  if (codeDigits && digits === codeDigits) return false;
  if (customerCode && trimmed === String(customerCode || "").trim().toLowerCase()) return false;
  if (digits.length < 10 || digits.length > 13) return false;

  const clean = cleanEgyptianPhone(phone);
  if (!clean) return false;
  return true;
}

export function getBestCustomerPhone(
  followup: { customer_phone?: string | null; phone?: string | null; customer_code?: string | null },
  customerSummary?: { customer_phone?: string | null } | null,
  customerDetails?: {
    whatsapp_phone?: string | null;
    phone?: string | null;
    phone_alt?: string | null;
    customer_phone?: string | null;
  } | null
): string | null {
  const customerCode = followup.customer_code || "";

  // Priority 1: customer_metrics_summary.customer_phone if valid
  if (customerSummary?.customer_phone && isValidEgyptPhone(customerSummary.customer_phone, customerCode)) {
    return customerSummary.customer_phone;
  }

  // Priority 2: customers.whatsapp_phone if valid
  if (customerDetails?.whatsapp_phone && isValidEgyptPhone(customerDetails.whatsapp_phone, customerCode)) {
    return customerDetails.whatsapp_phone;
  }
  
  // Priority 3: customers.phone if valid
  if (customerDetails?.phone && isValidEgyptPhone(customerDetails.phone, customerCode)) {
    return customerDetails.phone;
  }
  
  // Priority 4: customers.phone_alt if valid
  if (customerDetails?.phone_alt && isValidEgyptPhone(customerDetails.phone_alt, customerCode)) {
    return customerDetails.phone_alt;
  }

  // Priority 5: daily_followups.customer_phone if valid
  if (followup.customer_phone && isValidEgyptPhone(followup.customer_phone, customerCode)) {
    return followup.customer_phone;
  }

  // Priority 6: daily_followups.phone if valid
  if (followup.phone && isValidEgyptPhone(followup.phone, customerCode)) {
    return followup.phone;
  }
  
  // Priority 7: customers.customer_phone if valid
  if (customerDetails?.customer_phone && isValidEgyptPhone(customerDetails.customer_phone, customerCode)) {
    return customerDetails.customer_phone;
  }
  
  return null;
}

export function isPseudoCustomer(customer?: { customer_name?: string | null; name?: string | null; customer_phone?: string | null; phone?: string | null; customer_id?: string | null; customer_code?: string | null; }) {
  const name = String(customer?.customer_name || customer?.name || "").toLowerCase();
  const phone = String(customer?.customer_phone || customer?.phone || "");
  const noPhone = !isValidEgyptPhone(phone, customer?.customer_code);
  const pseudoKeywords = ["عميل غير مسجل", "عميل الصيدلية", "غير معروف", "anonymous", "unknown"];
  const pseudoName = pseudoKeywords.some((term) => name.includes(term));
  const hasId = Boolean(customer?.customer_id && isUuidLike(customer.customer_id));
  return noPhone && (!hasId || pseudoName);
}

function invoiceAmount(row: AnyRow) {
  const value = getSalesValue(row);
  return Number.isFinite(value) ? value : 0;
}

function invoiceDate(row: AnyRow) {
  return String(row.invoice_date || row.invoice_datetime || row.close_datetime || row.created_at || "").slice(0, 10);
}

function monthSpan(first: string | null, last: string | null) {
  if (!first || !last) return 1;
  const a = new Date(first);
  const b = new Date(last);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 1;
  return Math.max(1, (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1);
}

async function fetchPaged(table: string, select = "*", pageSize = 1000, maxRows = 100000) {
  if (table === "sales_invoices") {
    throw new Error("تحميل كل sales_invoices غير مسموح. استخدم customer_metrics_summary أو استعلامًا محدودًا.");
  }

  const all: AnyRow[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase.from(table).select(select).range(from, to);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as AnyRow[];
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return all;
}

function buildLookups(customers: AnyRow[]) {
  const byCode = new Map<string, AnyRow>();
  const byPhone = new Map<string, AnyRow>();
  for (const customer of customers) {
    const code = cleanCustomerCode(customer.customer_code);
    const phone = cleanEgyptianPhone(customer.phone || customer.whatsapp_phone || customer.phone_alt || "");
    if (code) byCode.set(code, customer);
    if (phone && !byPhone.has(phone)) byPhone.set(phone, customer);
  }
  return { byCode, byPhone };
}


/**
 * إثراء بيانات العملاء من الفواتير المستوردة مباشرةً (دون حفظ في DB).
 * يُستخدم لعرض التصنيف الصحيح في جميع الصفحات دون الحاجة لإعادة البناء الكاملة.
 */
export function enrichCustomersFromInvoices<T extends AnyRow>(customers: T[], invoices: AnyRow[]): T[] {
  // بناء جدول lookup بالكود والهاتف
  const invoicesByCode = new Map<string, AnyRow[]>();
  const invoicesByPhone = new Map<string, AnyRow[]>();

  for (const inv of invoices) {
    const code = cleanCustomerCode(inv.customer_code);
    const phone = String(inv.customer_phone || inv.phone || "").trim().replace(/\s/g, "");
    if (code) {
      if (!invoicesByCode.has(code)) invoicesByCode.set(code, []);
      invoicesByCode.get(code)!.push(inv);
    }
    if (phone && phone.length >= 7) {
      if (!invoicesByPhone.has(phone)) invoicesByPhone.set(phone, []);
      invoicesByPhone.get(phone)!.push(inv);
    }
  }

  return customers.map((customer) => {
    const code = cleanCustomerCode(customer.customer_code);
    const phone = String(customer.phone || "").trim().replace(/\s/g, "");
    const matched = (code && invoicesByCode.get(code)) || (phone && invoicesByPhone.get(phone)) || [];

    if (matched.length === 0) return customer;

    const total = matched.reduce((sum, inv) => sum + invoiceAmount(inv), 0);
    const count = matched.length;
    const dates = matched.map((inv) => invoiceDate(inv)).filter(Boolean).sort();
    const first = dates[0] || null;
    const last = dates[dates.length - 1] || null;
    const avgMonthly = total / monthSpan(first, last);
    const avgInvoice = count ? total / count : 0;
    const segment = normalizeCustomerSegment(customer.segment || customer.type, total, avgMonthly);
    const status = normalizeCustomerStatus(customer.status, last, first);
    const priority = normalizeCustomerPriority(customer.priority, segment, status);

    return {
      ...customer,
      total_spent: total,
      total_purchases: total,
      invoices_count: count,
      total_invoices: count,
      avg_invoice: avgInvoice,
      avg_monthly: avgMonthly,
      first_purchase: first,
      last_purchase: last,
      last_order_date: last,
      segment,
      type: segment,
      status,
      retention_status: status,
      priority,
    };
  });
}

export async function rebuildCustomerStats() {
  if (!isSupabaseConfigured) throw new Error("Supabase غير مفعّل");

  const customers = await fetchPaged("customers");
  const invoices = await fetchPaged("sales_invoices");
  const { byCode, byPhone } = buildLookups(customers);
  const stats = new Map<string, { customer: AnyRow; total: number; count: number; first: string | null; last: string | null }>();
  const invoiceLinks: Array<{ id: string; customer_id: string }> = [];

  for (const invoice of invoices) {
    const code = cleanCustomerCode(invoice.customer_code);
    const phone = cleanEgyptianPhone(invoice.customer_phone || invoice.phone || "");
    const customer = (code && byCode.get(code)) || (phone && byPhone.get(phone)) || null;
    if (!customer) continue;
    const customerKey = String(customer.id || customer.customer_code);
    const date = invoiceDate(invoice);
    const current = stats.get(customerKey) || { customer, total: 0, count: 0, first: null, last: null };
    current.total += invoiceAmount(invoice);
    current.count += 1;
    if (date) {
      if (!current.first || date < current.first) current.first = date;
      if (!current.last || date > current.last) current.last = date;
    }
    stats.set(customerKey, current);
    if (invoice.id && customer.id && invoice.customer_id !== customer.id) {
      invoiceLinks.push({ id: invoice.id, customer_id: customer.id });
    }
  }

  const updates = customers.map((customer) => {
    const key = String(customer.id || customer.customer_code);
    const current = stats.get(key);
    const total = current?.total ?? 0;
    const count = current?.count ?? 0;
    const avgInvoice = count ? total / count : 0;
    const avgMonthly = count ? total / monthSpan(current?.first || null, current?.last || null) : 0;
    const segment = normalizeCustomerSegment(customer.segment, total, avgMonthly);
    const status = normalizeCustomerStatus(customer.status, current?.last || null, current?.first || null);
    const priority = normalizeCustomerPriority(customer.priority, segment, status);
    return {
      id: customer.id,
      total_spent: total,
      invoices_count: count,
      avg_invoice: avgInvoice,
      avg_monthly: avgMonthly,
      first_purchase: current?.first || null,
      last_purchase: current?.last || null,
      last_order_date: current?.last || null,
      segment,
      status,
      priority,
    };
  });

  for (let i = 0; i < updates.length; i += 200) {
    const chunk = updates.slice(i, i + 200);
    const { error } = await supabase.from("customers").upsert(chunk, { onConflict: "id" });
    if (error) throw new Error(error.message);
  }

  for (let i = 0; i < invoiceLinks.length; i += 200) {
    await Promise.all(
      invoiceLinks.slice(i, i + 200).map((link) =>
        supabase.from("sales_invoices").update({ customer_id: link.customer_id }).eq("id", link.id),
      ),
    );
  }

  return { customers: updates.length, linkedInvoices: invoiceLinks.length };
}

export async function getCustomerSegments() {
  const customers = await fetchPaged("customers", "segment,total_spent,avg_monthly");
  return customers.reduce<Record<string, number>>((acc, row) => {
    const label = normalizeCustomerSegment(row.segment, Number(row.total_spent || 0), Number(row.avg_monthly || 0));
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});
}

export async function getCustomerStatuses() {
  const customers = await fetchPaged("customers", "status,last_purchase,first_purchase");
  return customers.reduce<Record<string, number>>((acc, row) => {
    const label = normalizeCustomerStatus(row.status, row.last_purchase, row.first_purchase);
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});
}

export async function getCustomersAtRisk(limit = 50) {
  const customers = await fetchPaged("customers");
  return customers
    .filter((row) => ["متوقف", "مهدد بالتوقف"].includes(normalizeCustomerStatus(row.status, row.last_purchase, row.first_purchase)))
    .sort((a, b) => Number(b.total_spent || 0) - Number(a.total_spent || 0))
    .slice(0, limit);
}

export async function getTopCustomers(limit = 20) {
  const customers = await fetchPaged("customers");
  return customers
    .sort((a, b) => Number(b.total_spent || 0) - Number(a.total_spent || 0))
    .slice(0, limit);
}
