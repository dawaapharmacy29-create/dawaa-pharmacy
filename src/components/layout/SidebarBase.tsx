import { useEffect, useMemo, useState, type ElementType } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity, ActivitySquare, AlertTriangle, BarChart3, BellRing, Calendar, ChevronDown, ChevronLeft,
  ClipboardCheck, ClipboardList, Clock, Crown, FileSpreadsheet, Fingerprint, HeadphonesIcon, Landmark, LayoutDashboard, LogOut,
  MessageCircle, Package, PackageSearch, PackageX, Search, ShieldCheck, Sparkles, Star, Store, Target, TrendingDown, Truck, UserCheck,
  UserPlus, Users, Wallet, WalletCards, X,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useOptionalNavigationGuard } from '@/contexts/NavigationGuardContext';
import { usePendingShiftNotesCount } from '@/hooks/usePendingShiftNotesCount';
import { LOGO_URL } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { getVisibleSectionsForPath } from '@/lib/permissionMatrix';
import { searchNavItems } from '@/lib/navigation/navSearch';
import { DR_WAEL_FINGERPRINTS_PATH, DR_WAEL_SHOKRY_REPORTS_PATH, canAccessAccountRoute, canAccessHRRoute, canManageBiometricOperations, getRoutePermissions, normalizeRole } from '@/lib/core/permissionSystem';

export type NavItem = {
  path: string;
  icon: ElementType;
  label: string;
  permission?: string | string[];
  adminOnly?: boolean;
  excludeRoles?: string[];
  allowedRoles?: string[];
  biometricOnly?: boolean;
};
export type NavGroup = { title: string; icon: ElementType; items: NavItem[] };

const ENABLE_INTERNAL_DELIVERY_MODULE = false;
const SHIFT_NOTES_ITEM: NavItem = { path: '/shift-notes', icon: ClipboardList, label: 'ملاحظات الشيفت', permission: 'view_schedule' };
const QUICK_FOLLOWUP_ITEM: NavItem = { path: '/customer-service?quickFollowup=1', icon: HeadphonesIcon, label: 'متابعة سريعة', permission: 'view_customer_service' };
const CUSTOMER_CODING_ITEM: NavItem = { path: '/customer-coding', icon: UserPlus, label: 'تكويد عميل', permission: 'view_customer_service' };

// Navigation is grouped by user workflow. One entry per page: in-page tabs and modals are not
// nav entries, contextual/detail routes are reached from their parent page, and legacy
// surfaces stay URL-reachable but out of the menu (docs/APPLICATION_CONSOLIDATION_V1.md).
export const GROUPS: NavGroup[] = [
  { title: 'الرئيسية والإدارة', icon: Crown, items: [
    { path: '/', icon: LayoutDashboard, label: 'لوحة القيادة', permission: 'view_dashboard', excludeRoles: ['customer_service_manager', 'procurement_manager', 'inventory_assistant', 'customer_service', 'delivery', 'cleaning_supervisor'] },
    { path: DR_WAEL_FINGERPRINTS_PATH, icon: Fingerprint, label: 'بصمات د وائل' },
    { path: DR_WAEL_SHOKRY_REPORTS_PATH, icon: Landmark, label: 'تقارير شكري' },
    { path: '/consolidated-reports', icon: Landmark, label: 'التقارير المجمعة', allowedRoles: ['general_manager', 'admin', 'executive_manager'] },
    { path: '/daily-command', icon: Target, label: 'مراجعتي اليومية', allowedRoles: ['general_manager', 'admin', 'executive_manager'] },
    { path: '/daily-command', icon: Target, label: 'الأمر اليومي', allowedRoles: ['branches_manager'] },
    { path: '/operations-center', icon: BellRing, label: 'مركز المهام والتنبيهات', permission: 'view_operations' },
    { path: '/branch-inspection', icon: ClipboardList, label: 'متابعة ومرور الفروع', permission: 'view_branch_inspection' },
  ]},

  { title: 'الموارد البشرية', icon: UserCheck, items: [
    { path: '/hr-workforce', icon: Crown, label: 'مركز الموارد البشرية' },
    { path: '/team', icon: Users, label: 'دليل الموظفين', permission: 'view_team', excludeRoles: ['customer_service_manager'] },
    { path: '/hr-staff-milestones', icon: ClipboardCheck, label: 'ملف الموظف الوظيفي' },
    { path: '/schedule', icon: Calendar, label: 'الجداول والمناوبات', permission: 'view_schedule' },
    { path: '/time-off', icon: Calendar, label: 'الإجازات والغياب', permission: 'view_attendance_leaves' },
    { path: '/my-attendance', icon: UserCheck, label: 'حضوري' },
  ]},

  // مركز الحضور صفحة واحدة بتبويبات داخلية (نظرة عامة، متابعة اليوم، صندوق المراجعة، السجل،
  // إدارة البصمة، حضوري) وروابط ?tab= القديمة ما زالت تفتح التبويب الصحيح.
  { title: 'الحضور والوقت', icon: Clock, items: [
    { path: '/attendance-report', icon: Activity, label: 'مركز الحضور', permission: ['view_attendance_leaves','record_attendance'] },
    { path: '/hr-data-quality', icon: ShieldCheck, label: 'جودة بيانات الموارد البشرية' },
    { path: '/hr-reports', icon: BarChart3, label: 'تقارير الموارد البشرية', permission: 'view_attendance_leaves' },
    { path: '/hr-settings', icon: ShieldCheck, label: 'إعدادات الموارد البشرية' },
  ]},

  { title: 'الرواتب والنقاط والحوافز', icon: WalletCards, items: [
    { path: '/staff-payroll', icon: WalletCards, label: 'الرواتب والجاهزية', permission: 'manage_payroll' },
    { path: '/monthly-incentive-report', icon: Wallet, label: 'ملخص الحوافز الشهري' },
    { path: '/points', icon: Star, label: 'نقاط الأداء', permission: 'view_points' },
    { path: '/penalty-incentive', icon: AlertTriangle, label: 'الجزاءات والمكافآت', permission: 'view_penalty_management' },
    { path: '/point-appeals', icon: AlertTriangle, label: 'اعتراضات النقاط' },
    { path: '/incentive-governance', icon: ShieldCheck, label: 'اعتماد الحوافز', permission: 'manage_incentives' },
    { path: '/assistant-operational-bonus', icon: Sparkles, label: 'المكافآت الاستثنائية', permission: 'manage_incentives' },
    { path: '/quarterly-incentives', icon: Crown, label: 'نظام وقواعد الحافز', permission: 'view_quarterly_incentives' },
  ]},

  { title: 'الأداء والتقييمات', icon: ClipboardCheck, items: [
    { path: '/employee-kpi', icon: BarChart3, label: 'مؤشرات الموظفين', excludeRoles: ['branch_manager'] },
    { path: '/evaluation-lab', icon: ClipboardCheck, label: 'التقييم الشهري (المختبر)', permission: 'manage_evaluation_rules' },
    { path: '/weekly-reviews', icon: Star, label: 'المراجعات الأسبوعية (جودة البيع والمحادثات)', permission: 'manage_evaluation_rules' },
    { path: '/performance-pillars', icon: BarChart3, label: 'مؤشر الأداء الشامل', excludeRoles: ['customer_service_manager', 'branch_manager'] },
    { path: '/doctor-quality-summary', icon: Star, label: 'ملخص أداء الدكاترة', excludeRoles: ['pharmacist', 'customer_service_manager'] },
    { path: '/shift-performance', icon: ClipboardList, label: 'تقييم أداء الشيفتات', permission: 'view_shift_performance', excludeRoles: ['customer_service_manager'] },
    { path: '/staff-monthly-evaluation', icon: Star, label: 'التقييم الشهري للدكاترة وخدمة العملاء', permission: 'view_shift_performance', excludeRoles: ['customer_service_manager'] },
    { path: '/staff-monthly-evaluation', icon: Star, label: 'تقييم الدكاترة من خدمة العملاء', permission: 'view_shift_performance', allowedRoles: ['customer_service_manager'] },
    { path: '/weekly-evaluation/branch_manager', icon: ClipboardCheck, label: 'تقييم مدير الفرع', excludeRoles: ['branch_manager', 'customer_service_manager'] },
    { path: '/weekly-evaluation/branches_manager', icon: ClipboardCheck, label: 'تقييم مدير الفروع', excludeRoles: ['branch_manager', 'customer_service_manager'] },
    { path: '/weekly-evaluation/customer_service', icon: ClipboardCheck, label: 'تقييم فريق خدمة العملاء ودواء ألفا', excludeRoles: ['branch_manager', 'customer_service_manager'] },
  ]},

  // المتابعة السريعة إجراء (زر أعلى القائمة يفتح نافذة داخل مركز خدمة العملاء) وليست صفحة مستقلة.
  { title: 'خدمة العملاء والمتابعات', icon: HeadphonesIcon, items: [
    { path: '/customer-service', icon: HeadphonesIcon, label: 'مركز خدمة العملاء', permission: 'view_customer_service' },
    { path: '/customer-requests', icon: PackageSearch, label: 'طلبات العملاء', permission: 'view_customer_requests' },
    { path: '/customer-coding', icon: UserPlus, label: 'تكويد العملاء', permission: 'view_customer_service' },
    { path: '/customer-service-tasks', icon: FileSpreadsheet, label: 'مهام خدمة العملاء اليومية', permission: ['customer_service_daily_tasks', 'customer_service_daily_tasks_manage'] },
    { path: '/quick-replies', icon: HeadphonesIcon, label: 'الردود السريعة', permission: 'whatsapp_customer' },
    { path: '/welcome-messages', icon: MessageCircle, label: 'رسائل الترحيب', permission: 'customer_welcome_messages_view' },
  ]},

  // مسار واتساب الموحد: التقاط وتحليل ← مراجعة الاستثناءات ← تقييم المحادثات ← التحليلات.
  // المتابعة نفسها تتم من مركز خدمة العملاء. صفحات واتساب التجريبية القديمة (المراقبة القديمة
  // للفولدر، طلبات المتابعة الآلية، أداء الدكاترة، سجل العميل، الفرص الضائعة، مقارنة الفروع)
  // تبقى بروابطها المباشرة فقط لأنها تحسب تحويلًا موازيًا غير معتمد وتحتاج صلاحية مقيِّم خاصة.
  { title: 'واتساب وذكاء المبيعات', icon: Sparkles, items: [
    { path: '/whatsapp-smart-folder-watcher', icon: MessageCircle, label: 'التقاط وتحليل محادثات واتساب', permission: 'manage_whatsapp_capture' },
    { path: '/sales-intelligence/qa', icon: ShieldCheck, label: 'مراجعة حالات ذكاء المبيعات', permission: 'manage_whatsapp_capture' },
    { path: '/reviews', icon: ClipboardCheck, label: 'تقييم المحادثات', permission: 'view_reviews' },
    { path: '/whatsapp-analytics', icon: BarChart3, label: 'تحليلات واتساب', permission: 'view_reviews' },
  ]},

  { title: 'العملاء ونقاط الولاء', icon: Users, items: [
    { path: '/customers', icon: Users, label: 'قاعدة العملاء', permission: 'view_customers' },
    { path: '/customer-monthly-performance', icon: TrendingDown, label: 'أداء العملاء الشهري', permission: 'view_customers' },
    { path: '/customer-data-review', icon: ClipboardCheck, label: 'مراجعة بيانات العملاء', permission: 'view_customer_details' },
    { path: '/customer-cashback', icon: WalletCards, label: 'نقاط العملاء من الفواتير', permission: ['view_customers','view_customer_service'] },
    { path: '/customer-points-ledger', icon: Star, label: 'سجل حركات نقاط العملاء', permission: ['view_customers','view_customer_service'] },
  ]},

  { title: 'المبيعات والتقارير', icon: BarChart3, items: [
    { path: '/analytics', icon: BarChart3, label: 'لوحة المبيعات والتحليلات', permission: 'view_analytics', excludeRoles: ['customer_service_manager'] },
    { path: '/branch-comparison', icon: BarChart3, label: 'مقارنة أداء الفروع', permission: 'view_branch_comparison' },
    { path: '/doctor-competition', icon: Star, label: 'أداء ومنافسة الدكاترة', permission: 'view_doctor_dashboard' },
    { path: '/monthly-report-360', icon: BarChart3, label: 'تقرير الأداء الشهري 360°', permission: 'view_sales_reports' },
    { path: '/reports', icon: FileSpreadsheet, label: 'مركز التقارير', permission: 'view_sales_reports' },
  ]},

  { title: 'الفواتير والمشتريات', icon: FileSpreadsheet, items: [
    { path: '/invoices', icon: FileSpreadsheet, label: 'استيراد فواتير المبيعات', permission: 'view_invoices' },
    { path: '/internal-codes', icon: BarChart3, label: 'الأكواد الداخلية', permission: 'view_sales_reports' },
    { path: '/purchases', icon: FileSpreadsheet, label: 'المشتريات', permission: 'view_purchases' },
    { path: '/purchase-review', icon: WalletCards, label: 'مراجعة المشتريات', allowedRoles: ['general_manager', 'executive_manager', 'admin'] },
    { path: '/uncoded-invoices', icon: FileSpreadsheet, label: 'الفواتير اللي مش متكودة', allowedRoles: ['general_manager', 'executive_manager', 'admin'] },
    { path: '/inventory-stock', icon: Package, label: 'رصيد المخازن', allowedRoles: ['general_manager', 'executive_manager', 'admin'] },
    { path: '/stock-liberation', icon: AlertTriangle, label: 'تحرير المخزون: الرواكد والإكسبير', allowedRoles: ['general_manager', 'executive_manager', 'admin'] },
    { path: '/purchase-invoice-entry', icon: FileSpreadsheet, label: 'إدخال فاتورة مشتريات', allowedRoles: ['assistant'] },
    { path: '/purchase-invoice-review', icon: ClipboardCheck, label: 'مراجعة فواتير المشتريات', excludeRoles: ['pharmacist', 'assistant', 'customer_service_manager'] },
    { path: '/purchase-invoice-accuracy', icon: FileSpreadsheet, label: 'دقة إدخال فواتير المشتريات', allowedRoles: ['assistant', 'customer_service_manager', 'general_manager', 'branches_manager'] },
    { path: '/purchase-returns', icon: PackageX, label: 'مرتجعات المشتريات', permission: 'view_purchases' },
    { path: '/purchase-cycle-report', icon: PackageSearch, label: 'تقرير دورة المشتريات', permission: 'view_purchases' },
    { path: '/supplier-accounts', icon: WalletCards, label: 'حسابات الموردين', permission: 'view_purchases' },
    { path: '/purchase-order-log', icon: ClipboardList, label: 'سجل الطلبيات', permission: 'view_purchases' },
    { path: '/shift-handovers', icon: Clock, label: 'تسليم الشيفتات', excludeRoles: ['branch_manager'] },
  ]},

  { title: 'المخزون وتشغيل الصيدلية', icon: Store, items: [
    { path: '/shortages', icon: PackageSearch, label: 'النواقص', permission: 'view_shortages' },
    { path: '/stagnant-medicines', icon: Package, label: 'الرواكد', permission: 'view_stagnant_medicines' },
    { path: '/medicine-expiry', icon: AlertTriangle, label: 'متابعة الصلاحية', permission: 'view_expiry_tracker' },
    { path: '/inventory-counts', icon: ClipboardList, label: 'الجرد', permission: 'view_inventory' },
    { path: '/shelf-organization', icon: ClipboardList, label: 'تنظيم ورص الأرفف', permission: ['view_inventory','view_operations'], excludeRoles: ['branch_manager'] },
    { path: '/supplies', icon: PackageSearch, label: 'متابعة المستلزمات', permission: ['view_supplies','view_inventory'] },
    { path: '/accessories', icon: Package, label: 'متابعة الإكسسوارات', permission: ['view_operations','view_inventory'] },
    { path: '/pharmacy-zone-tasks', icon: ClipboardList, label: 'الرص والجرد اليومي', allowedRoles: ['assistant', 'delivery'] },
    { path: '/branch-checklist-review', icon: ClipboardCheck, label: 'مراجعة النظافة والرص والجرد', excludeRoles: ['pharmacist', 'assistant', 'customer_service_manager', 'branch_manager'] },
  ]},

  { title: 'المهام والتشغيل اليومي', icon: ClipboardList, items: [
    { path: '/employee-operating-system', icon: ClipboardList, label: 'مهام الفريق', permission: 'employee_operating_system_view', excludeRoles: ['customer_service_manager'] },
    { path: '/my-daily-checklist', icon: ClipboardCheck, label: 'مهامي اليومية', allowedRoles: ['assistant', 'cleaning_supervisor'] },
    { path: '/assistant-operational-log', icon: PackageSearch, label: 'سجل أعمال المساعد', allowedRoles: ['assistant'] },
    { path: '/daily-manager-checklist', icon: ClipboardList, label: 'مهام الإدارة اليومية', excludeRoles: ['general_manager', 'executive_manager', 'customer_service_manager', 'branch_manager'] },
  ]},

  { title: 'إدارة النظام', icon: ShieldCheck, items: [
    { path: '/staff-accounts', icon: ShieldCheck, label: 'الحسابات والصلاحيات', permission: 'view_staff_accounts', adminOnly: true },
    { path: '/roles-permissions', icon: ShieldCheck, label: 'إعدادات الأدوار والصلاحيات', permission: 'view_roles_permissions', adminOnly: true },
    { path: '/staff-duplicate-audit', icon: AlertTriangle, label: 'تدقيق الحسابات والتكرار', permission: 'view_staff_accounts', adminOnly: true },
    { path: '/data-health', icon: ShieldCheck, label: 'صحة البيانات', permission: 'view_data_health' },
    { path: '/activity-log', icon: ActivitySquare, label: 'سجل أنشطة النظام', permission: 'view_activity_log', adminOnly: true },
  ]},

  { title: 'التوصيل', icon: Truck, items: [
    { path: '/delivery', icon: Truck, label: 'إدارة الدليفري', permission: 'view_delivery' },
  ]},
  { title: 'للمراجعة', icon: ClipboardList, items: [{ path: '/review-pages', icon: ClipboardList, label: 'صفحات للمراجعة', allowedRoles: ['general_manager'] }] },
];

// تبويبات لوحة الدكتور (تقييماتي، القبض والحوافز، إشعاراتي، سجل نشاطي) تُفتح من داخل اللوحة نفسها.
export const PHARMACIST_GROUPS: NavGroup[] = [
  { title: 'عملي اليومي', icon: UserCheck, items: [
    { path: '/doctor-dashboard', icon: LayoutDashboard, label: 'لوحة الدكتور', permission: 'view_doctor_dashboard' },
    { path: '/doctor-dashboard?tab=followups', icon: HeadphonesIcon, label: 'متابعاتي المطلوبة', permission: 'view_doctor_dashboard' },
    { path: '/customers', icon: Users, label: 'بحث العملاء', permission: 'view_customers' },
    { path: '/schedule', icon: Calendar, label: 'الجدول والشيفتات', permission: 'view_schedule' },
  ]},
  { title: 'الأصناف', icon: Store, items: [
    { path: '/stagnant-medicines', icon: Package, label: 'الرواكد', permission: 'view_stagnant_medicines' },
    { path: '/incentive-medicines', icon: Sparkles, label: 'أصناف الحافز', permission: 'view_incentive_medicines' },
  ]},
  { title: 'أدائي وحافزي', icon: Star, items: [
    { path: '/points', icon: Star, label: 'نقاطي وحافزي', permission: 'view_points' },
    { path: '/monthly-report-360', icon: BarChart3, label: 'تقريري الشهري 360°', permission: 'view_doctor_dashboard' },
    { path: '/point-appeals', icon: AlertTriangle, label: 'اعتراضاتي على النقاط' },
  ]},
];

// The branch manager's short menu. Entries come from GROUPS, so a page keeps one label and one permission;
// what is left out stays reachable from the pages that link to it and by its URL.
const managerItems = (...paths: string[]) =>
  paths.flatMap((path) => GROUPS.flatMap((group) => group.items).filter((item) => item.path === path));

export const BRANCH_MANAGER_GROUPS: NavGroup[] = [
  // Owner 2026-11-14: eight pages. Customers and the schedule open from customer service and attendance; the
  // weekly points pages belong to the system the monthly evaluation replaced (hidden, not deleted).
  // /monthly-report-360 stays for a manager given its permission (it has no other way in).
  { title: 'يومي', icon: LayoutDashboard, items: managerItems('/', '/customer-service', '/reviews') },
  { title: 'فريقي', icon: Users, items: managerItems('/attendance-report', '/time-off') },
  { title: 'الفرع', icon: Store, items: managerItems('/shortages', '/stagnant-medicines', '/medicine-expiry', '/monthly-report-360') },
];

// Top management works from a short menu too, but runs the whole application: everything else stays one click
// away under "كل الصفحات".
export const MANAGEMENT_GROUPS: NavGroup[] = [
  // Owner 2026-11-21: a short pinned list of the pages the day runs on, open by default; the other groups stay
  // folded until opened, and the search box above the menu finds any page (including those under "كل الصفحات").
  // The sales invoices are uploaded every day, the follow-ups group file goes up on the doctors' competition, and
  // the customer service team works from its daily sheet.
  { title: 'يومي', icon: LayoutDashboard, items: managerItems('/', '/daily-command', '/invoices', '/customer-service-tasks', '/customer-requests', '/doctor-competition', '/weekly-reviews', '/purchase-review', '/attendance-report') },
  // The monthly evaluation and the branch comparison are the pages the boards are made from. Appeals, shift
  // performance and the pillars index are under "كل الصفحات" (hidden, not deleted).
  { title: 'التقييم والمسابقة', icon: ClipboardCheck, items: managerItems('/evaluation-lab', '/branch-comparison', '/penalty-incentive') },
  { title: 'الفريق', icon: Users, items: managerItems('/team', '/schedule', '/time-off', '/staff-payroll', DR_WAEL_FINGERPRINTS_PATH) },
  { title: 'العملاء', icon: HeadphonesIcon, items: managerItems('/customer-service', '/customers', '/reviews') },
  // /consolidated-reports, /uncoded-invoices and /inventory-counts are under "كل الصفحات" to keep the menu at 27 pages (hidden, not deleted).
  { title: 'المبيعات', icon: BarChart3, items: managerItems('/analytics', '/reports', DR_WAEL_SHOKRY_REPORTS_PATH) },
  // Owner 2026-11-26: «تحرير المخزون» took the place of /purchases, which is under "كل الصفحات" (27 pages max).
  { title: 'المشتريات والمخزون', icon: Store, items: managerItems('/stock-liberation', '/inventory-stock', '/shortages') },
  { title: 'للمراجعة', icon: ClipboardList, items: managerItems('/review-pages') },
];

// The other roles open on the few pages their day runs on; whatever else they are allowed to open stays one click
// away under "كل الصفحات" (hidden, not deleted). Assistants and Team Dawaa Alpha have their own sidebar.
const ROLE_GROUPS: Record<string, NavGroup[]> = {
  customer_service: [
    { title: 'يومي', icon: HeadphonesIcon, items: managerItems('/customer-service', '/customer-requests', '/customer-coding', '/customers') },
    { title: 'واتساب', icon: MessageCircle, items: managerItems('/reviews', '/quick-replies') },
    { title: 'حسابي', icon: UserCheck, items: managerItems('/my-attendance', '/points') },
  ],
  customer_service_manager: [
    { title: 'يومي', icon: HeadphonesIcon, items: managerItems('/customer-service', '/customer-requests', '/customers', '/operations-center') },
    { title: 'واتساب والتقييم', icon: MessageCircle, items: managerItems('/whatsapp-smart-folder-watcher', '/reviews', '/staff-monthly-evaluation') },
    { title: 'الفريق', icon: Users, items: managerItems('/schedule', '/attendance-report', '/points') },
  ],
  procurement_manager: [
    { title: 'المشتريات', icon: FileSpreadsheet, items: managerItems('/purchases', '/supplier-accounts', '/purchase-order-log', '/purchase-returns') },
    { title: 'المخزون', icon: Store, items: managerItems('/shortages', '/stagnant-medicines', '/medicine-expiry', '/inventory-counts') },
  ],
  inventory_assistant: [
    { title: 'المخزون', icon: Store, items: managerItems('/shortages', '/inventory-counts', '/medicine-expiry', '/shelf-organization') },
    { title: 'المشتريات', icon: FileSpreadsheet, items: managerItems('/purchases', '/purchase-returns') },
    { title: 'حسابي', icon: UserCheck, items: managerItems('/my-attendance') },
  ],
  delivery: [{ title: 'يومي', icon: ClipboardList, items: managerItems('/pharmacy-zone-tasks', '/my-attendance', '/operations-center') }],
  cleaning_supervisor: [{ title: 'يومي', icon: ClipboardList, items: managerItems('/my-daily-checklist', '/my-attendance', '/operations-center') }],
};

const MANAGEMENT_ROLES = ['general_manager', 'executive_manager', 'branches_manager'];

// The menu a role opens on, and the pages kept behind "كل الصفحات".
// `open` names the groups that start unfolded (all of the main menu when it is absent).
export function menuGroupsFor(role: string, pharmacistView: boolean): { main: NavGroup[]; more: NavGroup[]; short: boolean; open?: string[] } {
  if (pharmacistView) return { main: PHARMACIST_GROUPS, more: [], short: true };
  if (role === 'branch_manager') return { main: BRANCH_MANAGER_GROUPS, more: [], short: true };
  const main = MANAGEMENT_ROLES.includes(role) ? MANAGEMENT_GROUPS : ROLE_GROUPS[role];
  if (!main) return { main: GROUPS, more: [], short: false };
  const inMain = new Set(main.flatMap((group) => group.items.map((item) => item.path)));
  const more = GROUPS
    .map((group) => ({ ...group, items: group.items.filter((item) => !inMain.has(item.path)) }))
    .filter((group) => group.items.length);
  return { main, more, short: true, open: MANAGEMENT_ROLES.includes(role) ? ['يومي'] : undefined };
}

function basePath(path: string) { return path.split('?')[0]; }
function tabOf(path: string) { return new URLSearchParams(path.split('?')[1] || '').get('tab'); }
// An item without ?tab= stays active on its page's in-page tabs, unless a sibling nav item
// owns that exact tab (e.g. /doctor-dashboard vs /doctor-dashboard?tab=followups).
export function activeItem(itemPath: string, pathname: string, search: string, navPaths: readonly string[] = []) {
  const base = basePath(itemPath);
  if (base === '/') return pathname === '/';
  if (base === '/team' && pathname.startsWith('/staff/')) return true;
  if (pathname !== base && !pathname.startsWith(`${base}/`)) return false;
  const currentTab = new URLSearchParams(search).get('tab');
  const expectedTab = tabOf(itemPath);
  if (expectedTab) return currentTab === expectedTab;
  if (!currentTab) return true;
  return !navPaths.some((path) => basePath(path) === base && tabOf(path) === currentTab);
}

export type NavVisibilityContext = {
  rawRole: unknown;
  accountId?: unknown;
  role: string;
  privileged: boolean;
  checkPermission: (permission: string) => boolean;
};

// Nav visibility = the same central route permission that ProtectedRoute enforces, narrowed by
// the item's own role/permission hints. A visible item is never a denied page.
export function isNavItemVisible(item: NavItem, context: NavVisibilityContext) {
  const { rawRole, accountId, role, privileged, checkPermission } = context;
  if (!canAccessHRRoute(basePath(item.path), rawRole)) return false;
  if (!canAccessAccountRoute(basePath(item.path), accountId)) return false;
  if (item.biometricOnly && !canManageBiometricOperations(rawRole)) return false;
  if (item.adminOnly && !privileged) return false;
  if (item.allowedRoles?.length && !item.allowedRoles.includes(role)) return false;
  if (item.excludeRoles?.includes(role)) return false;

  if (item.permission) {
    const allowedByItem = Array.isArray(item.permission)
      ? item.permission.some(checkPermission)
      : checkPermission(item.permission);
    if (!allowedByItem) return false;
  }

  const routePermissions = getRoutePermissions(basePath(item.path));
  if (routePermissions?.length && !routePermissions.some(checkPermission)) return false;

  return true;
}

interface SidebarProps { collapsed: boolean; onToggle: () => void; mobileOpen: boolean; onMobileClose: () => void }

export default function Sidebar({ collapsed, onToggle, mobileOpen, onMobileClose }: SidebarProps) {
  const { user, logout, isAdmin, checkPermission } = useAuth();
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [moreOpen, setMoreOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const guard = useOptionalNavigationGuard();
  const pendingShiftNotes = usePendingShiftNotesCount();
  const role = normalizeRole(user?.role);
  const privileged = isAdmin || ['general_manager','executive_manager','branches_manager'].includes(role);
  const pharmacistView = ['pharmacist', 'shift_supervisor_morning', 'shift_supervisor_evening'].includes(role)
    && !checkPermission('view_executive_dashboard');

  const canAccess = (item: NavItem) => isNavItemVisible(item, { rawRole: user?.role, accountId: user?.id, role, privileged, checkPermission });

  const canQuickFollowup = pharmacistView
    ? checkPermission('view_doctor_dashboard')
    : canAccess(QUICK_FOLLOWUP_ITEM);
  const canQuickCoding = canAccess(CUSTOMER_CODING_ITEM);
  const quickFollowupPath = pharmacistView ? '/doctor-dashboard?tab=followups' : QUICK_FOLLOWUP_ITEM.path;

  const { mainGroups, moreGroups, shortMenu, openGroups } = useMemo(() => {
    const visible = (list: NavGroup[]) => list
      .filter((group) => group.title !== 'التوصيل' || ENABLE_INTERNAL_DELIVERY_MODULE)
      .map((group) => ({ ...group, items: group.items.filter(canAccess) }))
      .filter((group) => group.items.length);
    const menu = menuGroupsFor(role, pharmacistView);
    return { mainGroups: visible(menu.main), moreGroups: visible(menu.more), shortMenu: menu.short, openGroups: menu.open };
  }, [checkPermission, pharmacistView, privileged, role, user?.id]);
  const groups = useMemo(() => [...mainGroups, ...moreGroups], [mainGroups, moreGroups]);

  const navPaths = useMemo(() => groups.flatMap((group) => group.items.map((item) => item.path)), [groups]);
  // A short menu opens on its pages directly; the long lists stay folded until asked for.
  const openByDefault = (title: string) => shortMenu && (openGroups ? openGroups.includes(title) : mainGroups.some((group) => group.title === title));
  const searchHits = useMemo(() => searchNavItems(groups, searchQuery), [groups, searchQuery]);
  const onMorePage = moreGroups.some((group) => group.items.some((item) => activeItem(item.path, location.pathname, location.search, navPaths)));
  const showMore = moreOpen || onMorePage;

  useEffect(() => {
    setExpandedGroups((previous) => {
      let changed = false;
      const next = { ...previous };
      for (const group of groups) {
        if (group.items.some((item) => activeItem(item.path, location.pathname, location.search, navPaths)) && !next[group.title]) { next[group.title] = true; changed = true; }
      }
      return changed ? next : previous;
    });
  }, [groups, navPaths, location.pathname, location.search]);

  const go = (target: string) => { if (guard?.hasActiveDirtyGuard()) guard.requestNavigation(target); else navigate(target); onMobileClose(); };
  const openHit = (path: string) => { setSearchQuery(''); go(path); };
  const searchBox = !collapsed ? <div className="px-3 pt-3"><label className="dawaa-sidebar-user-card flex items-center gap-2 rounded-xl px-3 py-2"><Search size={15} className="dawaa-sidebar-muted shrink-0" /><input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && searchHits[0]) openHit(searchHits[0].item.path); if (event.key === 'Escape') setSearchQuery(''); }} placeholder="دوّر على صفحة…" aria-label="دوّر على صفحة في القايمة" className="dawaa-sidebar-title w-full bg-transparent text-xs font-bold outline-none placeholder:opacity-60" /></label></div> : null;
  const searchPanel = <nav className="flex-1 space-y-0.5 overflow-y-auto p-3" aria-label="نتايج البحث">{searchHits.length ? searchHits.map(({ item, group }) => <button key={`${item.path}-${item.label}`} type="button" onClick={() => openHit(item.path)} className={cn('nav-item w-full', activeItem(item.path, location.pathname, location.search, navPaths) ? 'nav-item-active' : 'nav-item-inactive')}><item.icon size={18} /><span className="flex-1 text-right">{item.label}</span><span className="dawaa-sidebar-muted text-[10px]">{group}</span></button>) : <div className="dawaa-sidebar-muted px-3 py-6 text-center text-xs font-bold">مفيش صفحة بالاسم ده</div>}</nav>;
  const content = <div className="flex h-full flex-col">
    <div className={cn('dawaa-sidebar-divider flex items-center gap-3 border-b p-4', collapsed && 'justify-center')}><div className="logo-tile flex h-10 w-10 items-center justify-center rounded-xl"><img src={LOGO_URL} alt="Dawaa Pharmacy 2027" className="h-8 w-8 object-contain" /></div>{!collapsed ? <div className="min-w-0"><div className="dawaa-sidebar-title text-sm font-bold">Dawaa Pharmacy 2027</div><div className="dawaa-sidebar-brand truncate text-xs">نظام تشغيل الصيدلية الذكي</div></div> : null}<button onClick={onToggle} className="dawaa-sidebar-muted mr-auto hidden rounded-lg p-1.5 lg:flex"><ChevronLeft className={collapsed ? 'rotate-180' : ''} /></button></div>
    <div className="dawaa-sidebar-divider border-b p-3"><div className="dawaa-sidebar-user-card rounded-xl p-2.5 text-xs"><div className="dawaa-sidebar-title font-semibold">{user?.name}</div>{!collapsed ? <div className="dawaa-sidebar-muted">{user?.role} - {user?.branch}</div> : null}</div></div>
    {!collapsed && (canQuickFollowup || canQuickCoding) ? <div className="px-3 py-2"><div className="flex gap-2">{canQuickFollowup ? <button onClick={() => go(quickFollowupPath)} className="dawaa-sidebar-quick flex-1 rounded-lg px-3 py-2 text-xs font-bold">متابعة سريعة</button> : null}{canQuickCoding ? <button onClick={() => go(CUSTOMER_CODING_ITEM.path)} className="dawaa-sidebar-quick dawaa-sidebar-quick--secondary flex-1 rounded-lg px-3 py-2 text-xs font-bold">تكويد عميل</button> : null}</div></div> : null}
    {canAccess(SHIFT_NOTES_ITEM) ? <button onClick={() => go(SHIFT_NOTES_ITEM.path)} className="nav-item nav-item-inactive mx-3 my-2"><ClipboardList size={18} />{!collapsed ? <span className="flex w-full justify-between">ملاحظات الشيفت{pendingShiftNotes ? <b className="dawaa-sidebar-count rounded-full px-2">{pendingShiftNotes}</b> : null}</span> : null}</button> : null}
    {searchBox}
    {searchQuery.trim() ? searchPanel : <nav className="flex-1 space-y-2 overflow-y-auto p-3">{[...mainGroups, ...(showMore ? moreGroups : [])].map((group) => { const active = group.items.some((item) => activeItem(item.path, location.pathname, location.search, navPaths)); const expanded = collapsed || active || (expandedGroups[group.title] ?? openByDefault(group.title)); return <div key={group.title} className="space-y-1">{!collapsed ? <button type="button" onClick={() => setExpandedGroups((value) => ({...value,[group.title]:!(value[group.title] ?? openByDefault(group.title))}))} className={cn('dawaa-sidebar-group flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold', active && 'is-active')}><group.icon size={15} /><span className="flex-1 text-right">{group.title}</span><ChevronDown size={14} className={expanded ? 'rotate-180' : ''} /></button> : null}{expanded ? <div className={cn('space-y-0.5', !collapsed && 'pr-2')}>{group.items.map((item) => { const itemActive = activeItem(item.path, location.pathname, location.search, navPaths); const sections = getVisibleSectionsForPath(basePath(item.path), checkPermission); return <div key={`${item.path}-${item.label}`}><NavLink to={item.path} onClick={(event) => { if (guard?.hasActiveDirtyGuard()) { event.preventDefault(); guard.requestNavigation(item.path); } onMobileClose(); }} className={cn('nav-item', itemActive ? 'nav-item-active' : 'nav-item-inactive', collapsed && 'justify-center px-2')}><item.icon size={18} />{!collapsed ? <span>{item.label}</span> : null}</NavLink>{!collapsed && itemActive && sections.length ? <div className="dawaa-sidebar-section-label mr-8 border-r pr-3">{sections.map((section) => <div key={section.key} className="px-2 py-1 text-[11px]">{section.label}</div>)}</div> : null}</div>;})}</div> : null}</div>;})}{moreGroups.length && !onMorePage ? <button type="button" onClick={() => setMoreOpen((value) => !value)} className={cn('nav-item nav-item-inactive w-full', collapsed && 'justify-center px-2')}><ChevronDown size={18} className={moreOpen ? 'rotate-180' : ''} />{!collapsed ? <span>{moreOpen ? 'إخفاء باقي الصفحات' : 'كل الصفحات'}</span> : null}</button> : null}</nav>}
    <div className="dawaa-sidebar-divider border-t p-3"><button onClick={() => { logout(); navigate('/login'); }} className="nav-item nav-item-inactive dawaa-sidebar-logout w-full"><LogOut size={18} />{!collapsed ? 'تسجيل الخروج' : null}</button></div>
  </div>;

  return <><aside className={cn('dawaa-sidebar hidden flex-shrink-0 flex-col border-l lg:flex', collapsed ? 'w-16' : 'w-72')}>{content}</aside>{mobileOpen ? <div className="fixed inset-0 z-50 flex lg:hidden"><div className="dawaa-mobile-backdrop fixed inset-0" onClick={onMobileClose} /><aside className="dawaa-sidebar relative mr-auto flex h-full w-72 flex-col border-l"><button onClick={onMobileClose} className="dawaa-sidebar-muted absolute left-4 top-4 z-10"><X /></button>{content}</aside></div> : null}</>;
}
