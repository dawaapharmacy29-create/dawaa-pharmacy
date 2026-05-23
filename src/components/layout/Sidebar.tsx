import { NavLink, useNavigate, useLocation } from "react-router-dom";
import {
  ActivitySquare,
  BellRing,
  Crown,
  BarChart3,
  Calendar,
  ChevronLeft,
  ClipboardCheck,
  ClipboardList,
  Settings2,
  Clock,
  FileSpreadsheet,
  HeadphonesIcon,
  LayoutDashboard,
  LogOut,
  Package,
  PackageSearch,
  ShieldCheck,
  Star,
  TrendingUp,
  Truck,
  UserCheck,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { LOGO_URL } from "@/lib/constants";
import { useEffect, useRef } from "react";

const T = {
  shiftPerformance:
    "\u062a\u0642\u064a\u064a\u0645 \u0627\u0644\u0634\u064a\u0641\u062a\u0627\u062a",
  dashboard: "\u0644\u0648\u062d\u0629 \u0627\u0644\u062a\u062d\u0643\u0645",
  doctorDashboard:
    "\u0644\u0648\u062d\u0629 \u0627\u0644\u062f\u0643\u062a\u0648\u0631",
  customers: "\u0627\u0644\u0639\u0645\u0644\u0627\u0621",
  customerService:
    "\u062e\u062f\u0645\u0629 \u0627\u0644\u0639\u0645\u0644\u0627\u0621",
  customerRequests: "طلبات العملاء",
  team: "\u0627\u0644\u0641\u0631\u064a\u0642",
  schedule:
    "\u0627\u0644\u062c\u062f\u0648\u0644 \u0627\u0644\u0623\u0633\u0628\u0648\u0639\u064a",
  timeOff:
    "\u0627\u0644\u0625\u0630\u0648\u0646\u0627\u062a \u0648\u0627\u0644\u0625\u062c\u0627\u0632\u0627\u062a",
  points:
    "\u0627\u0644\u0646\u0642\u0627\u0637 \u0648\u0627\u0644\u0645\u0643\u0627\u0641\u0622\u062a",
  reviews:
    "\u062a\u0642\u064a\u064a\u0645 \u0627\u0644\u0645\u062d\u0627\u062f\u062b\u0627\u062a",
  stagnant:
    "\u0627\u0644\u0623\u062f\u0648\u064a\u0629 \u0627\u0644\u0631\u0648\u0627\u0643\u062f",
  incentive:
    "\u0623\u062f\u0648\u064a\u0629 \u0627\u0644\u0644\u0633\u062a\u0629",
  delivery:
    "\u0627\u0644\u062a\u0648\u0635\u064a\u0644 \u0648\u062a\u0642\u064a\u064a\u0645 \u0627\u0644\u062f\u0644\u064a\u0641\u0631\u064a",
  analytics:
    "\u0627\u0644\u062a\u062d\u0644\u064a\u0644\u0627\u062a \u0648\u0627\u0644\u0645\u0628\u064a\u0639\u0627\u062a",
  invoices:
    "\u0627\u0633\u062a\u064a\u0631\u0627\u062f \u0627\u0644\u0641\u0648\u0627\u062a\u064a\u0631",
  accounts:
    "\u062d\u0633\u0627\u0628\u0627\u062a \u0648\u0635\u0644\u0627\u062d\u064a\u0627\u062a",
  activity: "\u0633\u062c\u0644 \u0627\u0644\u0623\u0646\u0634\u0637\u0629",
  pharmacist: "\u0635\u064a\u062f\u0644\u0627\u0646\u064a",
  admin: "\u0623\u062f\u0645\u0646",
  branchManager: "\u0645\u062f\u064a\u0631 \u0641\u0631\u0639",
  appName: "Dawaa Pharmacy 2027",
  system: "نظام تشغيل الصيدلية الذكي",
  allBranches: "\u0643\u0644 \u0627\u0644\u0641\u0631\u0648\u0639",
  logout: "\u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062e\u0631\u0648\u062c",
  rolesPermissions:
    "\u0627\u0644\u0623\u062f\u0648\u0627\u0631 \u0648\u0627\u0644\u0635\u0644\u0627\u062d\u064a\u0627\u062a",
  penaltyIncentive:
    "\u0625\u062f\u0627\u0631\u0629 \u0627\u0644\u062c\u0632\u0627\u0621\u0627\u062a \u0648\u0627\u0644\u062d\u0648\u0627\u0641\u0632",
  staffDashboard:
    "\u0644\u0648\u062d\u0629 \u062a\u062d\u0643\u0645 \u0627\u0644\u0645\u0648\u0638\u0641",
  executive2027: "لوحة القيادة 2027",
  evaluationRules: "قواعد التقييم المرنة",
  quarterlyIncentives: "الحافز الربع سنوي",
  operationsCenter: "المهام والتنبيهات",
};

const NAV_ITEMS = [

  {
    path: "/",
    icon: Crown,
    label: T.executive2027,
    permission: "view_dashboard",
  },
  {
    path: "/operations-center",
    icon: BellRing,
    label: T.operationsCenter,
    permission: "view_dashboard",
  },
  {
    path: "/evaluation-rules",
    icon: Settings2,
    label: T.evaluationRules,
    adminOnly: true,
    permission: "manage_roles",
  },
  {
    path: "/quarterly-incentives",
    icon: Crown,
    label: T.quarterlyIncentives,
    permission: "view_points_rewards",
  },
  {
    path: "/dashboard-classic",
    icon: LayoutDashboard,
    label: T.dashboard,
    permission: "view_dashboard",
  },
  {
    path: "/doctor-dashboard",
    icon: Wallet,
    label: T.doctorDashboard,
    role: T.pharmacist,
    permission: "view_doctor_dashboard",
  },
  {
    path: "/staff-dashboard",
    icon: LayoutDashboard,
    label: T.staffDashboard,
    permission: "view_dashboard",
  },
  { path: "/team", icon: UserCheck, label: T.team, permission: "view_team" },
  {
    path: "/schedule",
    icon: Calendar,
    label: T.schedule,
    permission: "view_schedule",
  },
  {
    path: "/time-off",
    icon: Clock,
    label: T.timeOff,
    permission: "view_attendance_leaves",
  },
  {
    path: "/staff-accounts",
    icon: ShieldCheck,
    label: T.accounts,
    adminOnly: true,
    permission: "view_staff_accounts",
  },
  {
    path: "/roles-permissions",
    icon: ShieldCheck,
    label: T.rolesPermissions,
    adminOnly: true,
    permission: "manage_roles",
  },
  {
    path: "/customers",
    icon: Users,
    label: T.customers,
    permission: "view_customers",
  },
  {
    path: "/customer-service",
    icon: HeadphonesIcon,
    label: T.customerService,
    permission: "view_customer_service",
  },
  {
    path: "/customer-requests",
    icon: PackageSearch,
    label: T.customerRequests,
    permission: "view_customer_service",
  },
  {
    path: "/reviews",
    icon: ClipboardCheck,
    label: T.reviews,
    permission: "view_conversation_reviews",
  },
  {
    path: "/points",
    icon: Star,
    label: T.points,
    permission: "view_points_rewards",
  },
  {
    path: "/penalty-incentive",
    icon: ShieldCheck,
    label: T.penaltyIncentive,
    adminOnly: true,
    permission: "manage_roles",
  },
  {
    path: "/stagnant-medicines",
    icon: Package,
    label: T.stagnant,
    role: T.pharmacist,
    permission: "view_stagnant_medicines",
  },
  {
    path: "/incentive-medicines",
    icon: TrendingUp,
    label: T.incentive,
    role: T.pharmacist,
    permission: "view_incentive_medicines",
  },
  {
    path: "/delivery",
    icon: Truck,
    label: T.delivery,
    permission: "view_delivery",
  },
  {
    path: "/analytics",
    icon: BarChart3,
    label: T.analytics,
    permission: "view_analytics_sales",
  },
  {
    path: "/invoices",
    icon: FileSpreadsheet,
    label: T.invoices,
    permission: "view_invoice_import",
  },
  {
    path: "/shift-performance",
    icon: ClipboardList,
    label: T.shiftPerformance,
    permission: "view_shift_performance",
  },
  {
    path: "/activity-log",
    icon: ActivitySquare,
    label: T.activity,
    adminOnly: true,
    permission: "view_activity_logs",
  },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export default function Sidebar({
  collapsed,
  onToggle,
  mobileOpen,
  onMobileClose,
}: SidebarProps) {
  const { user, logout, isAdmin, checkPermission } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const navRef = useRef<HTMLDivElement>(null);
  const unread = 0;

  // Preserve sidebar scroll position on navigation
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    // Save scroll position before navigation
    const handleBeforeUnload = () => {
      sessionStorage.setItem("sidebarScroll", nav.scrollTop.toString());
    };

    // Restore scroll position on mount
    const savedScroll = sessionStorage.getItem("sidebarScroll");
    if (savedScroll) {
      nav.scrollTop = parseInt(savedScroll, 10);
    }

    // Save scroll position on route change
    nav.addEventListener("scroll", () => {
      sessionStorage.setItem("sidebarScroll", nav.scrollTop.toString());
    });

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      nav.removeEventListener("scroll", () => {
        sessionStorage.setItem("sidebarScroll", nav.scrollTop.toString());
      });
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [location.pathname]);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const privilegedRoles = new Set([
    T.admin,
    T.branchManager,
    "\u0645\u062f\u064a\u0631 \u0639\u0627\u0645",
    "\u0627\u0644\u0645\u062f\u064a\u0631 \u0627\u0644\u0639\u0627\u0645",
  ]);

  const items = NAV_ITEMS.filter((item) => {
    if (item.adminOnly && !isAdmin) return false;
    if (
      item.role &&
      user?.role !== item.role &&
      !privilegedRoles.has(user?.role || "")
    )
      return false;
    if (!checkPermission(item.permission)) return false;
    return true;
  });

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      <div
        className={cn(
          "flex items-center gap-3 p-4 border-b border-[#2d4063]",
          collapsed ? "justify-center" : "",
        )}
      >
        <div className="logo-tile w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0">
          <img
            src={LOGO_URL}
            alt={T.appName}
            className="w-8 h-8 object-contain"
          />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="text-white font-bold text-sm leading-tight">
              {T.appName}
            </div>
            <div className="text-teal-400 text-xs truncate">{T.system}</div>
          </div>
        )}
        <button
          onClick={onToggle}
          className="hidden lg:flex mr-auto p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-all"
          aria-label="toggle sidebar"
        >
          <ChevronLeft
            className={cn(
              "w-4 h-4 transition-transform duration-200",
              collapsed ? "rotate-180" : "",
            )}
          />
        </button>
      </div>

      <div
        className={cn(
          "px-3 py-3 border-b border-[#2d4063]",
          collapsed ? "flex justify-center" : "",
        )}
      >
        {collapsed ? (
          <div className="w-8 h-8 rounded-full bg-teal-500/20 flex items-center justify-center text-teal-400 text-xs font-bold">
            {user?.name?.[0]}
          </div>
        ) : (
          <div className="flex items-center gap-2.5 bg-white/5 rounded-xl p-2.5">
            <div className="w-8 h-8 rounded-full bg-teal-500/20 flex items-center justify-center text-teal-400 text-xs font-bold flex-shrink-0">
              {user?.name?.[0]}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-white text-xs font-semibold truncate">
                {user?.name}
              </div>
              <div className="text-slate-400 text-xs truncate">
                {user?.role} -{" "}
                {user?.branch === "\u0627\u0644\u0643\u0644"
                  ? T.allBranches
                  : user?.branch}
              </div>
            </div>
            {unread > 0 && (
              <span className="bg-teal-500 text-navy-900 text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0">
                {unread}
              </span>
            )}
          </div>
        )}
      </div>

      <nav
        ref={navRef}
        className="flex-1 p-3 space-y-0.5 overflow-y-auto"
        id="sidebar-nav"
      >
        {items.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === "/"}
            onClick={onMobileClose}
            className={({ isActive }) =>
              cn(
                "nav-item",
                isActive ? "nav-item-active" : "nav-item-inactive",
                collapsed ? "justify-center px-2" : "",
              )
            }
          >
            <item.icon className="w-4.5 h-4.5 flex-shrink-0" size={18} />
            {!collapsed && <span>{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      <div className="p-3 border-t border-[#2d4063]">
        <button
          onClick={handleLogout}
          className={cn(
            "nav-item nav-item-inactive text-red-400 hover:text-red-300 hover:bg-red-500/10 w-full",
            collapsed ? "justify-center px-2" : "",
          )}
        >
          <LogOut size={18} className="flex-shrink-0" />
          {!collapsed && <span>{T.logout}</span>}
        </button>
      </div>
    </div>
  );

  return (
    <>
      <aside
        className={cn(
          "hidden lg:flex flex-col bg-[#151f34] border-l border-[#2d4063] transition-all duration-300 flex-shrink-0",
          collapsed ? "w-16" : "w-60",
        )}
      >
        <SidebarContent />
      </aside>

      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black/60" onClick={onMobileClose} />
          <aside className="relative w-64 bg-[#151f34] border-l border-[#2d4063] h-full mr-auto flex flex-col animate-slide-in">
            <button
              onClick={onMobileClose}
              className="absolute top-4 left-4 p-1.5 rounded-lg text-slate-400 hover:text-white"
            >
              <X size={18} />
            </button>
            <SidebarContent />
          </aside>
        </div>
      )}
    </>
  );
}
