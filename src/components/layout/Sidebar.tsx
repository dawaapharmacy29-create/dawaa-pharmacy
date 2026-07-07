import { useEffect, useMemo, useState, type ElementType } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  ActivitySquare,
  AlertTriangle,
  BarChart3,
  BellRing,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ClipboardCheck,
  ClipboardList,
  Crown,
  FileSpreadsheet,
  HeadphonesIcon,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  Package,
  PackageSearch,
  ShieldCheck,
  Sparkles,
  Star,
  Store,
  Truck,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useOptionalNavigationGuard } from '@/contexts/NavigationGuardContext';
import { usePendingShiftNotesCount } from '@/hooks/usePendingShiftNotesCount';
import { LOGO_URL } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { getVisibleSectionsForPath } from '@/lib/permissionMatrix';
import { isDoctorRole } from '@/lib/security/userDataScope';

type NavItem = {
  path: string;
  icon: ElementType;
  label: string;
  permission?: string | string[];
  adminOnly?: boolean;
};

type NavGroup = {
  title: string;
  icon: ElementType;
  items: NavItem[];
};

const T = {
  appName: 'Dawaa Pharmacy 2027',
  system: 'نظام تشغيل الصيدلية الذكي',
  allBranches: 'كل الفروع',
  logout: 'تسجيل الخروج',
};

/** تطبيق الدليفري منفصل — إخفاء مجموعة الدليفري من تطبيق الإدارة */
const ENABLE_INTERNAL_DELIVERY_MODULE = false;

const SHIFT_NOTES_ITEM: NavItem = {
  path: '/shift-notes',
  icon: ClipboardList,
  label: 'ملاحظات الشيفت',
  permission: 'view_schedule',
};

const GROUPS: NavGroup[] = [
  {
    title: 'لوحة القيادة',
    icon: Crown,
    items: [
      { path: '/', icon: LayoutDashboard, label: 'لوحة القيادة 2027', permission: 'view_dashboard' },
      { path: '/executive-2027', icon: Crown, label: 'الداشبورد التنفيذي', permission: ['view_executive_dashboard', 'view_branch_dashboard'] },
      { path: '/branch-inspection', icon: ClipboardList, label: 'مرور مدير الفروع', permission: 'view_branch_inspection' },
      { path: '/operations-center', icon: BellRing, label: 'المهام والتنبيهات', permission: 'view_operations' },
      { path: '/data-health', icon: ShieldCheck, label: 'صحة البيانات', permission: 'view_data_health' },
      { path: '/activity-log', icon: ActivitySquare, label: 'سجل الأنشطة', permission: 'view_activity_log', adminOnly: true },
    ],
  },
  {
    title: 'الموظفون والحضور',
    icon: UserCheck,
    items: [
      { path: '/team', icon: UserCheck, label: 'الفريق / الموظفون', permission: 'view_team' },
      { path: '/staff-accounts', icon: ShieldCheck, label: 'الحسابات والصلاحيات', permission: 'view_staff_accounts', adminOnly: true },
      { path: '/roles-permissions', icon: ShieldCheck, label: 'إعدادات الصلاحيات', permission: 'view_roles_permissions', adminOnly: true },
      { path: '/schedule', icon: Calendar, label: 'الجداول والشيفتات', permission: 'view_schedule' },
      { path: '/attendance-report', icon: ClipboardCheck, label: 'تسجيل/تقرير الحضور', permission: ['view_attendance_leaves', 'record_attendance'] },
      { path: '/time-off', icon: Calendar, label: 'الأذونات والإجازات', permission: ['view_attendance_leaves', 'create_leave_request'] },
      { path: '/shift-performance', icon: ClipboardList, label: 'تقييمات الشيفتات', permission: 'view_shift_performance' },
      { path: '/employee-operating-system', icon: ClipboardList, label: 'مهام الفريق', permission: 'employee_operating_system.view' },
    ],
  },
  {
    title: 'العملاء وخدمة العملاء',
    icon: HeadphonesIcon,
    items: [
      { path: '/customer-service?quickFollowup=1', icon: HeadphonesIcon, label: 'متابعة العملاء وخدمة العملاء', permission: 'view_customer_service' },
      { path: '/customer-coding', icon: UserPlus, label: 'تكويد العملاء', permission: 'view_customer_service' },
      { path: '/customers', icon: Users, label: 'قاعدة العملاء', permission: 'view_customers' },
      { path: '/customer-data-review', icon: ClipboardCheck, label: 'مراجعة بيانات العملاء', permission: 'view_customer_details' },
      { path: '/reviews', icon: ClipboardCheck, label: 'تقييم المحادثات', permission: 'view_reviews' },
      { path: '/quick-replies', icon: HeadphonesIcon, label: 'الردود السريعة', permission: 'whatsapp_customer' },
      { path: '/welcome-messages', icon: MessageCircle, label: 'رسائل الترحيب', permission: 'customer_welcome_messages.view' },
    ],
  },
  {
    title: 'المبيعات والتحليل',
    icon: BarChart3,
    items: [
      { path: '/analytics', icon: BarChart3, label: 'التحليلات والمبيعات', permission: 'view_analytics' },
      { path: '/invoices', icon: FileSpreadsheet, label: 'استيراد الفواتير', permission: 'view_invoices' },
      { path: '/branch-comparison', icon: BarChart3, label: 'مقارنة الفروع', permission: 'view_branch_comparison' },
      { path: '/doctor-competition', icon: Star, label: 'مسابقة الدكاترة', permission: 'view_doctor_dashboard' },
      { path: '/whatsapp-analytics', icon: BarChart3, label: 'تحليلات واتساب', permission: 'view_reviews' },
      { path: '/reports', icon: FileSpreadsheet, label: 'مركز التقارير', permission: 'view_sales_reports' },
    ],
  },
  {
    title: 'التشغيل والمخزون',
    icon: Store,
    items: [
      { path: '/stagnant-medicines', icon: Package, label: 'الرواكد واللستة', permission: 'view_stagnant_medicines' },
      { path: '/shortages', icon: PackageSearch, label: 'النواقص', permission: 'view_shortages' },
      { path: '/medicine-expiry', icon: AlertTriangle, label: 'الصلاحية', permission: 'view_expiry_tracker' },
      { path: '/inventory-counts', icon: ClipboardList, label: 'الجرد', permission: 'view_inventory' },
      { path: '/purchases', icon: FileSpreadsheet, label: 'المشتريات', permission: 'view_purchases' },
      { path: '/supplies', icon: PackageSearch, label: 'المستلزمات', permission: 'view_supplies' },
    ],
  },
  {
    title: 'الدليفري',
    icon: Truck,
    items: [
      { path: '/delivery', icon: Truck, label: 'لوحة الدليفري', permission: 'view_delivery' },
      { path: '/delivery', icon: Users, label: 'المناديب', permission: 'view_delivery' },
      { path: '/attendance-report', icon: ClipboardCheck, label: 'حضور الدليفري', permission: 'record_attendance' },
      { path: '/delivery', icon: FileSpreadsheet, label: 'أوردرات الدليفري', permission: 'view_delivery' },
      { path: '/delivery', icon: Truck, label: 'مشاوير الدليفري', permission: 'view_delivery' },
      { path: '/delivery', icon: FileSpreadsheet, label: 'مطابقة الفواتير', permission: 'view_delivery' },
      { path: '/delivery', icon: Truck, label: 'أجهزة الدليفري المعتمدة', permission: 'view_delivery' },
    ],
  },
  {
    title: 'الحوافز والرواتب',
    icon: Star,
    items: [
      { path: '/points', icon: Star, label: 'النقاط', permission: 'view_points' },
      { path: '/staff-payroll', icon: Wallet, label: 'الرواتب', permission: 'view_salary_calculator' },
      { path: '/quarterly-incentives', icon: Crown, label: 'شرح الحافز الشهري', permission: 'view_quarterly_incentives' },
      { path: '/penalty-incentive', icon: AlertTriangle, label: 'الجزاءات والمكافآت', permission: 'view_penalty_management' },
      { path: '/evaluation-rules', icon: ClipboardCheck, label: 'قواعد التقييم', permission: 'manage_permissions', adminOnly: true },
    ],
  },
];

const PHARMACIST_GROUPS: NavGroup[] = [
  {
    title: 'مساحة الدكتور',
    icon: UserCheck,
    items: [
      { path: '/doctor-dashboard', icon: LayoutDashboard, label: 'لوحة الدكتور', permission: 'view_doctor_dashboard' },
      { path: '/doctor-competition', icon: Star, label: 'مسابقة الدكاترة', permission: 'view_doctor_dashboard' },
      { path: '/customer-service?quickFollowup=1', icon: HeadphonesIcon, label: 'متابعة العملاء', permission: 'view_customer_service' },
      { path: '/quick-replies', icon: HeadphonesIcon, label: 'الردود السريعة', permission: 'whatsapp_customer' },
      { path: '/welcome-messages', icon: MessageCircle, label: 'رسائل الترحيب', permission: 'customer_welcome_messages.view' },
      { path: '/reviews', icon: ClipboardCheck, label: 'تقييم المحادثات', permission: 'view_reviews' },
      { path: '/points', icon: Star, label: 'النقاط والحافز', permission: 'view_points' },
      { path: '/stagnant-medicines', icon: Package, label: 'الرواكد', permission: 'view_stagnant_medicines' },
      { path: '/incentive-medicines', icon: Sparkles, label: 'اللستة', permission: 'view_incentive_medicines' },
      { path: '/shortages', icon: PackageSearch, label: 'النواقص', permission: 'view_shortages' },
      { path: '/schedule', icon: Calendar, label: 'الجدول', permission: 'view_schedule' },
    ],
  },
];

function navItemBasePath(itemPath: string) {
  return itemPath.split('?')[0];
}

function isRouteActive(itemPath: string, pathname: string) {
  const basePath = navItemBasePath(itemPath);
  if (basePath === '/') return pathname === '/' || pathname === '/executive-2027';
  if (basePath === '/team' && pathname.startsWith('/staff/')) return true;
  if (basePath === '/analytics' && pathname === '/analytics-sales') return true;
  if (basePath === '/customer-service' && pathname.startsWith('/customer-service')) return true;
  return pathname === basePath || pathname.startsWith(`${basePath}/`);
}

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export default function Sidebar({ collapsed, onToggle, mobileOpen, onMobileClose }: SidebarProps) {
  const { user, logout, isAdmin, checkPermission } = useAuth();
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const navigate = useNavigate();
  const location = useLocation();
  const navigationGuard = useOptionalNavigationGuard();
  const pendingShiftNotes = usePendingShiftNotesCount();

  const goTo = (target: string) => {
    if (navigationGuard) navigationGuard.requestNavigation(target);
    else navigate(target);
  };

  const privileged = isAdmin || ['general_manager', 'executive_manager', 'branches_manager', 'branch_manager', 'مدير عام', 'مدير فرع'].includes(user?.role || '');
  const pharmacistView = isDoctorRole(user) && !checkPermission('view_executive_dashboard');

  const canAccessItem = (item: NavItem) => {
    if (item.adminOnly && !privileged) return false;
    if (!item.permission) return true;
    if (Array.isArray(item.permission)) {
      return privileged || item.permission.some((permission) => checkPermission(permission));
    }
    return privileged || checkPermission(item.permission);
  };

  const groups = useMemo(() => {
    const sourceGroups = pharmacistView ? PHARMACIST_GROUPS : GROUPS;
    return sourceGroups
      .filter((group) => group.title !== 'الدليفري' || ENABLE_INTERNAL_DELIVERY_MODULE)
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => canAccessItem(item)),
      }))
      .filter((group) => group.items.length > 0);
  }, [checkPermission, pharmacistView, privileged, user]);

  const showPinnedShiftNotes = canAccessItem(SHIFT_NOTES_ITEM);

  useEffect(() => {
    setExpandedGroups((prev) => {
      const next = { ...prev };
      for (const group of groups) {
        const active = group.items.some((item) => isRouteActive(item.path, location.pathname));
        if (active) next[group.title] = true;
      }
      return next;
    });
  }, [location.pathname, groups]);

  const toggleGroup = (title: string) => {
    setExpandedGroups((prev) => ({ ...prev, [title]: !prev[title] }));
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const SidebarContent = () => (
    <div className="flex h-full flex-col">
      <div className={cn('flex items-center gap-3 border-b border-[#2d4063] p-4', collapsed ? 'justify-center' : '')}>
        <div className="logo-tile flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl">
          <img src={LOGO_URL} alt={T.appName} className="h-8 w-8 object-contain" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="text-sm font-bold leading-tight text-white">{T.appName}</div>
            <div className="truncate text-xs text-teal-400">{T.system}</div>
          </div>
        )}
        <button
          onClick={onToggle}
          className="mr-auto hidden rounded-lg p-1.5 text-slate-400 transition-all hover:bg-white/5 hover:text-white lg:flex"
          aria-label="toggle sidebar"
        >
          <ChevronLeft className={cn('h-4 w-4 transition-transform duration-200', collapsed ? 'rotate-180' : '')} />
        </button>
      </div>

      <div className={cn('border-b border-[#2d4063] px-3 py-3', collapsed ? 'flex justify-center' : '')}>
        {collapsed ? (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-500/20 text-xs font-bold text-teal-400">
            {user?.name?.[0]}
          </div>
        ) : (
          <div className="flex items-center gap-2.5 rounded-xl bg-white/5 p-2.5">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-teal-500/20 text-xs font-bold text-teal-400">
              {user?.name?.[0]}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-white">{user?.name}</div>
              <div className="truncate text-xs text-slate-400">
                {user?.role} - {user?.branch === 'الكل' ? T.allBranches : user?.branch}
              </div>
            </div>
          </div>
        )}
      </div>

      {!collapsed && (
        <div className="px-3 py-2">
          <div className="flex gap-2">
            <button
              onClick={() => goTo('/customer-service?quickFollowup=1')}
              className="flex-1 rounded-lg bg-teal-500/10 px-3 py-2 text-xs font-bold text-teal-200"
            >
              متابعة سريعة
            </button>
            <button
              onClick={() => goTo('/customer-coding')}
              className="flex-1 rounded-lg bg-sky-500/10 px-3 py-2 text-xs font-bold text-sky-200"
            >
              تكويد عميل
            </button>
          </div>
        </div>
      )}

      {showPinnedShiftNotes && (
        <div className={cn('border-b border-[#2d4063] px-3 py-2', collapsed ? 'flex justify-center' : '')}>
          <NavLink
            to={SHIFT_NOTES_ITEM.path}
            onClick={(event) => {
              if (navigationGuard?.hasActiveDirtyGuard()) {
                event.preventDefault();
                navigationGuard.requestNavigation(SHIFT_NOTES_ITEM.path);
              }
              onMobileClose();
            }}
            className={() =>
              cn(
                'nav-item',
                isRouteActive(SHIFT_NOTES_ITEM.path, location.pathname)
                  ? 'nav-item-active'
                  : 'nav-item-inactive',
                collapsed ? 'justify-center px-2' : ''
              )
            }
            title={collapsed ? SHIFT_NOTES_ITEM.label : undefined}
          >
            <SHIFT_NOTES_ITEM.icon className="h-4.5 w-4.5 flex-shrink-0" size={18} />
            {!collapsed && (
              <span className="flex w-full items-center justify-between gap-2">
                {SHIFT_NOTES_ITEM.label}
                {pendingShiftNotes != null && pendingShiftNotes > 0 && (
                  <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-black text-black">
                    {pendingShiftNotes}
                  </span>
                )}
              </span>
            )}
          </NavLink>
        </div>
      )}

      <nav className="flex-1 space-y-2 overflow-y-auto p-3" id="sidebar-nav">
        {groups.map((group) => {
          const GroupIcon = group.icon;
          const active = group.items.some((item) => isRouteActive(item.path, location.pathname));
          const expanded = collapsed || expandedGroups[group.title] || active;
          return (
            <div key={group.title} className="space-y-1">
              {!collapsed && (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.title)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold transition-colors',
                    active ? 'bg-teal-500/10 text-teal-200' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                  )}
                >
                  <GroupIcon size={15} />
                  <span className="flex-1 text-right">{group.title}</span>
                  <ChevronDown
                    size={14}
                    className={cn('flex-shrink-0 transition-transform duration-200', expanded ? 'rotate-180' : '')}
                  />
                </button>
              )}
              {expanded && (
                <div className={cn('space-y-0.5', collapsed ? '' : 'pr-2')}>
                {group.items.map((item) => {
                  const itemActive = isRouteActive(item.path, location.pathname);
                  const visibleSections = getVisibleSectionsForPath(navItemBasePath(item.path), checkPermission);
                  return (
                    <div key={`${group.title}-${item.path}-${item.label}`} className="space-y-1">
                      <NavLink
                        to={item.path}
                        end={item.path === '/'}
                        onClick={(event) => {
                          if (navigationGuard?.hasActiveDirtyGuard()) {
                            event.preventDefault();
                            navigationGuard.requestNavigation(item.path);
                          }
                          onMobileClose();
                        }}
                        className={() => cn('nav-item', itemActive ? 'nav-item-active' : 'nav-item-inactive', collapsed ? 'justify-center px-2' : '')}
                        title={collapsed ? item.label : undefined}
                      >
                        <item.icon className="h-4.5 w-4.5 flex-shrink-0" size={18} />
                        {!collapsed && <span className="flex items-center justify-between w-full">{item.label}</span>}
                      </NavLink>
                      {!collapsed && itemActive && visibleSections.length > 0 && (
                        <div className="mr-8 space-y-1 border-r border-teal-500/20 pr-3">
                          {visibleSections.map((section) => (
                            <div key={section.key} className="rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-300">
                              {section.label}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-[#2d4063] p-3">
        <button
          onClick={handleLogout}
          className={cn('nav-item nav-item-inactive w-full text-red-400 hover:bg-red-500/10 hover:text-red-300', collapsed ? 'justify-center px-2' : '')}
        >
          <LogOut size={18} className="flex-shrink-0" />
          {!collapsed && <span>{T.logout}</span>}
        </button>
      </div>
    </div>
  );

  return (
    <>
      <aside className={cn('hidden flex-shrink-0 flex-col border-l border-[#2d4063] bg-[#151f34] transition-all duration-300 lg:flex', collapsed ? 'w-16' : 'w-72')}>
        <SidebarContent />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="fixed inset-0 bg-black/60" onClick={onMobileClose} />
          <aside className="relative mr-auto flex h-full w-72 animate-slide-in flex-col border-l border-[#2d4063] bg-[#151f34]">
            <button onClick={onMobileClose} className="absolute left-4 top-4 rounded-lg p-1.5 text-slate-400 hover:text-white">
              <X size={18} />
            </button>
            <SidebarContent />
          </aside>
        </div>
      )}
    </>
  );
}
