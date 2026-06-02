import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, CalendarDays, RefreshCw, Save, Stethoscope, Store, TrendingUp, Users } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { useAuth, getSafeCurrentUserId } from "@/hooks/useAuth";
import { useSupabaseQuery, logActivity } from "@/hooks/useSupabaseQuery";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";
import { normalizeBranchName } from "@/lib/branch";
import { formatCycleDate, getCurrentCycle, getPreviousCycle } from "@/lib/pharmacy-cycle";
import {
  clearSalesAnalyticsSummaryCache,
  loadSalesAnalyticsSummary,
  type SalesAnalyticsSummary,
} from "@/lib/salesAnalyticsSummaryService";

type PeriodType = "cycle" | "previous_cycle" | "month" | "last_30_days" | "custom";

interface BranchTargetRow {
  id?: string;
  branch_name: string;
  target_amount: number;
  cycle_start_day?: number;
  active?: boolean;
}

const ALL_FILTER = "الكل";

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "غير متاح";
  return Number(value).toLocaleString("ar-EG", { maximumFractionDigits: 0 });
}

function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "غير متاح";
  return formatCurrency(Number(value));
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function periodDays(start: string, end: string) {
  const startDate = new Date(`${start}T12:00:00`);
  const endDate = new Date(`${end}T12:00:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return 0;
  return Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1);
}

export default function Analytics() {
  const { user } = useAuth();
  const cycle = getCurrentCycle();
  const previousCycle = getPreviousCycle();
  const [periodStart, setPeriodStart] = useState(() => formatCycleDate(cycle.start));
  const [periodEnd, setPeriodEnd] = useState(() => formatCycleDate(cycle.end));
  const [periodType, setPeriodType] = useState<PeriodType>("cycle");
  const [selectedBranch, setSelectedBranch] = useState(ALL_FILTER);
  const [selectedDoctor, setSelectedDoctor] = useState(ALL_FILTER);
  const [data, setData] = useState<SalesAnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const { data: branchTargets, refetch: refetchTargets } = useSupabaseQuery<BranchTargetRow>({
    table: "branch_sales_targets",
    limit: 100,
    realtimeEnabled: false,
  });

  const load = useCallback(async (forceRefresh = false) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError(null);
    try {
      if (forceRefresh) clearSalesAnalyticsSummaryCache();
      const result = await loadSalesAnalyticsSummary({
        startDate: periodStart,
        endDate: periodEnd,
        branch: selectedBranch,
        doctor: selectedDoctor,
      }, forceRefresh);
      if (requestIdRef.current !== requestId) return;
      setData(result);
    } catch (err) {
      if (requestIdRef.current !== requestId) return;
      setError(err instanceof Error ? err.message : "تعذر تحميل التحليلات");
      setData(null);
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }, [periodEnd, periodStart, selectedBranch, selectedDoctor]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(false), 250);
    return () => window.clearTimeout(timeout);
  }, [load]);

  const branches = useMemo(() => data?.branchRows.map((row) => row.branch).filter(Boolean) || [], [data]);
  const doctors = useMemo(() => data?.doctorRows.map((row) => row.doctor).filter(Boolean) || [], [data]);

  const applyPeriod = (type: PeriodType) => {
    setPeriodType(type);
    if (type === "cycle") {
      setPeriodStart(formatCycleDate(cycle.start));
      setPeriodEnd(formatCycleDate(cycle.end));
    } else if (type === "previous_cycle") {
      setPeriodStart(formatCycleDate(previousCycle.start));
      setPeriodEnd(formatCycleDate(previousCycle.end));
    } else if (type === "month") {
      const now = new Date();
      setPeriodStart(formatCycleDate(new Date(now.getFullYear(), now.getMonth(), 1)));
      setPeriodEnd(formatCycleDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)));
    } else if (type === "last_30_days") {
      const now = new Date();
      setPeriodEnd(formatCycleDate(now));
      setPeriodStart(formatCycleDate(new Date(now.getTime() - 30 * 86400000)));
    }
  };

  const targetRows = useMemo(() => {
    const byBranch = new Map((branchTargets || []).map((target) => [normalizeBranchName(target.branch_name), target]));
    return (data?.branchRows || []).map((row) => {
      const target = byBranch.get(normalizeBranchName(row.branch));
      const targetAmount = Number(target?.target_amount || 0);
      return {
        ...row,
        targetId: target?.id,
        targetAmount,
        percent: targetAmount ? Math.round((row.netSales / targetAmount) * 100) : null,
      };
    });
  }, [branchTargets, data?.branchRows]);

  const saveBranchTarget = async (row: { branch: string; targetId?: string; targetAmount: number }) => {
    const payload = { branch_name: row.branch, target_amount: row.targetAmount, cycle_start_day: 26, active: true, updated_at: new Date().toISOString() };
    const query = row.targetId
      ? supabase.from("branch_sales_targets").update(payload).eq("id", row.targetId)
      : supabase.from("branch_sales_targets").insert(payload);
    const { error } = await query;
    if (error) {
      toast.error("تعذر حفظ تارجت الفرع");
      return;
    }
    await refetchTargets();
    await logActivity(getSafeCurrentUserId(), user?.name || "النظام", "تحديث تارجت فرع", "التحليلات", `تحديث تارجت ${row.branch}`, row.branch, {
      route_path: "/analytics",
      target_type: "branch_sales_targets",
      target_id: row.targetId,
      new_value: payload,
    });
    toast.success("تم حفظ التارجت");
  };

  return (
    <div className="space-y-5" dir="rtl">
      <div className="rounded-2xl border border-[#E5EAF0] bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-black text-slate-900">التحليلات والمبيعات</h1>
            <p className="mt-1 text-sm text-slate-500">
              قراءة سريعة من الملخصات المعتمدة بدون تحميل كل الفواتير في المتصفح.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load(true)}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-4 py-2 text-sm font-bold text-teal-700 hover:bg-teal-100"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            تحديث التحليلات
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-[#E5EAF0] bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-5">
          <Filter label="نوع الفترة">
            <select className="dawaa-input" value={periodType} onChange={(event) => applyPeriod(event.target.value as PeriodType)}>
              <option value="cycle">الدورة الحالية</option>
              <option value="previous_cycle">الدورة السابقة</option>
              <option value="month">هذا الشهر</option>
              <option value="last_30_days">آخر 30 يوم</option>
              <option value="custom">مخصص</option>
            </select>
          </Filter>
          <Filter label="بداية الفترة">
            <input className="dawaa-input" type="date" value={periodStart} onChange={(event) => { setPeriodStart(event.target.value); setPeriodType("custom"); }} />
          </Filter>
          <Filter label="نهاية الفترة">
            <input className="dawaa-input" type="date" value={periodEnd} onChange={(event) => { setPeriodEnd(event.target.value); setPeriodType("custom"); }} />
          </Filter>
          <Filter label="الفرع">
            <select className="dawaa-input" value={selectedBranch} onChange={(event) => setSelectedBranch(event.target.value)}>
              <option>{ALL_FILTER}</option>
              {branches.map((branch) => <option key={branch}>{branch}</option>)}
            </select>
          </Filter>
          <Filter label="الدكتور">
            <select className="dawaa-input" value={selectedDoctor} onChange={(event) => setSelectedDoctor(event.target.value)}>
              <option>{ALL_FILTER}</option>
              {doctors.map((doctor) => <option key={doctor}>{doctor}</option>)}
            </select>
          </Filter>
        </div>
      </div>

      {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>}

      {loading ? (
        <div className="grid gap-3 md:grid-cols-4">
          {[1, 2, 3, 4].map((item) => <div key={item} className="h-28 animate-pulse rounded-2xl bg-white shadow-sm" />)}
        </div>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            <Kpi icon={TrendingUp} label="صافي المبيعات" value={formatMoney(data?.kpis.netSales)} hint="sales_daily_summary" />
            <Kpi icon={CalendarDays} label="عدد الفواتير" value={formatNumber(data?.kpis.invoicesCount)} hint="sales_daily_summary" />
            <Kpi icon={Store} label="متوسط الفاتورة" value={formatMoney(data?.kpis.avgInvoice)} hint="net / invoices" />
            <Kpi icon={Users} label="العملاء المشترين" value={formatNumber(data?.kpis.uniqueCustomers)} hint="summary customers" />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <ChartCard title={periodDays(periodStart, periodEnd) > 45 ? "تطور المبيعات حسب الفترة" : "تطور المبيعات اليومي"}>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={data?.dailyTrend || []}>
                  <CartesianGrid stroke="#E5EAF0" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value) => formatMoney(Number(value))} />
                  <Line dataKey="netSales" stroke="#00AFA5" strokeWidth={3} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="أداء الفروع">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={data?.branchRows || []}>
                  <CartesianGrid stroke="#E5EAF0" vertical={false} />
                  <XAxis dataKey="branch" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value) => formatMoney(Number(value))} />
                  <Bar dataKey="netSales" fill="#00AFA5" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="أفضل الدكاترة">
              <div className="space-y-2">
                {(data?.doctorRows || []).slice(0, 8).map((row, index) => {
                  const body = (
                    <>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-bold text-slate-900">{index + 1}. {row.doctor}</div>
                        <div className="text-xs text-slate-500">{row.branch || "غير محدد"} - {formatNumber(row.invoicesCount)} فاتورة</div>
                        {row.duplicateWarning && <div className="mt-1 text-[11px] font-bold text-amber-600">{row.duplicateWarning}</div>}
                      </div>
                      <div className="font-black text-teal-700">{formatMoney(row.netSales)}</div>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-slate-100">
                      <div className="h-2 rounded-full bg-teal-500" style={{ width: `${Math.min(100, (row.netSales / Math.max(1, data?.doctorRows?.[0]?.netSales || 1)) * 100)}%` }} />
                    </div>
                    </>
                  );
                  return row.staffId ? (
                    <Link key={`${row.staffId}-${row.branch}-${index}`} to={`/staff/${row.staffId}`} className="block rounded-xl border border-slate-100 p-3 transition hover:border-teal-200 hover:bg-teal-50/40">
                      {body}
                    </Link>
                  ) : (
                    <div key={`${row.doctor}-${row.branch}-${index}`} className="rounded-xl border border-slate-100 p-3">
                      {body}
                    </div>
                  );
                })}
                {!data?.doctorRows.length && <Empty text="لا توجد بيانات دكاترة للفترة المحددة" />}
              </div>
            </ChartCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="شرائح العملاء">
              <Mini label="عملاء مهمون" value={formatNumber(data?.customerCards.important)} />
              <Mini label="متوقفون" value={formatNumber(data?.customerCards.stopped)} />
              <Mini label="مهددون بالتوقف" value={formatNumber(data?.customerCards.threatened)} />
              <Mini label="بدون رقم صحيح" value={formatNumber(data?.customerCards.invalidPhone)} />
            </Panel>
            <Panel title="صحة بيانات الفواتير">
              <Mini label="بدون كود عميل" value={formatNumber(data?.dataHealth.invoicesWithoutCustomer)} />
              <Mini label="بدون دكتور" value={formatNumber(data?.dataHealth.invoicesWithoutDoctor)} />
              <Mini label="بدون فرع" value={formatNumber(data?.dataHealth.invoicesWithoutBranch)} />
            </Panel>
            <Panel title="تارجت الفروع">
              <div className="space-y-2">
                {targetRows.slice(0, 6).map((row) => (
                  <button
                    key={row.branch}
                    type="button"
                    onClick={() => void saveBranchTarget({ branch: row.branch, targetId: row.targetId, targetAmount: row.targetAmount })}
                    className="flex w-full items-center justify-between rounded-xl border border-slate-100 p-3 text-right hover:border-teal-200"
                  >
                    <span className="font-bold text-slate-800">{row.branch}</span>
                    <span className="text-sm text-slate-500">{row.percent === null ? "لم يتم ضبط هدف" : `${row.percent}%`}</span>
                  </button>
                ))}
                {!targetRows.length && <Empty text="لا توجد فروع في الملخص الحالي" />}
              </div>
            </Panel>
          </div>

          <details className="rounded-2xl border border-[#E5EAF0] bg-white p-4 shadow-sm">
            <summary className="cursor-pointer text-sm font-black text-slate-900">فحص مصادر التحليلات</summary>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {(data?.sourceHealth || []).map((source) => (
                <div key={source.source} className="rounded-xl border border-slate-100 p-3 text-sm">
                  <div className="font-bold text-slate-900">{source.source}</div>
                  <div className="text-slate-500">{source.status === "ready" ? "متصل" : source.status === "empty" ? "لا توجد بيانات" : "خطأ في المصدر"}</div>
                  {source.message && <div className="mt-1 text-xs text-red-600">{source.message}</div>}
                </div>
              ))}
            </div>
          </details>
        </>
      )}
    </div>
  );
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1 text-xs font-bold text-slate-500">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Kpi({ icon: Icon, label, value, hint }: { icon: typeof Save; label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-[#E5EAF0] bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="rounded-xl bg-teal-50 p-2 text-teal-600"><Icon size={18} /></div>
        <span className="text-xs text-slate-400">{hint}</span>
      </div>
      <div className="mt-4 text-2xl font-black text-slate-900">{value}</div>
      <div className="mt-1 text-sm font-bold text-slate-500">{label}</div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[#E5EAF0] bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-base font-black text-slate-900">{title}</h2>
      {children}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[#E5EAF0] bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-base font-black text-slate-900">{title}</h2>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3">
      <span className="text-sm font-bold text-slate-600">{label}</span>
      <span className="text-lg font-black text-slate-900">{value}</span>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-sm text-slate-500">{text}</div>;
}
