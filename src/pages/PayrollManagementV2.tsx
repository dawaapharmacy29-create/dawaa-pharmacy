import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Banknote, ClipboardList, PackageCheck, RefreshCw, Save, Search, ShieldCheck, TrendingDown, Trophy, User, WalletCards } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { normalizeBranchName } from '@/lib/branch';
import { formatCurrency } from '@/lib/utils';
import { cairoToday } from '@/lib/attendance/period';
import { getCurrentCycle, formatCycleDate } from '@/lib/pharmacy-cycle';
import { listActiveHRStaffDirectory } from '@/lib/hr/staffDirectoryService';
import PayrollAttendanceSafetyGate from '@/components/attendance/PayrollAttendanceSafetyGate';
import PayrollCycleReadinessOverview from '@/components/attendance/PayrollCycleReadinessOverview';
import PayrollTransparencyPanel from '@/components/payroll/PayrollTransparencyPanel';
import PayrollTransparencyPanelLegacy from '@/components/payroll/PayrollTransparencyPanelLegacy';
import PayrollManualEntriesPanel from '@/components/payroll/PayrollManualEntriesPanel';
import { fetchAttendancePayrollReadiness, type AttendancePayrollReadiness } from '@/lib/payroll/attendancePayrollReadinessService';
import {
  fetchCompensationProfile,
  fetchPayrollComponents,
  saveCompensationProfile,
  listCompensationChanges,
  decideCompensationChange,
  type CompensationChange,
  type PayrollComponents,
} from '@/lib/payroll/payrollCompensationService';
import { fetchPayrollIncentiveTruth, type PayrollIncentiveTruth } from '@/lib/incentives/payrollIncentiveTruthService';
import { listFinalizedPayrollSnapshots, type FinalizedPayrollSnapshotHistoryRow } from '@/lib/payroll/payrollFinalizedSnapshotService';
import { listLegacyPaidPayrollHistory, type LegacyPaidPayrollHistoryRow } from '@/lib/payroll/payrollLegacyHistoryService';
import { buildPaidStatementPdf } from '@/lib/payroll/paidStatementPdf';
import { buildEmployeePayrollStatementPdf } from '@/lib/payroll/employeePayrollStatementPdf';

const surface = { background: 'var(--dawaa-theme-surface)', borderColor: 'var(--dawaa-theme-border)' };
const surfaceSoft = { background: 'var(--dawaa-theme-bg-soft)', borderColor: 'var(--dawaa-theme-border)' };
const mutedText = { color: 'var(--dawaa-theme-muted)' };

type WorkspaceTab = 'overview' | 'compensation' | 'adjustments' | 'incentives' | 'history';
type StaffRow = { id: string; staffId: string; username: string; name: string; branch: string; role: string; active: boolean };
type CompensationProfileState = {
  salaryCalculationMode: 'legacy_fixed' | 'monthly_hour_unit' | 'attendance_hours_v1';
  monthlyHourUnitValue: number;
  contractedDailyHours: number;
  attendanceMonthlyReferenceRate: number;
  monthlyBaseSalary: number;
  overtimeHourRate: number;
  monthlyIncentiveBase: number;
};
type MonthlyRow = LegacyPaidPayrollHistoryRow & {
  history_source?: 'legacy_v13' | 'finalized_v2';
  snapshot_fingerprint?: string | null;
  finalized_at?: string | null;
};

type LoadState = 'idle' | 'loading' | 'loaded' | 'error';

function num(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function emptyProfile(): CompensationProfileState {
  return {
    salaryCalculationMode: 'monthly_hour_unit',
    monthlyHourUnitValue: 0,
    contractedDailyHours: 0,
    attendanceMonthlyReferenceRate: 0,
    monthlyBaseSalary: 0,
    overtimeHourRate: 0,
    monthlyIncentiveBase: 0,
  };
}

function isDeliveryRole(role: string) {
  const raw = String(role || '').trim();
  const lower = raw.toLowerCase();
  return lower.includes('delivery') || raw.includes('دليفري') || raw.includes('توصيل');
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function PayrollManagementV2() {
  const { user } = useAuth();
  const allBranches = canViewAllBranches(user);
  const ownBranch = normalizeBranchName(user?.branch || '');
  const cycle = useMemo(() => getCurrentCycle(), []);
  const currentMonth = useMemo(() => formatCycleDate(cycle.end).slice(0, 8) + '01', [cycle]);

  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [staffState, setStaffState] = useState<LoadState>('idle');
  const [staffError, setStaffError] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<StaffRow | null>(null);
  const [month, setMonth] = useState(currentMonth);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('overview');
  const [showCycleOverview, setShowCycleOverview] = useState(false);
  const [showFinalizationTools, setShowFinalizationTools] = useState(false);

  const [attendanceReadiness, setAttendanceReadiness] = useState<AttendancePayrollReadiness | null>(null);
  const [attendanceState, setAttendanceState] = useState<LoadState>('idle');
  const [attendanceError, setAttendanceError] = useState('');

  const [profile, setProfile] = useState<CompensationProfileState>(emptyProfile());
  const [profileState, setProfileState] = useState<LoadState>('idle');
  const [compensationChanges, setCompensationChanges] = useState<CompensationChange[]>([]);
  const [compensationError, setCompensationError] = useState('');
  const [compensationReason, setCompensationReason] = useState('');
  const [compensationEffective, setCompensationEffective] = useState(cairoToday());
  const [saving, setSaving] = useState(false);

  const [components, setComponents] = useState<PayrollComponents | null>(null);
  const [automatedTruth, setAutomatedTruth] = useState<PayrollIncentiveTruth | null>(null);
  const [incentiveState, setIncentiveState] = useState<LoadState>('idle');
  const [incentiveError, setIncentiveError] = useState('');

  const [history, setHistory] = useState<MonthlyRow[]>([]);
  const [historyState, setHistoryState] = useState<LoadState>('idle');
  const [historyError, setHistoryError] = useState('');
  const [exportingStatement, setExportingStatement] = useState(false);

  const monthCycle = month.slice(0, 7);
  const scopeKey = selected?.staffId ? `${selected.staffId}:${monthCycle}` : '';
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;

  const loadStaff = useCallback(async () => {
    setStaffState('loading');
    setStaffError('');
    try {
      const rows = await listActiveHRStaffDirectory({ branch: !allBranches && ownBranch ? ownBranch : null });
      setStaff(rows.map((row) => ({
        id: String(row.account_id || row.staff_id || ''),
        staffId: String(row.staff_id || ''),
        username: String(row.username || ''),
        name: String(row.name || row.username || ''),
        branch: String(row.branch || ''),
        role: String(row.role || ''),
        active: row.active !== false,
      })));
      setStaffState('loaded');
    } catch (error) {
      setStaff([]);
      setStaffError(errorText(error, 'تعذر تحميل دليل الموظفين'));
      setStaffState('error');
    }
  }, [allBranches, ownBranch]);

  useEffect(() => { void loadStaff(); }, [loadStaff]);

  const selectPerson = useCallback((person: StaffRow, tab: WorkspaceTab = 'overview') => {
    setSelected(person);
    setWorkspaceTab(tab);
    setShowFinalizationTools(false);
  }, []);

  useEffect(() => {
    setAttendanceReadiness(null);
    setAttendanceState('idle');
    setAttendanceError('');
    setProfile(emptyProfile());
    setProfileState('idle');
    setCompensationChanges([]);
    setCompensationError('');
    setComponents(null);
    setAutomatedTruth(null);
    setIncentiveState('idle');
    setIncentiveError('');
    setHistory([]);
    setHistoryState('idle');
    setHistoryError('');
    setShowFinalizationTools(false);
  }, [scopeKey]);

  useEffect(() => {
    if (!selected?.staffId || workspaceTab !== 'overview') return;
    const requestScope = scopeKey;
    setAttendanceState('loading');
    setAttendanceError('');
    void fetchAttendancePayrollReadiness(selected.staffId, monthCycle)
      .then((value) => {
        if (scopeRef.current !== requestScope) return;
        setAttendanceReadiness(value);
        setAttendanceState('loaded');
      })
      .catch((error) => {
        if (scopeRef.current !== requestScope) return;
        setAttendanceReadiness(null);
        setAttendanceError(errorText(error, 'تعذر تحميل جاهزية البصمة'));
        setAttendanceState('error');
      });
  }, [selected?.staffId, monthCycle, workspaceTab, scopeKey]);

  useEffect(() => {
    if (!selected?.staffId || workspaceTab !== 'compensation') return;
    const requestScope = scopeKey;
    setProfileState('loading');
    setCompensationError('');
    void Promise.allSettled([
      fetchCompensationProfile(selected.staffId),
      listCompensationChanges(selected.staffId),
    ]).then(([profileResult, changesResult]) => {
      if (scopeRef.current !== requestScope) return;
      const errors: string[] = [];
      if (profileResult.status === 'fulfilled') {
        const row = profileResult.value;
        setProfile(row ? {
          salaryCalculationMode: row.salary_calculation_mode === 'attendance_hours_v1'
            ? 'attendance_hours_v1'
            : row.salary_calculation_mode === 'monthly_hour_unit'
              ? 'monthly_hour_unit'
              : 'legacy_fixed',
          monthlyHourUnitValue: num(row.monthly_hour_unit_value),
          contractedDailyHours: num(row.contracted_daily_hours),
          attendanceMonthlyReferenceRate: num(row.hourly_rate),
          monthlyBaseSalary: num(row.monthly_base_salary),
          overtimeHourRate: num(row.overtime_hour_rate),
          monthlyIncentiveBase: num(row.monthly_incentive_base),
        } : emptyProfile());
      } else {
        errors.push(`ملف التعويضات: ${errorText(profileResult.reason, 'تعذر التحميل')}`);
      }
      if (changesResult.status === 'fulfilled') {
        setCompensationChanges(changesResult.value);
      } else {
        errors.push(`سجل الاعتماد: ${errorText(changesResult.reason, 'تعذر التحميل')}`);
      }
      if (errors.length) {
        setCompensationError(errors.join(' · '));
        setProfileState('error');
      } else {
        setProfileState('loaded');
      }
    });
  }, [selected?.staffId, workspaceTab, scopeKey]);

  useEffect(() => {
    if (!selected?.staffId || workspaceTab !== 'incentives') return;
    const requestScope = scopeKey;
    setIncentiveState('loading');
    setIncentiveError('');
    void Promise.allSettled([
      fetchPayrollComponents(selected.staffId, monthCycle),
      fetchPayrollIncentiveTruth(selected.staffId, monthCycle),
    ]).then(([componentsResult, truthResult]) => {
      if (scopeRef.current !== requestScope) return;
      const errors: string[] = [];
      if (componentsResult.status === 'fulfilled') setComponents(componentsResult.value);
      else errors.push(`مكونات الراتب: ${errorText(componentsResult.reason, 'تعذر التحميل')}`);
      if (truthResult.status === 'fulfilled') setAutomatedTruth((truthResult.value || [])[0] || null);
      else errors.push(`الحوافز الآلية: ${errorText(truthResult.reason, 'تعذر التحميل')}`);
      if (errors.length) {
        setIncentiveError(errors.join(' · '));
        setIncentiveState('error');
      } else {
        setIncentiveState('loaded');
      }
    });
  }, [selected?.staffId, monthCycle, workspaceTab, scopeKey]);

  useEffect(() => {
    if (!selected?.staffId || !selected.username || workspaceTab !== 'history') return;
    const requestScope = scopeKey;
    setHistoryState('loading');
    setHistoryError('');
    void Promise.allSettled([
      listFinalizedPayrollSnapshots(selected.staffId, 24),
      listLegacyPaidPayrollHistory(selected.username, 24),
    ]).then(([finalizedResult, legacyResult]) => {
      if (scopeRef.current !== requestScope) return;
      const errors: string[] = [];
      const finalizedRows = finalizedResult.status === 'fulfilled' ? finalizedResult.value : [];
      const legacyRows = legacyResult.status === 'fulfilled' ? legacyResult.value : [];
      if (finalizedResult.status === 'rejected') errors.push(`السجل النهائي: ${errorText(finalizedResult.reason, 'تعذر التحميل')}`);
      if (legacyResult.status === 'rejected') errors.push(`الأرشيف القديم: ${errorText(legacyResult.reason, 'تعذر التحميل')}`);
      const normalizedFinalized: MonthlyRow[] = finalizedRows.map((row: FinalizedPayrollSnapshotHistoryRow) => ({
        id: row.id,
        staff_username: row.staff_username,
        payroll_month: row.month_cycle,
        deductions_total: num(row.deductions_total),
        net_salary: num(row.net_salary),
        status: 'finalized_v2',
        approved_by_name: row.finalized_by_name,
        freeze_version: 2,
        history_source: 'finalized_v2',
        snapshot_fingerprint: row.snapshot_fingerprint,
        finalized_at: row.finalized_at,
      }));
      const finalizedCycles = new Set(normalizedFinalized.map((row) => String(row.payroll_month).slice(0, 7)));
      const normalizedLegacy: MonthlyRow[] = legacyRows
        .filter((row) => !finalizedCycles.has(String(row.payroll_month || '').slice(0, 7)))
        .map((row) => ({ ...row, history_source: 'legacy_v13' }));
      setHistory([...normalizedFinalized, ...normalizedLegacy].sort((a, b) => String(b.payroll_month).localeCompare(String(a.payroll_month))));
      if (errors.length) {
        setHistoryError(errors.join(' · '));
        setHistoryState('error');
      } else {
        setHistoryState('loaded');
      }
    });
  }, [selected?.staffId, selected?.username, workspaceTab, scopeKey]);

  async function saveProfile() {
    if (!selected) return;
    if (compensationReason.trim().length < 5 || !compensationEffective) {
      toast.warning('حدد تاريخ السريان وسبب التغيير (٥ أحرف على الأقل).');
      return;
    }
    if (profile.salaryCalculationMode === 'attendance_hours_v1' && profile.attendanceMonthlyReferenceRate <= 0) {
      toast.error('أدخل القيمة الشهرية المرجعية قبل تفعيل حساب الساعات الفعلية.');
      return;
    }
    const requestScope = scopeKey;
    setSaving(true);
    try {
      await saveCompensationProfile({
        staffId: selected.staffId,
        staffName: selected.name,
        branch: selected.branch,
        salaryCalculationMode: profile.salaryCalculationMode,
        monthlyHourUnitValue: profile.monthlyHourUnitValue,
        contractedDailyHours: profile.contractedDailyHours,
        attendanceMonthlyReferenceRate: profile.attendanceMonthlyReferenceRate,
        monthlyBaseSalary: profile.monthlyBaseSalary,
        overtimeHourRate: profile.overtimeHourRate,
        monthlyIncentiveBase: profile.monthlyIncentiveBase,
        effectiveFrom: compensationEffective,
        reason: compensationReason.trim(),
      });
      if (scopeRef.current !== requestScope) return;
      setCompensationReason('');
      setCompensationChanges(await listCompensationChanges(selected.staffId));
      toast.success('تم إرسال التعديل للاعتماد؛ القيم الحالية لم تتغير');
    } catch (error) {
      if (scopeRef.current === requestScope) toast.error(errorText(error, 'تعذر حفظ ملف التعويضات'));
    } finally {
      if (scopeRef.current === requestScope) setSaving(false);
    }
  }

  async function decideChange(id: string, approve: boolean) {
    if (!selected) return;
    const requestScope = scopeKey;
    setSaving(true);
    try {
      await decideCompensationChange(id, approve, '');
      const rows = await listCompensationChanges(selected.staffId);
      if (scopeRef.current !== requestScope) return;
      setCompensationChanges(rows);
      toast.success(approve ? 'تم اعتماد التعديل وتطبيقه' : 'تم رفض الطلب');
    } catch (error) {
      if (scopeRef.current === requestScope) toast.error(errorText(error, 'تعذر اتخاذ القرار'));
    } finally {
      if (scopeRef.current === requestScope) setSaving(false);
    }
  }

  async function exportFinalStatement(payrollMonth: string, source: 'finalized_v2' | 'legacy_v13' = 'legacy_v13') {
    if (!selected?.staffId) return;
    setExportingStatement(true);
    try {
      const cycleLabel = payrollMonth.slice(0, 7);
      const result = source === 'finalized_v2'
        ? await buildEmployeePayrollStatementPdf(selected.staffId, cycleLabel, { requireFinalized: true })
        : await buildPaidStatementPdf(selected.staffId, cycleLabel);
      result.pdf.save(result.fileName);
    } catch (error) {
      toast.error(errorText(error, 'تعذر إصدار كشف الراتب النهائي'));
    } finally {
      setExportingStatement(false);
    }
  }

  const filteredStaff = useMemo(
    () => staff.filter((row) => !search.trim() || row.name.includes(search.trim()) || row.username.includes(search.trim())),
    [staff, search]
  );
  const deliverySelected = selected ? isDeliveryRole(selected.role) : false;
  const biometricReadyForReview = attendanceReadiness?.status === 'ready';

  return (
    <div className="space-y-5 p-4 md:p-6" dir="rtl">
      <div className="rounded-3xl border p-5" style={surface}>
        <div className="flex items-center gap-2 text-teal-200"><Banknote size={18} /><span className="text-xs font-black">إدارة الرواتب والحوافز · Workspace V2</span></div>
        <h1 className="mt-1 text-2xl font-black text-white">كشوف رواتب الموظفين</h1>
        <p className="mt-1 text-sm" style={mutedText}>تحميل تدريجي حسب التاب · منع الردود القديمة · Finalization كامل عند الطلب فقط</p>
      </div>

      <div className="rounded-3xl border p-4" style={surface}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-black text-teal-200">ملخص جاهزية الدورة</div>
            <div className="mt-1 text-[11px]" style={mutedText}>حساب جماعي ثقيل نسبيًا؛ لا يعمل تلقائيًا أثناء فتح ملفات الموظفين.</div>
          </div>
          <button type="button" className="btn-secondary" onClick={() => setShowCycleOverview((value) => !value)}>
            {showCycleOverview ? 'إخفاء الملخص' : 'تحميل ملخص الدورة'}
          </button>
        </div>
        {showCycleOverview ? (
          <div className="mt-4">
            <PayrollCycleReadinessOverview
              key={`cycle-overview:${monthCycle}:${allBranches ? 'all' : ownBranch}`}
              monthCycle={monthCycle}
              branch={allBranches ? null : ownBranch || null}
              onOpenStaffCompensation={(staffId) => {
                const person = staff.find((item) => item.staffId === staffId);
                if (!person) {
                  toast.warning('الموظف غير موجود داخل نطاق الرواتب الحالي.');
                  return;
                }
                selectPerson(person, 'compensation');
              }}
            />
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="rounded-3xl border p-4" style={surface}>
          <div className="flex items-center gap-2 rounded-xl border px-3 py-2" style={surfaceSoft}>
            <Search size={15} className="text-teal-300" />
            <input className="w-full bg-transparent text-sm outline-none" placeholder="بحث بالاسم أو اليوزر" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
          {staffState === 'loading' ? <div className="p-5 text-center"><RefreshCw className="mx-auto animate-spin text-teal-300" /></div> : null}
          {staffError ? <div className="mt-3 rounded-xl border border-red-400/30 bg-red-400/5 p-3 text-xs text-red-200">{staffError}</div> : null}
          <div className="mt-3 max-h-[70vh] space-y-1.5 overflow-y-auto">
            {filteredStaff.map((row) => (
              <button
                key={row.id || row.staffId}
                type="button"
                onClick={() => selectPerson(row)}
                className={`flex w-full items-center gap-2 rounded-xl border p-2.5 text-right text-sm transition ${selected?.staffId === row.staffId ? 'border-teal-400/50 bg-teal-400/10' : ''}`}
                style={selected?.staffId === row.staffId ? undefined : surfaceSoft}
              >
                <User size={15} className="text-teal-300" />
                <div><div className="font-black text-white">{row.name}</div><div className="text-[11px]" style={mutedText}>{row.branch} · {row.role || 'موظف'}</div></div>
              </button>
            ))}
          </div>
        </div>

        {!selected ? (
          <div className="flex items-center justify-center rounded-3xl border p-10 text-sm" style={{ ...surface, ...mutedText }}>اختار موظف من القائمة. لن يتم تحميل أي حساب مالي قبل الاختيار.</div>
        ) : (
          <div className="space-y-4">
            <div className="sticky top-2 z-20 rounded-2xl border p-3 shadow-lg" style={surface}>
              <div className="flex flex-wrap items-center gap-2">
                <div className="me-auto">
                  <div className="text-sm font-black text-white">{selected.name}</div>
                  <div className="text-[10px]" style={mutedText}>{selected.branch} · {selected.role || 'موظف'}{deliverySelected ? ' · مسار الدليفري' : ''}</div>
                </div>
                <label className="text-[10px] font-bold" style={mutedText}>دورة الراتب
                  <input
                    type="month"
                    className="input ms-2 !py-1 text-xs"
                    value={monthCycle}
                    onChange={(event) => {
                      setMonth(`${event.target.value}-01`);
                      setWorkspaceTab('overview');
                      setShowFinalizationTools(false);
                    }}
                  />
                </label>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {([
                  ['overview', 'الملخص والشفافية'],
                  ['compensation', 'التعويضات'],
                  ['adjustments', 'التسويات والخصومات'],
                  ['incentives', 'الحوافز'],
                  ['history', 'سجل الدورات'],
                ] as const).map(([id, label]) => (
                  <button key={id} type="button" onClick={() => setWorkspaceTab(id)} className={`rounded-xl border px-3 py-2 text-xs font-black transition ${workspaceTab === id ? 'border-teal-400/50 bg-teal-400/10 text-teal-200' : 'border-[var(--dawaa-theme-border)] text-[var(--dawaa-theme-muted)]'}`}>{label}</button>
                ))}
              </div>
            </div>

            {workspaceTab === 'overview' ? (
              <div className="space-y-4">
                <div className="rounded-2xl border p-4" style={surface}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-black text-teal-200"><ShieldCheck size={17} /> جاهزية البصمة للرواتب</div>
                    {attendanceState === 'loading' ? <RefreshCw size={15} className="animate-spin text-teal-300" /> : null}
                    {attendanceReadiness ? <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black ${biometricReadyForReview ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200' : 'border-amber-400/30 bg-amber-400/10 text-amber-200'}`}>{biometricReadyForReview ? 'جاهزة للمراجعة المالية' : 'تحتاج مراجعة'}</span> : null}
                  </div>
                  {attendanceError ? <div className="mt-3 rounded-xl border border-red-400/30 bg-red-400/5 p-3 text-xs text-red-200">تعذر تحميل جاهزية البصمة: {attendanceError}</div> : null}
                  {attendanceReadiness ? (
                    <>
                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        <div className="rounded-xl border p-3" style={surfaceSoft}><div className="text-[10px] font-bold" style={mutedText}>ساعات البصمة المرشحة</div><div className="mt-1 text-lg font-black text-white">{attendanceReadiness.candidateWorkedHours.toFixed(2)} ساعة</div></div>
                        <div className="rounded-xl border p-3" style={surfaceSoft}><div className="text-[10px] font-bold" style={mutedText}>الشيفتات المقترنة</div><div className="mt-1 text-lg font-black text-white">{attendanceReadiness.pairedShifts}</div></div>
                        <div className="rounded-xl border p-3" style={surfaceSoft}><div className="text-[10px] font-bold" style={mutedText}>بصمات تحتاج مراجعة</div><div className="mt-1 text-lg font-black text-white">{attendanceReadiness.manualReviewPunches + attendanceReadiness.unpairedAcceptedPunches}</div></div>
                      </div>
                      {attendanceReadiness.reasons.length ? <div className="mt-2 flex items-start gap-2 text-[11px] text-amber-200"><AlertTriangle size={14} className="mt-0.5 shrink-0" /><span>{attendanceReadiness.reasons.join(' · ')}</span></div> : null}
                    </>
                  ) : attendanceState === 'loaded' ? <div className="mt-3 text-xs" style={mutedText}>لا توجد بيانات جاهزية بصمة لهذه الدورة.</div> : null}
                </div>

                <div className="rounded-2xl border p-4" style={surface}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div><div className="text-sm font-black text-teal-200">Finalization Gate وأدوات Snapshot</div><div className="mt-1 text-[11px]" style={mutedText}>لا يتم تحميل Preview/Stage/Audit تلقائيًا. افتح الأدوات فقط عندما تبدأ المراجعة النهائية.</div></div>
                    <button type="button" className="btn-secondary" onClick={() => setShowFinalizationTools((value) => !value)}>{showFinalizationTools ? 'إغلاق أدوات الإقفال' : 'فتح أدوات الإقفال'}</button>
                  </div>
                </div>
                {showFinalizationTools ? <PayrollAttendanceSafetyGate key={`gate-tools:${scopeKey}`} staffId={selected.staffId} monthCycle={monthCycle} /> : null}

                {deliverySelected
                  ? <PayrollTransparencyPanel key={`transparency-delivery:${scopeKey}`} staffId={selected.staffId} monthCycle={monthCycle} />
                  : <PayrollTransparencyPanelLegacy key={`transparency-standard:${scopeKey}`} staffId={selected.staffId} monthCycle={monthCycle} />}
              </div>
            ) : null}

            {workspaceTab === 'compensation' ? (
              <div className="rounded-3xl border p-5" style={surface}>
                <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2 font-black text-teal-200"><WalletCards size={18} /> ملف التعويضات الموحد — {selected.name}</div>{profileState === 'loading' ? <RefreshCw size={15} className="animate-spin text-teal-300" /> : null}</div>
                {compensationError ? <div className="mt-3 rounded-xl border border-red-400/30 bg-red-400/5 p-3 text-xs text-red-200">{compensationError}</div> : null}
                {profileState !== 'loading' ? (
                  <>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <label className="text-xs font-bold" style={mutedText}>طريقة حساب الأساسي
                        <select className="input mt-1 w-full" value={profile.salaryCalculationMode} onChange={(event) => setProfile((current) => ({ ...current, salaryCalculationMode: event.target.value as CompensationProfileState['salaryCalculationMode'] }))}>
                          <option value="attendance_hours_v1">الساعات الفعلية المعتمدة — Attendance Truth</option>
                          <option value="monthly_hour_unit">قيمة الساعة الشهرية × ساعات الدوام اليومية</option>
                          <option value="legacy_fixed">راتب أساسي ثابت — نظام قديم</option>
                        </select>
                      </label>
                      {profile.salaryCalculationMode === 'attendance_hours_v1' ? <label className="text-xs font-bold" style={mutedText}>القيمة الشهرية المرجعية للساعة<input type="number" className="input mt-1 w-full" value={profile.attendanceMonthlyReferenceRate} onChange={(event) => setProfile((current) => ({ ...current, attendanceMonthlyReferenceRate: num(event.target.value) }))} /></label> : null}
                      {profile.salaryCalculationMode === 'monthly_hour_unit' ? <><label className="text-xs font-bold" style={mutedText}>قيمة الساعة الشهرية<input type="number" className="input mt-1 w-full" value={profile.monthlyHourUnitValue} onChange={(event) => setProfile((current) => ({ ...current, monthlyHourUnitValue: num(event.target.value) }))} /></label><label className="text-xs font-bold" style={mutedText}>ساعات الدوام اليومية<input type="number" className="input mt-1 w-full" value={profile.contractedDailyHours} onChange={(event) => setProfile((current) => ({ ...current, contractedDailyHours: num(event.target.value) }))} /></label></> : null}
                      {profile.salaryCalculationMode === 'legacy_fixed' ? <label className="text-xs font-bold" style={mutedText}>الراتب الأساسي الثابت<input type="number" className="input mt-1 w-full" value={profile.monthlyBaseSalary} onChange={(event) => setProfile((current) => ({ ...current, monthlyBaseSalary: num(event.target.value) }))} /></label> : null}
                      <label className="text-xs font-bold" style={mutedText}>الحافز الشهري<input type="number" className="input mt-1 w-full" value={profile.monthlyIncentiveBase} onChange={(event) => setProfile((current) => ({ ...current, monthlyIncentiveBase: num(event.target.value) }))} /></label>
                      <label className="text-xs font-bold" style={mutedText}>سعر ساعة الإضافي<input type="number" className="input mt-1 w-full" value={profile.overtimeHourRate} onChange={(event) => setProfile((current) => ({ ...current, overtimeHourRate: num(event.target.value) }))} /></label>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2"><label className="text-xs">تاريخ سريان التعديل<input type="date" className="input mt-1 w-full" value={compensationEffective} onChange={(event) => setCompensationEffective(event.target.value)} /></label><label className="text-xs">سبب التغيير<input className="input mt-1 w-full" maxLength={500} value={compensationReason} onChange={(event) => setCompensationReason(event.target.value)} /></label></div>
                    <button className="btn-primary mt-4 flex items-center gap-2" disabled={saving || profileState === 'loading'} onClick={() => void saveProfile()}><Save size={16} /> طلب اعتماد تعديل التعويضات</button>
                    <div className="mt-4"><h3 className="font-bold">طلبات التعويضات وسجل الاعتماد</h3>{compensationChanges.map((change) => <div key={change.id} className="mt-2 rounded-xl border p-3 text-xs" style={surfaceSoft}><div>{change.state === 'pending' ? 'قيد الاعتماد' : change.state === 'approved' ? 'معتمد' : 'مرفوض'} · يسري من {change.effective_from} · {change.reason}</div>{change.state === 'pending' && user?.role === 'general_manager' && change.requested_by !== user.id ? <div className="mt-2 flex gap-2"><button className="btn-primary" disabled={saving} onClick={() => void decideChange(change.id, true)}>اعتماد وتطبيق</button><button className="btn-secondary" disabled={saving} onClick={() => void decideChange(change.id, false)}>رفض</button></div> : null}</div>)}</div>
                  </>
                ) : null}
              </div>
            ) : null}

            {workspaceTab === 'adjustments' ? <PayrollManualEntriesPanel key={`manual:${scopeKey}`} staffId={selected.staffId} monthCycle={monthCycle} /> : null}

            {workspaceTab === 'incentives' ? (
              <div className="space-y-4">
                <div className="rounded-3xl border p-5" style={surface}>
                  <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2 font-black text-teal-200"><PackageCheck size={18} /> تفاصيل الحوافز</div>{incentiveState === 'loading' ? <RefreshCw size={15} className="animate-spin text-teal-300" /> : null}</div>
                  {incentiveError ? <div className="mt-3 rounded-xl border border-red-400/30 bg-red-400/5 p-3 text-xs text-red-200">{incentiveError}</div> : null}
                  {components ? <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[640px] text-right text-xs"><thead><tr className="border-b" style={mutedText}><th className="p-2">الصنف</th><th className="p-2">الكمية</th><th className="p-2">حافز الوحدة</th><th className="p-2">الإجمالي</th></tr></thead><tbody>{components.listItems.length ? components.listItems.map((item) => <tr key={`${item.medicineId}-${item.productName}`} className="border-b"><td className="p-2 font-bold text-white">{item.productName}</td><td className="p-2">{item.quantity}</td><td className="p-2">{formatCurrency(item.incentivePerUnit)}</td><td className="p-2 font-black text-emerald-300">{formatCurrency(item.incentiveTotal)}</td></tr>) : <tr><td colSpan={4} className="p-5 text-center" style={mutedText}>لا توجد مبيعات مسجلة على لستة الحوافز لهذه الدورة.</td></tr>}</tbody></table></div> : null}
                </div>
                {automatedTruth ? <div className="rounded-3xl border p-5" style={surface}><div className="flex items-center gap-2 font-black text-teal-200"><Trophy size={18} /> الحوافز الآلية</div><div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4"><div>التارجت: <b>{formatCurrency(automatedTruth.targetBonus)}</b></div><div>الأداء: <b>{formatCurrency(automatedTruth.performanceIncentive)}</b></div><div>متابعة العملاء: <b>{formatCurrency(automatedTruth.followupThresholdBonus)}</b></div><div>طلبات العملاء: <b>{formatCurrency(automatedTruth.customerRequestThresholdBonus)}</b></div><div>نجم الفرع: <b>{formatCurrency(automatedTruth.branchStarBonus)}</b></div><div>الإجمالي الآلي: <b className="text-emerald-300">{formatCurrency(automatedTruth.automatedTotal)}</b></div></div></div> : null}
              </div>
            ) : null}

            {workspaceTab === 'history' ? (
              <div className="rounded-3xl border p-5" style={surface}>
                <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2 font-black text-teal-200"><ClipboardList size={18} /> سجل الدورات</div>{historyState === 'loading' ? <RefreshCw size={15} className="animate-spin text-teal-300" /> : null}</div>
                {historyError ? <div className="mt-3 rounded-xl border border-red-400/30 bg-red-400/5 p-3 text-xs text-red-200">{historyError}</div> : null}
                <div className="mt-3 space-y-2">{history.length ? history.map((row) => <div key={`${row.history_source || 'legacy_v13'}-${row.payroll_month}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm" style={surfaceSoft}><div><span className="font-black text-white">{String(row.payroll_month).slice(0, 7)}</span><div className="mt-1 text-[10px]" style={mutedText}>{row.history_source === 'finalized_v2' ? 'Final Snapshot V2' : 'Legacy Payroll Archive'}</div></div><span className="flex items-center gap-1 text-emerald-300"><Trophy size={13} /> {formatCurrency(num(row.net_salary))}</span><span className="flex items-center gap-1 text-rose-300"><TrendingDown size={13} /> {formatCurrency(num(row.deductions_total))}</span>{(row.history_source === 'finalized_v2' || row.status === 'paid') ? <button className="btn-secondary" disabled={exportingStatement} onClick={() => void exportFinalStatement(row.payroll_month, row.history_source === 'finalized_v2' ? 'finalized_v2' : 'legacy_v13')}>كشف PDF النهائي</button> : null}</div>) : historyState === 'loaded' ? <div className="p-6 text-center text-sm" style={mutedText}>لا توجد دورات نهائية محفوظة لهذا الموظف.</div> : null}</div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
