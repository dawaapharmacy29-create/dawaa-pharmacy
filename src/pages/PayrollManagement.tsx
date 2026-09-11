import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Activity, AlertTriangle, Banknote, CalendarClock, CheckCircle2, ClipboardList,
  LockKeyhole, PackageCheck, RefreshCw, Save, Search, ShieldCheck, TrendingDown,
  Trophy, User, WalletCards,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { normalizeBranchName } from '@/lib/branch';
import { formatCurrency } from '@/lib/utils';
import { getCurrentCycle, formatCycleDate } from '@/lib/pharmacy-cycle';
import { fetchPayrollIncentiveTruth, type PayrollIncentiveTruth } from '@/lib/incentives/payrollIncentiveTruthService';
import {
  fetchAttendancePayrollReadiness,
  type AttendancePayrollReadiness,
} from '@/lib/payroll/attendancePayrollReadinessService';
import {
  fetchCompensationProfile,
  fetchPayrollComponents,
  saveCompensationProfile,
  savePayrollV17,
  type PayrollComponents,
} from '@/lib/payroll/payrollCompensationService';

const surface = { background: 'var(--dawaa-theme-surface)', borderColor: 'var(--dawaa-theme-border)' };
const surfaceSoft = { background: 'var(--dawaa-theme-bg-soft)', borderColor: 'var(--dawaa-theme-border)' };
const mutedText = { color: 'var(--dawaa-theme-muted)' };

type Row = Record<string, unknown>;
type StaffRow = { id: string; staffId: string; username: string; name: string; branch: string; role: string; active: boolean };
type CompensationProfileState = {
  salaryCalculationMode: 'legacy_fixed' | 'monthly_hour_unit';
  monthlyHourUnitValue: number;
  contractedDailyHours: number;
  monthlyBaseSalary: number;
  overtimeHourRate: number;
  monthlyIncentiveBase: number;
};
type MonthlyRow = {
  id?: string;
  staff_username: string;
  payroll_month: string;
  worked_hours: number;
  overtime_hours: number;
  incentives_total: number;
  manual_adjustment: number;
  expiry_shortage_deduction: number;
  branch_general_deduction: number;
  individual_deduction: number;
  other_deduction: number;
  deductions_total: number;
  base_salary_component?: number;
  monthly_incentive_component?: number;
  list_incentive_component?: number;
  overtime_component?: number;
  target_bonus?: number;
  net_salary?: number | null;
  salary_engine_version?: number | null;
  status: string;
  notes: string;
  freeze_version?: number | null;
  approved_by_name?: string | null;
};

const STATUS_OPTIONS = [
  { key: 'draft', label: 'مسودة' },
  { key: 'review', label: 'مراجعة' },
  { key: 'approved', label: 'معتمد' },
  { key: 'paid', label: 'مدفوع' },
];

function num(v: unknown) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function emptyProfile(): CompensationProfileState {
  return {
    salaryCalculationMode: 'monthly_hour_unit',
    monthlyHourUnitValue: 0,
    contractedDailyHours: 0,
    monthlyBaseSalary: 0,
    overtimeHourRate: 0,
    monthlyIncentiveBase: 0,
  };
}

function emptyMonthly(username: string, month: string): MonthlyRow {
  return {
    staff_username: username,
    payroll_month: month,
    worked_hours: 0,
    overtime_hours: 0,
    incentives_total: 0,
    manual_adjustment: 0,
    expiry_shortage_deduction: 0,
    branch_general_deduction: 0,
    individual_deduction: 0,
    other_deduction: 0,
    deductions_total: 0,
    status: 'draft',
    notes: '',
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
  const [profile, setProfile] = useState<CompensationProfileState>(emptyProfile());
  const [monthly, setMonthly] = useState<MonthlyRow | null>(null);
  const [components, setComponents] = useState<PayrollComponents | null>(null);
  const [automatedTruth, setAutomatedTruth] = useState<PayrollIncentiveTruth | null>(null);
  const [attendanceReadiness, setAttendanceReadiness] = useState<AttendancePayrollReadiness | null>(null);
  const [history, setHistory] = useState<MonthlyRow[]>([]);
  const [month, setMonth] = useState(currentMonth);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadStaff = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_staff_accounts_directory', {
      p_roles: null,
      p_branch: !allBranches && ownBranch ? ownBranch : null,
    });
    if (error) {
      setStaff([]);
      toast.error(error.message || 'تعذر تحميل دليل الموظفين');
      return;
    }
    const rows = ((data || []) as Row[]).filter(Boolean);
    setStaff(rows
      .filter((r: any) => r.active !== false && r.username)
      .map((r: any) => ({
        id: String(r.account_id || r.staff_id || ''),
        staffId: String(r.staff_id || ''),
        username: String(r.username || ''),
        name: String(r.name || r.username || ''),
        branch: String(r.branch || ''),
        role: String(r.role || ''),
        active: r.active !== false,
      })));
  }, [allBranches, ownBranch]);

  useEffect(() => { void loadStaff(); }, [loadStaff]);

  const loadPerson = useCallback(async (person: StaffRow, payrollMonth: string) => {
    setLoading(true);
    try {
      const cycleLabel = payrollMonth.slice(0, 7);
      const [canonicalProfile, currentResult, historyResult, truth, readiness, canonicalComponents] = await Promise.all([
        fetchCompensationProfile(person.staffId).catch(() => null),
        supabase.from('staff_payroll_monthly_v13').select('*').eq('staff_username', person.username).eq('payroll_month', payrollMonth).maybeSingle(),
        supabase.from('staff_payroll_monthly_v13').select('*').eq('staff_username', person.username).order('payroll_month', { ascending: false }).limit(6),
        person.staffId ? fetchPayrollIncentiveTruth(person.staffId, cycleLabel).catch(() => []) : Promise.resolve([]),
        person.staffId ? fetchAttendancePayrollReadiness(person.staffId, cycleLabel).catch(() => null) : Promise.resolve(null),
        person.staffId ? fetchPayrollComponents(person.staffId, cycleLabel).catch(() => null) : Promise.resolve(null),
      ]);

      setProfile(canonicalProfile ? {
        salaryCalculationMode: canonicalProfile.salary_calculation_mode === 'monthly_hour_unit' ? 'monthly_hour_unit' : 'legacy_fixed',
        monthlyHourUnitValue: num(canonicalProfile.monthly_hour_unit_value),
        contractedDailyHours: num(canonicalProfile.contracted_daily_hours),
        monthlyBaseSalary: num(canonicalProfile.monthly_base_salary),
        overtimeHourRate: num(canonicalProfile.overtime_hour_rate),
        monthlyIncentiveBase: num(canonicalProfile.monthly_incentive_base),
      } : emptyProfile());
      setMonthly((currentResult.data as MonthlyRow) || emptyMonthly(person.username, payrollMonth));
      setHistory(((historyResult.data || []) as MonthlyRow[]).filter(Boolean));
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

  const monthlyFrozen = monthly?.status === 'approved' || monthly?.status === 'paid';
  const monthlyPaid = monthly?.status === 'paid';
  const totalDeductions = useMemo(() => {
    if (!monthly) return 0;
    return num(monthly.expiry_shortage_deduction)
      + num(monthly.branch_general_deduction)
      + num(monthly.individual_deduction)
      + num(monthly.other_deduction);
  }, [monthly]);

  const overtimeValue = num(monthly?.overtime_hours) * num(components?.overtimeHourRate);
  const netSalaryPreview = useMemo(() => {
    if (!monthly) return 0;
    if (monthlyFrozen && monthly.net_salary != null) return num(monthly.net_salary);
    return num(components?.baseSalaryComponent)
      + num(components?.monthlyIncentiveComponent)
      + num(components?.listIncentiveComponent)
      + num(automatedTruth?.automatedTotal)
      + num(monthly.overtime_hours) * num(components?.overtimeHourRate)
      + num(monthly.incentives_total)
      + num(monthly.manual_adjustment)
      - totalDeductions;
  }, [monthly, monthlyFrozen, components, automatedTruth, totalDeductions]);

  const saveProfile = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await saveCompensationProfile({
        staffId: selected.staffId,
        staffName: selected.name,
        branch: selected.branch,
        salaryCalculationMode: profile.salaryCalculationMode,
        monthlyHourUnitValue: profile.monthlyHourUnitValue,
        contractedDailyHours: profile.contractedDailyHours,
        monthlyBaseSalary: profile.monthlyBaseSalary,
        overtimeHourRate: profile.overtimeHourRate,
        monthlyIncentiveBase: profile.monthlyIncentiveBase,
      });
      toast.success('تم حفظ ملف التعويضات الموحد');
      await loadPerson(selected, month);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر حفظ ملف التعويضات');
    } finally {
      setSaving(false);
    }
  };

  const saveMonthly = async () => {
    if (!monthly || !selected) return;
    if (monthlyPaid) {
      toast.error('الكشف مدفوع ومقفول نهائيًا. أي تصحيح لاحق يتم كتسوية مستقلة موثقة.');
      return;
    }
    setSaving(true);
    try {
      await savePayrollV17({
        staffUsername: monthly.staff_username,
        payrollMonth: monthly.payroll_month,
        workedHours: num(monthly.worked_hours),
        overtimeHours: num(monthly.overtime_hours),
        manualIncentives: num(monthly.incentives_total),
        expiryShortageDeduction: num(monthly.expiry_shortage_deduction),
        branchGeneralDeduction: num(monthly.branch_general_deduction),
        individualDeduction: num(monthly.individual_deduction),
        otherDeduction: num(monthly.other_deduction),
        manualAdjustment: num(monthly.manual_adjustment),
        notes: monthly.notes,
        status: monthly.status,
      });
      toast.success(monthly.status === 'approved'
        ? 'تم اعتماد كشف V17 وتجميد كل مكوناته'
        : monthly.status === 'paid'
          ? 'تم تعليم الكشف كمدفوع وإقفاله نهائيًا'
          : 'تم حفظ كشف الدورة');
      await loadPerson(selected, month);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر حفظ كشف الدورة');
    } finally {
      setSaving(false);
    }
  };

  const filteredStaff = staff.filter((s) => !search.trim() || s.name.includes(search.trim()) || s.username.includes(search.trim()));
  const statusOptions = monthlyPaid
    ? STATUS_OPTIONS.filter((s) => s.key === 'paid')
    : monthly?.status === 'approved'
      ? STATUS_OPTIONS.filter((s) => s.key === 'approved' || s.key === 'paid')
      : STATUS_OPTIONS.filter((s) => s.key !== 'paid');

  const summaryCards = [
    ['الراتب الأساسي', num(monthlyFrozen ? monthly?.base_salary_component : components?.baseSalaryComponent)],
    ['الحافز الشهري', num(monthlyFrozen ? monthly?.monthly_incentive_component : components?.monthlyIncentiveComponent)],
    ['حافز التارجت', num(monthlyFrozen ? monthly?.target_bonus : automatedTruth?.targetBonus)],
    ['حافز اللستة', num(monthlyFrozen ? monthly?.list_incentive_component : components?.listIncentiveComponent)],
    ['إجمالي الخصومات', monthlyFrozen ? num(monthly?.deductions_total) : totalDeductions],
    ['صافي الراتب', netSalaryPreview],
  ] as const;

  return (
    <div className="space-y-5 p-4 md:p-6" dir="rtl">
      <div className="rounded-3xl border p-5" style={surface}>
        <div className="flex items-center gap-2 text-teal-200"><Banknote size={18} /><span className="text-xs font-black">إدارة الرواتب والحوافز · V17</span></div>
        <h1 className="mt-1 text-2xl font-black text-white">كشوف رواتب الموظفين</h1>
        <p className="mt-1 text-sm" style={mutedText}>ملف تعويضات موحد + حوافز آلية + لستة أصناف + خصومات مفصلة + Snapshot عند الاعتماد</p>
      </div>

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
            <div className="rounded-3xl border p-5" style={surface}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-black text-teal-200"><WalletCards size={18} /> ملف التعويضات الموحد — {selected.name}</div>
                <span className="rounded-full border border-amber-400/30 bg-amber-400/5 px-3 py-1 text-[11px] font-black text-amber-200">الحافز الربع سنوي مؤرشف مؤقتًا ولا يدخل الحساب</span>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className="text-xs font-bold" style={mutedText}>طريقة حساب الأساسي
                  <select className="input mt-1 w-full" value={profile.salaryCalculationMode} onChange={(e) => setProfile((p) => ({ ...p, salaryCalculationMode: e.target.value as CompensationProfileState['salaryCalculationMode'] }))}>
                    <option value="monthly_hour_unit">قيمة الساعة الشهرية × ساعات الدوام اليومية</option>
                    <option value="legacy_fixed">راتب أساسي ثابت — نظام قديم</option>
                  </select>
                </label>
                {profile.salaryCalculationMode === 'monthly_hour_unit' ? <>
                  <label className="text-xs font-bold" style={mutedText}>قيمة الساعة الشهرية<input type="number" className="input mt-1 w-full" value={profile.monthlyHourUnitValue} onChange={(e) => setProfile((p) => ({ ...p, monthlyHourUnitValue: num(e.target.value) }))} /></label>
                  <label className="text-xs font-bold" style={mutedText}>ساعات الدوام اليومية<input type="number" className="input mt-1 w-full" value={profile.contractedDailyHours} onChange={(e) => setProfile((p) => ({ ...p, contractedDailyHours: num(e.target.value) }))} /></label>
                </> : <label className="text-xs font-bold" style={mutedText}>الراتب الأساسي الثابت<input type="number" className="input mt-1 w-full" value={profile.monthlyBaseSalary} onChange={(e) => setProfile((p) => ({ ...p, monthlyBaseSalary: num(e.target.value) }))} /></label>}
                <label className="text-xs font-bold" style={mutedText}>الحافز الشهري<input type="number" className="input mt-1 w-full" value={profile.monthlyIncentiveBase} onChange={(e) => setProfile((p) => ({ ...p, monthlyIncentiveBase: num(e.target.value) }))} /></label>
                <label className="text-xs font-bold" style={mutedText}>سعر ساعة الإضافي<input type="number" className="input mt-1 w-full" value={profile.overtimeHourRate} onChange={(e) => setProfile((p) => ({ ...p, overtimeHourRate: num(e.target.value) }))} /></label>
                <div className="rounded-xl border p-3 text-xs" style={surfaceSoft}>
                  <div style={mutedText}>الأساسي المتوقع</div>
                  <div className="mt-1 text-lg font-black text-teal-200">{formatCurrency(profile.salaryCalculationMode === 'monthly_hour_unit' ? profile.monthlyHourUnitValue * profile.contractedDailyHours : profile.monthlyBaseSalary)}</div>
                </div>
              </div>
              <button className="btn-primary mt-4 flex items-center gap-2" disabled={saving} onClick={() => void saveProfile()}><Save size={16} /> حفظ ملف التعويضات</button>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
              {summaryCards.map(([label, value], index) => <div key={label} className="rounded-2xl border p-3" style={surface}><div className="text-[11px]" style={mutedText}>{label}</div><div className={`mt-1 font-black ${index === 5 ? 'text-teal-200' : index === 4 ? 'text-rose-300' : 'text-white'}`}>{formatCurrency(value)}</div></div>)}
            </div>

            <div className="rounded-3xl border p-5" style={surface}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 font-black text-teal-200"><CalendarClock size={18} /> كشف الدورة</div>
                <input type="month" className="input" value={month.slice(0, 7)} onChange={(e) => setMonth(`${e.target.value}-01`)} />
              </div>

              {monthlyFrozen ? <div className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-400/30 bg-amber-400/5 p-3 text-xs text-amber-200"><LockKeyhole size={16} /><b>{monthlyPaid ? 'الكشف مدفوع ومقفول نهائيًا.' : `الكشف معتمد ومجمد Snapshot v${monthly?.freeze_version || monthly?.salary_engine_version || 17}.`}</b></div> : null}

              <div className="mt-4 rounded-2xl border p-4" style={surfaceSoft}>
                <div className="flex items-start gap-2">
                  {attendanceReadiness?.status === 'ready' ? <ShieldCheck size={18} className="text-emerald-300" /> : attendanceReadiness?.status === 'needs_review' ? <AlertTriangle size={18} className="text-amber-300" /> : <Activity size={18} className="text-slate-400" />}
                  <div><div className="text-xs font-black text-teal-200">جاهزية البصمة</div><div className="mt-1 text-[11px]" style={mutedText}>البصمة تراقب الحضور والغياب والمراجعة؛ لا تضرب في قيمة الساعة الشهرية لتكوين الراتب الأساسي.</div></div>
                </div>
                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3"><div>أحداث البصمة: <b>{attendanceReadiness?.rawBiometricEvents ?? 0}</b></div><div>شيفتات مكتملة: <b>{attendanceReadiness?.pairedShifts ?? 0}</b></div><div>ساعات مرشحة: <b className="text-teal-200">{attendanceReadiness?.candidateWorkedHours ?? 0} ساعة</b></div></div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className="text-xs font-bold" style={mutedText}>ساعات العمل من المراجعة<input disabled={monthlyFrozen} type="number" className="input mt-1 w-full" value={monthly?.worked_hours ?? 0} onChange={(e) => setMonthly((m) => m && ({ ...m, worked_hours: num(e.target.value) }))} /></label>
                <label className="text-xs font-bold" style={mutedText}>ساعات إضافية<input disabled={monthlyFrozen} type="number" className="input mt-1 w-full" value={monthly?.overtime_hours ?? 0} onChange={(e) => setMonthly((m) => m && ({ ...m, overtime_hours: num(e.target.value) }))} /><span className="mt-1 block text-[10px] text-teal-300">قيمة الإضافي الحالية: {formatCurrency(overtimeValue)}</span></label>
                <label className="text-xs font-bold" style={mutedText}>حوافز يدوية أخرى<input disabled={monthlyFrozen} type="number" className="input mt-1 w-full" value={monthly?.incentives_total ?? 0} onChange={(e) => setMonthly((m) => m && ({ ...m, incentives_total: num(e.target.value) }))} /><span className="mt-1 block text-[10px] text-amber-300">لا تدخل التارجت أو اللستة أو النقاط هنا؛ كلها آلية.</span></label>
                <label className="text-xs font-bold" style={mutedText}>خصم عجز / نير إكسبير / إكسبير<input disabled={monthlyFrozen} type="number" className="input mt-1 w-full" value={monthly?.expiry_shortage_deduction ?? 0} onChange={(e) => setMonthly((m) => m && ({ ...m, expiry_shortage_deduction: num(e.target.value) }))} /></label>
                <label className="text-xs font-bold" style={mutedText}>خصم عام على الفرع<input disabled={monthlyFrozen} type="number" className="input mt-1 w-full" value={monthly?.branch_general_deduction ?? 0} onChange={(e) => setMonthly((m) => m && ({ ...m, branch_general_deduction: num(e.target.value) }))} /></label>
                <label className="text-xs font-bold" style={mutedText}>خصم فردي<input disabled={monthlyFrozen} type="number" className="input mt-1 w-full" value={monthly?.individual_deduction ?? 0} onChange={(e) => setMonthly((m) => m && ({ ...m, individual_deduction: num(e.target.value) }))} /></label>
                <label className="text-xs font-bold" style={mutedText}>خصومات أخرى<input disabled={monthlyFrozen} type="number" className="input mt-1 w-full" value={monthly?.other_deduction ?? 0} onChange={(e) => setMonthly((m) => m && ({ ...m, other_deduction: num(e.target.value) }))} /></label>
                <label className="text-xs font-bold" style={mutedText}>تسوية يدوية (+/-)<input disabled={monthlyFrozen} type="number" className="input mt-1 w-full" value={monthly?.manual_adjustment ?? 0} onChange={(e) => setMonthly((m) => m && ({ ...m, manual_adjustment: num(e.target.value) }))} /></label>
                <label className="text-xs font-bold" style={mutedText}>الحالة<select disabled={monthlyPaid} className="input mt-1 w-full" value={monthly?.status ?? 'draft'} onChange={(e) => setMonthly((m) => m && ({ ...m, status: e.target.value }))}>{statusOptions.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
              </div>

              <div className="mt-4 flex items-center justify-between rounded-2xl border p-4" style={surfaceSoft}><span className="font-black text-white">{monthlyFrozen ? 'صافي الراتب المجمد' : 'صافي الراتب المتوقع'}</span><span className="text-xl font-black text-teal-200">{formatCurrency(netSalaryPreview)}</span></div>
              <button className="btn-primary mt-4 flex items-center gap-2" disabled={saving || monthlyPaid} onClick={() => void saveMonthly()}><CheckCircle2 size={16} /> {monthly?.status === 'approved' ? 'اعتماد وتجميد الكشف' : monthly?.status === 'paid' ? 'الكشف مدفوع' : 'حفظ كشف الدورة'}</button>
            </div>

            <div className="rounded-3xl border p-5" style={surface}>
              <div className="flex items-center gap-2 font-black text-teal-200"><PackageCheck size={18} /> تفاصيل لستة أصناف الحوافز</div>
              <p className="mt-1 text-xs" style={mutedText}>كل صنف يظهر بالكمية المباعة وقيمة الحافز للوحدة وإجمالي استحقاق الدكتور. الإجمالي يدخل الراتب آليًا.</p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[640px] text-right text-xs"><thead><tr className="border-b" style={mutedText}><th className="p-2">الصنف</th><th className="p-2">الكمية</th><th className="p-2">حافز الوحدة</th><th className="p-2">الإجمالي</th></tr></thead><tbody>{components?.listItems.length ? components.listItems.map((item) => <tr key={`${item.medicineId}-${item.productName}`} className="border-b"><td className="p-2 font-bold text-white">{item.productName}</td><td className="p-2">{item.quantity}</td><td className="p-2">{formatCurrency(item.incentivePerUnit)}</td><td className="p-2 font-black text-emerald-300">{formatCurrency(item.incentiveTotal)}</td></tr>) : <tr><td colSpan={4} className="p-5 text-center" style={mutedText}>لا توجد مبيعات مسجلة على لستة الحوافز لهذه الدورة.</td></tr>}</tbody></table>
              </div>
            </div>

            {automatedTruth ? <div className="rounded-3xl border p-5" style={surface}>
              <div className="flex items-center gap-2 font-black text-teal-200"><Trophy size={18} /> الحوافز الآلية</div>
              <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4"><div>التارجت: <b>{formatCurrency(automatedTruth.targetBonus)}</b></div><div>الأداء: <b>{formatCurrency(automatedTruth.performanceIncentive)}</b></div><div>متابعة العملاء: <b>{formatCurrency(automatedTruth.followupThresholdBonus)}</b></div><div>طلبات العملاء: <b>{formatCurrency(automatedTruth.customerRequestThresholdBonus)}</b></div><div>نجم الفرع: <b>{formatCurrency(automatedTruth.branchStarBonus)}</b></div><div>الإجمالي الآلي: <b className="text-emerald-300">{formatCurrency(automatedTruth.automatedTotal)}</b></div></div>
            </div> : null}

            {history.length ? <div className="rounded-3xl border p-5" style={surface}>
              <div className="flex items-center gap-2 font-black text-teal-200"><ClipboardList size={18} /> آخر الدورات</div>
              <div className="mt-3 space-y-2">{history.map((h) => <div key={h.payroll_month} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm" style={surfaceSoft}><span className="font-black text-white">{h.payroll_month?.slice(0, 7)}</span><span className="flex items-center gap-1 text-emerald-300"><Trophy size={13} /> {formatCurrency(num(h.net_salary))}</span><span className="flex items-center gap-1 text-rose-300"><TrendingDown size={13} /> {formatCurrency(num(h.deductions_total))}</span><span className="rounded-full px-3 py-1 text-xs font-black text-teal-200" style={surface}>{STATUS_OPTIONS.find((s) => s.key === h.status)?.label || h.status}</span></div>)}</div>
            </div> : null}
          </div>
        )}
      </div>
    </div>
  );
}
