import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Activity, AlertTriangle, Banknote, CalendarClock, ClipboardList,
  LockKeyhole, PackageCheck, RefreshCw, Save, Search, ShieldCheck, TrendingDown,
  Trophy, User, WalletCards,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { normalizeBranchName } from '@/lib/branch';
import { formatCurrency } from '@/lib/utils';
import { getCurrentCycle, formatCycleDate } from '@/lib/pharmacy-cycle';
import { cairoToday } from '@/lib/attendance/period';
import { listActiveHRStaffDirectory } from '@/lib/hr/staffDirectoryService';
import { buildPaidStatementPdf } from '@/lib/payroll/paidStatementPdf';
import { buildEmployeePayrollStatementPdf } from '@/lib/payroll/employeePayrollStatementPdf';
import {
  listLegacyPaidPayrollHistory,
  type LegacyPaidPayrollHistoryRow,
} from '@/lib/payroll/payrollLegacyHistoryService';
import {
  listFinalizedPayrollSnapshots,
  type FinalizedPayrollSnapshotHistoryRow,
} from '@/lib/payroll/payrollFinalizedSnapshotService';
import { fetchPayrollIncentiveTruth, type PayrollIncentiveTruth } from '@/lib/incentives/payrollIncentiveTruthService';
import {
  fetchAttendancePayrollReadiness,
  type AttendancePayrollReadiness,
} from '@/lib/payroll/attendancePayrollReadinessService';
import PayrollAttendanceSafetyGate from '@/components/attendance/PayrollAttendanceSafetyGate';
import PayrollCycleReadinessOverview from '@/components/attendance/PayrollCycleReadinessOverview';
import PayrollTransparencyPanel from '@/components/payroll/PayrollTransparencyPanel';
import PayrollManualEntriesPanel from '@/components/payroll/PayrollManualEntriesPanel';
import {
  fetchCompensationProfile,
  fetchPayrollComponents,
  saveCompensationProfile,
  listCompensationChanges, decideCompensationChange, type CompensationChange,
  type PayrollComponents,
} from '@/lib/payroll/payrollCompensationService';

const surface = { background: 'var(--dawaa-theme-surface)', borderColor: 'var(--dawaa-theme-border)' };
const surfaceSoft = { background: 'var(--dawaa-theme-bg-soft)', borderColor: 'var(--dawaa-theme-border)' };
const mutedText = { color: 'var(--dawaa-theme-muted)' };
const STATUS_OPTIONS = [
  { key: 'approved', label: 'معتمد تاريخيًا' },
  { key: 'paid', label: 'مدفوع' },
  { key: 'finalized_v2', label: 'نهائي مجمد' },
];

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
type FinalizedHistoryRow = FinalizedPayrollSnapshotHistoryRow & {
  history_source: 'finalized_v2';
};

function num(v: unknown) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
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

export default function PayrollManagement() {
  const { user } = useAuth();
  const allBranches = canViewAllBranches(user);
  const ownBranch = normalizeBranchName(user?.branch || '');
  const cycle = useMemo(() => getCurrentCycle(), []);
  const currentMonth = useMemo(() => formatCycleDate(cycle.end).slice(0, 8) + '01', [cycle]);

  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<StaffRow | null>(null);
  const [workspaceTab, setWorkspaceTab] = useState<'overview' | 'compensation' | 'adjustments' | 'incentives' | 'history'>('overview');
  const [profile, setProfile] = useState<CompensationProfileState>(emptyProfile());
  const [components, setComponents] = useState<PayrollComponents | null>(null);
  const [automatedTruth, setAutomatedTruth] = useState<PayrollIncentiveTruth | null>(null);
  const [attendanceReadiness, setAttendanceReadiness] = useState<AttendancePayrollReadiness | null>(null);
  const [history, setHistory] = useState<MonthlyRow[]>([]);
  const [month, setMonth] = useState(currentMonth);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exportingStatement,setExportingStatement] = useState(false);
  const [compensationReason,setCompensationReason] = useState('');
  const [compensationEffective,setCompensationEffective] = useState(cairoToday());
  const [compensationChanges,setCompensationChanges] = useState<CompensationChange[]>([]);
  const [compensationError,setCompensationError] = useState('');
  useEffect(()=>{let active=true;setCompensationChanges([]);setCompensationError('');if(selected?.staffId)listCompensationChanges(selected.staffId).then(r=>{if(active)setCompensationChanges(r)}).catch(e=>{if(active)setCompensationError(e.message)});return()=>{active=false}},[selected?.staffId]);

  const loadStaff = useCallback(async () => {
    try {
      const rows = await listActiveHRStaffDirectory({
        branch: !allBranches && ownBranch ? ownBranch : null,
      });
      setStaff(rows.map((row) => ({
        id: String(row.account_id || row.staff_id || ''),
        staffId: String(row.staff_id || ''),
        username: String(row.username || ''),
        name: String(row.name || row.username || ''),
        branch: String(row.branch || ''),
        role: String(row.role || ''),
        active: row.active !== false,
      })));
    } catch (error) {
      setStaff([]);
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل دليل الموظفين');
    }
  }, [allBranches, ownBranch]);

  useEffect(() => { void loadStaff(); }, [loadStaff]);

  const loadPerson = useCallback(async (person: StaffRow, payrollMonth: string) => {
    setLoading(true);
    try {
      const cycleLabel = payrollMonth.slice(0, 7);
      const [canonicalProfile, finalizedHistory, legacyHistory, truth, readiness, canonicalComponents] = await Promise.all([
        fetchCompensationProfile(person.staffId).catch(() => null),
        person.staffId
          ? listFinalizedPayrollSnapshots(person.staffId, 24)
              .then((rows) => ({ rows, error: null as string | null }))
              .catch((error) => ({
                rows: [] as FinalizedPayrollSnapshotHistoryRow[],
                error: error instanceof Error ? error.message : 'تعذر تحميل سجل الرواتب النهائي',
              }))
          : Promise.resolve({ rows: [] as FinalizedPayrollSnapshotHistoryRow[], error: null as string | null }),
        listLegacyPaidPayrollHistory(person.username, 24).catch(() => []),
        person.staffId ? fetchPayrollIncentiveTruth(person.staffId, cycleLabel).catch(() => []) : Promise.resolve([]),
        person.staffId ? fetchAttendancePayrollReadiness(person.staffId, cycleLabel).catch(() => null) : Promise.resolve(null),
        person.staffId ? fetchPayrollComponents(person.staffId, cycleLabel).catch(() => null) : Promise.resolve(null),
      ]);

      setProfile(canonicalProfile ? {
        salaryCalculationMode: canonicalProfile.salary_calculation_mode === 'attendance_hours_v1'
          ? 'attendance_hours_v1'
          : canonicalProfile.salary_calculation_mode === 'monthly_hour_unit'
            ? 'monthly_hour_unit'
            : 'legacy_fixed',
        monthlyHourUnitValue: num(canonicalProfile.monthly_hour_unit_value),
        contractedDailyHours: num(canonicalProfile.contracted_daily_hours),
        attendanceMonthlyReferenceRate: num(canonicalProfile.hourly_rate),
        monthlyBaseSalary: num(canonicalProfile.monthly_base_salary),
        overtimeHourRate: num(canonicalProfile.overtime_hour_rate),
        monthlyIncentiveBase: num(canonicalProfile.monthly_incentive_base),
      } : emptyProfile());
      if (finalizedHistory.error) {
        toast.warning(`تعذر تحميل سجل الدورات النهائية: ${finalizedHistory.error}`);
      }
      const finalizedRows = (finalizedHistory.rows as FinalizedHistoryRow[]).map((row) => ({
        ...row,
        history_source: 'finalized_v2' as const,
      }));
      const finalizedCycles = new Set(finalizedRows.map((row) => row.month_cycle.slice(0, 7)));
      const legacyRows = (legacyHistory as MonthlyRow[])
        .filter(Boolean)
        .filter((row) => !finalizedCycles.has(String(row.payroll_month || '').slice(0, 7)))
        .map((row) => ({ ...row, history_source: 'legacy_v13' as const }));

      setHistory([
        ...finalizedRows.map((row) => ({
          id: row.id,
          staff_username: row.staff_username,
          payroll_month: row.month_cycle,
          deductions_total: num(row.deductions_total),
          net_salary: num(row.net_salary),
          status: 'finalized_v2',
          approved_by_name: row.finalized_by_name,
          freeze_version: 2,
          history_source: 'finalized_v2' as const,
          snapshot_fingerprint: row.snapshot_fingerprint,
          finalized_at: row.finalized_at,
        } as MonthlyRow & { snapshot_fingerprint?: string; finalized_at?: string })),
        ...legacyRows,
      ].sort((a, b) => String(b.payroll_month).localeCompare(String(a.payroll_month))));
      setAutomatedTruth((truth || []).filter(Boolean)[0] || null);
      setAttendanceReadiness(readiness);
      setComponents(canonicalComponents);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selected) void loadPerson(selected, month);
  }, [selected, month, loadPerson]);

  useEffect(() => {
    setWorkspaceTab('overview');
  }, [selected?.staffId]);

  const saveProfile = async () => {
    if (!selected) return;
    if (compensationReason.trim().length<5 || !compensationEffective) { toast.warning('حدد تاريخ السريان وسبب التغيير (٥ أحرف على الأقل).'); return; }
    if (profile.salaryCalculationMode === 'attendance_hours_v1' && profile.attendanceMonthlyReferenceRate <= 0) {
      toast.error('أدخل القيمة الشهرية المرجعية قبل تفعيل حساب الساعات الفعلية.');
      return;
    }
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
      toast.success('تم إرسال التعديل للاعتماد؛ القيم الحالية لم تتغير');
      setCompensationReason('');
      setCompensationChanges(await listCompensationChanges(selected.staffId));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر حفظ ملف التعويضات');
    } finally {
      setSaving(false);
    }
  };

  async function decideChange(id:string,approve:boolean){if(!selected)return;setSaving(true);try{await decideCompensationChange(id,approve,'');setCompensationChanges(await listCompensationChanges(selected.staffId));await loadPerson(selected,month);toast.success(approve?'تم اعتماد التعديل وتطبيقه':'تم رفض الطلب')}catch(e){toast.error(e instanceof Error?e.message:'تعذر اتخاذ القرار')}finally{setSaving(false)}}

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
      toast.error(error instanceof Error ? error.message : 'تعذر إصدار كشف الراتب النهائي');
    } finally {
      setExportingStatement(false);
    }
  }

  const filteredStaff = staff.filter((s) => !search.trim() || s.name.includes(search.trim()) || s.username.includes(search.trim()));
  return (
    <div className="space-y-5 p-4 md:p-6" dir="rtl">
      <div className="rounded-3xl border p-5" style={surface}>
        <div className="flex items-center gap-2 text-teal-200"><Banknote size={18} /><span className="text-xs font-black">إدارة الرواتب والحوافز · Engine V18</span></div>
        <h1 className="mt-1 text-2xl font-black text-white">كشوف رواتب الموظفين</h1>
        <p className="mt-1 text-sm" style={mutedText}>Attendance Truth + ملف تعويضات موحد + حوافز آلية + لستة أصناف + Finalization Gate قبل أي اعتماد مالي</p>
      </div>

      <PayrollCycleReadinessOverview
        monthCycle={month.slice(0, 7)}
        branch={allBranches ? null : ownBranch || null}
        onOpenStaffCompensation={(staffId) => {
          const person = staff.find((item) => item.staffId === staffId);
          if (!person) {
            toast.warning('الموظف غير موجود داخل نطاق الرواتب الحالي.');
            return;
          }
          setSelected(person);
          setWorkspaceTab('compensation');
        }}
      />

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="rounded-3xl border p-4" style={surface}>
          <div className="flex items-center gap-2 rounded-xl border px-3 py-2" style={surfaceSoft}>
            <Search size={15} className="text-teal-300" />
            <input className="w-full bg-transparent text-sm outline-none" placeholder="بحث بالاسم أو اليوزر" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="mt-3 max-h-[70vh] space-y-1.5 overflow-y-auto">
            {filteredStaff.map((s) => (
              <button key={s.id} onClick={() => setSelected(s)} className={`flex w-full items-center gap-2 rounded-xl border p-2.5 text-right text-sm transition ${selected?.id === s.id ? 'border-teal-400/50 bg-teal-400/10' : ''}`} style={selected?.id === s.id ? undefined : surfaceSoft}>
                <User size={15} className="text-teal-300" />
                <div><div className="font-black text-white">{s.name}</div><div className="text-[11px]" style={mutedText}>{s.branch}</div></div>
              </button>
            ))}
          </div>
        </div>

        {!selected ? (
          <div className="flex items-center justify-center rounded-3xl border p-10 text-sm" style={{ ...surface, ...mutedText }}>اختار موظف من القائمة لعرض ملف الراتب.</div>
        ) : loading ? (
          <div className="flex items-center justify-center rounded-3xl border p-10" style={surface}><RefreshCw className="animate-spin text-teal-300" /></div>
        ) : (
          <div className="space-y-4">
            <div className="sticky top-2 z-20 rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-3 shadow-lg">
              <div className="flex flex-wrap items-center gap-2">
                <div className="me-auto">
                  <div className="text-sm font-black text-white">{selected.name}</div>
                  <div className="text-[10px]" style={mutedText}>{selected.branch} · {selected.role || 'موظف'}</div>
                </div>
                <label className="text-[10px] font-bold" style={mutedText}>
                  دورة الراتب
                  <input type="month" className="input ms-2 !py-1 text-xs" value={month.slice(0, 7)} onChange={(e) => setMonth(`${e.target.value}-01`)} />
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
                  <button
                    key={id}
                    type="button"
                    onClick={() => setWorkspaceTab(id)}
                    className={`rounded-xl border px-3 py-2 text-xs font-black transition ${workspaceTab === id ? 'border-teal-400/50 bg-teal-400/10 text-teal-200' : 'border-[var(--dawaa-theme-border)] text-[var(--dawaa-theme-muted)]'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className={workspaceTab === 'overview' ? 'space-y-4' : 'hidden'}>
              <PayrollAttendanceSafetyGate staffId={selected.staffId} monthCycle={month.slice(0, 7)} />
              <div className="rounded-3xl border p-4" style={surface}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-black text-teal-200"><ShieldCheck size={16} /> جاهزية البصمة للرواتب</div>
                    <div className="mt-1 text-[10px]" style={mutedText}>قراءة تشخيصية من سجل البصمة؛ لا تُعدّل الراتب أو ساعات الأساسي تلقائيًا.</div>
                  </div>
                  <span className={`rounded-full border px-3 py-1 text-[10px] font-black ${attendanceReadiness?.status === 'ready' ? 'border-emerald-400/30 text-emerald-300' : 'border-amber-400/30 text-amber-200'}`}>
                    {attendanceReadiness?.status === 'ready' ? 'جاهزة للمراجعة' : attendanceReadiness ? 'تحتاج مراجعة' : 'لا توجد بيانات'}
                  </span>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-xs">
                  <div className="rounded-xl border p-3" style={surfaceSoft}><div style={mutedText}>ساعات البصمة المرشحة</div><div className="mt-1 text-lg font-black text-white">{num(attendanceReadiness?.candidateWorkedHours).toLocaleString('ar-EG')} ساعة</div></div>
                  <div className="rounded-xl border p-3" style={surfaceSoft}><div style={mutedText}>البصمات المقبولة</div><div className="mt-1 text-lg font-black text-white">{num(attendanceReadiness?.acceptedPunches).toLocaleString('ar-EG')}</div></div>
                  <div className="rounded-xl border p-3" style={surfaceSoft}><div style={mutedText}>تحتاج مراجعة</div><div className="mt-1 text-lg font-black text-white">{num(attendanceReadiness?.manualReviewPunches).toLocaleString('ar-EG')}</div></div>
                  <div className="rounded-xl border p-3" style={surfaceSoft}><div style={mutedText}>شيفتات مزدوجة صحيحة</div><div className="mt-1 text-lg font-black text-white">{num(attendanceReadiness?.pairedShifts).toLocaleString('ar-EG')}</div></div>
                </div>
                <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-[10px] font-bold text-amber-100">
                  ساعات البصمة للعرض والمراجعة فقط؛ لا تضرب في قيمة الساعة الشهرية ولا تُنسخ تلقائيًا إلى الأساسي. حساب الأساسي يظل من Compensation Profile وPayroll Engine المعتمد.
                </div>
              </div>
              <PayrollTransparencyPanel staffId={selected.staffId} monthCycle={month.slice(0, 7)} />
            </div>
            <div className={workspaceTab === 'compensation' ? 'rounded-3xl border p-5' : 'hidden'} style={surface}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-black text-teal-200"><WalletCards size={18} /> ملف التعويضات الموحد — {selected.name}</div>
                <span className="rounded-full border border-amber-400/30 bg-amber-400/5 px-3 py-1 text-[11px] font-black text-amber-200">الحافز الربع سنوي مؤرشف مؤقتًا ولا يدخل الحساب</span>
              </div>
              <div className="mt-4 rounded-xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] p-3 text-[11px] font-bold text-[var(--dawaa-status-info-text)]">
                القيم اليدوية أدناه مخصصة للمعاينة What-if فقط في المرحلة الحالية ولا تُكتب في سجل رواتب قديم. مصدر الأساسي الفعلي هو Payroll Engine V18.
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className="text-xs font-bold" style={mutedText}>طريقة حساب الأساسي
                  <select className="input mt-1 w-full" value={profile.salaryCalculationMode} onChange={(e) => setProfile((p) => ({ ...p, salaryCalculationMode: e.target.value as CompensationProfileState['salaryCalculationMode'] }))}>
                    <option value="attendance_hours_v1">الساعات الفعلية المعتمدة — Attendance Truth</option>
                    <option value="monthly_hour_unit">قيمة الساعة الشهرية × ساعات الدوام اليومية</option>
                    <option value="legacy_fixed">راتب أساسي ثابت — نظام قديم</option>
                  </select>
                </label>
                {profile.salaryCalculationMode === 'attendance_hours_v1' ? <>
                  <label className="text-xs font-bold" style={mutedText}>القيمة الشهرية المرجعية للساعة<input type="number" className="input mt-1 w-full" value={profile.attendanceMonthlyReferenceRate} onChange={(e) => setProfile((p) => ({ ...p, attendanceMonthlyReferenceRate: num(e.target.value) }))} /></label>
                  <div className="rounded-xl border p-3 text-xs" style={surfaceSoft}>
                    <div style={mutedText}>قيمة الساعة الفعلية للحساب</div>
                    <div className="mt-1 text-lg font-black text-teal-200">{formatCurrency(profile.attendanceMonthlyReferenceRate / 26)}</div>
                    <div className="mt-1 text-[10px]" style={mutedText}>الأساسي = ساعات Attendance Truth المعتمدة × هذه القيمة. التأخير لا يُخصم مرة ثانية، والـOT منفصل.</div>
                  </div>
                </> : profile.salaryCalculationMode === 'monthly_hour_unit' ? <>
                  <label className="text-xs font-bold" style={mutedText}>قيمة الساعة الشهرية<input type="number" className="input mt-1 w-full" value={profile.monthlyHourUnitValue} onChange={(e) => setProfile((p) => ({ ...p, monthlyHourUnitValue: num(e.target.value) }))} /></label>
                  <label className="text-xs font-bold" style={mutedText}>ساعات الدوام اليومية<input type="number" className="input mt-1 w-full" value={profile.contractedDailyHours} onChange={(e) => setProfile((p) => ({ ...p, contractedDailyHours: num(e.target.value) }))} /></label>
                </> : <label className="text-xs font-bold" style={mutedText}>الراتب الأساسي الثابت<input type="number" className="input mt-1 w-full" value={profile.monthlyBaseSalary} onChange={(e) => setProfile((p) => ({ ...p, monthlyBaseSalary: num(e.target.value) }))} /></label>}
                <label className="text-xs font-bold" style={mutedText}>الحافز الشهري<input type="number" className="input mt-1 w-full" value={profile.monthlyIncentiveBase} onChange={(e) => setProfile((p) => ({ ...p, monthlyIncentiveBase: num(e.target.value) }))} /></label>
                <label className="text-xs font-bold" style={mutedText}>سعر ساعة الإضافي<input type="number" className="input mt-1 w-full" value={profile.overtimeHourRate} onChange={(e) => setProfile((p) => ({ ...p, overtimeHourRate: num(e.target.value) }))} /></label>
                <div className="rounded-xl border p-3 text-xs" style={surfaceSoft}>
                  <div style={mutedText}>الأساسي المتوقع</div>
                  <div className="mt-1 text-lg font-black text-teal-200">{formatCurrency(profile.salaryCalculationMode === 'attendance_hours_v1' ? num(components?.baseSalaryComponent) : profile.salaryCalculationMode === 'monthly_hour_unit' ? profile.monthlyHourUnitValue * profile.contractedDailyHours : profile.monthlyBaseSalary)}</div>
                </div>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2"><label className="text-xs">تاريخ سريان التعديل<input type="date" className="input mt-1 w-full" value={compensationEffective} onChange={e=>setCompensationEffective(e.target.value)}/></label><label className="text-xs">سبب التغيير<input className="input mt-1 w-full" maxLength={500} value={compensationReason} onChange={e=>setCompensationReason(e.target.value)}/></label></div>
              <button className="btn-primary mt-4 flex items-center gap-2" disabled={saving} onClick={() => void saveProfile()}><Save size={16} /> طلب اعتماد تعديل التعويضات</button>
              <div className="mt-4"><h3 className="font-bold">طلبات التعويضات وسجل الاعتماد</h3>{compensationError&&<p role="alert" className="text-red-400">{compensationError}</p>}{compensationChanges.map(change=><div key={change.id} className="mt-2 rounded-xl border p-3 text-xs" style={surfaceSoft}><div>{change.state==='pending'?'قيد الاعتماد':change.state==='approved'?'معتمد':'مرفوض'} · يسري من {change.effective_from} · {change.reason}</div><div className="mt-1">طريقة الحساب: {String(change.proposed.salary_calculation_mode)} · الأساسي الثابت: {String(change.proposed.monthly_base_salary)} · قيمة الساعة الشهرية: {String(change.proposed.monthly_hour_unit_value)} · ساعات اليوم: {String(change.proposed.contracted_daily_hours)} · الحافز الشهري: {String(change.proposed.monthly_incentive_base)} · سعر الإضافي: {String(change.proposed.overtime_hour_rate)}</div>{change.state==='pending'&&user?.role==='general_manager'&&change.requested_by!==user.id&&<div className="mt-2 flex gap-2"><button className="btn-primary" disabled={saving} onClick={()=>void decideChange(change.id,true)}>اعتماد وتطبيق</button><button className="btn-secondary" disabled={saving} onClick={()=>void decideChange(change.id,false)}>رفض</button></div>}</div>)}</div>
            </div>

            <div className={workspaceTab === 'adjustments' ? 'block' : 'hidden'}>
              <PayrollManualEntriesPanel staffId={selected.staffId} monthCycle={month.slice(0, 7)} />
            </div>

            <div className={workspaceTab === 'incentives' ? 'rounded-3xl border p-5' : 'hidden'} style={surface}>
              <div className="flex items-center gap-2 font-black text-teal-200"><PackageCheck size={18} /> تفاصيل لستة أصناف الحوافز</div>
              <p className="mt-1 text-xs" style={mutedText}>كل صنف يظهر بالكمية المباعة وقيمة الحافز للوحدة وإجمالي استحقاق الدكتور. الإجمالي يدخل الراتب آليًا.</p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[640px] text-right text-xs"><thead><tr className="border-b" style={mutedText}><th className="p-2">الصنف</th><th className="p-2">الكمية</th><th className="p-2">حافز الوحدة</th><th className="p-2">الإجمالي</th></tr></thead><tbody>{components?.listItems.length ? components.listItems.map((item) => <tr key={`${item.medicineId}-${item.productName}`} className="border-b"><td className="p-2 font-bold text-white">{item.productName}</td><td className="p-2">{item.quantity}</td><td className="p-2">{formatCurrency(item.incentivePerUnit)}</td><td className="p-2 font-black text-emerald-300">{formatCurrency(item.incentiveTotal)}</td></tr>) : <tr><td colSpan={4} className="p-5 text-center" style={mutedText}>لا توجد مبيعات مسجلة على لستة الحوافز لهذه الدورة.</td></tr>}</tbody></table>
              </div>
            </div>

            {automatedTruth ? <div className={workspaceTab === 'incentives' ? 'rounded-3xl border p-5' : 'hidden'} style={surface}>
              <div className="flex items-center gap-2 font-black text-teal-200"><Trophy size={18} /> الحوافز الآلية</div>
              <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4"><div>التارجت: <b>{formatCurrency(automatedTruth.targetBonus)}</b></div><div>الأداء: <b>{formatCurrency(automatedTruth.performanceIncentive)}</b></div><div>متابعة العملاء: <b>{formatCurrency(automatedTruth.followupThresholdBonus)}</b></div><div>طلبات العملاء: <b>{formatCurrency(automatedTruth.customerRequestThresholdBonus)}</b></div><div>نجم الفرع: <b>{formatCurrency(automatedTruth.branchStarBonus)}</b></div><div>الإجمالي الآلي: <b className="text-emerald-300">{formatCurrency(automatedTruth.automatedTotal)}</b></div></div>
            </div> : null}

            {history.length ? <div className={workspaceTab === 'history' ? 'rounded-3xl border p-5' : 'hidden'} style={surface}>
              <div className="flex items-center gap-2 font-black text-teal-200"><ClipboardList size={18} /> آخر الدورات</div>
              <p className="mt-2 text-xs" style={mutedText}>Final Snapshot V2 يستخدم كشف الشفافية الجديد الكامل. الدورات القديمة المدفوعة تظل متاحة من أرشيف V13.</p>
              <div className="mt-3 space-y-2">{history.map((h) => <div key={`${h.history_source || 'legacy_v13'}-${h.payroll_month}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm" style={surfaceSoft}><div><span className="font-black text-white">{h.payroll_month?.slice(0, 7)}</span><div className="mt-1 text-[10px]" style={mutedText}>{h.history_source === 'finalized_v2' ? 'Final Snapshot V2' : 'Legacy Payroll Archive'}</div></div><span className="flex items-center gap-1 text-emerald-300"><Trophy size={13} /> {formatCurrency(num(h.net_salary))}</span><span className="flex items-center gap-1 text-rose-300"><TrendingDown size={13} /> {formatCurrency(num(h.deductions_total))}</span><span className="rounded-full px-3 py-1 text-xs font-black text-teal-200" style={surface}>{STATUS_OPTIONS.find((s) => s.key === h.status)?.label || h.status}</span>{(h.history_source === 'finalized_v2' || h.status === 'paid')&&<button className="btn-secondary" disabled={exportingStatement} onClick={()=>void exportFinalStatement(h.payroll_month,h.history_source === 'finalized_v2' ? 'finalized_v2' : 'legacy_v13')}>كشف PDF النهائي</button>}</div>)}</div>
            </div> : null}
          </div>
        )}
      </div>
    </div>
  );
}
