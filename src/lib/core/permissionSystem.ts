/**
 * permissionSystem.ts — المصدر الوحيد لنظام الصلاحيات
 * Single Source of Truth for all roles, permissions, and access control.
 *
 * ⚠️ لا تُعرِّف صلاحيات في أي ملف آخر — كل شيء هنا.
 *
 * هيكل المفاتيح: snake_case فقط (مثال: view_dashboard)
 * لا يوجد dot-notation أو page.x.view — استخدم المفتاح المباشر.
 */

// ─────────────────────────────────────────────────────────────
// ROLES — 14 دور بالتسلسل الهرمي (1 = أعلى صلاحية)
// ─────────────────────────────────────────────────────────────
export type RoleKey =
  | 'general_manager'
  | 'executive_manager'
  | 'branches_manager'
  | 'procurement_manager'
  | 'branch_manager'
  | 'customer_service_manager'
  | 'shift_supervisor_morning'
  | 'shift_supervisor_evening'
  | 'pharmacist'
  | 'inventory_assistant'
  | 'customer_service'
  | 'assistant'
  | 'cleaning_supervisor'
  | 'delivery';

export interface RoleDefinition {
  key: RoleKey;
  labelAr: string;
  level: number;           // 1 = highest, 14 = lowest
  scope: DataScope;
  description: string;
}

export type DataScope = 'all_branches' | 'branch_only' | 'assigned_only' | 'own_only';

export const ROLES: RoleDefinition[] = [
  { key: 'general_manager',          labelAr: 'مدير عام',                level: 1,  scope: 'all_branches',  description: 'صلاحيات كاملة لكل الفروع والنظام' },
  { key: 'executive_manager',        labelAr: 'مدير تنفيذي',              level: 2,  scope: 'all_branches',  description: 'صلاحيات تنفيذية واسعة بدون إدارة الحسابات' },
  { key: 'branches_manager',         labelAr: 'مدير الفروع',             level: 3,  scope: 'all_branches',  description: 'إدارة كل الفروع والتقارير الكاملة' },
  { key: 'procurement_manager',      labelAr: 'مدير المشتريات',          level: 4,  scope: 'all_branches',  description: 'إدارة المخزون والمستلزمات والمشتريات' },
  { key: 'branch_manager',           labelAr: 'مدير فرع',                level: 5,  scope: 'branch_only',   description: 'إدارة شاملة لفرع واحد' },
  { key: 'customer_service_manager', labelAr: 'مدير خدمة العملاء',       level: 6,  scope: 'branch_only',   description: 'إدارة خدمة العملاء والمتابعات' },
  { key: 'shift_supervisor_morning', labelAr: 'مشرف شيفت صباحي',         level: 7,  scope: 'branch_only',   description: 'إشراف الشيفت الصباحي' },
  { key: 'shift_supervisor_evening', labelAr: 'مشرف شيفت مسائي',         level: 7,  scope: 'branch_only',   description: 'إشراف الشيفت المسائي' },
  { key: 'pharmacist',               labelAr: 'صيدلاني',                 level: 8,  scope: 'branch_only',   description: 'صلاحيات الصيدلاني ولوحة الأداء' },
  { key: 'inventory_assistant',      labelAr: 'مساعد مخزون',             level: 9,  scope: 'branch_only',   description: 'إدارة المخزون والأدوية' },
  { key: 'customer_service',         labelAr: 'خدمة عملاء',              level: 10, scope: 'branch_only',   description: 'متابعة العملاء وخدمتهم' },
  { key: 'assistant',                labelAr: 'مساعد',                   level: 11, scope: 'branch_only',   description: 'صلاحيات أساسية للمساعد' },
  { key: 'cleaning_supervisor',      labelAr: 'مشرف نظافة',              level: 12, scope: 'own_only',      description: 'صلاحيات محدودة للنظافة' },
  { key: 'delivery',                 labelAr: 'توصيل',                   level: 13, scope: 'assigned_only', description: 'طلبات التوصيل المُسندة فقط' },
];

export const ROLE_MAP: Record<string, RoleKey> = {
  // English keys
  general_manager: 'general_manager',
  executive_manager: 'executive_manager',
  branches_manager: 'branches_manager',
  procurement_manager: 'procurement_manager',
  branch_manager: 'branch_manager',
  customer_service_manager: 'customer_service_manager',
  shift_supervisor_morning: 'shift_supervisor_morning',
  shift_supervisor_evening: 'shift_supervisor_evening',
  pharmacist: 'pharmacist',
  inventory_assistant: 'inventory_assistant',
  customer_service: 'customer_service',
  assistant: 'assistant',
  cleaning_supervisor: 'cleaning_supervisor',
  delivery: 'delivery',
  // Arabic names → role key
  'مدير عام': 'general_manager',
  'أدمن': 'general_manager',
  admin: 'general_manager',
  'مدير تنفيذي': 'executive_manager',
  'مدير الفروع': 'branches_manager',
  'مدير فروع': 'branches_manager',
  'مدير المشتريات': 'procurement_manager',
  'مدير فرع': 'branch_manager',
  'مدير خدمة العملاء': 'customer_service_manager',
  'مشرف شيفت صباحي': 'shift_supervisor_morning',
  'مشرف شيفت مسائي': 'shift_supervisor_evening',
  'صيدلاني': 'pharmacist',
  'صيدلي': 'pharmacist',
  'دكتور': 'pharmacist',
  'د/': 'pharmacist',
  'مساعد مخزون': 'inventory_assistant',
  'خدمة عملاء': 'customer_service',
  'موظف خدمة عملاء': 'customer_service',
  'موظف خدمة العملاء': 'customer_service',
  'مساعد': 'assistant',
  'مشرف نظافة': 'cleaning_supervisor',
  'توصيل': 'delivery',
  'دليفري': 'delivery',
  'مندوب توصيل': 'delivery',
  'مندوب': 'delivery',
};

export function normalizeRole(role?: unknown): RoleKey {
  if (role == null) return 'assistant';
  let raw = '';
  if (typeof role === 'string') raw = role;
  else if (typeof role === 'number' || typeof role === 'boolean') raw = String(role);
  else if (typeof role === 'object') {
    const record = role as Record<string, unknown>;
    raw = String(record.key ?? record.role ?? record.name ?? record.label ?? record.labelAr ?? record.value ?? '');
  }
  const trimmed = raw.trim();
  if (!trimmed) return 'assistant';
  return ROLE_MAP[trimmed] || ROLE_MAP[trimmed.toLowerCase()] || 'assistant';
}

export function getRoleDefinition(role?: string | null): RoleDefinition {
  const key = normalizeRole(role);
  return ROLES.find((r) => r.key === key) || ROLES[ROLES.length - 1];
}

export function getRoleLabel(role?: string | null): string {
  return getRoleDefinition(role).labelAr;
}

export function getRoleLevel(role?: string | null): number {
  return getRoleDefinition(role).level;
}

export function isAdminRole(role?: string | null): boolean {
  return normalizeRole(role) === 'general_manager';
}

export function isPrivilegedRole(role?: string | null): boolean {
  return getRoleLevel(role) <= 4; // general_manager, executive_manager, branches_manager, procurement_manager
}

export function isBranchManagerRole(role?: string | null): boolean {
  const level = getRoleLevel(role);
  return level >= 3 && level <= 7; // branches_manager down to shift_supervisors
}

export function getUserDataScope(role?: string | null): DataScope {
  return getRoleDefinition(role).scope;
}

export function canSeeAllBranches(role?: string | null): boolean {
  return getUserDataScope(role) === 'all_branches';
}

// ─────────────────────────────────────────────────────────────
// PERMISSION KEYS — المفاتيح الرسمية (snake_case فقط)
// ─────────────────────────────────────────────────────────────
export interface PermissionCategory {
  key: string;
  label: string;
  permissions: PermissionDef[];
}

export interface PermissionDef {
  key: string;
  label: string;
  description?: string;
  sensitive?: boolean;  // يحتاج تأكيد إضافي عند المنح
}

export const PERMISSION_CATEGORIES: PermissionCategory[] = [
  {
    key: 'dashboard',
    label: 'لوحة التحكم',
    permissions: [
      { key: 'view_dashboard',            label: 'مشاهدة لوحة التحكم' },
      { key: 'view_dashboard_stats',      label: 'إحصائيات لوحة التحكم' },
      { key: 'view_executive_dashboard',  label: 'لوحة التحكم التنفيذية' },
      { key: 'view_alerts',               label: 'مشاهدة التنبيهات' },
      { key: 'manage_alerts',             label: 'إدارة التنبيهات', sensitive: true },
    ],
  },
  {
    key: 'shift_performance',
    label: 'تقييم الشيفتات',
    permissions: [
      { key: 'view_shift_performance',    label: 'مشاهدة تقييم الشيفتات' },
      { key: 'create_shift_evaluation',   label: 'إنشاء تقييم شيفت' },
      { key: 'edit_shift_evaluation',     label: 'تعديل تقييم شيفت' },
      { key: 'delete_shift_evaluation',   label: 'حذف تقييم شيفت', sensitive: true },
      { key: 'approve_shift_evaluation',  label: 'اعتماد تقييم شيفت', sensitive: true },
    ],
  },
  {
    key: 'doctor',
    label: 'لوحة الصيدلاني',
    permissions: [
      { key: 'view_doctor_dashboard',           label: 'لوحة الصيدلاني' },
      { key: 'view_own_performance',             label: 'مشاهدة أداءه الشخصي' },
      { key: 'view_all_doctors_performance',     label: 'مشاهدة أداء كل الصيادلة' },
      { key: 'view_branch_comparison',           label: 'مقارنة الفروع' },
    ],
  },
  {
    key: 'customers',
    label: 'العملاء',
    permissions: [
      { key: 'view_customers',            label: 'مشاهدة العملاء' },
      { key: 'view_customer_details',     label: 'تفاصيل العميل' },
      { key: 'create_customer',           label: 'إضافة عميل' },
      { key: 'edit_customer',             label: 'تعديل بيانات العميل' },
      { key: 'delete_customer',           label: 'حذف عميل', sensitive: true },
      { key: 'export_customers',          label: 'تصدير العملاء' },
      { key: 'import_customers',          label: 'استيراد العملاء', sensitive: true },
      { key: 'view_customer_360',         label: 'ملف العميل الكامل 360°' },
    ],
  },
  {
    key: 'customer_service',
    label: 'خدمة العملاء والمتابعات',
    permissions: [
      { key: 'view_customer_service',     label: 'خدمة العملاء' },
      { key: 'create_followup',           label: 'إنشاء متابعة' },
      { key: 'edit_followup',             label: 'تعديل متابعة' },
      { key: 'close_followup',            label: 'إغلاق متابعة' },
      { key: 'assign_followup',           label: 'إسناد متابعة لموظف', sensitive: true },
      { key: 'whatsapp_customer',         label: 'واتساب مع العميل' },
      { key: 'customer_welcome_messages.view', label: 'مشاهدة الرسائل الترحيبية' },
      { key: 'customer_welcome_messages.create', label: 'تسجيل رسالة ترحيبية' },
      { key: 'customer_welcome_messages.update', label: 'تحديث حالة رسالة ترحيبية', sensitive: true },
      { key: 'view_customer_requests',    label: 'طلبات العملاء' },
      { key: 'manage_customer_requests',  label: 'إدارة طلبات العملاء' },
      { key: 'view_customer_incubation',  label: 'حضانة العملاء' },
      { key: 'manage_customer_incubation',label: 'إدارة حضانة العملاء', sensitive: true },
      { key: 'view_crm',                  label: 'مركز CRM' },
    ],
  },
  {
    key: 'loyalty',
    label: 'الولاء والكاشباك',
    permissions: [
      { key: 'view_cashback',             label: 'مشاهدة الكاشباك' },
      { key: 'manage_cashback',           label: 'إدارة الكاشباك', sensitive: true },
      { key: 'view_loyalty_tiers',        label: 'مستويات الولاء' },
      { key: 'manage_loyalty_tiers',      label: 'إدارة مستويات الولاء', sensitive: true },
    ],
  },
  {
    key: 'team',
    label: 'الفريق والموظفون',
    permissions: [
      { key: 'view_team',                 label: 'مشاهدة الفريق' },
      { key: 'view_staff_details',        label: 'تفاصيل الموظف الكاملة' },
      { key: 'employee_operating_system.view', label: 'مشاهدة مهام الفريق اليومية' },
      { key: 'employee_operating_system.manage', label: 'إدارة مهام الفريق اليومية', sensitive: true },
      { key: 'create_team_member',        label: 'إضافة موظف', sensitive: true },
      { key: 'edit_team_member',          label: 'تعديل بيانات موظف', sensitive: true },
      { key: 'disable_team_member',       label: 'تعطيل حساب موظف', sensitive: true },
    ],
  },
  {
    key: 'schedule',
    label: 'الجداول والحضور',
    permissions: [
      { key: 'view_schedule',             label: 'الجدول الأسبوعي' },
      { key: 'manage_schedule',           label: 'إدارة الجدول', sensitive: true },
      { key: 'view_attendance_leaves',    label: 'الحضور والإجازات' },
      { key: 'create_leave_request',      label: 'طلب إجازة / إذن' },
      { key: 'approve_leave_request',     label: 'اعتماد الإجازات', sensitive: true },
      { key: 'manage_time_off',           label: 'إدارة الإذونات والإجازات', sensitive: true },
    ],
  },
  {
    key: 'points',
    label: 'النقاط والمكافآت',
    permissions: [
      { key: 'view_points',               label: 'مشاهدة النقاط' },
      { key: 'manage_points',             label: 'إضافة نقاط' },
      { key: 'approve_points',            label: 'اعتماد النقاط', sensitive: true },
      { key: 'create_reward',             label: 'إضافة مكافأة' },
      { key: 'create_deduction',          label: 'إضافة خصم', sensitive: true },
      { key: 'edit_points_transaction',   label: 'تعديل معاملة نقاط', sensitive: true },
      { key: 'export_points_report',      label: 'تصدير تقرير النقاط' },
      { key: 'view_salary_calculator',    label: 'حاسبة الراتب' },
    ],
  },
  {
    key: 'reviews',
    label: 'تقييم المحادثات',
    permissions: [
      { key: 'view_reviews',              label: 'مشاهدة التقييمات' },
      { key: 'add_reviews',               label: 'إضافة تقييم' },
      { key: 'edit_reviews',              label: 'تعديل تقييم', sensitive: true },
      { key: 'delete_reviews',            label: 'حذف تقييم', sensitive: true },
      { key: 'approve_reviews',           label: 'اعتماد التقييمات', sensitive: true },
    ],
  },
  {
    key: 'medicines',
    label: 'الأدوية والمخزون',
    permissions: [
      { key: 'view_medicines',            label: 'الأدوية' },
      { key: 'manage_medicines',          label: 'إدارة الأدوية', sensitive: true },
      { key: 'view_stagnant_medicines',   label: 'الأدوية الراكدة' },
      { key: 'manage_stagnant_medicines', label: 'إدارة الأدوية الراكدة' },
      { key: 'view_incentive_medicines',  label: 'أدوية الحوافز' },
      { key: 'manage_incentive_medicines',label: 'إدارة أدوية الحوافز', sensitive: true },
      { key: 'view_inventory',            label: 'المخزون' },
      { key: 'manage_inventory',          label: 'إدارة المخزون', sensitive: true },
      { key: 'view_shortages',            label: 'النواقص' },
      { key: 'manage_shortages',          label: 'إدارة النواقص' },
      { key: 'view_expiry_tracker',       label: 'تتبع انتهاء الصلاحية' },
    ],
  },
  {
    key: 'delivery',
    label: 'التوصيل',
    permissions: [
      { key: 'view_delivery',             label: 'مشاهدة التوصيل' },
      { key: 'manage_delivery',           label: 'إدارة التوصيل' },
      { key: 'view_delivery_reports',     label: 'تقارير التوصيل' },
      { key: 'approve_delivery_deduction',label: 'اعتماد خصم التوصيل', sensitive: true },
    ],
  },
  {
    key: 'analytics',
    label: 'التحليلات والتقارير',
    permissions: [
      { key: 'view_analytics',            label: 'التحليلات' },
      { key: 'view_analytics_sales',      label: 'تحليلات المبيعات' },
      { key: 'view_sales_reports',        label: 'تقارير المبيعات' },
      { key: 'export_sales_reports',      label: 'تصدير تقارير المبيعات' },
      { key: 'view_invoices',             label: 'الفواتير' },
      { key: 'view_invoice_import',       label: 'واجهة استيراد الفواتير' },
      { key: 'import_sales_invoices',     label: 'استيراد فواتير المبيعات', sensitive: true },
    ],
  },
  {
    key: 'operations',
    label: 'العمليات التشغيلية',
    permissions: [
      { key: 'view_operations',           label: 'العمليات' },
      { key: 'manage_operations',         label: 'إدارة العمليات', sensitive: true },
      { key: 'view_supplies',             label: 'المستلزمات' },
      { key: 'manage_supplies',           label: 'إدارة المستلزمات' },
      { key: 'view_purchases',            label: 'المشتريات' },
      { key: 'manage_purchases',          label: 'إدارة المشتريات', sensitive: true },
      { key: 'view_branch_inspection',    label: 'تفتيش الفرع' },
      { key: 'manage_branch_inspection',  label: 'إدارة تفتيش الفرع' },
    ],
  },
  {
    key: 'incentives',
    label: 'الحوافز والمكافآت الدورية',
    permissions: [
      { key: 'view_incentives',             label: 'الحوافز' },
      { key: 'manage_incentives',           label: 'إدارة الحوافز', sensitive: true },
      { key: 'view_quarterly_incentives',   label: 'الحوافز الربع سنوية' },
      { key: 'manage_quarterly_incentives', label: 'إدارة الحوافز الربع سنوية', sensitive: true },
      { key: 'view_penalty_management',     label: 'إدارة الجزاءات' },
      { key: 'manage_penalty_management',   label: 'إدارة الجزاءات والمكافآت', sensitive: true },
    ],
  },
  {
    key: 'activity',
    label: 'سجل الأنشطة',
    permissions: [
      { key: 'view_activity_log',         label: 'سجل الأنشطة' },
      { key: 'view_activity_logs',        label: 'كل سجلات الأنشطة' },
      { key: 'export_activity_logs',      label: 'تصدير سجل الأنشطة' },
    ],
  },
  {
    key: 'accounts',
    label: 'الحسابات والصلاحيات',
    permissions: [
      { key: 'view_staff_accounts',       label: 'مشاهدة الحسابات' },
      { key: 'manage_staff_accounts',     label: 'إدارة حسابات الموظفين', sensitive: true },
      { key: 'view_roles_permissions',    label: 'مشاهدة الأدوار والصلاحيات' },
      { key: 'manage_permissions',        label: 'تعديل الصلاحيات', sensitive: true },
      { key: 'manage_roles',              label: 'إدارة الأدوار', sensitive: true },
    ],
  },
  {
    key: 'settings',
    label: 'الإعدادات والنظام',
    permissions: [
      { key: 'view_settings',             label: 'الإعدادات' },
      { key: 'manage_settings',           label: 'تعديل الإعدادات', sensitive: true },
      { key: 'view_data_health',          label: 'صحة البيانات' },
      { key: 'manage_data_health',        label: 'إدارة صحة البيانات', sensitive: true },
    ],
  },
];

// All permission keys as a flat list (for iteration / validation)
export const ALL_PERMISSION_KEYS: string[] = PERMISSION_CATEGORIES.flatMap(
  (cat) => cat.permissions.map((p) => p.key)
);

// All permission definitions as a flat map
export const PERMISSION_MAP: Record<string, PermissionDef> = Object.fromEntries(
  PERMISSION_CATEGORIES.flatMap((cat) => cat.permissions.map((p) => [p.key, p]))
);

// ─────────────────────────────────────────────────────────────
// ROLE PERMISSION PRESETS — ما يحق لكل دور
// ─────────────────────────────────────────────────────────────
// "*" = كل الصلاحيات
const ALL: string[] = ['*'];

const MANAGER_BASE = [
  'view_dashboard',
  'view_dashboard_stats',
  'view_executive_dashboard',
  'view_alerts',
  'manage_alerts',
  'view_shift_performance',
  'create_shift_evaluation',
  'edit_shift_evaluation',
  'approve_shift_evaluation',
  'view_doctor_dashboard',
  'view_own_performance',
  'view_all_doctors_performance',
  'view_branch_comparison',
  'view_customers',
  'view_customer_details',
  'create_customer',
  'edit_customer',
  'export_customers',
  'import_customers',
  'view_customer_360',
  'view_customer_service',
  'create_followup',
  'edit_followup',
  'close_followup',
  'assign_followup',
  'whatsapp_customer',
  'customer_welcome_messages.view',
  'customer_welcome_messages.create',
  'customer_welcome_messages.update',
  'view_customer_requests',
  'manage_customer_requests',
  'view_customer_incubation',
  'manage_customer_incubation',
  'view_crm',
  'view_cashback',
  'manage_cashback',
  'view_loyalty_tiers',
  'manage_loyalty_tiers',
  'view_team',
  'view_staff_details',
  'employee_operating_system.view',
  'employee_operating_system.manage',
  'view_schedule',
  'manage_schedule',
  'view_attendance_leaves',
  'approve_leave_request',
  'manage_time_off',
  'view_points',
  'manage_points',
  'approve_points',
  'create_reward',
  'create_deduction',
  'edit_points_transaction',
  'export_points_report',
  'view_salary_calculator',
  'view_reviews',
  'add_reviews',
  'edit_reviews',
  'delete_reviews',
  'approve_reviews',
  'view_medicines',
  'manage_medicines',
  'view_stagnant_medicines',
  'manage_stagnant_medicines',
  'view_incentive_medicines',
  'manage_incentive_medicines',
  'view_inventory',
  'manage_inventory',
  'view_shortages',
  'manage_shortages',
  'view_expiry_tracker',
  'view_delivery',
  'manage_delivery',
  'view_delivery_reports',
  'approve_delivery_deduction',
  'view_analytics',
  'view_analytics_sales',
  'view_sales_reports',
  'export_sales_reports',
  'view_invoices',
  'view_invoice_import',
  'import_sales_invoices',
  'view_operations',
  'manage_operations',
  'view_supplies',
  'manage_supplies',
  'view_purchases',
  'manage_purchases',
  'view_branch_inspection',
  'manage_branch_inspection',
  'view_incentives',
  'manage_incentives',
  'view_quarterly_incentives',
  'manage_quarterly_incentives',
  'view_penalty_management',
  'manage_penalty_management',
  'view_activity_log',
  'view_activity_logs',
  'export_activity_logs',
  'view_staff_accounts',
  'view_roles_permissions',
  'view_settings',
  'view_data_health',
  'manage_data_health',
];

const BRANCH_MANAGER_BASE = [
  'view_dashboard',
  'view_dashboard_stats',
  'view_alerts',
  'view_shift_performance',
  'create_shift_evaluation',
  'edit_shift_evaluation',
  'approve_shift_evaluation',
  'view_doctor_dashboard',
  'view_own_performance',
  'view_all_doctors_performance',
  'view_customers',
  'view_customer_details',
  'create_customer',
  'edit_customer',
  'export_customers',
  'view_customer_360',
  'view_customer_service',
  'create_followup',
  'edit_followup',
  'close_followup',
  'assign_followup',
  'whatsapp_customer',
  'customer_welcome_messages.view',
  'customer_welcome_messages.create',
  'customer_welcome_messages.update',
  'view_customer_requests',
  'manage_customer_requests',
  'view_customer_incubation',
  'manage_customer_incubation',
  'view_crm',
  'view_cashback',
  'view_loyalty_tiers',
  'view_team',
  'view_staff_details',
  'employee_operating_system.view',
  'employee_operating_system.manage',
  'create_team_member',
  'edit_team_member',
  'view_schedule',
  'manage_schedule',
  'view_attendance_leaves',
  'create_leave_request',
  'approve_leave_request',
  'manage_time_off',
  'view_points',
  'manage_points',
  'approve_points',
  'create_reward',
  'create_deduction',
  'edit_points_transaction',
  'export_points_report',
  'view_salary_calculator',
  'view_reviews',
  'add_reviews',
  'edit_reviews',
  'approve_reviews',
  'view_medicines',
  'manage_medicines',
  'view_stagnant_medicines',
  'manage_stagnant_medicines',
  'view_incentive_medicines',
  'view_inventory',
  'manage_inventory',
  'view_shortages',
  'manage_shortages',
  'view_expiry_tracker',
  'view_delivery',
  'view_delivery_reports',
  'view_analytics',
  'view_analytics_sales',
  'view_sales_reports',
  'export_sales_reports',
  'view_invoices',
  'view_operations',
  'view_supplies',
  'view_purchases',
  'view_incentives',
  'view_quarterly_incentives',
  'view_penalty_management',
  'view_activity_log',
  'view_activity_logs',
  'view_staff_accounts',
  'view_settings',
  'view_data_health',
];

const CS_MANAGER_BASE = [
  'view_dashboard',
  'view_customers',
  'view_customer_details',
  'create_customer',
  'edit_customer',
  'view_customer_360',
  'view_customer_service',
  'create_followup',
  'edit_followup',
  'close_followup',
  'assign_followup',
  'whatsapp_customer',
  'customer_welcome_messages.view',
  'customer_welcome_messages.create',
  'customer_welcome_messages.update',
  'view_customer_requests',
  'manage_customer_requests',
  'view_customer_incubation',
  'manage_customer_incubation',
  'view_crm',
  'view_cashback',
  'manage_cashback',
  'view_loyalty_tiers',
  'manage_loyalty_tiers',
  'view_team',
  'view_staff_details',
  'employee_operating_system.view',
  'employee_operating_system.manage',
  'view_reviews',
  'add_reviews',
  'edit_reviews',
  'approve_reviews',
  'view_points',
  'view_salary_calculator',
  'view_analytics',
  'view_analytics_sales',
  'view_activity_log',
];

const SHIFT_SUPERVISOR_BASE = [
  'view_dashboard',
  'view_shift_performance',
  'create_shift_evaluation',
  'edit_shift_evaluation',
  'view_customers',
  'view_customer_details',
  'view_customer_360',
  'view_customer_service',
  'create_followup',
  'edit_followup',
  'whatsapp_customer',
  'view_team',
  'view_schedule',
  'view_attendance_leaves',
  'create_leave_request',
  'view_points',
  'create_reward',
  'create_deduction',
  'view_reviews',
  'add_reviews',
  'view_medicines',
  'view_stagnant_medicines',
  'view_delivery',
  'view_activity_log',
];

const PHARMACIST_BASE = [
  'view_dashboard',
  'view_doctor_dashboard',
  'view_own_performance',
  'view_customers',
  'view_customer_details',
  'view_customer_service',
  'create_followup',
  'whatsapp_customer',
  'customer_welcome_messages.view',
  'customer_welcome_messages.create',
  'view_customer_360',
  'view_schedule',
  'create_leave_request',
  'view_points',
  'view_reviews',
  'add_reviews',
  'view_analytics_sales',
  'view_medicines',
  'view_stagnant_medicines',
  'view_incentive_medicines',
  'view_expiry_tracker',
];

const CUSTOMER_SERVICE_BASE = [
  'view_dashboard',
  'view_customers',
  'view_customer_details',
  'create_customer',
  'edit_customer',
  'view_customer_360',
  'view_customer_service',
  'create_followup',
  'edit_followup',
  'close_followup',
  'whatsapp_customer',
  'customer_welcome_messages.view',
  'customer_welcome_messages.create',
  'view_customer_requests',
  'view_customer_incubation',
  'view_crm',
  'view_cashback',
  'view_loyalty_tiers',
  'view_reviews',
  'add_reviews',
  'view_points',
  'view_activity_log',
];

const DELIVERY_BASE = ['view_dashboard', 'view_delivery'];

const ASSISTANT_BASE = ['view_dashboard'];

export const ROLE_PERMISSION_PRESETS: Record<RoleKey, string[]> = {
  general_manager: ALL,
  executive_manager: MANAGER_BASE,
  branches_manager: MANAGER_BASE,
  procurement_manager: MANAGER_BASE,
  branch_manager: BRANCH_MANAGER_BASE,
  customer_service_manager: CS_MANAGER_BASE,
  shift_supervisor_morning: SHIFT_SUPERVISOR_BASE,
  shift_supervisor_evening: SHIFT_SUPERVISOR_BASE,
  pharmacist: PHARMACIST_BASE,
  inventory_assistant: [
    'view_dashboard',
    'view_medicines',
    'manage_medicines',
    'view_inventory',
    'manage_inventory',
    'view_shortages',
    'manage_shortages',
    'view_expiry_tracker',
    'view_purchases',
    'view_activity_log',
  ],
  customer_service: CUSTOMER_SERVICE_BASE,
  assistant: ASSISTANT_BASE,
  cleaning_supervisor: ['view_dashboard'],
  delivery: DELIVERY_BASE,
};

export function getDefaultPermissionsForRole(role?: string | null): Record<string, boolean> {
  const key = normalizeRole(role);
  const preset = ROLE_PERMISSION_PRESETS[key] || ASSISTANT_BASE;
  if (preset.includes('*')) return Object.fromEntries(ALL_PERMISSION_KEYS.map((p) => [p, true]));
  return Object.fromEntries(preset.map((p) => [p, true]));
}

export function mergePermissions(
  ...maps: Array<Record<string, boolean> | null | undefined>
): Record<string, boolean> {
  const merged: Record<string, boolean> = {};
  for (const map of maps) {
    if (!map) continue;
    for (const [key, value] of Object.entries(map)) {
      merged[key] = value === true;
    }
  }
  return merged;
}

/**
 * التحقق من صلاحية محددة لمستخدم (يأخذ دوره + صلاحياته المخصصة)
 */
export function hasPermission(
  roleOrUser:
    | string
    | { role?: string | null; permissions?: Record<string, boolean> | null }
    | null
    | undefined,
  permission: string
): boolean {
  if (!permission) return true;

  let role: string | null | undefined;
  let customPermissions: Record<string, boolean> | null | undefined;

  if (typeof roleOrUser === 'string') {
    role = roleOrUser;
  } else {
    role = roleOrUser?.role;
    customPermissions = roleOrUser?.permissions;
  }

  // مدير عام لديه كل الصلاحيات
  if (normalizeRole(role) === 'general_manager') return true;

  // الصلاحيات الافتراضية للدور
  const roleDefaults = getDefaultPermissionsForRole(role);
  // الصلاحيات المدمجة (الافتراضية + المخصصة)
  const merged = mergePermissions(roleDefaults, customPermissions);

  if (merged['*'] === true || merged[permission] === true) return true;

  // Backward-compat: check legacy aliases
  return LEGACY_ALIASES[permission]?.some((alias) => merged[alias] === true) ?? false;
}

/**
 * يُعيد true إذا كان المستخدم يملك أي صلاحية من القائمة
 */
export function hasAnyPermission(
  user: { role?: string | null; permissions?: Record<string, boolean> | null } | null | undefined,
  permissions: string[]
): boolean {
  return permissions.some((p) => hasPermission(user, p));
}

/**
 * يُعيد true إذا كان المستخدم يملك كل الصلاحيات في القائمة
 */
export function hasAllPermissions(
  user: { role?: string | null; permissions?: Record<string, boolean> | null } | null | undefined,
  permissions: string[]
): boolean {
  return permissions.every((p) => hasPermission(user, p));
}

// ─────────────────────────────────────────────────────────────
// LEGACY ALIASES — للتوافق مع الكود القديم فقط
// ─────────────────────────────────────────────────────────────
const LEGACY_ALIASES: Record<string, string[]> = {
  // Current page permissions → canonical snake_case permissions
  'page.dashboard.view': ['view_dashboard'],
  'page.customers.view': ['view_customers', 'view_customer_service'],
  'page.customer_service.view': ['view_customer_service', 'create_followup', 'edit_followup'],
  'page.customer_service.manage': ['view_customer_service', 'create_followup', 'edit_followup', 'assign_followup'],
  'page.customer_data_review.view': ['view_customer_service', 'edit_customer'],
  'page.crm.view': ['view_crm', 'view_customer_service'],
  'page.incubation.view': ['view_customer_incubation', 'view_customer_service'],
  'page.customer_cashback.view': ['view_cashback', 'view_loyalty_tiers'],
  'page.reviews.view': ['view_reviews'],
  'page.team.view': ['view_team'],
  'page.schedule.view': ['view_schedule'],
  'page.shift_notes.view': ['view_shift_performance', 'view_schedule'],
  'page.staff_accounts.view': ['view_staff_accounts'],
  'page.analytics.view': ['view_analytics', 'view_analytics_sales'],
  'page.points.view': ['view_points'],
  'page.invoices.view': ['view_invoices', 'view_invoice_import'],
  'page.delivery.view': ['view_delivery'],
  'page.activity_log.view': ['view_activity_log', 'view_activity_logs'],
  'page.stagnant_medicines.view': ['view_stagnant_medicines', 'view_medicines'],
  'page.incentive_medicines.view': ['view_incentive_medicines', 'view_medicines'],
  'page.branch_cleaning.view': ['view_operations', 'view_branch_inspection'],
  'staff_accounts.action.permissions': ['manage_permissions', 'view_roles_permissions'],
  'customers.action.import': ['import_customers'],
  'customer_service.section.daily_followups': ['view_customer_service', 'create_followup'],
  'customer_service.section.whatsapp_templates': ['view_customer_service', 'whatsapp_customer'],

  // Old dot-notation → new snake_case
  'dashboard.view': ['view_dashboard'],
  'customers.view': ['view_customers', 'view_customer_service'],
  'customers.create': ['create_customer'],
  'customers.edit': ['edit_customer'],
  'customers.delete': ['delete_customer'],
  'team.view': ['view_team'],
  'team.create': ['create_team_member'],
  'team.edit': ['edit_team_member'],
  'team.delete': ['disable_team_member'],
  'shifts.view': ['view_schedule'],
  'shifts.create': ['create_leave_request'],
  'shifts.edit': ['manage_schedule'],
  'permissions.view': ['view_staff_accounts', 'view_roles_permissions'],
  'permissions.edit': ['manage_permissions'],
  'points.view': ['view_points'],
  'points.manage': ['manage_points'],
  'evaluations.view': ['view_reviews', 'view_shift_performance'],
  'evaluations.create': ['add_reviews', 'create_shift_evaluation'],
  'reports.view': ['view_analytics_sales', 'view_sales_reports'],
  'reports.export': ['export_sales_reports', 'export_activity_logs'],
  'settings.view': ['view_settings'],
  'settings.edit': ['manage_settings'],
  // Old view_ names that may still exist
  view_customer_service: ['view_customer_service'],
  manage_followups: ['create_followup', 'edit_followup', 'close_followup'],
  manage_user_permissions: ['manage_permissions'],
  view_points_rewards: ['view_points'],
  view_attendance_leaves: ['view_attendance_leaves'],
  view_analytics_sales: ['view_analytics_sales'],
  view_conversation_reviews: ['view_reviews'],
  add_conversation_review: ['add_reviews'],
  manage_permissions: ['manage_permissions'],
};
