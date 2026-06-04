export const LOGO_URL = "https://cdn-ai.onspace.ai/onspace/files/bJpq2SmLcxwsabN49gg2cM/icon-512.png";
export const FULL_LOGO_URL = "/dawaa-logo-full.jpeg";

export const BRANCHES = ["فرع شكري", "فرع الشامي"] as const;
export type Branch = typeof BRANCHES[number];

export const ROLES = ["أدمن", "مدير فرع", "صيدلاني", "مساعد", "توصيل", "خدمة عملاء"] as const;
export type Role = typeof ROLES[number];

export const CUSTOMER_TYPES = ["عادي", "متوسط", "مهم", "مهم جدًا"] as const;
export type CustomerType = typeof CUSTOMER_TYPES[number];

export const FOLLOWUP_STATUSES = ["معلق", "تم التواصل", "مهتم", "VIP", "شكوى", "رقم خاطئ"] as const;
export type FollowupStatus = typeof FOLLOWUP_STATUSES[number];

export const ORDER_STATUSES = ["قيد التحضير", "في الطريق", "تم التسليم", "مرتجع"] as const;
export type OrderStatus = typeof ORDER_STATUSES[number];

export const POINT_REASONS = [
  "تأخر في الحضور",
  "دواء خاطئ",
  "شكوى عميل",
  "بيع ممتاز",
  "تعاون الفريق",
  "تقييم إيجابي",
  "خطأ في الفاتورة",
  "مبادرة شخصية",
  "التزام بالزي",
  "حضور مبكر",
] as const;

export { STARTING_POINTS as INITIAL_POINTS } from "@/lib/points";

export const DAYS_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

export const ARABIC_MONTHS = [
  "يناير","فبراير","مارس","إبريل","مايو","يونيو",
  "يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر",
];

export const APP_2027_NAME = "Dawaa Pharmacy 2027";
export const APP_2027_TAGLINE = "نظام تشغيل الصيدلية الذكي";

// ─── ثوابت تصنيف العملاء ────────────────────────────────────────────────────
// استخدم هذه القيم في كل مكان بدلاً من الأرقام الصلبة (hardcoded)
export const CUSTOMER_SEGMENT_THRESHOLDS = {
  /** حد "مهم جدًا" — متوسط شهري أعلى من هذا الرقم */
  VERY_IMPORTANT: 8000,
  /** حد "مهم" — بين IMPORTANT و VERY_IMPORTANT */
  IMPORTANT: 4000,
  /** حد "متوسط" — بين MEDIUM و IMPORTANT */
  MEDIUM: 1500,
} as const;

export const CUSTOMER_RETENTION_DAYS = {
  /** عدد أيام عدم الشراء لاعتبار العميل "نشط" */
  ACTIVE: 45,
  /** عدد أيام عدم الشراء لاعتبار العميل "مهدد بالتوقف" */
  AT_RISK: 90,
  /** عدد أيام من أول شراء لاعتبار العميل "جديد" */
  NEW: 30,
} as const;

// ─── ثوابت حالات السجلات ─────────────────────────────────────────────────────
/** حالات سجلات النقاط والجزاءات والحوافز — استخدم دائماً هذه القيم */
export const RECORD_STATUS = {
  APPROVED: "approved",
  PENDING: "pending",
  REJECTED: "rejected",
} as const;
export type RecordStatus = typeof RECORD_STATUS[keyof typeof RECORD_STATUS];

// ─── ثوابت البحث ─────────────────────────────────────────────────────────────
export const SEARCH_DEBOUNCE_MS = 750;
export const DEFAULT_PAGE_SIZE = 30;
export const MAX_PAGE_SIZE = 100;
