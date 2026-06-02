import { useEffect, useMemo, useRef, useState, type ElementType, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  Bell,
  CalendarDays,
  CheckCircle2,
  Download,
  FileText,
  Headphones,
  LineChart,
  Package,
  Phone,
  RefreshCw,
  Search,
  Settings,
  ShoppingCart,
  Stethoscope,
  Truck,
  UserRound,
  Users,
  Wallet,
} from "lucide-react";
import { formatCycleDate, getCurrentCycle, getPreviousCycle } from "@/lib/pharmacy-cycle";
import { ALL_BRANCHES, ALL_BRANCHES_LABEL, friendlySourceError, type DashboardMetricStatus } from "@/lib/dashboardSummaryService";
import {
  loadExecutiveDashboardData,
  type DashboardFunnelStep,
  type DashboardResultSlice,
  type ExecutiveDashboardData,
  type ExecutiveDashboardMode,
  type OperationalTrackingItem,
} from "@/lib/executiveDashboardDataService";
import { formatMoney, formatNumber } from "@/lib/dawaa2027";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

const cx = (...items: Array<string | false | null | undefined>) => items.filter(Boolean).join(" ");

function hasNumber(value: unknown): value is number {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function countText(value: number | null | undefined) {
  return hasNumber(value) ? formatNumber(value) : "غير متاح";
}

function moneyText(value: number | null | undefined) {
  return hasNumber(value) ? formatMoney(value) : "غير متاح";
}

function dateText(value: string | null | undefined) {
  if (!value) return "غير محدد";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleDateString("ar-EG", { day: "numeric", month: "short", year: "numeric" });
}

function timeText(value: string | null | undefined) {
  if (!value) return "لم يتم التحديث بعد";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "لم يتم التحديث بعد";
  return date.toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" });
}

function periodDays(start: string, end: string) {
  const a = new Date(`${start}T12:00:00`);
  const b = new Date(`${end}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86400000) + 1);
}

function metricValue(metric?: { value: number | null; status: DashboardMetricStatus }) {
  if (!metric) return null;
  if (metric.status === "error" || metric.status === "unavailable") return null;
  return metric.value;
}

function sumFollowupRows(data: ExecutiveDashboardData | null) {
  return (data?.customerServiceImpact || []).reduce(
    (acc, row) => ({
      assigned: acc.assigned + row.assignedCount,
      completed: acc.completed + row.completedCount,
      overdue: acc.overdue + row.overdueCount,
      noAnswer: acc.noAnswer + row.noAnswerCount,
      postponed: acc.postponed + row.postponedCount,
      needsManager: acc.needsManager + row.needsManagerCount,
      purchaseAmount: acc.purchaseAmount + row.purchaseAfterFollowupAmount,
    }),
    { assigned: 0, completed: 0, overdue: 0, noAnswer: 0, postponed: 0, needsManager: 0, purchaseAmount: 0 },
  );
}

export default function ExecutiveDashboard2027() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const currentCycle = useMemo(() => getCurrentCycle(), []);
  const [startDate, setStartDate] = useState(() => formatCycleDate(currentCycle.start));
  const [endDate, setEndDate] = useState(() => formatCycleDate(currentCycle.end));
  const [mode, setMode] = useState<ExecutiveDashboardMode>("current");
  const [branch, setBranch] = useState(ALL_BRANCHES);
  const [data, setData] = useState<ExecutiveDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError(null);
    loadExecutiveDashboardData({ startDate, endDate, branch, mode })
      .then((result) => {
        if (requestId !== requestIdRef.current) return;
        setData(result);
      })
      .catch((err) => {
        if (requestId !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : "تعذر تحميل لوحة القيادة");
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });
  }, [startDate, endDate, branch, mode]);

  const summary = data?.summary;
  const followups = useMemo(() => sumFollowupRows(data), [data]);
  const periodLabel = mode === "custom"
    ? `تحليل فترة مخصصة: ${startDate} إلى ${endDate}`
    : mode === "current"
      ? `الدورة الحالية: ${startDate} إلى ${endDate}`
      : `الدورة السابقة: ${startDate} إلى ${endDate}`;
  const isLongPeriod = periodDays(startDate, endDate) > 45;
  const salesDiff = data?.salesAccuracy.rpcNetSales !== null && data?.salesAccuracy.rpcNetSales !== undefined
    ? Math.abs(data.salesAccuracy.summaryNetSales - data.salesAccuracy.rpcNetSales)
    : 0;

  const branchOptions = useMemo(() => {
    const values = new Set<string>([ALL_BRANCHES]);
    data?.branchPerformance.forEach((row) => row.branch && values.add(row.branch));
    return [...values];
  }, [data]);

  const kpis = [
    {
      label: "صافي مبيعات الفترة",
      value: moneyText(metricValue(data?.kpis.netSales)),
      unit: "جنيه",
      icon: Wallet,
      route: `/analytics?start=${startDate}&end=${endDate}&branch=${encodeURIComponent(branch)}`,
      status: data?.kpis.netSales.status,
      source: data?.kpis.netSales.source,
      change: data?.salesAccuracy.netSalesSource === "sales_daily_summary" ? "من ملخص المبيعات" : "من RPC",
    },
    {
      label: "عدد الفواتير",
      value: countText(metricValue(data?.kpis.invoicesCount)),
      unit: "فاتورة",
      icon: FileText,
      route: `/invoices?start=${startDate}&end=${endDate}`,
      status: data?.kpis.invoicesCount.status,
      source: data?.kpis.invoicesCount.source,
      change: "ملخص الفترة",
    },
    {
      label: "متوسط قيمة الفاتورة",
      value: moneyText(metricValue(data?.kpis.avgInvoice)),
      unit: "جنيه",
      icon: ShoppingCart,
      route: `/analytics?metric=avg_invoice&start=${startDate}&end=${endDate}`,
      status: data?.kpis.avgInvoice.status,
      source: data?.kpis.avgInvoice.source,
      change: "صافي / فواتير",
    },
    {
      label: "العملاء المشترين",
      value: countText(metricValue(data?.kpis.uniqueCustomers)),
      unit: "عميل",
      icon: Users,
      route: "/customers?status=active",
      status: data?.kpis.uniqueCustomers.status,
      source: data?.kpis.uniqueCustomers.source,
      change: "عملاء لديهم شراء",
    },
    {
      label: "العملاء المهمون",
      value: countText(data?.customerAnalytics.importantNeedFollowup),
      unit: "يحتاج متابعة",
      icon: UserRound,
      route: "/customers?segment=important",
      status: data?.customerAnalytics.error ? "error" : "ready",
      source: "customer_metrics_summary",
      change: "حسب avg_monthly",
    },
    {
      label: "العملاء المتوقفون",
      value: countText(data?.customerAnalytics.stoppedCustomers),
      unit: "عميل",
      icon: AlertTriangle,
      route: "/customers?status=stopped",
      status: data?.customerAnalytics.error ? "error" : "ready",
      source: "customer_metrics_summary",
      change: "آخر شراء قديم",
    },
    {
      label: "المتابعات المكتملة",
      value: countText(followups.completed),
      unit: "متابعة",
      icon: CheckCircle2,
      route: "/customer-service?filter=done",
      status: data?.sourceHealth.followupSummaryAvailable ? "ready" : "unavailable",
      source: "followup_performance_summary",
      change: "خدمة العملاء",
    },
    {
      label: "الشراء بعد المتابعة",
      value: moneyText(followups.purchaseAmount),
      unit: "جنيه",
      icon: Headphones,
      route: "/customer-service?filter=purchase_after_followup",
      status: data?.sourceHealth.followupSummaryAvailable ? "ready" : "unavailable",
      source: "followup_performance_summary",
      change: "تأثير المتابعة",
    },
  ];

  const decisions = buildDecisionCards(data, followups);
  const handleSearch = (query: string) => {
    const value = query.trim();
    if (!value) return;
    navigate(`/customers?search=${encodeURIComponent(value)}`);
  };

  return (
    <div className="min-h-screen bg-[#F7F9FB] text-slate-900" dir="rtl">
      <TopBar
        userName={user?.name || "د. عماد"}
        periodLabel={periodLabel}
        startDate={startDate}
        endDate={endDate}
        branch={branch}
        branchOptions={branchOptions}
        lastUpdated={data?.lastUpdated}
        onStartDate={(value) => { setMode("custom"); setStartDate(value); }}
        onEndDate={(value) => { setMode("custom"); setEndDate(value); }}
        onBranch={setBranch}
        onCurrent={() => {
          const cycle = getCurrentCycle();
          setMode("current");
          setStartDate(formatCycleDate(cycle.start));
          setEndDate(formatCycleDate(cycle.end));
        }}
        onPrevious={() => {
          const cycle = getPreviousCycle();
          setMode("previous");
          setStartDate(formatCycleDate(cycle.start));
          setEndDate(formatCycleDate(cycle.end));
        }}
        onExport={() => toast.info("تصدير تقرير لوحة القيادة سيتم ربطه قريبًا")}
        onNotifications={() => navigate("/operations-center")}
        onSettings={() => navigate("/roles-permissions")}
        onSearch={handleSearch}
      />

      <main className="space-y-4 p-4">
        {loading && <LoadingStrip />}
        {error && <ErrorStrip text={friendlySourceError(error)} />}

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
          {kpis.map((kpi) => <KpiCard key={kpi.label} {...kpi} />)}
        </section>

        <section className="grid items-stretch gap-4 xl:grid-cols-[1.15fr_.85fr_1fr]">
          <ChartPanel title={isLongPeriod ? "تطور المبيعات حسب الشهر" : "تطور المبيعات حسب اليوم"} action="sales">
            <SalesTrendChart rows={data?.salesTrend || []} />
          </ChartPanel>
          <ChartPanel title="أداء الفروع" action="branches">
            <BranchChart rows={data?.branchPerformance || []} onBranch={(next) => { setBranch(next); setMode("custom"); }} />
          </ChartPanel>
          <ChartPanel title="تطور أداء الدكاترة" action="doctors">
            <DoctorRanking rows={data?.doctorPerformance || []} />
          </ChartPanel>
        </section>

        <section className="grid items-stretch gap-4 xl:grid-cols-[.9fr_.9fr_.7fr_.7fr_.7fr]">
          <Panel title="مسار متابعة العملاء">
            <FollowupFunnel rows={data?.followupFunnel || []} />
          </Panel>
          <Panel title="نتائج المتابعات">
            <FollowupDonut rows={data?.followupResults || []} />
          </Panel>
          <MetricPanel icon={Phone} title="عملاء بدون هاتف صالح" value={countText(data?.customerAnalytics.customersWithoutValidPhone)} route="/customers?phoneStatus=invalid" />
          <MetricPanel icon={UserRound} title="عملاء مهمون يحتاجون متابعة" value={countText(data?.customerAnalytics.importantNeedFollowup)} route="/customer-service?filter=important" />
          <MetricPanel icon={CheckCircle2} title="المتابعات المكتملة" value={countText(followups.completed)} route="/customer-service?filter=done" />
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <TrackingCard title="متابعة الرواكد" icon={Package} rows={data?.stagnantTracking || []} route="/stagnant-medicines" />
          <TrackingCard title="متابعة أصناف اللستة" icon={FileText} rows={data?.listItemTracking || []} route="/incentive-medicines" />
          <DeliveryCard data={data} />
          <MetricPanel icon={Users} title="متابعة العملاء" value={countText(metricValue(data?.kpis.uniqueCustomers))} progressLabel="عملاء نشطون" route="/customers" />
          <AlertsCard data={data} followups={followups} />
        </section>

        <section className="grid items-stretch gap-4 xl:grid-cols-[1.05fr_.95fr]">
          <Panel title="مركز القرار السريع / اقتراحات ذكية">
            <DecisionGrid rows={decisions} />
          </Panel>
          <Panel title="تحليل آخر 5 أيام حسب الفرع">
            <LastFiveDaysByBranch rows={data?.last5DaysByBranch || []} />
          </Panel>
        </section>

        <DataHealthDebug data={data} startDate={startDate} endDate={endDate} branch={branch} mode={mode} salesDiff={salesDiff} />
      </main>
    </div>
  );
}

function TopBar(props: {
  userName: string;
  periodLabel: string;
  startDate: string;
  endDate: string;
  branch: string;
  branchOptions: string[];
  lastUpdated?: string | null;
  onStartDate: (value: string) => void;
  onEndDate: (value: string) => void;
  onBranch: (value: string) => void;
  onCurrent: () => void;
  onPrevious: () => void;
  onExport: () => void;
  onNotifications: () => void;
  onSettings: () => void;
  onSearch: (query: string) => void;
}) {
  const [query, setQuery] = useState("");
  return (
    <header className="sticky top-0 z-20 border-b border-[#E5EAF0] bg-white/95 px-4 py-3 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-teal-50 text-teal-700">
            <UserRound size={22} />
          </div>
          <div>
            <div className="text-sm font-black text-slate-950">{props.userName}</div>
            <div className="text-xs font-bold text-slate-500">مدير عام</div>
          </div>
          <button type="button" onClick={props.onNotifications} className="top-icon"><Bell size={18} /><span className="notify-dot">3</span></button>
          <button type="button" onClick={props.onSettings} className="top-icon"><Settings size={18} /></button>
          <button type="button" onClick={props.onExport} className="top-action"><Download size={16} /> تصدير</button>
        </div>

        <div className="flex min-w-[260px] flex-1 justify-center">
          <label className="relative w-full max-w-md">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="h-10 w-full rounded-xl border border-[#E5EAF0] bg-[#F7F9FB] px-10 text-sm font-semibold outline-none transition focus:border-teal-300 focus:bg-white"
              placeholder="ابحث عن عميل، دكتور، صنف..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") props.onSearch(query);
              }}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select className="dash-input" value={props.branch} onChange={(event) => props.onBranch(event.target.value)}>
            {props.branchOptions.map((item) => <option key={item} value={item}>{item === ALL_BRANCHES ? ALL_BRANCHES_LABEL : item}</option>)}
          </select>
          <input className="dash-input" type="date" value={props.startDate} onChange={(event) => props.onStartDate(event.target.value)} />
          <input className="dash-input" type="date" value={props.endDate} onChange={(event) => props.onEndDate(event.target.value)} />
          <button className="subtle-button" type="button" onClick={props.onCurrent}>الدورة الحالية</button>
          <button className="subtle-button" type="button" onClick={props.onPrevious}>السابقة</button>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-slate-500">
        <span className="inline-flex items-center gap-1"><CalendarDays size={14} className="text-teal-600" />{props.periodLabel}</span>
        <span className="inline-flex items-center gap-1"><RefreshCw size={13} /> آخر تحديث: {timeText(props.lastUpdated)}</span>
      </div>
    </header>
  );
}

function KpiCard(props: {
  label: string;
  value: string;
  unit: string;
  icon: ElementType;
  route: string;
  status?: DashboardMetricStatus | "ready";
  source?: string;
  change: string;
}) {
  const Icon = props.icon;
  const unavailable = props.status === "error" || props.status === "unavailable";
  return (
    <Link to={props.route} className="card group min-h-[126px]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-black text-slate-600">{props.label}</div>
          <div className="mt-3 text-2xl font-black tracking-normal text-slate-950">{unavailable ? "غير متاح" : props.value}</div>
          <div className="mt-1 text-xs font-bold text-slate-500">{unavailable ? "راجع فحص المصادر" : props.unit}</div>
        </div>
        <div className="rounded-2xl bg-teal-50 p-2.5 text-teal-700 transition group-hover:bg-teal-100"><Icon size={19} /></div>
      </div>
      <div className={cx("mt-4 text-xs font-black", unavailable ? "text-amber-600" : "text-teal-700")}>
        {unavailable ? "غير مستقر" : props.change}
      </div>
    </Link>
  );
}

function ChartPanel({ title, children }: { title: string; action?: string; children: ReactNode }) {
  return (
    <Panel title={title}>
      <div className="h-[270px]">{children}</div>
    </Panel>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-black text-slate-950">{title}</h2>
        <span className="rounded-full bg-[#E6F7F6] px-3 py-1 text-[11px] font-black text-teal-700">بيانات فعلية</span>
      </div>
      {children}
    </section>
  );
}

function SalesTrendChart({ rows }: { rows: ExecutiveDashboardData["salesTrend"] }) {
  if (!rows.length) return <EmptyState text="لا توجد بيانات مبيعات للفترة المحددة" />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={rows}>
        <defs>
          <linearGradient id="salesDashArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#00AFA5" stopOpacity={0.32} />
            <stop offset="95%" stopColor="#00AFA5" stopOpacity={0.04} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#E5EAF0" strokeDasharray="3 3" />
        <XAxis dataKey="label" stroke="#64748B" fontSize={11} />
        <YAxis stroke="#64748B" fontSize={11} width={64} />
        <Tooltip formatter={(value) => formatMoney(Number(value || 0))} contentStyle={{ borderRadius: 14, borderColor: "#E5EAF0" }} />
        <Area dataKey="netTotal" name="صافي المبيعات" stroke="#00AFA5" strokeWidth={3} fill="url(#salesDashArea)" type="monotone" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function BranchChart({ rows, onBranch }: { rows: ExecutiveDashboardData["branchPerformance"]; onBranch: (branch: string) => void }) {
  const top = rows.slice(0, 6);
  if (!top.length) return <EmptyState text="لا توجد بيانات فروع للفترة المحددة" />;
  return (
    <div className="space-y-3">
      <div className="h-[205px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={top}>
            <CartesianGrid stroke="#E5EAF0" strokeDasharray="3 3" />
            <XAxis dataKey="branch" stroke="#64748B" fontSize={11} />
            <YAxis stroke="#64748B" fontSize={11} width={58} />
            <Tooltip formatter={(value) => formatMoney(Number(value || 0))} />
            <Bar dataKey="netTotal" name="صافي المبيعات" radius={[8, 8, 0, 0]} fill="#00AFA5" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {top.slice(0, 4).map((row) => (
          <button key={row.branch} type="button" onClick={() => onBranch(row.branch)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-right text-xs font-bold hover:border-teal-200">
            <span className="block text-slate-950">{row.branch}</span>
            <span className="text-teal-700">{row.share.toFixed(1)}%</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function DoctorRanking({ rows }: { rows: ExecutiveDashboardData["doctorPerformance"] }) {
  const top = rows.filter((row) => row.displayName).slice(0, 8);
  if (!top.length) return <EmptyState text="لا توجد بيانات دكاترة للفترة المحددة" />;
  return (
    <div className="max-h-[252px] space-y-3 overflow-y-auto pr-1">
      {top.map((row, index) => {
        const max = top[0]?.netTotal || 1;
        const route = row.staffId ? `/staff/${row.staffId}` : `/team?search=${encodeURIComponent(row.displayName || row.sellerName || "")}`;
        return (
          <Link key={`${row.staffId || row.normalizedName}-${row.branch}-${index}`} to={route} className="block rounded-xl p-1 transition hover:bg-slate-50">
            <div className="mb-1 flex items-center justify-between text-xs font-black text-slate-700">
              <span>{index + 1}. {row.displayName}</span>
              <span>{formatMoney(row.netTotal)}</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-teal-500" style={{ width: `${Math.max(8, (row.netTotal / max) * 100)}%` }} />
            </div>
            <div className="mt-1 text-[11px] font-bold text-slate-500">{row.branch || "غير محدد"} · {formatNumber(row.invoicesCount)} فاتورة · {formatMoney(row.avgInvoice)} متوسط</div>
            {row.duplicateWarning && <div className="mt-1 text-[10px] font-bold text-amber-600">{row.duplicateWarning}</div>}
          </Link>
        );
      })}
    </div>
  );
}

function LastFiveDaysByBranch({ rows }: { rows: ExecutiveDashboardData["last5DaysByBranch"] }) {
  if (!rows.length) return <EmptyState text="لا توجد بيانات آخر 5 أيام للفترة المحددة" />;
  const dates = [...new Set(rows.map((row) => row.date))].sort();
  const branches = [...new Set(rows.map((row) => row.branch))].slice(0, 6);
  const chartRows = dates.map((date) => {
    const point: Record<string, string | number> = { date };
    for (const branchName of branches) {
      point[branchName] = rows.find((row) => row.date === date && row.branch === branchName)?.netTotal || 0;
    }
    return point;
  });
  const best = [...rows].sort((a, b) => (b.changePercent ?? -999) - (a.changePercent ?? -999))[0];
  const weak = [...rows].filter((row) => row.changePercent !== null).sort((a, b) => (a.changePercent ?? 999) - (b.changePercent ?? 999))[0];
  return (
    <div className="space-y-3">
      <div className="h-[230px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartRows}>
            <CartesianGrid stroke="#E5EAF0" vertical={false} />
            <XAxis dataKey="date" stroke="#64748B" fontSize={10} />
            <YAxis stroke="#64748B" fontSize={10} width={58} />
            <Tooltip formatter={(value, name) => [formatMoney(Number(value || 0)), String(name)]} />
            {branches.map((branch, index) => (
              <Bar
                key={branch}
                dataKey={branch}
                name={branch}
                stackId="branch"
                fill={["#00AFA5", "#1E88E5", "#43B581", "#F59E0B", "#8B5CF6", "#EF4444"][index % 6]}
                radius={[6, 6, 0, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <MiniLine label="أفضل تحسن" value={best ? `${best.branch} ${best.changePercent !== null ? best.changePercent.toFixed(1) : 0}%` : "غير متاح"} />
        <MiniLine label="يحتاج متابعة" value={weak ? `${weak.branch} ${weak.changePercent !== null ? weak.changePercent.toFixed(1) : 0}%` : "غير متاح"} />
        <MiniLine label="الأيام" value={dates.length} />
        <MiniLine label="الفروع" value={branches.length} />
      </div>
    </div>
  );
}

function FollowupFunnel({ rows }: { rows: DashboardFunnelStep[] }) {
  if (!rows.length) return <EmptyState text="لا توجد بيانات متابعة" />;
  const max = Math.max(...rows.map((row) => row.value || 0), 1);
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.key}>
          <div className="mb-1 flex justify-between text-xs font-black text-slate-700">
            <span>{row.label}</span>
            <span>{countText(row.value)} {row.rate !== null ? `· ${row.rate.toFixed(1)}%` : ""}</span>
          </div>
          <div className="h-8 overflow-hidden rounded-xl bg-[#E6F7F6]">
            <div className="h-full rounded-xl bg-gradient-to-l from-teal-500 to-teal-300" style={{ width: `${Math.max(5, ((row.value || 0) / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function FollowupDonut({ rows }: { rows: DashboardResultSlice[] }) {
  const clean = rows.filter((row) => (row.value || 0) > 0);
  if (!clean.length) return <EmptyState text="لا توجد نتائج متابعة مسجلة" />;
  return (
    <div className="grid grid-cols-[150px_1fr] items-center gap-3">
      <div className="h-[160px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={clean} dataKey="value" nameKey="label" innerRadius={42} outerRadius={68} paddingAngle={2}>
              {clean.map((row) => <Cell key={row.key} fill={row.color} />)}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="space-y-2">
        {clean.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-2 text-xs font-bold">
            <span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: row.color }} />{row.label}</span>
            <span>{formatNumber(row.value || 0)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricPanel({ icon: Icon, title, value, route, progressLabel }: { icon: ElementType; title: string; value: string; route: string; progressLabel?: string }) {
  return (
    <Link to={route} className="card flex min-h-[170px] flex-col justify-between">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-black text-slate-600">{title}</div>
          <div className="mt-3 text-2xl font-black text-slate-950">{value}</div>
          <div className="mt-1 text-xs font-bold text-slate-500">{progressLabel || "عرض التفاصيل"}</div>
        </div>
        <span className="rounded-2xl bg-teal-50 p-3 text-teal-700"><Icon size={20} /></span>
      </div>
      <span className="text-xs font-black text-blue-600">عرض التفاصيل</span>
    </Link>
  );
}

function TrackingCard({ title, icon: Icon, rows, route }: { title: string; icon: ElementType; rows: OperationalTrackingItem[]; route: string }) {
  const first = rows[0];
  const progress = first?.progress ?? null;
  return (
    <Link to={route} className="card min-h-[150px]">
      <div className="flex justify-between gap-3">
        <div>
          <div className="text-sm font-black text-slate-950">{title}</div>
          <div className="mt-2 text-2xl font-black text-slate-950">{rows.length ? formatNumber(rows.length) : "غير متاح"}</div>
          <div className="text-xs font-bold text-slate-500">{first?.responsible || "مسؤول غير محدد"}</div>
        </div>
        <span className="rounded-2xl bg-teal-50 p-3 text-teal-700"><Icon size={20} /></span>
      </div>
      <div className="mt-4 h-2 rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-teal-500" style={{ width: `${progress ?? 0}%` }} />
      </div>
      <div className="mt-2 text-xs font-black text-blue-600">فتح التفاصيل</div>
    </Link>
  );
}

function DeliveryCard({ data }: { data: ExecutiveDashboardData | null }) {
  return (
    <Link to="/delivery" className="card min-h-[150px]">
      <div className="flex justify-between gap-3">
        <div>
          <div className="text-sm font-black text-slate-950">متابعة الدليفري</div>
          <div className="mt-2 text-2xl font-black text-slate-950">{countText(data?.deliveryTracking.totalOrders)}</div>
          <div className="text-xs font-bold text-slate-500">{data?.deliveryTracking.topStaff || "أفضل دليفري غير محدد"}</div>
        </div>
        <span className="rounded-2xl bg-blue-50 p-3 text-blue-600"><Truck size={20} /></span>
      </div>
      <div className="mt-4 text-xs font-bold text-slate-500">مبيعات التوصيل: {moneyText(data?.deliveryTracking.deliverySales)}</div>
      <div className="mt-2 text-xs font-black text-blue-600">عرض التفاصيل</div>
    </Link>
  );
}

function AlertsCard({ data, followups }: { data: ExecutiveDashboardData | null; followups: ReturnType<typeof sumFollowupRows> }) {
  const urgent = data?.summary.notifications.filter((row) => /urgent|high|عاجل|مرتفع/i.test(String(row.priority || ""))).length ?? null;
  return (
    <Link to="/operations-center" className="card min-h-[150px]">
      <div className="flex justify-between gap-3">
        <div>
          <div className="text-sm font-black text-slate-950">الشكاوى والتنبيهات</div>
          <div className="mt-2 text-2xl font-black text-slate-950">{countText(urgent)}</div>
          <div className="text-xs font-bold text-slate-500">يحتاج مدير: {formatNumber(followups.needsManager)}</div>
        </div>
        <span className="rounded-2xl bg-red-50 p-3 text-red-600"><Bell size={20} /></span>
      </div>
      <div className="mt-4 h-2 rounded-full bg-slate-100"><div className="h-full rounded-full bg-red-400" style={{ width: `${urgent ? 60 : 8}%` }} /></div>
      <div className="mt-2 text-xs font-black text-blue-600">عرض التفاصيل</div>
    </Link>
  );
}

function buildDecisionCards(data: ExecutiveDashboardData | null, followups: ReturnType<typeof sumFollowupRows>) {
  const intel = data?.customerAnalytics;
  return [
    { title: "عملاء قلّ الشراء لديهم هذا الشهر", text: "راجع العملاء المهمين قبل نهاية الوردية", value: countText(intel?.importantNeedFollowup), route: "/customer-service?filter=important", severity: "warning" },
    { title: "أصناف راكدة تحتاج خطة بيع", text: "ابدأ بالأصناف الأقرب للانتهاء أو الأعلى كمية", value: data?.stagnantTracking.length ? formatNumber(data.stagnantTracking.length) : "غير متاح", route: "/stagnant-medicines", severity: "success" },
    { title: "دكتور يحتاج متابعة أداء", text: data?.doctorPerformance.at(-1)?.sellerName || "لا يوجد مصدر كاف", value: data?.doctorPerformance.length ? "متاح" : "غير متاح", route: "/analytics", severity: "info" },
    { title: "فرع أقل من المستهدف", text: data?.branchPerformance.at(-1)?.branch || "لم يتم ضبط هدف الفرع", value: data?.branchPerformance.length ? moneyText(data.branchPerformance.at(-1)?.netTotal) : "غير متاح", route: "/analytics", severity: "info" },
    { title: "فواتير تحتاج ربط عميل", text: "اربط الفواتير قبل تحليل العملاء", value: countText(data?.dataHealth.invoicesWithoutCustomerCode), route: "/invoices", severity: "warning" },
    { title: "عملاء بدون رقم صحيح", text: "ابدأ باستكمال بيانات التواصل", value: countText(intel?.customersWithoutValidPhone), route: "/customers?phoneStatus=invalid", severity: "danger" },
    { title: "متابعات متأخرة لعملاء مهمين", text: "راجع الحالات المتأخرة فورًا", value: countText(followups.overdue), route: "/customer-service?filter=overdue", severity: "danger" },
    { title: "شكاوى تحتاج مدير", text: "تصعيد ومتابعة مدير مطلوبة", value: countText(followups.needsManager), route: "/customer-service?filter=needs_manager", severity: "danger" },
  ];
}

function DecisionGrid({ rows }: { rows: ReturnType<typeof buildDecisionCards> }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {rows.map((row) => (
        <Link key={row.title} to={row.route} className={cx("rounded-2xl border p-3 transition hover:-translate-y-0.5", decisionTone(row.severity))}>
          <div className="text-sm font-black">{row.title}</div>
          <div className="mt-2 text-lg font-black">{row.value}</div>
          <div className="mt-1 min-h-[34px] text-xs font-bold opacity-80">{row.text}</div>
          <div className="mt-3 rounded-xl bg-white/70 px-3 py-2 text-center text-xs font-black">فتح الإجراء</div>
        </Link>
      ))}
    </div>
  );
}

function decisionTone(severity: string) {
  if (severity === "danger") return "border-red-200 bg-red-50 text-red-800";
  if (severity === "warning") return "border-amber-200 bg-amber-50 text-amber-800";
  if (severity === "success") return "border-teal-200 bg-teal-50 text-teal-800";
  return "border-blue-200 bg-blue-50 text-blue-800";
}

function CustomerPreview({ preview }: { preview: ExecutiveDashboardData["customerPreview"] }) {
  if (!preview || preview.error) return <EmptyState text="لا توجد معاينة عميل متاحة" />;
  return (
    <div className="space-y-3 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-teal-50 text-teal-700"><UserRound size={28} /></div>
      <div>
        <div className="text-lg font-black text-slate-950">{preview.name || "عميل غير محدد"}</div>
        <div className="text-xs font-bold text-slate-500">كود {preview.code || "غير محدد"} · {preview.branch || "غير محدد"}</div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <MiniLine label="الهاتف" value={preview.phone || "بدون رقم"} />
        <MiniLine label="التصنيف" value={preview.segment || "غير محدد"} />
        <MiniLine label="الحالة" value={preview.status || "غير محدد"} />
        <MiniLine label="آخر شراء" value={dateText(preview.lastPurchase)} />
      </div>
      <div className="rounded-2xl bg-teal-50 p-3 text-sm font-black text-teal-800">{moneyText(preview.totalSpent)}</div>
    </div>
  );
}

function InvoicePreview({ rows }: { rows: ExecutiveDashboardData["latestInvoicesPreview"] }) {
  if (!rows.length) return <EmptyState text="لا توجد فواتير حديثة" />;
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.id} className="grid grid-cols-[1fr_auto] gap-2 rounded-xl bg-slate-50 p-2 text-xs">
          <div>
            <div className="font-black text-slate-950">{row.invoiceNumber || "فاتورة"}</div>
            <div className="font-bold text-slate-500">{dateText(row.invoiceDate)} · {row.branch || "غير محدد"}</div>
          </div>
          <div className="font-black text-teal-700">{formatMoney(row.amount)}</div>
        </div>
      ))}
      <Link to="/invoices" className="block pt-1 text-xs font-black text-blue-600">عرض جميع الفواتير</Link>
    </div>
  );
}

function DataHealthDebug({ data, startDate, endDate, branch, mode, salesDiff }: { data: ExecutiveDashboardData | null; startDate: string; endDate: string; branch: string; mode: ExecutiveDashboardMode; salesDiff: number }) {
  return (
    <details className="card">
      <summary className="cursor-pointer text-sm font-black text-slate-900">فحص مصادر البيانات وصحة الأرقام</summary>
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <DebugBox title="الفترة">
          <MiniLine label="البداية" value={startDate} />
          <MiniLine label="النهاية" value={endDate} />
          <MiniLine label="الفرع" value={branch === ALL_BRANCHES ? ALL_BRANCHES_LABEL : branch} />
          <MiniLine label="الوضع" value={mode === "custom" ? "تحليل فترة مخصصة" : mode === "current" ? "الدورة الحالية" : "الدورة السابقة"} />
        </DebugBox>
        <DebugBox title="المبيعات">
          <MiniLine label="المصدر المعروض" value={data?.salesAccuracy.netSalesSource || "غير متاح"} />
          <MiniLine label="RPC net" value={moneyText(data?.salesAccuracy.rpcNetSales)} />
          <MiniLine label="Summary net" value={moneyText(data?.salesAccuracy.summaryNetSales)} />
          <MiniLine label="الفرق" value={moneyText(salesDiff)} />
        </DebugBox>
        <DebugBox title="صحة البيانات">
          <MiniLine label="فواتير بدون عميل" value={countText(data?.dataHealth.invoicesWithoutCustomerCode)} />
          <MiniLine label="فواتير بدون دكتور" value={countText(data?.dataHealth.invoicesWithoutSellerName)} />
          <MiniLine label="فواتير بدون فرع" value={countText(data?.dataHealth.invoicesWithoutBranch)} />
          <MiniLine label="عملاء رقم غير صالح" value={countText(data?.customerAnalytics.customersWithoutValidPhone)} />
        </DebugBox>
      </div>
      {(data?.salesAccuracy.mismatchPercent ?? 0) > 1 && (
        <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">
          يوجد فرق أكبر من 1% بين RPC و sales_daily_summary. الرقم المعروض يستخدم المصدر المحدد في بطاقة المبيعات، ويجب إصلاح SQL إذا كان RPC يتأخر أو يختلف.
        </div>
      )}
    </details>
  );
}

function DebugBox({ title, children }: { title: string; children: ReactNode }) {
  return <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3"><div className="mb-2 font-black">{title}</div>{children}</div>;
}

function MiniLine({ label, value }: { label: string; value: ReactNode }) {
  return <div className="flex justify-between gap-3 rounded-xl bg-white px-3 py-2 text-xs font-bold text-slate-600"><span>{label}</span><b className="text-slate-950">{value}</b></div>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="flex h-full min-h-[120px] items-center justify-center rounded-2xl bg-slate-50 p-4 text-center text-sm font-bold text-slate-500">{text}</div>;
}

function LoadingStrip() {
  return <div className="rounded-2xl border border-teal-200 bg-teal-50 p-3 text-sm font-black text-teal-800">جاري تحميل لوحة القيادة من مصادر الملخصات...</div>;
}

function ErrorStrip({ text }: { text: string }) {
  return <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-black text-red-700">{text}</div>;
}
