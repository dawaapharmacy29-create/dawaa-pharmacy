import { useEffect, useMemo, useState, type ElementType } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity, ActivitySquare, AlertTriangle, BarChart3, BellRing, Calendar, ChevronDown, ChevronLeft,
  ClipboardCheck, ClipboardList, Crown, FileSpreadsheet, HeadphonesIcon, LayoutDashboard, LogOut,
  MessageCircle, Package, PackageSearch, ShieldCheck, Sparkles, Star, Store, TrendingDown, Truck, UserCheck,
  UserPlus, Users, Wallet, WalletCards, X,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useOptionalNavigationGuard } from '@/contexts/NavigationGuardContext';
import { usePendingShiftNotesCount } from '@/hooks/usePendingShiftNotesCount';
import { LOGO_URL } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { getVisibleSectionsForPath } from '@/lib/permissionMatrix';
import { getRoutePermissions, normalizeRole } from '@/lib/core/permissionSystem';

type NavItem = {
  path: string;
  icon: ElementType;
  label: string;
  permission?: string | string[];
  adminOnly?: boolean;
  excludeRoles?: string[];
  allowedRoles?: string[];
};
type NavGroup = { title: string; icon: ElementType; items: NavItem[] };

const ENABLE_INTERNAL_DELIVERY_MODULE = false;
const SHIFT_NOTES_ITEM: NavItem = { path: '/shift-notes', icon: ClipboardList, label: 'ملاحظات الشيفت', permission: 'view_schedule' };
const QUICK_FOLLOWUP_ITEM: NavItem = { path: '/customer-service?quickFollowup=1', icon: HeadphonesIcon, label: 'متابعة سريعة', permission: 'view_customer_service' };
const CUSTOMER_CODING_ITEM: NavItem = { path: '/customer-coding', icon: UserPlus, label: 'تكويد عميل', permission: 'view_customer_service' };

// Navigation is grouped by user workflow, while keeping the existing routes and permissions intact.
const GROUPS: NavGroup[] = [
  { title: 'الرئيسية والإدارة', icon: Crown, items: [
    { path: '/', icon: LayoutDashboard, label: 'لوحة الإدارة', permission: 'view_dashboard', excludeRoles: ['customer_service_manager', 'procurement_manager', 'inventory_assistant', 'customer_service', 'delivery', 'cleaning_supervisor'] },
    { path: '/operations-center', icon: BellRing, label: 'مركز المهام والتنبيهات', permission: 'view_operations' },
    { path: '/branch-inspection', icon: ClipboardList, label: 'متابعة ومرور الفروع', permission: 'view_branch_inspection' },
  ]},

  { title: 'الموظفون والموارد البشرية', icon: UserCheck, items: [
    { path: '/team', icon: UserCheck, label: 'الموظفون', permission: 'view_team', excludeRoles: ['customer_service_manager'] },
    { path: '/schedule', icon: Calendar, label: 'الجداول والشيفتات', permission: 'view_schedule' },
    { path: '/attendance-report', icon: ClipboardCheck, label: 'الحضور والانصراف', permission: ['view_attendance_leaves','record_attendance'] },
    { path: '/time-off', icon: Calendar, label: 'الإجازات والأذونات', permission: 'view_attendance_leaves' },
    { path: '/staff-payroll', icon: WalletCards, label: 'الرواتب', permission: 'manage_payroll' },
  ]},

  { title: 'خدمة العملاء والمتابعات', icon: HeadphonesIcon, items: [
    { path: '/customer-service', icon: HeadphonesIcon, label: 'مركز خدمة العملاء', permission: 'view_customer_service' },
    { path: '/customer-service?quickFollowup=1', icon: ClipboardCheck, label: 'متابعة العملاء', permission: 'view_customer_service' },
    { path: '/customer-requests', icon: PackageSearch, label: 'طلبات العملاء', permission: 'view_customer_requests' },
    { path: '/reviews', icon: ClipboardCheck, label: 'تقييم المحادثات', permission: 'view_reviews' },
    { path: '/customer-coding', icon: UserPlus, label: 'تكويد العملاء', permission: 'view_customer_service' },
    { path: '/quick-replies', icon: HeadphonesIcon, label: 'الردود السريعة', permission: 'whatsapp_customer' },
    { path: '/welcome-messages', icon: MessageCircle, label: 'رسائل الترحيب', permission: 'customer_welcome_messages_view' },
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
    { path: '/whatsapp-analytics', icon: BarChart3, label: 'تحليلات واتساب', permission: 'view_reviews' },
    { path: '/monthly-report-360', icon: BarChart3, label: 'تقرير الأداء الشهري 360°', permission: 'view_sales_reports' },
    { path: '/reports', icon: FileSpreadsheet, label: 'مركز التقارير', permission: 'view_sales_reports' },
  ]},

  { title: 'الفواتير والمشتريات', icon: FileSpreadsheet, items: [
    { path: '/invoices', icon: FileSpreadsheet, label: 'استيراد فواتير المبيعات', permission: 'view_invoices' },
    { path: '/purchases', icon: FileSpreadsheet, label: 'المشتريات', permission: 'view_purchases' },
    { path: '/purchase-invoice-entry', icon: FileSpreadsheet, label: 'إدخال فاتورة مشتريات', allowedRoles: ['assistant'] },
    { path: '/purchase-invoice-review', icon: ClipboardCheck, label: 'مراجعة فواتير المشتريات', excludeRoles: ['pharmacist', 'assistant', 'customer_service_manager'] },
    { path: '/purchase-invoice-accuracy', icon: FileSpreadsheet, label: 'دقة إدخال فواتير المشتريات', allowedRoles: ['assistant', 'customer_service_manager', 'general_manager', 'branches_manager'] },
  ]},

  { title: 'المخزون وتشغيل الصيدلية', icon: Store, items: [
    { path: '/shortages', icon: PackageSearch, label: 'النواقص', permission: 'view_shortages' },
    { path: '/stagnant-medicines', icon: Package, label: 'الرواكد', permission: 'view_stagnant_medicines' },
    { path: '/medicine-expiry', icon: AlertTriangle, label: 'متابعة الصلاحية', permission: 'view_expiry_tracker' },
    { path: '/inventory-counts', icon: ClipboardList, label: 'الجرد', permission: 'view_inventory' },
    { path: '/shelf-organization', icon: ClipboardList, label: 'تنظيم ورص الأرفف', permission: ['view_inventory','view_operations'] },
    { path: '/supplies', icon: PackageSearch, label: 'متابعة المستلزمات', permission: ['view_supplies','view_inventory'] },
    { path: '/accessories', icon: Package, label: 'متابعة الإكسسوارات', permission: ['view_operations','view_inventory'] },
    { path: '/pharmacy-zone-tasks', icon: ClipboardList, label: 'الرص والجرد اليومي', allowedRoles: ['assistant', 'delivery'] },
    { path: '/branch-checklist-review', icon: ClipboardCheck, label: 'مراجعة النظافة والرص والجرد', excludeRoles: ['pharmacist', 'assistant', 'customer_service_manager'] },
  ]},

  { title: 'المهام والتشغيل اليومي', icon: ClipboardList, items: [
    { path: '/employee-operating-system', icon: ClipboardList, label: 'مهام الفريق', permission: 'employee_operating_system_view', excludeRoles: ['customer_service_manager'] },
    { path: '/my-daily-checklist', icon: ClipboardCheck, label: 'مهامي اليومية', allowedRoles: ['assistant', 'cleaning_supervisor'] },
    { path: '/assistant-operational-log', icon: PackageSearch, label: 'سجل أعمال المساعد', allowedRoles: ['assistant'] },
    { path: '/daily-manager-checklist', icon: ClipboardList, label: 'مهام الإدارة اليومية', excludeRoles: ['general_manager', 'executive_manager', 'customer_service_manager'] },
  ]},

  { title: 'الأداء والتقييمات', icon: ClipboardCheck, items: [
    { path: '/doctor-quality-summary', icon: Star, label: 'ملخص أداء الدكاترة', excludeRoles: ['pharmacist', 'customer_service_manager'] },
    { path: '/shift-performance', icon: ClipboardList, label: 'تقييم أداء الشيفتات', permission: 'view_shift_performance', excludeRoles: ['customer_service_manager'] },
    { path: '/weekly-evaluation/branch_manager', icon: ClipboardCheck, label: 'تقييم مدير الفرع', excludeRoles: ['branch_manager', 'customer_service_manager'] },
    { path: '/weekly-evaluation/branches_manager', icon: ClipboardCheck, label: 'تقييم مدير الفروع', excludeRoles: ['branch_manager', 'customer_service_manager'] },
    { path: '/weekly-evaluation/customer_service', icon: ClipboardCheck, label: 'تقييم فريق خدمة العملاء ودواء ألفا', excludeRoles: ['branch_manager', 'customer_service_manager'] },
    { path: '/staff-monthly-evaluation', icon: Star, label: 'التقييم الشهري للدكاترة وخدمة العملاء', permission: 'view_shift_performance', excludeRoles: ['customer_service_manager'] },
    { path: '/staff-monthly-evaluation', icon: Star, label: 'تقييم الدكاترة من خدمة العملاء', permission: 'view_shift_performance', allowedRoles: ['customer_service_manager'] },
  ]},

  { title: 'النقاط والحوافز', icon: Star, items: [
    { path: '/monthly-incentive-report', icon: Wallet, label: 'ملخص الحوافز الشهري', allowedRoles: ['general_manager', 'admin', 'executive_manager', 'branches_manager'] },
    { path: '/performance-pillars', icon: BarChart3, label: 'مؤشر الأداء الشامل', excludeRoles: ['customer_service_manager'] },
    { path: '/points', icon: Star, label: 'نقاط الأداء', permission: 'view_points' },
    { path: '/penalty-incentive', icon: AlertTriangle, label: 'الجزاءات والمكافآت', permission: 'view_penalty_management' },
    { path: '/point-appeals', icon: AlertTriangle, label: 'اعتراضات النقاط' },
    { path: '/incentive-governance', icon: ShieldCheck, label: 'اعتماد الحوافز', permission: 'manage_incentives' },
    { path: '/assistant-operational-bonus', icon: Sparkles, label: 'المكافآت الاستثنائية', permission: 'manage_incentives' },
    { path: '/quarterly-incentives', icon: Crown, label: 'نظام وقواعد الحافز', permission: 'view_quarterly_incentives' },
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
];

const PHARMACIST_GROUPS: NavGroup[] = [
  { title: 'عملي اليومي', icon: UserCheck, items: [
    { path: '/doctor-dashboard', icon: LayoutDashboard, label: 'لوحة الدكتور', permission: 'view_doctor_dashboard' },
    { path: '/doctor-dashboard?tab=followups', icon: HeadphonesIcon, label: 'متابعاتي المطلوبة', permission: 'view_doctor_dashboard' },
    { path: '/schedule', icon: Calendar, label: 'الجدول والشيفتات', permission: 'view_schedule' },
  ]},
  { title: 'العملاء والمحادثات', icon: HeadphonesIcon, items: [
    { path: '/customers', icon: Users, label: 'بحث العملاء', permission: 'view_customers' },
    { path: '/customer-points-ledger', icon: Star, label: 'نقاط العملاء', permission: 'view_customers' },
    { path: '/quick-replies', icon: HeadphonesIcon, label: 'الردود السريعة', permission: 'whatsapp_customer' },
    { path: '/welcome-messages', icon: MessageCircle, label: 'رسائل الترحيب', permission: 'customer_welcome_messages_view' },
  ]},
  { title: 'أدائي وحافزي', icon: Star, items: [
    { path: '/monthly-report-360', icon: BarChart3, label: 'تقريري الشهري 360°', permission: 'view_doctor_dashboard' },
    { path: '/doctor-dashboard?tab=reviews', icon: ClipboardCheck, label: 'تقييماتي الشخصية', permission: 'view_doctor_dashboard' },
    { path: '/doctor-competition', icon: Star, label: 'مسابقة الدكاترة', permission: 'view_doctor_dashboard' },
    { path: '/points', icon: Star, label: 'نقاطي وحافزي', permission: 'view_points' },
    { path: '/point-appeals', icon: AlertTriangle, label: 'اعتراضاتي على النقاط' },
    { path: '/doctor-dashboard?tab=payroll', icon: WalletCards, label: 'راتبي ومستحقاتي', permission: 'view_doctor_dashboard' },
    { path: '/doctor-dashboard?tab=notifications', icon: BellRing, label: 'إشعاراتي', permission: 'view_doctor_dashboard' },
    { path: '/doctor-dashboard?tab=activity', icon: Activity, label: 'سجل نشاطي', permission: 'view_doctor_dashboard' },
  ]},
  { title: 'الأصناف والتشغيل', icon: Store, items: [
    { path: '/stagnant-medicines', icon: Package, label: 'الرواكد', permission: 'view_stagnant_medicines' },
    { path: '/incentive-medicines', icon: Sparkles, label: 'أصناف الحافز', permission: 'view_incentive_medicines' },
  ]},
];

function basePath(path: string) { return path.split('?')[0]; }
function activeItem(itemPath: string, pathname: string, search: string) {
  const base = basePath(itemPath);
  if (base === '/') return pathname === '/';
  if (base === '/team' && pathname.startsWith('/staff/')) return true;
  if (pathname !== base && !pathname.startsWith(`${base}/`)) return false;
  const expectedTab = new URLSearchParams(itemPath.split('?')[1] || '').get('tab');
  return expectedTab ? new URLSearchParams(search).get('tab') === expectedTab : !new URLSearchParams(search).get('tab');
}

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

  const canAccess = (item: NavItem) => {
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
  };

  const canQuickFollowup = pharmacistView
    ? checkPermission('view_doctor_dashboard')
    : canAccess(QUICK_FOLLOWUP_ITEM);
  const canQuickCoding = canAccess(CUSTOMER_CODING_ITEM);
  const quickFollowupPath = pharmacistView ? '/doctor-dashboard?tab=followups' : QUICK_FOLLOWUP_ITEM.path;

  const groups = useMemo(() => (pharmacistView ? PHARMACIST_GROUPS : GROUPS)
    .filter((group) => group.title !== 'التوصيل' || ENABLE_INTERNAL_DELIVERY_MODULE)
    .map((group) => ({ ...group, items: group.items.filter(canAccess) }))
    .filter((group) => group.items.length), [checkPermission, pharmacistView, privileged, role]);

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
    {canAccess(SHIFT_NOTES_ITEM) ? <button onClick={() => go(SHIFT_NOTES_ITEM.path)} className="nav-item nav-item-inactive mx-3 my-2"><ClipboardList size={18} />{!collapsed ? <span className="flex w-full justify-between">ملاحظات الشيفت{pendingShiftNotes ? <b className="dawaa-sidebar-count rounded-full px-2">{pendingShiftNotes}</b> : null}</span> : null}</button> : null}
    <nav className="flex-1 space-y-2 overflow-y-auto p-3">{groups.map((group) => { const active = group.items.some((item) => activeItem(item.path, location.pathname, location.search)); const expanded = collapsed || expandedGroups[group.title] || active; return <div key={group.title} className="space-y-1">{!collapsed ? <button type="button" onClick={() => setExpandedGroups((value) => ({...value,[group.title]:!value[group.title]}))} className={cn('dawaa-sidebar-group flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold', active && 'is-active')}><group.icon size={15} /><span className="flex-1 text-right">{group.title}</span><ChevronDown size={14} className={expanded ? 'rotate-180' : ''} /></button> : null}{expanded ? <div className={cn('space-y-0.5', !collapsed && 'pr-2')}>{group.items.map((item) => { const itemActive = activeItem(item.path, location.pathname, location.search); const sections = getVisibleSectionsForPath(basePath(item.path), checkPermission); return <div key={`${item.path}-${item.label}`}><NavLink to={item.path} onClick={(event) => { if (guard?.hasActiveDirtyGuard()) { event.preventDefault(); guard.requestNavigation(item.path); } onMobileClose(); }} className={cn('nav-item', itemActive ? 'nav-item-active' : 'nav-item-inactive', collapsed && 'justify-center px-2')}><item.icon size={18} />{!collapsed ? <span>{item.label}</span> : null}</NavLink>{!collapsed && itemActive && sections.length ? <div className="dawaa-sidebar-section-label mr-8 border-r pr-3">{sections.map((section) => <div key={section.key} className="px-2 py-1 text-[11px]">{section.label}</div>)}</div> : null}</div>;})}</div> : null}</div>;})}</nav>
    <div className="dawaa-sidebar-divider border-t p-3"><button onClick={() => { logout(); navigate('/login'); }} className="nav-item nav-item-inactive dawaa-sidebar-logout w-full"><LogOut size={18} />{!collapsed ? 'تسجيل الخروج' : null}</button></div>
  </div>;

  return <><aside className={cn('dawaa-sidebar hidden flex-shrink-0 flex-col border-l lg:flex', collapsed ? 'w-16' : 'w-72')}>{content}</aside>{mobileOpen ? <div className="fixed inset-0 z-50 flex lg:hidden"><div className="dawaa-mobile-backdrop fixed inset-0" onClick={onMobileClose} /><aside className="dawaa-sidebar relative mr-auto flex h-full w-72 flex-col border-l"><button onClick={onMobileClose} className="dawaa-sidebar-muted absolute left-4 top-4 z-10"><X /></button>{content}</aside></div> : null}</>;
}
