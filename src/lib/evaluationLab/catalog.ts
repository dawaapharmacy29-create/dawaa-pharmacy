import type { CanonicalStaffRole } from '@/lib/staff/staffRoleCapabilities';

// Evaluation Lab v6 (trial, read-only). See docs/EVALUATION_LAB_V6_DESIGN.md.

export type LabFamily = 'doctor' | 'assistant' | 'delivery' | 'branch_manager' | 'branches_manager';

/** v6.0 is kept so the lab can show what each change moved; v6.1 is the proposal under review. */
/** Each version keeps every rule of the one before it; the lab shows the change against the previous one. */
export type LabVersion = 'v6.0' | 'v6.1' | 'v6.2' | 'v6.3' | 'v6.4' | 'v6.5';
export const LAB_CURRENT_VERSION: LabVersion = 'v6.5';
export const LAB_PREVIOUS_VERSION: Record<LabVersion, LabVersion | null> = { 'v6.0': null, 'v6.1': 'v6.0', 'v6.2': 'v6.1', 'v6.3': 'v6.2', 'v6.4': 'v6.3', 'v6.5': 'v6.4' };
export const LAB_VERSION_ORDER: LabVersion[] = ['v6.0', 'v6.1', 'v6.2', 'v6.3', 'v6.4', 'v6.5'];

export type LabAxisKey =
  | 'sales_per_day'
  | 'invoice_share'
  | 'avg_invoice'
  | 'basket_items'
  | 'coding_quality'
  | 'conversation_quality'
  | 'discipline'
  | 'customer_requests'
  | 'request_capture'
  | 'followups'
  | 'purchase_entry'
  | 'assistant_checklist'
  | 'deliveries_per_day'
  | 'delivery_rating'
  | 'branch_target'
  | 'team_discipline'
  | 'team_conversations'
  | 'team_quality'
  | 'team_followup'
  | 'branch_coding'
  | 'requests_closure'
  | 'requests_fulfilled'
  | 'customers_growth'
  | 'avg_invoice_growth'
  | 'team_capture'
  | 'team_evaluations'
  | 'purchase_review'
  | 'inventory_counts'
  | 'fast_movers'
  | 'stagnant_expiry'
  | 'shortages'
  | 'standards_submissions'
  | 'standards_audit'
  | 'discount_policy'
  | 'agenda_closure'
  | 'team_violations'
  | 'branches_scorecard'
  | 'request_data_quality'
  | 'cs_followups'
  | 'complaints'
  | 'org_evaluations'
  | 'audits'
  | 'bm_trend'
  | 'decision_backlog'
  | 'branch_managers';

/** Scorecard pillars (v6.5): the branch manager owns the whole branch, the branches manager the system. */
export type LabPillar =
  | 'sales' | 'customers' | 'team' | 'inventory' | 'standards' | 'compliance'
  | 'branches' | 'customer_service' | 'purchasing' | 'oversight';

export const LAB_PILLAR_LABELS: Record<LabPillar, string> = {
  sales: 'المبيعات والنمو',
  customers: 'العملاء والطلبات',
  team: 'الفريق والانضباط',
  inventory: 'المخزون والمشتريات',
  standards: 'البيئة والمعايير (النظافة والرص)',
  compliance: 'الالتزام وجودة الشغل',
  branches: 'أداء الفروع',
  customer_service: 'أداء خدمة العملاء',
  purchasing: 'أداء المشتريات',
  oversight: 'جودة الإشراف',
};

export interface LabAxisDefinition {
  key: LabAxisKey;
  label: string;
  pillar?: LabPillar;
  /** 0 = shown for information (dormant source, gate, or ownership not agreed), never weighted. */
  weight: number;
}

export const LAB_FAMILY_LABELS: Record<LabFamily, string> = {
  doctor: 'الصيادلة',
  assistant: 'المساعدون',
  delivery: 'الدليفري',
  branch_manager: 'مديرو الفروع',
  branches_manager: 'مدير الفروع',
};

const V60: Record<LabFamily, LabAxisDefinition[]> = {
  doctor: [
    { key: 'sales_per_day', label: 'نصيب المبيعات في أيام العمل', weight: 30 },
    { key: 'discipline', label: 'الانضباط', weight: 25 },
    { key: 'conversation_quality', label: 'جودة المحادثات', weight: 20 },
    { key: 'customer_requests', label: 'تسجيل طلبات العملاء', weight: 15 },
    { key: 'coding_quality', label: 'تكويد الفواتير', weight: 10 },
    { key: 'followups', label: 'متابعة العملاء', weight: 0 },
  ],
  assistant: [
    { key: 'discipline', label: 'الانضباط', weight: 50 },
    { key: 'purchase_entry', label: 'إدخال فواتير المشتريات', weight: 30 },
    { key: 'customer_requests', label: 'تسجيل طلبات العملاء', weight: 20 },
  ],
  delivery: [
    { key: 'discipline', label: 'الانضباط', weight: 50 },
    { key: 'deliveries_per_day', label: 'التوصيلات لكل يوم عمل', weight: 50 },
  ],
  branch_manager: [
    { key: 'branch_target', label: 'تحقيق تارجت الفرع', weight: 30 },
    { key: 'requests_closure', label: 'إغلاق طلبات العملاء', weight: 25 },
    { key: 'team_discipline', label: 'انضباط الفريق', weight: 20 },
    { key: 'team_conversations', label: 'جودة محادثات الفريق', weight: 15 },
    { key: 'branch_coding', label: 'تكويد فواتير الفرع', weight: 10 },
  ],
  branches_manager: [
    { key: 'branch_target', label: 'تحقيق تارجت الفرعين', weight: 35 },
    { key: 'branch_managers', label: 'أداء مديري الفروع', weight: 25 },
    { key: 'requests_closure', label: 'إغلاق طلبات العملاء', weight: 25 },
    { key: 'team_discipline', label: 'انضباط الفرق', weight: 15 },
  ],
};

// v6.1 (owner review 2026-10-28): saturated rates become gates, counts only valid records,
// fair share for couriers, branch-manager follow-up of the team's missing punches.
const V61: Record<LabFamily, LabAxisDefinition[]> = {
  doctor: [
    { key: 'sales_per_day', label: 'نصيب المبيعات في أيام العمل', weight: 30 },
    { key: 'discipline', label: 'الانضباط والبصمات', weight: 25 },
    { key: 'conversation_quality', label: 'جودة المحادثات', weight: 20 },
    { key: 'customer_requests', label: 'طلبات العملاء الصالحة', weight: 15 },
    { key: 'coding_quality', label: 'تكويد الفواتير (حد أدنى)', weight: 0 },
    { key: 'followups', label: 'متابعة العملاء', weight: 0 },
  ],
  assistant: [
    { key: 'discipline', label: 'الانضباط والبصمات', weight: 40 },
    { key: 'assistant_checklist', label: 'قائمة المهام اليومية', weight: 35 },
    { key: 'purchase_entry', label: 'إدخال فواتير المشتريات', weight: 25 },
  ],
  delivery: [
    { key: 'discipline', label: 'الانضباط والبصمات', weight: 40 },
    { key: 'deliveries_per_day', label: 'نصيب التوصيلات في أيام العمل', weight: 45 },
    { key: 'delivery_rating', label: 'تقييم العملاء للتوصيل', weight: 15 },
  ],
  branch_manager: [
    { key: 'branch_target', label: 'تحقيق تارجت الفرع', weight: 30 },
    { key: 'requests_closure', label: 'تنفيذ وإغلاق طلبات العملاء', weight: 25 },
    { key: 'team_discipline', label: 'انضباط الفريق', weight: 15 },
    { key: 'team_followup', label: 'متابعة بصمات الفريق', weight: 15 },
    { key: 'team_quality', label: 'جودة الفريق (محادثات وتكويد)', weight: 15 },
    { key: 'decision_backlog', label: 'قرارات حضور معلّقة في الفرع', weight: 0 },
  ],
  branches_manager: [
    { key: 'branch_target', label: 'تحقيق تارجت الفرعين', weight: 35 },
    { key: 'branch_managers', label: 'أداء مديري الفروع', weight: 25 },
    { key: 'requests_closure', label: 'تنفيذ وإغلاق طلبات العملاء', weight: 25 },
    { key: 'team_discipline', label: 'انضباط الفرق', weight: 15 },
    { key: 'decision_backlog', label: 'قرارات حضور معلّقة', weight: 0 },
  ],
};

// v6.2 (owner focus 2026-10-28): sales split into value share, customers served, average invoice
// and basket size, each compared with the same branch, day and shift; conversations, requests and
// follow-ups next; punctuality lighter (policy breaches move to the incentive compliance factor).
const V62: Record<LabFamily, LabAxisDefinition[]> = {
  ...V61,
  doctor: [
    { key: 'sales_per_day', label: 'نصيب المبيعات', weight: 15 },
    { key: 'invoice_share', label: 'نصيب عدد الفواتير (عملاء خدمهم)', weight: 10 },
    { key: 'avg_invoice', label: 'متوسط الفاتورة مقابل الفرع والشيفت', weight: 10 },
    { key: 'basket_items', label: 'الأصناف في الفاتورة مقابل الفرع والشيفت', weight: 5 },
    { key: 'conversation_quality', label: 'جودة المحادثات', weight: 20 },
    { key: 'customer_requests', label: 'طلبات العملاء الصالحة', weight: 15 },
    { key: 'followups', label: 'متابعات العملاء', weight: 15 },
    { key: 'discipline', label: 'الانضباط والبصمات', weight: 10 },
    { key: 'coding_quality', label: 'تكويد الفواتير (حد أدنى)', weight: 0 },
  ],
};

// v6.3 (owner decision 2026-10-29): customer requests are measured by completeness, not volume —
// the share of the requests the Master Brain found in the doctor's WhatsApp conversations that the
// doctor had already recorded. The request count stays visible for information.
const V63: Record<LabFamily, LabAxisDefinition[]> = {
  ...V62,
  doctor: V62.doctor.flatMap((axis) => axis.key === 'customer_requests'
    ? [
      { key: 'request_capture', label: 'نسبة تسجيل الطلبات (العقل المدبر)', weight: 15 },
      { key: 'customer_requests', label: 'عدد طلبات العملاء الصالحة', weight: 0 },
    ]
    : [axis]),
};

// v6.4 (owner decision 2026-10-29): execution is proven by the sale, not by a status. Part of the
// request-closure weight moves to the share of requests the customer actually bought.
const withFulfillment = (axes: LabAxisDefinition[]) => axes.flatMap((axis) => axis.key === 'requests_closure'
  ? [
    { ...axis, weight: 15 },
    { key: 'requests_fulfilled' as const, label: 'تنفيذ فعلي بفاتورة (العميل اشترى الصنف)', weight: 10 },
  ]
  : [axis]);
const V64: Record<LabFamily, LabAxisDefinition[]> = {
  ...V63,
  branch_manager: withFulfillment(V63.branch_manager),
  branches_manager: withFulfillment(V63.branches_manager),
};

// v6.5 (owner decision 2026-10-29): the branch manager is accountable for the whole branch, so the
// evaluation is the branch scorecard; the branches manager owns the branches, customer service,
// purchasing and the quality of supervision. Axes without data yet are shown "not measurable"
// with their reason and their weight is redistributed (never a zero).
const ax = (pillar: LabPillar, key: LabAxisKey, label: string, weight: number): LabAxisDefinition => ({ key, label, weight, pillar });
const V65: Record<LabFamily, LabAxisDefinition[]> = {
  ...V64,
  branch_manager: [
    ax('sales', 'branch_target', 'تحقيق تارجت الفرع', 15),
    ax('sales', 'customers_growth', 'عدد العملاء المخدومين مقابل الدورة السابقة', 5),
    ax('sales', 'avg_invoice_growth', 'متوسط فاتورة الفرع مقابل الدورة السابقة', 5),
    ax('customers', 'branch_coding', 'تكويد العملاء على فواتير الفرع', 7),
    ax('customers', 'requests_closure', 'سرعة تنفيذ طلبات العملاء', 5),
    ax('customers', 'requests_fulfilled', 'تنفيذ فعلي بفاتورة (العميل اشترى الصنف)', 5),
    ax('customers', 'team_capture', 'تسجيل الفريق لطلبات الواتساب (العقل المدبر)', 3),
    ax('team', 'team_discipline', 'انضباط مواعيد الفريق', 5),
    ax('team', 'team_followup', 'متابعة بصمات الفريق', 3),
    ax('team', 'team_evaluations', 'تقييمات الفريق الشهرية اتبعتت', 4),
    ax('team', 'team_conversations', 'جودة محادثات الفريق', 3),
    ax('team', 'decision_backlog', 'قرارات حضور معلّقة في الفرع', 0),
    ax('inventory', 'purchase_review', 'مراجعة ومطابقة فواتير الشراء', 5),
    ax('inventory', 'inventory_counts', 'دقة الجرد الدوري', 5),
    ax('inventory', 'fast_movers', 'الأصناف السريعة اللي خلصت من الفرع', 4),
    ax('inventory', 'stagnant_expiry', 'تصريف الرواكد قبل الصلاحية', 3),
    ax('inventory', 'shortages', 'النواقص اللي اتسجلت واتحلت', 3),
    ax('standards', 'standards_submissions', 'تسليم صور الافتتاح والقفل وتقييم المناطق', 6),
    ax('standards', 'standards_audit', 'نتيجة مراجعة مدير الفروع بالعينة', 4),
    ax('compliance', 'discount_policy', 'الخصومات في حدود السياسة', 4),
    ax('compliance', 'agenda_closure', 'قفل أجندة الاستثناءات في وقتها', 4),
    ax('compliance', 'team_violations', 'تجاوز سماح البصمات في الفريق', 2),
  ],
  branches_manager: [
    ax('branches', 'branches_scorecard', 'بطاقات الفروع (مرجّحة بالمبيعات)', 40),
    ax('customer_service', 'requests_closure', 'سرعة توفير وتنفيذ طلبات العملاء', 8),
    ax('customer_service', 'request_data_quality', 'جودة بيانات العميل في الطلبات', 6),
    ax('customer_service', 'cs_followups', 'تنفيذ متابعات خدمة العملاء', 3),
    ax('customer_service', 'complaints', 'حل الشكاوى', 3),
    ax('purchasing', 'purchase_review', 'مراجعة ومطابقة فواتير الشراء', 8),
    ax('purchasing', 'requests_fulfilled', 'التنفيذ الفعلي لطلبات الفرعين', 6),
    ax('purchasing', 'fast_movers', 'الأصناف السريعة اللي خلصت', 3),
    ax('purchasing', 'stagnant_expiry', 'قيمة الرواكد وقرب الصلاحية', 3),
    ax('oversight', 'decision_backlog', 'القرارات المعلّقة في المنظومة', 6),
    ax('oversight', 'org_evaluations', 'تقييمات المنظومة الشهرية اتبعتت', 6),
    ax('oversight', 'audits', 'زيارات المراجعة الأسبوعية ومطابقتها', 4),
    ax('oversight', 'bm_trend', 'تطور درجات مديري الفروع', 4),
  ],
};

export const LAB_AXES_BY_VERSION: Record<LabVersion, Record<LabFamily, LabAxisDefinition[]>> = { 'v6.0': V60, 'v6.1': V61, 'v6.2': V62, 'v6.3': V63, 'v6.4': V64, 'v6.5': V65 };
export const LAB_AXES = LAB_AXES_BY_VERSION[LAB_CURRENT_VERSION];

export function labFamilyOf(role: CanonicalStaffRole): LabFamily | null {
  if (role === 'doctor' || role === 'assistant' || role === 'delivery' || role === 'branch_manager' || role === 'branches_manager') return role;
  return null;
}

/** Measurability thresholds (design §3). */
export const LAB_THRESHOLDS = {
  minWorkedDays: 5,
  minResolvedDays: 8,
  minInvoicesForCoding: 30,
  minOfficialReviews: 3,
  minPeersForPercentile: 3,
  reviewShrinkK: 5,
  readyCoverage: 0.7,
  partialCoverage: 0.4,
  /** Fair share of branch sales (and deliveries): 0.4 → 0, 1.0 → 50, 1.6 → 100. */
  fairShareFloor: 0.4,
  fairShareCeiling: 1.6,
  /** Coding gate (v6.1): no credit above the floor, 2 points off per point below it, at most 10. */
  codingGateFloor: 0.95,
  codingGatePointsPerPercent: 2,
  codingGateMaxPenalty: 10,
  /**
   * Delivery evidence gate (v6.1): a branch's deliveries are scored only when it writes a courier
   * name on enough invoices and those names resolve to couriers; otherwise the axis measures the
   * recording, not the courier.
   */
  minCourierLabelShare: 0.25,
  minCourierLabelResolved: 0.8,
  /** v6.2 basket metrics: ratio to the same branch/day/shift average. 0.7 → 0, 1.0 → 50, 1.3 → 100. */
  minInvoicesForBasket: 30,
  avgInvoiceFloor: 0.7,
  avgInvoiceCeiling: 1.3,
  /** Items per invoice move less: 0.85 → 0, 1.0 → 50, 1.15 → 100. */
  basketFloor: 0.85,
  basketCeiling: 1.15,
  /**
   * v6.3 request capture: at least N requests found by the Master Brain in the cycle; a request
   * counts as self-recorded when the doctor recorded it from 2 h before the conversation started
   * up to 48 h after it ended. 70% → 0, 95% → 100 (the owner's full-incentive line).
   */
  minDetectedRequests: 5,
  captureLeadHours: 2,
  captureWindowHours: 48,
  captureFloor: 0.7,
  captureCeiling: 0.95,
  /** v6.4 fulfilment proven by an invoice (partial = half). Calibrated on cycle 2026-09-26 → 10-25: 20% overall (lower bound: free-text names), 10% → 0, 60% → 100. */
  minJudgedRequests: 10,
  fulfillmentFloor: 0.1,
  fulfillmentCeiling: 0.6,
  /** v6.5 growth bands: invoices 0.85 → 0, 1.15 → 100; average invoice 0.9 → 0, 1.1 → 100. */
  customersGrowthFloor: 0.85,
  customersGrowthCeiling: 1.15,
  avgInvoiceGrowthFloor: 0.9,
  avgInvoiceGrowthCeiling: 1.1,
  /** Purchase invoices reviewed: measurable from 20 invoices in the cycle. */
  minPurchaseInvoices: 20,
  /** Request customer data (code or 8+ digit phone): 70% → 0, 100% → 100. */
  requestDataFloor: 0.7,
  /** Missing punches above the allowance per employee (attendance policy: 2 per cycle). */
  missingPunchAllowance: 2,
  /** Team follow-up of missing punches (v6.1): 85% corrected → 0, 100% → 100. */
  followupFloor: 0.85,
} as const;

/** Attendance statuses that are still waiting for a decision: shown, never scored. */
export const UNRESOLVED_ATTENDANCE = /^(.*_review|missing_checkin|missing_checkout|invalid_schedule_time)$/;
/** v6.1: a punch the employee never corrected is the employee's own miss (zero credit that day). */
export const MISSING_PUNCH = /^(missing_checkin|missing_checkout)$/;
/** Days waiting for a manager/administration decision. */
export const PENDING_DECISION = /^(.*_review|invalid_schedule_time)$/;
/** Customer requests that do not count for the recording employee. */
export const INVALID_REQUEST_STATUS = /^(cancelled|canceled|duplicate|rejected)$/;
/** Approved absence with a deduction: a real missed shift, zero punctuality credit. */
export const ABSENCE_WITH_DEDUCTION = /absence_deduction/;
/**
 * Days that carry no punctuality signal: no shift, flexible, leave, off day, employment ended.
 * Production uses 60+ resolution statuses (most manager approvals carry real late minutes), so
 * punctuality is read from late_minutes on scheduled days, never from the status name.
 */
export const NON_PUNCTUALITY_ATTENDANCE = /^(off_day|approved_time_off|approved_leave|manager_approved_leave|employment_ended|no_schedule|flexible_.*|time_off_with_events|approved_absence_permission|manager_not_currently_working.*)$/;
/** Cairo shift buckets for invoices (from invoice_datetime): night 0–8, morning 8–16, evening 16–24. */
export function invoiceShiftOf(cairoHour: number): 'ليلي' | 'صباحي' | 'مسائي' {
  return cairoHour < 8 ? 'ليلي' : cairoHour < 16 ? 'صباحي' : 'مسائي';
}

/** Late-minute bands per scheduled day: ≤15 full credit, ≤60 half, beyond 0. */
export const PUNCTUALITY_BANDS = { graceMinutes: 15, halfCreditMinutes: 60 } as const;
