import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Activity, AlertTriangle, Banknote, CalendarClock, CheckCircle2, ClipboardList,
  LockKeyhole, RefreshCw, Save, Search, ShieldCheck, TrendingDown, Trophy, User, WalletCards,
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

const surface = { background: 'var(--dawaa-theme-surface)', borderColor: 'var(--dawaa-theme-border)' };
const surfaceSoft = { background: 'var(--dawaa-theme-bg-soft)', borderColor: 'var(--dawaa-theme-border)' };
const mutedText = { color: 'var(--dawaa-theme-muted)' };

type Row = Record<string, unknown>;
type StaffRow = { id: string; staffId: string; username: string; name: string; branch: string; role: string; active: boolean };
type Profile = {
  staff_username: string; staff_name?: string; role?: string; branch?: string;
  base_salary: number; hourly_rate: number; target_bonus_amount: number; quarterly_bonus_amount: number;
  active: boolean; notes: string;
};
type MonthlyRow = {
  id?: string; staff_username: string; payroll_month: string;
  worked_hours: number; overtime_hours: number; target_bonus: number; quarterly_bonus: number;
  incentives_total: number; deductions_total: number; manual_adjustment: number;
  net_salary?: number | null; status: string; notes: string;
  freeze_version?: number | null; approval_snapshot?: Record<string, unknown> | null;
  approved_at?: string | null; approved_by_name?: string | null;
  paid_at?: string | null; paid_by_name?: string | null;
};

const STATUS_OPTIONS = [
  { key: 'draft', label: 'مسودة' },
  { key: 'review', label: 'مراجعة' },
  { key: 'approved', label: 'معتمد' },
  { key: 'paid', label: 'مدفوع' },
];

function num(v: unknown) { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; }
function emptyProfile(username: string): Profile {
  return { staff_username: username, base_salary: 0, hourly_rate: 0, target_bonus_amount: 0, quarterly_bonus_amount: 0, active: true, notes: '' };
}
function emptyMonthly(username: string, month: string): MonthlyRow {
  return { staff_username: username, payroll_month: month, worked_hours: 0, overtime_hours: 0, target_bonus: 0, quarterly_bonus: 0, incentives_total: 0, deductions_total: 0, manual_adjustment: 0, status: 'draft', notes: '' };
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
  const [profile, setProfile] = useState<Profile | null>(null);
  const [monthly, setMonthly] = useState<MonthlyRow | null>(null);
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

  const loadPerson = useCallback(async (person: StaffRow, m: string) => {
    setLoading(true);
    try {
      const cycleLabel = m.slice(0, 7);
      const [{ data: p }, { data: cur }, { data: hist }, truth, readiness] = await Promise.all([
        supabase.from('staff_payroll_profiles_v13').select('*').eq('staff_username', person.username).maybeSingle(),
        supabase.from('staff_payroll_monthly_v13').select('*').eq('staff_username', person.username).eq('payroll_month', m).maybeSingle(),
        supabase.from('staff_payroll_monthly_v13').select('*').eq('staff_username', person.username).order('payroll_month', { ascending: false }).limit(6),
        person.staffId ? fetchPayrollIncentiveTruth(person.staffId, cycleLabel).catch(() => []) : Promise.resolve([]),
        person.staffId ? fetchAttendancePayrollReadiness(person.staffId, cycleLabel).catch(() => null) : Promise.resolve(null),
      ]);
      setProfile((p as Profile) || emptyProfile(person.username));
      setMonthly((cur as MonthlyRow) || emptyMonthly(person.username, m));
      setHistory(((hist || []) as MonthlyRow[]).filter(Boolean));
      setAutomatedTruth((truth || []).filter(Boolean)[0] || null);
      setAttendanceReadiness(readiness);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (selected) void loadPerson(selected, month); }, [selected, month, loadPerson]);

  const monthlyFrozen = monthly?.status === 'approved' || monthly?.status === 'paid';
  const monthlyPaid = monthly?.status === 'paid';

  const netSalaryPreview = useMemo(() => {
    if (!profile || !monthly) return 0;
    if (monthlyFrozen && monthly.net_salary != null) return num(monthly.net_salary);
    return (
      num(profile.base_salary) +
      num(monthly.worked_hours) * num(profile.hourly_rate) +
      num(monthly.overtime_hours) * num(profile.hourly_rate) +
      num(monthly.quarterly_bonus) +
      num(monthly.incentives_total) +
      num(automatedTruth?.automatedTotal) +
      num(monthly.manual_adjustment) -
      num(monthly.deductions_total)
    );
  }, [profile, monthly, automatedTruth, monthlyFrozen]);

  const saveProfile = async () => {
    if (!profile) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('staff_payroll_profiles_v13').upsert(
        { ...profile, staff_name: selected?.name, role: selected?.role, branch: selected?.branch, updated_at: new Date().toISOString() },
        { onConflict: 'staff_username' }
      );
      if (error) throw error;
      toast.success('تم حفظ الملف الأساسي للراتب');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر الحفظ');
    } finally { setSaving(false); }
  };

  const saveMonthly = async () => {
    if (!monthly) return;
    if (monthlyPaid) {
      toast.error('الكشف مدفوع ومقفول نهائيًا. أي تصحيح لاحق يتم كتسوية مستقلة موثقة.');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.rpc('save_staff_payroll_monthly_v14', {
        p_staff_username: monthly.staff_username,
        p_payroll_month: monthly.payroll_month,
        p_worked_hours: num(monthly.worked_hours),
        p_overtime_hours: num(monthly.overtime_hours),
        p_quarterly_bonus: num(monthly.quarterly_bonus),
        p_incentives_total: num(monthly.incentives_total),
        p_deductions_total: num(monthly.deductions_total),
        p_manual_adjustment: num(monthly.manual_adjustment),
        p_notes: monthly.notes || null,
        p_status: monthly.status,
      });
      if (error) throw error;
      toast.success(monthly.status === 'approved' ? 'تم اعتماد الكشف وتجميد Snapshot نهائي للأرقام' : monthly.status === 'paid' ? 'تم تعليم الكشف كمدفوع وإقفاله نهائيًا' : 'تم حفظ كشف الدورة');
      if (selected) await loadPerson(selected, month);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر حفظ كشف الدورة');
    } finally { setSaving(false); }
  };

  const filteredStaff = staff.filter((s) => !search.trim() || s.name.includes(search.trim()) || s.username.includes(search.trim()));
  const statusOptions = monthlyPaid
    ? STATUS_OPTIONS.filter((s) => s.key === 'paid')
    : monthly?.status === 'approved'
      ? STATUS_OPTIONS.filter((s) => s.key === 'approved' || s.key === 'paid')
      : STATUS_OPTIONS.filter((s) => s.key !== 'paid');

  return (
    <div className="space-y-5 p-4 md:p-6" dir="rtl">
      <div className="rounded-3xl border p-5" style={surface}>
        <div className="flex items-center gap-2 text-teal-200"><Banknote size={18} /><span className="text-xs font-black">إدارة الرواتب والحوافز</span></div>
        <h1 className="mt-1 text-2xl font-black text-white">كشوف رواتب الموظفين</h1>
        <p className="mt-1 text-sm" style={mutedText}>{allBranches ? 'كل الفروع' : ownBranch} · الملف الأساسي + كشف كل دورة على حدة</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="rounded-3xl border p-4" style={surface}>
          <div className="flex items-center gap-2 rounded-xl border px-3 py-2" style={surfaceSoft}>
            <Search size={15} className="text-teal-300" />
            <input className="w-full bg-transparent text-sm outline-none" placeholder="بحث بالاسم أو اليوزر" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="mt-3 max-h-[60vh] space-y-1.5 overflow-y-auto">
            {filteredStaff.map((s) => (
              <button key={s.id} onClick={() => setSelected(s)} className={`flex w-full items-center gap-2 rounded-xl border p-2.5 text-right text-sm transition ${selected?.id === s.id ? 'border-teal-400/50 bg-teal-400/10' : ''}`} style={selected?.id === s.id ? undefined : surfaceSoft}>
                <User size={15} className="text-teal-300" />
                <div><div className="font-black text-white">{s.name}</div><div className="text-[11px]" style={mutedText}>{s.branch}</div></div>
              </button>
            ))}
            {!filteredStaff.length ? <p className="p-3 text-center text-xs" style={mutedText}>لا يوجد موظفين مطابقين.</p> : null}
          </div>
        </div>

        {!selected ? (
          <div className="flex items-center justify-center rounded-3xl border p-10 text-sm" style={{ ...surface, ...mutedText }}>اختار موظف من القائمة يمين عشان تشوف أو تعدّل كشفه.</div>
        ) : loading ? (
          <div className="flex items-center justify-center rounded-3xl border p-10" style={surface}><RefreshCw className="animate-spin text-teal-300" /></div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-3xl border p-5" style={surface}>
              <div className="flex items-center gap-2 font-black text-teal-200"><WalletCards size={18} /> الملف الأساسي — {selected.name}</div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-xs font-bold" style={mutedText}>الراتب الأساسي<input type="number" className="input mt-1 w-full" value={profile?.base_salary ?? 0} onChange={(e) => setProfile((p) => p && { ...p, base_salary: num(e.target.value) })} /></label>
                <label className="text-xs font-bold" style={mutedText}>سعر الساعة<input type="number" className="input mt-1 w-full" value={profile?.hourly_rate ?? 0} onChange={(e) => setProfile((p) => p && { ...p, hourly_rate: num(e.target.value) })} /></label>
                <label className="text-xs font-bold" style={mutedText}>حافز التارجت الافتراضي<input type="number" className="input mt-1 w-full" value={profile?.target_bonus_amount ?? 0} onChange={(e) => setProfile((p) => p && { ...p, target_bonus_amount: num(e.target.value) })} /></label>
                <label className="text-xs font-bold" style={mutedText}>الحافز الربع سنوي الافتراضي<input type="number" className="input mt-1 w-full" value={profile?.quarterly_bonus_amount ?? 0} onChange={(e) => setProfile((p) => p && { ...p, quarterly_bonus_amount: num(e.target.value) })} /></label>
              </div>
              <button className="btn-primary mt-4 flex items-center gap-2" disabled={saving} onClick={() => void saveProfile()}><Save size={16} /> حفظ الملف الأساسي</button>
            </div>

            <div className="rounded-3xl border p-5" style={surface}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 font-black text-teal-200"><CalendarClock size={18} /> كشف الدورة</div>
                <input type="month" className="input" value={month.slice(0, 7)} onChange={(e) => setMonth(`${e.target.value}-01`)} />
              </div>

              {monthlyFrozen ? (
                <div className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-400/30 bg-amber-400/5 p-3 text-xs text-amber-200">
                  <LockKeyhole size={16} className="mt-0.5 shrink-0" />
                  <div className="font-bold">
                    {monthlyPaid ? 'الكشف مدفوع ومقفول نهائيًا.' : 'الكشف معتمد والأرقام مجمدة من لحظة الاعتماد.'}
                    {monthly?.freeze_version ? ` Snapshot v${monthly.freeze_version}.` : ''}
                    {monthly?.approved_by_name ? ` اعتمد بواسطة ${monthly.approved_by_name}.` : ''}
                  </div>
                </div>
              ) : null}

              <div className="mt-4 rounded-2xl border p-4" style={surfaceSoft}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-2">
                    {attendanceReadiness?.status === 'ready' ? <ShieldCheck size={18} className="text-emerald-300" /> : attendanceReadiness?.status === 'needs_review' ? <AlertTriangle size={18} className="text-amber-300" /> : <Activity size={18} className="text-slate-400" />}
                    <div>
                      <div className="text-xs font-black text-teal-200">جاهزية البصمة للرواتب</div>
                      <div className="mt-1 text-[11px]" style={mutedText}>
                        {attendanceReadiness?.status === 'ready'
                          ? 'بيانات البصمة مكتملة حسابيًا للمراجعة — ما زالت قراءة فقط ولا تعدّل ساعات الراتب تلقائيًا.'
                          : attendanceReadiness?.status === 'needs_review'
                            ? 'وصلت بيانات بصمة لكن توجد أحداث تحتاج مراجعة قبل الاعتماد المالي.'
                            : 'لم تصل بيانات بصمة فعلية مكتملة لهذه الدورة؛ ساعات العمل تظل يدوية.'}
                      </div>
                    </div>
                  </div>
                  <div className={`rounded-full px-3 py-1 text-[11px] font-black ${attendanceReadiness?.status === 'ready' ? 'text-emerald-300' : attendanceReadiness?.status === 'needs_review' ? 'text-amber-300' : 'text-slate-400'}`}>
                    {attendanceReadiness?.status === 'ready' ? 'جاهز للمراجعة' : attendanceReadiness?.status === 'needs_review' ? 'يحتاج مراجعة' : 'لا توجد بيانات'}
                  </div>
                </div>
                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                  <div>أحداث البصمة: <b>{attendanceReadiness?.rawBiometricEvents ?? 0}</b></div>
                  <div>بصمات مقبولة: <b>{attendanceReadiness?.acceptedPunches ?? 0}</b></div>
                  <div>مراجعة يدوية: <b>{attendanceReadiness?.manualReviewPunches ?? 0}</b></div>
                  <div>مرفوضة: <b>{attendanceReadiness?.rejectedPunches ?? 0}</b></div>
                  <div>شيفتات مكتملة: <b>{attendanceReadiness?.pairedShifts ?? 0}</b></div>
                  <div>بصمات غير مزدوجة: <b>{attendanceReadiness?.unpairedAcceptedPunches ?? 0}</b></div>
                  <div className="lg:col-span-2">ساعات مرشحة من البصمة: <b className="text-teal-200">{attendanceReadiness?.candidateWorkedHours ?? 0} ساعة</b></div>
                </div>
                <p className="mt-2 text-[10px] text-amber-300">لا يتم نسخ الساعات إلى كشف الراتب تلقائيًا حتى يتم اعتماد مصدر البصمة بعد أول دورة فعلية مكتملة.</p>
              </div>

              {automatedTruth ? (
                <div className="mt-4 rounded-2xl border p-4" style={surfaceSoft}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div><div className="text-xs font-black text-teal-200">الحوافز الآلية — مصدر حقيقة واحد</div><div className="mt-1 text-[11px]" style={mutedText}>مصدر حافز الأداء: {automatedTruth.performanceSource === 'points' ? 'نظام النقاط' : automatedTruth.performanceSource === 'manager_evaluation' ? 'تقييم المدير' : 'غير متاح'}</div></div>
                    <div className="text-lg font-black text-emerald-300">{formatCurrency(automatedTruth.automatedTotal)}</div>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                    <div>حافز النقاط: <b>{formatCurrency(automatedTruth.pointsIncentive)}</b></div>
                    <div>منافسة المحاور: <b>{formatCurrency(automatedTruth.competitionBonus)}</b></div>
                    <div>تقييم المدير: <b>{formatCurrency(automatedTruth.managerEvaluationIncentive)}</b></div>
                    <div>التارجت: <b>{formatCurrency(automatedTruth.targetBonus)}</b></div>
                    <div>متابعة العملاء: <b>{formatCurrency(automatedTruth.followupThresholdBonus)}</b></div>
                    <div>طلبات العملاء: <b>{formatCurrency(automatedTruth.customerRequestThresholdBonus)}</b></div>
                    <div>نجم الفرع: <b>{formatCurrency(automatedTruth.branchStarBonus)}</b></div>
                    <div>حافز الأداء المحتسب: <b>{formatCurrency(automatedTruth.performanceIncentive)}</b></div>
                  </div>
                  {monthlyFrozen ? <p className="mt-2 text-[10px] font-bold text-amber-300">الأرقام بالأعلى هي القراءة الحالية للمراجعة فقط؛ صافي الكشف المعتمد يعتمد على Snapshot المحفوظ وقت الاعتماد.</p> : null}
                  {automatedTruth.excludedManagerEvaluationDueToPointsProfile ? <p className="mt-2 text-[10px] font-bold text-amber-300">تم استبعاد حافز تقييم المدير من الجمع لأن ملف النقاط هو مصدر حافز الأداء لهذا الموظف — منعًا للاحتساب المزدوج.</p> : null}
                </div>
              ) : null}

              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className="text-xs font-bold" style={mutedText}>ساعات العمل<input disabled={monthlyFrozen} type="number" className="input mt-1 w-full" value={monthly?.worked_hours ?? 0} onChange={(e) => setMonthly((m) => m && { ...m, worked_hours: num(e.target.value) })} /></label>
                <label className="text-xs font-bold" style={mutedText}>ساعات إضافية<input disabled={monthlyFrozen} type="number" className="input mt-1 w-full" value={monthly?.overtime_hours ?? 0} onChange={(e) => setMonthly((m) => m && { ...m, overtime_hours: num(e.target.value) })} /></label>
                <label className="text-xs font-bold" style={mutedText}>حافز التارجت<input type="number" className="input mt-1 w-full" readOnly value={monthlyFrozen ? monthly?.target_bonus ?? 0 : automatedTruth?.targetBonus ?? 0} /><span className="mt-1 block text-[10px] text-emerald-300">محسوب على السيرفر وممنوع التعديل اليدوي</span></label>
                <label className="text-xs font-bold" style={mutedText}>حافز الأداء الآلي<input type="number" className="input mt-1 w-full" readOnly value={automatedTruth?.performanceIncentive ?? 0} /><span className="mt-1 block text-[10px] text-slate-500">من نظام النقاط أو تقييم المدير — مصدر واحد فقط</span></label>
                <label className="text-xs font-bold" style={mutedText}>الحافز الربع سنوي<input disabled={monthlyFrozen} type="number" className="input mt-1 w-full" value={monthly?.quarterly_bonus ?? 0} onChange={(e) => setMonthly((m) => m && { ...m, quarterly_bonus: num(e.target.value) })} /></label>
                <label className="text-xs font-bold" style={mutedText}>حوافز يدوية أخرى فقط<input disabled={monthlyFrozen} type="number" className="input mt-1 w-full" value={monthly?.incentives_total ?? 0} onChange={(e) => setMonthly((m) => m && { ...m, incentives_total: num(e.target.value) })} /><span className="mt-1 block text-[10px] text-amber-300">لا تُدخل هنا النقاط أو التارجت أو المتابعة أو طلبات العملاء أو نجم الفرع؛ البنود دي تُجمع آليًا.</span></label>
                <label className="text-xs font-bold" style={mutedText}>الخصومات<input disabled={monthlyFrozen} type="number" className="input mt-1 w-full" value={monthly?.deductions_total ?? 0} onChange={(e) => setMonthly((m) => m && { ...m, deductions_total: num(e.target.value) })} /></label>
                <label className="text-xs font-bold" style={mutedText}>تعديل يدوي (+/-)<input disabled={monthlyFrozen} type="number" className="input mt-1 w-full" value={monthly?.manual_adjustment ?? 0} onChange={(e) => setMonthly((m) => m && { ...m, manual_adjustment: num(e.target.value) })} /></label>
                <label className="text-xs font-bold" style={mutedText}>الحالة<select disabled={monthlyPaid} className="input mt-1 w-full" value={monthly?.status ?? 'draft'} onChange={(e) => setMonthly((m) => m && { ...m, status: e.target.value })}>{statusOptions.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
              </div>

              <div className="mt-4 flex items-center justify-between rounded-2xl border p-4" style={surfaceSoft}><span className="font-black text-white">{monthlyFrozen ? 'صافي الراتب المجمد' : 'صافي الراتب المتوقع'}</span><span className="text-xl font-black text-teal-200">{formatCurrency(netSalaryPreview)}</span></div>
              <button className="btn-primary mt-4 flex items-center gap-2" disabled={saving || monthlyPaid} onClick={() => void saveMonthly()}><CheckCircle2 size={16} /> {monthly?.status === 'approved' ? 'اعتماد وتجميد الكشف' : monthly?.status === 'paid' ? 'الكشف مدفوع' : 'حفظ كشف الدورة'}</button>
            </div>

            {history.length ? (
              <div className="rounded-3xl border p-5" style={surface}>
                <div className="flex items-center gap-2 font-black text-teal-200"><ClipboardList size={18} /> آخر الدورات</div>
                <div className="mt-3 space-y-2">{history.map((h) => <div key={h.payroll_month} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm" style={surfaceSoft}><span className="font-black text-white">{h.payroll_month?.slice(0, 7)}</span><span className="flex items-center gap-1 text-emerald-300"><Trophy size={13} /> {formatCurrency(num(h.net_salary))}</span><span className="flex items-center gap-1 text-rose-300"><TrendingDown size={13} /> {formatCurrency(num(h.deductions_total))}</span><span className="rounded-full px-3 py-1 text-xs font-black text-teal-200" style={surface}>{STATUS_OPTIONS.find((s) => s.key === h.status)?.label || h.status}</span></div>)}</div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
