import { useEffect, useMemo, useState } from 'react';
import {
  Wallet,
  TrendingUp,
  AlertCircle,
  Users,
  Package,
  DollarSign,
  Calendar,
  Clock,
  FileText,
  ClipboardList,
  ClipboardCheck,
  Star,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useDoctorPermissions } from '@/hooks/useDoctorPermissions';
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery';
import { supabase } from '@/lib/supabase';
import { TABLES } from '@/lib/supabaseTables';
import { formatCurrency, toNumber } from '@/lib/utils';
import { isActiveStaffFilter } from '@/lib/staffActiveFilter';
import { getCurrentCycle, formatCycleDate } from '@/lib/pharmacy-cycle';
import { pointRecordDelta } from '@/lib/pointsLedger';
import {
  canViewAllBranches,
  canViewBranchData,
  isManagerRole,
  rowMatchesCurrentDoctor,
  rowMatchesCurrentUserScope,
} from '@/lib/security/userDataScope';
import { normalizeRole } from '@/lib/core/permissionSystem';
import {
  calculateIncentive,
  POINT_VALUE_EGP,
  STARTING_POINTS,
  MAX_BASE_INCENTIVE,
} from '@/lib/points';
import {
  calculateStaffCycleIncentiveFromRows,
  getStaffCycleIncentive,
  type StaffCycleIncentive,
} from '@/lib/staffIncentiveService';
import StaffOperatingPolicy from '@/components/incentives/StaffOperatingPolicy';
import { toast } from 'sonner';
import { usePendingShiftNotesCount } from '@/hooks/usePendingShiftNotesCount';
import { useNotifications } from '@/hooks/useNotifications';
import {
  completeTask,
  fetchEmployeeTasks,
  type EmployeeDailyTask,
} from '@/lib/employeeDailyTasks';
import { loadSalesAnalyticsSummary } from '@/lib/salesAnalyticsSummaryService';
import { getDoctorCompetitionMetrics } from '@/lib/doctorCompetitionMetrics';
import { TABLES as SUPABASE_TABLES } from '@/lib/supabaseTables';

interface DoctorMetrics {
  id: string;
  doctor_id: string;
  doctor_name: string;
  branch: string;
  metric_date: string;
  daily_sales: number;
  monthly_sales: number;
  daily_invoice_count: number;
  monthly_invoice_count: number;
  points_balance: number;
  rewards_balance: number;
  discount_balance: number;
  customers_to_contact: number;
}

interface StagnantMedicine {
  id: string;
  medicine_name: string;
  usage: string;
  expiry_date: string;
  quantity_available: number;
  branch: string;
  priority: string;
  notes: string;
}

interface IncentiveMedicine {
  id: string;
  product_name: string;
  incentive_value: number;
  current_quantity: number;
  branch: string;
  active: boolean;
}

interface Customer {
  id: string;
  customer_code?: string;
  name: string;
  phone: string;
  branch?: string | null;
  customer_notes?: string;
  retention_status?: string;
}

interface PointRecordRow {
  id: string;
  staff_id?: string | null;
  employee_id?: string | null;
  employee_name?: string | null;
  type: string | null;
  points: number | null;
  points_delta?: number | null;
  status?: string | null;
  manager_note?: string | null;
  month_cycle?: string | null;
  created_at?: string | null;
}

interface StaffOption {
  id: string;
  name: string;
  role: string;
  branch: string;
  points?: number | null;
  max_points?: number | null;
}

function canInspectTeam(role?: string) {
  return ['general_manager', 'executive_manager', 'branches_manager', 'branch_manager'].includes(normalizeRole(role));
}

function openMonthlyPdfReport(
  staffName: string,
  staffRole: string,
  branch: string,
  cycleLabel: string,
  points: number,
  rewards: number,
  deductions: number
) {
  const incentive = calculateIncentive(points);
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) return;
  win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8" />
    <title>تقرير شهري - ${staffName}</title>
    <style>
      body{font-family:Arial,Tahoma,sans-serif;margin:32px;color:#102033;direction:rtl}
      h1{margin:0 0 8px;font-size:24px}.muted{color:#667085}.box{border:1px solid #d8dee8;border-radius:12px;padding:18px;margin:14px 0}
      table{width:100%;border-collapse:collapse}th,td{border:1px solid #d8dee8;padding:10px;text-align:right}th{background:#eef5f8}.num{font-weight:700;font-size:20px}
      button{padding:10px 18px;border:0;border-radius:8px;background:#00c9a7;color:white;font-weight:700;cursor:pointer}@media print{button{display:none}}
    </style></head><body>
    <button onclick="window.print()">طباعة / حفظ PDF</button>
    <h1>صيدليات دواء - تقرير التقييم الشهري</h1><div class="muted">الدورة: ${cycleLabel}</div>
    <div class="box"><h2>بيانات الموظف</h2><table>
      <tr><th>الاسم</th><td>${staffName}</td></tr><tr><th>الدور</th><td>${staffRole}</td></tr><tr><th>الفرع</th><td>${branch}</td></tr>
    </table></div>
    <div class="box"><h2>ملخص النقاط والحافز</h2><table>
      <tr><th>النقاط النهائية</th><td class="num">${points} / ${STARTING_POINTS}</td></tr>
      <tr><th>المكافآت</th><td>${rewards} نقطة</td></tr>
      <tr><th>الخصومات</th><td>${deductions} نقطة</td></tr>
      <tr><th>الحافز المستحق</th><td class="num">${incentive.toLocaleString('ar-EG')} جنيه</td></tr>
    </table></div>
    <p class="muted">الحافز الكامل ${MAX_BASE_INCENTIVE.toLocaleString('ar-EG')} جنيه عند ${STARTING_POINTS} نقطة، وقيمة النقطة ${POINT_VALUE_EGP} جنيه.</p>
    </body></html>`);
  win.document.close();
}

export default function DoctorDashboard() {
  const { user } = useAuth();
  const { permissions } = useDoctorPermissions();
  const cycle = getCurrentCycle();
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const isManagerView = isManagerRole(user) || canInspectTeam(user?.role);
  const isDoctorOnlyView = normalizeRole(user?.role) === 'pharmacist' && !isManagerView;

  const { data: staffOptions } = useSupabaseQuery<StaffOption>({
    table: 'staff',
    filters: isActiveStaffFilter(),
    orderBy: { column: 'name', ascending: true },
    realtimeEnabled: true,
  });

  const scopedStaffOptions = useMemo(() => {
    if (canViewAllBranches(user)) return staffOptions;
    return staffOptions.filter((item) => rowMatchesCurrentUserScope(user, item as unknown as Record<string, unknown>));
  }, [staffOptions, user]);

  const selectedStaff = useMemo(() => {
    if (!isManagerView)
      return (
        scopedStaffOptions.find((item) => item.id === (user?.staffId || user?.id)) ||
        scopedStaffOptions.find((item) => item.name === user?.name) ||
        null
      );
    return (
      scopedStaffOptions.find((item) => item.id === selectedStaffId) ||
      scopedStaffOptions.find((item) => normalizeRole(item.role) === 'pharmacist') ||
      scopedStaffOptions[0] ||
      null
    );
  }, [isManagerView, scopedStaffOptions, selectedStaffId, user?.id, user?.name, user?.staffId]);

  useEffect(() => {
    if (!isManagerView) {
      setSelectedStaffId(user?.staffId || user?.id || '');
      return;
    }
    if (selectedStaffId && scopedStaffOptions.some((item) => item.id === selectedStaffId)) return;
    setSelectedStaffId(scopedStaffOptions[0]?.id || '');
  }, [isManagerView, scopedStaffOptions, selectedStaffId, user?.id, user?.staffId]);

  const effectiveId = selectedStaff?.id || user?.staffId || user?.id || '';
  const effectiveName = selectedStaff?.name || user?.name || '';
  const effectiveBranch = selectedStaff?.branch || user?.branch || '';
  const canReadSelectedStaff =
    canViewAllBranches(user) ||
    (isDoctorOnlyView
      ? rowMatchesCurrentDoctor(user, {
          staff_id: effectiveId,
          employee_id: effectiveId,
          staff_name: effectiveName,
          employee_name: effectiveName,
          branch: effectiveBranch,
        })
      : canViewBranchData(user, effectiveBranch));

  const {
    data: metrics,
    loading: metricsLoading,
    error: metricsError,
    refetch: refetchMetrics,
  } = useSupabaseQuery<DoctorMetrics>({
    table: 'doctor_metrics',
    filters: [{ column: 'doctor_id', operator: 'eq', value: effectiveId }],
    orderBy: { column: 'metric_date', ascending: false },
    realtimeEnabled: true,
  });

  const { data: stagnantMedicines } = useSupabaseQuery<StagnantMedicine>({
    table: 'stagnant_medicines',
    filters: [{ column: 'branch', operator: 'eq', value: effectiveBranch }],
    orderBy: { column: 'priority', ascending: false },
    realtimeEnabled: true,
  });

  const { data: incentiveMedicines } = useSupabaseQuery<IncentiveMedicine>({
    table: 'incentive_medicines',
    filters: [
      { column: 'branch', operator: 'eq', value: effectiveBranch },
      { column: 'active', operator: 'eq', value: true },
    ],
    realtimeEnabled: true,
  });

  const { data: customers } = useSupabaseQuery<Customer>({
    table: 'customers',
    filters: [{ column: 'retention_status', operator: 'in', value: ['معرض للفقدان', 'مفقود'] }],
    orderBy: { column: 'retention_status', ascending: false },
    realtimeEnabled: true,
  });

  const todayMetrics = metrics?.find((m) => m.metric_date === selectedDate) || metrics?.[0];
  const scopedCustomers = useMemo(
    () =>
      (customers || []).filter(
        (row) =>
          canViewAllBranches(user) ||
          canViewBranchData(user, row.branch) ||
          rowMatchesCurrentDoctor(user, row as unknown as Record<string, unknown>)
      ),
    [customers, user]
  );
  const totalIncentive =
    incentiveMedicines?.reduce((sum, m) => sum + m.incentive_value * m.current_quantity, 0) || 0;

  // Calculate points, rewards, and discounts from employee_transactions
  const { data: pointRecords } = useSupabaseQuery<PointRecordRow>({
    table: TABLES.employeeTransactions,
    orderBy: { column: 'created_at', ascending: false },
    limit: 2000,
    realtimeEnabled: true,
  });

  // استخدام calculateStaffCycleIncentiveFromRows مع البيانات المحلية للتوافق مع useSupabaseQuery
  // في المستقبل يمكن استخدام getStaffCycleIncentive لجمع من جميع المصادر
  const incentiveSummary = useMemo(
    () =>
      calculateStaffCycleIncentiveFromRows({
        staff: selectedStaff || {
          id: effectiveId,
          name: effectiveName,
          points: null,
          max_points: STARTING_POINTS,
        },
        records: pointRecords || [],
        cycle,
      }),
    [cycle, effectiveId, effectiveName, pointRecords, selectedStaff]
  );

  const pointsBalance = incentiveSummary.finalPoints;
  const rewardsBalance = incentiveSummary.approvedRewardPoints;
  const discountBalance = incentiveSummary.approvedDeductionPoints;
  const expectedIncentive = calculateIncentive(pointsBalance);
  const pendingShiftNotes = usePendingShiftNotesCount();
  const {
    notifications,
    loading: notificationsLoading,
    available: notificationsAvailable,
    handleNotificationClick,
  } = useNotifications();
  const latestNotifications = notifications.slice(0, 5);
  const todayIso = new Date().toISOString().slice(0, 10);

  const [todayTasks, setTodayTasks] = useState<EmployeeDailyTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [todayShift, setTodayShift] = useState<Record<string, unknown> | null>(null);
  const [shiftLoading, setShiftLoading] = useState(false);
  const [shiftError, setShiftError] = useState<string | null>(null);
  const [salesSummary, setSalesSummary] = useState<{
    dailySales: number;
    cycleSales: number;
    invoices: number;
    avgInvoice: number;
    branchAvg: number;
  } | null>(null);
  const [salesError, setSalesError] = useState<string | null>(null);
  const [branchRank, setBranchRank] = useState<number | null>(null);
  const [rankError, setRankError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadTasks() {
      if (!effectiveId) return;
      setTasksLoading(true);
      setTasksError(null);
      const result = await fetchEmployeeTasks({
        date: todayIso,
        staffId: effectiveId,
        user,
      });
      if (cancelled) return;
      setTasksLoading(false);
      if (result.error) setTasksError(result.error);
      setTodayTasks(result.tasks);
    }
    void loadTasks();
    return () => {
      cancelled = true;
    };
  }, [effectiveId, todayIso, user]);

  useEffect(() => {
    let cancelled = false;
    async function loadShift() {
      if (!effectiveId) return;
      setShiftLoading(true);
      setShiftError(null);
      const { data, error } = await supabase
        .from(SUPABASE_TABLES.shiftSchedules)
        .select('*')
        .eq('staff_id', effectiveId)
        .eq('shift_date', todayIso)
        .limit(1);
      if (cancelled) return;
      setShiftLoading(false);
      if (error) {
        setShiftError('تعذر تحميل بيانات الشيفت');
        setTodayShift(null);
        return;
      }
      setTodayShift((data || [])[0] || null);
    }
    void loadShift();
    return () => {
      cancelled = true;
    };
  }, [effectiveId, todayIso]);

  useEffect(() => {
    let cancelled = false;
    async function loadSales() {
      if (!effectiveName) return;
      setSalesError(null);
      try {
        const summary = await loadSalesAnalyticsSummary({
          startDate: formatCycleDate(cycle.start),
          endDate: formatCycleDate(cycle.end),
          branch: effectiveBranch || undefined,
          doctor: effectiveName,
        });
        const todaySummary = await loadSalesAnalyticsSummary({
          startDate: todayIso,
          endDate: todayIso,
          branch: effectiveBranch || undefined,
          doctor: effectiveName,
        });
        if (cancelled) return;
        const doctorRow = summary.doctorRows.find(
          (row) => row.doctor === effectiveName || row.staffId === effectiveId
        );
        const branchAvg =
          summary.branchRows.find((row) => row.branch === effectiveBranch)?.avgInvoice || 0;
        setSalesSummary({
          dailySales: todaySummary.kpis.netSales,
          cycleSales: doctorRow?.netSales || summary.kpis.netSales,
          invoices: doctorRow?.invoicesCount || summary.kpis.invoicesCount,
          avgInvoice: doctorRow?.avgInvoice || summary.kpis.avgInvoice,
          branchAvg,
        });
      } catch {
        if (!cancelled) setSalesError('تعذر تحميل بيانات المبيعات');
      }
    }
    void loadSales();
    return () => {
      cancelled = true;
    };
  }, [cycle.end, cycle.start, effectiveBranch, effectiveId, effectiveName, todayIso]);

  useEffect(() => {
    let cancelled = false;
    async function loadRank() {
      if (!effectiveName || !effectiveBranch) return;
      setRankError(null);
      try {
        const metricsResult = await getDoctorCompetitionMetrics({
          period: 'cycle',
          branch: effectiveBranch,
          userBranch: user?.branch,
          canSeeAllBranches: canViewAllBranches(user),
        });
        if (cancelled) return;
        const sorted = [...metricsResult.rows].sort((a, b) => b.overallScore - a.overallScore);
        const index = sorted.findIndex((row) => row.staffId === effectiveId || row.name === effectiveName);
        setBranchRank(index >= 0 ? index + 1 : null);
        if (index < 0 && !isManagerView) {
          setRankError('تعذر تحديد ترتيبك داخل الفرع حالياً');
        }
      } catch {
        if (!cancelled) setRankError('تعذر تحميل ترتيب المسابقة');
      }
    }
    void loadRank();
    return () => {
      cancelled = true;
    };
  }, [effectiveBranch, effectiveId, effectiveName, isManagerView, user]);

  const taskSummary = useMemo(() => {
    return {
      total: todayTasks.length,
      late: todayTasks.filter((task) => task.status === 'late').length,
      high: todayTasks.filter((task) => task.priority === 'high' || task.priority === 'urgent').length,
      completed: todayTasks.filter((task) => task.status === 'completed').length,
      needsIntervention: todayTasks.filter((task) => task.status === 'late' || task.priority === 'urgent').length,
    };
  }, [todayTasks]);

  async function handleCompleteTask(taskId: string) {
    const result = await completeTask(taskId, undefined, user || undefined);
    if (!result.ok) {
      toast.error(result.error || 'تعذر إتمام المهمة');
      return;
    }
    setTodayTasks((prev) =>
      prev.map((task) => (task.id === taskId ? { ...task, status: 'completed' } : task))
    );
  }

  if (!permissions?.can_view_dashboard) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <AlertCircle className="mx-auto mb-4 text-amber-400" size={48} />
          <div className="text-white text-lg font-bold">ليس لديك صلاحية للوصول إلى هذه الصفحة</div>
        </div>
      </div>
    );
  }

  if (!canReadSelectedStaff) {
    return (
      <div className="stat-card py-16 text-center">
        <AlertCircle className="mx-auto mb-4 text-amber-400" size={48} />
        <div className="text-lg font-black text-white">لا يمكن عرض بيانات هذا الموظف</div>
        <div className="mt-2 text-sm text-slate-400">
          الدكتور يرى بياناته فقط، ومدير الفرع يرى بيانات فرعه فقط.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-teal-400/20 bg-[#10213a] p-5">
        <h1 className="text-2xl font-black text-white">أهلًا د/ {effectiveName || user?.name}</h1>
        <div className="mt-2 grid gap-2 text-sm text-slate-300 md:grid-cols-2 lg:grid-cols-3">
          <div>الفرع: {effectiveBranch || user?.branch || '—'}</div>
          <div>الدورة الحالية: {cycle.label}</div>
          <div>نقاطك الحالية: {metricsLoading || metricsError ? '—' : `${pointsBalance} نقطة`}</div>
          <div>حافزك المتوقع: {metricsLoading || metricsError ? '—' : formatCurrency(expectedIncentive)}</div>
          <div>
            ترتيبك داخل الفرع:{' '}
            {rankError ? '—' : branchRank != null ? `#${branchRank}` : metricsLoading ? '...' : '—'}
          </div>
        </div>
        {rankError && <div className="mt-3 text-sm text-amber-300">{rankError}</div>}
      </div>

      {metricsError && (
        <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-red-200">
          تعذر تحميل البيانات
        </div>
      )}

      <div className="stat-card">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-white font-bold">
            <AlertCircle size={18} className="text-teal-400" />
            آخر التنبيهات
          </div>
          <span className="rounded-full bg-white/10 px-2 py-1 text-xs text-slate-300">
            {latestNotifications.length}
          </span>
        </div>
        {notificationsLoading ? (
          <div className="text-sm text-slate-400">جاري تحميل التنبيهات...</div>
        ) : !notificationsAvailable ? (
          <div className="text-sm text-amber-300">تعذر الاتصال بمصدر التنبيهات، وسيستمر التطبيق في العمل.</div>
        ) : latestNotifications.length === 0 ? (
          <div className="text-sm text-slate-400">لا توجد تنبيهات جديدة ضمن صلاحياتك.</div>
        ) : (
          <div className="space-y-2">
            {latestNotifications.map((notification) => (
              <button
                key={notification.id}
                type="button"
                onClick={() => handleNotificationClick(notification)}
                className="w-full rounded-xl border border-white/10 bg-white/5 p-3 text-right hover:bg-white/10"
              >
                <div className="font-bold text-white">{notification.title || notification.type || 'تنبيه'}</div>
                <div className="mt-1 line-clamp-2 text-xs text-slate-400">
                  {notification.body || notification.message || 'لا توجد تفاصيل إضافية'}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard icon={DollarSign} label="مبيعاتي اليوم" value={salesError || !salesSummary ? '—' : formatCurrency(salesSummary.dailySales)} sub="" color="teal" textValue />
        <MetricCard icon={FileText} label="فواتيري اليوم" value={salesError || !salesSummary ? '—' : String(todayMetrics?.daily_invoice_count ?? salesSummary.invoices)} sub="" color="green" textValue />
        <MetricCard icon={TrendingUp} label="متوسط الفاتورة" value={salesError || !salesSummary ? '—' : formatCurrency(salesSummary.avgInvoice)} sub="" color="teal" textValue />
        <MetricCard icon={Wallet} label="مبيعات الدورة" value={salesError || !salesSummary ? '—' : formatCurrency(salesSummary.cycleSales)} sub={cycle.label} color="green" textValue />
        <MetricCard icon={Star} label="نقاطي الحالية" value={metricsError ? '—' : pointsBalance} sub={`/ ${STARTING_POINTS}`} color="teal" />
        <MetricCard icon={Wallet} label="حافزي المتوقع" value={metricsError ? '—' : formatCurrency(expectedIncentive)} sub={`سقف ${MAX_BASE_INCENTIVE} ج`} color="green" textValue />
        <MetricCard icon={ClipboardCheck} label="ملاحظات الشيفت المفتوحة" value={pendingShiftNotes ?? '—'} sub="مفتوحة" color="red" textValue />
      </div>

      <div className="stat-card">
        <div className="mb-3 flex items-center gap-2 text-white font-bold">
          <Clock size={18} className="text-teal-400" />
          شيفتي اليوم
        </div>
        {shiftLoading ? (
          <div className="text-slate-400 text-sm">جاري التحميل...</div>
        ) : shiftError ? (
          <div className="text-red-300 text-sm">{shiftError}</div>
        ) : todayShift ? (
          <div className="grid gap-2 text-sm text-slate-300 md:grid-cols-4">
            <div>الشيفت: {String(todayShift.shift_type || todayShift.shift_name || '—')}</div>
            <div>وقت البداية: {String(todayShift.start_time || todayShift.shift_start || '—')}</div>
            <div>وقت النهاية: {String(todayShift.end_time || todayShift.shift_end || '—')}</div>
            <div>
              هل اليوم إجازة:{' '}
              {todayShift.is_off || todayShift.status === 'off' || todayShift.shift_type === 'إجازة'
                ? 'نعم'
                : 'لا'}
            </div>
          </div>
        ) : (
          <div className="text-slate-400 text-sm">لا يوجد شيفت مسجل لك اليوم</div>
        )}
      </div>

      <div className="stat-card">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-white font-bold">
            <ClipboardList size={18} className="text-teal-400" />
            مهامي اليوم
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-white/10 px-2 py-1">اليوم: {taskSummary.total}</span>
            <span className="rounded-full bg-amber-500/20 px-2 py-1 text-amber-200">متأخر: {taskSummary.late}</span>
            <span className="rounded-full bg-red-500/20 px-2 py-1 text-red-200">عالي الأولوية: {taskSummary.high}</span>
            <span className="rounded-full bg-green-500/20 px-2 py-1 text-green-200">مكتمل: {taskSummary.completed}</span>
            <span className="rounded-full bg-orange-500/20 px-2 py-1 text-orange-200">يحتاج تدخل: {taskSummary.needsIntervention}</span>
          </div>
        </div>
        {tasksLoading ? (
          <div className="text-slate-400 text-sm">جاري تحميل المهام...</div>
        ) : tasksError ? (
          <div className="text-red-300 text-sm">{tasksError}</div>
        ) : todayTasks.length === 0 ? (
          <div className="text-slate-400 text-sm">لا توجد مهام مسجلة لك اليوم</div>
        ) : (
          <div className="space-y-2">
            {todayTasks.map((task) => (
              <div key={task.id} className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="font-bold text-white">{task.task_title}</div>
                  <div className="text-xs text-slate-400">
                    {task.branch || effectiveBranch} • {task.priority} • {task.status}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {task.status !== 'completed' && (
                    <button type="button" className="btn-primary text-xs" onClick={() => void handleCompleteTask(task.id)}>
                      تم
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white">لوحة تحكم الدكتور</h2>
          <p className="text-slate-400 text-sm mt-1">
            عرض تقييم ومبيعات وحوافز {effectiveName || user?.name} —{' '}
            {effectiveBranch || user?.branch}
          </p>
        </div>
        <div className="flex flex-col md:flex-row gap-2">
          {isManagerView && (
            <select
              value={selectedStaff?.id || ''}
              onChange={(e) => setSelectedStaffId(e.target.value)}
              className="input-dark md:w-72"
            >
          {scopedStaffOptions
                .filter((item) => ['pharmacist', 'delivery', 'assistant'].includes(normalizeRole(item.role)))
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} - {item.role} - {item.branch}
                  </option>
                ))}
            </select>
          )}
          <div className="flex items-center gap-2 bg-[#1B2B4B] border border-[#2d4063] rounded-xl px-4 py-2">
            <Calendar size={18} className="text-teal-400" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-transparent text-white text-sm focus:outline-none"
            />
          </div>
          <button
            type="button"
            className="btn-secondary flex items-center justify-center gap-2"
            onClick={() =>
              openMonthlyPdfReport(
                effectiveName || 'موظف',
                selectedStaff?.role || user?.role || '',
                effectiveBranch || '',
                cycle.label,
                pointsBalance,
                rewardsBalance,
                discountBalance
              )
            }
          >
            <FileText size={16} /> تقرير PDF شهري
          </button>
        </div>
      </div>

      <StaffOperatingPolicy />

      {/* Points, Rewards, and Discounts Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard
          icon={Wallet}
          label="رصيد النقاط"
          value={pointsBalance}
          sub={`/ ${STARTING_POINTS}`}
          color="teal"
        />
        <MetricCard
          icon={TrendingUp}
          label="رصيد المكافآت"
          value={rewardsBalance}
          sub="نقطة"
          color="green"
        />
        <MetricCard
          icon={AlertCircle}
          label="رصيد الخصم"
          value={discountBalance}
          sub="نقطة"
          color="red"
        />
      </div>

      {/* Sales Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="stat-card">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-blue-500/15 flex items-center justify-center text-blue-400">
              <DollarSign size={20} />
            </div>
            <div>
              <div className="text-white font-bold">المبيعات</div>
              <div className="text-slate-400 text-xs">الدورة الحالية</div>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-slate-400 text-sm">مبيعات اليوم</span>
              <span className="text-white font-bold num">
                {formatCurrency(todayMetrics?.daily_sales || 0)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400 text-sm">مبيعات الشهر</span>
              <span className="text-white font-bold num">
                {formatCurrency(todayMetrics?.monthly_sales || 0)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400 text-sm">فواتير اليوم</span>
              <span className="text-white font-bold num">
                {todayMetrics?.daily_invoice_count || 0}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400 text-sm">فواتير الشهر</span>
              <span className="text-white font-bold num">
                {todayMetrics?.monthly_invoice_count || 0}
              </span>
            </div>
          </div>
        </div>

        <div className="stat-card">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-purple-500/15 flex items-center justify-center text-purple-400">
              <Users size={20} />
            </div>
            <div>
              <div className="text-white font-bold">العملاء</div>
              <div className="text-slate-400 text-xs">يحتاجون متابعة</div>
            </div>
          </div>
          <div className="text-3xl font-bold text-white num mb-2">{scopedCustomers.length}</div>
          <div className="text-slate-400 text-xs">عملاء معرضون للفقدان أو مفقودون</div>
        </div>
      </div>

      {/* Stagnant Medicines */}
      {permissions?.can_view_stagnant_medicines && (
        <div className="stat-card">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center text-amber-400">
              <Package size={20} />
            </div>
            <div>
              <div className="text-white font-bold">الأدوية الرواكد</div>
              <div className="text-slate-400 text-xs">مطلوب التركيز عليها</div>
            </div>
          </div>
          {stagnantMedicines && stagnantMedicines.length > 0 ? (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {stagnantMedicines.map((med) => (
                <div
                  key={med.id}
                  className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/5"
                >
                  <div className="flex-1">
                    <div className="text-white font-medium text-sm">{med.medicine_name}</div>
                    <div className="text-slate-400 text-xs">
                      {med.usage} • ينتهي {med.expiry_date}
                    </div>
                  </div>
                  <div className="text-left">
                    <div className="text-amber-400 font-bold num">{med.quantity_available}</div>
                    <div className="text-slate-400 text-xs">متاح</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-slate-400 text-sm py-4 text-center">
              لا توجد أدوية رواكد حالياً
            </div>
          )}
        </div>
      )}

      {/* Incentive Medicines */}
      {permissions?.can_view_incentive_medicines && (
        <div className="stat-card">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-green-500/15 flex items-center justify-center text-green-400">
              <TrendingUp size={20} />
            </div>
            <div>
              <div className="text-white font-bold">أدوية الحوافز</div>
              <div className="text-slate-400 text-xs">مكافأة على البيع</div>
            </div>
          </div>
          {incentiveMedicines && incentiveMedicines.length > 0 ? (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {incentiveMedicines.map((med) => (
                <div
                  key={med.id}
                  className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/5"
                >
                  <div className="flex-1">
                    <div className="text-white font-medium text-sm">{med.product_name}</div>
                    <div className="text-slate-400 text-xs">{med.current_quantity} متاح</div>
                  </div>
                  <div className="text-left">
                    <div className="text-green-400 font-bold num">
                      {formatCurrency(med.incentive_value)}
                    </div>
                    <div className="text-slate-400 text-xs">حافز/علبة</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-slate-400 text-sm py-4 text-center">
              لا توجد أدوية حوافز حالياً
            </div>
          )}
        </div>
      )}

      {/* Customers to Contact */}
      <div className="stat-card">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-blue-500/15 flex items-center justify-center text-blue-400">
            <Users size={20} />
          </div>
          <div>
            <div className="text-white font-bold">العملاء الذين يحتاجون متابعة</div>
            <div className="text-slate-400 text-xs">مع ملاحظات مهمة</div>
          </div>
        </div>
        {scopedCustomers.length > 0 ? (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {scopedCustomers.slice(0, 10).map((customer) => (
              <div key={customer.id} className="p-3 bg-white/5 rounded-lg border border-white/5">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-white font-medium text-sm">{customer.name}</div>
                  <div className="text-slate-400 text-xs">{customer.customer_code || '—'}</div>
                </div>
                <div className="text-slate-400 text-xs mb-1">{customer.phone}</div>
                {customer.customer_notes && (
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded p-2 mt-2">
                    <div className="text-amber-200 text-xs">{customer.customer_notes}</div>
                  </div>
                )}
                <div className="mt-2">
                  <span
                    className={`text-xs px-2 py-1 rounded ${
                      customer.retention_status === 'معرض للفقدان'
                        ? 'bg-amber-500/20 text-amber-400'
                        : 'bg-red-500/20 text-red-400'
                    }`}
                  >
                    {customer.retention_status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-slate-400 text-sm py-4 text-center">
            لا يوجد عملاء يحتاجون متابعة حالياً
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
  textValue = false,
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  sub: string;
  color: string;
  textValue?: boolean;
}) {
  const colors: Record<string, string> = {
    teal: 'bg-teal-500/15 text-teal-400',
    green: 'bg-green-500/15 text-green-400',
    red: 'bg-red-500/15 text-red-400',
  };
  return (
    <div className="stat-card">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${colors[color]}`}>
        <Icon size={20} />
      </div>
      <div className="mt-3">
        <div className={`font-bold text-white ${textValue ? 'text-lg' : 'text-3xl num'}`}>{value}</div>
        <div className="text-slate-300 text-sm font-medium mt-0.5">{label}</div>
        {sub ? <div className="text-slate-400 text-xs mt-0.5">{sub}</div> : null}
      </div>
    </div>
  );
}
