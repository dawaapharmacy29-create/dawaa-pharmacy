import { RECORD_STATUS } from "@/lib/constants";
import { getCurrentCycle, getCycleForDate } from "@/lib/pharmacy-cycle";
import {
  formatMoney,
  getInvoiceAmount,
  getInvoiceCustomer,
  getInvoiceDate,
  getInvoiceDoctor,
  normalizeArabicName,
  pickFirst,
  toNumber,
} from "@/lib/dawaa2027";

export type AnyRow = Record<string, unknown>;

export interface StaffPerformance2027 {
  name: string;
  normalizedName: string;
  cycleLabel: string;
  invoices: AnyRow[];
  invoiceCount: number;
  totalSales: number;
  avgInvoice: number;
  uniqueCustomers: number;
  topCustomers: Array<{ name: string; sales: number; invoices: number; avg: number; lastPurchase: string }>;
  biggestInvoices: Array<{ invoiceNumber: string; customerName: string; date: string; amount: number; branch: string }>;
  monthlyTransactions: AnyRow[];
  penaltyPoints: number;
  rewardPoints: number;
  followups: AnyRow[];
  followupCount: number;
  completedFollowups: number;
  listSales: AnyRow[];
  stagnantDispenses: AnyRow[];
  warnings: string[];
}

export const CUSTOMER_FLAG_TEMPLATES_2027 = [
  "VIP",
  "مهم جدًا",
  "لا يضاف له توصيل",
  "يفضل المستورد",
  "لا يحب البدائل",
  "حساس للسعر",
  "لا يحب الترشيحات",
  "عميل أطفال",
  "عميل روشتات",
  "عميل مزمن",
  "يحتاج متابعة شهرية",
  "يحتاج اتصال قبل التوصيل",
  "يفضل دكتور معين",
  "كثير الشكاوى",
  "لا يتم التواصل معه كثيرًا",
];

export function rowText(row: AnyRow, keys: string[], fallback = "") {
  return String(pickFirst(row, keys, fallback) || fallback);
}

export function invoiceNumber(row: AnyRow) {
  return rowText(row, ["invoice_number", "invoice_no", "invoice_id", "number", "id"], "-");
}

export function invoiceBranch(row: AnyRow) {
  return rowText(row, ["branch", "branch_name", "store", "pharmacy_branch"], "-");
}

export function invoiceCustomerCode(row: AnyRow) {
  return rowText(row, ["customer_code", "client_code", "code"], "");
}

export function invoiceCustomerPhone(row: AnyRow) {
  return rowText(row, ["customer_phone", "phone", "mobile", "client_phone"], "");
}

export function isDateInsideCurrentCycle(dateValue?: string | null) {
  if (!dateValue) return false;
  const d = new Date(dateValue);
  const cycle = getCurrentCycle();
  return !Number.isNaN(d.getTime()) && d >= cycle.start && d <= cycle.end;
}

export function monthCycleKey(dateValue?: string | null) {
  const d = dateValue ? new Date(dateValue) : new Date();
  const cycle = getCycleForDate(Number.isNaN(d.getTime()) ? new Date() : d);
  return cycle.label;
}

export function matchStaffInvoice(invoice: AnyRow, staff: AnyRow) {
  const staffName = String(staff.name || "");
  const normalizedStaff = normalizeArabicName(staffName);
  const candidates = [
    getInvoiceDoctor(invoice),
    rowText(invoice, ["seller_name", "seller", "doctor_name", "doctor", "pharmacist", "staff_name", "employee_name", "salesperson", "created_by"], ""),
  ].map(normalizeArabicName).filter(Boolean);
  return Boolean(normalizedStaff && candidates.some((candidate) => candidate === normalizedStaff || candidate.includes(normalizedStaff) || normalizedStaff.includes(candidate)));
}

export function matchStaffName(row: AnyRow, staff: AnyRow, keys: string[]) {
  const normalizedStaff = normalizeArabicName(String(staff.name || ""));
  const values = keys.map((key) => normalizeArabicName(String(row[key] || ""))).filter(Boolean);
  return Boolean(normalizedStaff && values.some((value) => value === normalizedStaff || value.includes(normalizedStaff) || normalizedStaff.includes(value)));
}

export function getTransactionSignedPoints(row: AnyRow) {
  const explicit = Number(row.points_delta);
  if (Number.isFinite(explicit) && explicit !== 0) return explicit;
  const points = Math.abs(toNumber(row.points ?? row.amount, 0));
  const type = String(row.type || "").toLowerCase();
  if (type.includes("reward") || type.includes("bonus") || String(row.type || "").includes("مكاف")) return points;
  if (type.includes("penalty") || type.includes("deduction") || String(row.type || "").includes("خصم") || String(row.type || "").includes("جزاء")) return -points;
  return points;
}

export function computeStaffPerformance2027(args: {
  staff: AnyRow;
  invoices: AnyRow[];
  transactions?: AnyRow[];
  followups?: AnyRow[];
  listSales?: AnyRow[];
  stagnantDispenses?: AnyRow[];
}): StaffPerformance2027 {
  const cycle = getCurrentCycle();
  const staff = args.staff;
  const normalizedName = normalizeArabicName(String(staff.name || ""));
  const invoices = (args.invoices || [])
    .filter((invoice) => isDateInsideCurrentCycle(getInvoiceDate(invoice)))
    .filter((invoice) => matchStaffInvoice(invoice, staff));
  const totalSales = invoices.reduce((sum, invoice) => sum + getInvoiceAmount(invoice), 0);
  const byCustomer = new Map<string, { name: string; sales: number; invoices: number; lastPurchase: string }>();
  invoices.forEach((invoice) => {
    const customerName = getInvoiceCustomer(invoice) || "عميل غير محدد";
    const date = getInvoiceDate(invoice);
    const previous = byCustomer.get(customerName) || { name: customerName, sales: 0, invoices: 0, lastPurchase: "" };
    previous.sales += getInvoiceAmount(invoice);
    previous.invoices += 1;
    if (!previous.lastPurchase || new Date(date) > new Date(previous.lastPurchase)) previous.lastPurchase = date;
    byCustomer.set(customerName, previous);
  });
  const topCustomers = [...byCustomer.values()]
    .map((item) => ({ ...item, avg: item.sales / Math.max(1, item.invoices) }))
    .sort((a, b) => b.sales - a.sales)
    .slice(0, 8);
  const biggestInvoices = [...invoices]
    .sort((a, b) => getInvoiceAmount(b) - getInvoiceAmount(a))
    .slice(0, 8)
    .map((invoice) => ({
      invoiceNumber: invoiceNumber(invoice),
      customerName: getInvoiceCustomer(invoice),
      date: getInvoiceDate(invoice),
      amount: getInvoiceAmount(invoice),
      branch: invoiceBranch(invoice),
    }));
  const staffId = String(staff.id || "");
  const monthlyTransactions = (args.transactions || []).filter((row) => {
    const status = String(row.status || "approved");
    const date = row.transaction_date || row.created_at;
    return (status === RECORD_STATUS.APPROVED || status === "active" || status === "") && String(row.staff_id || row.employee_id || "") === staffId && isDateInsideCurrentCycle(String(date || ""));
  });
  const signed = monthlyTransactions.map(getTransactionSignedPoints);
  const rewardPoints = signed.filter((n) => n > 0).reduce((a, b) => a + b, 0);
  const penaltyPoints = Math.abs(signed.filter((n) => n < 0).reduce((a, b) => a + b, 0));
  const followups = (args.followups || []).filter((row) => {
    const date = row.followup_date || row.created_at || row.updated_at;
    return isDateInsideCurrentCycle(String(date || "")) && (
      String(row.assigned_to_id || row.staff_id || row.doctor_id || "") === staffId ||
      matchStaffName(row, staff, ["assigned_to", "doctor_name", "staff_name", "created_by"])
    );
  });
  const completedFollowups = followups.filter((row) => !["pending", "معلق", "open", ""].includes(String(row.status || ""))).length;
  const listSales = (args.listSales || []).filter((row) => String(row.doctor_id || row.staff_id || "") === staffId || matchStaffName(row, staff, ["doctor_name", "responsible_doctor", "staff_name"]));
  const stagnantDispenses = (args.stagnantDispenses || []).filter((row) => String(row.doctor_id || row.staff_id || "") === staffId || matchStaffName(row, staff, ["doctor_name", "responsible_doctor_name", "staff_name"]));
  const warnings: string[] = [];
  if (!invoices.length) warnings.push("لا توجد فواتير مرتبطة بهذا الموظف داخل الدورة الحالية. راجع اسم الدكتور في ملف الفواتير أو ربط staff.id.");
  if (followups.length && completedFollowups / Math.max(1, followups.length) < 0.6) warnings.push("نسبة إغلاق المتابعات أقل من 60% داخل الدورة الحالية.");
  if (penaltyPoints >= 80) warnings.push("الخصومات مرتفعة وتحتاج مراجعة إدارية أو تدريب.");
  return {
    name: String(staff.name || ""),
    normalizedName,
    cycleLabel: cycle.label,
    invoices,
    invoiceCount: invoices.length,
    totalSales,
    avgInvoice: invoices.length ? totalSales / invoices.length : 0,
    uniqueCustomers: byCustomer.size,
    topCustomers,
    biggestInvoices,
    monthlyTransactions,
    penaltyPoints,
    rewardPoints,
    followups,
    followupCount: followups.length,
    completedFollowups,
    listSales,
    stagnantDispenses,
    warnings,
  };
}

export function parseCustomerFlags(notes?: string | null, rawFlags?: unknown): string[] {
  if (Array.isArray(rawFlags)) return rawFlags.map(String).filter(Boolean);
  if (typeof rawFlags === "string" && rawFlags.trim().startsWith("[")) {
    try { return JSON.parse(rawFlags).map(String).filter(Boolean); } catch { /* ignore */ }
  }
  const text = String(notes || "");
  const flagsLine = text.split("\n").find((line) => line.startsWith("FLAGS:"));
  if (!flagsLine) return [];
  return flagsLine.replace("FLAGS:", "").split("|").map((x) => x.trim()).filter(Boolean);
}

export function mergeFlagsIntoNotes(notes: string, flags: string[]) {
  const body = String(notes || "").split("\n").filter((line) => !line.startsWith("FLAGS:")).join("\n").trim();
  const flagsLine = flags.length ? `FLAGS:${flags.join("|")}` : "";
  return [body, flagsLine].filter(Boolean).join("\n");
}

export function performanceRecommendation(perf: StaffPerformance2027) {
  const lines: string[] = [];
  if (perf.avgInvoice > 0) lines.push(`متوسط الفاتورة الحالي ${formatMoney(perf.avgInvoice)}؛ راجع فرص رفع المتوسط بدون ضغط على العميل.`);
  if (perf.topCustomers[0]) lines.push(`أهم عميل بالقيمة: ${perf.topCustomers[0].name} بإجمالي ${formatMoney(perf.topCustomers[0].sales)}.`);
  if (perf.followupCount) lines.push(`إغلاق المتابعات: ${perf.completedFollowups}/${perf.followupCount}.`);
  if (perf.stagnantDispenses.length === 0) lines.push("لا توجد عمليات رواكد مسجلة لهذا الموظف في الدورة؛ راجع توزيع الرواكد واللستة.");
  return lines;
}
