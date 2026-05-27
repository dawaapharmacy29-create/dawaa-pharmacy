import { getInvoiceAmount, getInvoiceCustomer, getInvoiceDate, getInvoiceDoctor, pickFirst } from "@/lib/dawaa2027";

export type CustomerClassKey = "vip" | "important" | "medium" | "normal" | "unknown";
export type CustomerStatusKey = "new" | "active" | "at_risk" | "stopped" | "unknown";

export type CustomerLike = Record<string, unknown>;
export type InvoiceLike = Record<string, unknown>;

export interface CustomerSalesMetrics {
  totalSpent: number;
  invoiceCount: number;
  averageInvoice: number;
  monthlyAverage: number;
  firstPurchaseDate: string | null;
  lastPurchaseDate: string | null;
  latestInvoices: InvoiceLike[];
  mostImportantDoctorByValue: string;
  mostImportantDoctorByInvoiceCount: string;
  branchRelation: string;
  clv: number;
}

export function normalizePhone(value: unknown): string {
  return String(value ?? "")
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[^\d]/g, "")
    .replace(/^0020/, "0")
    .replace(/^20(?=1\d{9}$)/, "0");
}

export function normalizeText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[أإآا]/g, "ا")
    .replace(/[ى]/g, "ي")
    .replace(/[ة]/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstText(row: CustomerLike, keys: string[]): string {
  return String(pickFirst(row, keys, "") ?? "").trim();
}

export function isUuidLikeValue(value: unknown): boolean {
  const text = String(value ?? "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text);
}

export function cleanCustomerCode(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text || isUuidLikeValue(text)) return "";
  return text;
}

function customerCode(customer: CustomerLike) {
  return cleanCustomerCode(firstText(customer, ["customer_code", "code"]));
}

function customerPhone(customer: CustomerLike) {
  return normalizePhone(pickFirst(customer, ["phone", "customer_phone", "phone_number", "mobile"], ""));
}

function customerName(customer: CustomerLike) {
  return normalizeText(pickFirst(customer, ["name", "customer_name", "full_name"], ""));
}

function invoiceCode(invoice: InvoiceLike) {
  return cleanCustomerCode(firstText(invoice, ["customer_code", "code"]));
}

function invoicePhone(invoice: InvoiceLike) {
  return normalizePhone(pickFirst(invoice, ["customer_phone", "phone", "phone_number", "mobile"], ""));
}

function invoiceName(invoice: InvoiceLike) {
  return normalizeText(pickFirst(invoice, ["customer_name", "name", "client_name"], getInvoiceCustomer(invoice)));
}

export function matchCustomerInvoice(customer: CustomerLike, invoice: InvoiceLike): boolean {
  const cCode = customerCode(customer);
  const iCode = invoiceCode(invoice);
  if (cCode && iCode) return cCode === iCode;

  const cPhone = customerPhone(customer);
  const iPhone = invoicePhone(invoice);
  if (cPhone && iPhone) return cPhone === iPhone;

  const cName = customerName(customer);
  const iName = invoiceName(invoice);
  return Boolean(cName && iName && cName === iName);
}

function validDate(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

export function getCustomerLatestInvoices(customer: CustomerLike, invoices: InvoiceLike[], limit = 10): InvoiceLike[] {
  return invoices
    .filter((invoice) => matchCustomerInvoice(customer, invoice))
    .sort((a, b) => {
      const bd = validDate(getInvoiceDate(b))?.getTime() ?? 0;
      const ad = validDate(getInvoiceDate(a))?.getTime() ?? 0;
      return bd - ad;
    })
    .slice(0, limit);
}

export function getCustomerInvoices(customer: CustomerLike, invoices: InvoiceLike[]): InvoiceLike[] {
  return invoices.filter((invoice) => matchCustomerInvoice(customer, invoice));
}

export function getCustomerMonthlyInteractionCounts(customer: CustomerLike, invoices: InvoiceLike[]) {
  const counts = new Map<string, number>();
  for (const invoice of getCustomerInvoices(customer, invoices)) {
    const date = validDate(getInvoiceDate(invoice));
    if (!date) continue;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

export function getCustomerMonthlyInteractionSummary(customer: CustomerLike, invoices: InvoiceLike[], today = new Date()) {
  const counts = getCustomerMonthlyInteractionCounts(customer, invoices);
  const currentKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const previousCounts = [...counts.entries()]
    .filter(([month]) => month !== currentKey)
    .map(([, count]) => count)
    .filter((count) => count > 0);
  const expectedMonthlyVisits = previousCounts.length
    ? Math.round(previousCounts.reduce((sum, count) => sum + count, 0) / previousCounts.length)
    : 0;
  const currentMonthVisits = counts.get(currentKey) || 0;
  const shouldAlert = today.getDate() >= 20 && expectedMonthlyVisits > 0 && currentMonthVisits < expectedMonthlyVisits;
  return { counts, currentKey, currentMonthVisits, expectedMonthlyVisits, shouldAlert };
}

export function getMostImportantDoctorByValue(customer: CustomerLike, invoices: InvoiceLike[]): string {
  return getCustomerMetrics(customer, invoices).mostImportantDoctorByValue;
}

export function getCustomerMetrics(customer: CustomerLike, invoices: InvoiceLike[]): CustomerSalesMetrics {
  const matched = invoices.filter((invoice) => matchCustomerInvoice(customer, invoice));
  if (!matched.length) {
    return {
      totalSpent: 0,
      invoiceCount: 0,
      averageInvoice: 0,
      monthlyAverage: 0,
      firstPurchaseDate: null,
      lastPurchaseDate: null,
      latestInvoices: [],
      mostImportantDoctorByValue: "غير محدد",
      mostImportantDoctorByInvoiceCount: "غير محدد",
      branchRelation: "غير محدد",
      clv: 0,
    };
  }

  const dated = matched
    .map((invoice) => ({ invoice, date: validDate(getInvoiceDate(invoice)), amount: getInvoiceAmount(invoice) }))
    .filter((item) => item.amount > 0);

  const totalSpent = dated.reduce((sum, item) => sum + item.amount, 0);
  const invoiceCount = dated.length;
  const averageInvoice = invoiceCount ? totalSpent / invoiceCount : 0;
  const sortedDates = dated.map((item) => item.date).filter(Boolean).sort((a, b) => a!.getTime() - b!.getTime()) as Date[];
  const firstDate = sortedDates[0] || null;
  const lastDate = sortedDates[sortedDates.length - 1] || null;
  const activeMonths = firstDate && lastDate
    ? Math.max(1, (lastDate.getFullYear() - firstDate.getFullYear()) * 12 + (lastDate.getMonth() - firstDate.getMonth()) + 1)
    : 1;
  const monthlyAverage = totalSpent / activeMonths;

  const doctors = new Map<string, { value: number; count: number }>();
  const branches = new Map<string, number>();
  for (const item of dated) {
    const doctor = getInvoiceDoctor(item.invoice) || "غير محدد";
    const doctorStats = doctors.get(doctor) || { value: 0, count: 0 };
    doctorStats.value += item.amount;
    doctorStats.count += 1;
    doctors.set(doctor, doctorStats);

    const branch = String(pickFirst(item.invoice, ["branch", "branch_name"], "غير محدد") || "غير محدد");
    branches.set(branch, (branches.get(branch) || 0) + 1);
  }

  const doctorByValue = [...doctors.entries()].sort((a, b) => b[1].value - a[1].value)[0]?.[0] || "غير محدد";
  const doctorByCount = [...doctors.entries()].sort((a, b) => b[1].count - a[1].count)[0]?.[0] || "غير محدد";
  const branchRelation = [...branches.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "غير محدد";

  return {
    totalSpent,
    invoiceCount,
    averageInvoice,
    monthlyAverage,
    firstPurchaseDate: dateOnly(firstDate),
    lastPurchaseDate: dateOnly(lastDate),
    latestInvoices: getCustomerLatestInvoices(customer, invoices, 10),
    mostImportantDoctorByValue: doctorByValue,
    mostImportantDoctorByInvoiceCount: doctorByCount,
    branchRelation,
    clv: totalSpent + monthlyAverage * 12,
  };
}

export function applyCustomerSalesMetrics<T extends CustomerLike>(customer: T, invoices: InvoiceLike[]): T {
  const metrics = getCustomerMetrics(customer, invoices);
  return {
    ...customer,
    avg_monthly: metrics.monthlyAverage,
    total_purchases: metrics.totalSpent,
    total_invoices: metrics.invoiceCount,
    avg_invoice: metrics.averageInvoice,
    clv: metrics.clv,
    first_purchase: metrics.firstPurchaseDate,
    last_purchase: metrics.lastPurchaseDate,
  };
}

export function calcCLV(totalPurchases?: number | null, monthlyAvg?: number | null) {
  const total = Number(totalPurchases || 0);
  const monthly = Number(monthlyAvg || 0);

  if (total <= 0 && monthly <= 0) {
    return {
      value: null,
      label: "غير كافٍ لحساب القيمة العمرية",
      note: "لا توجد مشتريات من sales_invoices.",
    };
  }

  if (monthly <= 0) {
    return {
      value: total || null,
      label: total ? `${Math.round(total).toLocaleString("ar-EG")} ج.م` : "غير كافٍ لحساب القيمة العمرية",
      note: "بدون متوسط شهري موثوق.",
    };
  }

  const value = total + monthly * 12;
  return { value, label: `${Math.round(value).toLocaleString("ar-EG")} ج.م`, note: null };
}

// تصنيف العميل: مهم جدًا >= 8000 | مهم 4000-8000 | متوسط 1500-4000 | عادي < 1500
export function classifyCustomer(monthlyAvg?: number | null) {
  const avg = Number(monthlyAvg || 0);
  if (avg >= 8000) return { key: "vip" as CustomerClassKey, label: "مهم جدًا", color: "text-purple-400", bg: "bg-purple-500/15 border-purple-500/25" };
  if (avg >= 4000) return { key: "important" as CustomerClassKey, label: "مهم", color: "text-amber-400", bg: "bg-amber-500/15 border-amber-500/25" };
  if (avg >= 1500) return { key: "medium" as CustomerClassKey, label: "متوسط", color: "text-blue-400", bg: "bg-blue-500/15 border-blue-500/25" };
  if (avg > 0) return { key: "normal" as CustomerClassKey, label: "عادي", color: "text-slate-400", bg: "bg-slate-500/15 border-slate-500/25" };
  return { key: "unknown" as CustomerClassKey, label: "غير محدد", color: "text-slate-400", bg: "bg-slate-500/15 border-slate-500/25" };
}

export function customerStatus(lastPurchaseDate?: string | null) {
  if (!lastPurchaseDate) return { key: "unknown" as CustomerStatusKey, label: "غير معروف", days: null, color: "text-slate-400" };

  const date = new Date(lastPurchaseDate);
  if (Number.isNaN(date.getTime())) return { key: "unknown" as CustomerStatusKey, label: "غير معروف", days: null, color: "text-slate-400" };

  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (days <= 14) return { key: "new" as CustomerStatusKey, label: "حديث", days, color: "text-green-400" };
  if (days <= 30) return { key: "active" as CustomerStatusKey, label: "نشط", days, color: "text-teal-400" };
  if (days <= 60) return { key: "at_risk" as CustomerStatusKey, label: "مهدد بالتوقف", days, color: "text-amber-400" };
  return { key: "stopped" as CustomerStatusKey, label: "متوقف", days, color: "text-red-400" };
}
