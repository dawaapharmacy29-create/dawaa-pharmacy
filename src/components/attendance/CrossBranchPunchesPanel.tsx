import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, MapPin, RefreshCw, Search } from 'lucide-react';
import { listCrossBranchBiometricEvents } from '@/lib/attendance/attendanceOperationsService';
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
  attendance_date: string;
  processing_status: string;
  attendance_type: string | null;
  day_evidence: string;
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
  const [scope, setScope] = useState<'all' | 'accepted' | 'review'>('all');
  const requestSequence = useRef(0);
  const [rows, setRows] = useState<CrossBranchPunch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileStaffId, setProfileStaffId] = useState<string | null>(null);

  useEffect(() => {
    setBranch(defaultBranch || 'الكل');
  }, [defaultBranch]);

  const load = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError(null);
    setRows([]);
    try {
      const data = await listCrossBranchBiometricEvents({
        start,
        end,
        branch: branch === 'الكل' ? null : branch,
        limit: 1000,
      });
      if (requestId !== requestSequence.current) return;
      setRows((data || []) as unknown as CrossBranchPunch[]);
    } catch (e) {
      if (requestId !== requestSequence.current) return;
      setRows([]);
      setError(e instanceof Error ? e.message : 'تعذر تحميل بصمات العمل بين الفروع');
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [branch, end, start]);

  useEffect(() => {
    void load();
    return () => { requestSequence.current += 1; };
  }, [load]);

  const visible = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('ar');
    return rows.filter((row) => {
      const accepted = row.processing_status === 'accepted';
      const needsReview = !accepted || row.day_evidence !== 'linked_attendance_shift_date'
        || row.expected_source === 'staff_current_fallback';
      if (scope === 'accepted' && !accepted) return false;
      if (scope === 'review' && !needsReview) return false;
      return !q || [row.staff_name, row.role, row.home_branch, row.expected_branch,
        row.punch_branch, row.expected_source, row.biometric_user_id, row.device_id,
        row.attendance_date, row.attendance_type]
        .some((value) => String(value || '').toLocaleLowerCase('ar').includes(q));
    });
  }, [rows, scope, search]);

  const staffCount = useMemo(() => new Set(rows.map((row) => row.staff_id)).size, [rows]);
  const acceptedCount = rows.filter((r) => r.processing_status === 'accepted').length;
  const missingLinkCount = rows.filter((r) => r.processing_status !== 'accepted').length;
  const dayGroups = useMemo(() => {
    const groups = new Map<string, {
      staffId: string; name: string; attendanceDate: string;
      expected: string; actual: string; events: number; accepted: number;
      first: string; last: string; uncertain: boolean;
    }>();
    for (const row of visible) {
      const key = [row.staff_id, row.attendance_date, row.expected_branch, row.punch_branch].join('|');
      let group = groups.get(key);
      if (!group) {
        group = {
          staffId: row.staff_id, name: row.staff_name, attendanceDate: row.attendance_date,
          expected: row.expected_branch, actual: row.punch_branch, events: 0, accepted: 0,
          first: row.punch_time, last: row.punch_time, uncertain: false,
        };
        groups.set(key, group);
      }
      group.events++;
      if (row.processing_status === 'accepted') group.accepted++;
      if (row.punch_time < group.first) group.first = row.punch_time;
      if (row.punch_time > group.last) group.last = row.punch_time;
      if (row.day_evidence !== 'linked_attendance_shift_date'
        || row.expected_source === 'staff_current_fallback') group.uncertain = true;
    }
    return Array.from(groups.values()).sort((a,b) =>
      b.attendanceDate.localeCompare(a.attendanceDate) || b.last.localeCompare(a.last));
  }, [visible]);
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
            هوية الموظف واحدة على الجهازين بعد تأكيد ربط كوده بكل جهاز. نعرض فرع الموظف الحالي، وفرع جدول يوم الشيفت، ومكان الجهاز الفعلي. بصمة الخروج بعد منتصف الليل تتبع يوم الشيفت المعتمد، لا تاريخ الساعة فقط. الاختلاف معلومة رقابية وليس مخالفة أو خصمًا تلقائيًا.
          </p>
        </div>
        <button onClick={() => void load()} className="btn-secondary">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> تحديث
        </button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Info label="بصمات من فرع مختلف" value={rows.length} />
        <Info label="موظفون مختلفون" value={staffCount} />
        <Info label="بصمات مقبولة في الحضور" value={acceptedCount} />
        <Info label="غير مقبولة أو لم ترتبط بعد" value={missingLinkCount} />
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

      <div className="mt-3 flex flex-wrap gap-2">
        {([
          { id: 'all', label: 'الكل', count: rows.length },
          { id: 'accepted', label: 'مسجلة في الحضور', count: acceptedCount },
          { id: 'review', label: 'تحتاج فحص البيانات', count: rows.filter((r) =>
            r.processing_status !== 'accepted' || r.day_evidence !== 'linked_attendance_shift_date'
            || r.expected_source === 'staff_current_fallback').length },
        ] as const).map((item) => <button type="button" key={item.id}
          aria-pressed={scope === item.id} onClick={() => setScope(item.id)}
          className={scope === item.id ? 'btn-primary text-xs' : 'btn-secondary text-xs'}>
          {item.label} ({item.count.toLocaleString('ar-EG')})
        </button>)}
      </div>
      {!!routes.length && <div className="mt-3 flex flex-wrap gap-2">
        {routes.slice(0, 8).map(([route, count]) => <span key={route} className="rounded-full border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] px-3 py-1 text-[11px] font-black text-[var(--dawaa-status-info-text)]">{route} · {count.toLocaleString('ar-EG')}</span>)}
      </div>}
    </section>

    {rows.length >= 1000 && <p role="status" className="text-xs font-bold text-[var(--dawaa-status-warning-text)]">عرض أول 1000 بصمة فقط في الفترة؛ قلّل الفترة لرؤية جميع التفاصيل بدون اختصار.</p>}
    {loading && <p role="status" className="text-xs font-bold text-[var(--dawaa-theme-muted)]">جارٍ تحديث بصمات الفترة والفرع المحددين...</p>}
    {error && <div role="alert" className="rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] p-3 text-xs font-black text-[var(--dawaa-status-danger-text)]">⚠️ {error} — لا يُعتبر غياب البيانات دليلًا على عدم وجود بصمات.</div>}
    {!loading && !error && dayGroups.length > 0 && <section className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4">
      <h3 className="mb-1 font-black text-[var(--dawaa-theme-heading)]">ملخص الموظف حسب يوم الشيفت</h3>
      <p className="mb-3 text-xs text-[var(--dawaa-theme-muted)]">تجميع البصمات على نفس الموظف واليوم والفرع؛ لا نعتبر تعدد الأجهزة حضورًا مكررًا.</p>
      <div className="grid gap-2 lg:grid-cols-2">
        {dayGroups.slice(0,40).map((day) => <div key={day.staffId+'|'+day.attendanceDate+'|'+day.actual}
          className="rounded-xl border border-[var(--dawaa-theme-border)] p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button className="font-black text-[var(--dawaa-theme-heading)] hover:underline" onClick={() => setProfileStaffId(day.staffId)}>{day.name}</button>
            <span className="font-bold">{day.attendanceDate}</span>
          </div>
          <p className="mt-1 font-bold">{day.expected || 'فرع غير محدد'} ← {day.actual}</p>
          <p className="mt-1 text-[var(--dawaa-theme-muted)]">
            {day.accepted} من {day.events} بصمات مقبولة في سجل الحضور · {fmt(day.first)}{day.events > 1 ? ' ← '+fmt(day.last) : ''}
          </p>
          {(day.uncertain || day.accepted !== day.events) && <p className="mt-2 font-bold text-[var(--dawaa-status-warning-text)]">
            {day.uncertain ? 'يحتاج التأكد من جدول اليوم أو ربطه بسجل الحضور' : 'توجد بصمة غير مقبولة تحتاج مراجعة'}
          </p>}
        </div>)}
      </div>
      {dayGroups.length > 40 && <p className="mt-2 text-xs text-[var(--dawaa-theme-muted)]">تم عرض أول 40 مجموعة؛ استخدم البحث أو قلّل الفترة لعرض الباقي.</p>}
    </section>}

    <section className="overflow-x-auto rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface shadow-sm">
      <table className="dawaa-table-semantic min-w-[1000px] w-full text-sm">
        <thead><tr className="text-right">
          <th className="p-3">الموظف</th>
          <th className="p-3">فرعه الأساسي</th>
          <th className="p-3">فرع شيفت اليوم</th>
          <th className="p-3">بصم في</th>
          <th className="p-3">يوم الشيفت</th>
          <th className="p-3">وقت البصمة</th>
          <th className="p-3">حالة البصمة</th>
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
              <div className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">{row.expected_source === 'staff_current_fallback' ? 'فرع الموظف الحالي فقط — الجدول غير محدد' : 'جدول يوم الشيفت'}</div>
            </td>
            <td className="p-3"><span className="inline-flex items-center gap-1 rounded-full border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] px-2 py-1 text-xs font-black text-[var(--dawaa-status-info-text)]"><MapPin size={12}/>{row.punch_branch}</span></td>
            <td className="p-3 font-bold">{row.attendance_date || '-'}</td>
            <td className="p-3 font-bold">{fmt(row.punch_time)}</td>
            <td className="p-3">
              <div className="font-bold">{row.processing_status === 'accepted' ? 'مقبولة في سجل الحضور' : row.processing_status === 'unlinked' ? 'لم ترتبط بسجل الحضور' : 'تحتاج مراجعة: '+row.processing_status}</div>
              <div className="text-[10px] text-[var(--dawaa-theme-muted)]">{row.day_evidence === 'linked_attendance_shift_date' ? 'يوم الشيفت مؤكد' : 'التاريخ من ساعة الجهاز'} · {typeLabel(row.attendance_type || row.punch_type)}</div>
            </td>
            <td className="p-3">{typeLabel(row.punch_type)}</td>
            <td className="p-3 font-black">{row.biometric_user_id || '-'}</td>
            <td className="p-3"><div className="font-bold">{row.device_id || '-'}</div><div className="text-[10px] text-[var(--dawaa-theme-muted)]">{row.provider || '-'}</div></td>
          </tr>)}
          {!loading && !error && !visible.length && <tr><td colSpan={10} className="p-8 text-center font-bold text-[var(--dawaa-theme-muted)]">لا توجد بصمات أخرى بين الفروع ضمن النطاق والفلتر المختارين.</td></tr>}
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
