import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Users,
  UserCheck,
  Truck,
  AlertCircle,
  Star,
  ArrowUpRight,
  Clock,
  BarChart3,
  TrendingUp,
  TrendingDown,
  Award,
  Target,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
} from "recharts";
import { useSupabaseQuery } from "@/hooks/useSupabaseQuery";
import { TABLES } from "@/lib/supabaseTables";
import { DAYS_AR, INITIAL_POINTS } from "@/lib/constants";
import {
  formatCycleDate,
  getCurrentCycle,
  getCycleForDate,
  getCycleProgress,
  getRemainingDays,
} from "@/lib/pharmacy-cycle";
import { isCurrentlyOnShift, formatCurrency, percent } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { SalesInvoiceRow } from "@/lib/analyticsFromInvoices";
import { loadShiftBounds } from "@/lib/analyticsFromInvoices";
import {
  buildDailySalesByBusinessDay,
  salesGrowthPercent,
  totalSalesAmount,
} from "@/lib/dashboardFromInvoices";
import {
  effectiveCyclePoints,
  normalizeStaffLedgerKey,
  pointRecordDelta,
} from "@/lib/pointsLedger";

interface Employee {
  id: string;
  name: string;
  role: string;
  branch: string;
  status: string;
  points?: number | null;
  max_points: number;
}

interface ShiftSchedule {
  id: string;
  staff_name: string;
  branch: string;
  day_name: string;
  shift_start: string | null;
  shift_end: string | null;
  is_off: boolean | null;
}

interface ShiftException {
  id: string;
  staff_name: string;
  type: string;
  status: string;
  branch: string | null;
  day_name: string | null;
  date: string | null;
  date_end: string | null;
  reason: string | null;
}
interface Customer {
  id: string;
  type: string;
  retention_status: string;
}
interface DeliveryOrder {
  id: string;
  status: string;
}

interface PointRecord {
  id: string;
  staff_id?: string | null;
  employee_id?: string | null;
  type: string;
  points: number;
  points_delta?: number | null;
  employee_name?: string | null;
  created_at: string;
  status?: string | null;
  manager_note?: string | null;
  description?: string | null;
  month_cycle?: string | null;
}

interface Alert {
  id: string;
  type: "warning" | "info" | "success" | "error";
  title: string;
  message: string;
  time: string;
}

function normalizeBranch(branch?: string | null) {
  const value = String(branch || "");
  if (
    value.includes("أبو العزم") ||
    value.includes("ابو العزم") ||
    value.includes("العزم") ||
    value.includes("شكري")
  )
    return "فرع شكري";
  if (value.includes("شامي") || value.includes("الشامى")) return "فرع الشامي";
  return value;
}

export default function Dashboard() {
  const { user } = useAuth();
  const cycle = getCurrentCycle();
  const cycleStart = formatCycleDate(cycle.start);
  const cycleEnd = formatCycleDate(cycle.end);
  const progress = getCycleProgress();
  const remaining = getRemainingDays();
  const shiftBounds = loadShiftBounds();

  const [periodStart, setPeriodStart] = useState(cycleStart);
  const [periodEnd, setPeriodEnd] = useState(cycleEnd);
  const [invoiceRows, setInvoiceRows] = useState<SalesInvoiceRow[]>([]);
  const [invoiceLoading, setInvoiceLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isSupabaseConfigured) {
        setInvoiceLoading(false);
        return;
      }
      setInvoiceLoading(true);
      const { data, error } = await supabase
        .from("sales_invoices")
        .select("*")
        .gte("invoice_date", periodStart)
        .lte("invoice_date", periodEnd)
        .order("invoice_date", { ascending: false })
        .limit(9000);
      if (!cancelled && !error && data)
        setInvoiceRows(data as SalesInvoiceRow[]);
      if (!cancelled) setInvoiceLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [periodEnd, periodStart]);

  const applyPeriodCycle = (dateValue: string) => {
    const selectedCycle = getCycleForDate(new Date(`${dateValue}T12:00:00`));
    setPeriodStart(formatCycleDate(selectedCycle.start));
    setPeriodEnd(formatCycleDate(selectedCycle.end));
  };

  const applyPreviousPeriodCycle = () => {
    const previousDate = new Date(`${periodStart}T12:00:00`);
    previousDate.setDate(previousDate.getDate() - 1);
    const previousCycle = getCycleForDate(previousDate);
    setPeriodStart(formatCycleDate(previousCycle.start));
    setPeriodEnd(formatCycleDate(previousCycle.end));
  };

  const series = useMemo(
    () => buildDailySalesByBusinessDay(invoiceRows, 14),
    [invoiceRows],
  );
  const chartData = useMemo(
    () =>
      series.map((s) => ({
        label: new Date(`${s.day}T12:00:00`).toLocaleDateString("ar-EG", {
          weekday: "short",
          day: "numeric",
          month: "numeric",
        }),
        key: s.day,
        shokry: Math.round(s.شكري),
        shamy: Math.round(s.شامي),
        total: Math.round(s.شكري + s.شامي),
      })),
    [series],
  );

  const periodSales = totalSalesAmount(invoiceRows);
  const growth = salesGrowthPercent(series);

  const { data: employees } = useSupabaseQuery<Employee>({
    table: "staff",
    realtimeEnabled: true,
  });
  const { data: schedules } = useSupabaseQuery<ShiftSchedule>({
    table: "shift_schedules",
    realtimeEnabled: true,
  });
  const { data: exceptions } = useSupabaseQuery<ShiftException>({
    table: "shift_exceptions",
    filters: [{ column: "status", operator: "eq", value: "approved" }],
    realtimeEnabled: true,
  });
  const { data: customers } = useSupabaseQuery<Customer>({
    table: "customers",
    realtimeEnabled: true,
  });
  const { data: orders } = useSupabaseQuery<DeliveryOrder>({
    table: "delivery_orders",
    realtimeEnabled: true,
  });
  const { data: pointRecords } = useSupabaseQuery<PointRecord>({
    table: TABLES.employeeTransactions,
    orderBy: { column: "created_at", ascending: false },
    limit: 50,
    realtimeEnabled: true,
  });

  const todayName = DAYS_AR[new Date().getDay()];
  const todayDate = new Date().toISOString().split("T")[0];

  const shiftFor = useCallback(
    (employee: Employee) => {
      // First check for approved leave/exceptions
      const exception = exceptions?.find(
        (item) =>
          item.staff_name === employee.name &&
          normalizeBranch(item.branch) === normalizeBranch(employee.branch) &&
          item.status === "approved" &&
          (item.type.includes("إجازة") || item.type === "غياب") &&
          ((item.date &&
            item.date <= todayDate &&
            (!item.date_end || item.date_end >= todayDate)) ||
            item.day_name === todayName),
      );

      if (exception) {
        return {
          staff_name: employee.name,
          branch: employee.branch,
          day_name: todayName,
          shift_start: null,
          shift_end: null,
          is_off: true,
        };
      }

      return schedules.find(
        (shift) =>
          shift.staff_name === employee.name &&
          shift.branch === employee.branch &&
          shift.day_name === todayName,
      );
    },
    [exceptions, schedules, todayDate, todayName],
  );
  const onShift = useMemo(
    () =>
      employees.filter((e) => {
        const shift = shiftFor(e);
        return (
          shift?.shift_start &&
          shift?.shift_end &&
          !shift.is_off &&
          isCurrentlyOnShift(shift.shift_start, shift.shift_end) &&
          e.status === "نشط"
        );
      }),
    [employees, shiftFor],
  );
  const doctors = onShift.filter((e) => e.role === "صيدلاني");
  const assistants = onShift.filter((e) => e.role === "مساعد");
  const delivery = onShift.filter((e) => e.role === "توصيل");

  const vipCustomers = customers.filter((c) => c.type === "مهم جداً").length;
  const atRisk = customers.filter(
    (c) =>
      c.retention_status === "معرض للفقدان" || c.retention_status === "مفقود",
  ).length;
  const pendingOrders = orders.filter(
    (o) => o.status !== "تم التسليم" && o.status !== "مرتجع",
  ).length;

  const performanceTop = [...employees]
    .sort(
      (a, b) =>
        effectiveCyclePoints(b, pointRecords || [], cycle) -
        effectiveCyclePoints(a, pointRecords || [], cycle),
    )
    .slice(0, 5);

  // Calculate points statistics
  const totalPoints = employees.reduce(
    (sum, emp) => sum + effectiveCyclePoints(emp, pointRecords || [], cycle),
    0,
  );
  const avgPoints =
    employees.length > 0 ? Math.round(totalPoints / employees.length) : 0;
  const recentDeductions =
    pointRecords?.filter((r) => pointRecordDelta(r) < 0).slice(0, 5) || [];
  const recentBonuses =
    pointRecords?.filter((r) => pointRecordDelta(r) > 0).slice(0, 5) || [];
  const staffNameById = useMemo(() => {
    const byId = new Map<string, string>();
    employees.forEach((employee) => {
      if (employee.id && employee.name) byId.set(String(employee.id), employee.name);
    });
    return byId;
  }, [employees]);
  const staffNameByNormalizedName = useMemo(() => {
    const byName = new Map<string, string>();
    employees.forEach((employee) => {
      const key = normalizeStaffLedgerKey(employee.name);
      if (key && employee.name) byName.set(key, employee.name);
    });
    return byName;
  }, [employees]);
  const pointRecordEmployeeName = useCallback(
    (record: PointRecord) => {
      const directName = String(record.employee_name || "").trim();
      if (directName) return directName;
      const id = String(record.staff_id || record.employee_id || "").trim();
      if (id && staffNameById.has(id)) return staffNameById.get(id);
      const normalized = normalizeStaffLedgerKey(record.employee_name);
      if (normalized && staffNameByNormalizedName.has(normalized))
        return staffNameByNormalizedName.get(normalized);
      return "موظف غير محدد";
    },
    [staffNameById, staffNameByNormalizedName],
  );

  // Generate smart alerts
  const alerts = useMemo((): Alert[] => {
    const alertsList: Alert[] = [];

    // Low performance alert
    if (avgPoints < 400) {
      alertsList.push({
        id: "low-performance",
        type: "warning",
        title: "متوسط نقاط منخفض",
        message: `متوسط نقاط الفريق ${avgPoints} نقطة، يُنصح بمراجعة أداء الفريق`,
        time: new Date().toISOString(),
      });
    }

    // High pending orders alert
    if (pendingOrders > 10) {
      alertsList.push({
        id: "high-pending-orders",
        type: "error",
        title: "طلبات توصيل كثيرة",
        message: `${pendingOrders} طلب توصيل قيد التنفيذ، يُنصح بزيادة عدد موظفي التوصيل`,
        time: new Date().toISOString(),
      });
    }

    // Customer retention alert
    if (atRisk > 20) {
      alertsList.push({
        id: "customer-retention",
        type: "warning",
        title: "عملاء معرضون للفقدان",
        message: `${atRisk} عميل معرض للفقدان، يُنصح بالتواصل معهم`,
        time: new Date().toISOString(),
      });
    }

    // Staff shortage alert
    if (doctors.length < 2) {
      alertsList.push({
        id: "staff-shortage",
        type: "error",
        title: "نقص في الصيادلة",
        message: "عدد الصيادلة على الشيفت أقل من 2، يُنصح بمراجعة الجدول",
        time: new Date().toISOString(),
      });
    }

    // Positive alert
    if (growth > 10) {
      alertsList.push({
        id: "sales-growth",
        type: "success",
        title: "نمو المبيعات",
        message: `نمو المبيعات ${growth.toFixed(1)}% عن الأسبوع الماضي`,
        time: new Date().toISOString(),
      });
    }

    return alertsList.slice(0, 5);
  }, [avgPoints, pendingOrders, atRisk, doctors.length, growth]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white">
            أهلاً، {user?.name?.split(" ")[0]} 👋
          </h2>
          <p className="text-slate-400 text-sm mt-1">
            الدورة الشهرية: {cycle.label}
          </p>
        </div>
        <div className="flex items-center gap-3 bg-[#1B2B4B] border border-[#2d4063] rounded-2xl px-5 py-3">
          <div className="text-left">
            <div className="text-slate-400 text-xs">تقدم الدورة</div>
            <div className="text-white font-bold text-lg num">
              {Math.round(progress)}%
            </div>
          </div>
          <div className="w-px h-8 bg-[#2d4063]" />
          <div className="text-left">
            <div className="text-slate-400 text-xs">الأيام المتبقية</div>
            <div className="text-teal-400 font-bold text-lg num">
              {remaining}
            </div>
          </div>
          <div className="w-24 mr-2">
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="stat-card">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <label className="block text-xs text-slate-300 space-y-1">
            <span>بداية فترة التحليل</span>
            <input
              className="input-dark"
              type="date"
              value={periodStart}
              onChange={(event) => setPeriodStart(event.target.value)}
            />
          </label>
          <label className="block text-xs text-slate-300 space-y-1">
            <span>نهاية فترة التحليل</span>
            <input
              className="input-dark"
              type="date"
              value={periodEnd}
              onChange={(event) => setPeriodEnd(event.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary px-3 py-2 text-xs"
              onClick={() => applyPeriodCycle(cycleStart)}
            >
              الدورة الحالية
            </button>
            <button
              type="button"
              className="btn-secondary px-3 py-2 text-xs"
              onClick={applyPreviousPeriodCycle}
            >
              الدورة السابقة
            </button>
          </div>
        </div>
        <div className="mt-3 text-xs text-slate-400">
          المبيعات والرسم في اللوحة محسوبين من {periodStart} إلى {periodEnd}.
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={UserCheck}
          label="صيادلة الآن"
          value={doctors.length}
          sub="على الشيفت"
          color="teal"
        />
        <KpiCard
          icon={Users}
          label="مساعدون الآن"
          value={assistants.length}
          sub="على الشيفت"
          color="blue"
        />
        <KpiCard
          icon={Truck}
          label="توصيل الآن"
          value={delivery.length}
          sub={`${pendingOrders} طلبات قيد التنفيذ`}
          color="amber"
        />
        <KpiCard
          icon={Star}
          label="عملاء VIP"
          value={vipCustomers}
          sub={`${atRisk} معرضون للفقدان`}
          color="purple"
        />
      </div>

      {/* Smart Alerts Section */}
      {alerts.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="text-amber-400" size={18} />
            <h3 className="text-white font-semibold text-sm">تنبيهات ذكية</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className={`p-3 rounded-lg border ${
                  alert.type === "error"
                    ? "bg-red-500/10 border-red-500/20"
                    : alert.type === "warning"
                      ? "bg-amber-500/10 border-amber-500/20"
                      : alert.type === "success"
                        ? "bg-teal-500/10 border-teal-500/20"
                        : "bg-blue-500/10 border-blue-500/20"
                }`}
              >
                <div
                  className={`text-sm font-semibold mb-1 ${
                    alert.type === "error"
                      ? "text-red-400"
                      : alert.type === "warning"
                        ? "text-amber-400"
                        : alert.type === "success"
                          ? "text-teal-400"
                          : "text-blue-400"
                  }`}
                >
                  {alert.title}
                </div>
                <div className="text-slate-300 text-xs">{alert.message}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Points Performance Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-3">
            <Target className="text-teal-400" size={18} />
            <h3 className="text-white font-semibold text-sm">أداء النقاط</h3>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-slate-400 text-sm">متوسط النقاط</span>
              <span className="text-white font-bold num">{avgPoints}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400 text-sm">إجمالي النقاط</span>
              <span className="text-white font-bold num">{totalPoints}</span>
            </div>
            <div className="progress-bar mt-2">
              <div
                className="progress-fill"
                style={{ width: `${(avgPoints / INITIAL_POINTS) * 100}%` }}
              />
            </div>
            <div className="text-xs text-slate-400 mt-1">
              {Math.round((avgPoints / INITIAL_POINTS) * 100)}% من الهدف
            </div>
          </div>
        </div>

        <div className="stat-card">
          <div className="flex items-center gap-2 mb-3">
            <TrendingDown className="text-red-400" size={18} />
            <h3 className="text-white font-semibold text-sm">آخر الخصومات</h3>
          </div>
          <div className="space-y-2 max-h-32 overflow-y-auto">
            {recentDeductions.length === 0 ? (
              <div className="text-slate-400 text-xs text-center py-4">
                لا توجد خصومات حديثة
              </div>
            ) : (
              recentDeductions.map((record) => (
                <div
                  key={record.id}
                  className="flex justify-between items-center text-xs py-1 border-b border-[#2d4063]/30 last:border-0"
                >
                  <span className="text-slate-300 truncate flex-1">
                    {pointRecordEmployeeName(record)}
                  </span>
                  <span className="text-red-400 font-bold num">
                    -{Math.abs(pointRecordDelta(record))}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="stat-card">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="text-teal-400" size={18} />
            <h3 className="text-white font-semibold text-sm">آخر المكافآت</h3>
          </div>
          <div className="space-y-2 max-h-32 overflow-y-auto">
            {recentBonuses.length === 0 ? (
              <div className="text-slate-400 text-xs text-center py-4">
                لا توجد مكافآت حديثة
              </div>
            ) : (
              recentBonuses.map((record) => (
                <div
                  key={record.id}
                  className="flex justify-between items-center text-xs py-1 border-b border-[#2d4063]/30 last:border-0"
                >
                  <span className="text-slate-300 truncate flex-1">
                    {pointRecordEmployeeName(record)}
                  </span>
                  <span className="text-teal-400 font-bold num">
                    +{Math.abs(pointRecordDelta(record))}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-stretch">
        <div className="lg:col-span-2 stat-card flex flex-col min-h-[320px] order-1">
          <div className="section-title mb-1 text-base">
            الفريق النشط على الشيفت الآن
          </div>
          <p className="text-slate-500 text-xs mb-4">
            يُحسب من جدول الجدول الأسبوعي والوقت الحالي.
          </p>
          {onShift.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-slate-400 text-sm py-8">
              لا يوجد موظفون على الشيفت حالياً
            </div>
          ) : (
            <div className="space-y-3 flex-1 overflow-y-auto max-h-[360px] pr-1">
              {onShift.map((emp) => (
                <div
                  key={emp.id}
                  className="flex items-center gap-3 py-2 border-b border-[#2d4063]/40 last:border-0"
                >
                  <div className="w-11 h-11 rounded-full bg-teal-500/20 flex items-center justify-center text-teal-400 text-sm font-bold flex-shrink-0">
                    {emp.name[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-sm font-semibold truncate">
                      {emp.name}
                    </div>
                    <div className="text-slate-400 text-xs">
                      {emp.role} — {emp.branch}
                    </div>
                  </div>
                  <span className="badge-success text-[10px] shrink-0">
                    {shiftFor(emp)?.shift_start || "-"}–
                    {shiftFor(emp)?.shift_end || "-"}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 pt-4 border-t border-[#2d4063] grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-teal-400 font-bold text-xl">
                {doctors.length}
              </div>
              <div className="text-slate-400 text-xs">صيادلة</div>
            </div>
            <div>
              <div className="text-blue-400 font-bold text-xl">
                {assistants.length}
              </div>
              <div className="text-slate-400 text-xs">مساعدون</div>
            </div>
            <div>
              <div className="text-amber-400 font-bold text-xl">
                {delivery.length}
              </div>
              <div className="text-slate-400 text-xs">توصيل</div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-3 stat-card order-2 flex flex-col min-h-[320px]">
          <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
            <div>
              <div className="section-title">مبيعات يومية (فواتير مستوردة)</div>
              <div className="text-slate-500 text-[11px] mt-1 leading-relaxed max-w-xl">
                اليوم المحاسبي يبدأ 9 صباحًا: كل فاتورة قبل 9 تُحسب مع اليوم
                السابق. الشيفتات في التحليلات: صباحي {shiftBounds.morningStart}–
                {shiftBounds.morningEnd}، مسائي حتى {shiftBounds.eveningEnd}،
                ليلي حتى {shiftBounds.morningStart} (قابلة للتعديل من صفحة
                التحليلات).
              </div>
            </div>
            {growth !== null && (
              <div
                className={`flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-xl shrink-0 ${
                  growth >= 0
                    ? "text-teal-400 bg-teal-500/10"
                    : "text-amber-400 bg-amber-500/10"
                }`}
              >
                <ArrowUpRight
                  size={16}
                  className={growth < 0 ? "rotate-90" : ""}
                />
                <span>
                  {growth >= 0 ? "+" : ""}
                  {growth.toFixed(1)}%
                </span>
                <span className="text-slate-400 font-normal text-xs">
                  آخر يومين
                </span>
              </div>
            )}
          </div>
          <div className="text-2xl font-bold text-white num mb-2">
            {formatCurrency(periodSales)}
          </div>
          <div className="text-slate-400 text-xs mb-4">
            مجموع قيمة الفواتير في فترة {periodStart} إلى {periodEnd} ({invoiceRows.length} سجل)
          </div>

          {invoiceLoading ? (
            <div className="flex-1 flex items-center justify-center text-slate-400 text-sm py-12">
              جاري تحميل فواتير المبيعات...
            </div>
          ) : chartData.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-400 text-sm py-10 gap-2">
              <BarChart3 className="opacity-40" size={36} />
              لا توجد فواتير مبيعات في الفترة لعرض الرسم.
              <span className="text-xs text-slate-500">
                استورد ملف المبيعات اليومي من «استيراد الفواتير».
              </span>
            </div>
          ) : (
            <div className="flex-1 min-h-[200px]">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2d4063" />
                  <XAxis
                    dataKey="label"
                    tick={{
                      fill: "#6b7a99",
                      fontSize: 10,
                      fontFamily: "Cairo",
                    }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{
                      fill: "#6b7a99",
                      fontSize: 11,
                      fontFamily: "Cairo",
                    }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `${(Number(v) / 1000).toFixed(0)}K`}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#1B2B4B",
                      border: "1px solid #2d4063",
                      borderRadius: "12px",
                      fontFamily: "Cairo",
                    }}
                    labelStyle={{ color: "#fff", fontWeight: 600 }}
                    formatter={(v: number) => [formatCurrency(v), ""]}
                  />
                  <Bar
                    dataKey="shokry"
                    name="فرع شكري"
                    fill="#00C9A7"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="shamy"
                    name="فرع الشامي"
                    fill="#3b82f6"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
              <div className="flex gap-4 mt-2 justify-center flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-teal-500" />
                  <span className="text-slate-400 text-xs">فرع شكري</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-blue-500" />
                  <span className="text-slate-400 text-xs">فرع الشامي</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="stat-card">
          <div className="section-title mb-4">
            أفضل الموظفين — الدورة الحالية
          </div>
          {performanceTop.length === 0 ? (
            <div className="text-slate-400 text-sm py-4 text-center">
              لا توجد بيانات
            </div>
          ) : (
            <div className="space-y-3">
              {performanceTop.map((emp, i) => {
                const points = effectiveCyclePoints(
                  emp,
                  pointRecords || [],
                  cycle,
                );
                return (
                  <div key={emp.id} className="flex items-center gap-3">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                        i === 0
                          ? "bg-amber-500/20 text-amber-400"
                          : i === 1
                            ? "bg-slate-400/20 text-slate-300"
                            : i === 2
                              ? "bg-orange-600/20 text-orange-400"
                              : "bg-white/5 text-slate-400"
                      }`}
                    >
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-white text-xs font-medium truncate">
                          {emp.name}
                        </span>
                        <span className="text-teal-400 text-xs font-bold num">
                          {points}
                        </span>
                      </div>
                      <div className="progress-bar h-1.5">
                        <div
                          className="progress-fill"
                          style={{
                            width: `${percent(points, emp.max_points || 500)}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="stat-card">
          <div className="section-title mb-4">تنبيهات تحتاج اهتمام</div>
          <div className="space-y-3">
            {atRisk > 0 && (
              <AlertItem
                icon={AlertCircle}
                color="amber"
                title={`${atRisk} عملاء معرضون للفقدان`}
                sub="يحتاجون متابعة عاجلة من خدمة العملاء"
              />
            )}
            {pendingOrders > 0 && (
              <AlertItem
                icon={Truck}
                color="teal"
                title={`${pendingOrders} طلبات توصيل قيد التنفيذ`}
                sub="تتابع حالة الطلبات من قسم التوصيل"
              />
            )}
            <AlertItem
              icon={Clock}
              color="blue"
              title={`${remaining} يوم على انتهاء الدورة الشهرية`}
              sub={`الدورة الحالية: ${cycle.shortLabel}`}
            />
            <AlertItem
              icon={Star}
              color="purple"
              title="تذكير نقاط الموظفين"
              sub="راجع تقارير النقاط قبل نهاية الدورة"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  sub: string;
  color: string;
}) {
  const colors: Record<string, string> = {
    teal: "bg-teal-500/15 text-teal-400",
    blue: "bg-blue-500/15 text-blue-400",
    amber: "bg-amber-500/15 text-amber-400",
    purple: "bg-purple-500/15 text-purple-400",
  };
  return (
    <div className="stat-card card-glow">
      <div
        className={`w-10 h-10 rounded-xl flex items-center justify-center ${colors[color]}`}
      >
        <Icon size={20} />
      </div>
      <div className="mt-3">
        <div className="text-3xl font-bold text-white num">{value}</div>
        <div className="text-slate-300 text-sm font-medium mt-0.5">{label}</div>
        <div className="text-slate-400 text-xs mt-0.5">{sub}</div>
      </div>
    </div>
  );
}

function AlertItem({
  icon: Icon,
  color,
  title,
  sub,
}: {
  icon: React.ElementType;
  color: string;
  title: string;
  sub: string;
}) {
  const colors: Record<string, string> = {
    amber: "bg-amber-500/10 text-amber-400",
    teal: "bg-teal-500/10 text-teal-400",
    blue: "bg-blue-500/10 text-blue-400",
    purple: "bg-purple-500/10 text-purple-400",
  };
  return (
    <div className="flex items-start gap-3 p-3 rounded-xl bg-white/3 border border-white/5">
      <div
        className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${colors[color]}`}
      >
        <Icon size={16} />
      </div>
      <div>
        <div className="text-white text-xs font-medium">{title}</div>
        <div className="text-slate-400 text-xs mt-0.5">{sub}</div>
      </div>
    </div>
  );
}
