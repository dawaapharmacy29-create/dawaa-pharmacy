import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, Clock3, RefreshCw, Timer, Users2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Row = {
  staff_id: string;
  staff_name: string;
  role: string | null;
  branch: string | null;
  actual_worked_days: number;
  actual_worked_hours: number;
  base_payable_hours: number;
  off_days: number;
  approved_time_off_days: number;
  absence_days: number;
  pending_review_days: number;
  worked_on_off_days: number;
  approved_overtime_hours: number;
  pending_overtime_hours: number;
};

function cairoToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function cycleBounds(today = cairoToday()) {
  const [y, m, d] = today.split('-').map(Number);
  if (d >= 26) {
    const next = new Date(Date.UTC(y, m, 25));
    return { start: `${y}-${String(m).padStart(2, '0')}-26`, end: next.toISOString().slice(0, 10) };
  }
  const prev = new Date(Date.UTC(y, m - 2, 26));
  return { start: prev.toISOString().slice(0, 10), end: `${y}-${String(m).padStart(2, '0')}-25` };
}

function n(value: unknown) {
  const x = Number(value || 0);
  return Number.isFinite(x) ? x : 0;
}

export default function AttendancePayrollTruthPanel({
  branches,
  defaultBranch,
}: {
  branches: string[];
  defaultBranch: string;
}) {
  const bounds = useMemo(() => cycleBounds(), []);
  const [start, setStart] = useState(bounds.start);
  const [end, setEnd] = useState(bounds.end);
  const [branch, setBranch] = useState(defaultBranch || 'الكل');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (defaultBranch) setBranch(defaultBranch);
  }, [defaultBranch]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('attendance_payroll_truth_preview_v1', {
        p_start: start,
        p_end: end,
        p_branch: branch === 'الكل' ? null : branch,
      });
      if (rpcError) throw rpcError;
      setRows((data || []).map((row: any) => ({
        ...row,
        actual_worked_days: n(row.actual_worked_days),
        actual_worked_hours: n(row.actual_worked_hours),
        base_payable_hours: n(row.base_payable_hours),
        off_days: n(row.off_days),
        approved_time_off_days: n(row.approved_time_off_days),
        absence_days: n(row.absence_days),
        pending_review_days: n(row.pending_review_days),
        worked_on_off_days: n(row.worked_on_off_days),
        approved_overtime_hours: n(row.approved_overtime_hours),
        pending_overtime_hours: n(row.pending_overtime_hours),
      })) as Row[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل حقيقة الحضور للمرتب');
    } finally {
      setLoading(false);
    }
  }, [branch, end, start]);

  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => rows.reduce((acc, row) => ({
    workedDays: acc.workedDays + row.actual_worked_days,
    workedHours: acc.workedHours + row.actual_worked_hours,
    baseHours: acc.baseHours + row.base_payable_hours,
    pending: acc.pending + row.pending_review_days,
    approvedOvertime: acc.approvedOvertime + row.approved_overtime_hours,
  }), { workedDays: 0, workedHours: 0, baseHours: 0, pending: 0, approvedOvertime: 0 }), [rows]);

  return (
    <div className="space-y-4" dir="rtl">
      <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="flex-1">
            <h2 className="text-lg font-black text-[var(--dawaa-theme-heading)]">الحضور الفعلي للمرتب</h2>
            <p className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">
              قراءة فقط: اليوم يُحسب عملًا فقط إذا كان معتمدًا وفيه ساعات عمل فعلية. الإجازة الأسبوعية والإجازة المعتمدة لا تُحسب أيام عمل، والأيام المعلقة لا تدخل أي حساب مالي.
            </p>
          </div>
          <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">من<input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="input-dark mt-1 block" /></label>
          <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">إلى<input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="input-dark mt-1 block" /></label>
          <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">الفرع<select value={branch} onChange={(e) => setBranch(e.target.value)} className="input-dark mt-1 block">
            {['الكل', ...branches.filter((b) => b !== 'الكل')].map((b) => <option key={b}>{b}</option>)}
          </select></label>
          <button onClick={() => void load()} className="btn-secondary"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث</button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Metric label="أيام عمل فعلية" value={totals.workedDays} icon={CalendarDays} />
        <Metric label="ساعات عمل فعلية" value={totals.workedHours.toFixed(2)} icon={Clock3} />
        <Metric label="ساعات أساسية مرشحة" value={totals.baseHours.toFixed(2)} icon={Users2} />
        <Metric label="أيام معلقة" value={totals.pending} icon={AlertTriangle} />
        <Metric label="أوفر تايم معتمد" value={totals.approvedOvertime.toFixed(2)} icon={Timer} />
      </div>

      {error && <div className="rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] p-3 text-sm font-bold text-[var(--dawaa-status-danger-text)]">⚠️ {error}</div>}

      <div className="overflow-x-auto rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface shadow-sm">
        <table className="min-w-[1100px] w-full text-sm">
          <thead className="border-b border-[var(--dawaa-theme-border)] text-[var(--dawaa-theme-muted)]">
            <tr>
              <th className="p-3 text-right">الموظف</th>
              <th className="p-3 text-right">الفرع</th>
              <th className="p-3 text-right">أيام عمل فعلية</th>
              <th className="p-3 text-right">ساعات فعلية</th>
              <th className="p-3 text-right">ساعات أساسية</th>
              <th className="p-3 text-right">إجازة أسبوعية</th>
              <th className="p-3 text-right">إجازة معتمدة</th>
              <th className="p-3 text-right">غياب معتمد</th>
              <th className="p-3 text-right">عمل في يوم إجازة</th>
              <th className="p-3 text-right">معلقة</th>
              <th className="p-3 text-right">OT معتمد</th>
              <th className="p-3 text-right">OT معلق</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.staff_id} className="border-b border-[var(--dawaa-theme-divider)] last:border-0">
                <td className="p-3"><div className="font-black text-[var(--dawaa-theme-heading)]">{row.staff_name}</div><div className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">{row.role || '-'}</div></td>
                <td className="p-3">{row.branch || '-'}</td>
                <td className="p-3 font-black text-[var(--dawaa-status-success-text)]">{row.actual_worked_days}</td>
                <td className="p-3 font-black">{row.actual_worked_hours.toFixed(2)}</td>
                <td className="p-3 font-black">{row.base_payable_hours.toFixed(2)}</td>
                <td className="p-3">{row.off_days}</td>
                <td className="p-3">{row.approved_time_off_days}</td>
                <td className="p-3">{row.absence_days}</td>
                <td className="p-3">{row.worked_on_off_days}</td>
                <td className="p-3 font-black text-[var(--dawaa-status-warning-text)]">{row.pending_review_days}</td>
                <td className="p-3 font-black text-[var(--dawaa-status-success-text)]">{row.approved_overtime_hours.toFixed(2)}</td>
                <td className="p-3 font-black text-[var(--dawaa-status-warning-text)]">{row.pending_overtime_hours.toFixed(2)}</td>
              </tr>
            ))}
            {!loading && !rows.length && <tr><td colSpan={12} className="p-8 text-center font-bold text-[var(--dawaa-theme-muted)]">لا توجد بيانات حضور في الفترة الحالية.</td></tr>}
            {loading && <tr><td colSpan={12} className="p-8 text-center font-bold text-[var(--dawaa-theme-muted)]">جارٍ تحميل الحضور الفعلي...</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] p-3 text-xs font-bold text-[var(--dawaa-status-info-text)]">
        هذا التقرير لا يحسب قيمة المرتب ولا يغيّر Payroll. الهدف منه تثبيت الحقيقة التشغيلية أولًا: اشتغل كام يوم وساعة فعلًا، وما الذي ما زال معلقًا للمراجعة.
      </div>
    </div>
  );
}

function Metric({ label, value, icon: Icon }: { label: string; value: number | string; icon: typeof Clock3 }) {
  return <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm"><div className="flex items-center gap-2 text-xs font-black text-[var(--dawaa-theme-muted)]"><Icon size={16}/>{label}</div><div className="mt-2 text-2xl font-black text-[var(--dawaa-theme-heading)]">{value}</div></div>;
}
