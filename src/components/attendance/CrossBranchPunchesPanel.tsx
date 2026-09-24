import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, MapPin, RefreshCw, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import EmployeeProfileDrawer from '@/components/attendance/EmployeeProfileDrawer';

type CrossBranchPunch = {
  staff_id: string;
  staff_name: string;
  role: string | null;
  home_branch: string;
  expected_branch: string;
  punch_branch: string;
  expected_source: string;
  biometric_user_id: string | null;
  punch_time: string;
  punch_type: string | null;
  device_id: string | null;
  provider: string | null;
};

function cairoToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function cycleStartFor(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  const cycleEnd = day >= 26
    ? new Date(Date.UTC(year, month, 25))
    : new Date(Date.UTC(year, month - 1, 25));
  const start = new Date(Date.UTC(cycleEnd.getUTCFullYear(), cycleEnd.getUTCMonth() - 1, 26));
  return start.toISOString().slice(0, 10);
}

function fmt(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('ar-EG', {
    timeZone: 'Africa/Cairo',
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function typeLabel(value?: string | null) {
  if (value === 'check_in' || value === 'in') return 'دخول';
  if (value === 'check_out' || value === 'out') return 'خروج';
  if (value === 'unknown') return 'غير محدد من الجهاز';
  return value || '-';
}

export default function CrossBranchPunchesPanel({
  defaultBranch = 'الكل',
}: {
  defaultBranch?: string;
}) {
  const today = cairoToday();
  const [start, setStart] = useState(() => cycleStartFor(today));
  const [end, setEnd] = useState(today);
  const [branch, setBranch] = useState(defaultBranch || 'الكل');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<CrossBranchPunch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileStaffId, setProfileStaffId] = useState<string | null>(null);

  useEffect(() => {
    setBranch(defaultBranch || 'الكل');
  }, [defaultBranch]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('list_cross_branch_biometric_events_v2', {
        p_start: start,
        p_end: end,
        p_branch: branch === 'الكل' ? null : branch,
        p_limit: 1000,
      });
      if (rpcError) throw rpcError;
      setRows((data || []) as CrossBranchPunch[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل البصمات بين الفروع');
    } finally {
      setLoading(false);
    }
  }, [branch, end, start]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('ar');
    if (!q) return rows;
    return rows.filter((row) =>
      [row.staff_name, row.role, row.home_branch, row.expected_branch, row.punch_branch, row.expected_source, row.biometric_user_id, row.device_id]
        .some((value) => String(value || '').toLocaleLowerCase('ar').includes(q))
    );
  }, [rows, search]);

  const staffCount = useMemo(() => new Set(rows.map((row) => row.staff_id)).size, [rows]);
  const routes = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) {
      const key = `${row.expected_branch} ← ${row.punch_branch}`;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  return <div className="space-y-4">
    <section className="rounded-2xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ArrowLeftRight size={20} className="text-[var(--dawaa-status-info-text)]" />
            <h2 className="text-lg font-black text-[var(--dawaa-theme-heading)]">البصمات بين الفروع</h2>
          </div>
          <p className="mt-1 max-w-3xl text-xs font-bold text-[var(--dawaa-theme-muted)]">
            الموظف يُحتسب حضوره طبيعيًا حتى لو بصم على جهاز فرع مختلف. هذه الشاشة رقابية فقط: تقارن مكان البصمة بالفرع المتوقع حسب جدول نفس اليوم، مع إظهار الفرع الأساسي للمعلومة، ولا تعتبر الاختلاف خطأ أو خصمًا.
          </p>
        </div>
        <button onClick={() => void load()} className="btn-secondary">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> تحديث
        </button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Info label="عدد البصمات بين الفروع" value={rows.length} />
        <Info label="موظفون مختلفون" value={staffCount} />
        <Info label="من" value={start} />
        <Info label="إلى" value={end} />
      </div>
    </section>

    <section className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
      <div className="grid gap-3 md:grid-cols-4">
        <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">
          من
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="input-dark mt-1 w-full" />
        </label>
        <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">
          إلى
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="input-dark mt-1 w-full" />
        </label>
        <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">
          الفرع المتوقع حسب الجدول
          <select value={branch} onChange={(e) => setBranch(e.target.value)} className="input-dark mt-1 w-full">
            <option value="الكل">الكل</option>
            <option value="فرع الشامي">فرع الشامي</option>
            <option value="فرع شكري">فرع شكري</option>
            <option value="المخزن">المخزن</option>
          </select>
        </label>
        <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">
          بحث
          <div className="relative mt-1">
            <Search size={14} className="absolute right-3 top-3 text-[var(--dawaa-theme-muted)]" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} className="input-dark w-full pr-9" placeholder="اسم / كود / جهاز..." />
          </div>
        </label>
      </div>

      {!!routes.length && <div className="mt-3 flex flex-wrap gap-2">
        {routes.slice(0, 8).map(([route, count]) => <span key={route} className="rounded-full border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] px-3 py-1 text-[11px] font-black text-[var(--dawaa-status-info-text)]">{route} · {count.toLocaleString('ar-EG')}</span>)}
      </div>}
    </section>

    {error && <div className="rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] p-3 text-xs font-black text-[var(--dawaa-status-danger-text)]">⚠️ {error}</div>}

    <section className="overflow-x-auto rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface shadow-sm">
      <table className="dawaa-table-semantic min-w-[1000px] w-full text-sm">
        <thead><tr className="text-right">
          <th className="p-3">الموظف</th>
          <th className="p-3">فرعه الأساسي</th>
          <th className="p-3">الفرع المتوقع</th>
          <th className="p-3">بصم في</th>
          <th className="p-3">الوقت</th>
          <th className="p-3">نوع الجهاز</th>
          <th className="p-3">كود البصمة</th>
          <th className="p-3">الجهاز</th>
        </tr></thead>
        <tbody>
          {visible.map((row, index) => <tr key={`${row.staff_id}-${row.punch_time}-${index}`} className="border-t border-[var(--dawaa-theme-divider)] bg-[var(--dawaa-status-info-bg)]/20">
            <td className="p-3">
              <button onClick={() => setProfileStaffId(row.staff_id)} className="font-black text-[var(--dawaa-theme-heading)] hover:underline">{row.staff_name}</button>
              <div className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">{row.role || '-'}</div>
            </td>
            <td className="p-3 font-bold">{row.home_branch || '-'}</td>
            <td className="p-3">
              <div className="font-black text-[var(--dawaa-theme-heading)]">{row.expected_branch || '-'}</div>
              <div className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">{row.expected_source === 'staff_current_fallback' ? 'Fallback: الفرع الحالي' : 'حسب جدول اليوم'}</div>
            </td>
            <td className="p-3"><span className="inline-flex items-center gap-1 rounded-full border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] px-2 py-1 text-xs font-black text-[var(--dawaa-status-info-text)]"><MapPin size={12}/>{row.punch_branch}</span></td>
            <td className="p-3 font-bold">{fmt(row.punch_time)}</td>
            <td className="p-3">{typeLabel(row.punch_type)}</td>
            <td className="p-3 font-black">{row.biometric_user_id || '-'}</td>
            <td className="p-3"><div className="font-bold">{row.device_id || '-'}</div><div className="text-[10px] text-[var(--dawaa-theme-muted)]">{row.provider || '-'}</div></td>
          </tr>)}
          {!loading && !visible.length && <tr><td colSpan={8} className="p-8 text-center font-bold text-[var(--dawaa-theme-muted)]">لا توجد بصمات بين الفروع في الفترة/الفلتر المحدد.</td></tr>}
        </tbody>
      </table>
    </section>

    {profileStaffId && <EmployeeProfileDrawer staffId={profileStaffId} onClose={() => setProfileStaffId(null)} />}
  </div>;
}

function Info({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-3">
    <div className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">{label}</div>
    <div className="mt-1 text-lg font-black text-[var(--dawaa-theme-heading)]">{typeof value === 'number' ? value.toLocaleString('ar-EG') : value}</div>
  </div>;
}
