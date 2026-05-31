import { useEffect, useMemo, useState, type ElementType, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  BellRing,
  CalendarDays,
  ClipboardList,
  HeadphonesIcon,
  Loader2,
  RefreshCw,
  ShoppingCart,
  Stethoscope,
  TrendingUp,
  Truck,
  Users,
  Wallet,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "@/lib/supabase";
import { formatCycleDate, getCurrentCycle } from "@/lib/pharmacy-cycle";
import {
  ALL_BRANCHES,
  fetchExecutiveDashboardSummary,
  type DashboardActivity,
  type DashboardNotification,
  type DashboardSummary,
  type DeliveryPerformanceSummary,
  type FollowupPerformanceSummary,
  type SalesDailySummary,
  type StaffSalesSummary,
} from "@/lib/dashboardSummaryService";
import { formatMoney, formatNumber } from "@/lib/dawaa2027";

const cx = (...items: Array<string | false | null | undefined>) => items.filter(Boolean).join(" ");

function isAvailable(value: number | null | undefined) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function valueNumber(value: number | null | undefined) {
  return isAvailable(value) ? Number(value) : null;
}

function displayCount(value: number | null | undefined) {
  const numeric = valueNumber(value);
  return numeric === null ? "غير متاح" : formatNumber(numeric);
}

function displayMoney(value: number | null | undefined) {
  const numeric = valueNumber(value);
  return numeric === null ? "غير متاح" : formatMoney(numeric);
}

function displayDate(value: string | null | undefined) {
  if (!value) return "غير محدد";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" });
}

function dayLabel(value: string) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value || "غير محدد";
  return date.toLocaleDateString("ar-EG", { day: "numeric", month: "short" });
}

function priorityClass(priority?: string | null) {
  const value = String(priority || "").toLowerCase();
  if (value.includes("urgent") || value.includes("عاجل")) return "border-rose-500/30 bg-rose-500/10 text-rose-200";
  if (value.includes("high") || value.includes("مرتفع")) return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  return "border-teal-500/25 bg-teal-500/10 text-teal-200";
}

function sumFollowups(rows: FollowupPerformanceSummary[]) {
  return rows.reduce(
    (acc, row) => ({
      assignedCount: acc.assignedCount + row.assignedCount,
      completedCount: acc.completedCount + row.completedCount,
      overdueCount: acc.overdueCount + row.overdueCount,
      noAnswerCount: acc.noAnswerCount + row.noAnswerCount,
      postponedCount: acc.postponedCount + row.postponedCount,
      needsManagerCount: acc.needsManagerCount + row.needsManagerCount,
      purchaseAfterFollowupAmount: acc.purchaseAfterFollowupAmount + row.purchaseAfterFollowupAmount,
    }),
    {
      assignedCount: 0,
      completedCount: 0,
      overdueCount: 0,
      noAnswerCount: 0,
      postponedCount: 0,
      needsManagerCount: 0,
      purchaseAfterFollowupAmount: 0,
    },
  );
}

function aggregateBranches(rows: SalesDailySummary[]) {
  const byBranch = new Map<string, { branch: string; netTotal: number; invoicesCount: number; uniqueCustomers: number }>();
  for (const row of rows) {
    const branch = row.branch || "غير محدد";
    const current = byBranch.get(branch) || { branch, netTotal: 0, invoicesCount: 0, uniqueCustomers: 0 };
    current.netTotal += row.netTotal;
    current.invoicesCount += row.invoicesCount;
    current.uniqueCustomers += row.uniqueCustomers;
    byBranch.set(branch, current);
  }
  const total = [...byBranch.values()].reduce((sum, row) => sum + row.netTotal, 0);
  return [...byBranch.values()]
    .map((row) => ({
      ...row,
      avgInvoice: row.invoicesCount ? row.netTotal / row.invoicesCount : 0,
      percent: total ? (row.netTotal / total) * 100 : 0,
    }))
    .sort((a, b) => b.netTotal - a.netTotal);
}

function aggregateShifts(rows: SalesDailySummary[]) {
  const byShift = new Map<string, { shift: string; netTotal: number; invoicesCount: number }>();
  for (const row of rows) {
    if (!row.shift) continue;
    const current = byShift.get(row.shift) || { shift: row.shift, netTotal: 0, invoicesCount: 0 };
    current.netTotal += row.netTotal;
    current.invoicesCount += row.invoicesCount;
    byShift.set(row.shift, current);
  }
  return [...byShift.values()]
    .map((row) => ({ ...row, avgInvoice: row.invoicesCount ? row.netTotal / row.invoicesCount : 0 }))
    .sort((a, b) => b.netTotal - a.netTotal);
}

export default function ExecutiveDashboard2027() {
  const currentCycle = useMemo(() => getCurrentCycle(), []);
  const [periodStart, setPeriodStart] = useState(() => formatCycleDate(currentCycle.start));
  const [periodEnd, setPeriodEnd] = useState(() => formatCycleDate(currentCycle.end));
  const [branch, setBranch] = useState(ALL_BRANCHES);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshingSummaries, setRefreshingSummaries] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSummary = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchExecutiveDashboardSummary({ startDate: periodStart, endDate: periodEnd, branch });
      setSummary(result);
      setError(result.errors.length ? result.errors.join(" | ") : null);
    } catch (err) {
      setSummary(null);
      setError(err instanceof Error ? err.message : "تعذر تحميل بيانات لوحة القيادة.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodStart, periodEnd, branch]);

  const branchOptions = useMemo(() => {
    const values = new Set<string>([ALL_BRANCHES]);
    summary?.dailySales.forEach((row) => row.branch && values.add(row.branch));
    summary?.staffSales.forEach((row) => row.branch && values.add(row.branch));
    summary?.deliveryPerformance.forEach((row) => row.branch && values.add(row.branch));
    return [...values];
  }, [summary]);

  const dailyTrend = useMemo(() => {
    const byDay = new Map<string, { day: string; netTotal: number; invoicesCount: number }>();
    for (const row of summary?.dailySales || []) {
      const current = byDay.get(row.day) || { day: row.day, netTotal: 0, invoicesCount: 0 };
      current.netTotal += row.netTotal;
      current.invoicesCount += row.invoicesCount;
      byDay.set(row.day, current);
    }
    return [...byDay.values()]
      .sort((a, b) => a.day.localeCompare(b.day))
      .map((row) => ({ ...row, label: dayLabel(row.day) }));
  }, [summary]);

  const branchRows = useMemo(() => aggregateBranches(summary?.dailySales || []), [summary]);
  const shiftRows = useMemo(() => aggregateShifts(summary?.dailySales || []), [summary]);
  const followupTotals = useMemo(() => sumFollowups(summary?.followupPerformance || []), [summary]);
  const urgentNotifications = useMemo(
    () => (summary?.notifications || []).filter((item) => /urgent|high|عاجل|مرتفع/i.test(String(item.priority || ""))).length,
    [summary],
  );
  const hasNoInvoices = summary?.kpis && valueNumber(summary.kpis.invoicesCount) === 0;

  const refreshDashboardSummaries = async () => {
    setRefreshingSummaries(true);
    try {
      const { error: refreshError } = await supabase.rpc("refresh_dashboard_summaries");
      if (refreshError) setError(`refresh_dashboard_summaries: ${refreshError.message}`);
      await loadSummary();
    } finally {
      setRefreshingSummaries(false);
    }
  };

  return (
    <div className="space-y-5" dir="rtl">
      <section className="rounded-3xl border border-teal-400/15 bg-[#0f2038] p-5 shadow-2xl shadow-black/10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-bold text-teal-200">DAWAA PHARMACY 2027</div>
            <h1 className="mt-1 text-3xl font-black text-white">لوحة القيادة 2027</h1>
            <p className="mt-2 text-sm text-slate-300">
              الدورة الحالية: {periodStart} إلى {periodEnd} · المصدر الرئيسي: get_dashboard_kpis وملخصات Supabase
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-[150px_150px_170px_auto]">
            <input className="input-dark" type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} />
            <input className="input-dark" type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} />
            <select className="input-dark" value={branch} onChange={(event) => setBranch(event.target.value)}>
              {branchOptions.map((item) => <option key={item}>{item}</option>)}
            </select>
            <button
              type="button"
              className="btn-secondary inline-flex items-center justify-center gap-2"
              onClick={refreshDashboardSummaries}
              disabled={loading || refreshingSummaries}
            >
              <RefreshCw className={cx("h-4 w-4", refreshingSummaries && "animate-spin")} />
              تحديث الملخصات
            </button>
          </div>
        </div>
        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-xs text-slate-300">
          ملاحظة المصدر: لا يتم تحميل جدول sales_invoices بالكامل في هذه اللوحة. كل أرقام المبيعات تأتي من RPC أو summary views.
        </div>
      </section>

      {loading && (
        <div className="rounded-3xl border border-white/10 bg-[#10213a]/90 p-6 text-center text-slate-200">
          <Loader2 className="mx-auto mb-3 h-7 w-7 animate-spin text-teal-300" />
          جاري تحميل ملخصات لوحة القيادة...
        </div>
      )}

      {!loading && error && (
        <div className="rounded-3xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-100">
          {error}
        </div>
      )}

      {!loading && hasNoInvoices && (
        <div className="rounded-3xl border border-slate-500/25 bg-slate-500/10 p-4 text-sm text-slate-200">
          لا توجد فواتير في الفترة المحددة حسب get_dashboard_kpis.
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="صافي مبيعات الفترة" value={displayMoney(summary?.kpis?.netSales)} source="get_dashboard_kpis" icon={Wallet} loading={loading} />
        <Kpi label="عدد الفواتير" value={displayCount(summary?.kpis?.invoicesCount)} source="get_dashboard_kpis" icon={ShoppingCart} loading={loading} />
        <Kpi label="متوسط الفاتورة" value={displayMoney(summary?.kpis?.avgInvoice)} source="get_dashboard_kpis" icon={TrendingUp} loading={loading} />
        <Kpi label="عدد العملاء المشترين" value={displayCount(summary?.kpis?.uniqueCustomers)} source="get_dashboard_kpis" icon={Users} loading={loading} />
        <Kpi label="عدد الدكاترة النشطين" value={displayCount(summary?.kpis?.activeDoctors)} source="get_dashboard_kpis" icon={Stethoscope} loading={loading} />
        <Kpi label="عدد الدليفري النشطين" value={displayCount(summary?.kpis?.activeDelivery)} source="get_dashboard_kpis" icon={Truck} loading={loading} />
        <Kpi label="المتابعات المستحقة" value={displayCount(summary?.kpis?.dueFollowups)} source="get_dashboard_kpis" icon={CalendarDays} loading={loading} />
        <Kpi label="المتابعات المتأخرة" value={displayCount(summary?.kpis?.overdueFollowups)} source="get_dashboard_kpis" icon={AlertTriangle} loading={loading} tone="danger" />
        <Kpi label="التنبيهات العاجلة" value={displayCount(urgentNotifications)} source="notifications" icon={BellRing} loading={loading} tone={urgentNotifications ? "danger" : "teal"} />
        <Kpi label="سجل أنشطة اليوم" value={displayCount(summary?.activity.length ?? null)} source="activity_log" icon={Activity} loading={loading} />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="نسبة تحقيق الهدف" value="غير محدد" source="لم يتم ربط التارجت في ملخصات هذه المرحلة" icon={ClipboardList} loading={loading} />
        <Kpi label="الربح الإجمالي" value="غير متاح" source="لا يوجد هامش ربح فعلي" icon={Wallet} loading={loading} />
        <Kpi label="المتابعات المكتملة" value={displayCount(followupTotals.completedCount)} source="followup_performance_summary" icon={HeadphonesIcon} loading={loading} />
        <Kpi label="شراء بعد المتابعة" value={displayMoney(followupTotals.purchaseAfterFollowupAmount)} source="followup_performance_summary" icon={ShoppingCart} loading={loading} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.3fr_.9fr]">
        <Panel title="اتجاه المبيعات اليومي" source="sales_daily_summary">
          {dailyTrend.length ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailyTrend}>
                  <defs>
                    <linearGradient id="salesNetArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2dd4bf" stopOpacity={0.45} />
                      <stop offset="95%" stopColor="#2dd4bf" stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,.14)" />
                  <XAxis dataKey="label" stroke="#94a3b8" fontSize={11} />
                  <YAxis stroke="#94a3b8" fontSize={11} width={70} />
                  <Tooltip formatter={(value) => formatMoney(Number(value || 0))} labelStyle={{ color: "#0f172a" }} />
                  <Area type="monotone" dataKey="netTotal" stroke="#5eead4" strokeWidth={3} fill="url(#salesNetArea)" name="صافي المبيعات" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : <Empty text="لا توجد بيانات مبيعات يومية للفترة المحددة." />}
        </Panel>

        <Panel title="أداء الفروع" source="sales_daily_summary">
          <div className="space-y-2">
            {branchRows.length ? branchRows.map((row) => (
              <div key={row.branch} className="rounded-2xl border border-white/10 bg-white/[0.045] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-bold text-white">{row.branch}</div>
                  <div className="text-sm font-black text-teal-300">{formatMoney(row.netTotal)}</div>
                </div>
                <div className="mt-2 grid grid-cols-4 gap-2 text-xs text-slate-300">
                  <span>{formatNumber(row.invoicesCount)} فاتورة</span>
                  <span>{formatMoney(row.avgInvoice)} متوسط</span>
                  <span>{formatNumber(row.uniqueCustomers)} عميل</span>
                  <span>{row.percent.toFixed(1)}%</span>
                </div>
              </div>
            )) : <Empty text="لا توجد بيانات فروع في sales_daily_summary." />}
          </div>
        </Panel>
      </section>

      {!!shiftRows.length && (
        <Panel title="أداء الشيفتات" source="sales_daily_summary">
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={shiftRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,.14)" />
                <XAxis dataKey="shift" stroke="#94a3b8" fontSize={11} />
                <YAxis stroke="#94a3b8" fontSize={11} width={70} />
                <Tooltip formatter={(value) => formatMoney(Number(value || 0))} labelStyle={{ color: "#0f172a" }} />
                <Bar dataKey="netTotal" name="صافي المبيعات" fill="#14b8a6" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      )}

      <section className="grid gap-4 xl:grid-cols-2">
        <Panel title="ترتيب الدكاترة" source="staff_sales_summary">
          <DoctorsTable rows={summary?.staffSales || []} />
        </Panel>
        <Panel title="ترتيب الدليفري" source="delivery_performance_summary">
          <DeliveryTable rows={summary?.deliveryPerformance || []} />
        </Panel>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <Panel title="متابعة العملاء" source="followup_performance_summary">
          <div className="grid grid-cols-2 gap-2">
            <MiniStat label="المسندة" value={formatNumber(followupTotals.assignedCount)} />
            <MiniStat label="المكتملة" value={formatNumber(followupTotals.completedCount)} />
            <MiniStat label="المتأخرة" value={formatNumber(followupTotals.overdueCount)} tone="danger" />
            <MiniStat label="لم يرد" value={formatNumber(followupTotals.noAnswerCount)} />
            <MiniStat label="مؤجل" value={formatNumber(followupTotals.postponedCount)} />
            <MiniStat label="يحتاج مدير" value={formatNumber(followupTotals.needsManagerCount)} tone="danger" />
          </div>
          <div className="mt-3 rounded-2xl border border-teal-500/20 bg-teal-500/10 p-3 text-sm text-teal-100">
            شراء بعد المتابعة: <b>{formatMoney(followupTotals.purchaseAfterFollowupAmount)}</b>
          </div>
        </Panel>

        <Panel title="التنبيهات" source="notifications">
          <NotificationsList rows={summary?.notifications || []} />
        </Panel>

        <Panel title="سجل النشاط" source="activity_log">
          <ActivityList rows={summary?.activity || []} />
        </Panel>
      </section>
    </div>
  );
}

function Kpi({
  label,
  value,
  source,
  icon: Icon,
  loading,
  tone = "teal",
}: {
  label: string;
  value: ReactNode;
  source: string;
  icon: ElementType;
  loading: boolean;
  tone?: "teal" | "danger";
}) {
  const color = tone === "danger" ? "text-rose-300 bg-rose-500/12" : "text-teal-300 bg-teal-500/12";
  return (
    <div className="rounded-3xl border border-white/10 bg-[#12233d]/90 p-4 shadow-xl shadow-black/10">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-slate-400">{label}</div>
          <div className="mt-2 text-2xl font-black text-white">{loading ? "..." : value}</div>
          <div className="mt-2 text-[11px] font-semibold text-slate-400">المصدر: {source}</div>
        </div>
        <div className={cx("rounded-2xl p-3", color)}><Icon className="h-6 w-6" /></div>
      </div>
    </div>
  );
}

function Panel({ title, source, children }: { title: string; source: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl border border-white/10 bg-[#10213a]/92 p-4 shadow-xl shadow-black/10">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-black text-white">{title}</h2>
        <span className="text-[11px] font-bold text-slate-400">المصدر: {source}</span>
      </div>
      {children}
    </section>
  );
}

function DoctorsTable({ rows }: { rows: StaffSalesSummary[] }) {
  const sorted = [...rows].sort((a, b) => b.netTotal - a.netTotal).slice(0, 10);
  if (!sorted.length) return <Empty text="لا توجد بيانات دكاترة في staff_sales_summary." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="text-xs text-slate-400">
          <tr className="border-b border-white/10">
            <th className="p-2 text-right">#</th>
            <th className="p-2 text-right">الدكتور</th>
            <th className="p-2 text-right">الفرع</th>
            <th className="p-2 text-right">المبيعات</th>
            <th className="p-2 text-right">الفواتير</th>
            <th className="p-2 text-right">متوسط الفاتورة</th>
            <th className="p-2 text-right">عملاء</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, index) => (
            <tr key={`${row.sellerName}-${row.branch}-${index}`} className="border-b border-white/5 text-slate-200">
              <td className="p-2 font-black text-teal-300">{index + 1}</td>
              <td className="p-2 font-bold text-white">{row.sellerName || "غير محدد"}</td>
              <td className="p-2">{row.branch || "غير محدد"}</td>
              <td className="p-2 text-teal-300">{formatMoney(row.netTotal)}</td>
              <td className="p-2">{formatNumber(row.invoicesCount)}</td>
              <td className="p-2">{formatMoney(row.avgInvoice)}</td>
              <td className="p-2">{formatNumber(row.uniqueCustomers)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DeliveryTable({ rows }: { rows: DeliveryPerformanceSummary[] }) {
  const sorted = [...rows].sort((a, b) => b.deliverySalesTotal - a.deliverySalesTotal).slice(0, 10);
  if (!sorted.length) return <Empty text="لا توجد بيانات دليفري في delivery_performance_summary." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="text-xs text-slate-400">
          <tr className="border-b border-white/10">
            <th className="p-2 text-right">#</th>
            <th className="p-2 text-right">الدليفري</th>
            <th className="p-2 text-right">الفرع</th>
            <th className="p-2 text-right">عدد التوصيلات</th>
            <th className="p-2 text-right">مبيعات التوصيل</th>
            <th className="p-2 text-right">كاش الدليفري</th>
            <th className="p-2 text-right">رسوم إضافية</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, index) => (
            <tr key={`${row.deliveryStaff}-${row.branch}-${index}`} className="border-b border-white/5 text-slate-200">
              <td className="p-2 font-black text-teal-300">{index + 1}</td>
              <td className="p-2 font-bold text-white">{row.deliveryStaff || "غير محدد"}</td>
              <td className="p-2">{row.branch || "غير محدد"}</td>
              <td className="p-2">{formatNumber(row.deliveriesCount)}</td>
              <td className="p-2 text-teal-300">{formatMoney(row.deliverySalesTotal)}</td>
              <td className="p-2">{formatMoney(row.courierCashTotal)}</td>
              <td className="p-2">{formatMoney(row.extraFeesTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NotificationsList({ rows }: { rows: DashboardNotification[] }) {
  if (!rows.length) return <Empty text="لا توجد تنبيهات متاحة حتى الآن" />;
  return (
    <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
      {rows.map((row) => {
        const content = (
          <div className={cx("rounded-2xl border p-3", priorityClass(row.priority))}>
            <div className="text-sm font-black">{row.title || row.message || "تنبيه"}</div>
            {row.title && row.message && <div className="mt-1 text-xs opacity-85">{row.message}</div>}
            <div className="mt-2 text-[11px] opacity-70">{row.priority || "غير محدد"} · {displayDate(row.createdAt)}</div>
          </div>
        );
        return row.routePath ? <Link key={row.id} to={row.routePath}>{content}</Link> : <div key={row.id}>{content}</div>;
      })}
    </div>
  );
}

function ActivityList({ rows }: { rows: DashboardActivity[] }) {
  if (!rows.length) return <Empty text="لا توجد أنشطة مسجلة" />;
  return (
    <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
      {rows.map((row) => (
        <div key={row.id} className="rounded-2xl border border-white/10 bg-white/[0.045] p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-black text-white">{row.action || "نشاط"}</div>
              <div className="mt-1 line-clamp-2 text-xs text-slate-300">{row.description || "غير متاح"}</div>
            </div>
            <div className="shrink-0 text-[11px] text-slate-500">{displayDate(row.createdAt)}</div>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-400">
            <span>{row.userName || "غير محدد"}</span>
            <span>{row.branch || "غير محدد"}</span>
            <span>{row.targetType || "غير محدد"}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function MiniStat({ label, value, tone = "teal" }: { label: string; value: ReactNode; tone?: "teal" | "danger" }) {
  const color = tone === "danger" ? "text-rose-200 bg-rose-500/10 border-rose-500/20" : "text-teal-100 bg-teal-500/10 border-teal-500/20";
  return (
    <div className={cx("rounded-2xl border p-3", color)}>
      <div className="text-xs opacity-80">{label}</div>
      <div className="mt-1 text-xl font-black">{value}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-slate-600 p-6 text-center text-sm text-slate-400">{text}</div>;
}
