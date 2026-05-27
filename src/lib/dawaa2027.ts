import { getCurrentCycle, getPointsCycle } from "@/lib/pharmacy-cycle";
import { POINT_VALUE_EGP, STARTING_POINTS } from "@/lib/points";

export const DAWAA_2027_NAME = "Dawaa Pharmacy 2027";
export const MONTHLY_START_POINTS_2027 = 500;
export const MONTHLY_INCENTIVE_EGP_2027 = 1500;
export const QUARTERLY_INCENTIVE_EGP_2027 = 2000;
export const QUARTERLY_SCORE_MAX_2027 = 100;

export const monthlyPillars2027 = [
  { key: "customer", label: "خدمة العملاء والمتابعات", points: 200, color: "text-teal-300", description: "جودة التعامل، المتابعة، الشكاوى، ملاحظات العميل، ونجاح إعادة الشراء." },
  { key: "operations", label: "الالتزام والتشغيل", points: 120, color: "text-sky-300", description: "الحضور، الشيفت، التعليمات، التعاون، وإغلاق المهام اليومية." },
  { key: "sales_quality", label: "جودة البيع والتسجيل", points: 70, color: "text-emerald-300", description: "متوسط الفاتورة، التصنيف، دقة بيانات الفاتورة، وعدم إزعاج العميل." },
  { key: "stock", label: "المخزون والرواكد واللستة", points: 70, color: "text-amber-300", description: "تحريك الرواكد، أهداف اللستة، التسجيل بالفاتورة والعميل، وطلبات النواقص." },
  { key: "system", label: "استخدام السيستم والتطوير", points: 40, color: "text-purple-300", description: "الالتزام بالتسجيل، جودة البيانات، المبادرات، وسجل الأنشطة." },
];

export const quarterlyPillars2027 = [
  { key: "sales_growth", label: "إجمالي المبيعات ونموها", points: 25, description: "مبيعات الربع مقارنة بالربع السابق ومتوسط الفرع والفريق." },
  { key: "avg_invoice", label: "متوسط الفاتورة", points: 20, description: "رفع قيمة الفاتورة باحتراف وبدون شكاوى أو ضغط زائد." },
  { key: "customer_value", label: "العملاء المتكررون والمهمون", points: 20, description: "قيمة عملاء الدكتور، الاحتفاظ بالعميل، والعملاء العائدون بعد المتابعة." },
  { key: "list_targets", label: "أدوية اللستة", points: 15, description: "تحقيق تارجت الأصناف المخصصة للدكتور مع تسجيل عميل وفاتورة." },
  { key: "stagnant_stock", label: "الرواكد والمخزون", points: 10, description: "تحريك الرواكد وقرب الانتهاء بدون شكاوى وببيانات صحيحة." },
  { key: "data_quality", label: "جودة التسجيل وخدمة العميل", points: 10, description: "تصنيفات العملاء، الملاحظات، بيانات الهاتف والكود، ونتائج المتابعة." },
];

export const defaultEvaluationRules2027 = [
  { type: "penalty", category: "خدمة العملاء", title: "عدم متابعة عميل VIP في موعده", points: 25, repeatable: true, severity: "medium" },
  { type: "penalty", category: "خدمة العملاء", title: "شكوى عميل بسبب أسلوب التعامل", points: 40, repeatable: true, severity: "high" },
  { type: "penalty", category: "خدمة العملاء", title: "فقد عميل مهم بسبب عدم المتابعة", points: 60, repeatable: true, severity: "high" },
  { type: "penalty", category: "التشغيل", title: "تأخير عن الشيفت بدون إذن", points: 20, repeatable: true, severity: "medium" },
  { type: "penalty", category: "التشغيل", title: "غياب بدون إذن", points: 80, repeatable: true, severity: "critical" },
  { type: "penalty", category: "المخزون", title: "صرف راكد بدون تسجيل عميل وفاتورة", points: 20, repeatable: true, severity: "medium" },
  { type: "penalty", category: "أدوية اللستة", title: "تسجيل صنف لستة بدون بيانات العميل", points: 15, repeatable: true, severity: "medium" },
  { type: "penalty", category: "السلامة الدوائية", title: "خطأ دوائي مؤثر أو ترشيح غير مناسب", points: 100, repeatable: true, severity: "critical" },
  { type: "reward", category: "خدمة العملاء", title: "إعادة عميل مهم للشراء بعد متابعة ناجحة", points: 20, repeatable: false, severity: "positive" },
  { type: "reward", category: "التطوير", title: "اقتراح تحسين تم تطبيقه داخل المنظومة", points: 30, repeatable: false, severity: "positive" },
  { type: "reward", category: "المخزون", title: "تحقيق راكد صعب قبل انتهاء الصلاحية", points: 20, repeatable: false, severity: "positive" },
  { type: "reward", category: "الأداء", title: "دورة كاملة بدون أي خصم", points: 25, repeatable: false, severity: "positive" },
];

export const customerFlagTemplates2027 = [
  "VIP", "مهم جدًا", "لا يضاف له توصيل", "يفضل المستورد", "لا يحب البدائل", "حساس للسعر",
  "يحب الترشيحات", "لا يحب الترشيحات", "عميل أطفال", "عميل روشتات", "عميل مزمن",
  "يحتاج متابعة شهرية", "يحتاج اتصال قبل التوصيل", "يفضل دكتور معين", "كثير الشكاوى",
];

export function normalizeArabicName(value?: string | null) {
  return String(value || "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[\u064B-\u065F]/g, "")
    .replace(/د\s*\/?\s*/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function toNumber(value: unknown, fallback = 0) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : fallback;
}

export function pickFirst(row: Record<string, unknown>, keys: string[], fallback: unknown = "") {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return fallback;
}

export function getInvoiceAmount(row: Record<string, unknown>) {
  // sales_invoices is the source of truth; use net first, then amount, then gross.
  return toNumber(pickFirst(row, ["net_amount", "amount", "gross_amount", "discounted_amount", "invoice_total", "net_total", "total", "value", "invoice_value"], 0));
}

export function getInvoiceDate(row: Record<string, unknown>) {
  return String(pickFirst(row, ["invoice_date", "date", "created_at", "transaction_date"], ""));
}

export function getInvoiceDoctor(row: Record<string, unknown>) {
  return String(pickFirst(row, ["doctor_name", "doctor", "staff_name", "employee_name", "salesperson", "pharmacist", "created_by"], "غير محدد"));
}

export function getInvoiceCustomer(row: Record<string, unknown>) {
  return String(pickFirst(row, ["customer_name", "name", "client_name"], "عميل غير محدد"));
}

export function isInsideCurrentCycle(dateValue?: string | null) {
  if (!dateValue) return false;
  const cycle = getCurrentCycle();
  const d = new Date(dateValue);
  return d >= cycle.start && d <= cycle.end;
}

export function currentCycleText() {
  const c = getCurrentCycle();
  return c.label;
}

export function currentCycleRange() {
  return getPointsCycle(new Date());
}

export function monthlyIncentiveFromPoints(finalPoints: number) {
  const bounded = Math.max(0, Math.min(STARTING_POINTS, finalPoints));
  return Math.round(bounded * POINT_VALUE_EGP);
}

export function quarterlyIncentiveFromScore(score: number) {
  const bounded = Math.max(0, Math.min(QUARTERLY_SCORE_MAX_2027, score));
  return Math.round((bounded / QUARTERLY_SCORE_MAX_2027) * QUARTERLY_INCENTIVE_EGP_2027);
}

export function repeatPenaltyPoints(basePoints: number, previousCount: number) {
  return Math.max(1, previousCount + 1) * basePoints;
}

export function formatMoney(value: number) {
  return `${Math.round(value).toLocaleString("ar-EG")} جنيه`;
}

export function formatNumber(value: number) {
  return Math.round(value).toLocaleString("ar-EG");
}
