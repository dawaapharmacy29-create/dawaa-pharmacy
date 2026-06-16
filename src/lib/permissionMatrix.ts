import type { User } from "@/types";

export type PermissionScope = "all_branches" | "branch_only" | "own_only" | "assigned_only";

export type RoleKey =
  | "general_manager"
  | "executive_manager"
  | "branches_manager"
  | "procurement_manager"
  | "branch_manager"
  | "customer_service_manager"
  | "customer_service"
  | "shift_supervisor_morning"
  | "shift_supervisor_evening"
  | "pharmacist"
  | "inventory_assistant"
  | "assistant"
  | "cleaning_supervisor"
  | "delivery"
  | string;

export interface PermissionSection {
  key: string;
  label: string;
  permission: string;
}

export interface PagePermissionDefinition {
  path: string;
  pageKey: string;
  label: string;
  viewPermission: string;
  sections: PermissionSection[];
}

export interface RoleScopeDefinition {
  scope: PermissionScope;
  description: string;
}

const LEGACY_PERMISSION_ALIASES: Record<string, string[]> = {
  "dashboard.view": ["view_dashboard", "page.dashboard.view"],
  "customers.view": ["view_customers", "view_customer_service", "page.customers.view"],
  "crm.view": ["page.crm.view", "view_customer_service"],
  "customer_data_review.view": ["page.customer_data_review.view", "view_customer_service"],
  "incubation.view": ["page.incubation.view", "view_customer_service"],
  "customers.create": ["create_customer", "create_followup", "customers.action.create"],
  "customers.edit": ["edit_customer", "edit_followup", "customers.action.edit"],
  "customers.delete": ["delete_customer", "customers.action.delete"],
  "team.view": ["view_team", "page.team.view"],
  "team.create": ["create_team_member", "team.action.create"],
  "team.edit": ["edit_team_member", "team.action.edit"],
  "team.delete": ["disable_team_member", "team.action.disable"],
  "shifts.view": ["view_schedule", "view_attendance_leaves", "page.schedule.view"],
  "permissions.view": ["view_staff_accounts", "view_roles_permissions", "manage_user_permissions", "page.staff_accounts.view"],
  "permissions.edit": ["manage_permissions", "manage_user_permissions", "manage_roles", "staff_accounts.action.manage"],
  "points.view": ["view_points_rewards", "view_points", "page.points.view"],
  "points.manage": ["manage_points", "create_reward", "create_deduction", "edit_points_transaction", "points.action.manage"],
  "evaluations.view": ["view_conversation_reviews", "view_shift_performance", "page.reviews.view"],
  "evaluations.create": ["create_conversation_review", "create_shift_evaluation", "reviews.action.create"],
  "reports.view": ["view_analytics_sales", "view_activity_logs", "view_sales_reports", "page.analytics.view"],
  "reports.export": ["export_sales_reports", "export_activity_logs", "export_points_report", "reports.action.export"],
  "settings.view": ["view_settings", "page.settings.view"],
  "settings.edit": ["manage_settings", "settings.action.manage"],
};

export const PAGE_PERMISSION_DEFINITIONS: PagePermissionDefinition[] = [
  {
    path: "/customers",
    pageKey: "customers",
    label: "العملاء",
    viewPermission: "page.customers.view",
    sections: [
      { key: "customer_list", label: "قائمة العملاء", permission: "customers.section.customer_list" },
      { key: "important_customers", label: "العملاء المهمين", permission: "customers.section.important_customers" },
      { key: "customer_details", label: "تفاصيل العميل", permission: "customers.section.customer_details" },
      { key: "customer_followup", label: "متابعة العميل", permission: "customers.section.customer_followup" },
      { key: "whatsapp_contact", label: "واتساب مباشر", permission: "customers.action.whatsapp" },
      { key: "cashback_change", label: "تغيير الكاش باك", permission: "customers.action.cashback_change" },
      { key: "import_customers", label: "استيراد العملاء", permission: "customers.action.import" },
      { key: "export_customers", label: "تصدير العملاء", permission: "customers.action.export" },
      { key: "edit_customer", label: "تعديل بيانات العميل", permission: "customers.action.edit" },
      { key: "delete_customer", label: "حذف عميل", permission: "customers.action.delete" },
    ],
  },
  {
    path: "/customer-service",
    pageKey: "customer_service",
    label: "خدمة العملاء والمتابعات",
    viewPermission: "page.customer_service.view",
    sections: [
      { key: "daily_followups", label: "متابعات اليوم", permission: "customer_service.section.daily_followups" },
      { key: "assigned_followups", label: "المتابعات المسندة", permission: "customer_service.section.assigned_followups" },
      { key: "create_followup", label: "إضافة متابعة", permission: "customer_service.action.create_followup" },
      { key: "complete_followup", label: "إنهاء متابعة", permission: "customer_service.action.complete_followup" },
      { key: "customer_notes", label: "ملاحظات العميل", permission: "customer_service.section.customer_notes" },
      { key: "conversation_review", label: "تقييم محادثة", permission: "customer_service.section.conversation_review" },
      { key: "whatsapp_templates", label: "قوالب واتساب", permission: "customer_service.section.whatsapp_templates" },
    ],
  },
  {
    path: "/customer-data-review",
    pageKey: "customer_data_review",
    label: "مراجعة بيانات العملاء",
    viewPermission: "page.customer_data_review.view",
    sections: [
      { key: "branch_review", label: "مراجعة فروع العملاء", permission: "customer_data_review.section.branch_review" },
      { key: "invalid_phone_review", label: "مراجعة الأرقام غير الصالحة", permission: "customer_data_review.section.invalid_phone_review" },
      { key: "approve_branch", label: "اعتماد تصحيح الفرع", permission: "customer_data_review.action.approve_branch" },
      { key: "ignore_branch", label: "تجاهل تصحيح الفرع", permission: "customer_data_review.action.ignore_branch" },
      { key: "update_phone", label: "تحديث رقم العميل", permission: "customer_data_review.action.update_phone" },
      { key: "all_branches", label: "كل الفروع", permission: "customer_data_review.scope.all_branches" },
    ],
  },
  {
    path: "/crm",
    pageKey: "crm",
    label: "CRM ومتابعة العملاء",
    viewPermission: "page.crm.view",
    sections: [
      { key: "requests_list", label: "قائمة الطلبات", permission: "crm.section.requests_list" },
      { key: "request_details", label: "تفاصيل الطلب", permission: "crm.section.request_details" },
      { key: "timeline", label: "سجل التفاعلات", permission: "crm.section.timeline" },
      { key: "add_note", label: "إضافة متابعة", permission: "crm.action.add_note" },
      { key: "change_status", label: "تغيير الحالة", permission: "crm.action.change_status" },
      { key: "all_branches", label: "كل الفروع", permission: "crm.scope.all_branches" },
    ],
  },

  {
    path: "/incubation",
    pageKey: "incubation",
    label: "مرحلة الدلع",
    viewPermission: "page.incubation.view",
    sections: [
      { key: "branch_top10", label: "أفضل 10 عملاء لكل فرع", permission: "incubation.section.branch_top10" },
      { key: "customer_details", label: "تفاصيل العميل الكاملة", permission: "incubation.section.customer_details" },
      { key: "add_case", label: "إدخال عميل للمرحلة", permission: "incubation.action.add_case" },
      { key: "add_action", label: "تسجيل خطوات المتابعة", permission: "incubation.action.add_action" },
      { key: "voucher_discount", label: "فاوچر وخصم مخصص", permission: "incubation.action.voucher_discount" },
      { key: "measure_after", label: "قياس قبل/بعد المرحلة", permission: "incubation.section.measure_after" },
      { key: "all_branches", label: "كل الفروع", permission: "incubation.scope.all_branches" },
    ],
  },
  {
    path: "/customer-cashback",
    pageKey: "customer_cashback",
    label: "الكاش باك",
    viewPermission: "page.customer_cashback.view",
    sections: [
      { key: "view_balance", label: "عرض الرصيد", permission: "customer_cashback.section.view_balance" },
      { key: "change_percent", label: "تغيير النسبة", permission: "customer_cashback.action.change_percent" },
      { key: "add_credit", label: "إضافة رصيد", permission: "customer_cashback.action.add_credit" },
      { key: "audit", label: "مراجعة السجل", permission: "customer_cashback.section.audit" },
    ],
  },
  {
    path: "/delivery",
    pageKey: "delivery",
    label: "التوصيل",
    viewPermission: "page.delivery.view",
    sections: [
      { key: "my_orders", label: "طلباتي", permission: "delivery.section.my_orders" },
      { key: "branch_orders", label: "طلبات الفرع", permission: "delivery.section.branch_orders" },
      { key: "update_status", label: "تغيير حالة الطلب", permission: "delivery.action.update_status" },
      { key: "ratings", label: "تقييمات الدليفري", permission: "delivery.section.ratings" },
    ],
  },
  {
    path: "/team",
    pageKey: "team",
    label: "الفريق",
    viewPermission: "page.team.view",
    sections: [
      { key: "team_list", label: "قائمة الفريق", permission: "team.section.team_list" },
      { key: "attendance", label: "الحضور والالتزام", permission: "team.section.attendance" },
      { key: "performance", label: "أداء الفريق", permission: "team.section.performance" },
      { key: "accounts_link", label: "ربط الحسابات", permission: "team.action.accounts_link" },
    ],
  },
  {
    path: "/staff-accounts",
    pageKey: "staff_accounts",
    label: "حسابات وصلاحيات",
    viewPermission: "page.staff_accounts.view",
    sections: [
      { key: "accounts", label: "الحسابات", permission: "staff_accounts.section.accounts" },
      { key: "passwords", label: "عرض/تغيير كلمات السر", permission: "staff_accounts.section.passwords" },
      { key: "permissions", label: "تعديل الصلاحيات", permission: "staff_accounts.action.permissions" },
      { key: "audit", label: "سجل تغييرات الصلاحيات", permission: "staff_accounts.section.audit" },
    ],
  },
  {
    path: "/invoices",
    pageKey: "invoices",
    label: "استيراد الفواتير",
    viewPermission: "page.invoices.view",
    sections: [
      { key: "import", label: "استيراد ملف", permission: "invoices.action.import" },
      { key: "review", label: "مراجعة الاستيراد", permission: "invoices.section.review" },
      { key: "repair", label: "إصلاح الربط", permission: "invoices.action.repair" },
    ],
  },
  {
    path: "/analytics",
    pageKey: "analytics",
    label: "التحليلات والمبيعات",
    viewPermission: "page.analytics.view",
    sections: [
      { key: "branch_sales", label: "مبيعات الفرع", permission: "analytics.section.branch_sales" },
      { key: "all_branches", label: "كل الفروع", permission: "analytics.section.all_branches" },
      { key: "export", label: "تصدير التقارير", permission: "analytics.action.export" },
    ],
  },
  {
    path: "/points",
    pageKey: "points",
    label: "النقاط والمكافآت",
    viewPermission: "page.points.view",
    sections: [
      { key: "my_points", label: "نقاطي", permission: "points.section.my_points" },
      { key: "branch_points", label: "نقاط الفرع", permission: "points.section.branch_points" },
      { key: "manage_points", label: "إضافة/خصم نقاط", permission: "points.action.manage" },
      { key: "export", label: "تصدير التقرير", permission: "points.action.export" },
    ],
  },
  {
    path: "/procurement",
    pageKey: "procurement",
    label: "المشتريات",
    viewPermission: "page.procurement.view",
    sections: [
      { key: "suppliers", label: "الموردين", permission: "procurement.section.suppliers" },
      { key: "purchases", label: "فواتير الشراء", permission: "procurement.section.purchases" },
      { key: "returns", label: "المرتجعات", permission: "procurement.section.returns" },
      { key: "payments", label: "الدفعات", permission: "procurement.section.payments" },
    ],
  },
];

const BASE_PERMISSIONS = [
  "page.my_profile.view",
  "my_profile.section.info",
  "my_profile.action.change_password",
];

const LEGACY_PAGE_KEYS: Record<string, string> = {
  "page.dashboard.view": "view_dashboard",
  "page.customers.view": "view_customers",
  "page.customer_service.view": "view_customer_service",
  "page.customer_data_review.view": "view_customer_service",
  "page.crm.view": "view_customer_service",
  "page.incubation.view": "view_customer_service",
  "page.customer_cashback.view": "view_customer_service",
  "page.delivery.view": "view_delivery",
  "page.team.view": "view_team",
  "page.staff_accounts.view": "view_staff_accounts",
  "page.invoices.view": "view_invoice_import",
  "page.analytics.view": "view_analytics_sales",
  "page.points.view": "view_points_rewards",
  "page.reviews.view": "view_conversation_reviews",
  "page.shift_notes.view": "view_dashboard",
  "page.schedule.view": "view_schedule",
  "page.procurement.view": "view_dashboard",
};

function pageWithAllSections(path: string) {
  const page = PAGE_PERMISSION_DEFINITIONS.find((definition) => definition.path === path);
  if (!page) return [];
  return [page.viewPermission, ...page.sections.map((section) => section.permission)];
}

function pickPageSections(path: string, sectionKeys: string[]) {
  const page = PAGE_PERMISSION_DEFINITIONS.find((definition) => definition.path === path);
  if (!page) return [];
  const allowedSections = page.sections
    .filter((section) => sectionKeys.includes(section.key))
    .map((section) => section.permission);
  return [page.viewPermission, ...allowedSections];
}

export const ROLE_SCOPES: Record<string, RoleScopeDefinition> = {
  general_manager: { scope: "all_branches", description: "كل الفروع وكل البيانات" },
  executive_manager: { scope: "all_branches", description: "كل الفروع عدا كلمات السر والصلاحيات الحساسة" },
  branches_manager: { scope: "all_branches", description: "إدارة كل الفروع" },
  procurement_manager: { scope: "all_branches", description: "المشتريات والمخزون والموردين" },
  branch_manager: { scope: "branch_only", description: "بيانات الفرع فقط" },
  customer_service_manager: { scope: "branch_only", description: "إدارة خدمة العملاء والمتابعات داخل الفرع" },
  customer_service: { scope: "assigned_only", description: "العملاء والمتابعات المسندة وخدمة العملاء" },
  shift_supervisor_morning: { scope: "branch_only", description: "صيدلي + مسؤول شيفت صباحي داخل الفرع" },
  shift_supervisor_evening: { scope: "branch_only", description: "صيدلي + مسؤول شيفت مسائي داخل الفرع" },
  pharmacist: { scope: "own_only", description: "بياناته والعملاء المسندين له" },
  inventory_assistant: { scope: "branch_only", description: "رص ومخزون ومشتريات داخل الفرع" },
  assistant: { scope: "own_only", description: "مهام شخصية ومخزون محدود" },
  cleaning_supervisor: { scope: "own_only", description: "مهام النظافة فقط" },
  delivery: { scope: "own_only", description: "طلبات الدليفري الخاصة به" },
};

export const ROLE_PERMISSION_PRESETS: Record<string, string[]> = {
  general_manager: ["*"],
  executive_manager: [
    ...BASE_PERMISSIONS,
    ...pageWithAllSections("/customers"),
    ...pageWithAllSections("/customer-service"),
    ...pageWithAllSections("/customer-data-review"),
    ...pageWithAllSections("/crm"),
    ...pageWithAllSections("/incubation"),
    ...pageWithAllSections("/customer-cashback"),
    ...pageWithAllSections("/delivery"),
    ...pageWithAllSections("/team"),
    ...pageWithAllSections("/analytics"),
    ...pageWithAllSections("/points"),
    ...pageWithAllSections("/invoices"),
    ...pageWithAllSections("/procurement"),
    "page.dashboard.view", "page.schedule.view", "page.shift_notes.view", "page.reviews.view", "page.activity_log.view",
  ],
  branches_manager: [
    ...BASE_PERMISSIONS,
    ...pageWithAllSections("/customers"),
    ...pageWithAllSections("/customer-service"),
    ...pageWithAllSections("/customer-data-review"),
    ...pageWithAllSections("/crm"),
    ...pageWithAllSections("/incubation"),
    ...pageWithAllSections("/customer-cashback"),
    ...pageWithAllSections("/delivery"),
    ...pageWithAllSections("/team"),
    ...pageWithAllSections("/analytics"),
    ...pageWithAllSections("/points"),
    "page.dashboard.view", "page.schedule.view", "page.shift_notes.view", "page.reviews.view", "page.activity_log.view",
  ],
  procurement_manager: [
    ...BASE_PERMISSIONS,
    ...pageWithAllSections("/procurement"),
    "page.dashboard.view", "page.analytics.view", "analytics.section.branch_sales", "analytics.section.all_branches", "page.invoices.view", "invoices.section.review",
  ],
  branch_manager: [
    ...BASE_PERMISSIONS,
    ...pageWithAllSections("/customers"),
    ...pageWithAllSections("/customer-service"),
    ...pickPageSections("/customer-data-review", ["branch_review", "invalid_phone_review", "approve_branch", "ignore_branch", "update_phone"]),
    ...pickPageSections("/crm", ["requests_list", "request_details", "timeline", "add_note", "change_status"]),
    ...pickPageSections("/incubation", ["branch_top10", "customer_details", "add_case", "add_action", "voucher_discount", "measure_after"]),
    ...pickPageSections("/customer-cashback", ["view_balance", "audit"]),
    ...pageWithAllSections("/delivery"),
    ...pageWithAllSections("/team"),
    ...pickPageSections("/analytics", ["branch_sales", "export"]),
    ...pageWithAllSections("/points"),
    "page.dashboard.view", "page.schedule.view", "page.shift_notes.view", "page.reviews.view",
  ],
  customer_service: [
    ...BASE_PERMISSIONS,
    ...pickPageSections("/customers", ["customer_list", "important_customers", "customer_details", "customer_followup", "whatsapp_contact", "edit_customer"]),
    ...pageWithAllSections("/customer-service"),
    ...pickPageSections("/customer-data-review", ["branch_review", "invalid_phone_review", "approve_branch", "ignore_branch", "update_phone"]),
    ...pickPageSections("/customer-cashback", ["view_balance", "audit"]),
    ...pickPageSections("/crm", ["requests_list", "request_details", "timeline", "add_note"]),
    ...pickPageSections("/incubation", ["branch_top10", "customer_details", "add_case", "add_action", "voucher_discount", "measure_after"]),
    "page.reviews.view", "reviews.action.create",
  ],
  customer_service_manager: [
    ...BASE_PERMISSIONS,
    ...pickPageSections("/customers", ["customer_list", "important_customers", "customer_details", "customer_followup", "whatsapp_contact", "edit_customer", "export_customers"]),
    ...pageWithAllSections("/customer-service"),
    ...pickPageSections("/customer-data-review", ["branch_review", "invalid_phone_review", "approve_branch", "ignore_branch", "update_phone"]),
    ...pickPageSections("/customer-cashback", ["view_balance", "audit"]),
    ...pickPageSections("/crm", ["requests_list", "request_details", "timeline", "add_note", "change_status"]),
    ...pickPageSections("/incubation", ["branch_top10", "customer_details", "add_case", "add_action", "voucher_discount", "measure_after"]),
    "page.reviews.view", "reviews.action.create", "reviews.section.conversation_review",
    "page.activity_log.view",
  ],
  pharmacist: [
    ...BASE_PERMISSIONS,
    ...pickPageSections("/customers", ["important_customers", "customer_details", "customer_followup", "whatsapp_contact"]),
    ...pickPageSections("/customer-service", ["assigned_followups", "complete_followup", "customer_notes"]),
    ...pickPageSections("/points", ["my_points"]),
    ...pickPageSections("/crm", ["requests_list", "request_details", "timeline", "add_note"]),
    ...pickPageSections("/incubation", ["branch_top10", "customer_details", "add_action", "measure_after"]),
    "page.dashboard.view", "page.shift_notes.view", "page.reviews.view", "reviews.action.create", "page.stagnant_medicines.view", "page.incentive_medicines.view",
  ],
  shift_supervisor_morning: [],
  shift_supervisor_evening: [],
  delivery: [
    ...BASE_PERMISSIONS,
    ...pickPageSections("/delivery", ["my_orders", "update_status", "ratings"]),
    ...pickPageSections("/points", ["my_points"]),
    "page.shift_notes.view",
  ],
  assistant: [
    ...BASE_PERMISSIONS,
    "page.shift_notes.view", "page.inventory.view", "inventory.section.basic",
  ],
  inventory_assistant: [
    ...BASE_PERMISSIONS,
    ...pageWithAllSections("/procurement"),
    "page.inventory.view", "inventory.section.stock", "inventory.action.update", "page.shift_notes.view",
  ],
  cleaning_supervisor: [
    ...BASE_PERMISSIONS,
    "page.branch_cleaning.view", "branch_cleaning.section.tasks", "branch_cleaning.action.complete", "page.shift_notes.view",
  ],
};

ROLE_PERMISSION_PRESETS.shift_supervisor_morning = Array.from(new Set([
  ...(ROLE_PERMISSION_PRESETS.pharmacist || []),
  "page.schedule.view", "schedule.section.today", "team.section.attendance",
]));
ROLE_PERMISSION_PRESETS.shift_supervisor_evening = Array.from(new Set([
  ...(ROLE_PERMISSION_PRESETS.pharmacist || []),
  "page.schedule.view", "schedule.section.today", "team.section.attendance",
]));

export function normalizeRole(role?: string | null): string {
  const normalized = (role || "").trim();
  const roleMap: Record<string, string> = {
    "مدير عام": "general_manager",
    "المدير العام": "general_manager",
    "أدمن": "general_manager",
    "admin": "general_manager",
    "مدير تنفيذي": "executive_manager",
    "المدير التنفيذي": "executive_manager",
    "مديرة الفروع": "branches_manager",
    "مدير الفروع": "branches_manager",
    "branches_manager": "branches_manager",
    "مدير المشتريات": "procurement_manager",
    "مدير فرع": "branch_manager",
    "مدير خدمة عملاء": "customer_service_manager",
    "مدير خدمة العملاء": "customer_service_manager",
    "مسؤول خدمة العملاء": "customer_service_manager",
    "customer_service_manager": "customer_service_manager",
    "موظف خدمة عملاء": "customer_service",
    "موظف خدمة العملاء": "customer_service",
    "خدمة عملاء": "customer_service",
    "صيدلاني": "pharmacist",
    "صيدلي": "pharmacist",
    "دليفري": "delivery",
    "توصيل": "delivery",
    "مندوب توصيل": "delivery",
    "مندوب": "delivery",
    "delivery": "delivery",
    "مساعد": "assistant",
  };
  return roleMap[normalized] || normalized;
}

export function isAdminRole(role?: string | null): boolean {
  return normalizeRole(role) === "general_manager";
}

export function isPrivilegedRole(role?: string | null): boolean {
  return ["general_manager", "executive_manager", "branches_manager", "branch_manager"].includes(normalizeRole(role));
}

export function isBranchManagerRole(role?: string | null): boolean {
  return normalizeRole(role) === "branch_manager";
}

export function getDefaultPermissionsForRole(role?: string | null): Record<string, boolean> {
  const roleKey = normalizeRole(role);
  const preset = ROLE_PERMISSION_PRESETS[roleKey] || [];
  const permissions: Record<string, boolean> = {};
  if (preset.includes("*")) {
    permissions["*"] = true;
    PAGE_PERMISSION_DEFINITIONS.forEach((page) => {
      permissions[page.viewPermission] = true;
      page.sections.forEach((section) => {
        permissions[section.permission] = true;
      });
    });
  } else {
    preset.forEach((permission) => {
      permissions[permission] = true;
    });
  }

  Object.entries(LEGACY_PAGE_KEYS).forEach(([granular, legacy]) => {
    if (permissions["*"] || permissions[granular]) permissions[legacy] = true;
  });

  return permissions;
}

export function mergePermissionMaps(...maps: Array<Record<string, boolean> | null | undefined>): Record<string, boolean> {
  const merged: Record<string, boolean> = {};
  maps.forEach((map) => {
    Object.entries(map || {}).forEach(([key, value]) => {
      merged[key] = value === true;
    });
  });
  return merged;
}

export function userHasPermission(user: Pick<User, "role" | "permissions"> | null | undefined, permission?: string): boolean {
  if (!permission) return true;
  const role = normalizeRole(user?.role);
  if (isAdminRole(role)) return true;
  const defaultPermissions = getDefaultPermissionsForRole(role);
  const permissions = mergePermissionMaps(defaultPermissions, user?.permissions);
  if (permissions["*"] || permissions[permission]) return true;
  return (LEGACY_PERMISSION_ALIASES[permission] || []).some((alias) => permissions[alias] === true);
}

export function getVisibleSectionsForPath(
  path: string,
  checker: (permission?: string) => boolean,
): PermissionSection[] {
  const page = PAGE_PERMISSION_DEFINITIONS.find((definition) => definition.path === path);
  if (!page) return [];
  return page.sections.filter((section) => checker(section.permission));
}

export function getPermissionScopeForRole(role?: string | null): RoleScopeDefinition {
  return ROLE_SCOPES[normalizeRole(role)] || { scope: "own_only", description: "صلاحيات محدودة" };
}
