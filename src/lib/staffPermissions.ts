/**
 * نظام الصلاحيات والأدوار للموظفين
 * تحديد الصلاحيات والشاشات المتاحة لكل دور
 */

export const STAFF_ROLES = [
  "أدمن",
  "مدير عام",
  "مدير فرع",
  "مدير جودة",
  "مدير خدمة عملاء",
  "صيدلاني",
  "مساعد صيدلاني",
  "مندوب توصيل",
  "موظف خدمة عملاء",
] as const;

export type StaffRole = typeof STAFF_ROLES[number];

/**
 * الصلاحيات المتاحة في النظام
 */
export const PERMISSIONS = {
  // لوحة التحكم والعرض
  VIEW_DASHBOARD: "view_dashboard",
  VIEW_PERSONAL_DASHBOARD: "view_personal_dashboard",

  // إدارة النقاط والخصومات
  VIEW_POINTS: "view_points",
  MANAGE_POINTS: "manage_points",
  APPROVE_POINTS: "approve_points",
  VIEW_POINT_RULES: "view_point_rules",
  MANAGE_POINT_RULES: "manage_point_rules",

  // تقييم المحادثات
  VIEW_REVIEWS: "view_reviews",
  CREATE_REVIEW: "create_review",
  APPROVE_REVIEW: "approve_review",

  // العملاء والمتابعة
  VIEW_CUSTOMERS: "view_customers",
  MANAGE_CUSTOMERS: "manage_customers",
  VIEW_CUSTOMER_NOTES: "view_customer_notes",
  ADD_CUSTOMER_NOTES: "add_customer_notes",

  // الأدوية والمخزون
  VIEW_STOCK: "view_stock",
  VIEW_SLOW_MOVING_DRUGS: "view_slow_moving_drugs",
  MANAGE_SLOW_MOVING_DRUGS: "manage_slow_moving_drugs",
  VIEW_INCENTIVE_DRUGS: "view_incentive_drugs",
  MANAGE_INCENTIVE_DRUGS: "manage_incentive_drugs",

  // المبيعات والفواتير
  VIEW_SALES: "view_sales",
  VIEW_ANALYTICS: "view_analytics",
  IMPORT_INVOICES: "import_invoices",

  // التوصيل
  VIEW_DELIVERY: "view_delivery",
  MANAGE_DELIVERY: "manage_delivery",
  RATE_DELIVERY: "rate_delivery",

  // سجل الأنشطة
  VIEW_ACTIVITY_LOG: "view_activity_log",

  // إدارة الموظفين
  VIEW_TEAM: "view_team",
  MANAGE_TEAM: "manage_team",
  VIEW_TEAM_DETAILS: "view_team_details",

  // الإجازات والحضور
  VIEW_SCHEDULE: "view_schedule",
  MANAGE_SCHEDULE: "manage_schedule",
  REQUEST_TIME_OFF: "request_time_off",
  APPROVE_TIME_OFF: "approve_time_off",
} as const;

/**
 * تعريف الصلاحيات لكل دور
 */
export const ROLE_PERMISSIONS: Record<StaffRole, Set<string>> = {
  أدمن: new Set([
    // عرض كل شيء
    Object.values(PERMISSIONS),
  ].flat()),

  "مدير عام": new Set([
    PERMISSIONS.VIEW_DASHBOARD,
    PERMISSIONS.VIEW_POINTS,
    PERMISSIONS.MANAGE_POINTS,
    PERMISSIONS.APPROVE_POINTS,
    PERMISSIONS.VIEW_POINT_RULES,
    PERMISSIONS.MANAGE_POINT_RULES,
    PERMISSIONS.VIEW_REVIEWS,
    PERMISSIONS.APPROVE_REVIEW,
    PERMISSIONS.VIEW_CUSTOMERS,
    PERMISSIONS.MANAGE_CUSTOMERS,
    PERMISSIONS.VIEW_CUSTOMER_NOTES,
    PERMISSIONS.ADD_CUSTOMER_NOTES,
    PERMISSIONS.VIEW_STOCK,
    PERMISSIONS.VIEW_SLOW_MOVING_DRUGS,
    PERMISSIONS.MANAGE_SLOW_MOVING_DRUGS,
    PERMISSIONS.VIEW_INCENTIVE_DRUGS,
    PERMISSIONS.MANAGE_INCENTIVE_DRUGS,
    PERMISSIONS.VIEW_SALES,
    PERMISSIONS.VIEW_ANALYTICS,
    PERMISSIONS.IMPORT_INVOICES,
    PERMISSIONS.VIEW_DELIVERY,
    PERMISSIONS.MANAGE_DELIVERY,
    PERMISSIONS.RATE_DELIVERY,
    PERMISSIONS.VIEW_ACTIVITY_LOG,
    PERMISSIONS.VIEW_TEAM,
    PERMISSIONS.MANAGE_TEAM,
    PERMISSIONS.VIEW_TEAM_DETAILS,
    PERMISSIONS.VIEW_SCHEDULE,
    PERMISSIONS.MANAGE_SCHEDULE,
    PERMISSIONS.APPROVE_TIME_OFF,
  ]),

  "مدير فرع": new Set([
    PERMISSIONS.VIEW_PERSONAL_DASHBOARD,
    PERMISSIONS.VIEW_POINTS,
    PERMISSIONS.MANAGE_POINTS,
    PERMISSIONS.APPROVE_POINTS,
    PERMISSIONS.VIEW_POINT_RULES,
    PERMISSIONS.VIEW_REVIEWS,
    PERMISSIONS.CREATE_REVIEW,
    PERMISSIONS.VIEW_CUSTOMERS,
    PERMISSIONS.MANAGE_CUSTOMERS,
    PERMISSIONS.VIEW_CUSTOMER_NOTES,
    PERMISSIONS.ADD_CUSTOMER_NOTES,
    PERMISSIONS.VIEW_STOCK,
    PERMISSIONS.VIEW_SLOW_MOVING_DRUGS,
    PERMISSIONS.MANAGE_SLOW_MOVING_DRUGS,
    PERMISSIONS.VIEW_INCENTIVE_DRUGS,
    PERMISSIONS.VIEW_SALES,
    PERMISSIONS.VIEW_ANALYTICS,
    PERMISSIONS.IMPORT_INVOICES,
    PERMISSIONS.VIEW_DELIVERY,
    PERMISSIONS.MANAGE_DELIVERY,
    PERMISSIONS.RATE_DELIVERY,
    PERMISSIONS.VIEW_TEAM,
    PERMISSIONS.VIEW_TEAM_DETAILS,
    PERMISSIONS.VIEW_SCHEDULE,
    PERMISSIONS.MANAGE_SCHEDULE,
  ]),

  "مدير جودة": new Set([
    PERMISSIONS.VIEW_PERSONAL_DASHBOARD,
    PERMISSIONS.VIEW_POINTS,
    PERMISSIONS.VIEW_REVIEWS,
    PERMISSIONS.CREATE_REVIEW,
    PERMISSIONS.APPROVE_REVIEW,
    PERMISSIONS.VIEW_CUSTOMERS,
    PERMISSIONS.VIEW_CUSTOMER_NOTES,
    PERMISSIONS.VIEW_STOCK,
    PERMISSIONS.VIEW_SLOW_MOVING_DRUGS,
    PERMISSIONS.VIEW_SALES,
    PERMISSIONS.VIEW_ANALYTICS,
    PERMISSIONS.VIEW_ACTIVITY_LOG,
    PERMISSIONS.VIEW_TEAM_DETAILS,
  ]),

  "مدير خدمة عملاء": new Set([
    PERMISSIONS.VIEW_PERSONAL_DASHBOARD,
    PERMISSIONS.VIEW_POINTS,
    PERMISSIONS.VIEW_REVIEWS,
    PERMISSIONS.CREATE_REVIEW,
    PERMISSIONS.APPROVE_REVIEW,
    PERMISSIONS.VIEW_CUSTOMERS,
    PERMISSIONS.MANAGE_CUSTOMERS,
    PERMISSIONS.VIEW_CUSTOMER_NOTES,
    PERMISSIONS.ADD_CUSTOMER_NOTES,
    PERMISSIONS.VIEW_SALES,
    PERMISSIONS.VIEW_ANALYTICS,
  ]),

  صيدلاني: new Set([
    PERMISSIONS.VIEW_PERSONAL_DASHBOARD,
    PERMISSIONS.VIEW_CUSTOMERS,
    PERMISSIONS.VIEW_CUSTOMER_NOTES,
    PERMISSIONS.ADD_CUSTOMER_NOTES,
    PERMISSIONS.VIEW_STOCK,
    PERMISSIONS.VIEW_SLOW_MOVING_DRUGS,
    PERMISSIONS.VIEW_INCENTIVE_DRUGS,
    PERMISSIONS.VIEW_SALES,
    PERMISSIONS.REQUEST_TIME_OFF,
  ]),

  "مساعد صيدلاني": new Set([
    PERMISSIONS.VIEW_PERSONAL_DASHBOARD,
    PERMISSIONS.VIEW_CUSTOMERS,
    PERMISSIONS.VIEW_CUSTOMER_NOTES,
    PERMISSIONS.VIEW_STOCK,
    PERMISSIONS.VIEW_SLOW_MOVING_DRUGS,
    PERMISSIONS.VIEW_INCENTIVE_DRUGS,
    PERMISSIONS.REQUEST_TIME_OFF,
  ]),

  "مندوب توصيل": new Set([
    PERMISSIONS.VIEW_PERSONAL_DASHBOARD,
    PERMISSIONS.VIEW_CUSTOMERS,
    PERMISSIONS.VIEW_CUSTOMER_NOTES,
    PERMISSIONS.VIEW_DELIVERY,
    PERMISSIONS.VIEW_SALES,
    PERMISSIONS.REQUEST_TIME_OFF,
  ]),

  "موظف خدمة عملاء": new Set([
    PERMISSIONS.VIEW_PERSONAL_DASHBOARD,
    PERMISSIONS.VIEW_CUSTOMERS,
    PERMISSIONS.VIEW_CUSTOMER_NOTES,
    PERMISSIONS.ADD_CUSTOMER_NOTES,
    PERMISSIONS.VIEW_SALES,
    PERMISSIONS.REQUEST_TIME_OFF,
  ]),
};

/**
 * الشاشات/الصفحات المتاحة لكل دور
 */
export const ROLE_SCREENS: Record<StaffRole, string[]> = {
  أدمن: [
    "/",
    "/customers",
    "/customer-service",
    "/team",
    "/schedule",
    "/points",
    "/reviews",
    "/delivery",
    "/analytics",
    "/invoices",
    "/activity-log",
    "/time-off",
    "/staff-dashboard",
    "/slow-moving-drugs",
    "/incentive-drugs",
    "/customer-notes",
  ],

  "مدير عام": [
    "/",
    "/customers",
    "/customer-service",
    "/team",
    "/schedule",
    "/points",
    "/reviews",
    "/delivery",
    "/analytics",
    "/invoices",
    "/activity-log",
    "/time-off",
    "/slow-moving-drugs",
    "/customer-notes",
  ],

  "مدير فرع": [
    "/",
    "/customers",
    "/customer-service",
    "/schedule",
    "/points",
    "/reviews",
    "/delivery",
    "/analytics",
    "/team",
    "/slow-moving-drugs",
    "/customer-notes",
  ],

  "مدير جودة": [
    "/",
    "/customers",
    "/reviews",
    "/analytics",
    "/customer-notes",
  ],

  "مدير خدمة عملاء": [
    "/",
    "/customers",
    "/customer-service",
    "/reviews",
    "/analytics",
    "/customer-notes",
  ],

  صيدلاني: [
    "/",
    "/customers",
    "/customer-service",
    "/analytics",
    "/time-off",
    "/slow-moving-drugs",
    "/incentive-drugs",
    "/customer-notes",
  ],

  "مساعد صيدلاني": [
    "/",
    "/customers",
    "/customer-service",
    "/time-off",
    "/slow-moving-drugs",
  ],

  "مندوب توصيل": [
    "/",
    "/delivery",
    "/customers",
    "/time-off",
  ],

  "موظف خدمة عملاء": [
    "/",
    "/customers",
    "/customer-service",
    "/time-off",
    "/customer-notes",
  ],
};

/**
 * تحديد من يستطيع اعتماد الخصومات والمكافآت
 */
export const APPROVER_ROLES: Record<string, StaffRole[]> = {
  simple_deduction: ["مدير فرع", "مدير عام"],
  medication_error: ["مدير جودة", "مدير عام"],
  customer_service_issue: ["مدير خدمة عملاء", "مدير عام"],
  delivery_issue: ["مدير فرع", "مدير عام"],
  critical: ["مدير عام"],
};

/**
 * التحقق من امتلاك صلاحية معينة
 */
export function hasPermission(role: StaffRole, permission: string): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  return permissions ? permissions.has(permission) : false;
}

/**
 * التحقق من الوصول إلى شاشة معينة
 */
export function canAccessScreen(role: StaffRole, screen: string): boolean {
  const screens = ROLE_SCREENS[role];
  return screens ? screens.includes(screen) : false;
}

/**
 * الحصول على الأدوار التي يمكنها اعتماد نوع معين من الخصومات
 */
export function getApproverRoles(deductionType: string): StaffRole[] {
  return APPROVER_ROLES[deductionType] || [];
}
