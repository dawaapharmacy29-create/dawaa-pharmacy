import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
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
  Package,
  PackageCheck,
  PackageSearch,
  ShieldCheck,
  Sparkles,
  Star,
  Store,
  Syringe,
  Target,
  Trash2,
  Truck,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import QuickFollowupModal from "@/components/common/QuickFollowupModal";
import QuickCustomerCodingModal from "@/components/common/QuickCustomerCodingModal";
import { supabase } from "@/lib/supabase";
import { LOGO_URL } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { getVisibleSectionsForPath } from "@/lib/permissionMatrix";

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
    title: "المهام اليومية",
    icon: ClipboardList,
    items: [
      { path: "/shift-notes", icon: ClipboardList, label: "ملاحظات الشيفت", permission: "view_dashboard" },
      { path: "/customer-requests", icon: BellRing, label: "طلب متابعة", permission: "view_customer_service" },
      { path: "/customer-coding", icon: UserPlus, label: "تكويد العملاء", permission: "view_customer_service" },
    ],
  },
  {
    title: "لوحة القيادة",
    icon: Crown,
    items: [
      { path: "/", icon: Crown, label: "لوحة القيادة 2027", permission: "view_dashboard" },
      { path: "/operations-center", icon: BellRing, label: "المهام والتنبيهات", permission: "view_dashboard" },
      { path: "/daily-command", icon: Target, label: "مركز القيادة اليومي", permission: "view_dashboard" },
      { path: "/data-health", icon: ShieldCheck, label: "صحة البيانات", permission: "view_dashboard" },
      { path: "/activity-log", icon: ActivitySquare, label: "سجل الأنشطة", adminOnly: true, permission: "view_activity_logs" },
    ],
  },
  {
    title: "الموارد البشرية",
    icon: UserCheck,
    items: [
      { path: "/team", icon: UserCheck, label: "الفريق والجدول", permission: "view_team" },
      { path: "/schedule", icon: Calendar, label: "الجداول والإجازات", permission: "view_schedule" },
      { path: "/staff-accounts", icon: ShieldCheck, label: "الحسابات والصلاحيات", adminOnly: true, permission: "view_staff_accounts" },
      { path: "/shift-performance", icon: ClipboardList, label: "تقييم الشيفتات", permission: "view_shift_performance" },
      { path: "/attendance-report", icon: ClipboardCheck, label: "تقرير الحضور", permission: "view_team" },
    ],
  },
  {
    title: "العملاء والخدمات",
    icon: HeadphonesIcon,
    items: [
      { path: "/customers", icon: Users, label: "العملاء", permission: "view_customers" },
      { path: "/customer-service", icon: HeadphonesIcon, label: "خدمة العملاء", permission: "view_customer_service" },
      { path: "/customer-data-review", icon: ClipboardCheck, label: "بيانات العملاء", permission: "page.customer_data_review.view" },
      { path: "/customer-cashback", icon: Wallet, label: "النقاط والولاء", permission: "view_customer_service" },
      { path: "/refill-reminders", icon: Calendar, label: "إعادة صرف الدواء", permission: "view_customers" },
      { path: "/customer-requests", icon: PackageSearch, label: "طلبات العملاء", permission: "view_customer_service" },
      { path: "/reviews", icon: ClipboardCheck, label: "تقييم المحادثات", permission: "view_conversation_reviews" },
    ],
  },
  {
    title: "المبيعات والتحليل",
    icon: BarChart3,
    items: [
      { path: "/analytics", icon: BarChart3, label: "التحليلات والمبيعات", permission: "view_analytics_sales" },
      { path: "/invoices", icon: FileSpreadsheet, label: "استيراد الفواتير", permission: "view_invoice_import" },
      { path: "/branch-comparison", icon: BarChart3, label: "مقارنة الفروع", permission: "view_analytics_sales" },
    ],
  },
  {
    title: "المخزون والتشغيل",
    icon: Store,
    items: [
      { path: "/shortages", icon: PackageSearch, label: "النواقص", permission: "view_dashboard" },
      { path: "/stagnant-medicines", icon: Package, label: "الأدوية الراكدة", role: T.pharmacist, permission: "view_stagnant_medicines" },
      { path: "/medicine-expiry", icon: AlertTriangle, label: "صلاحية الأدوية", permission: "view_stagnant_medicines" },
      { path: "/purchases", icon: FileSpreadsheet, label: "المشتريات والموردين", permission: "view_dashboard" },
      { path: "/inventory-counts", icon: ClipboardList, label: "الجرد", permission: "view_dashboard" },
    ],
  },
  {
    title: "الحوافز والتوصيل",
    icon: Star,
    items: [
      { path: "/points", icon: Star, label: "النقاط والمكافآت", permission: "view_points_rewards" },
      { path: "/staff-payroll", icon: Wallet, label: "قبض الموظفين", permission: "view_points_rewards" },
      { path: "/quarterly-incentives", icon: Crown, label: "الحافز الربع سنوي", permission: "view_points_rewards" },
      { path: "/delivery", icon: Truck, label: "التوصيل والدليفري", permission: "view_delivery" },
    ],
  },
  {
    title: "الإعدادات والإدارة",
    icon: ShieldCheck,
    items: [
      { path: "/staff-accounts", icon: ShieldCheck, label: "إدارة الحسابات", adminOnly: true, permission: "view_staff_accounts" },
      { path: "/penalty-incentive", icon: AlertTriangle, label: "الجزاءات والحوافز", adminOnly: true, permission: "manage_roles" },
      { path: "/evaluation-rules", icon: ClipboardCheck, label: "قواعد التقييم", adminOnly: true, permission: "manage_roles" },
      { path: "/roles-permissions", icon: ShieldCheck, label: "الصلاحيات", adminOnly: true, permission: "manage_roles" },
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
  const [openFollowup, setOpenFollowup] = useState(false);
  const [openCoding, setOpenCoding] = useState(false);
  const [badges, setBadges] = useState<{ shift: number; followups: number; coding: number }>({ shift: 0, followups: 0, coding: 0 });
  const navigate = useNavigate();
  const location = useLocation();
  const navRef = useRef<HTMLDivElement>(null);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const privilegedRoles = useMemo(() => new Set([T.admin, T.branchManager, "مدير عام", "المدير العام", "general_manager", "executive_manager", "branches_manager", "branch_manager"]), []);

  const groups = useMemo(() => {
    return GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.adminOnly && !isAdmin) return false;
        if (item.role && user?.role !== item.role && !privilegedRoles.has(user?.role || "")) return false;
        if (!checkPermission(item.permission) && !isAdmin && !privilegedRoles.has(user?.role || "")) return false;
        return true;
      }),
    })).filter((group) => group.items.length > 0);
  }, [checkPermission, isAdmin, privilegedRoles, user?.role]);

  useEffect(() => {
    let mounted = true;
    async function loadCounts() {
      try {
        // followups count (not completed)
        const f = await supabase.from("followups").select("id", { head: true, count: "exact" }).neq("followup_status", "completed");
        const followupsCount = f.count || 0;
        // shift notes count (open)
        const s = await supabase.from("shift_notes").select("id", { head: true, count: "exact" }).neq("status", "done");
        const shiftCount = s.count || 0;
        // customers without code
        const c = await supabase.from("customers").select("id", { head: true, count: "exact" }).is("customer_code", null);
        const codingCount = c.count || 0;
        if (mounted) setBadges({ shift: shiftCount, followups: followupsCount, coding: codingCount });
      } catch (e) {
        console.warn("Failed to load sidebar counts", e);
      }
    }
    loadCounts();
    const interval = setInterval(loadCounts, 60 * 1000);

    // refresh counts when other parts of the app dispatch a dataChanged event
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { table?: string } | undefined;
      // reload counts on any relevant change
      if (!detail || ["followups", "shift_notes", "customers"].includes(detail.table || "")) {
        loadCounts();
      }
    };
    window.addEventListener("dataChanged", handler as EventListener);

    return () => {
      mounted = false;
      clearInterval(interval);
      window.removeEventListener("dataChanged", handler as EventListener);
    };
  }, []);

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
    const timerId = window.setTimeout(restore, 120);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timerId);
    };
  }, [location.pathname, groups.length]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onMobileClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen, onMobileClose]);

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

      {!collapsed && (
        <div className="px-3 py-2">
          <div className="flex gap-2">
            <button onClick={() => setOpenFollowup(true)} className="flex-1 rounded-lg bg-teal-500/10 px-3 py-2 text-xs font-bold text-teal-200">متابعة سريعة</button>
            <button onClick={() => setOpenCoding(true)} className="flex-1 rounded-lg bg-sky-500/10 px-3 py-2 text-xs font-bold text-sky-200">تكويد عميل</button>
          </div>
        </div>
      )}

      <QuickFollowupModal open={openFollowup} onClose={() => setOpenFollowup(false)} />
      <QuickCustomerCodingModal open={openCoding} onClose={() => setOpenCoding(false)} />

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
                  onClick={() => {
                    if (navRef.current) sessionStorage.setItem("sidebarScroll", navRef.current.scrollTop.toString());
                    setOpenGroups((current) => ({ ...current, [group.title]: !current[group.title] }));
                  }}
                  className={cn("flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold transition", active ? "bg-teal-500/10 text-teal-200" : "text-slate-400 hover:bg-white/5 hover:text-white")}
                >
                  <GroupIcon size={15} />
                  <span className="flex-1 text-right">{group.title}</span>
                  <ChevronDown size={14} className={cn("transition-transform", open ? "rotate-180" : "")} />
                </button>
              )}
              {open && (
                <div className={cn("space-y-0.5", collapsed ? "" : "pr-2")}>
                  {group.items.map((item) => {
                    const itemActive = isRouteActive(item.path, location.pathname);
                    const visibleSections = getVisibleSectionsForPath(item.path, checkPermission);
                    // Determine badge value for special items
                    let badgeValue: number | undefined = item.badge;
                    if (item.path === "/shift-notes") badgeValue = badges.shift;
                    if (item.path === "/customer-requests") badgeValue = badges.followups;
                    if (item.path === "/customer-coding") badgeValue = badges.coding;
                    return (
                      <div key={item.path} className="space-y-1">
                        <NavLink
                          to={item.path}
                          end={item.path === "/"}
                          onClick={() => {
                            if (navRef.current) sessionStorage.setItem("sidebarScroll", navRef.current.scrollTop.toString());
                            onMobileClose();
                          }}
                          className={() => cn("nav-item", itemActive ? "nav-item-active" : "nav-item-inactive", collapsed ? "justify-center px-2" : "")}
                          title={collapsed ? item.label : undefined}
                        >
                          <item.icon className="h-4.5 w-4.5 flex-shrink-0" size={18} />
                          {!collapsed && <span className="flex items-center justify-between w-full">{item.label}{badgeValue ? <span className="ml-2 inline-flex items-center rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-black">{badgeValue}</span> : null}</span>}
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
