import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Banknote, CalendarClock, CheckCircle2, ClipboardList, RefreshCw, Save,
  Search, TrendingDown, Trophy, User, WalletCards,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { normalizeBranchName } from '@/lib/branch';
import { formatCurrency } from '@/lib/utils';
import { getCurrentCycle, formatCycleDate } from '@/lib/pharmacy-cycle';

const surface = { background: 'var(--dawaa-theme-surface)', borderColor: 'var(--dawaa-theme-border)' };
const surfaceSoft = { background: 'var(--dawaa-theme-bg-soft)', borderColor: 'var(--dawaa-theme-border)' };
const mutedText = { color: 'var(--dawaa-theme-muted)' };

type Row = Record<string, unknown>;
type StaffRow = { id: string; username: string; name: string; branch: string; role: string; active: boolean };
type Profile = {
  staff_username: string; staff_name?: string; role?: string; branch?: string;
  base_salary: number; hourly_rate: number; target_bonus_amount: number; quarterly_bonus_amount: number;
  active: boolean; notes: string;
};
type MonthlyRow = {
  id?: string; staff_username: string; payroll_month: string;
  worked_hours: number; overtime_hours: number; target_bonus: number; quarterly_bonus: number;
  incentives_total: number; deductions_total: number; manual_adjustment: number;
  status: string; notes: string;
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
  const currentMonth = useMemo(() => formatCycleDate(cycle.start).slice(0, 8) + '01', [cycle]);

  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<StaffRow | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [monthly, setMonthly] = useState<MonthlyRow | null>(null);
  const [history, setHistory] = useState<MonthlyRow[]>([]);
  const [month, setMonth] = useState(currentMonth);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadStaff = useCallback(async () => {
    let query = supabase.from('staff_accounts').select('id,username,name,staff_name,branch,role,active').eq('active', true).order('name');
    if (!allBranches && ownBranch) query = query.eq('branch', ownBranch);
    const { data } = await query;
    setStaff(((data || []) as Row[]).map((r: any) => ({ id: r.id, username: r.username, name: r.name || r.staff_name || r.username, branch: r.branch || '', role: r.role || '', active: r.active !== false })));
  }, [allBranches, ownBranch]);

  useEffect(() => { void loadStaff(); }, [loadStaff]);

  const loadPerson = useCallback(async (person: StaffRow, m: string) => {
    setLoading(true);
    try {
      const [{ data: p }, { data: cur }, { data: hist }] = await Promise.all([
        supabase.from('staff_payroll_profiles_v13').select('*').eq('staff_username', person.username).maybeSingle(),
        supabase.from('staff_payroll_monthly_v13').select('*').eq('staff_username', person.username).eq('payroll_month', m).maybeSingle(),
        supabase.from('staff_payroll_monthly_v13').select('*').eq('staff_username', person.username).order('payroll_month', { ascending: false }).limit(6),
      ]);
      setProfile((p as Profile) || emptyProfile(person.username));
      setMonthly((cur as MonthlyRow) || emptyMonthly(person.username, m));
      setHistory((hist || []) as MonthlyRow[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (selected) void loadPerson(selected, month); }, [selected, month, loadPerson]);

  const netSalaryPreview = useMemo(() => {
    if (!profile || !monthly) return 0;
    return (
      num(profile.base_salary) +
      num(monthly.worked_hours) * num(profile.hourly_rate) +
      num(monthly.overtime_hours) * num(profile.hourly_rate) +
      num(monthly.target_bonus) +
      num(monthly.quarterly_bonus) +
      num(monthly.incentives_total) +
      num(monthly.manual_adjustment) -
      num(monthly.deductions_total)
    );
  }, [profile, monthly]);

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
    if (monthly.status === 'paid') {
      const already = history.find((h) => h.payroll_month === monthly.payroll_month && h.status === 'paid');
      if (already) { toast.error('الكشف ده متعلّم مدفوع بالفعل — راجع السجل قبل التعديل.'); return; }
    }
    setSaving(true);
    try {
      const { error } = await supabase.from('staff_payroll_monthly_v13').upsert(
        { ...monthly, net_salary: netSalaryPreview, updated_at: new Date().toISOString() },
        { onConflict: 'staff_username,payroll_month' }
      );
      if (error) throw error;
      toast.success('تم حفظ كشف الدورة');
      if (selected) void loadPerson(selected, month);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر الحفظ');
    } finally { setSaving(false); }
  };

  const filteredStaff = staff.filter((s) => !search.trim() || s.name.includes(search.trim()) || s.username.includes(search.trim()));

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
              <button
                key={s.id} onClick={() => setSelected(s)}
                className={`flex w-full items-center gap-2 rounded-xl border p-2.5 text-right text-sm transition ${selected?.id === s.id ? 'border-teal-400/50 bg-teal-400/10' : ''}`}
                style={selected?.id === s.id ? undefined : surfaceSoft}
              >
                <User size={15} className="text-teal-300" />
                <div>
                  <div className="font-black text-white">{s.name}</div>
                  <div className="text-[11px]" style={mutedText}>{s.branch}</div>
                </div>
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
                <label className="text-xs font-bold" style={mutedText}>الراتب الأساسي
                  <input type="number" className="input mt-1 w-full" value={profile?.base_salary ?? 0} onChange={(e) => setProfile((p) => p && { ...p, base_salary: num(e.target.value) })} />
                </label>
                <label className="text-xs font-bold" style={mutedText}>سعر الساعة
                  <input type="number" className="input mt-1 w-full" value={profile?.hourly_rate ?? 0} onChange={(e) => setProfile((p) => p && { ...p, hourly_rate: num(e.target.value) })} />
                </label>
                <label className="text-xs font-bold" style={mutedText}>حافز التارجت الافتراضي
                  <input type="number" className="input mt-1 w-full" value={profile?.target_bonus_amount ?? 0} onChange={(e) => setProfile((p) => p && { ...p, target_bonus_amount: num(e.target.value) })} />
                </label>
                <label className="text-xs font-bold" style={mutedText}>الحافز الربع سنوي الافتراضي
                  <input type="number" className="input mt-1 w-full" value={profile?.quarterly_bonus_amount ?? 0} onChange={(e) => setProfile((p) => p && { ...p, quarterly_bonus_amount: num(e.target.value) })} />
                </label>
              </div>
              <button className="btn-primary mt-4 flex items-center gap-2" disabled={saving} onClick={() => void saveProfile()}><Save size={16} /> حفظ الملف الأساسي</button>
            </div>

            <div className="rounded-3xl border p-5" style={surface}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 font-black text-teal-200"><CalendarClock size={18} /> كشف الدورة</div>
                <input type="month" className="input" value={month.slice(0, 7)} onChange={(e) => setMonth(`${e.target.value}-01`)} />
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className="text-xs font-bold" style={mutedText}>ساعات العمل
                  <input type="number" className="input mt-1 w-full" value={monthly?.worked_hours ?? 0} onChange={(e) => setMonthly((m) => m && { ...m, worked_hours: num(e.target.value) })} />
                </label>
                <label className="text-xs font-bold" style={mutedText}>ساعات إضافية
                  <input type="number" className="input mt-1 w-full" value={monthly?.overtime_hours ?? 0} onChange={(e) => setMonthly((m) => m && { ...m, overtime_hours: num(e.target.value) })} />
                </label>
                <label className="text-xs font-bold" style={mutedText}>حافز التارجت
                  <input type="number" className="input mt-1 w-full" value={monthly?.target_bonus ?? 0} onChange={(e) => setMonthly((m) => m && { ...m, target_bonus: num(e.target.value) })} />
                </label>
                <label className="text-xs font-bold" style={mutedText}>الحافز الربع سنوي
                  <input type="number" className="input mt-1 w-full" value={monthly?.quarterly_bonus ?? 0} onChange={(e) => setMonthly((m) => m && { ...m, quarterly_bonus: num(e.target.value) })} />
                </label>
                <label className="text-xs font-bold" style={mutedText}>إجمالي حوافز أخرى (نقاط/لستة/راكد)
                  <input type="number" className="input mt-1 w-full" value={monthly?.incentives_total ?? 0} onChange={(e) => setMonthly((m) => m && { ...m, incentives_total: num(e.target.value) })} />
                </label>
                <label className="text-xs font-bold" style={mutedText}>الخصومات
                  <input type="number" className="input mt-1 w-full" value={monthly?.deductions_total ?? 0} onChange={(e) => setMonthly((m) => m && { ...m, deductions_total: num(e.target.value) })} />
                </label>
                <label className="text-xs font-bold" style={mutedText}>تعديل يدوي (+/-)
                  <input type="number" className="input mt-1 w-full" value={monthly?.manual_adjustment ?? 0} onChange={(e) => setMonthly((m) => m && { ...m, manual_adjustment: num(e.target.value) })} />
                </label>
                <label className="text-xs font-bold" style={mutedText}>الحالة
                  <select className="input mt-1 w-full" value={monthly?.status ?? 'draft'} onChange={(e) => setMonthly((m) => m && { ...m, status: e.target.value })}>
                    {STATUS_OPTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </label>
              </div>

              <div className="mt-4 flex items-center justify-between rounded-2xl border p-4" style={surfaceSoft}>
                <span className="font-black text-white">صافي الراتب المتوقع</span>
                <span className="text-xl font-black text-teal-200">{formatCurrency(netSalaryPreview)}</span>
              </div>
              <button className="btn-primary mt-4 flex items-center gap-2" disabled={saving} onClick={() => void saveMonthly()}><CheckCircle2 size={16} /> حفظ كشف الدورة</button>
            </div>

            {history.length ? (
              <div className="rounded-3xl border p-5" style={surface}>
                <div className="flex items-center gap-2 font-black text-teal-200"><ClipboardList size={18} /> آخر الدورات</div>
                <div className="mt-3 space-y-2">
                  {history.map((h) => (
                    <div key={h.payroll_month} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm" style={surfaceSoft}>
                      <span className="font-black text-white">{h.payroll_month?.slice(0, 7)}</span>
                      <span className="flex items-center gap-1 text-emerald-300"><Trophy size={13} /> {formatCurrency(num(h.target_bonus) + num(h.quarterly_bonus))}</span>
                      <span className="flex items-center gap-1 text-rose-300"><TrendingDown size={13} /> {formatCurrency(num(h.deductions_total))}</span>
                      <span className="rounded-full px-3 py-1 text-xs font-black text-teal-200" style={surface}>{STATUS_OPTIONS.find((s) => s.key === h.status)?.label || h.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
