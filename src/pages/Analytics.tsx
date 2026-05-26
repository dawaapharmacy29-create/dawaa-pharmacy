import { useEffect, useMemo, useState, type ElementType, type ReactElement, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CalendarDays, Save, ShoppingBag, TrendingDown, TrendingUp, Truck, Users } from "lucide-react";
import { toast } from "sonner";
import { useAuth, getSafeCurrentUserId } from "@/hooks/useAuth";
import { useSupabaseQuery, logActivity } from "@/hooks/useSupabaseQuery";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";
import { normalizeBranchName, branchMatches } from "@/lib/branch";
import { formatCycleDate, getCurrentCycle, getCycleForDate } from "@/lib/pharmacy-cycle";
import {
  aggregateInvoiceAnalytics,
  getShiftFromDateTime,
  isDeliveryInvoice,
  loadShiftBounds,
  saveShiftBounds,
  type SalesInvoiceRow,
  type ShiftBounds,
} from "@/lib/analyticsFromInvoices";

type TabKey = "overview" | "day" | "shifts" | "doctors" | "customers" | "targets" | "alerts";

interface BranchTargetRow {
  id?: string;
  branch_name: string;
  target_amount: number;
  cycle_start_day?: number;
  active?: boolean;
}

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "نظرة عامة" },
  { key: "day", label: "تحليل اليوم" },
  { key: "shifts", label: "الشيفتات" },
  { key: "doctors", label: "الدكاترة" },
  { key: "customers", label: "العملاء" },
  { key: "targets", label: "التارجت" },
  { key: "alerts", label: "التنبيهات الذكية" },
];

const ALL_FILTER = "الكل";
const DEFAULT_TARGET_BRANCHES = ["فرع شكري", "فرع الشامي"];
const defaultTargetAmount = (branch: string) => (branch.includes("الشامي") ? 1000000 : branch.includes("شكري") ? 1500000 : 0);

const dayKey = (row: SalesInvoiceRow) =>
  String(row.analysis_datetime || row.invoice_datetime || row.invoice_date || "").slice(0, 10);

const dateTimeOf = (row: SalesInvoiceRow) =>
  row.analysis_datetime || row.invoice_datetime || row.close_datetime || row.close_time || row.invoice_date || "";

const amountOf = (row: SalesInvoiceRow) => Number(row.net_amount ?? row.amount ?? 0) || 0;
const invoiceGrossOf = (row: SalesInvoiceRow) => Number(row.gross_amount ?? row.amount ?? 0) || 0;
const invoiceDiscountedOf = (row: SalesInvoiceRow) => Number(row.discounted_amount ?? row.net_amount ?? row.amount ?? 0) || 0;
const discountOf = (row: SalesInvoiceRow) => Number(row.discount_amount ?? 0) || 0;

function uniqueSorted(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar"));
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" });
}

function daysBetween(a: string, b: string) {
  return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000));
}

function isDateInRange(day: string, start: string, end: string) {
  if (!day) return false;
  return day >= start && day <= end;
}

export default function Analytics() {
  const { user } = useAuth();
  const cycle = getCurrentCycle();
  const today = formatCycleDate(new Date());
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [periodStart, setPeriodStart] = useState(() => formatCycleDate(cycle.start));
  const [periodEnd, setPeriodEnd] = useState(() => formatCycleDate(cycle.end));
  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedBranch, setSelectedBranch] = useState(ALL_FILTER);
  const [selectedDoctor, setSelectedDoctor] = useState(ALL_FILTER);
  const [selectedShift, setSelectedShift] = useState(ALL_FILTER);
  const [selectedType, setSelectedType] = useState(ALL_FILTER);
  const [bounds, setBounds] = useState<ShiftBounds>(() => loadShiftBounds());
  const [targetDrafts, setTargetDrafts] = useState<Record<string, number>>({});
  const [newBranchName, setNewBranchName] = useState("");
  const [newBranchTarget, setNewBranchTarget] = useState(0);

  const { data: invoices, loading: invLoad, error: invError } = useSupabaseQuery<SalesInvoiceRow>({
    table: "sales_invoices",
    limit: 50000,
    orderBy: { column: "invoice_date", ascending: false },
    realtimeEnabled: false,
  });

  const { data: branchTargets, refetch: refetchTargets } = useSupabaseQuery<BranchTargetRow>({
    table: "branch_sales_targets",
    limit: 100,
    realtimeEnabled: false,
  });

  const branches = useMemo(() => uniqueSorted(invoices.map((row) => normalizeBranchName(row.branch))), [invoices]);
  const doctors = useMemo(() => uniqueSorted(invoices.map((row) => row.seller_name)), [invoices]);
  const invoiceTypes = useMemo(() => uniqueSorted(invoices.map((row) => row.invoice_type)), [invoices]);
  const latestInvoiceDate = useMemo(() => uniqueSorted(invoices.map(dayKey)).at(-1) || today, [invoices, today]);

  useEffect(() => {
    if (invoices.length === 0) return;
    const hasSelectedDay = invoices.some((row) => dayKey(row) === selectedDate);
    if (!hasSelectedDay) setSelectedDate(latestInvoiceDate);
  }, [invoices, latestInvoiceDate, selectedDate]);

  const filteredInvoices = useMemo(() => {
    return invoices.filter((row) => {
      const shift = getShiftFromDateTime(dateTimeOf(row), bounds);
      if (!isDateInRange(dayKey(row), periodStart, periodEnd)) return false;
      if (!branchMatches(selectedBranch, row.branch)) return false;
      if (selectedDoctor !== ALL_FILTER && row.seller_name !== selectedDoctor) return false;
      if (selectedShift !== ALL_FILTER && shift !== selectedShift) return false;
      if (selectedType !== ALL_FILTER && row.invoice_type !== selectedType) return false;
      return true;
    });
  }, [bounds, invoices, periodEnd, periodStart, selectedBranch, selectedDoctor, selectedShift, selectedType]);

  const dayInvoices = useMemo(() => {
    return invoices.filter((row) => {
      const shift = getShiftFromDateTime(dateTimeOf(row), bounds);
      if (dayKey(row) !== selectedDate) return false;
      if (!branchMatches(selectedBranch, row.branch)) return false;
      if (selectedDoctor !== ALL_FILTER && row.seller_name !== selectedDoctor) return false;
      if (selectedShift !== ALL_FILTER && shift !== selectedShift) return false;
      if (selectedType !== ALL_FILTER && row.invoice_type !== selectedType) return false;
      return true;
    });
  }, [bounds, invoices, selectedBranch, selectedDate, selectedDoctor, selectedShift, selectedType]);
  const agg = useMemo(() => aggregateInvoiceAnalytics(filteredInvoices, bounds), [filteredInvoices, bounds]);
  const dayAgg = useMemo(() => aggregateInvoiceAnalytics(dayInvoices, bounds), [dayInvoices, bounds]);

  const periodInvoices = useMemo(() => {
    return invoices.filter((row) => {
      const day = dayKey(row);
      return isDateInRange(day, periodStart, periodEnd);
    });
  }, [invoices, periodEnd, periodStart]);

  const doctorRows = useMemo(() => {
    return Object.entries(agg.perDoctor)
      .map(([doctor, stats]) => {
        const doctorInvoices = filteredInvoices.filter((row) => (row.seller_name || "غير محدد") === doctor);
        const customers = new Set(doctorInvoices.map((row) => row.customer_code || row.customer_name).filter(Boolean)).size;
        const delivery = doctorInvoices.filter((row) => isDeliveryInvoice(row.invoice_type)).length;
        return {
          doctor,
          count: stats.count,
          sales: stats.sales,
          avg: stats.count ? Math.round(stats.sales / stats.count) : 0,
          customers,
          delivery,
          percent: agg.totalSales ? Math.round((stats.sales / agg.totalSales) * 100) : 0,
        };
      })
      .sort((a, b) => b.sales - a.sales);
  }, [agg, filteredInvoices]);

  const branchRows = useMemo(() => {
    return Object.entries(agg.perBranch)
      .map(([branch, stats]) => {
        const rows = filteredInvoices.filter((row) => (row.branch || "غير محدد") === branch);
        const customers = new Set(rows.map((row) => row.customer_code || row.customer_name).filter(Boolean)).size;
        return {
          branch,
          count: stats.count,
          sales: stats.sales,
          avg: stats.count ? Math.round(stats.sales / stats.count) : 0,
          customers,
          percent: agg.totalSales ? Math.round((stats.sales / agg.totalSales) * 100) : 0,
        };
      })
      .sort((a, b) => b.sales - a.sales);
  }, [agg, filteredInvoices]);

  const shiftRows = useMemo(() => {
    return ["صباحي", "مسائي", "ليلي"].map((shift) => {
      const rows = filteredInvoices.filter((row) => getShiftFromDateTime(dateTimeOf(row), bounds) === shift);
      const shiftAgg = aggregateInvoiceAnalytics(rows, bounds);
      const bestDoctor = Object.entries(shiftAgg.perDoctor).sort((a, b) => b[1].sales - a[1].sales)[0]?.[0] || "-";
      const bestBranch = Object.entries(shiftAgg.perBranch).sort((a, b) => b[1].sales - a[1].sales)[0]?.[0] || "-";
      const customers = new Set(rows.map((row) => row.customer_code || row.customer_name).filter(Boolean)).size;
      return {
        shift,
        count: shiftAgg.invoiceCount,
        sales: shiftAgg.totalSales,
        avg: shiftAgg.avgInvoice,
        customers,
        bestDoctor,
        bestBranch,
        delivery: rows.filter((row) => isDeliveryInvoice(row.invoice_type)).length,
        percent: agg.totalSales ? Math.round((shiftAgg.totalSales / agg.totalSales) * 100) : 0,
      };
    });
  }, [agg.totalSales, bounds, filteredInvoices]);

  const dailyChartRows = useMemo(() => {
    const map = new Map<string, { date: string; sales: number; count: number }>();
    for (const row of filteredInvoices) {
      const date = dayKey(row);
      if (!date) continue;
      const current = map.get(date) || { date, sales: 0, count: 0 };
      current.sales += amountOf(row);
      current.count += 1;
      map.set(date, current);
    }
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-14);
  }, [filteredInvoices]);

  const selectedDoctorInvoices = useMemo(() => {
    if (selectedDoctor === ALL_FILTER) return filteredInvoices;
    return filteredInvoices.filter((row) => row.seller_name === selectedDoctor);
  }, [filteredInvoices, selectedDoctor]);

  const customerInsights = useMemo(() => {
    const map = new Map<string, SalesInvoiceRow[]>();
    for (const row of invoices) {
      const key = String(row.customer_code || row.customer_name || "").trim();
      if (!key) continue;
      map.set(key, [...(map.get(key) || []), row]);
    }

    const currentStart = periodStart;
    const currentEnd = periodEnd;
    return [...map.entries()]
      .map(([code, rows]) => {
        const sorted = rows.sort((a, b) => dayKey(a).localeCompare(dayKey(b)));
        const first = dayKey(sorted[0]);
        const last = dayKey(sorted[sorted.length - 1]);
        const total = sorted.reduce((sum, row) => sum + amountOf(row), 0);
        const current = sorted.filter((row) => dayKey(row) >= currentStart && dayKey(row) <= currentEnd).reduce((sum, row) => sum + amountOf(row), 0);
        const months = Math.max(1, Math.ceil(Math.max(1, daysBetween(first, last)) / 30));
        const avgMonthly = total / months;
        const gaps = sorted.slice(1).map((row, idx) => Math.max(1, daysBetween(dayKey(sorted[idx]), dayKey(row))));
        const avgGap = gaps.length ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length : 30;
        const sinceLast = daysBetween(last, today);
        const actualDropPercent = avgMonthly ? Math.round((1 - current / avgMonthly) * 100) : 0;
        const isActualDrop = avgMonthly >= 4000 && current < avgMonthly * 0.6;
        const expectedNextDate = new Date(new Date(last).getTime() + avgGap * 86400000).toISOString().slice(0, 10);
        const lateDays = Math.max(0, sinceLast - Math.round(avgGap));
        let status = "نشط";
        let reason = "معدل الشراء طبيعي";
        if (sinceLast > 60 || sinceLast > avgGap * 3) {
          status = "مفقود";
          reason = "لم يشتر منذ فترة طويلة";
        } else if (sinceLast > avgGap * 2) {
          status = "معرض للفقد";
          reason = `تأخر عن موعد الشراء المتوقع (${expectedNextDate})`;
        } else if (isActualDrop) {
          status = "متراجع";
          reason = "سحب الفترة المحددة أقل من 60% من المتوسط";
        } else if (first >= new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)) {
          status = "عميل جديد";
          reason = "أول شراء خلال آخر 30 يوم";
        } else if (avgMonthly >= 8000) {
          status = "مهم جدًا";
        } else if (avgMonthly >= 4000) {
          status = "مهم";
        }
        return {
          code,
          name: sorted[sorted.length - 1].customer_name || code,
          last,
          invoices: sorted.length,
          total,
          avgMonthly,
          current,
          dropPercent: isActualDrop ? Math.max(0, actualDropPercent) : null,
          expectedNextDate,
          lateDays,
          status,
          reason,
          doctor: sorted[sorted.length - 1].seller_name || "-",
          branch: sorted[sorted.length - 1].branch || "-",
          phone: sorted[sorted.length - 1].customer_phone || "",
        };
      })
      .filter((row) => ["متراجع", "معرض للفقد", "مفقود", "مهم جدًا"].includes(row.status))
      .sort((a, b) => b.avgMonthly - a.avgMonthly)
      .slice(0, 80);
  }, [invoices, periodEnd, periodStart, today]);

  const targetRows = useMemo(() => {
    const targetMap = new Map(branchTargets.map((target) => [target.branch_name, target]));
    const cycleDays = Math.max(1, daysBetween(periodStart, periodEnd) + 1);
    const elapsedDays = Math.max(1, Math.min(cycleDays, daysBetween(periodStart, today) + 1));
    const remainingDays = Math.max(1, cycleDays - elapsedDays);
    const configuredBranches = uniqueSorted([
      ...DEFAULT_TARGET_BRANCHES,
      ...branchTargets.filter((target) => target.active !== false).map((target) => target.branch_name),
    ]);
    return configuredBranches.map((branch) => {
      const target = targetMap.get(branch);
      const targetAmount = targetDrafts[branch] ?? Number(target?.target_amount || defaultTargetAmount(branch));
      const sales = periodInvoices.filter((row) => row.branch === branch).reduce((sum, row) => sum + amountOf(row), 0);
      const remaining = Math.max(0, targetAmount - sales);
      const percentage = targetAmount ? Math.round((sales / targetAmount) * 100) : 0;
      const currentDaily = sales / elapsedDays;
      const requiredDaily = remaining / remainingDays;
      const projected = currentDaily * cycleDays;
      const expectedNow = targetAmount * (elapsedDays / cycleDays);
      const status = targetAmount === 0 ? "بدون تارجت" : sales >= expectedNow ? "متقدم" : sales >= expectedNow * 0.9 ? "على المسار" : sales >= expectedNow * 0.7 ? "يحتاج متابعة" : "متأخر";
      return { branch, targetId: target?.id, targetAmount, sales, remaining, percentage, cycleDays, elapsedDays, remainingDays, currentDaily, requiredDaily, projected, status };
    });
  }, [branchTargets, periodEnd, periodInvoices, periodStart, targetDrafts, today]);

  const smartAlerts = useMemo(() => {
    const alerts = [
      ...targetRows
        .filter((row) => row.status === "متأخر")
        .map((row) => ({
          title: `${row.branch} متأخر عن التارجت`,
          message: `نسبة التحقيق الحالية ${row.percentage}% والمتوقع ${formatCurrency(row.projected)} بنهاية الدورة.`,
          severity: "high",
          route: "/analytics?tab=targets",
        })),
      ...customerInsights
        .filter((row) => row.avgMonthly >= 8000 && (row.status === "متراجع" || row.status === "معرض للفقد" || row.status === "مفقود"))
        .slice(0, 20)
        .map((row) => ({
          title: "انخفاض مشتريات عميل مهم",
          message: `${row.name}: ${row.reason}`,
          severity: row.status === "مفقود" ? "high" : "medium",
          route: "/analytics?tab=customers",
        })),
    ];
    return alerts;
  }, [customerInsights, targetRows]);

  const applyCycle = (dateValue: string) => {
    const nextCycle = getCycleForDate(new Date(`${dateValue}T12:00:00`));
    setPeriodStart(formatCycleDate(nextCycle.start));
    setPeriodEnd(formatCycleDate(nextCycle.end));
  };

  const applyPreviousCycle = () => {
    const previousDate = new Date(`${periodStart}T12:00:00`);
    previousDate.setDate(previousDate.getDate() - 1);
    const previousCycle = getCycleForDate(previousDate);
    setPeriodStart(formatCycleDate(previousCycle.start));
    setPeriodEnd(formatCycleDate(previousCycle.end));
  };

  const saveShiftSettings = async () => {
    saveShiftBounds(bounds);
    const userId = getSafeCurrentUserId();
    await logActivity(userId, user?.name || "النظام", "تعديل حدود الشيفتات", "التحليلات", "تحديث إعدادات الشيفتات", user?.branch || "كل الفروع", {
      route_path: "/analytics",
      new_value: bounds,
    });
    toast.success("تم حفظ حدود الشيفتات");
  };

  const saveBranchTarget = async (row: ReturnType<typeof targetRows>[number]) => {
    const payload = { branch_name: row.branch, target_amount: row.targetAmount, cycle_start_day: 26, active: true, updated_at: new Date().toISOString() };
    const query = row.targetId
      ? supabase.from("branch_sales_targets").update(payload).eq("id", row.targetId)
      : supabase.from("branch_sales_targets").insert(payload);
    const { error } = await query;
    if (error) {
      toast.error("تعذر حفظ تارجت الفرع. تأكد من تشغيل SQL الخاص بالتحليلات.");
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

  const addBranchTarget = async () => {
    const branchName = newBranchName.trim();
    if (!branchName) {
      toast.error("اكتب اسم الفرع أولًا");
      return;
    }
    const { error } = await supabase.from("branch_sales_targets").insert({
      branch_name: branchName,
      target_amount: newBranchTarget,
      cycle_start_day: 26,
      active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (error) {
      toast.error("تعذر إضافة الفرع. لو الفرع موجود بالفعل عدّل تارجته من الجدول.");
      return;
    }
    await logActivity(getSafeCurrentUserId(), user?.name || "النظام", "إضافة فرع للتارجت", "التحليلات", `إضافة ${branchName} إلى تارجت الفروع`, branchName, {
      route_path: "/analytics",
      target_type: "branch_sales_targets",
      new_value: { branch_name: branchName, target_amount: newBranchTarget },
    });
    setNewBranchName("");
    setNewBranchTarget(0);
    await refetchTargets();
    toast.success("تمت إضافة الفرع");
  };

  if (invLoad) {
    return <div className="stat-card h-32 animate-pulse bg-white/5" />;
  }

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">التحليلات والمبيعات</h1>
          <p className="text-slate-400 text-sm mt-1">مركز تحليل فواتير B Connect من جدول sales_invoices - الفترة: {periodStart} إلى {periodEnd}</p>
        </div>
      </div>

      {invError && <div className="stat-card border border-red-500/30 text-red-200 text-sm">{invError}</div>}

      <div className="stat-card space-y-3">
        <div className="grid md:grid-cols-6 gap-3">
          <Filter label="بداية الفترة">
            <input className="input-dark" type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} />
          </Filter>
          <Filter label="نهاية الفترة">
            <input className="input-dark" type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} />
          </Filter>
          <Filter label="دورة 26-25">
            <div className="flex gap-2">
              <button type="button" className="btn-secondary px-3 text-xs" onClick={() => applyCycle(today)}>الحالية</button>
              <button type="button" className="btn-secondary px-3 text-xs" onClick={applyPreviousCycle}>السابقة</button>
            </div>
          </Filter>
          <Filter label="الفرع">
            <select className="input-dark" value={selectedBranch} onChange={(event) => setSelectedBranch(event.target.value)}>
              <option>الكل</option>
              {branches.map((branch) => <option key={branch}>{branch}</option>)}
            </select>
          </Filter>
          <Filter label="الدكتور/المستخدم">
            <select className="input-dark" value={selectedDoctor} onChange={(event) => setSelectedDoctor(event.target.value)}>
              <option>الكل</option>
              {doctors.map((doctor) => <option key={doctor}>{doctor}</option>)}
            </select>
          </Filter>
          <Filter label="الشيفت">
            <select className="input-dark" value={selectedShift} onChange={(event) => setSelectedShift(event.target.value)}>
              <option>الكل</option>
              <option>صباحي</option>
              <option>مسائي</option>
              <option>ليلي</option>
            </select>
          </Filter>
          <Filter label="نوع الفاتورة">
            <select className="input-dark" value={selectedType} onChange={(event) => setSelectedType(event.target.value)}>
              <option>الكل</option>
              {invoiceTypes.map((type) => <option key={type}>{type}</option>)}
            </select>
          </Filter>
        </div>
        <div className="grid md:grid-cols-[220px_1fr] gap-3 items-end">
          <Filter label="يوم تفصيلي داخل تحليل اليوم">
            <div className="flex gap-2">
              <input className="input-dark" type="date" value={selectedDate === ALL_FILTER ? latestInvoiceDate : selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
              <button type="button" className="btn-secondary px-3 text-xs" onClick={() => setSelectedDate(latestInvoiceDate)}>آخر يوم</button>
            </div>
          </Filter>
          <div className="text-xs text-slate-400 pb-2">
            التحليلات العامة والدكاترة والعملاء والتارجت تعتمد على الفترة المحددة من {periodStart} إلى {periodEnd}.
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 rounded-lg text-sm border ${activeTab === tab.key ? "bg-teal-500/20 border-teal-400 text-teal-200" : "bg-white/5 border-white/10 text-slate-300"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard label="إجمالي المبيعات" value={formatCurrency(agg.totalSales)} icon={TrendingUp} />
        <MetricCard label="عدد الفواتير" value={String(agg.invoiceCount)} icon={ShoppingBag} />
        <MetricCard label="عملاء مميزون" value={String(new Set(filteredInvoices.map((row) => row.customer_code || row.customer_name).filter(Boolean)).size)} icon={Users} />
        <MetricCard label="متوسط الفاتورة" value={formatCurrency(agg.avgInvoice)} icon={CalendarDays} />
      </div>

      {activeTab === "overview" && (
        <div className="space-y-4">
          <div className="grid lg:grid-cols-2 gap-4">
            <ChartCard title="مبيعات الشيفتات حسب الفلاتر الحالية">
              <BarChart data={shiftRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2d4063" />
                <XAxis dataKey="shift" tick={{ fill: "#94a3b8", fontSize: 11, fontFamily: "Cairo" }} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11, fontFamily: "Cairo" }} />
                <Tooltip contentStyle={{ background: "#1B2B4B", border: "1px solid #2d4063", borderRadius: 8, fontFamily: "Cairo" }} formatter={(value: number) => formatCurrency(value)} />
                <Bar dataKey="sales" fill="#00C9A7" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartCard>
            <ChartCard title="مبيعات آخر 14 يوم متاح">
              <BarChart data={dailyChartRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2d4063" />
                <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10, fontFamily: "Cairo" }} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 10, fontFamily: "Cairo" }} />
                <Tooltip contentStyle={{ background: "#1B2B4B", border: "1px solid #2d4063", borderRadius: 8, fontFamily: "Cairo" }} formatter={(value: number) => formatCurrency(value)} />
                <Bar dataKey="sales" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartCard>
          </div>
          <TwoTables doctorRows={doctorRows.slice(0, 8)} branchRows={branchRows} />
          <DataTable headers={["الفرع", "مبيعات الفترة", "التارجت", "نسبة التحقيق", "متوسط البيع اليومي", "المتبقي", "الحالة"]}>
            {targetRows.map((row) => (
              <tr key={row.branch}>
                <Cell>{row.branch}</Cell>
                <Cell>{formatCurrency(row.sales)}</Cell>
                <Cell>{formatCurrency(row.targetAmount)}</Cell>
                <Cell>{row.percentage}%</Cell>
                <Cell>{formatCurrency(row.currentDaily)}</Cell>
                <Cell>{formatCurrency(row.remaining)}</Cell>
                <Cell>{row.status}</Cell>
              </tr>
            ))}
          </DataTable>
        </div>
      )}

      {activeTab === "day" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricCard label="مبيعات اليوم" value={formatCurrency(dayAgg.totalSales)} icon={TrendingUp} />
            <MetricCard label="فواتير اليوم" value={String(dayAgg.invoiceCount)} icon={ShoppingBag} />
            <MetricCard label="إجمالي الخصومات" value={formatCurrency(dayInvoices.reduce((sum, row) => sum + discountOf(row), 0))} icon={TrendingDown} />
            <MetricCard label="فواتير التوصيل" value={String(dayInvoices.filter((row) => isDeliveryInvoice(row.invoice_type)).length)} icon={Truck} />
          </div>
          <DataTable headers={["رقم الفاتورة", "الفرع", "العميل", "الكود", "الدكتور", "التاريخ والوقت", "الشيفت", "النوع", "الفاتورة", "بعد الخصم", "الصافي", "الخصم", "مندوب التوصيل", "عنوان التوصيل"]}>
            {dayInvoices.slice(0, 250).map((row, index) => (
              <tr key={row.id || index}>
                <Cell>{row.invoice_number}</Cell>
                <Cell>{row.branch}</Cell>
                <Cell>{row.customer_name}</Cell>
                <Cell>{row.customer_code}</Cell>
                <Cell>{row.seller_name}</Cell>
                <Cell>{formatDateTime(dateTimeOf(row))}</Cell>
                <Cell>{getShiftFromDateTime(dateTimeOf(row), bounds)}</Cell>
                <Cell>{row.invoice_type}</Cell>
                <Cell>{formatCurrency(invoiceGrossOf(row))}</Cell>
                <Cell>{formatCurrency(invoiceDiscountedOf(row))}</Cell>
                <Cell>{formatCurrency(amountOf(row))}</Cell>
                <Cell>{formatCurrency(discountOf(row))}</Cell>
                <Cell>{row.delivery_staff || "-"}</Cell>
                <Cell>{row.delivery_address || "-"}</Cell>
              </tr>
            ))}
          </DataTable>
          <TwoTables doctorRows={doctorRows} branchRows={branchRows} />
        </div>
      )}

      {activeTab === "shifts" && (
        <DataTable headers={["الشيفت", "عدد الفواتير", "إجمالي المبيعات", "متوسط الفاتورة", "عدد العملاء", "أفضل دكتور", "أفضل فرع", "فواتير التوصيل", "نسبة اليوم"]}>
          {shiftRows.map((row) => (
            <tr key={row.shift}>
              <Cell>{row.shift}</Cell>
              <Cell>{row.count}</Cell>
              <Cell>{formatCurrency(row.sales)}</Cell>
              <Cell>{formatCurrency(row.avg)}</Cell>
              <Cell>{row.customers}</Cell>
              <Cell>{row.bestDoctor}</Cell>
              <Cell>{row.bestBranch}</Cell>
              <Cell>{row.delivery}</Cell>
              <Cell>{row.percent}%</Cell>
            </tr>
          ))}
        </DataTable>
      )}

      {activeTab === "doctors" && (
        <div className="space-y-4">
          <DataTable headers={["الدكتور", "عدد الفواتير", "إجمالي المبيعات", "متوسط الفاتورة", "عدد العملاء", "فواتير التوصيل", "نسبة اليوم"]}>
            {doctorRows.map((row) => (
              <tr key={row.doctor}>
                <Cell>{row.doctor}</Cell>
                <Cell>{row.count}</Cell>
                <Cell>{formatCurrency(row.sales)}</Cell>
                <Cell>{formatCurrency(row.avg)}</Cell>
                <Cell>{row.customers}</Cell>
                <Cell>{row.delivery}</Cell>
                <Cell>{row.percent}%</Cell>
              </tr>
            ))}
          </DataTable>
          <DataTable headers={["رقم الفاتورة", "التاريخ", "الشيفت", "العميل", "الكود", "الفرع", "النوع", "قيمة الفاتورة", "الصافي", "الخصم", "عنوان التوصيل"]}>
            {selectedDoctorInvoices.slice(0, 250).map((row, index) => (
              <tr key={row.id || index}>
                <Cell>{row.invoice_number}</Cell>
                <Cell>{formatDateTime(dateTimeOf(row))}</Cell>
                <Cell>{getShiftFromDateTime(dateTimeOf(row), bounds)}</Cell>
                <Cell>{row.customer_name}</Cell>
                <Cell>{row.customer_code}</Cell>
                <Cell>{row.branch}</Cell>
                <Cell>{row.invoice_type}</Cell>
                <Cell>{formatCurrency(invoiceGrossOf(row))}</Cell>
                <Cell>{formatCurrency(amountOf(row))}</Cell>
                <Cell>{formatCurrency(discountOf(row))}</Cell>
                <Cell>{row.delivery_address || "-"}</Cell>
              </tr>
            ))}
          </DataTable>
        </div>
      )}

      {activeTab === "customers" && (
        <DataTable headers={["الكود", "العميل", "آخر فاتورة شراء", "موعد الشراء المتوقع", "أيام التأخير", "متوسط السحب الشهري", "سحب الفترة", "نسبة انخفاض السحب", "الحالة", "سبب التنبيه", "الدكتور", "الفرع", "واتساب"]}>
          {customerInsights.map((row) => (
            <tr key={row.code}>
              <Cell>{row.code}</Cell>
              <Cell>{row.name}</Cell>
              <Cell>{row.last}</Cell>
              <Cell>{row.expectedNextDate}</Cell>
              <Cell>{row.lateDays > 0 ? row.lateDays : "-"}</Cell>
              <Cell>{formatCurrency(row.avgMonthly)}</Cell>
              <Cell>{formatCurrency(row.current)}</Cell>
              <Cell>{row.dropPercent === null ? "-" : `${row.dropPercent}%`}</Cell>
              <Cell>{row.status}</Cell>
              <Cell>{row.reason}</Cell>
              <Cell>{row.doctor}</Cell>
              <Cell>{row.branch}</Cell>
              <Cell>{row.phone ? <a className="text-teal-300 underline" href={`https://wa.me/2${row.phone.replace(/^0/, "")}`} target="_blank" rel="noreferrer">متابعة</a> : "-"}</Cell>
            </tr>
          ))}
        </DataTable>
      )}

      {activeTab === "targets" && (
        <div className="space-y-4">
          <div className="stat-card">
            <div className="section-title mb-3">إضافة فرع للتارجت</div>
            <div className="grid md:grid-cols-[1fr_180px_auto] gap-3">
              <input className="input-dark" placeholder="اسم الفرع" value={newBranchName} onChange={(event) => setNewBranchName(event.target.value)} />
              <input className="input-dark" type="number" placeholder="قيمة التارجت" value={newBranchTarget} onChange={(event) => setNewBranchTarget(Number(event.target.value) || 0)} />
              <button type="button" className="btn-primary px-4 py-2 text-sm" onClick={addBranchTarget}>إضافة فرع</button>
            </div>
          </div>
          <DataTable headers={["الفرع", "مبيعات الفترة", "التارجت", "نسبة التحقيق", "متوسط المبيعات اليومية", "المتبقي", "اليومي المطلوب", "توقع نهاية الفترة", "الحالة", "حفظ"]}>
            {targetRows.map((row) => (
              <tr key={row.branch}>
                <Cell>{row.branch}</Cell>
                <Cell>{formatCurrency(row.sales)}</Cell>
                <Cell><input className="input-dark w-32" type="number" value={row.targetAmount} onChange={(event) => setTargetDrafts((draft) => ({ ...draft, [row.branch]: Number(event.target.value) || 0 }))} /></Cell>
                <Cell>{row.percentage}%</Cell>
                <Cell>{formatCurrency(row.currentDaily)}</Cell>
                <Cell>{formatCurrency(row.remaining)}</Cell>
                <Cell>{formatCurrency(row.requiredDaily)}</Cell>
                <Cell>{formatCurrency(row.projected)}</Cell>
                <Cell>{row.status}</Cell>
                <Cell><button type="button" className="btn-secondary py-1 px-3 text-xs" onClick={() => saveBranchTarget(row)}><Save size={14} /></button></Cell>
              </tr>
            ))}
          </DataTable>
        </div>
      )}

      {activeTab === "alerts" && (
        <div className="grid md:grid-cols-2 gap-3">
          {smartAlerts.map((alert, index) => (
            <div key={`${alert.title}-${index}`} className="stat-card border border-amber-500/25">
              <div className="text-white font-bold">{alert.title}</div>
              <div className="text-slate-300 text-sm mt-2">{alert.message}</div>
              <div className="text-xs text-amber-300 mt-3">الأهمية: {alert.severity}</div>
            </div>
          ))}
          {smartAlerts.length === 0 && <div className="stat-card text-slate-300">لا توجد تنبيهات ذكية حسب البيانات الحالية.</div>}
        </div>
      )}

      <div className="stat-card space-y-3">
        <div className="section-title text-sm">إعدادات الشيفتات</div>
        <div className="grid md:grid-cols-3 gap-3">
          <Filter label="بداية الصباحي"><input className="input-dark" value={bounds.morningStart} onChange={(event) => setBounds((b) => ({ ...b, morningStart: event.target.value }))} /></Filter>
          <Filter label="بداية المسائي"><input className="input-dark" value={bounds.morningEnd} onChange={(event) => setBounds((b) => ({ ...b, morningEnd: event.target.value }))} /></Filter>
          <Filter label="نهاية المسائي"><input className="input-dark" value={bounds.eveningEnd} onChange={(event) => setBounds((b) => ({ ...b, eveningEnd: event.target.value }))} /></Filter>
        </div>
        <button type="button" className="btn-primary px-4 py-2 text-sm" onClick={saveShiftSettings}>حفظ حدود الشيفتات</button>
      </div>
    </div>
  );
}

function MetricCard({ label, value, icon: Icon }: { label: string; value: string; icon: ElementType }) {
  return (
    <button type="button" className="stat-card text-right hover:border-teal-400/40 transition-colors">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-teal-500/15 text-teal-300">
        <Icon size={18} />
      </div>
      <div className="mt-3">
        <div className="text-xl font-bold num text-white">{value}</div>
        <div className="text-slate-400 text-xs mt-1">{label}</div>
      </div>
    </button>
  );
}

function Filter({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="text-slate-300 text-xs space-y-1 block">
      <span>{label}</span>
      {children}
    </label>
  );
}

function ChartCard({ title, children }: { title: string; children: ReactElement }) {
  return (
    <div className="stat-card">
      <div className="section-title mb-4">{title}</div>
      <ResponsiveContainer width="100%" height={260}>
        {children}
      </ResponsiveContainer>
    </div>
  );
}

function DataTable({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div className="stat-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead>
            <tr className="text-slate-400 border-b border-white/10">
              {headers.map((header) => <th key={header} className="py-3 px-3 text-right font-medium">{header}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 text-slate-100">{children}</tbody>
        </table>
      </div>
    </div>
  );
}

function Cell({ children }: { children: ReactNode }) {
  return <td className="py-3 px-3 whitespace-nowrap">{children || "-"}</td>;
}

function TwoTables({ doctorRows, branchRows }: { doctorRows: Array<{ doctor: string; count: number; sales: number; avg: number; customers: number; delivery: number; percent: number }>; branchRows: Array<{ branch: string; count: number; sales: number; avg: number; customers: number; percent: number }> }) {
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <DataTable headers={["الدكتور", "الفواتير", "المبيعات", "المتوسط", "العملاء", "التوصيل", "النسبة"]}>
        {doctorRows.map((row) => (
          <tr key={row.doctor}>
            <Cell>{row.doctor}</Cell>
            <Cell>{row.count}</Cell>
            <Cell>{formatCurrency(row.sales)}</Cell>
            <Cell>{formatCurrency(row.avg)}</Cell>
            <Cell>{row.customers}</Cell>
            <Cell>{row.delivery}</Cell>
            <Cell>{row.percent}%</Cell>
          </tr>
        ))}
      </DataTable>
      <DataTable headers={["الفرع", "الفواتير", "المبيعات", "المتوسط", "العملاء", "النسبة"]}>
        {branchRows.map((row) => (
          <tr key={row.branch}>
            <Cell>{row.branch}</Cell>
            <Cell>{row.count}</Cell>
            <Cell>{formatCurrency(row.sales)}</Cell>
            <Cell>{formatCurrency(row.avg)}</Cell>
            <Cell>{row.customers}</Cell>
            <Cell>{row.percent}%</Cell>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}
