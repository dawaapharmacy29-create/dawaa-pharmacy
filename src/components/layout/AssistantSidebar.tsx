import type { ElementType } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
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
import { activeItem as pathIsActive } from '@/lib/sidebarNavigation';
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
  excludeStaffIds?: readonly string[];
};

type AssistantNavGroup = {
  title: string;
  items: AssistantNavItem[];
};

// فريق دواء ألفا (هاجر، نور، هبه حماده): مسؤوليتهم موسّعة عبر الفرعين ومش جزء منها
// دورة الرص/الجرد المحصورة على د/شيماء ويوسف عصام، فمفيش داعي يشوفوا الرابط ده أصلاً.
const TEAM_DAWAA_ALPHA_STAFF_IDS = [
  'e3640642-5c60-4815-8001-1bb93193668f', // هاجر
  '82b9c2a1-6139-4b07-9937-ef80a6e926d8', // نور
  'dea91886-1ae8-4766-a166-9952866a5024', // هبه حماده
] as const;

const GROUPS: AssistantNavGroup[] = [
  {
    title: 'عملي',
    items: [
      { path: '/assistant-operational-log', label: 'سجل الأعمال', icon: LayoutDashboard, permission: 'view_dashboard' },
      { path: '/my-daily-checklist', label: 'مهامي', icon: ClipboardCheck, permission: 'view_dashboard' },
      { path: '/pharmacy-zone-tasks', label: 'الرص والجرد', icon: ClipboardList, permission: 'view_dashboard', excludeStaffIds: TEAM_DAWAA_ALPHA_STAFF_IDS },
      { path: '/schedule', label: 'جدولي', icon: Calendar, permission: 'view_schedule' },
    ],
  },
  {
    title: 'العملاء',
    items: [
      { path: '/customer-service', label: 'المتابعات', icon: HeadphonesIcon, permission: 'view_customer_service' },
      { path: '/customer-service?quickFollowup=1', label: 'متابعة سريعة', icon: ClipboardCheck, permission: 'view_customer_service' },
      { path: '/customer-requests', label: 'الطلبات', icon: PackageSearch, permission: 'view_customer_requests' },
      { path: '/reviews', label: 'تقييم المحادثات', icon: ClipboardCheck, permission: 'view_reviews' },
      { path: '/customers', label: 'العملاء', icon: Users, permission: 'view_customers' },
      { path: '/customer-coding', label: 'تكويد عميل', icon: UserPlus, permission: 'view_customer_service' },
      { path: '/customer-monthly-performance', label: 'نشاط العملاء', icon: Users, permission: 'view_analytics' },
      { path: '/customer-cashback', label: 'نقاط العملاء', icon: Star, permission: 'view_cashback' },
      { path: '/customer-points-ledger', label: 'حركات النقاط', icon: Star, permission: 'view_points' },
      { path: '/quick-replies', label: 'الردود', icon: HeadphonesIcon, permission: 'whatsapp_customer' },
      { path: '/welcome-messages', label: 'الترحيب', icon: MessageCircle, permission: 'customer_welcome_messages_view' },
    ],
  },
  {
    title: 'المشتريات',
    items: [
      { path: '/purchases', label: 'المشتريات', icon: FileSpreadsheet, permission: 'view_purchases' },
      { path: '/purchase-invoice-entry', label: 'إدخال فاتورة', icon: FileSpreadsheet, permission: 'view_dashboard' },
      { path: '/purchase-invoice-accuracy', label: 'دقة الإدخال', icon: FileSpreadsheet, permission: 'view_dashboard' },
    ],
  },
  {
    title: 'حسابي',
    items: [
      { path: '/points', label: 'نقاطي', icon: Star, permission: 'view_points' },
    ],
  },
];


export default function AssistantSidebar({ collapsed, onToggle, mobileOpen, onMobileClose }: SidebarProps) {
  const { user, logout, checkPermission } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const currentStaffId = user?.staffId || user?.id || '';

  const groups = GROUPS
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          (!item.permission || checkPermission(item.permission)) &&
          (!item.excludeStaffIds || !item.excludeStaffIds.includes(currentStaffId))
      ),
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
              <Link
                key={`${item.path}-${item.label}`}
                to={item.path}
                title={item.label}
                aria-current={pathIsActive(item.path, location.pathname, location.search) ? 'page' : undefined}
                onClick={onMobileClose}
                className={
                  cn(
                    'nav-item',
                    pathIsActive(item.path, location.pathname, location.search)
                      ? 'nav-item-active'
                      : 'nav-item-inactive',
                    collapsed && 'justify-center px-2'
                  )
                }
              >
                <item.icon size={18} />
                {!collapsed ? <span>{item.label}</span> : null}
              </Link>
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
