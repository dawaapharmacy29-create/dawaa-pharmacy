import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3, Edit3, RefreshCw, Save, Star, TrendingUp, Wallet, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { getCurrentCycle, formatCycleDate } from '@/lib/pharmacy-cycle';
import { createStaffNotification } from '@/lib/staffNotificationService';

type PayrollRow = {
  staff_id?: string | null; username?: string | null; staff_name?: string | null; role?: string | null; branch?: string | null;
  base_salary?: number | null; hourly_rate?: number | null; worked_hours?: number | null; overtime_hours?: number | null;
  target_bonus?: number | null; quarterly_bonus?: number | null; incentives_total?: number | null; deductions_total?: number | null;
  calculated_net_salary?: number | null; status?: string | null; payroll_month?: string | null;
};
type ManualEntry = { id: string; staff_id: string; cycle_start: string; cycle_end: string; entry_type: string; amount: number; title: string; details?: string | null; visible_to_staff: boolean; created_at: string };
type EntryForm = { entryType: string; amount: string; title: string; details: string; visibleToStaff: boolean };

const ENTRY_TYPES = [['base_salary','تعديل الأساسي'],['allowance','بدل'],['bonus','مكافأة'],['incentive','حافز'],['deduction','خصم'],['advance','سلفة'],['overtime','إضافي'],['manual_note','ملاحظة فقط']] as const;
const emptyForm: EntryForm = { entryType: 'bonus', amount: '', title: '', details: '', visibleToStaff: true };
const STATUS_LABELS: Record<string,string> = { draft: 'مسودة', pending_review: 'تحت المراجعة', manager_review: 'مراجعة المدير', approved: 'معتمد', paid: 'تم الصرف', rejected: 'مرفوض' };
function n(v: unknown) { const x = Number(v || 0); return Number.isFinite(x) ? x : 0; }
function statusKey(value: unknown) { return String(value || 'draft').trim().toLowerCase(); }
function statusLabel(value: unknown) { const key = statusKey(value); return STATUS_LABELS[key] || String(value || 'مسودة'); }
function statusClass(value: unknown) { const key = statusKey(value); if (key === 'paid' || key === 'approved') return 'bg-emerald-50 text-emerald-700 border-emerald-200'; if (key === 'rejected') return 'bg-red-50 text-red-700 border-red-200'; if (key === 'pending_review' || key === 'manager_review') return 'bg-amber-50 text-amber-700 border-amber-200'; return 'bg-slate-50 text-slate-600 border-slate-200'; }

export default function StaffPayroll() {
  const { user } = useAuth();
  const cycle = useMemo(() => getCurrentCycle(), []);
  const [rows, setRows] = useState<PayrollRow[]>([]);
  const [entries, setEntries] = useState<ManualEntry[]>([]);
  const [selected, setSelected] = useState<PayrollRow | null>(null);
  const [form, setForm] = useState<EntryForm>(emptyForm);
  const [statusFilter, setStatusFilter] = useState('all');
  const [branchFilter, setBranchFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const role = String(user?.role || '').trim();
  const canEditPayroll = role === 'general_manager' || role === 'admin';
  const managerStaffId = String(user?.staffId || '').trim() || null;

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [{ data, error: summaryError }, { data: manualData, error: manualError }] = await Promise.all([
        supabase.from('staff_payroll_summary').select('*').order('staff_name').limit(500),
        supabase.from('staff_payroll_manual_entries').select('*').order('created_at', { ascending: false }).limit(1000),
      ]);
      if (summaryError) throw summaryError;
      if (manualError && canEditPayroll) throw manualError;
      setRows((data || []) as PayrollRow[]); setEntries((manualData || []) as ManualEntry[]);
    } catch (err) { setError(err instanceof Error ? err.message : 'تعذر تحميل القبض'); }
    finally { setLoading(false); }
  }, [canEditPayroll]);

  useEffect(() => { void load(); }, [load]);

  const totals = rows.reduce((acc, r) => ({ net: acc.net + n(r.calculated_net_salary), base: acc.base + n(r.base_salary), incentives: acc.incentives + n(r.incentives_total) + n(r.target_bonus) + n(r.quarterly_bonus), deductions: acc.deductions + n(r.deductions_total) }), { net: 0, base: 0, incentives: 0, deductions: 0 });
  const statusSummary = useMemo(() => rows.reduce<Record<string,number>>((acc,row) => { const key = statusKey(row.status); acc[key] = (acc[key] || 0) + 1; return acc; }, {}), [rows]);
  const branches = useMemo(() => Array.from(new Set(rows.map((row) => String(row.branch || '').trim()).filter(Boolean))), [rows]);
  const visibleRows = useMemo(() => rows.filter((row) => {
    if (statusFilter !== 'all' && statusKey(row.status) !== statusFilter) return false;
    if (branchFilter !== 'all' && String(row.branch || '') !== branchFilter) return false;
    const haystack = `${row.staff_name || ''} ${row.username || ''} ${row.staff_id || ''}`.toLowerCase();
    return !search.trim() || haystack.includes(search.trim().toLowerCase());
  }), [branchFilter, rows, search, statusFilter]);
  const selectedEntries = selected?.staff_id ? entries.filter((entry) => entry.staff_id === selected.staff_id) : [];

  const openEditor = (row: PayrollRow) => { setError(null); setSuccess(null); setSelected(row); setForm(emptyForm); };
  const saveEntry = async () => {
    if (!selected?.staff_id) { setError('الموظف غير مرتبط بـ staff_id، راجع ربط الحساب بالموظف أولًا.'); return; }
    if (!form.title.trim()) { setError('اكتب عنوانًا واضحًا للبند.'); return; }
    if (form.entryType !== 'manual_note' && !Number.isFinite(Number(form.amount))) { setError('اكتب قيمة مالية صحيحة.'); return; }
    setSaving(true); setError(null); setSuccess(null);
    try {
      const amount = form.entryType === 'manual_note' ? 0 : Number(form.amount || 0);
      const { data, error: insertError } = await supabase.from('staff_payroll_manual_entries').insert({
        staff_id: selected.staff_id, cycle_start: formatCycleDate(cycle.start), cycle_end: formatCycleDate(cycle.end), entry_type: form.entryType,
        amount, title: form.title.trim(), details: form.details.trim() || null, visible_to_staff: form.visibleToStaff,
        created_by_staff_id: managerStaffId, updated_by_staff_id: managerStaffId,
      }).select('id').single();
      if (insertError) throw insertError;
      if (form.visibleToStaff) await createStaffNotification({
        recipientStaffId: selected.staff_id,
        type: form.entryType === 'deduction' ? 'payroll_deduction' : 'payroll_update',
        title: form.title.trim(),
        message: `${form.details.trim() || 'تم تسجيل بند جديد في حساب القبض'}${amount ? ` — ${formatCurrency(amount)}` : ''}`,
        priority: form.entryType === 'deduction' ? 'high' : 'normal',
        entityType: 'staff_payroll_manual_entries',
        entityId: String(data?.id || ''),
        actionUrl: '/doctor-dashboard?tab=payroll',
        metadata: { entry_type: form.entryType, amount, cycle_start: formatCycleDate(cycle.start), cycle_end: formatCycleDate(cycle.end) },
      });
      setSuccess('تم حفظ البند وتسجيله، وتم توجيه إشعار شخصي للدكتور عند السماح بالظهور.');
      setForm(emptyForm); await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'تعذر حفظ البند'); }
    finally { setSaving(false); }
  };

  return <div className="space-y-5" dir="rtl">
    <div className="rounded-2xl border border-[#E5EAF0] bg-white p-5 shadow-sm"><div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div><h1 className="text-2xl font-black text-slate-900">تفاصيل قبض الموظفين</h1><p className="mt-1 text-sm font-bold text-slate-500">مسودة ← مراجعة ← اعتماد ← صرف، مع البنود اليدوية والإشعارات الشخصية.</p>{canEditPayroll ? <p className="mt-2 text-xs font-black text-teal-700">أي بند ظاهر للدكتور يُسجل ويصل له كإشعار شخصي.</p> : null}</div><button onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-sm font-black text-white hover:bg-teal-700"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث</button></div></div>
    {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div> : null}
    {success ? <div className="rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm font-bold text-teal-700">{success}</div> : null}

    <div className="grid gap-3 md:grid-cols-4"><Card title="إجمالي الصافي" value={formatCurrency(totals.net)} icon={Wallet} /><Card title="إجمالي الأساسي" value={formatCurrency(totals.base)} icon={Wallet} /><Card title="الحوافز" value={formatCurrency(totals.incentives)} icon={Star} /><Card title="الخصومات" value={formatCurrency(totals.deductions)} icon={TrendingUp} /></div>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{['draft','pending_review','manager_review','approved','paid'].map((key) => <button key={key} onClick={() => setStatusFilter(key)} className={`rounded-2xl border p-4 text-right ${statusFilter === key ? 'border-teal-400 bg-teal-50' : 'border-slate-200 bg-white'}`}><div className="flex items-center justify-between"><span className="text-sm font-black text-slate-700">{statusLabel(key)}</span>{key === 'paid' || key === 'approved' ? <CheckCircle2 size={18} className="text-emerald-600" /> : <Clock3 size={18} className="text-amber-600" />}</div><div className="mt-2 text-2xl font-black text-slate-900">{statusSummary[key] || 0}</div></button>)}</div>

    <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-3"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث بالاسم أو staff_id" className="rounded-xl border border-slate-200 p-3" /><select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="rounded-xl border border-slate-200 p-3"><option value="all">كل الفروع</option>{branches.map((branch) => <option key={branch} value={branch}>{branch}</option>)}</select><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-xl border border-slate-200 p-3"><option value="all">كل الحالات</option>{Object.entries(STATUS_LABELS).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></div>

    <div className="rounded-2xl border border-[#E5EAF0] bg-white p-4 shadow-sm"><div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-black text-slate-900">قائمة القبض</h2><span className="text-sm font-black text-teal-700">{visibleRows.length} موظف</span></div><div className="overflow-auto"><table className="min-w-full text-sm"><thead><tr className="bg-slate-50 text-slate-600"><th className="p-3 text-right">الموظف</th><th className="p-3 text-right">الفرع</th><th className="p-3 text-right">الحالة</th><th className="p-3 text-right">الأساسي</th><th className="p-3 text-right">الساعات</th><th className="p-3 text-right">الحوافز</th><th className="p-3 text-right">الخصومات</th><th className="p-3 text-right">الصافي</th>{canEditPayroll ? <th className="p-3 text-right">إدارة</th> : null}</tr></thead><tbody>{visibleRows.map((r,i) => <tr key={`${r.staff_id || r.username}-${i}`} className="border-t"><td className="p-3 font-black">{r.staff_name || r.username || '-'}</td><td className="p-3">{r.branch || '-'}</td><td className="p-3"><span className={`rounded-full border px-2 py-1 text-xs font-black ${statusClass(r.status)}`}>{statusLabel(r.status)}</span></td><td className="p-3">{formatCurrency(n(r.base_salary))}</td><td className="p-3">{n(r.worked_hours).toLocaleString('ar-EG')}</td><td className="p-3">{formatCurrency(n(r.incentives_total)+n(r.target_bonus)+n(r.quarterly_bonus))}</td><td className="p-3">{formatCurrency(n(r.deductions_total))}</td><td className="p-3 font-black text-teal-700">{formatCurrency(n(r.calculated_net_salary))}</td>{canEditPayroll ? <td className="p-3"><button onClick={() => openEditor(r)} className="inline-flex items-center gap-1 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-black text-teal-700"><Edit3 size={14} /> التفاصيل</button></td> : null}</tr>)}</tbody></table></div>{!visibleRows.length ? <div className="rounded-xl bg-slate-50 p-5 text-center text-sm font-bold text-slate-500">لا توجد كشوف مطابقة للفلاتر.</div> : null}</div>

    {selected && canEditPayroll ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" onMouseDown={(event) => { if (event.currentTarget === event.target) setSelected(null); }}><div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl"><div className="flex items-start justify-between gap-3"><div><h2 className="text-2xl font-black text-slate-900">تفاصيل قبض {selected.staff_name || selected.username}</h2><p className="mt-1 text-sm font-bold text-slate-500">الدورة {formatCycleDate(cycle.start)} إلى {formatCycleDate(cycle.end)}</p></div><button onClick={() => setSelected(null)} className="rounded-xl bg-slate-100 p-2 text-slate-600"><X /></button></div>{!selected.staff_id ? <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-black text-amber-800">لا يمكن إضافة بند قبل ربط صف القبض بـ staff_id الحقيقي.</div> : null}<div className="mt-5 grid gap-4 md:grid-cols-2"><label className="text-sm font-black text-slate-700">نوع البند<select value={form.entryType} onChange={(e) => setForm((c) => ({...c,entryType:e.target.value}))} className="mt-2 w-full rounded-xl border border-slate-200 p-3">{ENTRY_TYPES.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-sm font-black text-slate-700">القيمة بالجنيه<input type="number" value={form.amount} disabled={form.entryType === 'manual_note'} onChange={(e) => setForm((c) => ({...c,amount:e.target.value}))} className="mt-2 w-full rounded-xl border border-slate-200 p-3" /></label><label className="text-sm font-black text-slate-700 md:col-span-2">عنوان البند<input value={form.title} onChange={(e) => setForm((c) => ({...c,title:e.target.value}))} className="mt-2 w-full rounded-xl border border-slate-200 p-3" /></label><label className="text-sm font-black text-slate-700 md:col-span-2">التفاصيل<textarea value={form.details} onChange={(e) => setForm((c) => ({...c,details:e.target.value}))} rows={4} className="mt-2 w-full rounded-xl border border-slate-200 p-3" /></label><label className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 text-sm font-black text-slate-700 md:col-span-2"><input type="checkbox" checked={form.visibleToStaff} onChange={(e) => setForm((c) => ({...c,visibleToStaff:e.target.checked}))} /> يظهر للدكتور ويصله إشعار شخصي</label></div><button disabled={saving || !selected.staff_id} onClick={() => void saveEntry()} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-3 font-black text-white disabled:opacity-50"><Save size={18} /> {saving ? 'جارٍ الحفظ...' : 'حفظ البند وتسجيله'}</button><div className="mt-6"><h3 className="text-lg font-black text-slate-900">السجل اليدوي</h3><div className="mt-3 space-y-2">{selectedEntries.map((entry) => <div key={entry.id} className="rounded-xl border border-slate-200 p-3"><div className="flex items-start justify-between gap-3"><div><div className="font-black text-slate-900">{entry.title}</div><p className="mt-1 text-sm text-slate-600">{entry.details || 'بدون تفاصيل إضافية'}</p></div><div className={entry.entry_type === 'deduction' ? 'font-black text-red-600' : 'font-black text-teal-700'}>{formatCurrency(n(entry.amount))}</div></div><div className="mt-2 text-xs font-bold text-slate-400">{entry.entry_type} · {entry.visible_to_staff ? 'ظاهر للدكتور' : 'إداري فقط'}</div></div>)}{!selectedEntries.length ? <div className="rounded-xl bg-slate-50 p-4 text-center text-sm font-bold text-slate-500">لا توجد بنود يدوية.</div> : null}</div></div></div></div> : null}
  </div>;
}

function Card({ title, value, icon: Icon }: { title: string; value: string; icon: typeof Wallet }) { return <div className="rounded-2xl border border-[#E5EAF0] bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><div><div className="text-xs font-bold text-slate-500">{title}</div><div className="mt-2 text-2xl font-black text-slate-900">{value}</div></div><span className="rounded-2xl bg-teal-50 p-3 text-teal-700"><Icon size={20} /></span></div></div>; }
