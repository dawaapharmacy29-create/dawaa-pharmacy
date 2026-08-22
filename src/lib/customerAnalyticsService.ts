import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { getSalesValue } from '@/lib/analyticsService';
import { cleanEgyptianPhone } from '@/lib/whatsapp';

type AnyRow = Record<string, any>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidLike(value: unknown) {
  return UUID_RE.test(String(value ?? '').trim());
}

export function cleanCustomerCode(value: unknown) {
  const code = String(value ?? '').trim();
  if (!code || isUuidLike(code)) return '';
  return code;
}

export function normalizeCustomerSegment(value: unknown, _totalSpent = 0, avgMonthly = 0) {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace('جداً', 'جدًا')
    .replace('جدا', 'جدًا');
  const avg = Number(avgMonthly || 0);
  if (avg >= 8000) return 'مهم جدًا';
  if (avg >= 4000) return 'مهم';
  if (avg >= 1500) return 'متوسط';
  if (avg >= 0) return 'عادي';
  if (['مهم جدًا', 'مهم جدا', 'vip', 'very important'].includes(raw)) return 'مهم جدًا';
  if (['مهم', 'important'].includes(raw)) return 'مهم';
  if (['متوسط', 'medium'].includes(raw)) return 'متوسط';
  return 'عادي';
}

export function normalizeCustomerStatus(
  value: unknown,
  lastPurchase?: string | null,
  firstPurchase?: string | null
) {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace('معرض للفقدان', 'مهدد بالتوقف')
    .replace('مفقود', 'متوقف');
  if (['جديد', 'new'].includes(raw)) return 'جديد';
  if (['نشط', 'active', 'محتفظ', 'retained'].includes(raw)) return 'نشط';
  if (['مهدد بالتوقف', 'at risk', 'risk', 'معرض للتوقف'].includes(raw)) return 'مهدد بالتوقف';
  if (['متوقف', 'lost', 'stopped'].includes(raw)) return 'متوقف';
  if (!lastPurchase) return 'بدون شراء';

  const last = new Date(lastPurchase).getTime();
  if (Number.isNaN(last)) return 'بدون شراء';
  const days = Math.floor((Date.now() - last) / 86400000);
  const first = firstPurchase ? new Date(firstPurchase).getTime() : NaN;
  const firstDays = Number.isNaN(first) ? 999 : Math.floor((Date.now() - first) / 86400000);
  if (firstDays <= 30) return 'جديد';
  if (days <= 45) return 'نشط';
  if (days <= 90) return 'مهدد بالتوقف';
  return 'متوقف';
}

export function normalizeCustomerPriority(
  value: unknown,
  segment?: string | null,
  status?: string | null
) {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase();
  if (['عالية', 'high'].includes(raw)) return 'عالية';
  if (['متوسطة', 'medium'].includes(raw)) return 'متوسطة';
  if (['عادية', 'normal', 'low'].includes(raw)) return 'عادية';
  if (
    segment === 'مهم جدًا' ||
    (segment === 'مهم' && ['متوقف', 'مهدد بالتوقف'].includes(status || ''))
  )
    return 'عالية';
  if (segment === 'مهم' || segment === 'متوسط' || ['متوقف', 'مهدد بالتوقف'].includes(status || ''))
    return 'متوسطة';
  return 'عادية';
}

const CUSTOMER_FLAG_LABELS: Record<string, string> = {
  high_value: 'عالي القيمة',
  price_sensitive: 'حساس للسعر',
  no_delivery: 'لا توصيل',
  no_substitutes: 'لا بدائل',
  needs_special_handling: 'يحتاج تعامل خاص',
  vip: 'VIP',
  callback_required: 'متابعة لاحقة',
  blacklisted: 'محظور',
};

export function customerFlagLabels(
  flags?: Record<string, boolean> | { important_tags?: string[] } | null
) {
  if (!flags || typeof flags !== 'object') return [];
  const activeKeys = Array.isArray((flags as any).important_tags)
    ? (flags as any).important_tags.map((key: unknown) => String(key))
    : Object.entries(flags as Record<string, boolean>)
        .filter(([, value]) => Boolean(value))
        .map(([key]) => key);
  return activeKeys.map((key) => CUSTOMER_FLAG_LABELS[key] || key);
}

export function isValidEgyptPhone(phone?: string | null, customerCode?: string | null) {
  const trimmed = String(phone || '')
    .trim()
    .toLowerCase();
  if (!trimmed || trimmed.startsWith('code:')) return false;

  const codeDigits = String(customerCode || '').replace(/\D/g, '');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return false;
  if (codeDigits && digits === codeDigits) return false;
  if (customerCode && trimmed === String(customerCode).trim().toLowerCase()) return false;
  if (digits.length < 10 || digits.length > 13) return false;
  return Boolean(cleanEgyptianPhone(phone));
}

export function getBestCustomerPhone(
  followup: {
    customer_phone?: string | null;
    phone?: string | null;
    customer_code?: string | null;
  },
  customerSummary?: { customer_phone?: string | null } | null,
  customerDetails?: {
    whatsapp_phone?: string | null;
    phone?: string | null;
    phone_alt?: string | null;
    customer_phone?: string | null;
  } | null
): string | null {
  const customerCode = followup.customer_code || '';
  const candidates = [
    customerSummary?.customer_phone,
    customerDetails?.whatsapp_phone,
    customerDetails?.phone,
    customerDetails?.phone_alt,
    followup.customer_phone,
    followup.phone,
    customerDetails?.customer_phone,
  ];
  return candidates.find((phone) => isValidEgyptPhone(phone, customerCode)) || null;
}

export function isPseudoCustomer(customer?: {
  customer_name?: string | null;
  name?: string | null;
  customer_phone?: string | null;
  phone?: string | null;
  customer_id?: string | null;
  customer_code?: string | null;
}) {
  const name = String(customer?.customer_name || customer?.name || '').toLowerCase();
  const phone = String(customer?.customer_phone || customer?.phone || '');
  const noPhone = !isValidEgyptPhone(phone, customer?.customer_code);
  const pseudoKeywords = ['عميل غير مسجل', 'عميل الصيدلية', 'غير معروف', 'anonymous', 'unknown'];
  const pseudoName = pseudoKeywords.some((term) => name.includes(term));
  const hasId = Boolean(customer?.customer_id && isUuidLike(customer.customer_id));
  return noPhone && (!hasId || pseudoName);
}

function invoiceAmount(row: AnyRow) {
  const value = getSalesValue(row);
  return Number.isFinite(value) ? value : 0;
}

function invoiceDate(row: AnyRow) {
  return String(
    row.invoice_date || row.invoice_datetime || row.close_datetime || row.created_at || ''
  ).slice(0, 10);
}

function monthSpan(first: string | null, last: string | null) {
  if (!first || !last) return 1;
  const a = new Date(first);
  const b = new Date(last);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 1;
  return Math.max(1, (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1);
}

async function fetchPaged(table: string, select = '*', pageSize = 1000, maxRows = 100000) {
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

/**
 * Pure enrichment for already-loaded invoice rows. This function performs no database writes.
 */
export function enrichCustomersFromInvoices<T extends AnyRow>(
  customers: T[],
  invoices: AnyRow[]
): T[] {
  const invoicesByCode = new Map<string, AnyRow[]>();
  const invoicesByPhone = new Map<string, AnyRow[]>();

  for (const inv of invoices) {
    const code = cleanCustomerCode(inv.customer_code);
    const phone = String(inv.customer_phone || inv.phone || '')
      .trim()
      .replace(/\s/g, '');
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
    const phone = String(customer.phone || '')
      .trim()
      .replace(/\s/g, '');
    const matched =
      (code && invoicesByCode.get(code)) || (phone && invoicesByPhone.get(phone)) || [];
    if (matched.length === 0) return customer;

    const total = matched.reduce((sum, inv) => sum + invoiceAmount(inv), 0);
    const count = matched.length;
    const dates = matched.map(invoiceDate).filter(Boolean).sort();
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

/**
 * Historical patcher retired.
 *
 * The old implementation performed a full invoice-table scan and wrote guessed customer links back
 * to invoices. It was unused and contradicted the canonical invoice/customer read-model architecture.
 * Customer metrics are now produced by canonical projections/read models and invoice linking belongs
 * to controlled import/migration flows, never a runtime analytics helper.
 */
export async function rebuildCustomerStats(): Promise<never> {
  if (!isSupabaseConfigured) throw new Error('Supabase غير مفعّل');
  throw new Error(
    'تم إيقاف rebuildCustomerStats القديم. استخدم customer_metrics_summary وعمليات الربط المعتمدة أثناء الاستيراد/المigrations.'
  );
}

export async function getCustomerSegments() {
  const customers = await fetchPaged('customers', 'segment,total_spent,avg_monthly');
  return customers.reduce<Record<string, number>>((acc, row) => {
    const label = normalizeCustomerSegment(
      row.segment,
      Number(row.total_spent || 0),
      Number(row.avg_monthly || 0)
    );
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});
}

export async function getCustomerStatuses() {
  const customers = await fetchPaged('customers', 'status,last_purchase,first_purchase');
  return customers.reduce<Record<string, number>>((acc, row) => {
    const label = normalizeCustomerStatus(row.status, row.last_purchase, row.first_purchase);
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});
}

export async function getCustomersAtRisk(limit = 50) {
  const customers = await fetchPaged('customers');
  return customers
    .filter((row) =>
      ['متوقف', 'مهدد بالتوقف'].includes(
        normalizeCustomerStatus(row.status, row.last_purchase, row.first_purchase)
      )
    )
    .sort((a, b) => Number(b.total_spent || 0) - Number(a.total_spent || 0))
    .slice(0, limit);
}

export async function getTopCustomers(limit = 20) {
  const customers = await fetchPaged('customers');
  return customers
    .sort((a, b) => Number(b.total_spent || 0) - Number(a.total_spent || 0))
    .slice(0, limit);
}
