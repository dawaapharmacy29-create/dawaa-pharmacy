import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarCheck, Clock, Loader2, Pencil, Download, RefreshCw, Search, Filter, Wallet, CreditCard, Receipt, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/utils';
import { Panel, SectionTitle, EmptyState, MiniBox } from '@/components/dashboard/DashboardPrimitives';
import {
  SHIFT_HANDOVER_BRANCHES, SHIFT_TYPES, onDutyLabel, shiftCoverage,
  type OnDutyDoctor, type ShiftHandoverCorrection, type ShiftSlot, type ShiftSlotStatus,
} from '@/lib/shiftHandoverCoverage';

const BRANCHES = ['الكل', ...SHIFT_HANDOVER_BRANCHES] as const;
const COVERAGE_DAYS = 14;
const MIN_SOURCE_DATE = '2026-10-01';
const SHIFT_FILTERS = ['الكل', ...SHIFT_TYPES] as const;
const money = (value: number) => Number(value || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ج';
const PAYMENTS = [
  ['cash_sales', 'كاش'], ['visa_sales', 'فيزا'], ['insta_sales', 'إنستا'], ['vodafone_sales', 'فودافون'], ['other_sales', 'أخرى'],
] as const;
// The fields top management can correct here (correct_shift_handover_v1); Base44 keeps its own copy.
const EDIT_FIELDS = [
  ['submitted_by', 'اللي قفل', 'text'], ['total_sales', 'إجمالي المبيعات', 'number'], ['cash_sales', 'كاش', 'number'],
  ['visa_sales', 'فيزا', 'number'], ['insta_sales', 'إنستا', 'number'], ['vodafone_sales', 'فودافون', 'number'],
  ['other_sales', 'أخرى', 'number'], ['total_expenses', 'المصروفات', 'number'], ['net_amount', 'صافي التسليم', 'number'],
  ['cash_handover', 'الكاش المسلّم', 'number'], ['cash_variance', 'فرق الكاش', 'number'], ['notes', 'ملاحظات', 'text'],
] as const;
type EditKey = (typeof EDIT_FIELDS)[number][0];
const EDIT_LABEL = Object.fromEntries(EDIT_FIELDS.map(([key, label]) => [key, label])) as Record<string, string>;
const CORRECT_ERRORS: Record<string, string> = {
  not_authorized: 'التعديل للمدير العام والتنفيذي بس',
  reason_required: 'اكتب سبب التعديل',
  no_changes: 'مفيش حاجة اتغيرت',
  invalid_amount: 'المبالغ لازم تبقى أرقام',
};

type OnDutySlot = { branch: string; shift_date: string; shift_type: string; doctors: OnDutyDoctor[] };

const STATUS: Record<ShiftSlotStatus, { label: string; tone: string }> = {
  closed: { label: '✓', tone: 'dawaa-badge--success' },
  duplicate: { label: '×2', tone: 'dawaa-badge--warning' },
  late: { label: 'ناقص', tone: 'dawaa-badge--danger' },
  pending: { label: '…', tone: 'dawaa-badge--info' },
};

type ShiftRow = {
  id: string;
  branch: string;
  shift_type: string;
  shift_date: string;
  submitted_by: string | null;
  total_sales: number;
  total_expenses: number;
  net_amount: number;
  expenses: { category?: string; amount?: number; description?: string }[];
  cash_sales: number | null;
  visa_sales: number | null;
  insta_sales: number | null;
  vodafone_sales: number | null;
  other_sales: number | null;
  cash_handover: number | null;
  cash_variance: number | null;
  notes: string | null;
  is_archived: boolean | null;
  recorded_at: string | null;
  synced_at: string | null;
};

function n(value: unknown) {
  const x = Number(value || 0);
  return Number.isFinite(x) ? x : 0;
}

const dayLabel = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString('ar-EG', { weekday: 'short', day: 'numeric', month: 'numeric' });
const timeLabel = (value: string | null) =>
  value ? new Date(value).toLocaleString('ar-EG', { day: 'numeric', month: 'numeric', hour: 'numeric', minute: '2-digit' }) : '-';

async function fetchAllShiftRows(): Promise<{ rows: ShiftRow[]; error: boolean }> {
  const all: ShiftRow[] = [];
  const PAGE_SIZE = 500;
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('shift_handovers')
      .select('*')
      .gte('shift_date', MIN_SOURCE_DATE)
      .order('shift_date', { ascending: false })
      .order('recorded_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) return { rows: [], error: true };
    const page = (data || []) as ShiftRow[];
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return { rows: all, error: false };
}

function EditHandover({ row, onDone, onCancel }: { row: ShiftRow; onDone: () => void; onCancel: () => void }) {
  const initial = Object.fromEntries(EDIT_FIELDS.map(([key]) => [key, row[key] == null ? '' : String(row[key])])) as Record<EditKey, string>;
  const [values, setValues] = useState(initial);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    const changes: Record<string, string | number | null> = {};
    for (const [key, , kind] of EDIT_FIELDS) {
      if (values[key] === initial[key]) continue;
      const raw = values[key].trim();
      if (kind === 'number') {
        const value = raw === '' ? null : Number(raw);
        if (value !== null && !Number.isFinite(value)) return setError(`${EDIT_LABEL[key]}: لازم رقم`);
        changes[key] = value;
      } else {
        changes[key] = raw || null;
      }
    }
    setBusy(true);
    setError('');
    const { error: rpcError } = await supabase.rpc('correct_shift_handover_v1', {
      p_handover_id: row.id, p_changes: changes, p_reason: reason,
    });
    setBusy(false);
    if (rpcError) {
      const code = Object.keys(CORRECT_ERRORS).find((k) => rpcError.message?.includes(k));
      return setError(code ? CORRECT_ERRORS[code] : 'تعذّر الحفظ');
    }
    onDone();
  };

  return (
    <div className="mt-3 space-y-2 rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
      <p className="dawaa-caption text-xs font-bold">المراجعة تُسجل داخل الإدارة فقط؛ بيانات دواء وائل الأصلية لا تتغير، ولا تتأثر بها إجماليات التقرير.</p>
      <div className="grid gap-2 sm:grid-cols-3">
        {EDIT_FIELDS.map(([key, label, kind]) => (
          <label key={key} className="text-xs font-bold">
            {label}
            <input
              className="dawaa-input mt-1 w-full"
              inputMode={kind === 'number' ? 'decimal' : undefined}
              value={values[key]}
              onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      <input className="dawaa-input w-full" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="سبب التعديل (لازم)" />
      {error ? <p className="text-xs font-bold" style={{ color: 'var(--dawaa-status-danger-text)' }}>{error}</p> : null}
      <div className="flex gap-2">
        <button type="button" disabled={busy || !reason.trim()} onClick={() => void save()}
          className="dawaa-badge dawaa-badge--success rounded-xl px-3 py-1 text-xs font-black disabled:opacity-50">حفظ التعديل</button>
        <button type="button" disabled={busy} onClick={onCancel} className="dawaa-caption text-xs font-black underline">إلغاء</button>
      </div>
    </div>
  );
}

export default function ShiftHandovers() {
  const [rows, setRows] = useState<ShiftRow[]>([]);
  const [corrections, setCorrections] = useState<ShiftHandoverCorrection[]>([]);
  const [onDuty, setOnDuty] = useState<OnDutySlot[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [branchFilter, setBranchFilter] = useState<(typeof BRANCHES)[number]>('الكل');
  const [shiftFilter, setShiftFilter] = useState<(typeof SHIFT_FILTERS)[number]>('الكل');
  const [dateFrom, setDateFrom] = useState(MIN_SOURCE_DATE);
  const [dateTo, setDateTo] = useState('');
  const [query, setQuery] = useState('');
  const [showCoverage, setShowCoverage] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    const since = MIN_SOURCE_DATE;
    // The on-duty range is capped at 45 days; tomorrow covers the Cairo day after UTC midnight.
    const dutyFrom = new Date(Date.now() - 44 * 864e5).toISOString().slice(0, 10);
    const dutyTo = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
    const [source, fixes, duty] = await Promise.all([
      fetchAllShiftRows(),
      supabase.from('shift_handover_corrections_v1').select('*').gte('created_at', since).order('created_at').limit(1000),
      // Top management only; everyone else sees the page without the names.
      supabase.rpc('shift_handover_on_duty_v1', { p_from: dutyFrom, p_to: dutyTo }),
    ]);
    setCorrections(fixes.error ? [] : ((fixes.data || []) as ShiftHandoverCorrection[]));
    setOnDuty(duty.error ? null : ((duty.data || []) as OnDutySlot[]));
    if (source.error) {
      setLoadError(true);
      setLoading(false);
      return;
    }
    setRows(source.rows);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Base44/DawaaWael values remain authoritative. Local management corrections are displayed
  // as separate audit notes only and never change the source totals or financial reports.
  const live = useMemo(
    () => rows.filter((r) => !r.is_archived),
    [rows]
  );
  const fixesOf = (id: string) => corrections.filter((c) => c.handover_id === id);
  const doctorsAt = (branch: string, day: string, shift: string) =>
    onDuty?.find((d) => d.branch === branch && d.shift_date === day && d.shift_type === shift)?.doctors;
  const filtered = useMemo(
    () => live.filter((r) =>
      (branchFilter === 'الكل' || r.branch === branchFilter) &&
      (shiftFilter === 'الكل' || r.shift_type === shiftFilter) &&
      r.shift_date >= (dateFrom || MIN_SOURCE_DATE) &&
      (!dateTo || r.shift_date <= dateTo) &&
      (!query.trim() || [r.submitted_by, r.notes, r.branch].some((v) => String(v || '').includes(query.trim())))
    ),
    [live, branchFilter, shiftFilter, dateFrom, dateTo, query]
  );
  const coverage = useMemo(() => shiftCoverage(live, COVERAGE_DAYS), [live]);
  const late = useMemo(
    () => coverage.filter((slot) => slot.status === 'late' && (branchFilter === 'الكل' || slot.branch === branchFilter)),
    [coverage, branchFilter]
  );
  const lastSync = useMemo(
    () => rows.reduce<string | null>((max, r) => (r.synced_at && (!max || r.synced_at > max) ? r.synced_at : max), null),
    [rows]
  );

  const totals = useMemo(
    () => ({
      count: filtered.length,
      totalSales: filtered.reduce((a, r) => a + n(r.total_sales), 0),
      totalExpenses: filtered.reduce((a, r) => a + n(r.total_expenses), 0),
      totalNet: filtered.reduce((a, r) => a + n(r.net_amount), 0),
    }),
    [filtered]
  );

  const dailySummary = useMemo(() => {
    const groups = new Map<string, { day: string; branch: string; count: number; sales: number; expenses: number; net: number }>();
    for (const r of filtered) {
      const key = r.shift_date + '|' + r.branch;
      const g = groups.get(key) || { day: r.shift_date, branch: r.branch, count: 0, sales: 0, expenses: 0, net: 0 };
      g.count += 1; g.sales += n(r.total_sales); g.expenses += n(r.total_expenses); g.net += n(r.net_amount);
      groups.set(key, g);
    }
    return [...groups.values()].sort((a, b) => b.day.localeCompare(a.day) || a.branch.localeCompare(b.branch));
  }, [filtered]);

  const days = useMemo(() => [...new Set(coverage.map((slot) => slot.day))], [coverage]);
  const slotOf = (day: string, branch: string, shift: string) =>
    coverage.find((slot) => slot.day === day && slot.branch === branch && slot.shift === shift) as ShiftSlot<ShiftRow>;
  const visibleBranches = branchFilter === 'الكل' ? SHIFT_HANDOVER_BRANCHES : [branchFilter];
  const exportCsv = () => {
    const header = ['التاريخ', 'الفرع', 'الشيفت', 'المسؤول', 'المبيعات', 'كاش', 'فيزا', 'إنستا', 'فودافون', 'أخرى', 'المصروفات', 'الصافي', 'الكاش المسلم', 'فرق الكاش', 'ملاحظات'];
    const values = filtered.map((r) => [
      r.shift_date, r.branch, r.shift_type, r.submitted_by, r.total_sales, r.cash_sales, r.visa_sales,
      r.insta_sales, r.vodafone_sales, r.other_sales, r.total_expenses, r.net_amount,
      r.cash_handover, r.cash_variance, r.notes,
    ]);
    const esc = (value: unknown) => '"' + String(value ?? '').replace(/"/g, '""') + '"';
    const csv = '\uFEFF' + [header, ...values].map((line) => line.map(esc).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'dawaa-wael-shift-handovers.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5" dir="rtl">
      <section className="rounded-2xl border border-teal-100 bg-gradient-to-l from-teal-50 via-white to-slate-50 p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h1 className="dawaa-title text-2xl">تسليمات الشيفتات ومراجعة التحصيل</h1>
            <p className="dawaa-caption mt-1 font-bold">المصدر المالي: دواء وائل حصريًا · السجلات من أكتوبر 2026 وما بعده</p>
            <p className="mt-1 text-xs text-slate-500">آخر مزامنة: {timeLabel(lastSync)} · التعديلات المحلية تُعرض كسجل تدقيق، ولا تدخل في إجماليات مصدر دواء وائل</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="dawaa-tab inline-flex items-center gap-2" onClick={() => void load()}><RefreshCw size={16}/> تحديث</button>
            <button type="button" className="dawaa-tab inline-flex items-center gap-2" onClick={exportCsv} disabled={!filtered.length}><Download size={16}/> Excel / CSV</button>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="فلاتر التسليمات">
        <div className="mb-3 flex items-center gap-2 font-bold text-slate-700"><Filter size={17}/> البحث والفلاتر</div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <label className="text-xs font-bold">الفرع<select className="dawaa-input mt-1 w-full" value={branchFilter} onChange={e => setBranchFilter(e.target.value as typeof branchFilter)}>{BRANCHES.map(v=><option key={v}>{v}</option>)}</select></label>
          <label className="text-xs font-bold">الشيفت<select className="dawaa-input mt-1 w-full" value={shiftFilter} onChange={e => setShiftFilter(e.target.value as typeof shiftFilter)}>{SHIFT_FILTERS.map(v=><option key={v}>{v}</option>)}</select></label>
          <label className="text-xs font-bold">من تاريخ<input className="dawaa-input mt-1 w-full" type="date" min={MIN_SOURCE_DATE} value={dateFrom} onChange={e => setDateFrom(e.target.value < MIN_SOURCE_DATE ? MIN_SOURCE_DATE : e.target.value)}/></label>
          <label className="text-xs font-bold">إلى تاريخ<input className="dawaa-input mt-1 w-full" type="date" min={MIN_SOURCE_DATE} value={dateTo} onChange={e => setDateTo(e.target.value)}/></label>
          <label className="text-xs font-bold">الدكتور أو الملاحظات<div className="relative mt-1"><Search size={15} className="absolute right-3 top-3 text-slate-400"/><input className="dawaa-input w-full pr-9" value={query} onChange={e => setQuery(e.target.value)} placeholder="ابحث في السجل"/></div></label>
        </div>
      </section>

      <Panel className="p-4">
        <button type="button" onClick={() => setShowCoverage(v => !v)} className="flex w-full items-center justify-between rounded-xl bg-slate-50 p-3 text-right font-black text-slate-800">
          <span className="inline-flex items-center gap-2"><CalendarCheck size={18}/> متابعة اكتمال الشيفتات (آخر {COVERAGE_DAYS} يوم)</span>
          <span className="dawaa-badge dawaa-badge--warning">{late.length} حالة تحتاج مراجعة · {showCoverage ? 'إخفاء' : 'عرض'}</span>
        </button>
        {showCoverage && <>
        <p className="dawaa-caption mb-3 text-xs font-bold">
          كل فرع بيقفل 3 شيفتات في اليوم. الشيفت بيبقى «ناقص» بعد ميعاده بساعتين: الليلي 10 الصبح، الصباحي 7 بالليل، المسائي 3 الفجر.
        </p>
        {late.length ? (
          <div className="dawaa-alert dawaa-alert--danger mb-3 text-sm font-bold">
            <p>{late.length} شيفت ما اتقفلش:</p>
            <ul className="mt-1 space-y-0.5">
              {late.slice(0, 12).map((slot) => {
                const who = onDutyLabel(doctorsAt(slot.branch, slot.day, slot.shift));
                return (
                  <li key={`${slot.branch}${slot.day}${slot.shift}`}>
                    {slot.branch.replace('فرع ', '')} {dayLabel(slot.day)} {slot.shift}{who ? ` — الموجود وقت التقفيل: ${who}` : ''}
                  </li>
                );
              })}
            </ul>
            {late.length > 12 ? <p>…</p> : null}
          </div>
        ) : null}
        {loading ? null : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-center text-xs font-bold">
              <thead>
                <tr>
                  <th className="p-1 text-right">اليوم</th>
                  {visibleBranches.map((branch) => SHIFT_TYPES.map((shift) => (
                    <th key={`${branch}${shift}`} className="p-1">{branch.replace('فرع ', '')} · {shift}</th>
                  )))}
                </tr>
              </thead>
              <tbody>
                {days.map((day) => (
                  <tr key={day} className="border-t" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
                    <td className="p-1 text-right">{dayLabel(day)}</td>
                    {visibleBranches.map((branch) => SHIFT_TYPES.map((shift) => {
                      const slot = slotOf(day, branch, shift);
                      const status = STATUS[slot.status];
                      const onDutyNow = onDutyLabel(doctorsAt(branch, day, shift));
                      const who = [
                        ...slot.rows.map((r) => `${r.submitted_by || '-'} · ${formatCurrency(n(r.net_amount))}`),
                        ...(onDutyNow ? [`الموجود وقت التقفيل: ${onDutyNow}`] : []),
                      ].join('\n');
                      return (
                        <td key={`${branch}${shift}`} className="p-1">
                          <span className={`dawaa-badge ${status.tone} rounded-md px-2 py-0.5`} title={who || undefined}>{status.label}</span>
                        </td>
                      );
                    }))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </>}
      </Panel>

      <div className="grid gap-3 md:grid-cols-4">
        <MiniBox label="عدد التسليمات في الفترة المختارة" value={totals.count.toLocaleString('ar-EG')} />
        <MiniBox label="إجمالي المبيعات" value={formatCurrency(totals.totalSales)} />
        <MiniBox label="إجمالي المصروفات" value={formatCurrency(totals.totalExpenses)} tone="amber" />
        <MiniBox label="صافي التسليم" value={formatCurrency(totals.totalNet)} tone="green" />
      </div>

      <Panel className="p-4">
        <SectionTitle title="تقرير يومي حسب الفرع" icon={<Receipt size={18}/>} />
        <p className="dawaa-caption mb-3 text-xs">التجميع حسب يوم التسليم المسجل في دواء وائل؛ يحتوي التكرارات كما هي حتى تتم مراجعتها.</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[650px] text-right text-sm">
            <thead className="bg-slate-50 text-slate-700"><tr>
              {['اليوم','الفرع','التسليمات','المبيعات','المصروفات','الصافي'].map(h => <th key={h} className="p-3 font-black">{h}</th>)}
            </tr></thead>
            <tbody>{dailySummary.map(g => <tr key={g.day + g.branch} className="border-t border-slate-100">
              <td className="p-3">{dayLabel(g.day)}</td><td className="p-3 font-bold">{g.branch}</td>
              <td className="p-3">{g.count}</td><td className="p-3">{money(g.sales)}</td>
              <td className="p-3">{money(g.expenses)}</td><td className="p-3 font-black text-teal-700">{money(g.net)}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </Panel>

      <Panel className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3"><SectionTitle title="سجل التسليمات التفصيلي" icon={<Clock size={18} />} />
          <span className="text-xs font-bold text-slate-500">سجل مقروء من دواء وائل، مع إظهار أي تعديلات إدارة موثقة</span>
        </div>
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="animate-spin" style={{ color: 'var(--dawaa-theme-muted)' }} /></div>
        ) : loadError ? (
          <EmptyState label="تعذّر التحميل" error onRetry={() => void load()} />
        ) : filtered.length === 0 ? (
          <EmptyState label="لا توجد تسليمات مسجلة" />
        ) : (
          <div className="space-y-2">
            {filtered.map((row) => (
              <div key={row.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-teal-200 transition-colors">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
                      {row.branch} — شيفت {row.shift_type} · {dayLabel(row.shift_date)}
                    </p>
                    <p className="dawaa-caption mt-0.5 text-xs font-bold">
                      بواسطة {row.submitted_by || '-'} · اتسجل {timeLabel(row.recorded_at)}
                      {fixesOf(row.id).length ? <span className="dawaa-badge dawaa-badge--warning mr-2">ملاحظة مراجعة</span> : null}
                    </p>
                    {onDuty ? (
                      <p className="dawaa-caption mt-0.5 text-xs font-bold">
                        الموجود وقت التقفيل: {onDutyLabel(doctorsAt(row.branch, row.shift_date, row.shift_type)) || '-'}
                      </p>
                    ) : null}
                  </div>
                  <div className="text-left">
                    <p className="font-black" style={{ color: 'var(--dawaa-status-success-text)' }}>
                      {formatCurrency(n(row.net_amount))}
                    </p>
                    <p className="dawaa-caption text-xs font-bold">
                      مبيعات {formatCurrency(n(row.total_sales))} · مصروفات {formatCurrency(n(row.total_expenses))}
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-xs font-bold sm:grid-cols-4">
                  <div className="flex items-center gap-1 text-slate-700"><Wallet size={14}/> صافي التسليم <strong>{money(n(row.net_amount))}</strong></div>
                  <div className="flex items-center gap-1 text-slate-700"><CreditCard size={14}/> النقدي المسلم <strong>{money(n(row.cash_handover))}</strong></div>
                  <div className="flex items-center gap-1 text-slate-700"><Receipt size={14}/> المصروفات <strong>{money(n(row.total_expenses))}</strong></div>
                  <div className={`flex items-center gap-1 ${Math.abs(n(row.cash_variance)) > 1 ? 'text-red-700' : 'text-teal-700'}`}><AlertTriangle size={14}/> فرق النقدية <strong>{money(n(row.cash_variance))}</strong></div>
                </div>
                <button type="button" className="mt-3 text-sm font-bold text-teal-700 underline" onClick={() => setExpanded(v => v === row.id ? null : row.id)}>{expanded === row.id ? 'إخفاء تفاصيل طرق الدفع والمصروفات' : 'عرض طرق الدفع والمصروفات والملاحظات'}</button>
                {expanded === row.id && <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold">
                  {PAYMENTS.filter(([key]) => n(row[key])).map(([key, label]) => (
                    <span key={key} className="dawaa-badge dawaa-badge--neutral">{label}: {formatCurrency(n(row[key]))}</span>
                  ))}
                  {n(row.cash_variance) ? (
                    <span className="dawaa-badge dawaa-badge--danger">فرق كاش: {formatCurrency(n(row.cash_variance))}</span>
                  ) : null}
                  {row.expenses?.map((e, idx) => (
                    <span key={idx} className="dawaa-badge dawaa-badge--info">
                      {e.category || e.description || '-'}: {formatCurrency(n(e.amount))}
                    </span>
                  ))}
                  {row.notes ? <p className="mt-2 text-xs font-bold">📝 {row.notes}</p> : null}
                </div>}
                {fixesOf(row.id).map((c) => (
                  <p key={c.id} className="dawaa-caption mt-1 text-xs font-bold">
                    ✏️ {c.corrected_by_name || '-'} · {timeLabel(c.created_at)} · {c.reason}:{' '}
                    {Object.entries(c.changes).map(([key, value]) => `${EDIT_LABEL[key] ?? key} ${c.previous[key] ?? '-'} ← ${value ?? '-'}`).join('، ')}
                  </p>
                ))}
                {onDuty && editing !== row.id ? (
                  <button type="button" onClick={() => setEditing(row.id)} className="dawaa-caption mt-2 inline-flex items-center gap-1 text-xs font-black underline">
                    <Pencil size={12} /> تسجيل مراجعة
                  </button>
                ) : null}
                {editing === row.id ? (
                  <EditHandover row={row} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); void load(); }} />
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
