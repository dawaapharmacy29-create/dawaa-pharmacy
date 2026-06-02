import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  ActivitySquare,
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
  Package,
  PackageCheck,
  PackageSearch,
  ShieldCheck,
  Sparkles,
  Star,
  Store,
  Syringe,
  Trash2,
  Truck,
  UserCheck,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { LOGO_URL } from "@/lib/constants";
import { cn } from "@/lib/utils";

type NavItem = {
  path: string;
  icon: React.ElementType;
  label: string;
  permission?: string;
  adminOnly?: boolean;
  role?: string;
  badge?: number;
};

type NavGroup = {
  title: string;
  icon: React.ElementType;
  items: NavItem[];
};

const T = {
  appName: "Dawaa Pharmacy 2027",
  system: "نظام تشغيل الصيدلية الذكي",
  allBranches: "كل الفروع",
  logout: "تسجيل الخروج",
  admin: "أدمن",
  branchManager: "مدير فرع",
  pharmacist: "صيدلاني",
};

const GROUPS: NavGroup[] = [
  {
    title: "القيادة اليومية",
    icon: Crown,
    items: [
      { path: "/shift-notes", icon: ClipboardList, label: "ملاحظات الشيفتات", permission: "view_dashboard" },
      { path: "/", icon: Crown, label: "لوحة القيادة 2027", permission: "view_dashboard" },
      { path: "/operations-center", icon: BellRing, label: "المهام والتنبيهات", permission: "view_dashboard" },
      { path: "/activity-log", icon: ActivitySquare, label: "سجل الأنشطة", adminOnly: true, permission: "view_activity_logs" },
    ],
  },
  {
    title: "الفريق والالتزام",
    icon: UserCheck,
    items: [
      { path: "/team", icon: UserCheck, label: "الفريق", permission: "view_team" },
      { path: "/schedule", icon: Calendar, label: "الجداول والإجازات", permission: "view_schedule" },
      { path: "/time-off", icon: Calendar, label: "الإذونات والإجازات الاستثنائية", permission: "view_schedule" },
      { path: "/staff-accounts", icon: ShieldCheck, label: "حسابات وصلاحيات", adminOnly: true, permission: "view_staff_accounts" },
      { path: "/shift-performance", icon: ClipboardList, label: "تقييم الشيفتات", permission: "view_shift_performance" },
      { path: "/training", icon: BookOpenCheck, label: "التدريب والاختبارات", permission: "view_dashboard" },
    ],
  },
  {
    title: "العملاء وخدمة العملاء",
    icon: HeadphonesIcon,
    items: [
      { path: "/customers", icon: Users, label: "العملاء", permission: "view_customers" },
      { path: "/customer-service", icon: HeadphonesIcon, label: "خدمة العملاء والمتابعات", permission: "view_customer_service" },
      { path: "/customer-requests", icon: PackageSearch, label: "طلبات العملاء", permission: "view_customer_service" },
      { path: "/reviews", icon: ClipboardCheck, label: "تقييم المحادثات", permission: "view_conversation_reviews" },
      { path: "/whatsapp-analytics", icon: BarChart3, label: "تحليل الواتساب", permission: "view_conversation_reviews" },
    ],
  },
  {
    title: "المبيعات والتسويق",
    icon: BarChart3,
    items: [
      { path: "/analytics", icon: BarChart3, label: "التحليلات والمبيعات", permission: "view_analytics_sales" },
      { path: "/invoices", icon: FileSpreadsheet, label: "استيراد الفواتير", permission: "view_invoice_import" },
      { path: "/offers", icon: Sparkles, label: "العروض", permission: "view_dashboard" },
      { path: "/stories", icon: Sparkles, label: "الاستوريز وتحليلها", permission: "view_dashboard" },
    ],
  },
  {
    title: "المخزون والتشغيل",
    icon: Store,
    items: [
      { path: "/shortages", icon: PackageSearch, label: "النواقص", permission: "view_dashboard" },
      { path: "/supplies", icon: Syringe, label: "المستلزمات", permission: "view_dashboard" },
      { path: "/accessories", icon: PackageCheck, label: "الإكسسوار", permission: "view_dashboard" },
      { path: "/shelf-organization", icon: Store, label: "تنظيم الأدوية والرفوف", permission: "view_dashboard" },
      { path: "/inventory-counts", icon: ClipboardList, label: "الجرد", permission: "view_dashboard" },
      { path: "/branch-cleaning", icon: Trash2, label: "نظافة الفروع", permission: "view_dashboard" },
      { path: "/stagnant-medicines", icon: Package, label: "الأدوية الراكدة", role: T.pharmacist, permission: "view_stagnant_medicines" },
      { path: "/incentive-medicines", icon: PackageCheck, label: "أدوية اللستة", role: T.pharmacist, permission: "view_incentive_medicines" },
    ],
  },
  {
    title: "الحوافز والتقييم",
    icon: Star,
    items: [
      { path: "/points", icon: Star, label: "النقاط والمكافآت", permission: "view_points_rewards" },
      { path: "/penalty-incentive", icon: ShieldCheck, label: "إدارة الجزاءات والحوافز", adminOnly: true, permission: "manage_roles" },
      { path: "/evaluation-rules", icon: ClipboardCheck, label: "قواعد التقييم المرنة", adminOnly: true, permission: "manage_roles" },
      { path: "/quarterly-incentives", icon: Crown, label: "الحافز الربع سنوي", permission: "view_points_rewards" },
    ],
  },
  {
    title: "التوصيل",
    icon: Truck,
    items: [
      { path: "/delivery", icon: Truck, label: "التوصيل وتقييم الدليفري", permission: "view_delivery" },
    ],
  },
  {
    title: "أرشيف وإعدادات",
    icon: LayoutDashboard,
    items: [
      { path: "/dashboard-classic", icon: LayoutDashboard, label: "لوحة التحكم القديمة", adminOnly: true, permission: "view_dashboard" },
      { path: "/doctor-dashboard", icon: Wallet, label: "لوحة الدكتور", role: T.pharmacist, permission: "view_doctor_dashboard" },
      { path: "/staff-dashboard", icon: LayoutDashboard, label: "لوحة الموظف", permission: "view_dashboard" },
      { path: "/roles-permissions", icon: ShieldCheck, label: "الأدوار والصلاحيات", adminOnly: true, permission: "manage_roles" },
    ],
  },
];

function isRouteActive(itemPath: string, pathname: string) {
  if (itemPath === "/") return pathname === "/" || pathname === "/executive-2027";
  if (itemPath === "/team" && pathname.startsWith("/staff/")) return true;
  if (itemPath === "/schedule" && pathname.startsWith("/schedules")) return true;
  if (itemPath === "/analytics" && pathname === "/analytics-sales") return true;
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
  const navigate = useNavigate();
  const location = useLocation();
  const navRef = useRef<HTMLDivElement>(null);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const privilegedRoles = useMemo(() => new Set([T.admin, T.branchManager, "مدير عام", "المدير العام"]), []);

  const groups = useMemo(() => {
    return GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.adminOnly && !isAdmin) return false;
        if (item.role && user?.role !== item.role && !privilegedRoles.has(user?.role || "")) return false;
        if (!checkPermission(item.permission)) return false;
        return true;
      }),
    })).filter((group) => group.items.length > 0);
  }, [checkPermission, isAdmin, privilegedRoles, user?.role]);

  useEffect(() => {
    setOpenGroups((current) => {
      const next = { ...current };
      groups.forEach((group) => {
        if (group.items.some((item) => isRouteActive(item.path, location.pathname))) {
          next[group.title] = true;
        }
      });
      if (Object.keys(next).length === 0) next["القيادة اليومية"] = true;
      return next;
    });
  }, [groups, location.pathname]);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const saveScroll = () => sessionStorage.setItem("sidebarScroll", nav.scrollTop.toString());
    nav.addEventListener("scroll", saveScroll, { passive: true });
    return () => nav.removeEventListener("scroll", saveScroll);
  }, []);

  useEffect(() => {
    const savedScroll = sessionStorage.getItem("sidebarScroll");
    if (!savedScroll) return;
    const restore = () => {
      if (navRef.current) navRef.current.scrollTop = Number(savedScroll) || 0;
    };
    const frameId = window.requestAnimationFrame(restore);
    const timerId = window.setTimeout(restore, 80);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timerId);
    };
  }, [location.pathname, groups.length, openGroups]);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const SidebarContent = () => (
    <div className="flex h-full flex-col">
      <div className={cn("flex items-center gap-3 border-b border-[#2d4063] p-4", collapsed ? "justify-center" : "")}>
        <div className="logo-tile flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl">
          <img src={LOGO_URL} alt={T.appName} className="h-8 w-8 object-contain" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="text-sm font-bold leading-tight text-white">{T.appName}</div>
            <div className="truncate text-xs text-teal-400">{T.system}</div>
          </div>
        )}
        <button onClick={onToggle} className="mr-auto hidden rounded-lg p-1.5 text-slate-400 transition-all hover:bg-white/5 hover:text-white lg:flex" aria-label="toggle sidebar">
          <ChevronLeft className={cn("h-4 w-4 transition-transform duration-200", collapsed ? "rotate-180" : "")} />
        </button>
      </div>

      <div className={cn("border-b border-[#2d4063] px-3 py-3", collapsed ? "flex justify-center" : "")}>
        {collapsed ? (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-500/20 text-xs font-bold text-teal-400">{user?.name?.[0]}</div>
        ) : (
          <div className="flex items-center gap-2.5 rounded-xl bg-white/5 p-2.5">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-teal-500/20 text-xs font-bold text-teal-400">{user?.name?.[0]}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-white">{user?.name}</div>
              <div className="truncate text-xs text-slate-400">{user?.role} - {user?.branch === "الكل" ? T.allBranches : user?.branch}</div>
            </div>
          </div>
        )}
      </div>

      <nav ref={navRef} className="flex-1 space-y-2 overflow-y-auto p-3" id="sidebar-nav">
        {groups.map((group) => {
          const GroupIcon = group.icon;
          const open = collapsed || openGroups[group.title];
          const active = group.items.some((item) => isRouteActive(item.path, location.pathname));
          return (
            <div key={group.title} className="space-y-1">
              {!collapsed && (
                <button
                  type="button"
                  onClick={() => setOpenGroups((current) => ({ ...current, [group.title]: !current[group.title] }))}
                  className={cn("flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold transition", active ? "bg-teal-500/10 text-teal-200" : "text-slate-400 hover:bg-white/5 hover:text-white")}
                >
                  <GroupIcon size={15} />
                  <span className="flex-1 text-right">{group.title}</span>
                  <ChevronDown size={14} className={cn("transition-transform", open ? "rotate-180" : "")} />
                </button>
              )}
              {open && (
                <div className={cn("space-y-0.5", collapsed ? "" : "pr-2")}>
                  {group.items.map((item) => (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      end={item.path === "/"}
                      onClick={() => {
                        if (navRef.current) sessionStorage.setItem("sidebarScroll", navRef.current.scrollTop.toString());
                        onMobileClose();
                      }}
                      className={() => cn("nav-item", isRouteActive(item.path, location.pathname) ? "nav-item-active" : "nav-item-inactive", collapsed ? "justify-center px-2" : "")}
                      title={collapsed ? item.label : undefined}
                    >
                      <item.icon className="h-4.5 w-4.5 flex-shrink-0" size={18} />
                      {!collapsed && <span>{item.label}</span>}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-[#2d4063] p-3">
        <button onClick={handleLogout} className={cn("nav-item nav-item-inactive w-full text-red-400 hover:bg-red-500/10 hover:text-red-300", collapsed ? "justify-center px-2" : "")}>
          <LogOut size={18} className="flex-shrink-0" />
          {!collapsed && <span>{T.logout}</span>}
        </button>
      </div>
    </div>
  );

  return (
    <>
      <aside className={cn("hidden flex-shrink-0 flex-col border-l border-[#2d4063] bg-[#151f34] transition-all duration-300 lg:flex", collapsed ? "w-16" : "w-72")}>
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
