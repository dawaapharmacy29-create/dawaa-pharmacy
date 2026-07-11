import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Award,
  BarChart3,
  Bell,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Clock,
  DollarSign,
  FileText,
  GraduationCap,
  HeartHandshake,
  Package,
  RefreshCw,
  ShieldCheck,
  Star,
  Target,
  TrendingUp,
  UserRound,
  Users,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useDoctorPermissions } from '@/hooks/useDoctorPermissions';
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery';
import { supabase } from '@/lib/supabase';
import { TABLES } from '@/lib/supabaseTables';
import { isActiveStaffFilter } from '@/lib/staffActiveFilter';
import { getCurrentCycle, formatCycleDate } from '@/lib/pharmacy-cycle';
import { formatCurrency } from '@/lib/utils';
import { normalizeRole } from '@/lib/core/permissionSystem';
import { calculateIncentive, MAX_BASE_INCENTIVE, STARTING_POINTS } from '@/lib/points';
import { calculateStaffCycleIncentiveFromRows } from '@/lib/staffIncentiveService';
import {
  canViewAllBranches,
  canViewBranchData,
  isManagerRole,
  rowMatchesCurrentDoctor,
  rowMatchesCurrentUserScope,
} from '@/lib/security/userDataScope';
import { usePendingShiftNotesCount } from '@/hooks/usePendingShiftNotesCount';
import { useNotifications } from '@/hooks/useNotifications';
import { completeTask, fetchEmployeeTasks, type EmployeeDailyTask } from '@/lib/employeeDailyTasks';
import { loadSalesAnalyticsSummary } from '@/lib/salesAnalyticsSummaryService';
import { getDoctorCompetitionMetrics } from '@/lib/doctorCompetitionMetrics';
import StaffOperatingPolicy from '@/components/incentives/StaffOperatingPolicy';

type LoadStatus = 'loading' | 'success' | 'empty' | 'error';

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

interface StaffOption {
  id: string;
  name: string;
  role: string;
  branch: string;
  points?: number | null;
  max_points?: number | null;
}

interface Customer {
  id: string;
  customer_code?: string;
  name: string;
  phone: string;
  branch?: string | null;
  customer_notes?: string;
  retention_status?: string;
  total_spent?: number | null;
  avg_monthly?: number | null;
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

interface StagnantMedicine {
  id: string;
  medicine_name: string;
  usage?: string | null;
  expiry_date?: string | null;
  quantity_available?: number | null;
  branch?: string | null;
  priority?: string | null;
}

interface IncentiveMedicine {
  id: string;
  product_name: string;
  incentive_value: number;
  current_quantity: number;
  branch: string;
  active: boolean;
}

function canInspectTeam(role?: string) {
  return ['general_manager', 'executive_manager', 'branches_manager', 'branch_manager', 'customer_service_manager'].includes(
    normalizeRole(role)
  );
}

function safeNumber(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function nowLabel() {
  return new Date().toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'صباح الخير';
  if (hour < 18) return 'نهارك سعيد';
  return 'مساء الخير';
}

function shiftWindowLabel(shift?: Record<string, unknown> | null) {
  if (!shift) return 'غير مسجل حتى الآن';
  const start = String(shift.start_time || shift.shift_start || '—');
  const end = String(shift.end_time || shift.shift_end || '—');
  return `${start} → ${end}`;
}

function shiftTypeLabel(shift?: Record<string, unknown> | null) {
  return String(shift?.shift_type || shift?.shift_name || shift?.type || 'غير محدد');
}

function actionHrefForTask(task?: EmployeeDailyTask | null) {
  if (!task) return '/doctor-dashboard';
  const title = `${task.task_title || ''} ${task.task_type || ''}`;
  if (/عميل|متابعة|customer|follow/i.test(title)) return '/customer-service';
  if (/طلب|صنف|order|request/i.test(title)) return '/customer-requests';
  if (/تقييم|review/i.test(title)) return '/reviews';
  if (/شيفت|shift/i.test(title)) return '/shift-notes';
  return '/doctor-dashboard';
}

export default function DoctorDashboard() {
  const { user } = useAuth();
  const { permissions } = useDoctorPermissions();
  const cycle = getCurrentCycle();
  const todayIso = new Date().toISOString().slice(0, 10);
  const [selectedDate, setSelectedDate] = useState(todayIso);
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [lastRefresh, setLastRefresh] = useState(nowLabel());
  const isManagerView = isManagerRole(user) || canInspectTeam(user?.role);
  const isDoctorOnlyView = normalizeRole(user?.role) === 'pharmacist' && !isManagerView;

  const { data: staffOptions, loading: staffLoading } = useSupabaseQuery<StaffOption>({
    table: 'staff',
    filters: isActiveStaffFilter(),
    orderBy: { column: 'name', ascending: true },
    realtimeEnabled: true,
  });

  const scopedStaffOptions = useMemo(() => {
    if (canViewAllBranches(user)) return staffOptions || [];
    return (staffOptions || []).filter((item) => rowMatchesCurrentUserScope(user, item as unknown as Record<string, unknown>));
  }, [staffOptions, user]);

  const selectedStaff = useMemo(() => {
    if (!isManagerView) {
      return (
        scopedStaffOptions.find((item) => item.id === (user?.staffId || user?.id)) ||
        scopedStaffOptions.find((item) => item.name === user?.name) ||
        null
      );
    }
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
  const effectiveRole = selectedStaff?.role || user?.role || '';
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

  const { data: customers, loading: customersLoading } = useSupabaseQuery<Customer>({
    table: 'customers',
    filters: [{ column: 'retention_status', operator: 'in', value: ['معرض للفقدان', 'مفقود'] }],
    orderBy: { column: 'retention_status', ascending: false },
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

  const { data: pointRecords, loading: pointsLoading } = useSupabaseQuery<PointRecordRow>({
    table: TABLES.employeeTransactions,
    orderBy: { column: 'created_at', ascending: false },
    limit: 2000,
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
  const pointsToFull = Math.max(0, STARTING_POINTS - pointsBalance);
  const pendingShiftNotes = usePendingShiftNotesCount();
  const { notifications, loading: notificationsLoading, available: notificationsAvailable, handleNotificationClick } = useNotifications();
  const latestNotifications = notifications.slice(0, 5);

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
  const [salesLoading, setSalesLoading] = useState(false);
  const [branchRank, setBranchRank] = useState<number | null>(null);
  const [rankError, setRankError] = useState<string | null>(null);

  async function reloadAll() {
    setLastRefresh(nowLabel());
    refetchMetrics?.();
    toast.success('تم طلب تحديث بيانات لوحة الدكتور');
  }

  useEffect(() => {
    let cancelled = false;
    async function loadTasks() {
      if (!effectiveId) return;
      setTasksLoading(true);
      setTasksError(null);
      const result = await fetchEmployeeTasks({ date: todayIso, staffId: effectiveId, user });
      if (cancelled) return;
      setTasksLoading(false);
      if (result.error) setTasksError(result.error);
      setTodayTasks(result.tasks || []);
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
        .from('shift_schedules')
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
      setSalesLoading(true);
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
        const doctorRow = summary.doctorRows.find((row) => row.doctor === effectiveName || row.staffId === effectiveId);
        const branchAvg = summary.branchRows.find((row) => row.branch === effectiveBranch)?.avgInvoice || 0;
        setSalesSummary({
          dailySales: todaySummary.kpis.netSales,
          cycleSales: doctorRow?.netSales || summary.kpis.netSales,
          invoices: doctorRow?.invoicesCount || summary.kpis.invoicesCount,
          avgInvoice: doctorRow?.avgInvoice || summary.kpis.avgInvoice,
          branchAvg,
        });
      } catch {
        if (!cancelled) setSalesError('تعذر تحميل بيانات المبيعات');
      } finally {
        if (!cancelled) setSalesLoading(false);
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
      } catch {
        if (!cancelled) setRankError('تعذر تحميل ترتيب المسابقة');
      }
    }
    void loadRank();
    return () => {
      cancelled = true;
    };
  }, [effectiveBranch, effectiveId, effectiveName, user]);

  const taskSummary = useMemo(
    () => ({
      total: todayTasks.length,
      late: todayTasks.filter((task) => task.status === 'late').length,
      high: todayTasks.filter((task) => task.priority === 'high' || task.priority === 'urgent').length,
      completed: todayTasks.filter((task) => task.status === 'completed').length,
      remaining: todayTasks.filter((task) => task.status !== 'completed').length,
    }),
    [todayTasks]
  );

  const mainTask = useMemo(() => {
    return (
      todayTasks.find((task) => task.status === 'late' || task.priority === 'urgent') ||
      todayTasks.find((task) => task.status !== 'completed') ||
      null
    );
  }, [todayTasks]);

  const dashboardInsights = useMemo(() => {
    const list: Array<{ title: string; detail: string; href: string; tone: 'red' | 'amber' | 'teal' | 'green' }> = [];
    if (mainTask) {
      list.push({ title: 'أهم إجراء الآن', detail: mainTask.task_title, href: actionHrefForTask(mainTask), tone: mainTask.status === 'late' ? 'red' : 'amber' });
    } else {
      list.push({ title: 'أهم إجراء الآن', detail: 'لا توجد مهمة عاجلة حاليًا، راجع فرص المتابعة والعملاء المعرضين للفقدان.', href: '/customer-service', tone: 'green' });
    }
    if (scopedCustomers.length) {
      list.push({ title: 'فرصة استرجاع عملاء', detail: `${scopedCustomers.length} عميل معرض للفقدان أو مفقود يحتاج اهتمامًا ودلعًا من صيدليات دواء.`, href: '/customer-service', tone: 'teal' });
    }
    if (pointsToFull > 0) {
      list.push({ title: 'أقرب فرصة للحافز', detail: `متبقي ${pointsToFull} نقطة للوصول إلى ${STARTING_POINTS} نقطة. ركّز على المتابعات وتقييمات المحادثات الإيجابية.`, href: '/doctor-dashboard', tone: 'amber' });
    }
    if (salesSummary && salesSummary.branchAvg > 0 && salesSummary.avgInvoice < salesSummary.branchAvg) {
      list.push({ title: 'تحسين متوسط الفاتورة', detail: 'متوسط فاتورتك أقل من متوسط الفرع. استخدم الترشيح المكمل المناسب بدون ضغط على العميل.', href: '/doctor-dashboard', tone: 'amber' });
    }
    return list;
  }, [mainTask, pointsToFull, salesSummary, scopedCustomers.length]);

  async function handleCompleteTask(taskId: string) {
    const result = await completeTask(taskId, undefined, user || undefined);
    if (!result.ok) {
      toast.error(result.error || 'تعذر إتمام المهمة');
      return;
    }
    setTodayTasks((prev) => prev.map((task) => (task.id === taskId ? { ...task, status: 'completed' } : task)));
  }

  if (!permissions?.can_view_dashboard) {
    return <BlockedState text="ليس لديك صلاحية للوصول إلى هذه الصفحة" />;
  }

  if (!canReadSelectedStaff) {
    return <BlockedState text="لا يمكن عرض بيانات هذا الموظف. الدكتور يرى بياناته فقط، ومدير الفرع يرى بيانات فرعه فقط." />;
  }

  const salesStatus: LoadStatus = salesLoading ? 'loading' : salesError ? 'error' : salesSummary ? 'success' : 'empty';
  const metricsStatus: LoadStatus = metricsLoading ? 'loading' : metricsError ? 'error' : todayMetrics ? 'success' : 'empty';
  const taskStatus: LoadStatus = tasksLoading ? 'loading' : tasksError ? 'error' : todayTasks.length ? 'success' : 'empty';
  const pointsStatus: LoadStatus = pointsLoading ? 'loading' : 'success';
  const shiftStatus: LoadStatus = shiftLoading ? 'loading' : shiftError ? 'error' : todayShift ? 'success' : 'empty';

  return (
    <div className="space-y-6" dir="rtl">
      <section className="rounded-3xl border border-teal-400/25 bg-gradient-to-l from-[#0d1c33] via-[#10213a] to-[#0f3140] p-5 shadow-xl">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl border border-teal-300/30 bg-teal-400/15 text-2xl font-black text-teal-100">
              {effectiveName ? effectiveName.replace(/^د\.?\s*/i, '').slice(0, 1) : <UserRound />}
            </div>
            <div>
              <div className="text-xs font-black text-teal-200">لوحة أداء الدكتور</div>
              <h1 className="mt-1 text-2xl font-black text-white">
                {greeting()} يا دكتور {effectiveName || user?.name || '—'}
              </h1>
              <p className="mt-2 text-sm font-bold text-slate-300">
                شيفتك اليوم: {shiftTypeLabel(todayShift)} — {effectiveBranch || user?.branch || 'غير محدد'} — {shiftWindowLabel(todayShift)}
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-slate-200">
                <Pill>الدور: {effectiveRole || '—'}</Pill>
                <Pill>الفرع الأساسي: {effectiveBranch || '—'}</Pill>
                <Pill>الحضور: {todayShift ? 'شيفت مسجل' : 'غير مؤكد'}</Pill>
                <Pill>آخر تحديث: {lastRefresh}</Pill>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {isManagerView && (
              <select value={selectedStaff?.id || ''} onChange={(event) => setSelectedStaffId(event.target.value)} className="input-dark min-w-72">
                {scopedStaffOptions
                  .filter((item) => ['pharmacist', 'shift_supervisor_morning', 'shift_supervisor_evening', 'assistant'].includes(normalizeRole(item.role)))
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} — {item.branch} — {item.role}
                    </option>
                  ))}
              </select>
            )}
            <button type="button" className="btn-secondary flex items-center gap-2" onClick={() => void reloadAll()}>
              <RefreshCw size={16} /> تحديث
            </button>
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
              <Calendar size={16} className="text-teal-200" />
              <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="bg-transparent text-sm text-white outline-none" />
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,.85fr)]">
        <ActionNowCard task={mainTask} loading={tasksLoading} />
        <div className="grid gap-3 sm:grid-cols-2">
          {dashboardInsights.slice(0, 4).map((item) => (
            <InsightCard key={item.title} {...item} />
          ))}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={DollarSign} label="مبيعاتي اليوم" value={salesSummary ? formatCurrency(salesSummary.dailySales) : '—'} status={salesStatus} sub="لا تظهر أصفارًا أثناء التحميل" />
        <MetricCard icon={FileText} label="عدد الفواتير" value={salesSummary ? salesSummary.invoices.toLocaleString('ar-EG') : '—'} status={salesStatus} sub="الدورة الحالية" />
        <MetricCard icon={TrendingUp} label="متوسط الفاتورة" value={salesSummary ? formatCurrency(salesSummary.avgInvoice) : '—'} status={salesStatus} sub={salesSummary?.branchAvg ? `متوسط الفرع ${formatCurrency(salesSummary.branchAvg)}` : 'مقارنة الفرع عند توفرها'} />
        <MetricCard icon={Target} label="مبيعات الدورة" value={salesSummary ? formatCurrency(salesSummary.cycleSales) : '—'} status={salesStatus} sub={cycle.label} />
        <MetricCard icon={ClipboardList} label="مهامي اليوم" value={taskSummary.total.toLocaleString('ar-EG')} status={taskStatus} sub={`متبقي ${taskSummary.remaining} · متأخر ${taskSummary.late}`} />
        <MetricCard icon={Star} label="نقاطي الحالية" value={pointsBalance.toLocaleString('ar-EG')} status={pointsStatus} sub={`من ${STARTING_POINTS} نقطة`} />
        <MetricCard icon={Wallet} label="حافزي المتوقع" value={formatCurrency(expectedIncentive)} status={pointsStatus} sub={`تقديري حتى اعتماد الدورة · سقف ${MAX_BASE_INCENTIVE} ج`} />
        <MetricCard icon={Bell} label="تنبيهات وملاحظات" value={(latestNotifications.length + safeNumber(pendingShiftNotes)).toLocaleString('ar-EG')} status={notificationsLoading ? 'loading' : 'success'} sub="تنبيهات + ملاحظات شيفت" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,.8fr)]">
        <SectionCard icon={ClipboardCheck} title="المطلوب مني اليوم" subtitle="مرتب حسب العاجل والمتأخر والمهم">
          <StateLine status={taskStatus} error={tasksError} empty="تم إنجاز جميع مهام اليوم أو لا توجد مهام مسجلة." />
          {!!todayTasks.length && (
            <div className="mt-3 space-y-2">
              {todayTasks.slice(0, 8).map((task) => (
                <div key={task.id} className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/5 p-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="font-bold text-white">{task.task_title}</div>
                    <div className="mt-1 text-xs text-slate-400">
                      {task.branch || effectiveBranch} · {task.priority || 'عادي'} · {task.status || 'مفتوح'}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <a className="btn-secondary px-3 py-2 text-xs" href={actionHrefForTask(task)}>تنفيذ</a>
                    {task.status !== 'completed' && (
                      <button type="button" className="btn-primary px-3 py-2 text-xs" onClick={() => void handleCompleteTask(task.id)}>
                        تم
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard icon={Clock} title="الحضور وجدول الشيفت" subtitle="الشيفت الحالي والتغطيات">
          <StateLine status={shiftStatus} error={shiftError} empty="لا يوجد شيفت مسجل لك اليوم." />
          {todayShift && (
            <div className="mt-3 grid gap-2 text-sm font-bold text-slate-200">
              <InfoRow label="الشيفت" value={shiftTypeLabel(todayShift)} />
              <InfoRow label="الوقت" value={shiftWindowLabel(todayShift)} />
              <InfoRow label="الفرع" value={String(todayShift.branch || effectiveBranch || '—')} />
              <InfoRow label="نوع اليوم" value={todayShift.is_off || todayShift.status === 'off' ? 'إجازة' : 'عمل'} />
            </div>
          )}
        </SectionCard>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <SectionCard icon={Users} title="طلبات ومتابعات العملاء" subtitle="عملاء معرضون للفقدان أو يحتاجون دلع واسترجاع">
          <StateLine status={customersLoading ? 'loading' : scopedCustomers.length ? 'success' : 'empty'} empty="لا توجد طلبات أو عملاء معرضون للفقدان ضمن نطاقك حاليًا." />
          <div className="mt-3 space-y-2">
            {scopedCustomers.slice(0, 6).map((customer) => (
              <div key={customer.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-black text-white">{customer.name}</div>
                  <Pill>{customer.retention_status || 'متابعة'}</Pill>
                </div>
                <div className="mt-1 text-xs text-slate-400">{customer.customer_code || 'بدون كود'} · {customer.phone || 'بدون رقم'} · {customer.branch || effectiveBranch}</div>
                {customer.customer_notes && <div className="mt-2 rounded-xl border border-amber-400/20 bg-amber-500/10 p-2 text-xs font-bold text-amber-100">{customer.customer_notes}</div>}
              </div>
            ))}
          </div>
          <a className="btn-primary mt-3 block text-center" href="/customer-service">فتح مركز خدمة العملاء</a>
        </SectionCard>

        <SectionCard icon={HeartHandshake} title="تقييمات محادثاتي" subtitle="اطلاع وتحسين وليس خصومات فقط">
          <div className="space-y-2 text-sm font-bold text-slate-300">
            <p>سيظهر هنا متوسط التقييمات، نقاط القوة، أكثر الأخطاء تكرارًا، والرد الصحيح المقترح عند اكتمال ربط التقييمات بـ staff_id.</p>
            <p className="rounded-xl border border-teal-400/20 bg-teal-500/10 p-3 text-teal-100">المرحلة الحالية تعرض مدخلًا مباشرًا للتقييمات مع الحفاظ على عدم تعديل الدكتور للتقييم.</p>
          </div>
          <a className="btn-secondary mt-3 block text-center" href="/reviews">فتح تقييمات المحادثات</a>
        </SectionCard>

        <SectionCard icon={ShieldCheck} title="حوافزي ونقاطي" subtitle="شفافية الحركة والخصم والتعويض">
          <div className="grid gap-2 text-sm font-bold text-slate-200">
            <InfoRow label="النقاط الحالية" value={`${pointsBalance} / ${STARTING_POINTS}`} />
            <InfoRow label="المكافآت" value={`${rewardsBalance} نقطة`} />
            <InfoRow label="الخصومات" value={`${discountBalance} نقطة`} />
            <InfoRow label="الحافز المتوقع" value={formatCurrency(expectedIncentive)} />
            <InfoRow label="للمستوى الكامل" value={pointsToFull ? `${pointsToFull} نقطة متبقية` : 'مكتمل'} />
          </div>
          <p className="mt-3 rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-3 text-xs font-bold text-emerald-100">
            يمكن تعويض الخصم بعد 3 محادثات إيجابية متتالية وفق سياسة الإدارة، والحافز الحالي تقديري حتى اعتماد الدورة.
          </p>
        </SectionCard>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <SectionCard icon={BarChart3} title="مبيعاتي وأهدافي" subtitle="الدورة الشهرية من 26 إلى 25">
          <div className="grid gap-2 text-sm font-bold text-slate-200">
            <InfoRow label="مبيعات اليوم" value={salesSummary ? formatCurrency(salesSummary.dailySales) : '—'} />
            <InfoRow label="مبيعات الدورة" value={salesSummary ? formatCurrency(salesSummary.cycleSales) : '—'} />
            <InfoRow label="متوسط الفاتورة" value={salesSummary ? formatCurrency(salesSummary.avgInvoice) : '—'} />
            <InfoRow label="متوسط الفرع" value={salesSummary?.branchAvg ? formatCurrency(salesSummary.branchAvg) : 'غير كافٍ'} />
            <InfoRow label="ترتيبي في الفرع" value={rankError ? 'غير متاح' : branchRank ? `#${branchRank}` : 'قيد الحساب'} />
          </div>
        </SectionCard>

        <SectionCard icon={Package} title="فرص البيع المعتمدة" subtitle="رواكد وحوافز بدون ضغط على العميل">
          <div className="space-y-2">
            {(stagnantMedicines || []).slice(0, 3).map((item) => (
              <InfoRow key={item.id} label={item.medicine_name} value={`${item.quantity_available || 0} متاح`} />
            ))}
            {(incentiveMedicines || []).slice(0, 3).map((item) => (
              <InfoRow key={item.id} label={item.product_name} value={`${formatCurrency(item.incentive_value)} / علبة`} />
            ))}
            {!(stagnantMedicines || []).length && !(incentiveMedicines || []).length && <StateLine status="empty" empty="لا توجد فرص معتمدة حاليًا." />}
          </div>
        </SectionCard>

        <SectionCard icon={GraduationCap} title="تطوير أدائي" subtitle="تدريب مقترح حسب مؤشراتك">
          <div className="space-y-2 text-sm font-bold text-slate-200">
            <TrainingItem title="تسجيل طلب العميل بصورة صحيحة" reason="مهم لمنع ضياع العملاء والوعود غير المسجلة" />
            <TrainingItem title="التعامل مع تأخير الأوردر" reason="إبلاغ العميل والاعتذار والمتابعة أهم من سبب التأخير نفسه" />
            <TrainingItem title="رفع متوسط الفاتورة بدون ضغط" reason="ترشيح مكمل مناسب حسب احتياج العميل فقط" />
          </div>
        </SectionCard>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,.8fr)]">
        <SectionCard icon={Award} title="إنجازاتي والتقدير الإيجابي" subtitle="التطبيق يساعد الدكتور ويحفزه، وليس أداة رقابة فقط">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <BadgeCard title="متابعات اليوم" value={`${taskSummary.completed}/${taskSummary.total}`} />
            <BadgeCard title="الالتزام بالنقاط" value={`${pointsBalance} نقطة`} />
            <BadgeCard title="مسابقة الفرع" value={branchRank ? `المركز #${branchRank}` : 'قيد الحساب'} />
            <BadgeCard title="استرجاع العملاء" value={`${scopedCustomers.length} فرصة`} />
            <BadgeCard title="ملاحظات الشيفت" value={`${pendingShiftNotes ?? 0} مفتوحة`} />
            <BadgeCard title="الحافز المتوقع" value={formatCurrency(expectedIncentive)} />
          </div>
        </SectionCard>

        <SectionCard icon={FileText} title="ملخص وتسليم الشيفت" subtitle="مراجعة قبل نهاية الشيفت">
          <div className="space-y-2 text-xs font-bold text-slate-300">
            <Checklist ok={taskSummary.remaining === 0} label="لا توجد مهام غير مكتملة" />
            <Checklist ok={scopedCustomers.length === 0} label="لا توجد متابعات عملاء معرضة للفقدان" />
            <Checklist ok={!pendingShiftNotes} label="لا توجد ملاحظات شيفت مفتوحة" />
            <Checklist ok={!!todayShift} label="الشيفت مسجل ومحدد" />
          </div>
          <button type="button" className="btn-secondary mt-3 w-full" onClick={() => toast.info('سيتم ربط تأكيد تسليم الشيفت بحفظ رسمي في المرحلة التالية')}>
            مراجعة تسليم الشيفت
          </button>
        </SectionCard>
      </section>

      <SectionCard icon={Bell} title="آخر التنبيهات" subtitle="تنبيهات مهمة فقط وبروابط مباشرة">
        {notificationsLoading ? (
          <StateLine status="loading" />
        ) : !notificationsAvailable ? (
          <StateLine status="error" error="تعذر الاتصال بمصدر التنبيهات، وسيستمر التطبيق في العمل." />
        ) : latestNotifications.length === 0 ? (
          <StateLine status="empty" empty="لا توجد تنبيهات جديدة ضمن صلاحياتك." />
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {latestNotifications.map((notification) => (
              <button key={notification.id} type="button" onClick={() => handleNotificationClick(notification)} className="rounded-2xl border border-white/10 bg-white/5 p-3 text-right hover:bg-white/10">
                <div className="font-bold text-white">{notification.title || notification.type || 'تنبيه'}</div>
                <div className="mt-1 line-clamp-2 text-xs text-slate-400">{notification.body || notification.message || 'لا توجد تفاصيل إضافية'}</div>
              </button>
            ))}
          </div>
        )}
      </SectionCard>

      <StaffOperatingPolicy />
    </div>
  );
}

function BlockedState({ text }: { text: string }) {
  return (
    <div className="flex min-h-[400px] items-center justify-center">
      <div className="rounded-3xl border border-amber-400/25 bg-amber-500/10 p-8 text-center">
        <AlertCircle className="mx-auto mb-4 text-amber-300" size={48} />
        <div className="text-lg font-bold text-white">{text}</div>
      </div>
    </div>
  );
}

function SectionCard({ icon: Icon, title, subtitle, children }: { icon: React.ElementType; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-white/10 bg-[#10213a] p-4 shadow-lg">
      <div className="mb-3 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-teal-400/15 text-teal-200">
          <Icon size={20} />
        </div>
        <div>
          <h2 className="font-black text-white">{title}</h2>
          {subtitle && <p className="mt-1 text-xs font-bold text-slate-400">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function MetricCard({ icon: Icon, label, value, sub, status }: { icon: React.ElementType; label: string; value: string | number; sub?: string; status: LoadStatus }) {
  const statusText = status === 'loading' ? 'جاري التحميل...' : status === 'error' ? 'تعذر التحميل' : status === 'empty' ? 'لا توجد بيانات كافية' : sub;
  return (
    <div className="rounded-3xl border border-white/10 bg-[#10213a] p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-teal-400/15 text-teal-200"><Icon size={20} /></div>
        <span className={`rounded-full px-2 py-1 text-[11px] font-black ${status === 'error' ? 'bg-red-500/15 text-red-200' : status === 'loading' ? 'bg-amber-500/15 text-amber-200' : 'bg-emerald-500/15 text-emerald-200'}`}>
          {status === 'success' ? 'محدث' : status === 'loading' ? 'تحميل' : status === 'empty' ? 'فارغ' : 'خطأ'}
        </span>
      </div>
      <div className="mt-3 text-2xl font-black text-white">{status === 'loading' ? '—' : value}</div>
      <div className="mt-1 text-sm font-bold text-slate-300">{label}</div>
      {statusText && <div className="mt-1 text-xs font-bold text-slate-500">{statusText}</div>}
    </div>
  );
}

function ActionNowCard({ task, loading }: { task: EmployeeDailyTask | null; loading: boolean }) {
  if (loading) {
    return (
      <section className="rounded-3xl border border-amber-400/25 bg-amber-500/10 p-5">
        <div className="font-black text-white">أهم إجراء الآن</div>
        <div className="mt-2 text-sm text-amber-100">جاري تحميل المهام العاجلة...</div>
      </section>
    );
  }
  const href = actionHrefForTask(task);
  return (
    <section className="rounded-3xl border border-red-400/25 bg-gradient-to-l from-red-500/15 to-amber-500/10 p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-xs font-black text-red-200">أهم إجراء الآن</div>
          <h2 className="mt-1 text-xl font-black text-white">{task ? task.task_title : 'لا توجد مهمة عاجلة حاليًا'}</h2>
          <p className="mt-2 text-sm font-bold text-slate-300">
            {task ? `الأولوية: ${task.priority || 'عادي'} · الحالة: ${task.status || 'مفتوح'}` : 'راجع العملاء المعرضين للفقدان وفرص تحسين الأداء.'}
          </p>
        </div>
        <a className="btn-primary whitespace-nowrap text-center" href={href}>{task ? 'تنفيذ المهمة' : 'فتح خدمة العملاء'}</a>
      </div>
    </section>
  );
}

function InsightCard({ title, detail, href, tone }: { title: string; detail: string; href: string; tone: 'red' | 'amber' | 'teal' | 'green' }) {
  const toneClass = tone === 'red' ? 'border-red-400/25 bg-red-500/10' : tone === 'amber' ? 'border-amber-400/25 bg-amber-500/10' : tone === 'green' ? 'border-emerald-400/25 bg-emerald-500/10' : 'border-teal-400/25 bg-teal-500/10';
  return (
    <a href={href} className={`rounded-3xl border p-4 transition hover:brightness-110 ${toneClass}`}>
      <div className="font-black text-white">{title}</div>
      <p className="mt-2 text-xs font-bold leading-6 text-slate-200">{detail}</p>
    </a>
  );
}

function StateLine({ status, error, empty }: { status: LoadStatus; error?: string | null; empty?: string }) {
  if (status === 'loading') return <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 p-3 text-sm font-bold text-amber-100">جاري التحميل...</div>;
  if (status === 'error') return <div className="rounded-2xl border border-red-400/20 bg-red-500/10 p-3 text-sm font-bold text-red-100">{error || 'تعذر تحميل هذا القسم'}</div>;
  if (status === 'empty') return <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm font-bold text-slate-400">{empty || 'لا توجد بيانات كافية حاليًا.'}</div>;
  return null;
}

function InfoRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold">
      <span className="text-slate-400">{label}</span>
      <span className="text-white">{value}</span>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">{children}</span>;
}

function TrainingItem({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <div className="font-black text-white">{title}</div>
      <div className="mt-1 text-xs text-slate-400">سبب الترشيح: {reason}</div>
      <button type="button" className="btn-secondary mt-2 px-3 py-2 text-xs" onClick={() => toast.info('سيتم فتح التدريب التفاعلي في المرحلة التالية')}>
        ابدأ تدريبًا قصيرًا
      </button>
    </div>
  );
}

function BadgeCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-2xl border border-teal-400/20 bg-teal-500/10 p-3">
      <div className="text-xs font-bold text-teal-100">{title}</div>
      <div className="mt-1 text-lg font-black text-white">{value}</div>
    </div>
  );
}

function Checklist({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={`rounded-xl border px-3 py-2 ${ok ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100' : 'border-amber-400/25 bg-amber-500/10 text-amber-100'}`}>
      {ok ? '✓' : '•'} {label}
    </div>
  );
}
