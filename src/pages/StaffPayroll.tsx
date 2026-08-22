import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3, Edit3, RefreshCw, Save, Star, TrendingUp, Wallet, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { getCurrentCycle, formatCycleDate } from '@/lib/pharmacy-cycle';
import { createStaffNotification } from '@/lib/staffNotificationService';
import { fetchPayrollIncentiveTruth, type PayrollIncentiveTruth } from '@/lib/incentives/payrollIncentiveTruthService';

type PayrollRow = {
  staff_id?: string | null; username?: string | null; staff_name?: string | null; role?: string | null; branch?: string | null;
  base_salary?: number | null; hourly_rate?: number | null; worked_hours?: number | null; overtime_hours?: number | null;
  target_bonus?: number | null; quarterly_bonus?: number | null; incentives_total?: number | null; deductions_total?: number | null;
  calculated_net_salary?: number | null; status?: string | null; payroll_month?: string | null;
  performance_incentive?: number | null; automated_target_bonus?: number | null; automated_truth_available?: boolean;
};
type ManualEntry = { id: string; staff_id: string; cycle_start: string; cycle_end: string; entry_type: string; amount: number; title: string; details?: string | null; visible_to_staff: boolean; created_at: string };
type EntryForm = { entryType: string; amount: string; title: string; details: string; visibleToStaff: boolean };

const ENTRY_TYPES = [['base_salary','تعديل الأساسي'],['allowance','بدل'],['bonus','مكافأة'],['incentive','حافز'],['deduction','خصم'],['advance','سلفة'],['overtime','إضافي'],['manual_note','ملاحظة فقط']] as const;
const emptyForm: EntryForm = { entryType: 'bonus', amount: '', title: '', details: '', visibleToStaff: true };
const STATUS_LABELS: Record<string,string> = { draft: 'مسودة', pending_review: 'تحت المراجعة', manager_review: 'مراجعة المدير', approved: 'معتمد', paid: 'تم الصرف', rejected: 'مرفوض' };
function n(v: unknown) { const x = Number(v || 0); return Number.isFinite(x) ? x : 0; }
function statusKey(value: unknown) { return String(value || 'draft').trim().toLowerCase(); }
function statusLabel(value: unknown) { const key = statusKey(value); return STATUS_LABELS[key] || String(value || 'مسودة'); }
function statusClass(value: unknown) {
  const key = statusKey(value);
  if (key === 'paid' || key === 'approved') return 'dawaa-badge--success';
  if (key === 'rejected') return 'dawaa-badge--danger';
  if (key === 'pending_review' || key === 'manager_review') return 'dawaa-badge--warning';
  return '';
}

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
      const [{ data, error: summaryError }, { data: manualData, error: manualError }, { data: accounts, error: accountsError }, truths] = await Promise.all([
        supabase.from('staff_payroll_summary').select('*').order('staff_name').limit(500),
        supabase.from('staff_payroll_manual_entries').select('*').order('created_at', { ascending: false }).limit(1000),
        supabase.rpc('get_staff_accounts_directory', { p_roles: null, p_branch: null }),
        fetchPayrollIncentiveTruth().catch(() => []),
      ]);
      if (summaryError) throw summaryError;
      if (manualError && canEditPayroll) throw manualError;
      if (accountsError) throw accountsError;
      const safeAccounts = (accounts || []).filter(Boolean);
      const staffByUsername = new Map<string, string>(safeAccounts
        .filter((account: any) => account.active !== false && account.username && account.staff_id)
        .map((account: any) => [String(account.username), String(account.staff_id)] as [string, string]));
      const truthByKey = new Map<string, PayrollIncentiveTruth>(truths.filter(Boolean).map((truth) => [`${truth.staffId}|${truth.monthCycle}`, truth] as [string, PayrollIncentiveTruth]));
      setRows(((data || []) as PayrollRow[]).filter(Boolean).map((row) => {
        const staffId = staffByUsername.get(String(row.username || '')) || '';
        const cycleKey = String(row.payroll_month || '').slice(0, 7);
        const truth = truthByKey.get(`${staffId}|${cycleKey}`);
        const storedTarget = n(row.target_bonus);
        const effectiveTarget = truth?.targetRecords ? truth.targetBonus : storedTarget;
        const correctedNet = n(row.calculated_net_salary) - storedTarget + effectiveTarget + n(truth?.performanceIncentive);
        return { ...row, staff_id: staffId, target_bonus: effectiveTarget, performance_incentive: truth?.performanceIncentive || 0, automated_target_bonus: truth?.targetBonus || 0, automated_truth_available: Boolean(truth), calculated_net_salary: correctedNet };
      }));
      setEntries(((manualData || []) as ManualEntry[]).filter(Boolean));
    } catch (err) { setError(err instanceof Error ? err.message : 'تعذر تحميل القبض'); }
    finally { setLoading(false); }
  }, [canEditPayroll]);

  useEffect(() => { void load(); }, [load]);

  const totals = rows.reduce((acc, r) => ({ net: acc.net + n(r.calculated_net_salary), base: acc.base + n(r.base_salary), incentives: acc.incentives + n(r.incentives_total) + n(r.performance_incentive) + n(r.target_bonus) + n(r.quarterly_bonus), deductions: acc.deductions + n(r.deductions_total) }), { net: 0, base: 0, incentives: 0, deductions: 0 });
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
    <section className="dawaa-card dawaa-card--raised">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="dawaa-title text-2xl">تفاصيل قبض الموظفين</h1>
          <p className="dawaa-caption mt-1 font-bold">مسودة ← مراجعة ← اعتماد ← صرف، مع البنود اليدوية والإشعارات الشخصية.</p>
          {canEditPayroll ? <p className="dawaa-caption mt-2 text-xs font-black">أي بند ظاهر للدكتور يُسجل ويصل له كإشعار شخصي.</p> : null}
        </div>
        <button onClick={() => void load()} className="dawaa-button dawaa-button--primary">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث
        </button>
      </div>
    </section>

    {error ? <div className="dawaa-alert dawaa-alert--danger text-sm font-bold">{error}</div> : null}
    {success ? <div className="dawaa-alert dawaa-alert--success text-sm font-bold">{success}</div> : null}

    <div className="grid gap-3 md:grid-cols-4">
      <Card title="إجمالي الصافي" value={formatCurrency(totals.net)} icon={Wallet} />
      <Card title="إجمالي الأساسي" value={formatCurrency(totals.base)} icon={Wallet} />
      <Card title="الحوافز" value={formatCurrency(totals.incentives)} icon={Star} />
      <Card title="الخصومات" value={formatCurrency(totals.deductions)} icon={TrendingUp} />
    </div>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {['draft','pending_review','manager_review','approved','paid'].map((key) => {
        const active = statusFilter === key;
        return (
          <button key={key} onClick={() => setStatusFilter(key)} className={`dawaa-card dawaa-card--interactive p-4 text-right ${active ? 'dawaa-card--raised' : ''}`} aria-pressed={active}>
            <div className="flex items-center justify-between gap-3">
              <span className="dawaa-title text-sm">{statusLabel(key)}</span>
              <span className={`dawaa-badge ${key === 'paid' || key === 'approved' ? 'dawaa-badge--success' : 'dawaa-badge--warning'}`}>
                {key === 'paid' || key === 'approved' ? <CheckCircle2 size={14} /> : <Clock3 size={14} />}
              </span>
            </div>
            <div className="dawaa-title mt-2 text-2xl">{statusSummary[key] || 0}</div>
          </button>
        );
      })}
    </div>

    <section className="dawaa-card grid gap-3 md:grid-cols-3">
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث بالاسم أو staff_id" className="dawaa-input" />
      <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="dawaa-select"><option value="all">كل الفروع</option>{branches.map((branch) => <option key={branch} value={branch}>{branch}</option>)}</select>
      <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="dawaa-select"><option value="all">كل الحالات</option>{Object.entries(STATUS_LABELS).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select>
    </section>

    <section className="dawaa-card">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="dawaa-title text-lg">قائمة القبض</h2>
        <span className="dawaa-source-badge">{visibleRows.length} موظف</span>
      </div>
      {visibleRows.length ? (
        <div className="dawaa-table-shell shadow-none">
          <table className="dawaa-table-semantic min-w-full text-sm">
            <thead><tr><th className="text-right">الموظف</th><th className="text-right">الفرع</th><th className="text-right">الحالة</th><th className="text-right">الأساسي</th><th className="text-right">الساعات</th><th className="text-right">حافز الأداء</th><th className="text-right">حافز التارجت</th><th className="text-right">حوافز أخرى</th><th className="text-right">الخصومات</th><th className="text-right">الصافي</th>{canEditPayroll ? <th className="text-right">إدارة</th> : null}</tr></thead>
            <tbody>{visibleRows.map((r,i) => <tr key={`${r.staff_id || r.username}-${i}`}><td className="font-black">{r.staff_name || r.username || '-'}</td><td>{r.branch || '-'}</td><td><span className={`dawaa-badge ${statusClass(r.status)}`}>{statusLabel(r.status)}</span></td><td>{formatCurrency(n(r.base_salary))}</td><td>{n(r.worked_hours).toLocaleString('ar-EG')}</td><td>{formatCurrency(n(r.performance_incentive))}</td><td>{formatCurrency(n(r.target_bonus))}</td><td>{formatCurrency(n(r.incentives_total)+n(r.quarterly_bonus))}</td><td>{formatCurrency(n(r.deductions_total))}</td><td className="font-black">{formatCurrency(n(r.calculated_net_salary))}</td>{canEditPayroll ? <td><button onClick={() => openEditor(r)} className="dawaa-button dawaa-button--secondary min-h-0 px-3 py-2 text-xs"><Edit3 size={14} /> التفاصيل</button></td> : null}</tr>)}</tbody>
          </table>
        </div>
      ) : <div className="dawaa-empty-state p-5 text-sm font-bold">لا توجد كشوف مطابقة للفلاتر.</div>}
    </section>

    {selected && canEditPayroll ? (
      <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setSelected(null); }}>
        <div className="modal-panel max-w-3xl p-5">
          <div className="flex items-start justify-between gap-3">
            <div><h2 className="dawaa-title text-2xl">تفاصيل قبض {selected.staff_name || selected.username}</h2><p className="dawaa-caption mt-1 font-bold">الدورة {formatCycleDate(cycle.start)} إلى {formatCycleDate(cycle.end)}</p></div>
            <button onClick={() => setSelected(null)} className="dawaa-action-icon h-10 w-10"><X /></button>
          </div>

          {!selected.staff_id ? <div className="dawaa-alert dawaa-alert--warning mt-4 text-sm font-black">لا يمكن إضافة بند قبل ربط صف القبض بـ staff_id الحقيقي.</div> : null}

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="dawaa-caption text-sm font-black">نوع البند<select value={form.entryType} onChange={(e) => setForm((c) => ({...c,entryType:e.target.value}))} className="dawaa-select mt-2">{ENTRY_TYPES.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="dawaa-caption text-sm font-black">القيمة بالجنيه<input type="number" value={form.amount} disabled={form.entryType === 'manual_note'} onChange={(e) => setForm((c) => ({...c,amount:e.target.value}))} className="dawaa-input mt-2" /></label>
            <label className="dawaa-caption text-sm font-black md:col-span-2">عنوان البند<input value={form.title} onChange={(e) => setForm((c) => ({...c,title:e.target.value}))} className="dawaa-input mt-2" /></label>
            <label className="dawaa-caption text-sm font-black md:col-span-2">التفاصيل<textarea value={form.details} onChange={(e) => setForm((c) => ({...c,details:e.target.value}))} rows={4} className="dawaa-textarea mt-2" /></label>
            <label className="dawaa-card dawaa-card--soft flex items-center gap-3 p-3 text-sm font-black md:col-span-2"><input type="checkbox" checked={form.visibleToStaff} onChange={(e) => setForm((c) => ({...c,visibleToStaff:e.target.checked}))} /> يظهر للدكتور ويصله إشعار شخصي</label>
          </div>

          <button disabled={saving || !selected.staff_id} onClick={() => void saveEntry()} className="dawaa-button dawaa-button--primary mt-4 w-full disabled:opacity-50"><Save size={18} /> {saving ? 'جارٍ الحفظ...' : 'حفظ البند وتسجيله'}</button>

          <div className="mt-6">
            <h3 className="dawaa-title text-lg">السجل اليدوي</h3>
            <div className="mt-3 space-y-2">
              {selectedEntries.map((entry) => (
                <div key={entry.id} className="dawaa-card dawaa-card--soft p-3 shadow-none">
                  <div className="flex items-start justify-between gap-3">
                    <div><div className="dawaa-title text-sm">{entry.title}</div><p className="dawaa-body mt-1 text-sm">{entry.details || 'بدون تفاصيل إضافية'}</p></div>
                    {entry.entry_type === 'deduction' ? <span className="dawaa-badge dawaa-badge--danger">{formatCurrency(n(entry.amount))}</span> : <div className="font-black">{formatCurrency(n(entry.amount))}</div>}
                  </div>
                  <div className="dawaa-caption mt-2 text-xs font-bold">{entry.entry_type} · {entry.visible_to_staff ? 'ظاهر للدكتور' : 'إداري فقط'}</div>
                </div>
              ))}
              {!selectedEntries.length ? <div className="dawaa-empty-state p-4 text-sm font-bold">لا توجد بنود يدوية.</div> : null}
            </div>
          </div>
        </div>
      </div>
    ) : null}
  </div>;
}

function Card({ title, value, icon: Icon }: { title: string; value: string; icon: typeof Wallet }) {
  return <div className="dawaa-card p-4"><div className="flex items-center justify-between gap-3"><div><div className="dawaa-caption text-xs font-bold">{title}</div><div className="dawaa-title mt-2 text-2xl">{value}</div></div><span className="dawaa-icon-tile h-11 w-11"><Icon size={20} /></span></div></div>;
}
