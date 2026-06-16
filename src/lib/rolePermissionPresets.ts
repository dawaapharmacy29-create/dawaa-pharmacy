export type PermissionPresetKey =
  | "general_manager"
  | "branch_manager"
  | "customer_service_manager"
  | "doctor"
  | "rider"
  | "inventory_manager";

export interface PermissionPreset {
  key: PermissionPresetKey;
  label: string;
  description: string;
  match: string[];
  permissions: Record<string, boolean>;
}

const baseView = {
  view_dashboard: true,
  view_doctor_dashboard: true,
  view_alerts: true,
  view_activity_log: true,
  view_activity_logs: true,
};

export const PERMISSION_PRESETS: PermissionPreset[] = [
  {
    key: "general_manager",
    label: "مدير عام",
    description: "صلاحيات كاملة تقريبًا لكل الفروع والمراجعات والتقارير.",
    match: ["مدير عام", "admin", "general manager", "كل الفروع"],
    permissions: {
      ...baseView,
      view_dashboard_stats: true,
      manage_alerts: true,
      view_shift_performance: true,
      create_shift_evaluation: true,
      edit_shift_evaluation: true,
      approve_shift_evaluation: true,
      view_customers: true,
      edit_customers: true,
      view_customer_service: true,
      manage_followups: true,
      view_customer_requests: true,
      manage_customer_requests: true,
      view_team: true,
      view_schedule: true,
      manage_schedule: true,
      manage_time_off: true,
      view_points: true,
      manage_points: true,
      approve_points: true,
      view_reviews: true,
      add_reviews: true,
      view_medicines: true,
      manage_medicines: true,
      view_stagnant_medicines: true,
      manage_stagnant_medicines: true,
      view_incentive_medicines: true,
      manage_incentive_medicines: true,
      view_delivery: true,
      view_delivery_reports: true,
      approve_delivery_deduction: true,
      view_analytics: true,
      view_analytics_sales: true,
      view_sales_reports: true,
      export_sales_reports: true,
      view_branch_comparison: true,
      view_invoices: true,
      view_invoice_import: true,
      import_sales_invoices: true,
      review_import_errors: true,
      view_staff_accounts: true,
      create_staff_account: true,
      edit_staff_account: true,
      reset_staff_password: true,
      disable_staff_account: true,
      manage_permissions: true,
      manage_roles: true,
      manage_user_permissions: true,
      view_shortages: true,
      manage_shortages: true,
      view_supplies: true,
      manage_supplies: true,
      view_accessories: true,
      manage_accessories: true,
      view_shelf_organization: true,
      manage_shelf_organization: true,
      view_inventory_counts: true,
      manage_inventory_counts: true,
      view_branch_cleaning: true,
      manage_branch_cleaning: true,
      review_branch_cleaning: true,
      view_training: true,
      manage_training: true,
      view_settings: true,
      manage_settings: true,
      manage_branches: true,
    },
  },
  {
    key: "branch_manager",
    label: "مدير فرع",
    description: "إدارة الفرع: الفريق، الجدول، خدمة العملاء، النقاط والتقارير الخاصة بالفرع.",
    match: ["مدير فرع", "مسؤول فرع", "مدير الشامي", "مدير شكري"],
    permissions: {
      ...baseView,
      view_dashboard_stats: true,
      view_shift_performance: true,
      create_shift_evaluation: true,
      edit_shift_evaluation: true,
      view_customers: true,
      edit_customers: true,
      view_customer_service: true,
      manage_followups: true,
      view_team: true,
      view_schedule: true,
      manage_schedule: true,
      manage_time_off: true,
      view_points: true,
      manage_points: true,
      view_reviews: true,
      add_reviews: true,
      view_medicines: true,
      manage_medicines: true,
      view_stagnant_medicines: true,
      manage_stagnant_medicines: true,
      view_delivery: true,
      view_delivery_reports: true,
      view_analytics: true,
      view_analytics_sales: true,
      view_sales_reports: true,
      view_invoices: true,
      view_invoice_import: true,
      review_import_errors: true,
      view_shortages: true,
      manage_shortages: true,
      view_supplies: true,
      manage_supplies: true,
      view_shelf_organization: true,
      manage_shelf_organization: true,
      view_inventory_counts: true,
      manage_inventory_counts: true,
      view_branch_cleaning: true,
      manage_branch_cleaning: true,
      review_branch_cleaning: true,
      view_training: true,
    },
  },
  {
    key: "customer_service_manager",
    label: "مسؤول خدمة العملاء",
    description: "قائمة المتابعات، العملاء، الواتساب، الطلبات، وتقييم المحادثات.",
    match: ["خدمة العملاء", "مسؤول خدمة", "customer service", "متابعات"],
    permissions: {
      ...baseView,
      view_customers: true,
      edit_customers: true,
      view_customer_service: true,
      manage_followups: true,
      view_customer_requests: true,
      manage_customer_requests: true,
      view_reviews: true,
      add_reviews: true,
      view_whatsapp_analytics: true,
      view_analytics: true,
      view_sales_reports: true,
    },
  },
  {
    key: "doctor",
    label: "صيدلي / دكتور",
    description: "لوحة الدكتور، العملاء المرتبطين، المتابعات، الرواكد واللستة الخاصة به.",
    match: ["صيدلي", "صيدلاني", "دكتور", "doctor", "pharmacist"],
    permissions: {
      view_doctor_dashboard: true,
      view_own_performance: true,
      view_customers: true,
      view_customer_service: true,
      manage_followups: true,
      view_points: true,
      view_reviews: true,
      add_reviews: true,
      view_medicines: true,
      view_stagnant_medicines: true,
      view_incentive_medicines: true,
      dispense_incentive_medicine: true,
      view_schedule: true,
      manage_time_off: true,
    },
  },
  {
    key: "rider",
    label: "دليفري",
    description: "شاشة الدليفري وتسجيل الأوردرات والمشاوير والتنبيهات الخاصة به.",
    match: ["دليفري", "مندوب", "rider", "delivery"],
    permissions: {
      view_delivery: true,
      create_delivery_order: true,
      create_delivery_trip: true,
      view_own_delivery: true,
      manage_time_off: true,
      view_alerts: true,
    },
  },
  {
    key: "inventory_manager",
    label: "مسؤول المخزون والتشغيل",
    description: "الرواكد، اللستة، الجرد، تنظيم الرفوف، النواقص والمستلزمات.",
    match: ["مخزون", "تشغيل", "جرد", "رواكد", "لستة", "مسؤول مخزون"],
    permissions: {
      ...baseView,
      view_medicines: true,
      manage_medicines: true,
      view_stagnant_medicines: true,
      manage_stagnant_medicines: true,
      view_incentive_medicines: true,
      manage_incentive_medicines: true,
      view_shortages: true,
      manage_shortages: true,
      view_supplies: true,
      manage_supplies: true,
      view_accessories: true,
      manage_accessories: true,
      view_shelf_organization: true,
      manage_shelf_organization: true,
      view_inventory_counts: true,
      manage_inventory_counts: true,
      view_branch_cleaning: true,
      manage_branch_cleaning: true,
    },
  },
];

export function normalizeRoleText(value?: string | null) {
  return String(value || "")
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[\u064B-\u065F]/g, "")
    .trim();
}

export function getPresetForRole(role?: string | null): PermissionPreset {
  const normalized = normalizeRoleText(role);
  return (
    PERMISSION_PRESETS.find((preset) =>
      preset.match.some((word) => normalized.includes(normalizeRoleText(word))),
    ) || PERMISSION_PRESETS.find((preset) => preset.key === "doctor")!
  );
}

export function mergePermissionsWithPreset(
  current: Record<string, boolean> | null | undefined,
  preset: PermissionPreset,
  mode: "replace" | "merge" = "merge",
) {
  return mode === "replace"
    ? { ...preset.permissions }
    : { ...(current || {}), ...preset.permissions };
}
