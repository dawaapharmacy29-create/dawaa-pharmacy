import { useCallback, useEffect, useMemo, useState, type ElementType } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity, ActivitySquare, AlertTriangle, BarChart3, BellRing, Calendar, ChevronDown, ChevronLeft,
  ClipboardCheck, ClipboardList, Clock, Crown, FileSpreadsheet, Fingerprint, HeadphonesIcon, LayoutDashboard, LogOut,
  MessageCircle, Package, PackageSearch, PackageX, ShieldCheck, Sparkles, Star, Store, Target, TrendingDown, Truck, UserCheck,
  UserPlus, Users, Wallet, WalletCards, X,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useOptionalNavigationGuard } from '@/contexts/NavigationGuardContext';
import { usePendingShiftNotesCount } from '@/hooks/usePendingShiftNotesCount';
import { LOGO_URL } from '@/lib/constants';
import { basePath, activeItem } from '@/lib/sidebarNavigation';
import { cn } from '@/lib/utils';
import { getVisibleSectionsForPath } from '@/lib/permissionMatrix';
import { canAccessHRRoute, canManageBiometricOperations, getRoutePermissions, normalizeRole } from '@/lib/core/permissionSystem';

type NavItem = {
  path: string;
  icon: ElementType;
  label: string;
  permission?: string | string[];
  adminOnly?: boolean;
  excludeRoles?: string[];
  allowedRoles?: string[];
  biometricOnly?: boolean;
};
type NavGroup = { title: string; icon: ElementType; items: NavItem[] };
type WorkspaceGroup = NavGroup & { sections?: Array<{ title: string; items: NavItem[] }> };

const ENABLE_INTERNAL_DELIVERY_MODULE = false;
const SHIFT_NOTES_ITEM: NavItem = { path: '/shift-notes', icon: ClipboardList, label: 'ملاحظات الشيفت', permission: 'view_schedule' };
const QUICK_FOLLOWUP_ITEM: NavItem = { path: '/customer-service?quickFollowup=1', icon: HeadphonesIcon, label: 'متابعة سريعة', permission: 'view_customer_service' };
const CUSTOMER_CODING_ITEM: NavItem = { path: '/customer-coding', icon: UserPlus, label: 'تكويد عميل', permission: 'view_customer_service' };

// Navigation is grouped by user workflow, while keeping the existing routes and permissions intact.
const PAGE_GROUPS: NavGroup[] = [
  { title: 'الإدارة', icon: Crown, items: [
    { path: '/', icon: LayoutDashboard, label: 'الرئيسية', permission: 'view_dashboard', excludeRoles: ['customer_service_manager', 'procurement_manager', 'inventory_assistant', 'customer_service', 'delivery', 'cleaning_supervisor'] },
    { path: '/daily-command', icon: Target, label: 'اليوم', allowedRoles: ['general_manager', 'admin', 'executive_manager', 'branches_manager'] },
    { path: '/operations-center', icon: BellRing, label: 'المهام', permission: 'view_operations' },
    { path: '/branch-inspection', icon: ClipboardList, label: 'الزيارات', permission: 'view_branch_inspection' },
  ]},

  { title: 'الموظفون', icon: UserCheck, items: [
    { path: '/hr-workforce', icon: Crown, label: 'الموظفون' },
    { path: '/team', icon: Users, label: 'الفريق', permission: 'view_team', excludeRoles: ['customer_service_manager'] },
    { path: '/hr-staff-milestones', icon: ClipboardCheck, label: 'الملفات' },
    { path: '/schedule', icon: Calendar, label: 'الجداول', permission: 'view_schedule' },
    { path: '/time-off', icon: Calendar, label: 'الإجازات', permission: 'view_attendance_leaves' },
    { path: '/my-attendance', icon: UserCheck, label: 'حضوري' },
  ]},

  { title: 'الحضور', icon: Clock, items: [
    { path: '/attendance-report?tab=dashboard', icon: Activity, label: 'الملخص', permission: ['view_attendance_leaves','record_attendance'], allowedRoles: ['admin','general_manager','executive_manager','branches_manager','branch_manager','shift_supervisor_morning','shift_supervisor_evening'] },
    { path: '/attendance-report?tab=daily', icon: Activity, label: 'اليوم', allowedRoles: ['admin','general_manager','executive_manager','branches_manager','branch_manager','shift_supervisor_morning','shift_supervisor_evening'] },
    { path: '/attendance-report?tab=resolution', icon: ClipboardCheck, label: 'المراجعة', permission: 'view_attendance_leaves', allowedRoles: ['admin','general_manager','executive_manager','branches_manager','branch_manager','shift_supervisor_morning','shift_supervisor_evening'] },
    { path: '/attendance-report?tab=report', icon: FileSpreadsheet, label: 'السجل', permission: ['view_attendance_leaves','record_attendance'] },
    { path: '/attendance-report?tab=overtime', icon: Clock, label: 'الإضافي', permission: 'view_attendance_leaves', allowedRoles: ['admin','general_manager','executive_manager','branches_manager','branch_manager','shift_supervisor_morning','shift_supervisor_evening'] },
    { path: '/attendance-report?tab=sync', icon: Fingerprint, label: 'الأجهزة', permission: 'view_attendance_leaves', biometricOnly: true },
    { path: '/attendance-report?tab=unmapped', icon: UserCheck, label: 'ربط الأكواد', permission: 'view_attendance_leaves', biometricOnly: true },
    { path: '/attendance-report?tab=cross-branch', icon: Users, label: 'بين الفروع', permission: 'view_attendance_leaves', allowedRoles: ['admin','general_manager','executive_manager','branches_manager','branch_manager','shift_supervisor_morning','shift_supervisor_evening'] },
    { path: '/hr-data-quality', icon: ShieldCheck, label: 'جودة البيانات' },
    { path: '/hr-reports', icon: BarChart3, label: 'تقارير الموظفين', permission: 'view_attendance_leaves' },
    { path: '/hr-settings', icon: ShieldCheck, label: 'سياسات الموظفين' },
  ]},

  { title: 'الرواتب', icon: WalletCards, items: [
    { path: '/staff-payroll', icon: WalletCards, label: 'الرواتب', permission: 'manage_payroll' },
    { path: '/employee-kpi', icon: BarChart3, label: 'المؤشرات' },
    { path: '/staff-monthly-evaluation', icon: Star, label: 'التقييم الشهري' },
    { path: '/monthly-incentive-report', icon: Wallet, label: 'الحافز الشهري' },
    { path: '/penalty-incentive', icon: AlertTriangle, label: 'جزاءات ومكافآت' },
  ]},

  { title: 'العملاء', icon: HeadphonesIcon, items: [
    { path: '/customer-service', icon: HeadphonesIcon, label: 'المتابعات', permission: 'view_customer_service' },
    { path: '/customer-service?quickFollowup=1', icon: ClipboardCheck, label: 'متابعة سريعة', permission: 'view_customer_service' },
    { path: '/customer-requests', icon: PackageSearch, label: 'الطلبات', permission: 'view_customer_requests' },
    { path: '/reviews', icon: ClipboardCheck, label: 'تقييم المحادثات', permission: 'view_reviews' },
    { path: '/whatsapp-smart-folder-watcher', icon: MessageCircle, label: 'الالتقاط', permission: 'view_reviews' },
    { path: '/customer-coding', icon: UserPlus, label: 'التكويد', permission: 'view_customer_service' },
    { path: '/quick-replies', icon: HeadphonesIcon, label: 'الردود', permission: 'whatsapp_customer' },
    { path: '/welcome-messages', icon: MessageCircle, label: 'الترحيب', permission: 'customer_welcome_messages_view' },
  ]},

  { title: 'المبيعات', icon: Sparkles, items: [
    { path: '/sales-intelligence/qa', icon: ShieldCheck, label: 'حالات البيع', permission: 'view_reviews' },
  ]},

  { title: 'تجريبي', icon: MessageCircle, items: [
    { path: '/whatsapp-folder-watcher', icon: MessageCircle, label: 'مراقبة الفولدر' },
    { path: '/whatsapp-followup-requests', icon: ClipboardCheck, label: 'متابعات آلية' },
    { path: '/whatsapp-doctor-performance', icon: Star, label: 'أداء الدكاترة' },
    { path: '/whatsapp-customer-history', icon: Users, label: 'سجل المحادثات' },
    { path: '/whatsapp-lost-opportunities', icon: PackageX, label: 'الفرص الضائعة' },
    { path: '/whatsapp-branch-comparison', icon: BarChart3, label: 'مقارنة الفروع' },
  ]},

  { title: 'الولاء', icon: Users, items: [
    { path: '/customers', icon: Users, label: 'العملاء', permission: 'view_customers' },
    { path: '/customer-monthly-performance', icon: TrendingDown, label: 'نشاط العملاء', permission: 'view_customers' },
    { path: '/customer-data-review', icon: ClipboardCheck, label: 'جودة البيانات', permission: 'view_customer_details' },
    { path: '/customer-cashback', icon: WalletCards, label: 'نقاط العملاء', permission: ['view_customers','view_customer_service'] },
    { path: '/customer-points-ledger', icon: Star, label: 'حركات النقاط', permission: ['view_customers','view_customer_service'] },
  ]},

  { title: 'المبيعات', icon: BarChart3, items: [
    { path: '/analytics', icon: BarChart3, label: 'التحليلات', permission: 'view_analytics', excludeRoles: ['customer_service_manager'] },
    { path: '/branch-comparison', icon: BarChart3, label: 'الفروع', permission: 'view_branch_comparison' },
    { path: '/doctor-competition', icon: Star, label: 'المنافسة', permission: 'view_doctor_dashboard' },
    { path: '/whatsapp-analytics', icon: BarChart3, label: 'التحليلات', permission: 'view_reviews' },
    { path: '/monthly-report-360', icon: BarChart3, label: 'تقرير 360°', permission: 'view_sales_reports' },
    { path: '/reports', icon: FileSpreadsheet, label: 'التقارير', permission: 'view_sales_reports' },
  ]},

  { title: 'المشتريات', icon: FileSpreadsheet, items: [
    { path: '/invoices', icon: FileSpreadsheet, label: 'الفواتير', permission: 'view_invoices' },
    { path: '/purchases', icon: FileSpreadsheet, label: 'الأصناف', permission: 'view_purchases' },
    { path: '/purchase-invoice-entry', icon: FileSpreadsheet, label: 'إدخال فاتورة', allowedRoles: ['assistant'] },
    { path: '/purchase-invoice-review', icon: ClipboardCheck, label: 'مراجعة الفواتير', excludeRoles: ['pharmacist', 'assistant', 'customer_service_manager'] },
    { path: '/purchase-invoice-accuracy', icon: FileSpreadsheet, label: 'دقة الإدخال', allowedRoles: ['assistant', 'customer_service_manager', 'general_manager', 'branches_manager'] },
    { path: '/purchase-returns', icon: PackageX, label: 'المرتجعات', permission: 'view_purchases' },
    { path: '/purchase-cycle-report', icon: PackageSearch, label: 'دورة المشتريات', permission: 'view_purchases' },
    { path: '/supplier-accounts', icon: WalletCards, label: 'الموردون', permission: 'view_purchases' },
    { path: '/purchase-order-log', icon: ClipboardList, label: 'الطلبيات', permission: 'view_purchases' },
    { path: '/shift-handovers', icon: Clock, label: 'التسليمات', permission: 'view_purchases' },
  ]},

  { title: 'المخزون', icon: Store, items: [
    { path: '/shortages', icon: PackageSearch, label: 'النواقص', permission: 'view_shortages' },
    { path: '/stagnant-medicines', icon: Package, label: 'الرواكد', permission: 'view_stagnant_medicines' },
    { path: '/medicine-expiry', icon: AlertTriangle, label: 'الصلاحية', permission: 'view_expiry_tracker' },
    { path: '/inventory-counts', icon: ClipboardList, label: 'الجرد', permission: 'view_inventory' },
    { path: '/shelf-organization', icon: ClipboardList, label: 'الأرفف', permission: ['view_inventory','view_operations'] },
    { path: '/supplies', icon: PackageSearch, label: 'المستلزمات', permission: ['view_supplies','view_inventory'] },
    { path: '/accessories', icon: Package, label: 'الإكسسوارات', permission: ['view_operations','view_inventory'] },
    { path: '/pharmacy-zone-tasks', icon: ClipboardList, label: 'الرص والجرد', allowedRoles: ['assistant', 'delivery'] },
    { path: '/branch-checklist-review', icon: ClipboardCheck, label: 'مراجعة التشغيل', excludeRoles: ['pharmacist', 'assistant', 'customer_service_manager'] },
  ]},

  { title: 'التشغيل', icon: ClipboardList, items: [
    { path: '/employee-operating-system', icon: ClipboardList, label: 'مهام الفريق', permission: 'employee_operating_system_view', excludeRoles: ['customer_service_manager'] },
    { path: '/my-daily-checklist', icon: ClipboardCheck, label: 'مهامي', allowedRoles: ['assistant', 'cleaning_supervisor'] },
    { path: '/assistant-operational-log', icon: PackageSearch, label: 'سجل الأعمال', allowedRoles: ['assistant'] },
    { path: '/daily-manager-checklist', icon: ClipboardList, label: 'متابعة المدير', excludeRoles: ['general_manager', 'executive_manager', 'customer_service_manager'] },
  ]},

  { title: 'التقييمات', icon: ClipboardCheck, items: [
    { path: '/doctor-quality-summary', icon: Star, label: 'ملخص الأداء', excludeRoles: ['pharmacist', 'customer_service_manager'] },
    { path: '/shift-performance', icon: ClipboardList, label: 'تقييم الشيفتات', permission: 'view_shift_performance', excludeRoles: ['customer_service_manager'] },
    { path: '/weekly-evaluation/branch_manager', icon: ClipboardCheck, label: 'مدير الفرع', excludeRoles: ['branch_manager', 'customer_service_manager'] },
    { path: '/weekly-evaluation/branches_manager', icon: ClipboardCheck, label: 'مدير الفروع', excludeRoles: ['branch_manager', 'customer_service_manager'] },
    { path: '/weekly-evaluation/customer_service', icon: ClipboardCheck, label: 'خدمة العملاء', excludeRoles: ['branch_manager', 'customer_service_manager'] },
    { path: '/staff-monthly-evaluation', icon: Star, label: 'التقييم الشهري', permission: 'view_shift_performance', excludeRoles: ['customer_service_manager'] },
    { path: '/staff-monthly-evaluation', icon: Star, label: 'التقييم الشهري', permission: 'view_shift_performance', allowedRoles: ['customer_service_manager'] },
  ]},

  { title: 'الحوافز', icon: Star, items: [
    { path: '/monthly-incentive-report', icon: Wallet, label: 'الحافز الشهري', allowedRoles: ['general_manager', 'admin', 'executive_manager', 'branches_manager'] },
    { path: '/performance-pillars', icon: BarChart3, label: 'الأداء المركب', excludeRoles: ['customer_service_manager'] },
    { path: '/points', icon: Star, label: 'نقاط الموظفين', permission: 'view_points' },
    { path: '/penalty-incentive', icon: AlertTriangle, label: 'جزاءات ومكافآت', permission: 'view_penalty_management' },
    { path: '/point-appeals', icon: AlertTriangle, label: 'الاعتراضات' },
    { path: '/incentive-governance', icon: ShieldCheck, label: 'الاعتمادات', permission: 'manage_incentives' },
    { path: '/assistant-operational-bonus', icon: Sparkles, label: 'مكافآت استثنائية', permission: 'manage_incentives' },
    { path: '/quarterly-incentives', icon: Crown, label: 'الحافز الربع سنوي', permission: 'view_quarterly_incentives' },
  ]},

  { title: 'الإعدادات', icon: ShieldCheck, items: [
    { path: '/staff-accounts', icon: ShieldCheck, label: 'الحسابات', permission: 'view_staff_accounts', adminOnly: true },
    { path: '/roles-permissions', icon: ShieldCheck, label: 'الصلاحيات', permission: 'view_roles_permissions', adminOnly: true },
    { path: '/staff-duplicate-audit', icon: AlertTriangle, label: 'تكرار الموظفين', permission: 'view_staff_accounts', adminOnly: true },
    { path: '/data-health', icon: ShieldCheck, label: 'صحة البيانات', permission: 'view_data_health' },
    { path: '/activity-log', icon: ActivitySquare, label: 'سجل النظام', permission: 'view_activity_log', adminOnly: true },
  ]},

  { title: 'التوصيل', icon: Truck, items: [
    { path: '/delivery', icon: Truck, label: 'إدارة الدليفري', permission: 'view_delivery' },
  ]},
];

const PHARMACIST_GROUPS: NavGroup[] = [
  { title: 'عملي', icon: UserCheck, items: [
    { path: '/doctor-dashboard', icon: LayoutDashboard, label: 'الرئيسية', permission: 'view_doctor_dashboard' },
    { path: '/doctor-dashboard?tab=followups', icon: HeadphonesIcon, label: 'متابعاتي', permission: 'view_doctor_dashboard' },
    { path: '/schedule', icon: Calendar, label: 'جدولي', permission: 'view_schedule' },
  ]},
  { title: 'العملاء', icon: HeadphonesIcon, items: [
    { path: '/customers', icon: Users, label: 'العملاء', permission: 'view_customers' },
    { path: '/customer-points-ledger', icon: Star, label: 'نقاط العملاء', permission: 'view_customers' },
    { path: '/quick-replies', icon: HeadphonesIcon, label: 'الردود', permission: 'whatsapp_customer' },
    { path: '/welcome-messages', icon: MessageCircle, label: 'الترحيب', permission: 'customer_welcome_messages_view' },
  ]},
  { title: 'أدائي', icon: Star, items: [
    { path: '/monthly-report-360', icon: BarChart3, label: 'تقريري', permission: 'view_doctor_dashboard' },
    { path: '/doctor-dashboard?tab=reviews', icon: ClipboardCheck, label: 'تقييماتي', permission: 'view_doctor_dashboard' },
    { path: '/doctor-competition', icon: Star, label: 'المنافسة', permission: 'view_doctor_dashboard' },
    { path: '/points', icon: Star, label: 'نقاطي', permission: 'view_points' },
    { path: '/point-appeals', icon: AlertTriangle, label: 'اعتراضاتي' },
    { path: '/doctor-dashboard?tab=payroll', icon: WalletCards, label: 'مستحقاتي', permission: 'view_doctor_dashboard' },
    { path: '/doctor-dashboard?tab=activity', icon: Activity, label: 'نشاطي', permission: 'view_doctor_dashboard' },
  ]},
  { title: 'الأصناف', icon: Store, items: [
    { path: '/stagnant-medicines', icon: Package, label: 'الرواكد', permission: 'view_stagnant_medicines' },
    { path: '/incentive-medicines', icon: Sparkles, label: 'أصناف الحافز', permission: 'view_incentive_medicines' },
  ]},
];

const WORKSPACE_GROUPS = [
  { title: "الإدارة", icon: Crown, sections: [{"title": "الرئيسية", "paths": ["/"]}, {"title": "اليوم", "paths": ["/daily-command"]}] },
  { title: "الموظفون", icon: UserCheck, sections: [{"title": "الفريق", "paths": ["/hr-workforce", "/team", "/hr-staff-milestones", "/hr-data-quality"]}, {"title": "الحضور", "paths": ["/attendance-report"]}, {"title": "المواعيد", "paths": ["/schedule", "/time-off"]}, {"title": "التقييمات", "paths": ["/employee-kpi", "/staff-monthly-evaluation", "/weekly-evaluation", "/shift-performance", "/doctor-quality-summary", "/performance-pillars", "/doctor-competition", "/monthly-report-360"]}, {"title": "المستحقات", "paths": ["/staff-payroll", "/points", "/monthly-incentive-report", "/penalty-incentive", "/point-appeals", "/incentive-governance", "/assistant-operational-bonus", "/quarterly-incentives"]}] },
  { title: "العملاء", icon: Users, sections: [{"title": "العملاء", "paths": ["/customers", "/customer-monthly-performance", "/customer-data-review", "/customer-coding"]}, {"title": "المتابعات", "paths": ["/customer-service", "/customer-requests", "/whatsapp-followup-requests"]}, {"title": "الولاء", "paths": ["/customer-cashback", "/customer-points-ledger"]}, {"title": "القوالب", "paths": ["/quick-replies", "/welcome-messages"]}] },
  { title: "المحادثات", icon: MessageCircle, sections: [{"title": "المراجعات", "paths": ["/reviews", "/sales-intelligence/qa"]}, {"title": "التحليلات", "paths": ["/whatsapp-analytics"]}, {"title": "الالتقاط", "paths": ["/whatsapp-smart-folder-watcher"]}, {"title": "تجريبي", "paths": ["/whatsapp-folder-watcher", "/whatsapp-doctor-performance", "/whatsapp-customer-history", "/whatsapp-lost-opportunities", "/whatsapp-branch-comparison"]}] },
  { title: "المبيعات", icon: BarChart3, sections: [{"title": "المبيعات", "paths": ["/analytics", "/branch-comparison", "/invoices"]}] },
  { title: "المشتريات", icon: Package, sections: [{"title": "المشتريات", "paths": ["/purchases", "/purchase-invoice-entry", "/purchase-invoice-review", "/purchase-invoice-accuracy", "/purchase-returns", "/purchase-cycle-report", "/purchase-order-log"]}, {"title": "الموردون", "paths": ["/supplier-accounts"]}, {"title": "المخزون", "paths": ["/shortages", "/stagnant-medicines", "/medicine-expiry", "/inventory-counts", "/supplies", "/accessories"]}] },
  { title: "التشغيل", icon: Store, sections: [{"title": "المهام", "paths": ["/operations-center", "/employee-operating-system", "/my-daily-checklist", "/assistant-operational-log", "/daily-manager-checklist"]}, {"title": "الفروع", "paths": ["/branch-inspection", "/shelf-organization", "/pharmacy-zone-tasks", "/branch-checklist-review"]}, {"title": "الشيفتات", "paths": ["/shift-notes", "/shift-handovers"]}] },
  { title: "النظام", icon: ShieldCheck, sections: [{"title": "التقارير", "paths": ["/reports", "/hr-reports"]}, {"title": "الإعدادات", "paths": ["/hr-settings", "/staff-accounts", "/roles-permissions", "/staff-duplicate-audit", "/data-health", "/activity-log"]}, {"title": "حسابي", "paths": ["/my-attendance"]}] },
];


interface SidebarProps { collapsed: boolean; onToggle: () => void; mobileOpen: boolean; onMobileClose: () => void }

export default function Sidebar({ collapsed, onToggle, mobileOpen, onMobileClose }: SidebarProps) {
  const { user, logout, isAdmin, checkPermission } = useAuth();
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const navigate = useNavigate();
  const location = useLocation();
  const guard = useOptionalNavigationGuard();
  const pendingShiftNotes = usePendingShiftNotesCount();
  const role = normalizeRole(user?.role);
  const privileged = isAdmin || ['general_manager','executive_manager','branches_manager'].includes(role);
  const pharmacistView = ['pharmacist', 'shift_supervisor_morning', 'shift_supervisor_evening'].includes(role)
    && !checkPermission('view_executive_dashboard');

  const canAccess = useCallback((item: NavItem) => {
    if (!canAccessHRRoute(basePath(item.path), user?.role)) return false;
    if (item.biometricOnly && !canManageBiometricOperations(user?.role)) return false;
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
  }, [checkPermission, privileged, role, user?.role]);

  const canQuickFollowup = pharmacistView
    ? checkPermission('view_doctor_dashboard')
    : canAccess(QUICK_FOLLOWUP_ITEM);
  const canQuickCoding = canAccess(CUSTOMER_CODING_ITEM);
  const quickFollowupPath = pharmacistView ? '/doctor-dashboard?tab=followups' : QUICK_FOLLOWUP_ITEM.path;

  const groups = useMemo<WorkspaceGroup[]>(() => {
    if (pharmacistView) return PHARMACIST_GROUPS
      .map((group) => ({ ...group, items: group.items.filter(canAccess) }))
      .filter((group) => group.items.length);

    // Filter first: duplicate links have different role predicates. Keep the first
    // accessible variant without widening any page's existing permissions.
    const seen = new Set<string>();
    const pages = [...PAGE_GROUPS.filter((group) => group.title !== 'التوصيل' || ENABLE_INTERNAL_DELIVERY_MODULE)
      .flatMap((group) => group.items), SHIFT_NOTES_ITEM]
      .filter(canAccess).filter((item) => {
        if (seen.has(item.path)) return false;
        seen.add(item.path);
        return true;
      });
    return WORKSPACE_GROUPS.map((group) => {
      const sections = group.sections.map((section) => ({
        title: section.title,
        items: pages.filter((item) => section.paths.some((path) => basePath(item.path) === path || basePath(item.path).startsWith(`${path}/`))),
      })).filter((section) => section.items.length);
      return { ...group, sections, items: sections.flatMap((section) => section.items) };
    }).filter((group) => group.items.length);
  }, [canAccess, pharmacistView]);

  useEffect(() => {
    setExpandedGroups((previous) => {
      let changed = false;
      const next = { ...previous };
      for (const group of groups) {
        if (group.items.some((item) => activeItem(item.path, location.pathname, location.search)) && !next[group.title]) { next[group.title] = true; changed = true; }
      }
      return changed ? next : previous;
    });
  }, [groups, location.pathname, location.search]);

  const go = (target: string) => { if (guard?.hasActiveDirtyGuard()) guard.requestNavigation(target); else navigate(target); onMobileClose(); };
  const content = <div className="flex h-full flex-col">
    <div className={cn('dawaa-sidebar-divider flex items-center gap-3 border-b p-4', collapsed && 'justify-center')}><div className="logo-tile flex h-10 w-10 items-center justify-center rounded-xl"><img src={LOGO_URL} alt="Dawaa Pharmacy 2027" className="h-8 w-8 object-contain" /></div>{!collapsed ? <div className="min-w-0"><div className="dawaa-sidebar-title text-sm font-bold">Dawaa Pharmacy 2027</div><div className="dawaa-sidebar-brand truncate text-xs">نظام تشغيل الصيدلية الذكي</div></div> : null}<button onClick={onToggle} className="dawaa-sidebar-muted mr-auto hidden rounded-lg p-1.5 lg:flex"><ChevronLeft className={collapsed ? 'rotate-180' : ''} /></button></div>
    <div className="dawaa-sidebar-divider border-b p-3"><div className="dawaa-sidebar-user-card rounded-xl p-2.5 text-xs"><div className="dawaa-sidebar-title font-semibold">{user?.name}</div>{!collapsed ? <div className="dawaa-sidebar-muted">{user?.role} - {user?.branch}</div> : null}</div></div>
    {!collapsed && (canQuickFollowup || canQuickCoding) ? <div className="px-3 py-2"><div className="flex gap-2">{canQuickFollowup ? <button onClick={() => go(quickFollowupPath)} className="dawaa-sidebar-quick flex-1 rounded-lg px-3 py-2 text-xs font-bold">متابعة سريعة</button> : null}{canQuickCoding ? <button onClick={() => go(CUSTOMER_CODING_ITEM.path)} className="dawaa-sidebar-quick dawaa-sidebar-quick--secondary flex-1 rounded-lg px-3 py-2 text-xs font-bold">تكويد عميل</button> : null}</div></div> : null}
    {pharmacistView && canAccess(SHIFT_NOTES_ITEM) ? <button onClick={() => go(SHIFT_NOTES_ITEM.path)} className="nav-item nav-item-inactive mx-3 my-2"><ClipboardList size={18} />{!collapsed ? <span className="flex w-full justify-between">ملاحظات الشيفت{pendingShiftNotes ? <b className="dawaa-sidebar-count rounded-full px-2">{pendingShiftNotes}</b> : null}</span> : null}</button> : null}
    <nav aria-label="القائمة الرئيسية" className="flex-1 space-y-2 overflow-y-auto p-3">
      {groups.map((group) => {
        const active = group.items.some((item) => activeItem(item.path, location.pathname, location.search));
        const expanded = collapsed || expandedGroups[group.title] || active;
        const renderItem = (item: NavItem) => {
          const itemActive = activeItem(item.path, location.pathname, location.search);
          const sections = getVisibleSectionsForPath(basePath(item.path), checkPermission);
          return <div key={item.path}>
            <Link to={item.path} title={item.label} aria-current={itemActive ? 'page' : undefined}
              onClick={(event) => { if (guard?.hasActiveDirtyGuard()) { event.preventDefault(); guard.requestNavigation(item.path); } onMobileClose(); }}
              className={cn('nav-item', itemActive ? 'nav-item-active' : 'nav-item-inactive', collapsed && 'justify-center px-2')}>
              <item.icon size={18} />{!collapsed ? <span>{item.label}{item.path === '/shift-notes' && pendingShiftNotes ? ` (${pendingShiftNotes})` : ''}</span> : null}
            </Link>
            {!collapsed && itemActive && sections.length ? <div className="dawaa-sidebar-section-label mr-8 border-r pr-3">{sections.map((section) => <div key={section.key} className="px-2 py-1 text-[11px]">{section.label}</div>)}</div> : null}
          </div>;
        };
        return <div key={group.title} className="space-y-1">
          {!collapsed ? <button type="button" aria-expanded={Boolean(expanded)} onClick={() => setExpandedGroups((value) => ({ ...value, [group.title]: !value[group.title] }))}
            className={cn('dawaa-sidebar-group flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold', active && 'is-active')}>
            <group.icon size={15} /><span className="flex-1 text-right">{group.title}</span><ChevronDown size={14} className={expanded ? 'rotate-180' : ''} />
          </button> : null}
          {expanded ? <div className={cn('space-y-1', !collapsed && 'pr-2')}>
            {group.sections && !collapsed ? group.sections.map((section) => {
              const sectionActive = section.items.some((item) => activeItem(item.path, location.pathname, location.search));
              const sectionKey = `${group.title}/${section.title}`;
              const open = sectionActive || expandedGroups[sectionKey];
              if (section.items.length === 1) return <div key={section.title}>{section.items.map(renderItem)}</div>;
              return <div key={section.title}>
                <button type="button" aria-expanded={Boolean(open)} onClick={() => setExpandedGroups((value) => ({ ...value, [sectionKey]: !value[sectionKey] }))}
                  className="dawaa-sidebar-muted flex w-full items-center justify-between rounded-lg px-3 py-2 text-right text-xs font-semibold">
                  {section.title}<ChevronDown size={13} className={open ? 'rotate-180' : ''} />
                </button>
                {open ? <div className="space-y-0.5 border-r pr-2">{section.items.map(renderItem)}</div> : null}
              </div>;
            }) : group.items.map(renderItem)}
          </div> : null}
        </div>;
      })}
    </nav>
    <div className="dawaa-sidebar-divider border-t p-3"><button onClick={() => { logout(); navigate('/login'); }} className="nav-item nav-item-inactive dawaa-sidebar-logout w-full"><LogOut size={18} />{!collapsed ? 'تسجيل الخروج' : null}</button></div>
  </div>;

  return <><aside className={cn('dawaa-sidebar hidden flex-shrink-0 flex-col border-l lg:flex', collapsed ? 'w-16' : 'w-72')}>{content}</aside>{mobileOpen ? <div className="fixed inset-0 z-50 flex lg:hidden"><div className="dawaa-mobile-backdrop fixed inset-0" onClick={onMobileClose} /><aside className="dawaa-sidebar relative mr-auto flex h-full w-72 flex-col border-l"><button onClick={onMobileClose} className="dawaa-sidebar-muted absolute left-4 top-4 z-10"><X /></button>{content}</aside></div> : null}</>;
}
