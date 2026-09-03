import type { ElementType } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Calendar,
  ClipboardCheck,
  ClipboardList,
  FileSpreadsheet,
  HeadphonesIcon,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  PackageSearch,
  Star,
  UserPlus,
  Users,
  X,
  ChevronLeft,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { LOGO_URL } from '@/lib/constants';
import { cn } from '@/lib/utils';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

type AssistantNavItem = {
  path: string;
  label: string;
  icon: ElementType;
  permission?: string;
};

type AssistantNavGroup = {
  title: string;
  items: AssistantNavItem[];
};

const GROUPS: AssistantNavGroup[] = [
  {
    title: 'مساحة العمل',
    items: [
      { path: '/assistant-operational-log', label: 'تسجيل المشتريات وخدمة العملاء', icon: LayoutDashboard, permission: 'view_dashboard' },
      { path: '/my-daily-checklist', label: 'التشيك ليست اليومي', icon: ClipboardCheck, permission: 'view_dashboard' },
      { path: '/pharmacy-zone-tasks', label: 'الرص والجرد اليومي', icon: ClipboardList, permission: 'view_dashboard' },
      { path: '/schedule', label: 'جدولي والشيفتات', icon: Calendar, permission: 'view_schedule' },
    ],
  },
  {
    title: 'خدمة العملاء',
    items: [
      { path: '/customer-service', label: 'خدمة العملاء', icon: HeadphonesIcon, permission: 'view_customer_service' },
      { path: '/customer-service?quickFollowup=1', label: 'المتابعات', icon: ClipboardCheck, permission: 'view_customer_service' },
      { path: '/customer-requests', label: 'طلبات العملاء', icon: PackageSearch, permission: 'view_customer_requests' },
      { path: '/reviews', label: 'تقييم المحادثات', icon: ClipboardCheck, permission: 'view_reviews' },
      { path: '/customers', label: 'قاعدة العملاء', icon: Users, permission: 'view_customers' },
      { path: '/customer-coding', label: 'تكويد عميل', icon: UserPlus, permission: 'view_customer_service' },
      { path: '/customer-monthly-performance', label: 'أداء العملاء الشهري', icon: Users, permission: 'view_analytics' },
      { path: '/customer-cashback', label: 'نقاط العملاء من الفواتير', icon: Star, permission: 'view_cashback' },
      { path: '/customer-points-ledger', label: 'سجل حركات نقاط العملاء', icon: Star, permission: 'view_points' },
      { path: '/quick-replies', label: 'الردود السريعة', icon: HeadphonesIcon, permission: 'whatsapp_customer' },
      { path: '/welcome-messages', label: 'رسائل الترحيب', icon: MessageCircle, permission: 'customer_welcome_messages_view' },
    ],
  },
  {
    title: 'المشتريات',
    items: [
      { path: '/purchases', label: 'المشتريات', icon: FileSpreadsheet, permission: 'view_purchases' },
      { path: '/purchase-invoice-entry', label: 'تسجيل فاتورة مشتريات', icon: FileSpreadsheet, permission: 'view_dashboard' },
      { path: '/purchase-invoice-accuracy', label: 'دقة إدخال فواتير المشتريات', icon: FileSpreadsheet, permission: 'view_dashboard' },
    ],
  },
  {
    title: 'حسابي',
    items: [
      { path: '/points', label: 'النقاط والحافز', icon: Star, permission: 'view_points' },
    ],
  },
];

function pathIsActive(itemPath: string, pathname: string, search: string) {
  const [base, query] = itemPath.split('?');
  if (pathname !== base) return false;
  if (!query) return true;
  const expected = new URLSearchParams(query);
  const actual = new URLSearchParams(search);
  for (const [key, value] of expected.entries()) {
    if (actual.get(key) !== value) return false;
  }
  return true;
}

export default function AssistantSidebar({ collapsed, onToggle, mobileOpen, onMobileClose }: SidebarProps) {
  const { user, logout, checkPermission } = useAuth();
  const navigate = useNavigate();

  const groups = GROUPS
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.permission || checkPermission(item.permission)),
    }))
    .filter((group) => group.items.length > 0);

  const content = (
    <div className="flex h-full flex-col">
      <div className={cn('dawaa-sidebar-divider flex items-center gap-3 border-b p-4', collapsed && 'justify-center')}>
        <div className="logo-tile flex h-10 w-10 items-center justify-center rounded-xl">
          <img src={LOGO_URL} alt="Dawaa Pharmacy 2027" className="h-8 w-8 object-contain" />
        </div>
        {!collapsed ? (
          <div className="min-w-0">
            <div className="dawaa-sidebar-title text-sm font-bold">Dawaa Pharmacy 2027</div>
            <div className="dawaa-sidebar-brand truncate text-xs">مساحة المساعد التشغيلية</div>
          </div>
        ) : null}
        <button onClick={onToggle} className="dawaa-sidebar-muted mr-auto hidden rounded-lg p-1.5 lg:flex">
          <ChevronLeft className={collapsed ? 'rotate-180' : ''} />
        </button>
      </div>

      <div className="dawaa-sidebar-divider border-b p-3">
        <div className="dawaa-sidebar-user-card rounded-xl p-2.5 text-xs">
          <div className="dawaa-sidebar-title font-semibold">{user?.name}</div>
          {!collapsed ? <div className="dawaa-sidebar-muted">مساعد · {user?.branch}</div> : null}
        </div>
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto p-3">
        {groups.map((group) => (
          <div key={group.title} className="space-y-1">
            {!collapsed ? <div className="dawaa-sidebar-group px-3 py-2 text-xs font-black">{group.title}</div> : null}
            {group.items.map((item) => (
              <NavLink
                key={`${item.path}-${item.label}`}
                to={item.path}
                onClick={onMobileClose}
                className={({ isActive }) =>
                  cn(
                    'nav-item',
                    isActive || pathIsActive(item.path, window.location.pathname, window.location.search)
                      ? 'nav-item-active'
                      : 'nav-item-inactive',
                    collapsed && 'justify-center px-2'
                  )
                }
              >
                <item.icon size={18} />
                {!collapsed ? <span>{item.label}</span> : null}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="dawaa-sidebar-divider border-t p-3">
        <button
          onClick={() => {
            logout();
            navigate('/login');
          }}
          className="nav-item nav-item-inactive dawaa-sidebar-logout w-full"
        >
          <LogOut size={18} />
          {!collapsed ? 'تسجيل الخروج' : null}
        </button>
      </div>
    </div>
  );

  return (
    <>
      <aside className={cn('dawaa-sidebar hidden flex-shrink-0 flex-col border-l lg:flex', collapsed ? 'w-16' : 'w-72')}>
        {content}
      </aside>
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="dawaa-mobile-backdrop fixed inset-0" onClick={onMobileClose} />
          <aside className="dawaa-sidebar relative mr-auto flex h-full w-72 flex-col border-l">
            <button onClick={onMobileClose} className="dawaa-sidebar-muted absolute left-4 top-4 z-10"><X /></button>
            {content}
          </aside>
        </div>
      ) : null}
    </>
  );
}
