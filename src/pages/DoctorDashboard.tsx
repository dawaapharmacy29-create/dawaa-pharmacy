import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Award,
  BarChart3,
  Bell,
  BookOpenCheck,
  Calendar,
  ClipboardList,
  FileText,
  GraduationCap,
  HeartHandshake,
  MessageSquareText,
  Package,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
  TrendingDown,
  TrendingUp,
  UserRound,
  Users,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useDoctorPermissions } from '@/hooks/useDoctorPermissions';
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery';
import { TABLES } from '@/lib/supabaseTables';
import { isActiveStaffFilter } from '@/lib/staffActiveFilter';
import { formatCycleDate, getCurrentCycle, getCycleForDate, type PharmacyCycle } from '@/lib/pharmacy-cycle';
import { formatCurrency } from '@/lib/utils';
import { normalizeRole } from '@/lib/core/permissionSystem';
import { calculateIncentive, MAX_BASE_INCENTIVE, STARTING_POINTS } from '@/lib/points';
import { calculateStaffCycleIncentiveFromRows } from '@/lib/staffIncentiveService';
import { canViewAllBranches, canViewBranchData, isManagerRole, rowMatchesCurrentDoctor, rowMatchesCurrentUserScope } from '@/lib/security/userDataScope';
import { usePendingShiftNotesCount } from '@/hooks/usePendingShiftNotesCount';
import { useNotifications } from '@/hooks/useNotifications';
import { loadSalesAnalyticsSummary } from '@/lib/salesAnalyticsSummaryService';
import QuickFollowupModal from '@/components/common/QuickFollowupModal';
import StaffOperatingPolicy from '@/components/incentives/StaffOperatingPolicy';

type LoadStatus = 'loading' | 'success' | 'empty' | 'error';

type StaffOption = {
  id: string;
  name: string;
  role: string;
  branch: string;
  points?: number | null;
  max_points?: number | null;
};

type PointRecordRow = {
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
};

type StagnantMedicine = {
  id: string;
  medicine_name: string;
  usage?: string | null;
  expiry_date?: string | null;
  quantity_available?: number | null;
  branch?: string | null;
  priority?: string | null;
};

type IncentiveMedicine = {
  id: string;
  product_name: string;
  incentive_value: number;
  current_quantity: number;
  branch: string;
  active: boolean;
};

type DoctorSalesSnapshot = {
  cycleSales: number;
  dailySales: number;
  invoices: number;
  avgInvoice: number;
  branchAvg: number;
  previousComparableSales: number;
  averageLastThreeComparableSales: number;
  growthVsPrevious: number | null;
  growthVsAverage: number | null;
  branchRank: number | null;
  branchDoctorsCount: number;
  gapToFirst: number;
};

function canInspectTeam(role?: string) {
  return ['general_manager', 'executive_manager', 'branches_manager', 'branch_manager', 'customer_service_manager'].includes(normalizeRole(role));
}

function previousCycle(cycle: PharmacyCycle) {
  const date = new Date(cycle.start);
  date.setDate(date.getDate() - 1);
  return getCycleForDate(date);
}

function comparableEnd(cycle: PharmacyCycle, elapsedDays: number) {
  const date = new Date(cycle.start);
  date.setDate(date.getDate() + Math.max(0, elapsedDays - 1));
  if (date > cycle.end) return formatCycleDate(cycle.end);
  return formatCycleDate(date);
}

function percentChange(current: number, previous: number) {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'صباح الخير';
  if (hour < 18) return 'نهارك سعيد';
  return 'مساء الخير';
}

export default function DoctorDashboard() {
  const { user } = useAuth();
  const { permissions } = useDoctorPermissions();
  const cycle = getCurrentCycle();
  const todayIso = new Date().toISOString().slice(0, 10);
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [sales, setSales] = useState<DoctorSalesSnapshot | null>(null);
  const [salesLoading, setSalesLoading] = useState(false);
  const [salesError, setSalesError] = useState<string | null>(null);
  const [followupOpen, setFollowupOpen] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(new Date().toLocaleString('ar-EG'));
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
      return scopedStaffOptions.find((item) => item.id === (user?.staffId || user?.id)) || scopedStaffOptions.find((item) => item.name === user?.name) || null;
    }
    return scopedStaffOptions.find((item) => item.id === selectedStaffId) || scopedStaffOptions.find((item) => normalizeRole(item.role) === 'pharmacist') || scopedStaffOptions[0] || null;
  }, [isManagerView, scopedStaffOptions, selectedStaffId, user?.id, user?.name, user?.staffId]);

  useEffect(() => {
    if (!isManagerView) {
      setSelectedStaffId(user?.staffId || user?.id || '');
      return;
    }
    if (selectedStaffId && scopedStaffOptions.some((item) => item.id === selectedStaffId)) return;
    setSelectedStaffId(scopedStaffOptions.find((item) => normalizeRole(item.role) === 'pharmacist')?.id || scopedStaffOptions[0]?.id || '');
  }, [isManagerView, scopedStaffOptions, selectedStaffId, user?.id, user?.staffId]);

  const effectiveId = selectedStaff?.id || user?.staffId || user?.id || '';
  const effectiveName = selectedStaff?.name || user?.name || '';
  const effectiveRole = selectedStaff?.role || user?.role || '';
  const effectiveBranch = selectedStaff?.branch || user?.branch || '';
  const canReadSelectedStaff = canViewAllBranches(user) || (isDoctorOnlyView ? rowMatchesCurrentDoctor(user, {
    staff_id: effectiveId,
    employee_id: effectiveId,
    staff_name: effectiveName,
    employee_name: effectiveName,
    branch: effectiveBranch,
  }) : canViewBranchData(user, effectiveBranch));

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

  const incentiveSummary = useMemo(() => calculateStaffCycleIncentiveFromRows({
    staff: selectedStaff || { id: effectiveId, name: effectiveName, points: null, max_points: STARTING_POINTS },
    records: pointRecords || [],
    cycle,
  }), [cycle, effectiveId, effectiveName, pointRecords, selectedStaff]);

  const pointsBalance = incentiveSummary.finalPoints;
  const rewardsBalance = incentiveSummary.approvedRewardPoints;
  const discountBalance = incentiveSummary.approvedDeductionPoints;
  const expectedIncentive = calculateIncentive(pointsBalance);
  const pendingShiftNotes = usePendingShiftNotesCount();
  const { notifications, loading: notificationsLoading } = useNotifications();

  async function loadDoctorSales() {
    if (!effectiveName || !effectiveBranch) return;
    setSalesLoading(true);
    setSalesError(null);
    try {
      const elapsedDays = Math.max(1, Math.floor((new Date().getTime() - cycle.start.getTime()) / 86400000) + 1);
      const priorCycles: PharmacyCycle[] = [];
      let cursor = cycle;
      for (let index = 0; index < 3; index += 1) {
        cursor = previousCycle(cursor);
        priorCycles.push(cursor);
      }

      const [currentSummary, todaySummary, ...history] = await Promise.all([
        loadSalesAnalyticsSummary({
          startDate: formatCycleDate(cycle.start),
          endDate: formatCycleDate(cycle.end),
          branch: effectiveBranch,
        }),
        loadSalesAnalyticsSummary({
          startDate: todayIso,
          endDate: todayIso,
          branch: effectiveBranch,
          doctor: effectiveName,
        }),
        ...priorCycles.map((item) => loadSalesAnalyticsSummary({
          startDate: formatCycleDate(item.start),
          endDate: comparableEnd(item, elapsedDays),
          branch: effectiveBranch,
          doctor: effectiveName,
        })),
      ]);

      const currentDoctor = currentSummary.doctorRows.find((row) => row.staffId === effectiveId || row.doctor === effectiveName);
      const ranked = [...currentSummary.doctorRows]
        .filter((row) => row.netSales > 0)
        .sort((a, b) => b.netSales - a.netSales);
      const rankIndex = ranked.findIndex((row) => row.staffId === effectiveId || row.doctor === effectiveName);
      const currentComparableSales = currentDoctor?.netSales || 0;
      const previousComparableSales = history[0]?.doctorRows.find((row) => row.staffId === effectiveId || row.doctor === effectiveName)?.netSales || history[0]?.kpis.netSales || 0;
      const historicalSales = history.map((item) => item.doctorRows.find((row) => row.staffId === effectiveId || row.doctor === effectiveName)?.netSales || item.kpis.netSales || 0);
      const averageLastThreeComparableSales = historicalSales.length ? historicalSales.reduce((sum, value) => sum + value, 0) / historicalSales.length : 0;
      const branchAvg = currentSummary.branchRows.find((row) => row.branch === effectiveBranch)?.avgInvoice || 0;
      const firstSales = ranked[0]?.netSales || 0;

      setSales({
        cycleSales: currentComparableSales,
        dailySales: todaySummary.kpis.netSales,
        invoices: currentDoctor?.invoicesCount || 0,
        avgInvoice: currentDoctor?.avgInvoice || 0,
        branchAvg,
        previousComparableSales,
        averageLastThreeComparableSales,
        growthVsPrevious: percentChange(currentComparableSales, previousComparableSales),
        growthVsAverage: percentChange(currentComparableSales, averageLastThreeComparableSales),
        branchRank: rankIndex >= 0 ? rankIndex + 1 : null,
        branchDoctorsCount: ranked.length,
        gapToFirst: Math.max(0, firstSales - currentComparableSales),
      });
    } catch (error) {
      console.error('Failed to load doctor sales dashboard:', error);
      setSalesError('تعذر تحميل مقارنة المبيعات الحالية والسابقة');
      setSales(null);
    } finally {
      setSalesLoading(false);
    }
  }

  useEffect(() => {
    void loadDoctorSales();
  }, [effectiveBranch, effectiveId, effectiveName]);

  if (!permissions?.can_view_dashboard) return <BlockedState text="ليس لديك صلاحية للوصول إلى هذه الصفحة" />;
  if (!canReadSelectedStaff) return <BlockedState text="لا يمكن عرض بيانات هذا الموظف. الدكتور يرى بياناته فقط، ومدير الفرع يرى بيانات فرعه فقط." />;

  const salesStatus: LoadStatus = salesLoading ? 'loading' : salesError ? 'error' : sales ? 'success' : 'empty';
  const pointsStatus: LoadStatus = pointsLoading ? 'loading' : 'success';

  return (
    <div className="space-y-6" dir="rtl">
      <section className="rounded-3xl border border-teal-400/25 bg-gradient-to-l from-[#0d1c33] via-[#10213a] to-[#0f3140] p-5 shadow-xl">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl border border-teal-300/30 bg-teal-400/15 text-2xl font-black text-teal-100">
              {effectiveName ? effectiveName.replace(/^د\.?\s*/i, '').slice(0, 1) : <UserRound />}
            </div>
            <div>
              <div className="text-xs font-black text-teal-200">لوحة أداء الدكتور</div>
              <h1 className="mt-1 text-2xl font-black text-white">{greeting()} يا دكتور {effectiveName || user?.name || '—'}</h1>
              <p className="mt-2 text-sm font-bold text-slate-300">مقارنة تطورك الشخصي وترتيبك داخل {effectiveBranch || 'الفرع'} بدون تارجت مبيعات شخصي.</p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-slate-200">
                <Pill>الدور: {effectiveRole || '—'}</Pill>
                <Pill>الدورة: {cycle.label}</Pill>
                <Pill>آخر تحديث: {lastRefresh}</Pill>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {isManagerView && (
              <select value={selectedStaff?.id || ''} onChange={(event) => setSelectedStaffId(event.target.value)} className="input-dark min-w-72" disabled={staffLoading}>
                {scopedStaffOptions.filter((item) => ['pharmacist', 'shift_supervisor_morning', 'shift_supervisor_evening'].includes(normalizeRole(item.role))).map((item) => (
                  <option key={item.id} value={item.id}>{item.name} — {item.branch}</option>
                ))}
              </select>
            )}
            <button type="button" className="btn-secondary flex items-center gap-2" onClick={() => { setLastRefresh(new Date().toLocaleString('ar-EG')); void loadDoctorSales(); }}>
              <RefreshCw size={16} /> تحديث
            </button>
            <button type="button" className="btn-primary flex items-center gap-2" onClick={() => setFollowupOpen(true)}>
              <Search size={16} /> بحث عن عميل وطلب متابعة
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={FileText} label="مبيعات الدورة" value={sales ? formatCurrency(sales.cycleSales) : '—'} status={salesStatus} sub={cycle.label} />
        <MetricCard icon={TrendingUp} label="مقارنة بالدورة السابقة" value={formatGrowth(sales?.growthVsPrevious)} status={salesStatus} sub={sales ? `السابق ${formatCurrency(sales.previousComparableSales)}` : 'نفس عدد الأيام'} />
        <MetricCard icon={BarChart3} label="مقارنة بمتوسط 3 دورات" value={formatGrowth(sales?.growthVsAverage)} status={salesStatus} sub={sales ? `المتوسط ${formatCurrency(sales.averageLastThreeComparableSales)}` : 'نفس عدد الأيام'} />
        <MetricCard icon={Award} label="ترتيبي في الفرع" value={sales?.branchRank ? `${sales.branchRank} من ${sales.branchDoctorsCount}` : '—'} status={salesStatus} sub={sales?.gapToFirst ? `الفارق عن الأول ${formatCurrency(sales.gapToFirst)}` : 'حسب مبيعات الدورة'} />
        <MetricCard icon={Users} label="عدد الفواتير" value={sales ? sales.invoices.toLocaleString('ar-EG') : '—'} status={salesStatus} sub="الدورة الحالية" />
        <MetricCard icon={Wallet} label="متوسط الفاتورة" value={sales ? formatCurrency(sales.avgInvoice) : '—'} status={salesStatus} sub={sales?.branchAvg ? `متوسط الفرع ${formatCurrency(sales.branchAvg)}` : 'داخل الفرع'} />
        <MetricCard icon={Star} label="نقاطي الحالية" value={pointsBalance.toLocaleString('ar-EG')} status={pointsStatus} sub={`من ${STARTING_POINTS} نقطة`} />
        <MetricCard icon={Bell} label="تنبيهات وملاحظات" value={(notifications.length + Number(pendingShiftNotes || 0)).toLocaleString('ar-EG')} status={notificationsLoading ? 'loading' : 'success'} sub="تنبيهات + ملاحظات شيفت" />
      </section>

      {salesError && <div className="rounded-2xl border border-red-400/20 bg-red-500/10 p-4 text-sm font-bold text-red-100">{salesError}</div>}

      <section className="grid gap-4 xl:grid-cols-3">
        <SectionCard icon={Package} title="الرواكد واللستة المطلوبة" subtitle="التركيز على الأصناف المعتمدة ومتابعة الكفاءة">
          <div className="space-y-2">
            {(stagnantMedicines || []).slice(0, 5).map((item) => <InfoRow key={item.id} label={item.medicine_name} value={`${item.quantity_available || 0} متاح`} />)}
            {(incentiveMedicines || []).slice(0, 5).map((item) => <InfoRow key={item.id} label={item.product_name} value={`${formatCurrency(item.incentive_value)} / علبة`} />)}
            {!(stagnantMedicines || []).length && !(incentiveMedicines || []).length && <EmptyText text="لا توجد أصناف مسندة حاليًا." />}
          </div>
          <div className="mt-3 flex gap-2">
            <a className="btn-secondary flex-1 text-center" href="/stagnant-medicines">الرواكد</a>
            <a className="btn-secondary flex-1 text-center" href="/incentive-medicines">اللستة المطلوبة</a>
          </div>
        </SectionCard>

        <SectionCard icon={MessageSquareText} title="الردود السريعة المميزة" subtitle="ردود باسم الدكتور وتركيز الشهر">
          <p className="text-sm font-bold leading-7 text-slate-300">استخدم الردود المعتمدة باسمك، وراجع الردود التي اختارتها الإدارة للتطبيق خلال الشهر الحالي.</p>
          <a className="btn-primary mt-3 block text-center" href="/quick-replies">فتح الردود السريعة</a>
        </SectionCard>

        <SectionCard icon={BookOpenCheck} title="طريقة التعامل مع العميل" subtitle="دليل المواقف والسياسات">
          <div className="space-y-2 text-sm font-bold text-slate-300">
            <p>عدم توافر صنف، ترشيح بديل، رفض خصم، مرتجع، عميل غاضب، تأخير أوردر، أو شكوى.</p>
            <p className="rounded-xl border border-teal-400/20 bg-teal-500/10 p-3 text-teal-100">الهدف خدمة ودودة وواضحة بدون ضغط على العميل.</p>
          </div>
          <a className="btn-secondary mt-3 block text-center" href="/training">فتح دليل المواقف والتدريب</a>
        </SectionCard>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <SectionCard icon={HeartHandshake} title="طلب متابعة لعميل" subtitle="الدكتور يسجل الطلب وخدمة العملاء تنفذه">
          <p className="text-sm font-bold leading-7 text-slate-300">ابحث بالاسم أو الكود أو الهاتف، راجع الملاحظات المهمة، ثم أرسل السبب والأولوية لمسئول خدمة العملاء.</p>
          <button type="button" className="btn-primary mt-3 w-full" onClick={() => setFollowupOpen(true)}>بحث وتسجيل طلب متابعة</button>
        </SectionCard>

        <SectionCard icon={ClipboardList} title="ملاحظات الشيفت" subtitle="ضروري قراءتها قبل بدء العمل">
          <InfoRow label="ملاحظات غير مقروءة" value={String(pendingShiftNotes || 0)} />
          <a className="btn-secondary mt-3 block text-center" href="/shift-notes">فتح ملاحظات الشيفت</a>
        </SectionCard>

        <SectionCard icon={ShieldCheck} title="الحوافز والنقاط" subtitle="شفافية الحركة والخصم والتعويض">
          <div className="space-y-2">
            <InfoRow label="النقاط الحالية" value={`${pointsBalance} / ${STARTING_POINTS}`} />
            <InfoRow label="المكافآت" value={`${rewardsBalance} نقطة`} />
            <InfoRow label="الخصومات" value={`${discountBalance} نقطة`} />
            <InfoRow label="الحافز المتوقع" value={`${formatCurrency(expectedIncentive)} من سقف ${formatCurrency(MAX_BASE_INCENTIVE)}`} />
          </div>
        </SectionCard>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <SectionCard icon={GraduationCap} title="تطوير أدائي" subtitle="روابط مباشرة للتحسين">
          <div className="grid gap-2">
            <a className="btn-secondary text-center" href="/reviews">تقييمات المحادثات</a>
            <a className="btn-secondary text-center" href="/doctor-competition">ترتيب ومسابقة الفرع</a>
            <a className="btn-secondary text-center" href="/training">التدريب والسياسات</a>
          </div>
        </SectionCard>

        <SectionCard icon={TrendingDown} title="أقرب فرصة للتحسين" subtitle="بناءً على أرقامك الحالية">
          <ImprovementText sales={sales} />
        </SectionCard>

        <SectionCard icon={AlertCircle} title="تنبيه مهم" subtitle="فصل واضح للمسئوليات">
          <p className="text-sm font-bold leading-7 text-slate-300">متابعات اليوم وإدارة قائمة العملاء مسئولية خدمة العملاء. الدكتور يستطيع فقط البحث عن العميل وتسجيل طلب متابعة عند وجود سبب واضح.</p>
        </SectionCard>
      </section>

      <StaffOperatingPolicy />

      <QuickFollowupModal
        open={followupOpen}
        onClose={() => setFollowupOpen(false)}
        mode="doctor_request"
        defaultBranch={effectiveBranch}
        title="بحث سريع عن عميل وطلب متابعة"
        description="راجع الملاحظات المهمة ثم أرسل الطلب لمسئول خدمة العملاء."
      />
    </div>
  );
}

function formatGrowth(value: number | null | undefined) {
  if (value === null || value === undefined) return 'غير متاح';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

function ImprovementText({ sales }: { sales: DoctorSalesSnapshot | null }) {
  if (!sales) return <EmptyText text="بانتظار اكتمال بيانات المبيعات." />;
  if (sales.branchAvg > 0 && sales.avgInvoice < sales.branchAvg) {
    return <p className="text-sm font-bold leading-7 text-amber-100">متوسط فاتورتك أقل من متوسط الفرع. ركز على فهم الاحتياج والترشيح المكمل المناسب فقط.</p>;
  }
  if (sales.growthVsPrevious !== null && sales.growthVsPrevious < 0) {
    return <p className="text-sm font-bold leading-7 text-amber-100">مبيعاتك أقل من نفس الفترة السابقة. راجع عدد الفواتير ومتوسط الفاتورة بدل الاعتماد على رقم واحد.</p>;
  }
  return <p className="text-sm font-bold leading-7 text-emerald-100">أداؤك مستقر أو متحسن. حافظ على جودة الخدمة، الالتزام باللستة، ووضوح الردود.</p>;
}

function MetricCard({ icon: Icon, label, value, status, sub }: { icon: React.ElementType; label: string; value: string; status: LoadStatus; sub: string }) {
  return (
    <div className="stat-card">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/15 text-teal-300"><Icon size={19} /></div>
        <div className="min-w-0">
          <div className="text-xs font-bold text-slate-400">{label}</div>
          <div className="mt-1 text-xl font-black text-white">{status === 'loading' ? 'جاري التحميل...' : status === 'error' ? 'غير متاح' : value}</div>
        </div>
      </div>
      <div className="mt-3 text-xs font-bold text-slate-500">{sub}</div>
    </div>
  );
}

function SectionCard({ icon: Icon, title, subtitle, children }: { icon: React.ElementType; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="stat-card">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/15 text-teal-300"><Icon size={19} /></div>
        <div>
          <div className="font-black text-white">{title}</div>
          <div className="text-xs font-bold text-slate-400">{subtitle}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/5 px-3 py-2 text-sm font-bold"><span className="text-slate-300">{label}</span><span className="text-white">{value}</span></div>;
}

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">{children}</span>;
}

function EmptyText({ text }: { text: string }) {
  return <div className="rounded-xl border border-white/5 bg-white/5 p-3 text-sm font-bold text-slate-400">{text}</div>;
}

function BlockedState({ text }: { text: string }) {
  return <div className="flex min-h-[360px] items-center justify-center" dir="rtl"><div className="stat-card max-w-xl text-center"><AlertCircle className="mx-auto mb-3 text-amber-400" size={42} /><div className="font-black text-white">{text}</div></div></div>;
}
