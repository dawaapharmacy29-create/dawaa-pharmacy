import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarCheck, Clock, Loader2, Pencil } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/utils';
import { Panel, SectionTitle, EmptyState, MiniBox } from '@/components/dashboard/DashboardPrimitives';
import {
  SHIFT_HANDOVER_BRANCHES, SHIFT_TYPES, applyCorrections, onDutyLabel, shiftCoverage,
  type OnDutyDoctor, type ShiftHandoverCorrection, type ShiftSlot, type ShiftSlotStatus,
} from '@/lib/shiftHandoverCoverage';

const BRANCHES = ['الكل', ...SHIFT_HANDOVER_BRANCHES] as const;
const COVERAGE_DAYS = 14;
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
      <p className="dawaa-caption text-xs font-bold">التعديل بيتحفظ هنا بس، والتقفيلة في تطبيق المشتريات زي ما هي.</p>
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

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    const since = new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10);
    // The on-duty range is capped at 45 days; tomorrow covers the Cairo day after UTC midnight.
    const dutyFrom = new Date(Date.now() - 44 * 864e5).toISOString().slice(0, 10);
    const dutyTo = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
    const [{ data, error }, fixes, duty] = await Promise.all([
      supabase
        .from('shift_handovers')
        .select('*')
        .gte('shift_date', since)
        .order('shift_date', { ascending: false })
        .order('recorded_at', { ascending: false })
        .limit(1000),
      supabase.from('shift_handover_corrections_v1').select('*').gte('created_at', since).order('created_at').limit(1000),
      // Top management only; everyone else sees the page without the names.
      supabase.rpc('shift_handover_on_duty_v1', { p_from: dutyFrom, p_to: dutyTo }),
    ]);
    setCorrections(fixes.error ? [] : ((fixes.data || []) as ShiftHandoverCorrection[]));
    setOnDuty(duty.error ? null : ((duty.data || []) as OnDutySlot[]));
    if (error) {
      setLoadError(true);
      setLoading(false);
      return;
    }
    setRows((data || []) as ShiftRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const live = useMemo(
    () => rows.filter((r) => !r.is_archived).map((r) => applyCorrections(r, corrections)),
    [rows, corrections]
  );
  const fixesOf = (id: string) => corrections.filter((c) => c.handover_id === id);
  const doctorsAt = (branch: string, day: string, shift: string) =>
    onDuty?.find((d) => d.branch === branch && d.shift_date === day && d.shift_type === shift)?.doctors;
  const filtered = useMemo(
    () => (branchFilter === 'الكل' ? live : live.filter((r) => r.branch === branchFilter)),
    [live, branchFilter]
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

  const days = useMemo(() => [...new Set(coverage.map((slot) => slot.day))], [coverage]);
  const slotOf = (day: string, branch: string, shift: string) =>
    coverage.find((slot) => slot.day === day && slot.branch === branch && slot.shift === shift) as ShiftSlot<ShiftRow>;
  const visibleBranches = branchFilter === 'الكل' ? SHIFT_HANDOVER_BRANCHES : [branchFilter];

  return (
    <div className="space-y-5" dir="rtl">
      <section className="dawaa-card dawaa-card--raised">
        <h1 className="dawaa-title text-2xl">تسليم الشيفتات</h1>
        <p className="dawaa-caption mt-1 font-bold">
          بتتزامن كل 15 دقيقة من تسليمات الشيفت في تطبيق المشتريات · آخر مزامنة {timeLabel(lastSync)}
        </p>
      </section>

      <div className="flex flex-wrap gap-2">
        {BRANCHES.map((b) => (
          <button key={b} type="button" onClick={() => setBranchFilter(b)} className={`dawaa-tab ${branchFilter === b ? 'is-active' : ''}`}>
            {b}
          </button>
        ))}
      </div>

      <Panel className="p-4">
        <SectionTitle title={`الشيفتات في آخر ${COVERAGE_DAYS} يوم`} icon={<CalendarCheck size={18} />} />
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
      </Panel>

      <div className="grid gap-3 md:grid-cols-4">
        <MiniBox label="عدد التسليمات (45 يوم)" value={totals.count.toLocaleString('ar-EG')} />
        <MiniBox label="إجمالي المبيعات" value={formatCurrency(totals.totalSales)} />
        <MiniBox label="إجمالي المصروفات" value={formatCurrency(totals.totalExpenses)} tone="amber" />
        <MiniBox label="صافي التسليم" value={formatCurrency(totals.totalNet)} tone="green" />
      </div>

      <Panel className="p-4">
        <SectionTitle title="تفاصيل التقفيلات" icon={<Clock size={18} />} />
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="animate-spin" style={{ color: 'var(--dawaa-theme-muted)' }} /></div>
        ) : loadError ? (
          <EmptyState label="تعذّر التحميل" error onRetry={() => void load()} />
        ) : filtered.length === 0 ? (
          <EmptyState label="لا توجد تسليمات مسجلة" />
        ) : (
          <div className="space-y-2">
            {filtered.map((row) => (
              <div key={row.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
                      {row.branch} — شيفت {row.shift_type} · {dayLabel(row.shift_date)}
                    </p>
                    <p className="dawaa-caption mt-0.5 text-xs font-bold">
                      بواسطة {row.submitted_by || '-'} · اتسجل {timeLabel(row.recorded_at)}
                      {fixesOf(row.id).length ? <span className="dawaa-badge dawaa-badge--warning mr-2">متعدّل</span> : null}
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
                <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold">
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
                </div>
                {row.notes ? <p className="mt-2 text-xs font-bold">📝 {row.notes}</p> : null}
                {fixesOf(row.id).map((c) => (
                  <p key={c.id} className="dawaa-caption mt-1 text-xs font-bold">
                    ✏️ {c.corrected_by_name || '-'} · {timeLabel(c.created_at)} · {c.reason}:{' '}
                    {Object.entries(c.changes).map(([key, value]) => `${EDIT_LABEL[key] ?? key} ${c.previous[key] ?? '-'} ← ${value ?? '-'}`).join('، ')}
                  </p>
                ))}
                {onDuty && editing !== row.id ? (
                  <button type="button" onClick={() => setEditing(row.id)} className="dawaa-caption mt-2 inline-flex items-center gap-1 text-xs font-black underline">
                    <Pencil size={12} /> تعديل
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
