import { useEffect, useMemo, useState, type ElementType } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  ActivitySquare,
  AlertTriangle,
  BarChart3,
  BellRing,
  BookOpenCheck,
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
  Target,
  Trash2,
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

type NavItem = {
  path: string;
  icon: ElementType;
  label: string;
  permission?: string;
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
      { path: '/executive-2027', icon: Crown, label: 'الداشبورد التنفيذي', permission: 'view_executive_dashboard' },
      { path: '/daily-command', icon: Target, label: 'مركز القيادة اليومي', permission: 'view_dashboard' },
      { path: '/today-brief', icon: ClipboardCheck, label: 'ملخص اليوم', permission: 'view_dashboard' },
      { path: '/operations-center', icon: BellRing, label: 'المهام والتنبيهات', permission: 'view_operations' },
      { path: '/data-health', icon: ShieldCheck, label: 'صحة البيانات', permission: 'view_data_health' },
      { path: '/activity-log', icon: ActivitySquare, label: 'سجل الأنشطة', permission: 'view_activity_log', adminOnly: true },
    ],
  },
  {
    title: 'الموارد البشرية',
    icon: UserCheck,
    items: [
      { path: '/team', icon: UserCheck, label: 'الفريق والجدول', permission: 'view_team' },
      { path: '/schedule', icon: Calendar, label: 'الجداول والإجازات', permission: 'view_schedule' },
      { path: '/attendance-report', icon: ClipboardCheck, label: 'تسجيل/تقرير الحضور', permission: 'view_attendance_leaves' },
      { path: '/shift-performance', icon: ClipboardList, label: 'تقييم الشيفتات', permission: 'view_shift_performance' },
      { path: '/employee-kpi', icon: BarChart3, label: 'KPI الموظفين', permission: 'view_team' },
      { path: '/staff-accounts', icon: ShieldCheck, label: 'الحسابات والصلاحيات', permission: 'view_staff_accounts', adminOnly: true },
    ],
  },
  {
    title: 'العملاء والخدمات',
    icon: HeadphonesIcon,
    items: [
      { path: '/customers', icon: Users, label: 'العملاء', permission: 'view_customers' },
      { path: '/customer-service', icon: HeadphonesIcon, label: 'خدمة العملاء', permission: 'view_customer_service' },
      { path: '/customer-data-review', icon: ClipboardCheck, label: 'مراجعة بيانات العملاء', permission: 'view_customer_details' },
      { path: '/customer-requests', icon: BellRing, label: 'طلبات المتابعة', permission: 'view_customer_requests' },
      { path: '/customer-coding', icon: UserPlus, label: 'تكويد العملاء', permission: 'view_customer_service' },
      { path: '/customer-cashback', icon: Wallet, label: 'النقاط والولاء', permission: 'view_cashback' },
      { path: '/loyalty-tiers', icon: Star, label: 'مستويات الولاء', permission: 'view_loyalty_tiers' },
      { path: '/refill-reminders', icon: Calendar, label: 'إعادة صرف الدواء', permission: 'view_customers' },
      { path: '/customer-health', icon: ActivitySquare, label: 'الملف الصحي للعميل', permission: 'view_customer_details' },
      { path: '/crm', icon: Users, label: 'CRM ومتابعة العملاء', permission: 'view_crm' },
      { path: '/reviews', icon: ClipboardCheck, label: 'تقييم المحادثات', permission: 'view_reviews' },
      { path: '/quick-replies', icon: HeadphonesIcon, label: 'الردود السريعة', permission: 'whatsapp_customer' },
      { path: '/welcome-messages', icon: MessageCircle, label: 'الرسائل الترحيبية', permission: 'customer_welcome_messages.view' },
    ],
  },
  {
    title: 'المبيعات والتحليل',
    icon: BarChart3,
    items: [
      { path: '/analytics', icon: BarChart3, label: 'التحليلات والمبيعات', permission: 'view_analytics' },
      { path: '/invoices', icon: FileSpreadsheet, label: 'استيراد الفواتير', permission: 'view_invoices' },
      { path: '/branch-comparison', icon: BarChart3, label: 'مقارنة الفروع', permission: 'view_branch_comparison' },
      { path: '/doctor-competition', icon: Star, label: 'مسابقة الدكاترة', permission: 'view_analytics_sales' },
      { path: '/whatsapp-analytics', icon: BarChart3, label: 'تحليلات واتساب', permission: 'view_reviews' },
      { path: '/reports', icon: FileSpreadsheet, label: 'مركز التقارير', permission: 'view_sales_reports' },
      { path: '/offers', icon: Sparkles, label: 'العروض', permission: 'view_operations' },
      { path: '/stories', icon: BookOpenCheck, label: 'الاستوريز وتحليلها', permission: 'view_operations' },
    ],
  },
  {
    title: 'المخزون والتشغيل',
    icon: Store,
    items: [
      { path: '/shortages', icon: PackageSearch, label: 'النواقص', permission: 'view_shortages' },
      { path: '/stagnant-medicines', icon: Package, label: 'الأدوية الراكدة', permission: 'view_stagnant_medicines' },
      { path: '/medicine-expiry', icon: AlertTriangle, label: 'صلاحية الأدوية', permission: 'view_expiry_tracker' },
      { path: '/purchases', icon: FileSpreadsheet, label: 'المشتريات والموردين', permission: 'view_purchases' },
      { path: '/inventory-counts', icon: ClipboardList, label: 'الجرد', permission: 'view_inventory' },
      { path: '/stock-alerts', icon: AlertTriangle, label: 'تنبيهات المخزون', permission: 'view_inventory' },
      { path: '/supplies', icon: PackageSearch, label: 'المستلزمات', permission: 'view_supplies' },
      { path: '/branch-inspection', icon: ClipboardList, label: 'نموذج مرور المدير', permission: 'view_branch_inspection' },
      { path: '/returns', icon: Trash2, label: 'إدارة المرتجعات', permission: 'view_invoices' },
    ],
  },
  {
    title: 'الحوافز والتوصيل',
    icon: Star,
    items: [
      { path: '/points', icon: Star, label: 'النقاط والمكافآت', permission: 'view_points' },
      { path: '/staff-payroll', icon: Wallet, label: 'قبض الموظفين', permission: 'view_salary_calculator' },
      { path: '/quarterly-incentives', icon: Crown, label: 'الحافز الربع سنوي', permission: 'view_quarterly_incentives' },
      { path: '/delivery', icon: Truck, label: 'التوصيل والدليفري', permission: 'view_delivery' },
    ],
  },
  {
    title: 'الإعدادات والإدارة',
    icon: ShieldCheck,
    items: [
      { path: '/penalty-incentive', icon: AlertTriangle, label: 'الجزاءات والحوافز', permission: 'view_penalty_management', adminOnly: true },
      { path: '/evaluation-rules', icon: ClipboardCheck, label: 'قواعد التقييم', permission: 'manage_permissions', adminOnly: true },
      { path: '/roles-permissions', icon: ShieldCheck, label: 'الصلاحيات', permission: 'view_roles_permissions', adminOnly: true },
    ],
  },
];

function isRouteActive(itemPath: string, pathname: string) {
  if (itemPath === '/') return pathname === '/' || pathname === '/executive-2027';
  if (itemPath === '/team' && pathname.startsWith('/staff/')) return true;
  if (itemPath === '/analytics' && pathname === '/analytics-sales') return true;
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`);
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

  const canAccessItem = (item: NavItem) => {
    if (item.adminOnly && !privileged) return false;
    if (!item.permission) return true;
    return privileged || checkPermission(item.permission);
  };

  const groups = useMemo(() => {
    return GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) => canAccessItem(item)),
    })).filter((group) => group.items.length > 0);
  }, [checkPermission, privileged]);

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
                  const visibleSections = getVisibleSectionsForPath(item.path, checkPermission);
                  return (
                    <div key={item.path} className="space-y-1">
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
