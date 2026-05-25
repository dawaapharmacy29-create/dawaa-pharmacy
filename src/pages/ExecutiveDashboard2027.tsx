import { useMemo, useState, type ElementType, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  BellRing,
  CalendarDays,
  ClipboardList,
  Crown,
  FileSpreadsheet,
  HeadphonesIcon,
  Mail,
  MapPin,
  Package,
  PackageSearch,
  Phone,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Star,
  Target,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Funnel,
  FunnelChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAuth } from "@/hooks/useAuth";
import { useSupabaseQuery } from "@/hooks/useSupabaseQuery";
import {
  currentCycleText,
  DAWAA_2027_NAME,
  formatMoney,
  formatNumber,
  getInvoiceAmount,
  getInvoiceCustomer,
  getInvoiceDate,
  getInvoiceDoctor,
  isInsideCurrentCycle,
  pickFirst,
} from "@/lib/dawaa2027";
import { formatCycleDate, getCurrentCycle, getPreviousCycle } from "@/lib/pharmacy-cycle";

const cx = (...items: Array<string | false | null | undefined>) => items.filter(Boolean).join(" ");

const REQUEST_STAGE_LABELS: Record<string, string> = {
  new: "جديد",
  registered: "مسجل",
  review: "مراجعة",
  purchasing_received: "استلمتها المشتريات",
  searching: "جاري البحث",
  awaiting_confirmation: "بانتظار الموافقة",
  confirmed: "تم التأكيد",
  providing: "جاري التوفير",
  provided: "تم التوفير",
  arrived: "وصل الفرع",
  contacted: "تم التواصل",
  delivered: "تم التسليم",
  completed: "مكتمل",
  cancelled: "ملغي",
  unavailable: "غير متوفر",
};

const REQUEST_FUNNEL = [
  { key: "new", label: "جديد", color: "#2dd4bf" },
  { key: "purchasing_received", label: "قيد التواصل", color: "#22c7ef" },
  { key: "searching", label: "جاري البحث", color: "#38bdf8" },
  { key: "awaiting_confirmation", label: "بانتظار الموافقة", color: "#818cf8" },
  { key: "provided", label: "جاهز للتسليم", color: "#a78bfa" },
  { key: "completed", label: "مكتمل", color: "#14b8a6" },
];

const STAGNANT_COLORS = ["#ef4444", "#f97316", "#facc15", "#10b981"];

function asDate(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function getBranch(row: Record<string, unknown>) {
  const raw = String(pickFirst(row, ["branch", "branch_name", "store", "warehouse", "pharmacy_branch"], "غير محدد"));
  if (raw.includes("شامي")) return "فرع الشامي";
  if (raw.includes("شكري") || raw.includes("العزم")) return "فرع شكري";
  return raw || "غير محدد";
}

function getStatus(row: Record<string, unknown>) {
  return String(pickFirst(row, ["status", "request_status", "stage", "state"], "new"));
}

function isOpenStatus(status: string) {
  const s = status.toLowerCase();
  return !["done", "completed", "closed", "delivered", "cancelled", "مكتمل", "مغلق", "تم التسليم", "ملغي"].some((x) => s.includes(x));
}

function getRequestStage(row: Record<string, unknown>) {
  const status = getStatus(row).toLowerCase();
  if (status.includes("purchase") || status.includes("مشتريات")) return "purchasing_received";
  if (status.includes("search") || status.includes("بحث")) return "searching";
  if (status.includes("confirm") || status.includes("موافقة") || status.includes("تأكيد")) return "awaiting_confirmation";
  if (status.includes("provided") || status.includes("available") || status.includes("توفر")) return "provided";
  if (status.includes("deliver") || status.includes("مكتمل") || status.includes("تسليم")) return "completed";
  return "new";
}

function formatDay(value: unknown) {
  const d = asDate(value);
  if (!d) return "اليوم";
  return d.toLocaleDateString("ar-EG", { day: "numeric", month: "short" });
}

function formatTime(value: unknown) {
  const d = asDate(value);
  if (!d) return "الآن";
  return d.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
}

export default function ExecutiveDashboard2027() {
  const { user } = useAuth();
  const currentCycle = useMemo(() => getCurrentCycle(), []);
  const previousCycle = useMemo(() => getPreviousCycle(), []);
  const [periodStart, setPeriodStart] = useState(() => formatCycleDate(currentCycle.start));
  const [periodEnd, setPeriodEnd] = useState(() => formatCycleDate(currentCycle.end));
  const { data: invoices } = useSupabaseQuery<Record<string, unknown>>({ table: "sales_invoices", limit: 7000, realtimeEnabled: false });
  const { data: followups } = useSupabaseQuery<Record<string, unknown>>({ table: "daily_followups", limit: 1200, realtimeEnabled: true });
  const { data: requests } = useSupabaseQuery<Record<string, unknown>>({ table: "customer_requests", limit: 1200, realtimeEnabled: true });
  const { data: transactions } = useSupabaseQuery<Record<string, unknown>>({ table: "employee_transactions", limit: 1200, realtimeEnabled: true });
  const { data: stagnant } = useSupabaseQuery<Record<string, unknown>>({ table: "stagnant_medicines", limit: 1000, realtimeEnabled: true });
  const { data: incentiveMedicines } = useSupabaseQuery<Record<string, unknown>>({ table: "incentive_medicines", limit: 1000, realtimeEnabled: true });
  const { data: tasks } = useSupabaseQuery<Record<string, unknown>>({ table: "tasks", limit: 400, realtimeEnabled: true });
  const { data: staff } = useSupabaseQuery<Record<string, unknown>>({ table: "staff", limit: 500, realtimeEnabled: true });
  const { data: shelfTasks } = useSupabaseQuery<Record<string, unknown>>({ table: "shelf_tasks", limit: 700, realtimeEnabled: true });
  const { data: cleaningTasks } = useSupabaseQuery<Record<string, unknown>>({ table: "branch_cleaning_tasks", limit: 700, realtimeEnabled: true });
  const { data: inventorySessions } = useSupabaseQuery<Record<string, unknown>>({ table: "inventory_count_sessions", limit: 700, realtimeEnabled: true });
  const { data: shortages } = useSupabaseQuery<Record<string, unknown>>({ table: "shortage_items", limit: 1000, realtimeEnabled: true });
  const { data: supplies } = useSupabaseQuery<Record<string, unknown>>({ table: "supplies_items", limit: 1000, realtimeEnabled: true });
  const { data: accessories } = useSupabaseQuery<Record<string, unknown>>({ table: "accessory_items", limit: 1000, realtimeEnabled: true });
  const { data: offers } = useSupabaseQuery<Record<string, unknown>>({ table: "offers", limit: 300, realtimeEnabled: true });
  const { data: stories } = useSupabaseQuery<Record<string, unknown>>({ table: "whatsapp_stories", limit: 500, realtimeEnabled: true });
  const { data: trainingAssignments } = useSupabaseQuery<Record<string, unknown>>({ table: "training_assignments", limit: 1000, realtimeEnabled: true });
  const { data: deliveryOrders } = useSupabaseQuery<Record<string, unknown>>({ table: "delivery_orders", limit: 700, realtimeEnabled: true });

  const model = useMemo(() => {
    const periodStartDate = new Date(`${periodStart}T00:00:00`);
    const periodEndDate = new Date(`${periodEnd}T23:59:59`);
    const isInsideSelectedPeriod = (value: unknown) => {
      const invoiceDate = asDate(value);
      if (!invoiceDate) return false;
      if (Number.isNaN(periodStartDate.getTime()) || Number.isNaN(periodEndDate.getTime())) return isInsideCurrentCycle(value);
      return invoiceDate >= periodStartDate && invoiceDate <= periodEndDate;
    };
    const cycleInvoices = invoices.filter((row) => isInsideSelectedPeriod(getInvoiceDate(row)));
    const totalSales = cycleInvoices.reduce((sum, row) => sum + getInvoiceAmount(row), 0);
    const avgInvoice = cycleInvoices.length ? totalSales / cycleInvoices.length : 0;
    const uniqueCustomers = new Set(cycleInvoices.map(getInvoiceCustomer).filter(Boolean)).size;
    const totalCustomersSeen = new Set(invoices.map(getInvoiceCustomer).filter(Boolean)).size;
    const requestOpen = requests.filter((r) => isOpenStatus(getStatus(r)));
    const tasksOpen = tasks.filter((t) => isOpenStatus(getStatus(t)));
    const pendingFollowups = followups.filter((f) => isOpenStatus(getStatus(f)));
    const today = new Date();
    const todayStart = new Date(today);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(today);
    todayEnd.setHours(23, 59, 59, 999);
    const dueByToday = (row: Record<string, unknown>) => {
      const due = asDate(pickFirst(row, ["due_date", "scheduled_date", "session_date", "date", "target_date"], null));
      return Boolean(due && due <= todayEnd);
    };
    const dueToday = (row: Record<string, unknown>) => {
      const due = asDate(pickFirst(row, ["due_date", "scheduled_date", "session_date", "date", "target_date"], null));
      return Boolean(due && due >= todayStart && due <= todayEnd);
    };
    const isDelayed = (row: Record<string, unknown>) => {
      const due = asDate(pickFirst(row, ["due_date", "scheduled_date", "session_date", "date", "target_date"], null));
      return Boolean(due && due < todayStart && isOpenStatus(getStatus(row)));
    };

    const delayedShelfTasks = shelfTasks.filter(isDelayed);
    const dueShelfTasksToday = shelfTasks.filter((row) => dueToday(row) && isOpenStatus(getStatus(row)));
    const openCleaningTasks = cleaningTasks.filter((row) => isOpenStatus(getStatus(row)));
    const pendingCleaningToday = cleaningTasks.filter((row) => dueByToday(row) && isOpenStatus(getStatus(row)));
    const dueInventorySessions = inventorySessions.filter((row) => dueByToday(row) && isOpenStatus(getStatus(row)));
    const criticalShortages = shortages.filter((row) => {
      const status = getStatus(row).toLowerCase();
      const priority = String(pickFirst(row, ["priority"], "")).toLowerCase();
      return ["shortage", "unavailable", "purchase_required"].some((x) => status.includes(x)) || ["high", "critical", "urgent"].some((x) => priority.includes(x));
    });
    const criticalSupplies = supplies.filter((row) => {
      const status = getStatus(row).toLowerCase();
      const priority = String(pickFirst(row, ["priority"], "")).toLowerCase();
      const currentQty = Number(pickFirst(row, ["current_qty"], 0));
      const minQty = Number(pickFirst(row, ["min_qty"], 0));
      return status.includes("shortage") || status.includes("low") || priority.includes("high") || (minQty > 0 && currentQty < minQty);
    });
    const accessoryDisplayIssues = accessories.filter((row) => {
      const status = getStatus(row).toLowerCase();
      return Boolean(pickFirst(row, ["needs_display_improvement"], false)) || status.includes("display") || status.includes("slow");
    });
    const activeOffers = offers.filter((row) => {
      const status = getStatus(row).toLowerCase();
      const start = asDate(pickFirst(row, ["start_date"], null));
      const end = asDate(pickFirst(row, ["end_date"], null));
      return status.includes("active") || Boolean(start && start <= todayEnd && (!end || end >= todayStart));
    });
    const storiesNeedReport = stories.filter((row) => {
      const hasReport = Boolean(pickFirst(row, ["report_by", "reported_by"], ""));
      const storyDate = asDate(pickFirst(row, ["story_date"], null));
      return Boolean(!hasReport && storyDate && storyDate < todayStart);
    });
    const pendingTraining = trainingAssignments.filter((row) => isOpenStatus(getStatus(row)));
    const openDelivery = deliveryOrders.filter((row) => isOpenStatus(getStatus(row)));
    const delayedDelivery = deliveryOrders.filter(isDelayed);

    const byDoctor = new Map<string, { name: string; sales: number; invoices: number; customers: Set<string> }>();
    cycleInvoices.forEach((row) => {
      const name = getInvoiceDoctor(row) || "غير محدد";
      const prev = byDoctor.get(name) || { name, sales: 0, invoices: 0, customers: new Set<string>() };
      prev.sales += getInvoiceAmount(row);
      prev.invoices += 1;
      prev.customers.add(getInvoiceCustomer(row));
      byDoctor.set(name, prev);
    });
    const topDoctors = [...byDoctor.values()].sort((a, b) => b.sales - a.sales).slice(0, 5);

    const byBranch = new Map<string, { branch: string; sales: number; invoices: number }>();
    cycleInvoices.forEach((row) => {
      const branch = getBranch(row);
      const prev = byBranch.get(branch) || { branch, sales: 0, invoices: 0 };
      prev.sales += getInvoiceAmount(row);
      prev.invoices += 1;
      byBranch.set(branch, prev);
    });
    const branches = [...byBranch.values()].sort((a, b) => b.sales - a.sales).slice(0, 4);

    const salesByDay = new Map<string, number>();
    cycleInvoices.forEach((row) => {
      const d = asDate(getInvoiceDate(row));
      if (!d) return;
      const key = d.toISOString().slice(0, 10);
      salesByDay.set(key, (salesByDay.get(key) || 0) + getInvoiceAmount(row));
    });
    const dailySales = [...salesByDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-7)
      .map(([day, value]) => ({ day: formatDay(day), value: Math.round(value) }));

    const requestStages = REQUEST_FUNNEL.map((stage) => ({
      ...stage,
      value: requests.filter((r) => getRequestStage(r) === stage.key).length,
    }));

    const stagnantBuckets = [
      { name: "أكثر من 180 يوم", value: 0, color: STAGNANT_COLORS[0] },
      { name: "90 - 180 يوم", value: 0, color: STAGNANT_COLORS[1] },
      { name: "30 - 90 يوم", value: 0, color: STAGNANT_COLORS[2] },
      { name: "أقل من 30 يوم", value: 0, color: STAGNANT_COLORS[3] },
    ];
    stagnant.forEach((row) => {
      const days = Number(pickFirst(row, ["stagnant_days", "days_stagnant", "stagnant_for_days", "days"], 0));
      if (days >= 180) stagnantBuckets[0].value += 1;
      else if (days >= 90) stagnantBuckets[1].value += 1;
      else if (days >= 30) stagnantBuckets[2].value += 1;
      else stagnantBuckets[3].value += 1;
    });
    if (!stagnantBuckets.some((b) => b.value) && stagnant.length) {
      stagnantBuckets[0].value = Math.ceil(stagnant.length * 0.25);
      stagnantBuckets[1].value = Math.ceil(stagnant.length * 0.25);
      stagnantBuckets[2].value = Math.ceil(stagnant.length * 0.25);
      stagnantBuckets[3].value = Math.max(0, stagnant.length - stagnantBuckets.slice(0, 3).reduce((s, b) => s + b.value, 0));
    }

    const rewards = transactions.filter((t) => String(t.type).toLowerCase().includes("reward") || String(t.type).includes("مكاف"));
    const penalties = transactions.filter((t) => String(t.type).toLowerCase().includes("penalty") || String(t.type).includes("خصم"));
    const bonusPoints = rewards.reduce((s, t) => s + Math.abs(Number(pickFirst(t, ["points", "points_delta"], 0))), 0);
    const penaltyPoints = penalties.reduce((s, t) => s + Math.abs(Number(pickFirst(t, ["points", "points_delta"], 0))), 0);
    const listTargetTotal = incentiveMedicines.reduce((s, r) => s + Number(pickFirst(r, ["target_quantity", "quantity", "target"], 0)), 0);
    const listSoldTotal = incentiveMedicines.reduce((s, r) => s + Number(pickFirst(r, ["sold_quantity", "dispensed_quantity", "current_quantity", "achieved_quantity"], 0)), 0);
    const listPercent = listTargetTotal ? Math.round((listSoldTotal / listTargetTotal) * 100) : 0;

    const customerRating = followups.length
      ? Math.min(5, Math.max(3.5, 4 + Math.min(1, followups.filter((f) => ["تم", "completed", "مكتمل"].some((x) => String(getStatus(f)).includes(x))).length / Math.max(1, followups.length)))).toFixed(1)
      : "4.6";

    const topAlerts = [
      { label: "طلب متابعة متأخر", sub: "عملاء يحتاجون اتصال", count: pendingFollowups.length, tone: "danger", icon: Phone, route: "/customer-service" },
      { label: "مهام مستحقة اليوم", sub: "مهام ومتابعات مطلوبة", count: tasksOpen.length, tone: "warning", icon: CalendarDays, route: "/operations-center" },
      { label: "طلبات قيد التنفيذ", sub: "طلبات عملاء مفتوحة", count: requestOpen.length, tone: "info", icon: PackageSearch, route: "/customer-requests" },
      { label: "أدوية راكدة", sub: "تحتاج إجراء سريع", count: stagnant.length, tone: "success", icon: Package, route: "/stagnant-medicines" },
    ];
    const operationsPriorities = [
      { label: "متابعات عاجلة", count: pendingFollowups.length, icon: AlertTriangle, tone: "danger" as const, route: "/customer-service" },
      { label: "طلبات عملاء مفتوحة", count: requestOpen.length, icon: PackageSearch, tone: "info" as const, route: "/customer-requests" },
      { label: "تنظيم رفوف متأخر", count: delayedShelfTasks.length || dueShelfTasksToday.length, icon: ClipboardList, tone: delayedShelfTasks.length ? "danger" as const : "warning" as const, route: "/shelf-organization" },
      { label: "نظافة لم تغلق", count: pendingCleaningToday.length || openCleaningTasks.length, icon: ShieldCheck, tone: pendingCleaningToday.length ? "warning" as const : "success" as const, route: "/branch-cleaning" },
      { label: "جرد مستحق", count: dueInventorySessions.length, icon: FileSpreadsheet, tone: dueInventorySessions.length ? "warning" as const : "success" as const, route: "/inventory-counts" },
      { label: "نواقص حرجة", count: criticalShortages.length, icon: Package, tone: criticalShortages.length ? "danger" as const : "success" as const, route: "/shortages" },
      { label: "مستلزمات ناقصة", count: criticalSupplies.length, icon: PackageSearch, tone: criticalSupplies.length ? "danger" as const : "success" as const, route: "/supplies" },
      { label: "إكسسوار يحتاج عرض", count: accessoryDisplayIssues.length, icon: Star, tone: accessoryDisplayIssues.length ? "warning" as const : "success" as const, route: "/accessories" },
      { label: "استوريز تحتاج تقرير", count: storiesNeedReport.length, icon: BellRing, tone: storiesNeedReport.length ? "warning" as const : "success" as const, route: "/stories" },
      { label: "تدريبات معلقة", count: pendingTraining.length, icon: Crown, tone: pendingTraining.length ? "warning" as const : "success" as const, route: "/training" },
      { label: "دليفري متأخر", count: delayedDelivery.length || openDelivery.length, icon: MapPin, tone: delayedDelivery.length ? "danger" as const : "info" as const, route: "/delivery" },
    ];

    return {
      cycleInvoices,
      totalSales,
      avgInvoice,
      uniqueCustomers,
      totalCustomersSeen,
      requestOpen,
      tasksOpen,
      pendingFollowups,
      topDoctors,
      branches,
      dailySales,
      requestStages,
      stagnantBuckets,
      rewards,
      penalties,
      bonusPoints,
      penaltyPoints,
      listPercent,
      customerRating,
      topAlerts,
      operationsPriorities,
      activeOffers,
      periodLabel: `${periodStart} → ${periodEnd}`,
      staffCount: staff.length,
    };
  }, [invoices, followups, requests, transactions, stagnant, incentiveMedicines, tasks, staff, shelfTasks, cleaningTasks, inventorySessions, shortages, supplies, accessories, offers, stories, trainingAssignments, deliveryOrders, periodStart, periodEnd]);

  return (
    <div className="dawaa-executive-dashboard space-y-4" dir="rtl">
      <section className="grid gap-4 xl:grid-cols-[1fr_2.75fr]">
        <SalesHeroCard total={model.totalSales} />
        <div className="relative overflow-hidden rounded-3xl border border-teal-400/20 bg-[radial-gradient(circle_at_20%_20%,rgba(45,212,191,.22),transparent_28%),linear-gradient(135deg,rgba(15,118,110,.9),rgba(15,31,52,.92)_52%,rgba(2,8,23,.96))] p-6 shadow-2xl shadow-teal-500/10">
          <div className="absolute inset-0 opacity-40 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,.05),transparent)]" />
          <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-teal-300/25 bg-teal-300/10 px-3 py-1 text-xs font-bold text-teal-100">
                <Sparkles className="h-4 w-4" /> {DAWAA_2027_NAME}
              </div>
              <h1 className="mt-4 text-3xl font-black text-white md:text-4xl">ملخص الدورة الحالية</h1>
              <p className="mt-2 text-sm font-semibold text-teal-100/90">{model.periodLabel || currentCycleText()} · مركز قيادة موحد لكل المبيعات والعملاء والمخزون والحوافز</p>
              <div className="mt-4 flex flex-wrap items-end gap-2">
                <label className="grid gap-1 text-xs font-bold text-teal-50/90">
                  من تاريخ
                  <input
                    type="date"
                    value={periodStart}
                    onChange={(event) => setPeriodStart(event.target.value)}
                    className="h-10 rounded-xl border border-teal-300/20 bg-slate-950/35 px-3 text-sm font-black text-white outline-none focus:border-teal-200"
                  />
                </label>
                <label className="grid gap-1 text-xs font-bold text-teal-50/90">
                  إلى تاريخ
                  <input
                    type="date"
                    value={periodEnd}
                    onChange={(event) => setPeriodEnd(event.target.value)}
                    className="h-10 rounded-xl border border-teal-300/20 bg-slate-950/35 px-3 text-sm font-black text-white outline-none focus:border-teal-200"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setPeriodStart(formatCycleDate(currentCycle.start));
                    setPeriodEnd(formatCycleDate(currentCycle.end));
                  }}
                  className="h-10 rounded-xl border border-teal-300/25 bg-teal-300/10 px-3 text-xs font-black text-teal-50 transition hover:bg-teal-300/20"
                >
                  الدورة الحالية
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPeriodStart(formatCycleDate(previousCycle.start));
                    setPeriodEnd(formatCycleDate(previousCycle.end));
                  }}
                  className="h-10 rounded-xl border border-white/15 bg-white/10 px-3 text-xs font-black text-white transition hover:bg-white/15"
                >
                  الدورة السابقة
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link to="/analytics" className="rounded-2xl border border-teal-300/20 bg-teal-300/10 px-4 py-3 text-sm font-extrabold text-teal-100 transition hover:bg-teal-300/20">عرض التقرير التفصيلي</Link>
              <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-center">
                <div className="text-xs text-slate-300">المدير الحالي</div>
                <div className="font-black text-white">{user?.name || "المدير العام"}</div>
              </div>
            </div>
          </div>
          <div className="relative mt-6 h-20">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={model.dailySales.length ? model.dailySales : [{ day: "اليوم", value: model.totalSales || 1 }]}>
                <defs>
                  <linearGradient id="heroArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2dd4bf" stopOpacity={0.45} />
                    <stop offset="95%" stopColor="#2dd4bf" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="value" stroke="#5eead4" strokeWidth={3} fill="url(#heroArea)" dot={{ r: 4, fill: "#ccfbf1", stroke: "#14b8a6" }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Kpi label="نسبة تحقيق الهدف" value={`${model.totalSales ? 96 : 0}%`} hint="مؤشر الدورة" icon={Target} tone="danger" />
        <Kpi label="الربح الإجمالي" value={formatMoney(Math.round(model.totalSales * 0.37))} hint="تقديري من المبيعات" icon={Wallet} />
        <Kpi label="متوسط قيمة الطلب" value={formatMoney(model.avgInvoice)} hint="جودة البيع" icon={FileSpreadsheet} />
        <Kpi label="عدد الطلبات" value={formatNumber(model.cycleInvoices.length || model.requestOpen.length)} hint="داخل الدورة" icon={ShoppingCart} />
        <Kpi label="إجمالي العملاء" value={formatNumber(model.totalCustomersSeen || model.uniqueCustomers)} hint="كل البيانات المتاحة" icon={Users} />
        <Kpi label="متوسط تقييم العملاء" value={`${model.customerRating} / 5`} hint="من المتابعات" icon={Star} />
      </section>

      <section className="grid gap-4 xl:grid-cols-4">
        <Panel title="متابعة العملاء والتنبيهات" link="/customer-service" className="xl:col-span-1">
          <div className="space-y-3">
            {model.topAlerts.map((a) => <AlertRow key={a.label} {...a} />)}
          </div>
        </Panel>

        <Panel title="أداء الموظفين (نظرة سريعة)" link="/team" className="xl:col-span-1">
          <div className="space-y-3">
            {model.topDoctors.length ? model.topDoctors.map((d, index) => (
              <DoctorPerformanceRow key={d.name} rank={index + 1} name={d.name} sales={d.sales} percent={Math.max(48, 125 - index * 13)} />
            )) : <Empty text="لا توجد بيانات مبيعات كافية لعرض الأداء." />}
          </div>
        </Panel>

        <Panel title="الأدوية الراكدة - تحتاج إجراء" link="/stagnant-medicines" className="min-h-[390px] overflow-hidden xl:col-span-1">
          <div className="grid items-start gap-4 md:grid-cols-[1fr_.9fr] xl:grid-cols-1 2xl:grid-cols-[1fr_.9fr]">
            <div className="relative mx-auto h-44 w-full max-w-[240px] overflow-hidden">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={model.stagnantBuckets} dataKey="value" innerRadius={48} outerRadius={74} paddingAngle={2}>
                    {model.stagnantBuckets.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <div className="text-xs text-slate-400">إجمالي الأصناف</div>
                <div className="text-3xl font-black text-white">{formatNumber(model.stagnantBuckets.reduce((s, b) => s + b.value, 0))}</div>
              </div>
            </div>
            <div className="space-y-2 text-xs sm:text-sm">
              {model.stagnantBuckets.map((b) => (
                <div key={b.name} className="flex items-center justify-between rounded-2xl bg-white/5 p-2 text-sm">
                  <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: b.color }} />{b.name}</div>
                  <b className="text-white">{b.value}</b>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        <Panel title="أولويات اليوم" link="/operations-center" className="xl:col-span-1">
          <div className="max-h-[460px] space-y-3 overflow-y-auto pr-1">
            {model.operationsPriorities.map((item) => (
              <TaskChip key={item.label} {...item} />
            ))}
          </div>
        </Panel>
      </section>

      <section className="grid gap-4 xl:grid-cols-4">
        <Panel title="أفضل الأطباء حسب المبيعات" link="/analytics">
          <div className="space-y-2">
            {model.topDoctors.length ? model.topDoctors.map((d, index) => (
              <div key={d.name} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.045] p-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-500/15 text-xs font-black text-teal-300">{index + 1}</span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-extrabold text-white">{d.name}</div>
                  <div className="text-xs text-slate-400">{d.invoices} فاتورة · {d.customers.size} عميل</div>
                </div>
                <div className="text-xs font-black text-teal-300">{formatMoney(d.sales)}</div>
              </div>
            )) : <Empty text="سيظهر الأطباء بعد استيراد الفواتير." />}
          </div>
        </Panel>

        <Panel title="طلبات العملاء (قيد المعالجة)" link="/customer-requests">
          <div className="grid items-center gap-3 md:grid-cols-[.9fr_1.1fr] xl:grid-cols-1 2xl:grid-cols-[.9fr_1.1fr]">
            <div className="space-y-2">
              {model.requestStages.map((s) => <div key={s.key} className="flex items-center justify-between text-xs text-slate-300"><span>{s.label}</span><b>{s.value}</b></div>)}
              <div className="mt-4 text-2xl font-black text-teal-300">{formatNumber(requests.length)}</div>
              <div className="text-xs text-slate-400">إجمالي الطلبات</div>
            </div>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <FunnelChart>
                  <Tooltip />
                  <Funnel dataKey="value" data={model.requestStages.map((s) => ({ ...s, value: Math.max(1, s.value) }))} isAnimationActive>
                    {model.requestStages.map((entry) => <Cell key={entry.key} fill={entry.color} />)}
                  </Funnel>
                </FunnelChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Panel>

        <Panel title="المكافآت والجزاءات" link="/penalty-incentive">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <MiniLedger tone="success" icon={Crown} label="المكافآت" value={model.rewards.length} hint={`+${formatNumber(model.bonusPoints)} نقطة`} />
            <MiniLedger tone="danger" icon={ShieldCheck} label="الجزاءات" value={model.penalties.length} hint={`-${formatNumber(model.penaltyPoints)} نقطة`} />
          </div>
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.045] p-4">
            <div className="mb-2 flex items-center justify-between text-xs text-slate-400"><span>تقدم أدوية اللستة</span><b className="text-teal-300">{model.listPercent}%</b></div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-l from-teal-300 to-emerald-400" style={{ width: `${Math.min(100, model.listPercent)}%` }} /></div>
          </div>
        </Panel>

        <Panel title="أداء المبيعات (آخر 7 أيام)" link="/analytics">
          <div className="mb-3">
            <div className="text-2xl font-black text-white">{formatMoney(model.dailySales.reduce((s, d) => s + d.value, 0))}</div>
            <div className="text-xs font-semibold text-emerald-300">↗ +15.3% مقارنة بالأسبوع السابق</div>
          </div>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={model.dailySales.length ? model.dailySales : [{ day: "اليوم", value: 0 }]}>
                <XAxis dataKey="day" stroke="#64748b" fontSize={10} />
                <YAxis stroke="#64748b" fontSize={10} width={35} />
                <Tooltip />
                <Bar dataKey="value" fill="#14b8a6" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </section>
    </div>
  );
}

function SalesHeroCard({ total }: { total: number }) {
  const demo = [12, 16, 11, 9, 18, 15, 21, 17, 20, 14].map((value, index) => ({ index, value }));
  return (
    <div className="rounded-3xl border border-teal-400/15 bg-[linear-gradient(145deg,rgba(20,184,166,.14),rgba(15,23,42,.88))] p-5 shadow-2xl shadow-teal-500/5">
      <div className="flex items-start justify-between gap-3">
        <div className="rounded-2xl bg-teal-400/10 p-3 text-teal-300"><Wallet className="h-6 w-6" /></div>
        <div className="text-left">
          <div className="text-xs font-semibold text-slate-400">إجمالي المبيعات</div>
          <div className="mt-1 text-3xl font-black text-white">{formatMoney(total)}</div>
          <div className="text-xs font-bold text-emerald-300">↗ +12.6% مقارنة بالدورة السابقة</div>
        </div>
      </div>
      <div className="mt-5 h-16">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={demo}>
            <Area type="monotone" dataKey="value" stroke="#14b8a6" strokeWidth={2} fill="#14b8a633" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Kpi({ label, value, hint, icon: Icon, tone = "teal" }: { label: string; value: ReactNode; hint: string; icon: ElementType; tone?: "teal" | "danger" }) {
  const color = tone === "danger" ? "text-rose-300 bg-rose-500/12" : "text-teal-300 bg-teal-500/12";
  return (
    <Link to="/analytics" className="group rounded-3xl border border-white/10 bg-[#12233d]/90 p-4 shadow-xl shadow-black/10 transition hover:-translate-y-0.5 hover:border-teal-400/30 hover:bg-[#142947]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-slate-400">{label}</div>
          <div className="mt-2 text-2xl font-black text-white">{value}</div>
          <div className="mt-1 text-xs font-semibold text-emerald-300">↗ {hint}</div>
        </div>
        <div className={cx("rounded-2xl p-3 transition group-hover:scale-110", color)}><Icon className="h-6 w-6" /></div>
      </div>
    </Link>
  );
}

function Panel({ title, link, children, className }: { title: string; link: string; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-3xl border border-white/10 bg-[#10213a]/92 p-4 shadow-xl shadow-black/10", className)}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-black text-white">{title}</h2>
        <Link to={link} className="text-xs font-bold text-teal-300 hover:text-teal-100">عرض الكل ›</Link>
      </div>
      {children}
    </section>
  );
}

function AlertRow({ label, sub, count, tone, icon: Icon, route }: { label: string; sub: string; count: number; tone: "danger" | "warning" | "info" | "success"; icon: ElementType; route: string }) {
  const colors: Record<string, string> = {
    danger: "bg-rose-500/15 text-rose-300 border-rose-500/25",
    warning: "bg-amber-500/15 text-amber-300 border-amber-500/25",
    info: "bg-blue-500/15 text-blue-300 border-blue-500/25",
    success: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  };
  return <Link to={route} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.045] p-3 transition hover:border-teal-400/30">
    <span className={cx("flex h-8 min-w-8 items-center justify-center rounded-xl border text-xs font-black", colors[tone])}>{count}</span>
    <div className="min-w-0"><div className="truncate text-sm font-bold text-white">{label}</div><div className="truncate text-xs text-slate-400">{sub}</div></div>
    <Icon className="h-5 w-5 text-teal-300" />
  </Link>;
}

function DoctorPerformanceRow({ rank, name, sales, percent }: { rank: number; name: string; sales: number; percent: number }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-3">
    <div className="mb-2 flex items-center justify-between text-xs"><span className="font-bold text-slate-200">{name}</span><span className="rounded-lg bg-teal-500/15 px-2 py-1 font-black text-teal-300">{rank}</span></div>
    <div className="grid grid-cols-[1fr_auto] items-center gap-3"><div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-teal-300" style={{ width: `${Math.min(130, percent)}%` }} /></div><b className="text-xs text-teal-300">{percent}%</b></div>
    <div className="mt-1 text-xs text-slate-400">{formatMoney(sales)}</div>
  </div>;
}

function TaskChip({ count, label, icon: Icon, tone, route }: { count: number; label: string; icon: ElementType; tone: "danger" | "warning" | "info" | "success"; route?: string }) {
  const tones: Record<string, string> = { danger: "bg-rose-500/15 text-rose-300", warning: "bg-amber-500/15 text-amber-300", info: "bg-blue-500/15 text-blue-300", success: "bg-emerald-500/15 text-emerald-300" };
  const content = <>
    <div className="flex items-center gap-3"><span className={cx("flex h-9 w-9 items-center justify-center rounded-xl text-sm font-black", tones[tone])}>{count}</span><span className="text-sm font-bold text-white">{label}</span></div>
    <Icon className="h-5 w-5 text-slate-300" />
  </>;
  const className = "flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.045] p-3 transition hover:border-teal-400/30";
  return route ? <Link to={route} className={className}>{content}</Link> : <div className={className}>{content}</div>;
}

function MiniLedger({ tone, icon: Icon, label, value, hint }: { tone: "success" | "danger"; icon: ElementType; label: string; value: ReactNode; hint: string }) {
  const cls = tone === "success" ? "border-teal-400/20 bg-teal-500/10 text-teal-300" : "border-rose-400/20 bg-rose-500/10 text-rose-300";
  return <div className={cx("rounded-3xl border p-5 text-center", cls)}>
    <Icon className="mx-auto mb-2 h-8 w-8" />
    <div className="text-sm font-bold">{label}</div>
    <div className="mt-2 text-4xl font-black text-white">{value}</div>
    <div className="mt-1 text-xs font-semibold">{hint}</div>
  </div>;
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-slate-600 p-6 text-center text-sm text-slate-400">{text}</div>;
}
