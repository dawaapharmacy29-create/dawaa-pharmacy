import { useEffect, useMemo, useState, type ElementType, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  BellRing,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Database,
  HeadphonesIcon,
  Loader2,
  RefreshCw,
  SearchX,
  ShoppingCart,
  Stethoscope,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import {
  Area,
  AreaChart,
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
  ALL_BRANCHES_LABEL,
  fetchExecutiveDashboardSummary,
  friendlySourceError,
  type DashboardActivity,
  type DashboardActionItem,
  type DashboardMetric,
  type DashboardNotification,
  type DashboardSummary,
  type DeliveryPerformanceSummary,
  type FollowupPerformanceSummary,
  type SalesDailySummary,
  type StaffSalesSummary,
} from "@/lib/dashboardSummaryService";
import { formatMoney, formatNumber } from "@/lib/dawaa2027";

const cx = (...items: Array<string | false | null | undefined>) => items.filter(Boolean).join(" ");

function hasValue(value: number | null | undefined) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function numberValue(value: number | null | undefined) {
  return hasValue(value) ? Number(value) : null;
}

function displayCount(value: number | null | undefined) {
  const numeric = numberValue(value);
  return numeric === null ? "غير متاح" : formatNumber(numeric);
}

function displayMoney(value: number | null | undefined) {
  const numeric = numberValue(value);
  return numeric === null ? "غير متاح" : formatMoney(numeric);
}

function displayDate(value: string | null | undefined) {
  if (!value) return "غير محدد";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" });
}

function displayShortTime(value: string | null) {
  if (!value) return "لم يتم التحديث بعد";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "لم يتم التحديث بعد";
  return date.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
}

function dayLabel(value: string) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value || "غير محدد";
  return date.toLocaleDateString("ar-EG", { day: "numeric", month: "short" });
}

function priorityClass(priority?: string | null) {
  const value = String(priority || "").toLowerCase();
  if (value.includes("urgent") || value.includes("عاجل")) return "border-red-200 bg-red-50 text-red-700";
  if (value.includes("high") || value.includes("مرتفع")) return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-teal-200 bg-teal-50 text-teal-700";
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
      share: total ? (row.netTotal / total) * 100 : 0,
    }))
    .sort((a, b) => b.netTotal - a.netTotal);
}

function getSalesOverview(rows: Array<{ saleDate: string; netTotal: number; invoicesCount: number; label: string }>) {
  if (!rows.length) {
    return { total: 0, activeDays: 0, bestDay: null as null | (typeof rows)[number], lowestDay: null as null | (typeof rows)[number] };
  }

  const activeRows = rows.filter((row) => row.netTotal > 0);
  return {
    total: rows.reduce((sum, row) => sum + row.netTotal, 0),
    activeDays: activeRows.length,
    bestDay: [...rows].sort((a, b) => b.netTotal - a.netTotal)[0] || null,
    lowestDay: activeRows.sort((a, b) => a.netTotal - b.netTotal)[0] || null,
  };
}

export default function ExecutiveDashboard2027() {
  const currentCycle = useMemo(() => getCurrentCycle(), []);
  const [periodStart, setPeriodStart] = useState(() => formatCycleDate(currentCycle.start));
  const [periodEnd, setPeriodEnd] = useState(() => formatCycleDate(currentCycle.end));
  const [branch, setBranch] = useState(ALL_BRANCHES);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshingSummaries, setRefreshingSummaries] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);

  const loadSummary = async () => {
    setLoading(true);
    try {
      const result = await fetchExecutiveDashboardSummary({ startDate: periodStart, endDate: periodEnd, branch });
      setSummary(result);
      setLastRefreshed(new Date().toISOString());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodStart, periodEnd, branch]);

  const errors = summary?.errors || [];
  const kpis = summary?.kpis || null;
  const normalizedKpis = summary?.normalizedKpis;
  const sourceHealth = summary?.sourceHealth;
  const hasInvoiceRows = numberValue(normalizedKpis?.invoicesCount.value ?? kpis?.invoicesCount) !== 0;
  const urgentNotifications = useMemo(
    () => (summary?.notifications || []).filter((item) => /urgent|high|عاجل|مرتفع/i.test(String(item.priority || ""))).length,
    [summary],
  );

  const branchOptions = useMemo(() => {
    const values = new Set<string>([ALL_BRANCHES]);
    summary?.dailySales.forEach((row) => row.branch && values.add(row.branch));
    summary?.staffSales.forEach((row) => row.branch && values.add(row.branch));
    summary?.deliveryPerformance.forEach((row) => row.branch && values.add(row.branch));
    return [...values];
  }, [summary]);

  const dailyTrend = useMemo(() => {
    const byDay = new Map<string, { saleDate: string; netTotal: number; invoicesCount: number }>();
    for (const row of summary?.dailySales || []) {
      const current = byDay.get(row.saleDate) || { saleDate: row.saleDate, netTotal: 0, invoicesCount: 0 };
      current.netTotal += row.netTotal;
      current.invoicesCount += row.invoicesCount;
      byDay.set(row.saleDate, current);
    }
    return [...byDay.values()]
      .sort((a, b) => a.saleDate.localeCompare(b.saleDate))
      .map((row) => ({ ...row, label: dayLabel(row.saleDate) }));
  }, [summary]);

  const branchRows = useMemo(() => aggregateBranches(summary?.dailySales || []), [summary]);
  const followupTotals = useMemo(() => sumFollowups(summary?.followupPerformance || []), [summary]);
  const salesOverview = useMemo(() => getSalesOverview(dailyTrend), [dailyTrend]);

  const refreshDashboardSummaries = async () => {
    setRefreshingSummaries(true);
    try {
      await supabase.rpc("refresh_dashboard_summaries");
      await loadSummary();
    } finally {
      setRefreshingSummaries(false);
    }
  };

  const actionIconByKey: Record<string, ElementType> = {
    "overdue-followups": AlertTriangle,
    "due-today": ClipboardList,
    "important-risk": HeadphonesIcon,
    "needs-manager": SearchX,
    "unlinked-customers": Users,
    "missing-doctor": Stethoscope,
    "missing-branch": Database,
    "urgent-notifications": BellRing,
  };

  return (
    <div className="dawaa-dashboard-light min-h-full space-y-5" dir="rtl">
      <section className="dawaa-hero">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="dawaa-brand-chip">Dawaa Pharmacy 2027</span>
            <span className="dawaa-source-badge">المصدر: Summary Views + RPC</span>
          </div>
          <h1 className="mt-3 text-2xl font-black text-slate-950 md:text-3xl">لوحة القيادة 2027</h1>
          <p className="mt-1 text-sm font-semibold text-slate-600">مركز قيادة موحد للمبيعات والعملاء والمتابعات والفريق</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
            <CalendarDays className="h-4 w-4 text-teal-600" />
            <span>الدورة الحالية: {periodStart} إلى {periodEnd}</span>
            <span className="rounded-full bg-slate-100 px-2 py-1">آخر تحديث: {displayShortTime(lastRefreshed)}</span>
          </div>
        </div>

        <div className="dawaa-controls">
          <select className="dawaa-input min-w-[150px]" value={branch} onChange={(event) => setBranch(event.target.value)} aria-label="اختيار الفرع">
            {branchOptions.map((item) => <option key={item} value={item}>{item === ALL_BRANCHES ? ALL_BRANCHES_LABEL : item}</option>)}
          </select>
          <input className="dawaa-input w-[145px]" type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} aria-label="بداية الفترة" />
          <input className="dawaa-input w-[145px]" type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} aria-label="نهاية الفترة" />
          <button
            type="button"
            className="dawaa-button-primary"
            onClick={refreshDashboardSummaries}
            disabled={loading || refreshingSummaries}
          >
            <RefreshCw className={cx("h-4 w-4", refreshingSummaries && "animate-spin")} />
            تحديث الملخصات
          </button>
        </div>
      </section>

      {loading && (
        <div className="dawaa-loading">
          <Loader2 className="h-5 w-5 animate-spin text-teal-600" />
          جاري تحميل ملخصات لوحة القيادة...
        </div>
      )}

      {!loading && errors.length > 0 && (
        <details className="dawaa-error-details">
          <summary>تفاصيل الخطأ في مصادر البيانات</summary>
          <div className="mt-3 grid gap-2">
            {errors.map((item) => (
              <div key={`${item.source}-${item.message}`} className="rounded-xl bg-white p-3 text-xs text-slate-700">
                <div><b>{item.source}</b>: {friendlySourceError(item.message)}</div>
                <details className="mt-2">
                  <summary className="cursor-pointer font-bold text-slate-500">الرسالة التقنية</summary>
                  <div className="mt-1 break-words text-slate-500">{item.message}</div>
                </details>
              </div>
            ))}
          </div>
        </details>
      )}

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <KpiCard label="صافي مبيعات الفترة" metric={normalizedKpis?.netSales} formatter="money" subtitle="صافي قيمة الدورة" icon={Wallet} loading={loading} empty={!hasInvoiceRows} />
        <KpiCard label="عدد الفواتير" metric={normalizedKpis?.invoicesCount} formatter="count" subtitle="فواتير الفترة المحددة" icon={ShoppingCart} loading={loading} empty={!hasInvoiceRows} />
        <KpiCard label="متوسط الفاتورة" metric={normalizedKpis?.avgInvoice} formatter="money" subtitle="متوسط صافي الفاتورة" icon={TrendingUp} loading={loading} empty={!hasInvoiceRows} />
        <KpiCard label="العملاء المشترين" metric={normalizedKpis?.uniqueCustomers} formatter="count" subtitle="عملاء لديهم شراء" icon={Users} loading={loading} empty={!hasInvoiceRows} />
        <KpiCard label="المتابعات المتأخرة" metric={normalizedKpis?.overdueFollowups} formatter="count" subtitle="تحتاج تدخل إداري" icon={AlertTriangle} loading={loading} tone="danger" />
        <KpiCard label="التنبيهات العاجلة" metric={normalizedKpis?.urgentNotifications} formatter="count" subtitle="تنبيهات عالية الأولوية" icon={BellRing} loading={loading} tone={urgentNotifications ? "danger" : "teal"} />
      </section>

      <Panel title="مركز القرار السريع" source="RPC + summary views + lightweight counts" featured>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {(summary?.actionCenter || []).map((card) => (
            <ActionCard key={card.key} item={card} icon={actionIconByKey[card.key] || AlertTriangle} />
          ))}
        </div>
      </Panel>

      <section className="grid gap-4 xl:grid-cols-[1.45fr_.9fr]">
        <Panel title="نظرة المبيعات" source="sales_daily_summary.sale_date">
          <div className="mb-4 grid gap-2 sm:grid-cols-4">
            <MiniStat label="إجمالي الفترة" value={formatMoney(salesOverview.total)} />
            <MiniStat label="أفضل يوم" value={salesOverview.bestDay ? `${salesOverview.bestDay.label} · ${formatMoney(salesOverview.bestDay.netTotal)}` : "غير متاح"} />
            <MiniStat label="أقل يوم" value={salesOverview.lowestDay ? `${salesOverview.lowestDay.label} · ${formatMoney(salesOverview.lowestDay.netTotal)}` : "غير متاح"} />
            <MiniStat label="أيام نشطة" value={formatNumber(salesOverview.activeDays)} />
          </div>
          {dailyTrend.length ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailyTrend}>
                  <defs>
                    <linearGradient id="salesNetAreaLight" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#00AFA5" stopOpacity={0.34} />
                      <stop offset="95%" stopColor="#00AFA5" stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5EAF0" />
                  <XAxis dataKey="label" stroke="#64748B" fontSize={11} />
                  <YAxis stroke="#64748B" fontSize={11} width={72} />
                  <Tooltip formatter={(value) => formatMoney(Number(value || 0))} contentStyle={{ borderRadius: 14, borderColor: "#DDE7F0" }} labelStyle={{ color: "#0F172A" }} />
                  <Area type="monotone" dataKey="netTotal" stroke="#00AFA5" strokeWidth={3} fill="url(#salesNetAreaLight)" name="صافي المبيعات" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : <Empty text={sourceHealth?.salesSummaryAvailable ? "لا توجد بيانات مبيعات يومية للفترة المحددة" : "بيانات المبيعات اليومية غير متاحة حاليًا"} />}
        </Panel>

        <Panel title="أداء الفروع" source="sales_daily_summary">
          <BranchPerformance rows={branchRows} available={Boolean(sourceHealth?.salesSummaryAvailable)} />
        </Panel>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Panel title="ترتيب الدكاترة" source="staff_sales_summary">
          <DoctorsTable rows={summary?.staffSales || []} available={Boolean(sourceHealth?.staffSummaryAvailable)} />
        </Panel>
        <Panel title="ترتيب الدليفري" source="delivery_performance_summary">
          <DeliveryTable rows={summary?.deliveryPerformance || []} available={Boolean(sourceHealth?.deliverySummaryAvailable)} />
        </Panel>
      </section>

      <section className="grid gap-4 xl:grid-cols-4">
        <Panel title="أداء المتابعات" source="followup_performance_summary.followup_date">
          <FollowupPerformance totals={followupTotals} available={Boolean(sourceHealth?.followupSummaryAvailable)} />
        </Panel>
        <Panel title="ذكاء العملاء والمتابعات" source="customer_metrics_summary + daily_followups">
          <CustomerIntelligencePanel summary={summary} />
        </Panel>
        <Panel title="صحة البيانات" source="lightweight sales_invoices counts">
          <DataHealthPanel summary={summary} />
        </Panel>
        <Panel title="حالة الملخصات" source="source health">
          <SourceHealthPanel summary={summary} />
        </Panel>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Panel title="التنبيهات" source="notifications">
          <NotificationsList rows={summary?.notifications || []} available={Boolean(sourceHealth?.notificationsAvailable)} />
        </Panel>
        <Panel title="سجل النشاط" source="activity_log">
          <ActivityList rows={summary?.activity || []} available={Boolean(sourceHealth?.activityLogAvailable)} />
        </Panel>
      </section>
    </div>
  );
}

function KpiCard({
  label,
  metric,
  formatter,
  subtitle,
  icon: Icon,
  loading,
  empty,
  tone = "teal",
}: {
  label: string;
  metric?: DashboardMetric;
  formatter: "money" | "count";
  subtitle: string;
  icon: ElementType;
  loading: boolean;
  empty?: boolean;
  tone?: "teal" | "danger";
}) {
  const iconClass = tone === "danger" ? "bg-red-50 text-red-600" : "bg-teal-50 text-teal-700";
  const value = formatter === "money" ? displayMoney(metric?.value) : displayCount(metric?.value);
  const isError = metric?.status === "error" || metric?.status === "unavailable";
  const isEmpty = metric?.status === "empty" || empty;
  const state = isError ? "غير متاح" : isEmpty ? "لا توجد بيانات" : null;
  const detail = isError ? (metric?.message || "راجع صحة المصدر") : isEmpty ? "لا توجد بيانات في الفترة المحددة" : subtitle;
  return (
    <div className="dawaa-card min-h-[154px]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-bold text-slate-500">{label}</div>
          <div className="mt-2 text-2xl font-black text-slate-950">{loading ? "..." : state || value}</div>
          <div className="mt-1 text-xs leading-5 text-slate-500">{detail}</div>
        </div>
        <div className={cx("rounded-2xl p-3", iconClass)}><Icon className="h-5 w-5" /></div>
      </div>
      {metric?.status === "ready" && <div className="mt-4 text-[11px] font-bold text-slate-400">بيانات ملخصة ومعتمدة</div>}
    </div>
  );
}

function ActionCard({
  item,
  icon: Icon,
}: {
  item: DashboardActionItem;
  icon: ElementType;
}) {
  const colors = {
    danger: "border-red-200 bg-red-50 text-red-700",
    warning: "border-amber-200 bg-amber-50 text-amber-700",
    info: "border-blue-200 bg-blue-50 text-blue-700",
  };
  const iconColors = {
    danger: "bg-white text-red-600",
    warning: "bg-white text-amber-600",
    info: "bg-white text-blue-600",
  };
  const isUnavailable = item.status === "error" || item.status === "unavailable";
  const value = isUnavailable ? "غير متاح حاليًا" : displayCount(item.value);
  const detail = isUnavailable ? item.message || "راجع صحة مصادر البيانات" : item.recommendation;
  const content = (
    <div className={cx("min-h-[138px] rounded-2xl border p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md", colors[item.severity])}>
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm font-black">{item.label}</div>
        <span className={cx("rounded-xl p-2", iconColors[item.severity])}><Icon className="h-4 w-4" /></span>
      </div>
      <div className="mt-3 text-2xl font-black text-slate-950">{value}</div>
      <div className="mt-2 line-clamp-2 text-xs font-semibold opacity-80">{detail}</div>
      <div className="mt-2 text-[11px] font-black opacity-70">{isUnavailable ? "تفاصيل المصدر في لوحة الصحة" : "جاهز للإجراء"}</div>
    </div>
  );
  return item.route ? <Link to={item.route}>{content}</Link> : content;
}

function Panel({ title, source: _source, children, featured = false }: { title: string; source: string; children: ReactNode; featured?: boolean }) {
  return (
    <section className={cx("dawaa-panel", featured && "border-teal-200 bg-gradient-to-b from-white to-teal-50/45")}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-black text-slate-950">{title}</h2>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold text-slate-500">بيانات تشغيلية</span>
      </div>
      {children}
    </section>
  );
}

function BranchPerformance({ rows, available }: { rows: ReturnType<typeof aggregateBranches>; available: boolean }) {
  if (!available) return <Empty text="بيانات أداء الفروع غير متاحة حاليًا" />;
  if (!rows.length) return <Empty text="لا توجد بيانات في الفترة المحددة" />;
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.branch} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="font-black text-slate-900">{row.branch}</div>
            <div className="text-sm font-black text-teal-700">{formatMoney(row.netTotal)}</div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-500 sm:grid-cols-4">
            <span>{formatNumber(row.invoicesCount)} فاتورة</span>
            <span>{formatMoney(row.avgInvoice)} متوسط</span>
            <span>{formatNumber(row.uniqueCustomers)} عميل</span>
            <span>{row.share.toFixed(1)}%</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function performanceBadge(index: number, total: number) {
  if (index === 0) return { label: "ممتاز", className: "bg-emerald-50 text-emerald-700 border-emerald-200" };
  if (index < Math.ceil(total / 2)) return { label: "جيد", className: "bg-blue-50 text-blue-700 border-blue-200" };
  return { label: "يحتاج متابعة", className: "bg-amber-50 text-amber-700 border-amber-200" };
}

function DoctorsTable({ rows, available }: { rows: StaffSalesSummary[]; available: boolean }) {
  const sorted = [...rows].sort((a, b) => b.netTotal - a.netTotal).slice(0, 10);
  if (!available) return <Empty text="مصدر ترتيب الدكاترة غير متاح حاليًا" />;
  if (!sorted.length) return <Empty text="لا توجد بيانات في الفترة المحددة" />;
  return (
    <CompactTable>
      <thead>
        <tr>
          <th>#</th>
          <th>الدكتور</th>
          <th>الفرع</th>
          <th>المبيعات</th>
          <th>الفواتير</th>
          <th>المتوسط</th>
          <th>عملاء</th>
          <th>الأداء</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((row, index) => {
          const badge = performanceBadge(index, sorted.length);
          return (
            <tr key={`${row.sellerName}-${row.branch}-${index}`}>
              <td className="font-black text-teal-700">{index + 1}</td>
              <td className="font-black text-slate-950">{row.sellerName || "غير محدد"}</td>
              <td>{row.branch || "غير محدد"}</td>
              <td className="font-bold text-teal-700">{formatMoney(row.netTotal)}</td>
              <td>{formatNumber(row.invoicesCount)}</td>
              <td>{formatMoney(row.avgInvoice)}</td>
              <td>{formatNumber(row.uniqueCustomers)}</td>
              <td><span className={cx("rounded-full border px-2 py-1 text-[11px] font-black", badge.className)}>{badge.label}</span></td>
            </tr>
          );
        })}
      </tbody>
    </CompactTable>
  );
}

function DeliveryTable({ rows, available }: { rows: DeliveryPerformanceSummary[]; available: boolean }) {
  const sorted = [...rows].sort((a, b) => b.deliverySalesTotal - a.deliverySalesTotal).slice(0, 10);
  if (!available) return <Empty text="مصدر ترتيب الدليفري غير متاح حاليًا" />;
  if (!sorted.length) return <Empty text="لا توجد بيانات في الفترة المحددة" />;
  return (
    <CompactTable>
      <thead>
        <tr>
          <th>#</th>
          <th>الدليفري</th>
          <th>الفرع</th>
          <th>التوصيلات</th>
          <th>المبيعات</th>
          <th>الكاش</th>
          <th>رسوم</th>
          <th>الالتزام</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((row, index) => (
          <tr key={`${row.deliveryStaff}-${row.branch}-${index}`}>
            <td className="font-black text-teal-700">{index + 1}</td>
            <td className="font-black text-slate-950">{row.deliveryStaff || "غير محدد"}</td>
            <td>{row.branch || "غير محدد"}</td>
            <td>{formatNumber(row.deliveriesCount)}</td>
            <td className="font-bold text-teal-700">{formatMoney(row.deliverySalesTotal)}</td>
            <td>{formatMoney(row.courierCashTotal)}</td>
            <td>{formatMoney(row.extraFeesTotal)}</td>
            <td><span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-black text-slate-500">غير متاح</span></td>
          </tr>
        ))}
      </tbody>
    </CompactTable>
  );
}

function FollowupPerformance({ totals, available }: { totals: ReturnType<typeof sumFollowups>; available: boolean }) {
  if (!available) return <Empty text="بيانات أداء المتابعات غير متاحة حاليًا" />;
  const completionRate = totals.assignedCount ? (totals.completedCount / totals.assignedCount) * 100 : null;
  return (
    <div className="grid grid-cols-2 gap-2">
      <MiniStat label="المسندة" value={formatNumber(totals.assignedCount)} />
      <MiniStat label="المكتملة" value={formatNumber(totals.completedCount)} />
      <MiniStat label="نسبة الإنجاز" value={completionRate === null ? "غير متاح" : `${completionRate.toFixed(1)}%`} />
      <MiniStat label="المتأخرة" value={formatNumber(totals.overdueCount)} tone="danger" />
      <MiniStat label="لم يرد" value={formatNumber(totals.noAnswerCount)} />
      <MiniStat label="مؤجل" value={formatNumber(totals.postponedCount)} />
      <MiniStat label="يحتاج مدير" value={formatNumber(totals.needsManagerCount)} tone="danger" />
      <div className="rounded-2xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-800">
        شراء بعد المتابعة: <b>{formatMoney(totals.purchaseAfterFollowupAmount)}</b>
      </div>
    </div>
  );
}

function CustomerIntelligencePanel({ summary }: { summary: DashboardSummary | null }) {
  const intel = summary?.customerIntelligence;
  if (!intel || intel.error) return <Empty text={intel?.error ? "غير متاح حاليًا - راجع صحة المصدر" : "غير متاح حاليًا"} />;
  return (
    <div className="grid grid-cols-2 gap-2">
      <MiniStat label="مهمين يحتاجون متابعة" value={displayCount(intel.importantNeedFollowup)} tone={intel.importantNeedFollowup ? "danger" : "teal"} />
      <MiniStat label="عملاء متوقفين" value={displayCount(intel.stoppedCustomers)} tone={intel.stoppedCustomers ? "danger" : "teal"} />
      <MiniStat label="مهددين بالتوقف" value={displayCount(intel.atRiskCustomers)} tone={intel.atRiskCustomers ? "danger" : "teal"} />
      <MiniStat label="بدون هاتف صحيح" value={displayCount(intel.customersWithoutValidPhone)} tone={intel.customersWithoutValidPhone ? "danger" : "teal"} />
      <MiniStat label="بيانات غير مكتملة" value={displayCount(intel.incompleteCustomers)} tone={intel.incompleteCustomers ? "danger" : "teal"} />
      <MiniStat label="متابعات تحتاج مدير" value={displayCount(intel.needsManagerFollowups)} tone={intel.needsManagerFollowups ? "danger" : "teal"} />
    </div>
  );
}

function DataHealthPanel({ summary }: { summary: DashboardSummary | null }) {
  const health = summary?.dataHealth;
  if (!health || health.error) return <Empty text={health?.error ? friendlySourceError(health.error) : "غير متاح حاليًا"} />;
  return (
    <div className="grid grid-cols-2 gap-2">
      <MiniStat label="بدون كود عميل" value={displayCount(health.invoicesWithoutCustomerCode)} tone={health.invoicesWithoutCustomerCode ? "danger" : "teal"} />
      <MiniStat label="بدون هاتف" value={displayCount(health.invoicesWithoutCustomerPhone)} tone={health.invoicesWithoutCustomerPhone ? "danger" : "teal"} />
      <MiniStat label="بدون دكتور" value={displayCount(health.invoicesWithoutSellerName)} tone={health.invoicesWithoutSellerName ? "danger" : "teal"} />
      <MiniStat label="بدون فرع" value={displayCount(health.invoicesWithoutBranch)} tone={health.invoicesWithoutBranch ? "danger" : "teal"} />
      <InfoLine label="آخر تاريخ فاتورة" value={health.lastInvoiceDate ? displayDate(health.lastInvoiceDate) : "غير محدد"} />
      <InfoLine label="آخر دفعة استيراد" value={health.latestImportBatch || "غير محدد"} />
    </div>
  );
}

function sourceStatus(ok: boolean | undefined, hasRows?: boolean) {
  if (!ok) return { label: "غير متاح", className: "bg-red-50 text-red-700 border-red-200", icon: AlertTriangle };
  if (hasRows === false) return { label: "لا توجد بيانات", className: "bg-amber-50 text-amber-700 border-amber-200", icon: AlertTriangle };
  return { label: "متصل", className: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: CheckCircle2 };
}

function SourceHealthPanel({ summary }: { summary: DashboardSummary | null }) {
  const health = summary?.sourceHealth;
  const rows = [
    ["get_dashboard_kpis", health?.rpcAvailable, summary?.kpis ? true : false],
    ["sales_daily_summary", health?.salesSummaryAvailable, Boolean(summary?.dailySales.length)],
    ["staff_sales_summary", health?.staffSummaryAvailable, Boolean(summary?.staffSales.length)],
    ["delivery_performance_summary", health?.deliverySummaryAvailable, Boolean(summary?.deliveryPerformance.length)],
    ["followup_performance_summary", health?.followupSummaryAvailable, Boolean(summary?.followupPerformance.length)],
    ["customer_metrics_summary", health?.customerSummaryAvailable, summary?.customerIntelligence?.error ? false : true],
    ["notifications", health?.notificationsAvailable, Boolean(summary?.notifications.length)],
    ["activity_log", health?.activityLogAvailable, Boolean(summary?.activity.length)],
  ] as const;
  return (
    <details className="rounded-2xl border border-slate-200 bg-slate-50 p-3" open={false}>
      <summary className="cursor-pointer text-sm font-black text-slate-800">عرض حالة مصادر البيانات</summary>
      <div className="mt-3 space-y-2">
        {rows.map(([label, ok, hasRows]) => {
          const status = sourceStatus(ok, hasRows);
          const Icon = status.icon;
          return (
            <div key={label} className="flex items-center justify-between rounded-xl bg-white px-3 py-2 text-sm">
              <span className="font-bold text-slate-700">{label}</span>
              <span className={cx("inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-black", status.className)}>
                <Icon className="h-3.5 w-3.5" />
                {status.label}
              </span>
            </div>
          );
        })}
      </div>
    </details>
  );
}

function NotificationsList({ rows, available }: { rows: DashboardNotification[]; available: boolean }) {
  if (!available) return <Empty text="مصدر التنبيهات غير متاح" />;
  if (!rows.length) return <Empty text="لا توجد تنبيهات حاليًا" />;
  return (
    <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
      {rows.map((row) => {
        const content = (
          <div className={cx("rounded-2xl border p-3 shadow-sm", priorityClass(row.priority))}>
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

function ActivityList({ rows, available }: { rows: DashboardActivity[]; available: boolean }) {
  if (!available) return <Empty text="مصدر سجل النشاط غير متاح حاليًا" />;
  if (!rows.length) return <Empty text="لا توجد أنشطة مسجلة" />;
  return (
    <div className="max-h-[320px] space-y-3 overflow-y-auto pr-1">
      {rows.map((row) => (
        <div key={row.id} className="relative rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <span className="absolute right-3 top-4 h-2.5 w-2.5 rounded-full bg-teal-500" />
          <div className="pr-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-black text-slate-950">{row.action || "نشاط"}</div>
                <div className="mt-1 line-clamp-2 text-xs text-slate-600">{row.description || "غير متاح"}</div>
              </div>
              <div className="shrink-0 text-[11px] font-bold text-slate-400">{displayDate(row.createdAt)}</div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold text-slate-500">
              <span>{row.userName || "غير محدد"}</span>
              <span>{row.branch || "غير محدد"}</span>
              <span>{row.targetType || "غير محدد"}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function CompactTable({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="dawaa-table min-w-[820px]">{children}</table>
    </div>
  );
}

function MiniStat({ label, value, tone = "teal" }: { label: string; value: ReactNode; tone?: "teal" | "danger" }) {
  const color = tone === "danger" ? "border-red-200 bg-red-50 text-red-700" : "border-teal-200 bg-teal-50 text-teal-800";
  return (
    <div className={cx("rounded-2xl border p-3", color)}>
      <div className="text-xs font-bold opacity-75">{label}</div>
      <div className="mt-1 break-words text-lg font-black">{value}</div>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="col-span-2 rounded-2xl border border-slate-200 bg-white p-3">
      <div className="text-xs font-bold text-slate-500">{label}</div>
      <div className="mt-1 break-words text-sm font-black text-slate-950">{value}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center text-sm font-semibold text-slate-500">{text}</div>;
}
