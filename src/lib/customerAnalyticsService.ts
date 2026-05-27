import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { cleanEgyptianPhone } from "@/lib/whatsapp";

type AnyRow = Record<string, unknown>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidLike(value: unknown) {
  return UUID_RE.test(String(value ?? "").trim());
}

export function cleanCustomerCode(value: unknown) {
  const code = String(value ?? "").trim();
  if (!code || isUuidLike(code)) return "";
  return code;
}

export function normalizeCustomerSegment(value: unknown, totalSpent = 0, avgMonthly = 0) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (["مهم جدًا", "مهم جدا", "vip", "very important"].includes(raw)) return "مهم جدًا";
  if (["مهم", "important"].includes(raw)) return "مهم";
  if (["متوسط", "medium"].includes(raw)) return "متوسط";
  if (["عادي", "normal", "regular", ""].includes(raw)) {
    if (totalSpent >= 20000 || avgMonthly >= 5000) return "مهم جدًا";
    if (totalSpent >= 10000 || avgMonthly >= 2500) return "مهم";
    if (totalSpent >= 3000 || avgMonthly >= 800) return "متوسط";
    return "عادي";
  }
  return String(value || "عادي").replace("جدا", "جدًا");
}

export function normalizeCustomerStatus(value: unknown, lastPurchase?: string | null, firstPurchase?: string | null) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (["نشط", "active"].includes(raw)) return "نشط";
  if (["محتفظ", "retained"].includes(raw)) return "محتفظ";
  if (["معرض للفقدان", "at risk", "risk"].includes(raw)) return "معرض للفقدان";
  if (["مفقود", "lost", "stopped"].includes(raw)) return "مفقود";
  if (["جديد", "new"].includes(raw)) return "جديد";
  if (["بدون شراء", "no purchase", ""].includes(raw) && !lastPurchase) return "بدون شراء";

  if (!lastPurchase) return "بدون شراء";
  const last = new Date(lastPurchase).getTime();
  if (Number.isNaN(last)) return "بدون شراء";
  const days = Math.floor((Date.now() - last) / 86400000);
  const first = firstPurchase ? new Date(firstPurchase).getTime() : NaN;
  const firstDays = Number.isNaN(first) ? 999 : Math.floor((Date.now() - first) / 86400000);
  if (firstDays <= 14) return "جديد";
  if (days <= 30) return "نشط";
  if (days <= 60) return "محتفظ";
  if (days <= 90) return "معرض للفقدان";
  return "مفقود";
}

export function normalizeCustomerPriority(value: unknown, segment?: string | null, status?: string | null) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (["عالية", "high"].includes(raw)) return "عالية";
  if (["متوسطة", "medium"].includes(raw)) return "متوسطة";
  if (["عادية", "normal", "low"].includes(raw)) return "عادية";
  if (segment === "مهم جدًا" || (segment === "مهم" && ["مفقود", "معرض للفقدان"].includes(status || ""))) return "عالية";
  if (segment === "مهم" || segment === "متوسط" || ["مفقود", "معرض للفقدان"].includes(status || "")) return "متوسطة";
  return "عادية";
}

function invoiceAmount(row: AnyRow) {
  const value = Number(row.net_amount ?? row.amount ?? row.gross_amount ?? 0);
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
    .filter((row) => ["مفقود", "معرض للفقدان"].includes(normalizeCustomerStatus(row.status, row.last_purchase, row.first_purchase)))
    .sort((a, b) => Number(b.total_spent || 0) - Number(a.total_spent || 0))
    .slice(0, limit);
}

export async function getTopCustomers(limit = 20) {
  const customers = await fetchPaged("customers");
  return customers
    .sort((a, b) => Number(b.total_spent || 0) - Number(a.total_spent || 0))
    .slice(0, limit);
}
