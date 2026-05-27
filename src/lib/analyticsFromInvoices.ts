/**
 * تحليلات مبنية على جدول sales_invoices بعد الاستيراد اليومي.
 */

export interface ShiftBounds {
  morningStart: string;
  morningEnd: string;
  eveningEnd: string;
}

/** شيفت صباحي 9–18، مسائي 18–2، ليلي 2–9 (قابل للتعديل من الإعدادات) */
export const DEFAULT_SHIFT_BOUNDS: ShiftBounds = {
  morningStart: "09:00",
  morningEnd: "18:00",
  eveningEnd: "02:00",
};

const STORAGE_KEY = "dawaa_shift_bounds_v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeCustomerCode(value: unknown) {
  const code = String(value ?? "").trim();
  if (!code || UUID_RE.test(code)) return "";
  return code;
}

export function loadShiftBounds(): ShiftBounds {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SHIFT_BOUNDS;
    const parsed = JSON.parse(raw) as ShiftBounds;
    if (!parsed.morningStart || !parsed.morningEnd || !parsed.eveningEnd) return DEFAULT_SHIFT_BOUNDS;
    return parsed;
  } catch {
    return DEFAULT_SHIFT_BOUNDS;
  }
}

export function saveShiftBounds(bounds: ShiftBounds): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bounds));
}

export interface SalesInvoiceRow {
  id?: string;
  branch?: string | null;
  invoice_number?: string | null;
  invoice_date?: string | null;
  invoice_datetime?: string | null;
  close_datetime?: string | null;
  analysis_datetime?: string | null;
  shift_name?: string | null;
  invoice_type?: string | null;
  amount?: number | null;
  gross_amount?: number | null;
  discounted_amount?: number | null;
  seller_name?: string | null;
  delivery_staff?: string | null;
  customer_code?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  close_time?: string | null;
  line_items_count?: number | null;
  discount_amount?: number | null;
  net_amount?: number | null;
  courier_cash?: number | null;
  specialty?: string | null;
  clinic?: string | null;
  extra_fees?: number | null;
  delivery_address?: string | null;
  notes?: string | null;
  save_status?: string | null;
  device_name?: string | null;
  payment_method?: string | null;
}

export type ShiftBucket = "صباحي" | "مسائي" | "ليلي" | "غير محدد";

function parseTimeToMinutes(time: string | null | undefined): number | null {
  if (!time || !String(time).trim()) return null;
  const t = String(time).trim();
  const iso = t.match(/T(\d{2}):(\d{2})/);
  if (iso) return Number(iso[1]) * 60 + Number(iso[2]);
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function boundsToMinutes(b: ShiftBounds) {
  return {
    mStart: parseTimeToMinutes(b.morningStart) ?? 9 * 60,
    mEnd: parseTimeToMinutes(b.morningEnd) ?? 17 * 60,
    eEnd: parseTimeToMinutes(b.eveningEnd) ?? 60,
  };
}

/** توزيع الشيفت حسب الحدود المحفوظة في الإعدادات */
export function classifyInvoiceShift(_isoDate: string | null | undefined, closeTime: string | null | undefined, bounds: ShiftBounds): ShiftBucket {
  const mins = parseTimeToMinutes(closeTime);
  if (mins === null) return "غير محدد";

  const { mStart, mEnd, eEnd } = boundsToMinutes(bounds);

  if (mins >= mStart && mins < mEnd) return "صباحي";

  /** مسائي: من نهاية الصباحي حتى eveningEnd بعد منتصف الليل (مثال 17:00 → 01:00) */
  if (mEnd > eEnd) {
    if (mins >= mEnd || mins < eEnd) return "مسائي";
    return "ليلي";
  }

  if (mins >= mEnd && mins < eEnd) return "مسائي";
  return "ليلي";
}

export function getShiftFromDateTime(dateTime: string | null | undefined, bounds: ShiftBounds = DEFAULT_SHIFT_BOUNDS): ShiftBucket {
  if (!dateTime) return "غير محدد";
  const mins = parseTimeToMinutes(dateTime);
  if (mins === null) return "غير محدد";

  const { mStart, mEnd, eEnd } = boundsToMinutes(bounds);
  if (mins >= mStart && mins < mEnd) return "صباحي";
  if (mEnd > eEnd) {
    if (mins >= mEnd || mins < eEnd) return "مسائي";
    return "ليلي";
  }
  if (mins >= mEnd && mins < eEnd) return "مسائي";
  return "ليلي";
}

export function isDeliveryInvoice(invoiceType: string | null | undefined): boolean {
  const t = String(invoiceType ?? "").toLowerCase();
  return t.includes("توصيل") || t.includes("delivery") || t.includes("منزلى") || t.includes("منزلي");
}

export function isCashInvoice(invoiceType: string | null | undefined): boolean {
  const t = String(invoiceType ?? "").toLowerCase();
  return t.includes("كاش") || t.includes("cash") || t.includes("محل") || t.includes("فرع");
}

export interface InvoiceAnalyticsAgg {
  totalSales: number;
  invoiceCount: number;
  deliveryCount: number;
  cashCount: number;
  otherCount: number;
  avgInvoice: number;
  shiftMorningSales: number;
  shiftEveningSales: number;
  shiftNightSales: number;
  shiftMorningCount: number;
  shiftEveningCount: number;
  shiftNightCount: number;
  shiftUndefinedCount: number;
  invoicesMissingTime: number;
  perDoctor: Record<string, { sales: number; count: number; items: number }>;
  perBranch: Record<string, { sales: number; count: number }>;
  perDeliveryStaff: Record<string, { sales: number; count: number }>;
  // Smart analytics additions
  topCustomers: Array<{ code: string; name: string; total: number; count: number }>;
  dailyTrend: Array<{ date: string; sales: number; count: number }>;
  peakHours: Array<{ hour: number; sales: number; count: number }>;
  customerRetention: { new: number; returning: number; churned: number };
  averageOrderValue: number;
  repeatPurchaseRate: number;
}

export function aggregateInvoiceAnalytics(rows: SalesInvoiceRow[], bounds: ShiftBounds): InvoiceAnalyticsAgg {
  const agg: InvoiceAnalyticsAgg = {
    totalSales: 0,
    invoiceCount: 0,
    deliveryCount: 0,
    cashCount: 0,
    otherCount: 0,
    avgInvoice: 0,
    shiftMorningSales: 0,
    shiftEveningSales: 0,
    shiftNightSales: 0,
    shiftMorningCount: 0,
    shiftEveningCount: 0,
    shiftNightCount: 0,
    shiftUndefinedCount: 0,
    invoicesMissingTime: 0,
    perDoctor: {},
    perBranch: {},
    perDeliveryStaff: {},
    topCustomers: [],
    dailyTrend: [],
    peakHours: [],
    customerRetention: { new: 0, returning: 0, churned: 0 },
    averageOrderValue: 0,
    repeatPurchaseRate: 0,
  };

  const customerMap = new Map<string, { name: string; total: number; count: number; firstDate: string; lastDate: string }>();
  const dailyMap = new Map<string, { sales: number; count: number }>();
  const hourlyMap = new Map<number, { sales: number; count: number }>();
  const customerDates = new Map<string, Set<string>>();

  for (const row of rows) {
    const amount = Number(row.net_amount ?? row.amount ?? row.gross_amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    agg.invoiceCount++;
    agg.totalSales += amount;

    const invType = row.invoice_type || "";
    if (isDeliveryInvoice(invType)) agg.deliveryCount++;
    else if (isCashInvoice(invType)) agg.cashCount++;
    else agg.otherCount++;

    const shift = getShiftFromDateTime(row.analysis_datetime || row.close_datetime || row.close_time || row.invoice_datetime || row.invoice_date, bounds);
    if (shift === "غير محدد") {
      agg.shiftUndefinedCount++;
      agg.invoicesMissingTime++;
    } else if (shift === "صباحي") {
      agg.shiftMorningSales += amount;
      agg.shiftMorningCount++;
    } else if (shift === "مسائي") {
      agg.shiftEveningSales += amount;
      agg.shiftEveningCount++;
    } else {
      agg.shiftNightSales += amount;
      agg.shiftNightCount++;
    }

    const doctor = String(row.seller_name ?? "").trim() || "غير محدد";
    const docStats = agg.perDoctor[doctor] || { sales: 0, count: 0, items: 0 };
    docStats.sales += amount;
    docStats.count += 1;
    docStats.items += Number(row.line_items_count ?? 0);
    agg.perDoctor[doctor] = docStats;

    const branch = String(row.branch ?? "").trim() || "غير محدد";
    const br = agg.perBranch[branch] || { sales: 0, count: 0 };
    br.sales += amount;
    br.count += 1;
    agg.perBranch[branch] = br;

    if (isDeliveryInvoice(invType)) {
      const del = String(row.delivery_staff ?? "").trim() || "غير محدد";
      const ds = agg.perDeliveryStaff[del] || { sales: 0, count: 0 };
      ds.sales += amount;
      ds.count += 1;
      agg.perDeliveryStaff[del] = ds;
    }

    // Customer analytics
    const customerCode = safeCustomerCode(row.customer_code) || String(row.customer_phone || row.customer_name || "بدون كود").trim();
    const customerName = String(row.customer_name || "").trim() || "عميل غير مسجل";
    const invoiceDate = String(row.analysis_datetime || row.invoice_datetime || row.invoice_date || "").slice(0, 10);
    
    const cust = customerMap.get(customerCode) || { name: customerName, total: 0, count: 0, firstDate: invoiceDate, lastDate: invoiceDate };
    cust.total += amount;
    cust.count += 1;
    if (invoiceDate < cust.firstDate) cust.firstDate = invoiceDate;
    if (invoiceDate > cust.lastDate) cust.lastDate = invoiceDate;
    customerMap.set(customerCode, cust);

    // Daily trend
    const daily = dailyMap.get(invoiceDate) || { sales: 0, count: 0 };
    daily.sales += amount;
    daily.count += 1;
    dailyMap.set(invoiceDate, daily);

    // Peak hours
    const mins = parseTimeToMinutes(row.analysis_datetime || row.close_datetime || row.close_time);
    if (mins !== null) {
      const hour = Math.floor(mins / 60);
      const hourStats = hourlyMap.get(hour) || { sales: 0, count: 0 };
      hourStats.sales += amount;
      hourStats.count += 1;
      hourlyMap.set(hour, hourStats);
    }

    // Customer retention tracking
    const dates = customerDates.get(customerCode) || new Set();
    dates.add(invoiceDate);
    customerDates.set(customerCode, dates);
  }

  // Calculate top customers
  agg.topCustomers = Array.from(customerMap.entries())
    .map(([code, data]) => ({ code, name: data.name, total: data.total, count: data.count }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 20);

  // Calculate daily trend
  agg.dailyTrend = Array.from(dailyMap.entries())
    .map(([date, data]) => ({ date, sales: data.sales, count: data.count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Calculate peak hours
  agg.peakHours = Array.from(hourlyMap.entries())
    .map(([hour, data]) => ({ hour, sales: data.sales, count: data.count }))
    .sort((a, b) => b.sales - a.sales);

  // Calculate customer retention
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 86400000).toISOString().slice(0, 10);

  for (const [code, dates] of customerDates) {
    const sortedDates = Array.from(dates).sort();
    const lastPurchase = sortedDates[sortedDates.length - 1];
    
    if (sortedDates.length === 1) {
      agg.customerRetention.new++;
    } else if (lastPurchase >= thirtyDaysAgo) {
      agg.customerRetention.returning++;
    } else {
      agg.customerRetention.churned++;
    }
  }

  agg.avgInvoice = agg.invoiceCount ? Math.round(agg.totalSales / agg.invoiceCount) : 0;
  agg.averageOrderValue = agg.avgInvoice;
  agg.repeatPurchaseRate = agg.invoiceCount > 0 
    ? Math.round((agg.customerRetention.returning / customerMap.size) * 100) 
    : 0;

  return agg;
}
