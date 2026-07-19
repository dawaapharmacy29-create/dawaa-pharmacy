import { useEffect, useMemo, useState, type ElementType } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity, ActivitySquare, AlertTriangle, BarChart3, BellRing, Calendar, ChevronDown, ChevronLeft,
  ClipboardCheck, ClipboardList, Crown, FileSpreadsheet, HeadphonesIcon, LayoutDashboard, LogOut,
  MessageCircle, Package, PackageSearch, ShieldCheck, Sparkles, Star, Store, Truck, UserCheck,
  UserPlus, Users, Wallet, WalletCards, X,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useOptionalNavigationGuard } from '@/contexts/NavigationGuardContext';
import { usePendingShiftNotesCount } from '@/hooks/usePendingShiftNotesCount';
import { LOGO_URL } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { getVisibleSectionsForPath } from '@/lib/permissionMatrix';
import { isDoctorRole } from '@/lib/security/userDataScope';

type NavItem = { path: string; icon: ElementType; label: string; permission?: string | string[]; adminOnly?: boolean };
type NavGroup = { title: string; icon: ElementType; items: NavItem[] };

const ENABLE_INTERNAL_DELIVERY_MODULE = false;
const SHIFT_NOTES_ITEM: NavItem = { path: '/shift-notes', icon: ClipboardList, label: 'ملاحظات الشيفت', permission: 'view_schedule' };

const GROUPS: NavGroup[] = [
  { title: 'لوحة القيادة', icon: Crown, items: [
    { path: '/', icon: LayoutDashboard, label: 'لوحة القيادة 2027', permission: 'view_dashboard' },
    { path: '/executive-2027', icon: Crown, label: 'الداشبورد التنفيذي', permission: ['view_executive_dashboard','view_branch_dashboard'] },
    { path: '/branch-inspection', icon: ClipboardList, label: 'مرور مدير الفروع', permission: 'view_branch_inspection' },
    { path: '/operations-center', icon: BellRing, label: 'المهام والتنبيهات', permission: 'view_operations' },
    { path: '/data-health', icon: ShieldCheck, label: 'صحة البيانات', permission: 'view_data_health' },
    { path: '/activity-log', icon: ActivitySquare, label: 'سجل الأنشطة', permission: 'view_activity_log', adminOnly: true },
  ]},
  { title: 'الموظفون والحضور', icon: UserCheck, items: [
    { path: '/team', icon: UserCheck, label: 'الفريق / الموظفون', permission: 'view_team' },
    { path: '/staff-accounts', icon: ShieldCheck, label: 'الحسابات والصلاحيات', permission: 'view_staff_accounts', adminOnly: true },
    { path: '/roles-permissions', icon: ShieldCheck, label: 'إعدادات الصلاحيات', permission: 'view_roles_permissions', adminOnly: true },
    { path: '/staff-duplicate-audit', icon: AlertTriangle, label: 'تدقيق الحسابات والتكرار', permission: 'view_staff_accounts', adminOnly: true },
    { path: '/schedule', icon: Calendar, label: 'الجداول والشيفتات', permission: 'view_schedule' },
    { path: '/attendance-report', icon: ClipboardCheck, label: 'تسجيل/تقرير الحضور', permission: ['view_attendance_leaves','record_attendance'] },
    { path: '/time-off', icon: Calendar, label: 'الأذونات والإجازات', permission: ['view_attendance_leaves','create_leave_request'] },
    { path: '/shift-performance', icon: ClipboardList, label: 'تقييمات الشيفتات', permission: 'view_shift_performance' },
    { path: '/employee-operating-system', icon: ClipboardList, label: 'مهام الفريق', permission: 'employee_operating_system.view' },
  ]},
  { title: 'العملاء وخدمة العملاء', icon: HeadphonesIcon, items: [
    { path: '/customer-service?quickFollowup=1', icon: HeadphonesIcon, label: 'متابعة العملاء', permission: 'view_customer_service' },
    { path: '/customer-coding', icon: UserPlus, label: 'تكويد العملاء', permission: 'view_customer_service' },
    { path: '/customers', icon: Users, label: 'قاعدة العملاء', permission: 'view_customers' },
    { path: '/customer-data-review', icon: ClipboardCheck, label: 'مراجعة بيانات العملاء', permission: 'view_customer_details' },
    { path: '/reviews', icon: ClipboardCheck, label: 'تقييم المحادثات', permission: 'view_reviews' },
    { path: '/quick-replies', icon: HeadphonesIcon, label: 'الردود السريعة', permission: 'whatsapp_customer' },
    { path: '/welcome-messages', icon: MessageCircle, label: 'رسائل الترحيب', permission: 'customer_welcome_messages.view' },
  ]},
  { title: 'المبيعات والتحليل', icon: BarChart3, items: [
    { path: '/analytics', icon: BarChart3, label: 'التحليلات والمبيعات', permission: 'view_analytics' },
    { path: '/invoices', icon: FileSpreadsheet, label: 'استيراد الفواتير', permission: 'view_invoices' },
    { path: '/branch-comparison', icon: BarChart3, label: 'مقارنة الفروع', permission: 'view_branch_comparison' },
    { path: '/doctor-competition', icon: Star, label: 'مسابقة الدكاترة', permission: 'view_doctor_dashboard' },
    { path: '/whatsapp-analytics', icon: BarChart3, label: 'تحليلات واتساب', permission: 'view_reviews' },
    { path: '/reports', icon: FileSpreadsheet, label: 'مركز التقارير', permission: 'view_sales_reports' },
  ]},
  { title: 'التشغيل والمخزون', icon: Store, items: [
    { path: '/stagnant-medicines', icon: Package, label: 'الرواكد واللستة', permission: 'view_stagnant_medicines' },
    { path: '/shortages', icon: PackageSearch, label: 'النواقص', permission: 'view_shortages' },
    { path: '/medicine-expiry', icon: AlertTriangle, label: 'الصلاحية', permission: 'view_expiry_tracker' },
    { path: '/inventory-counts', icon: ClipboardList, label: 'الجرد', permission: 'view_inventory' },
    { path: '/purchases', icon: FileSpreadsheet, label: 'المشتريات', permission: 'view_purchases' },
    { path: '/supplies', icon: PackageSearch, label: 'المستلزمات', permission: 'view_supplies' },
  ]},
  { title: 'الدليفري', icon: Truck, items: [{ path: '/delivery', icon: Truck, label: 'لوحة الدليفري', permission: 'view_delivery' }] },
  { title: 'الحوافز والرواتب', icon: Star, items: [
    { path: '/points', icon: Star, label: 'النقاط', permission: 'view_points' },
    { path: '/staff-payroll', icon: Wallet, label: 'الرواتب', permission: 'view_salary_calculator' },
    { path: '/quarterly-incentives', icon: Crown, label: 'شرح الحافز الشهري', permission: 'view_quarterly_incentives' },
    { path: '/penalty-incentive', icon: AlertTriangle, label: 'الجزاءات والمكافآت', permission: 'view_penalty_management' },
  ]},
];

const PHARMACIST_GROUPS: NavGroup[] = [{
  title: 'مساحة الدكتور', icon: UserCheck, items: [
    { path: '/doctor-dashboard', icon: LayoutDashboard, label: 'لوحة الدكتور', permission: 'view_doctor_dashboard' },
    { path: '/doctor-competition', icon: Star, label: 'مسابقة الدكاترة', permission: 'view_doctor_dashboard' },
    { path: '/doctor-dashboard?tab=followups', icon: HeadphonesIcon, label: 'متابعاتي المطلوبة', permission: 'view_doctor_dashboard' },
    { path: '/customers', icon: Users, label: 'بحث العملاء', permission: 'view_customers' },
    { path: '/doctor-dashboard?tab=reviews', icon: ClipboardCheck, label: 'تقييماتي الشخصية', permission: 'view_doctor_dashboard' },
    { path: '/doctor-dashboard?tab=notifications', icon: BellRing, label: 'إشعاراتي', permission: 'view_doctor_dashboard' },
    { path: '/doctor-dashboard?tab=activity', icon: Activity, label: 'سجل نشاطي', permission: 'view_doctor_dashboard' },
    { path: '/doctor-dashboard?tab=payroll', icon: WalletCards, label: 'حسابي والقبض', permission: 'view_doctor_dashboard' },
    { path: '/quick-replies', icon: HeadphonesIcon, label: 'الردود السريعة', permission: 'whatsapp_customer' },
    { path: '/welcome-messages', icon: MessageCircle, label: 'رسائل الترحيب', permission: 'customer_welcome_messages.view' },
    { path: '/points', icon: Star, label: 'النقاط والحافز', permission: 'view_points' },
    { path: '/stagnant-medicines', icon: Package, label: 'الرواكد', permission: 'view_stagnant_medicines' },
    { path: '/incentive-medicines', icon: Sparkles, label: 'اللستة', permission: 'view_incentive_medicines' },
    { path: '/schedule', icon: Calendar, label: 'الجدول', permission: 'view_schedule' },
  ],
}];

function basePath(path: string) { return path.split('?')[0]; }
function activeItem(itemPath: string, pathname: string, search: string) {
  const base = basePath(itemPath);
  if (base === '/') return pathname === '/' || pathname === '/executive-2027';
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
  const privileged = isAdmin || ['general_manager','executive_manager','branches_manager','branch_manager','مدير عام','مدير فرع'].includes(user?.role || '');
  const pharmacistView = isDoctorRole(user) && !checkPermission('view_executive_dashboard');

  const canAccess = (item: NavItem) => {
    if (item.adminOnly && !privileged) return false;
    if (!item.permission) return true;
    return privileged || (Array.isArray(item.permission) ? item.permission.some(checkPermission) : checkPermission(item.permission));
  };
  const groups = useMemo(() => (pharmacistView ? PHARMACIST_GROUPS : GROUPS)
    .filter((group) => group.title !== 'الدليفري' || ENABLE_INTERNAL_DELIVERY_MODULE)
    .map((group) => ({ ...group, items: group.items.filter(canAccess) }))
    .filter((group) => group.items.length), [checkPermission, pharmacistView, privileged, user]);

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
    <div className={cn('flex items-center gap-3 border-b border-[#2d4063] p-4', collapsed && 'justify-center')}><div className="logo-tile flex h-10 w-10 items-center justify-center rounded-xl"><img src={LOGO_URL} alt="Dawaa Pharmacy 2027" className="h-8 w-8 object-contain" /></div>{!collapsed ? <div className="min-w-0"><div className="text-sm font-bold text-white">Dawaa Pharmacy 2027</div><div className="truncate text-xs text-teal-400">نظام تشغيل الصيدلية الذكي</div></div> : null}<button onClick={onToggle} className="mr-auto hidden rounded-lg p-1.5 text-slate-400 lg:flex"><ChevronLeft className={collapsed ? 'rotate-180' : ''} /></button></div>
    <div className="border-b border-[#2d4063] p-3"><div className="rounded-xl bg-white/5 p-2.5 text-xs"><div className="font-semibold text-white">{user?.name}</div>{!collapsed ? <div className="text-slate-400">{user?.role} - {user?.branch}</div> : null}</div></div>
    {!collapsed ? <div className="px-3 py-2"><div className="flex gap-2"><button onClick={() => go(pharmacistView ? '/doctor-dashboard?tab=followups' : '/customer-service?quickFollowup=1')} className="flex-1 rounded-lg bg-teal-500/10 px-3 py-2 text-xs font-bold text-teal-200">متابعة سريعة</button><button onClick={() => go('/customer-coding')} className="flex-1 rounded-lg bg-sky-500/10 px-3 py-2 text-xs font-bold text-sky-200">تكويد عميل</button></div></div> : null}
    {canAccess(SHIFT_NOTES_ITEM) ? <button onClick={() => go(SHIFT_NOTES_ITEM.path)} className="nav-item nav-item-inactive mx-3 my-2"><ClipboardList size={18} />{!collapsed ? <span className="flex w-full justify-between">ملاحظات الشيفت{pendingShiftNotes ? <b className="rounded-full bg-amber-500 px-2 text-black">{pendingShiftNotes}</b> : null}</span> : null}</button> : null}
    <nav className="flex-1 space-y-2 overflow-y-auto p-3">{groups.map((group) => { const active = group.items.some((item) => activeItem(item.path, location.pathname, location.search)); const expanded = collapsed || expandedGroups[group.title] || active; return <div key={group.title} className="space-y-1">{!collapsed ? <button type="button" onClick={() => setExpandedGroups((value) => ({...value,[group.title]:!value[group.title]}))} className={cn('flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold', active ? 'bg-teal-500/10 text-teal-200' : 'text-slate-400')}><group.icon size={15} /><span className="flex-1 text-right">{group.title}</span><ChevronDown size={14} className={expanded ? 'rotate-180' : ''} /></button> : null}{expanded ? <div className={cn('space-y-0.5', !collapsed && 'pr-2')}>{group.items.map((item) => { const itemActive = activeItem(item.path, location.pathname, location.search); const sections = getVisibleSectionsForPath(basePath(item.path), checkPermission); return <div key={`${item.path}-${item.label}`}><NavLink to={item.path} onClick={(event) => { if (guard?.hasActiveDirtyGuard()) { event.preventDefault(); guard.requestNavigation(item.path); } onMobileClose(); }} className={cn('nav-item', itemActive ? 'nav-item-active' : 'nav-item-inactive', collapsed && 'justify-center px-2')}><item.icon size={18} />{!collapsed ? <span>{item.label}</span> : null}</NavLink>{!collapsed && itemActive && sections.length ? <div className="mr-8 border-r border-teal-500/20 pr-3">{sections.map((section) => <div key={section.key} className="px-2 py-1 text-[11px] text-slate-300">{section.label}</div>)}</div> : null}</div>;})}</div> : null}</div>;})}</nav>
    <div className="border-t border-[#2d4063] p-3"><button onClick={() => { logout(); navigate('/login'); }} className="nav-item nav-item-inactive w-full text-red-400"><LogOut size={18} />{!collapsed ? 'تسجيل الخروج' : null}</button></div>
  </div>;

  return <><aside className={cn('hidden flex-shrink-0 flex-col border-l border-[#2d4063] bg-[#151f34] lg:flex', collapsed ? 'w-16' : 'w-72')}>{content}</aside>{mobileOpen ? <div className="fixed inset-0 z-50 flex lg:hidden"><div className="fixed inset-0 bg-black/60" onClick={onMobileClose} /><aside className="relative mr-auto flex h-full w-72 flex-col border-l border-[#2d4063] bg-[#151f34]"><button onClick={onMobileClose} className="absolute left-4 top-4 z-10 text-slate-400"><X /></button>{content}</aside></div> : null}</>;
}
