import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  GitCompareArrows,
  Loader2,
  Pencil,
  PieChart,
  Printer,
  Receipt,
  RefreshCw,
  Smartphone,
  Wallet,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { formatCurrency } from '@/lib/utils';
import { cairoDayOf } from '@/lib/time/cairoDateBoundary';
import {
  Panel,
  SectionTitle,
  EmptyState,
  MiniBox,
} from '@/components/dashboard/DashboardPrimitives';
import {
  SHIFT_HANDOVER_BRANCHES,
  SHIFT_TYPES,
  onDutyLabel,
  shiftCoverage,
  shiftDeadline,
  type OnDutyDoctor,
  type ShiftHandoverCorrection,
  type ShiftSlot,
  type ShiftSlotStatus,
} from '@/lib/shiftHandoverCoverage';

// The layout follows the shift handover page of the Dawaa Bills app (handovers by day and branch,
// statistics, expenses, collections); the numbers are the DawaaWael handovers synced from Base44.

const BRANCHES = ['الكل', ...SHIFT_HANDOVER_BRANCHES] as const;
const COVERAGE_DAYS = 14;
const MIN_SOURCE_DATE = '2026-10-01';
const SHIFT_FILTERS = ['الكل', ...SHIFT_TYPES] as const;
const money = (value: number) =>
  Number(value || 0).toLocaleString('ar-EG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + ' ج';
const PAYMENTS = [
  ['cash_sales', 'كاش'],
  ['visa_sales', 'فيزا'],
  ['insta_sales', 'إنستا'],
  ['vodafone_sales', 'فودافون'],
  ['other_sales', 'أخرى'],
] as const;
// Money that reaches the accountant by transfer, not in the drawer.
const COLLECTIONS = [
  ['vodafone_sales', 'فودافون كاش'],
  ['insta_sales', 'إنستا باي'],
  ['visa_sales', 'فيزا'],
] as const;
// The fields top management can correct here (correct_shift_handover_v1); Base44 keeps its own copy.
const EDIT_FIELDS = [
  ['submitted_by', 'اللي قفل', 'text'],
  ['total_sales', 'إجمالي المبيعات', 'number'],
  ['cash_sales', 'كاش', 'number'],
  ['visa_sales', 'فيزا', 'number'],
  ['insta_sales', 'إنستا', 'number'],
  ['vodafone_sales', 'فودافون', 'number'],
  ['other_sales', 'أخرى', 'number'],
  ['total_expenses', 'المصروفات', 'number'],
  ['net_amount', 'صافي التسليم', 'number'],
  ['cash_handover', 'الكاش المسلّم', 'number'],
  ['cash_variance', 'فرق الكاش', 'number'],
  ['notes', 'ملاحظات', 'text'],
] as const;
type EditKey = (typeof EDIT_FIELDS)[number][0];
const EDIT_LABEL = Object.fromEntries(EDIT_FIELDS.map(([key, label]) => [key, label])) as Record<
  string,
  string
>;
const CORRECT_ERRORS: Record<string, string> = {
  not_authorized: 'التعديل للمدير العام والتنفيذي بس',
  reason_required: 'اكتب سبب التعديل',
  no_changes: 'مفيش حاجة اتغيرت',
  invalid_amount: 'المبالغ لازم تبقى أرقام',
};
const SHIFT_TONE: Record<string, string> = {
  ليلي: 'dawaa-badge--info',
  صباحي: 'dawaa-badge--warning',
  مسائي: 'dawaa-badge--success',
};

const TABS = [
  ['handovers', 'التسليمات', Receipt],
  ['stats', 'الإحصائيات والفروع', BarChart3],
  ['expenses', 'تحليل المصروفات', PieChart],
  ['collections', 'التحصيلات الإلكترونية', Smartphone],
  ['coverage', 'اكتمال الشيفتات', CalendarCheck],
] as const;
type TabId = (typeof TABS)[number][0];

const PERIODS = [
  ['today', 'اليوم'],
  ['yesterday', 'أمس'],
  ['before', 'أول أمس'],
  ['month', 'الشهر الحالي'],
  ['prev', 'الشهر السابق'],
  ['picked', 'الشهر المختار'],
] as const;
type PeriodId = (typeof PERIODS)[number][0];

type OnDutySlot = {
  branch: string;
  shift_date: string;
  shift_type: string;
  doctors: OnDutyDoctor[];
};

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

const addDays = (day: string, delta: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};
const shiftMonth = (month: string, delta: number) => {
  const d = new Date(`${month}-15T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + delta);
  return d.toISOString().slice(0, 7);
};
const monthEnd = (month: string) => addDays(`${shiftMonth(month, 1)}-01`, -1);
const shortBranch = (branch: string) => branch.replace('فرع ', '');
const collectedOf = (r: ShiftRow) => n(r.vodafone_sales) + n(r.insta_sales) + n(r.visa_sales);
// As DawaaWael shows a handover: the cash the accountant receives, and everything that came by transfer.
const accountantCashOf = (r: Pick<ShiftRow, 'cash_handover' | 'cash_sales'>) =>
  n(r.cash_handover ?? r.cash_sales);
const transfersOf = (
  r: Pick<ShiftRow, 'vodafone_sales' | 'insta_sales' | 'visa_sales' | 'other_sales'>
) => n(r.vodafone_sales) + n(r.insta_sales) + n(r.visa_sales) + n(r.other_sales);

const dayLabel = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString('ar-EG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
const shortDay = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString('ar-EG', {
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
  });
const monthLabel = (month: string) =>
  new Date(`${month}-15T12:00:00`).toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' });
const timeLabel = (value: string | null) =>
  value
    ? new Date(value).toLocaleString('ar-EG', {
        day: 'numeric',
        month: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '-';
const clockLabel = (value: string | null) =>
  value ? new Date(value).toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit' }) : '-';

function sumUp(rows: ShiftRow[]) {
  return {
    count: rows.length,
    sales: rows.reduce((a, r) => a + n(r.total_sales), 0),
    expenses: rows.reduce((a, r) => a + n(r.total_expenses), 0),
    net: rows.reduce((a, r) => a + n(r.net_amount), 0),
    cash: rows.reduce((a, r) => a + n(r.cash_sales), 0),
    collected: rows.reduce((a, r) => a + collectedOf(r), 0),
    toAccountant: rows.reduce((a, r) => a + accountantCashOf(r), 0),
    transfers: rows.reduce((a, r) => a + transfersOf(r), 0),
  };
}

/** Segmented control (Dawaa Bills style): one tap instead of opening a dropdown. */
function Pills<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: NoInfer<T>) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1">
      <span className="dawaa-caption ml-1 text-xs font-bold">{label}</span>
      <div
        className="flex gap-1 rounded-xl p-1"
        style={{ background: 'var(--dawaa-theme-surface-raised)' }}
      >
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            className={`dawaa-tab px-3 py-1 text-xs ${value === option ? 'is-active' : ''}`}
            onClick={() => onChange(option)}
          >
            {option.replace('فرع ', '')}
          </button>
        ))}
      </div>
    </div>
  );
}

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

function EditHandover({
  row,
  onDone,
  onCancel,
}: {
  row: ShiftRow;
  onDone: () => void;
  onCancel: () => void;
}) {
  const initial = Object.fromEntries(
    EDIT_FIELDS.map(([key]) => [key, row[key] == null ? '' : String(row[key])])
  ) as Record<EditKey, string>;
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
        if (value !== null && !Number.isFinite(value))
          return setError(`${EDIT_LABEL[key]}: لازم رقم`);
        changes[key] = value;
      } else {
        changes[key] = raw || null;
      }
    }
    setBusy(true);
    setError('');
    const { error: rpcError } = await supabase.rpc('correct_shift_handover_v1', {
      p_handover_id: row.id,
      p_changes: changes,
      p_reason: reason,
    });
    setBusy(false);
    if (rpcError) {
      const code = Object.keys(CORRECT_ERRORS).find((k) => rpcError.message?.includes(k));
      return setError(code ? CORRECT_ERRORS[code] : 'تعذّر الحفظ');
    }
    onDone();
  };

  return (
    <div
      className="mt-3 space-y-2 rounded-xl border p-3"
      style={{ borderColor: 'var(--dawaa-theme-border)' }}
    >
      <p className="dawaa-caption text-xs font-bold">
        المراجعة تُسجل داخل الإدارة فقط؛ بيانات دواء وائل الأصلية لا تتغير، ولا تتأثر بها إجماليات
        التقرير.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
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
      <input
        className="dawaa-input w-full"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="سبب التعديل (لازم)"
      />
      {error ? (
        <p className="text-xs font-bold" style={{ color: 'var(--dawaa-status-danger-text)' }}>
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || !reason.trim()}
          onClick={() => void save()}
          className="dawaa-badge dawaa-badge--success rounded-xl px-3 py-1 text-xs font-black disabled:opacity-50"
        >
          حفظ التعديل
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="dawaa-caption text-xs font-black underline"
        >
          إلغاء
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl p-2" style={{ background: 'var(--dawaa-theme-surface-raised)' }}>
      <p className="dawaa-caption text-[11px] font-bold">{label}</p>
      <p className="text-sm font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
        {value}
      </p>
      {sub ? <p className="dawaa-caption text-[11px] font-bold">{sub}</p> : null}
    </div>
  );
}

// The same roles as «التقارير المجمعة» in the sidebar.
const TREASURY_ROLES = ['general_manager', 'admin', 'executive_manager'];

export default function ShiftHandovers() {
  const { user } = useAuth();
  const today = cairoDayOf(new Date().toISOString()) as string;
  const thisMonth = today.slice(0, 7);
  const [rows, setRows] = useState<ShiftRow[]>([]);
  const [corrections, setCorrections] = useState<ShiftHandoverCorrection[]>([]);
  const [onDuty, setOnDuty] = useState<OnDutySlot[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState<TabId>('handovers');
  const [view, setView] = useState<'detail' | 'table'>('detail');
  const [period, setPeriod] = useState<PeriodId>('month');
  const [month, setMonth] = useState(thisMonth);
  const [branchFilter, setBranchFilter] = useState<(typeof BRANCHES)[number]>('الكل');
  const [shiftFilter, setShiftFilter] = useState<(typeof SHIFT_FILTERS)[number]>('الكل');
  const [person, setPerson] = useState('الكل');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    // The on-duty range is capped at 45 days; tomorrow covers the Cairo day after UTC midnight.
    const dutyFrom = new Date(Date.now() - 44 * 864e5).toISOString().slice(0, 10);
    const dutyTo = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
    const [source, fixes, duty] = await Promise.all([
      fetchAllShiftRows(),
      supabase
        .from('shift_handover_corrections_v1')
        .select('*')
        .gte('created_at', MIN_SOURCE_DATE)
        .order('created_at')
        .limit(1000),
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
  const live = useMemo(() => rows.filter((r) => !r.is_archived), [rows]);
  const fixesOf = (id: string) => corrections.filter((c) => c.handover_id === id);
  const doctorsAt = (branch: string, day: string, shift: string) =>
    onDuty?.find((d) => d.branch === branch && d.shift_date === day && d.shift_type === shift)
      ?.doctors;
  const people = useMemo(
    () =>
      [...new Set(live.map((r) => r.submitted_by?.trim()).filter(Boolean) as string[])].sort(
        (a, b) => a.localeCompare(b, 'ar')
      ),
    [live]
  );
  // Branch, shift and the doctor who closed: every tab but the coverage one.
  const scoped = useMemo(
    () =>
      live.filter(
        (r) =>
          (branchFilter === 'الكل' || r.branch === branchFilter) &&
          (shiftFilter === 'الكل' || r.shift_type === shiftFilter) &&
          (person === 'الكل' || r.submitted_by?.trim() === person)
      ),
    [live, branchFilter, shiftFilter, person]
  );
  const monthFrom = month < MIN_SOURCE_DATE.slice(0, 7) ? MIN_SOURCE_DATE : `${month}-01`;
  const monthTo = monthEnd(month);
  const monthRows = useMemo(
    () => scoped.filter((r) => r.shift_date >= monthFrom && r.shift_date <= monthTo),
    [scoped, monthFrom, monthTo]
  );
  const visibleBranches = useMemo(
    () => (branchFilter === 'الكل' ? [...SHIFT_HANDOVER_BRANCHES] : [branchFilter]),
    [branchFilter]
  );
  const visibleShifts = shiftFilter === 'الكل' ? [...SHIFT_TYPES] : [shiftFilter];
  const coverage = useMemo(() => shiftCoverage(live, COVERAGE_DAYS), [live]);
  const late = useMemo(
    () =>
      coverage.filter(
        (slot) =>
          slot.status === 'late' && (branchFilter === 'الكل' || slot.branch === branchFilter)
      ),
    [coverage, branchFilter]
  );
  const lastSync = useMemo(
    () =>
      rows.reduce<string | null>(
        (max, r) => (r.synced_at && (!max || r.synced_at > max) ? r.synced_at : max),
        null
      ),
    [rows]
  );

  // Every day of the month up to today, newest first: a day nobody closed still shows its missing shifts.
  const monthDays = useMemo(() => {
    const last = monthTo < today ? monthTo : today;
    const days: string[] = [];
    for (let day = last; day >= monthFrom; day = addDays(day, -1)) days.push(day);
    return days;
  }, [monthFrom, monthTo, today]);
  const monthTotals = useMemo(() => sumUp(monthRows), [monthRows]);
  const rowsOf = (day: string, branch: string) =>
    monthRows.filter((r) => r.shift_date === day && r.branch === branch);

  // «الإحصائيات»: the period buttons of the Bills app.
  const range = useMemo((): { from: string; to: string; month?: string } => {
    if (period === 'today') return { from: today, to: today };
    if (period === 'yesterday') return { from: addDays(today, -1), to: addDays(today, -1) };
    if (period === 'before') return { from: addDays(today, -2), to: addDays(today, -2) };
    const m =
      period === 'month' ? thisMonth : period === 'prev' ? shiftMonth(thisMonth, -1) : month;
    return { from: `${m}-01`, to: monthEnd(m), month: m };
  }, [period, today, thisMonth, month]);
  const periodRows = useMemo(
    () => scoped.filter((r) => r.shift_date >= range.from && r.shift_date <= range.to),
    [scoped, range]
  );
  const periodTotals = useMemo(() => sumUp(periodRows), [periodRows]);
  const branchStats = useMemo(
    () =>
      visibleBranches.map((branch) => {
        const own = periodRows.filter((r) => r.branch === branch);
        const t = sumUp(own);
        const days = new Set(own.map((r) => r.shift_date)).size;
        const avg = days ? t.sales / days : 0;
        return {
          branch,
          ...t,
          days,
          avg,
          projection: range.month ? avg * 30 : null,
          expenseAvg: days ? t.expenses / days : 0,
          payments: PAYMENTS.map(([key, label]) => ({
            label,
            amount: own.reduce((a, r) => a + n(r[key]), 0),
          })),
          byShift: SHIFT_TYPES.map((shift) => {
            const s = own.filter((r) => r.shift_type === shift);
            const sales = s.reduce((a, r) => a + n(r.total_sales), 0);
            return { shift, count: s.length, avg: s.length ? sales / s.length : 0 };
          }),
        };
      }),
    [periodRows, visibleBranches, range.month]
  );

  // «تحليل المصروفات»: the itemised expenses of the month; the rest of total_expenses had no detail.
  const expenseAnalysis = useMemo(() => {
    const items = monthRows.flatMap((r) =>
      (r.expenses || []).map((e) => ({
        description: e.description,
        amount: n(e.amount),
        category: e.category?.trim() || 'غير مصنف',
        branch: r.branch,
        day: r.shift_date,
        shift: r.shift_type,
        by: r.submitted_by,
      }))
    );
    const byCategory = new Map<string, { amount: number; count: number }>();
    for (const item of items) {
      const c = byCategory.get(item.category) || { amount: 0, count: 0 };
      c.amount += item.amount;
      c.count += 1;
      byCategory.set(item.category, c);
    }
    const itemised = items.reduce((a, i) => a + i.amount, 0);
    return {
      items: items.sort((a, b) => b.day.localeCompare(a.day) || b.amount - a.amount),
      categories: [...byCategory.entries()]
        .map(([name, c]) => ({ name, ...c }))
        .sort((a, b) => b.amount - a.amount),
      itemised,
      unitemised: Math.max(0, monthTotals.expenses - itemised),
      byBranch: visibleBranches.map((branch) => {
        const own = monthRows.filter((r) => r.branch === branch);
        const days = new Set(own.map((r) => r.shift_date)).size;
        const amount = own.reduce((a, r) => a + n(r.total_expenses), 0);
        return { branch, amount, days, avg: days ? amount / days : 0 };
      }),
    };
  }, [monthRows, monthTotals.expenses, visibleBranches]);

  const days = useMemo(() => [...new Set(coverage.map((slot) => slot.day))], [coverage]);
  const slotOf = (day: string, branch: string, shift: string) =>
    coverage.find(
      (slot) => slot.day === day && slot.branch === branch && slot.shift === shift
    ) as ShiftSlot<ShiftRow>;

  const exportCsv = () => {
    const header = [
      'التاريخ',
      'الفرع',
      'الشيفت',
      'المسؤول',
      'المبيعات',
      'كاش',
      'فيزا',
      'إنستا',
      'فودافون',
      'أخرى',
      'المصروفات',
      'الصافي',
      'الكاش المسلم',
      'فرق الكاش',
      'ملاحظات',
    ];
    const values = monthRows.map((r) => [
      r.shift_date,
      r.branch,
      r.shift_type,
      r.submitted_by,
      r.total_sales,
      r.cash_sales,
      r.visa_sales,
      r.insta_sales,
      r.vodafone_sales,
      r.other_sales,
      r.total_expenses,
      r.net_amount,
      r.cash_handover,
      r.cash_variance,
      r.notes,
    ]);
    const esc = (value: unknown) => '"' + String(value ?? '').replace(/"/g, '""') + '"';
    const csv = '﻿' + [header, ...values].map((line) => line.map(esc).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dawaa-wael-shift-handovers-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const shiftCard = (row: ShiftRow) => {
    const fixes = fixesOf(row.id);
    const open = expanded === row.id;
    return (
      <div
        key={row.id}
        className="rounded-xl border p-3"
        style={{
          borderColor: 'var(--dawaa-theme-border)',
          background: 'var(--dawaa-theme-surface)',
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className={`dawaa-badge ${SHIFT_TONE[row.shift_type] || 'dawaa-badge--neutral'}`}>
            {row.shift_type}
          </span>
          <span className="dawaa-caption text-[11px] font-bold">{clockLabel(row.recorded_at)}</span>
        </div>
        <p className="mt-2 text-sm font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
          {row.submitted_by || '-'}
          {fixes.length ? (
            <span className="dawaa-badge dawaa-badge--warning mr-2">ملاحظة مراجعة</span>
          ) : null}
        </p>
        <div className="mt-2 grid grid-cols-2 gap-1 text-xs font-bold">
          <span className="dawaa-caption">مبيعات</span>
          <span>{formatCurrency(n(row.total_sales))}</span>
          {n(row.total_expenses) ? (
            <>
              <span className="dawaa-caption">مصروفات</span>
              <span>{formatCurrency(n(row.total_expenses))}</span>
            </>
          ) : null}
          <span className="dawaa-caption">نقدي للمحاسب</span>
          <span style={{ color: 'var(--dawaa-status-success-text)' }}>
            {formatCurrency(accountantCashOf(row))}
          </span>
          <span className="dawaa-caption">التحويلات</span>
          <span style={{ color: 'var(--dawaa-status-info-text)' }}>
            {formatCurrency(transfersOf(row))}
          </span>
        </div>
        {Math.abs(n(row.cash_variance)) > 1 ? (
          <p
            className="mt-1 inline-flex items-center gap-1 text-xs font-black"
            style={{ color: 'var(--dawaa-status-danger-text)' }}
          >
            <AlertTriangle size={12} /> فرق كاش {formatCurrency(n(row.cash_variance))}
          </p>
        ) : null}
        <div className="mt-2 flex gap-3 print:hidden">
          <button
            type="button"
            className="dawaa-caption inline-flex items-center gap-1 text-xs font-black underline"
            onClick={() => setExpanded((v) => (v === row.id ? null : row.id))}
          >
            <Eye size={12} /> {open ? 'إخفاء' : 'عرض'}
          </button>
          {onDuty && editing !== row.id ? (
            <button
              type="button"
              onClick={() => {
                setExpanded(row.id);
                setEditing(row.id);
              }}
              className="dawaa-caption inline-flex items-center gap-1 text-xs font-black underline"
            >
              <Pencil size={12} /> مراجعة
            </button>
          ) : null}
        </div>
        {open ? (
          <div
            className="mt-2 space-y-1 border-t pt-2 text-xs font-bold"
            style={{ borderColor: 'var(--dawaa-theme-border)' }}
          >
            <div className="flex flex-wrap gap-1">
              {PAYMENTS.filter(([key]) => n(row[key])).map(([key, label]) => (
                <span key={key} className="dawaa-badge dawaa-badge--neutral">
                  {label}: {formatCurrency(n(row[key]))}
                </span>
              ))}
            </div>
            <p>الكاش المسلّم: {formatCurrency(n(row.cash_handover))}</p>
            {row.expenses?.map((e, idx) => (
              <p key={idx}>
                • {e.category || 'مصروف'}
                {e.description ? ` — ${e.description}` : ''}: {formatCurrency(n(e.amount))}
              </p>
            ))}
            {onDuty ? (
              <p className="dawaa-caption">
                الموجود وقت التقفيل:{' '}
                {onDutyLabel(doctorsAt(row.branch, row.shift_date, row.shift_type)) || '-'}
              </p>
            ) : null}
            <p className="dawaa-caption">اتسجل {timeLabel(row.recorded_at)}</p>
            {row.notes ? <p>📝 {row.notes}</p> : null}
            {fixes.map((c) => (
              <p key={c.id} className="dawaa-caption">
                ✏️ {c.corrected_by_name || '-'} · {timeLabel(c.created_at)} · {c.reason}:{' '}
                {Object.entries(c.changes)
                  .map(
                    ([key, value]) =>
                      `${EDIT_LABEL[key] ?? key} ${c.previous[key] ?? '-'} ← ${value ?? '-'}`
                  )
                  .join('، ')}
              </p>
            ))}
          </div>
        ) : null}
        {editing === row.id ? (
          <EditHandover
            row={row}
            onCancel={() => setEditing(null)}
            onDone={() => {
              setEditing(null);
              void load();
            }}
          />
        ) : null}
      </div>
    );
  };

  // A shift past its deadline with no handover, and who was on duty when it should have closed.
  const missingCard = (day: string, branch: string, shift: (typeof SHIFT_TYPES)[number]) => {
    if (person !== 'الكل' || new Date() < shiftDeadline(day, shift)) return null;
    const who = onDutyLabel(doctorsAt(branch, day, shift));
    return (
      <div
        key={`missing-${shift}`}
        className="rounded-xl border border-dashed p-3 text-xs font-bold"
        style={{
          borderColor: 'var(--dawaa-status-danger-border)',
          color: 'var(--dawaa-status-danger-text)',
        }}
      >
        <span className="dawaa-badge dawaa-badge--danger">{shift} · ناقص</span>
        <p className="mt-1">ما اتقفلش{who ? ` — الموجود وقت التقفيل: ${who}` : ''}</p>
      </div>
    );
  };

  const filtersBar = (
    <section
      className="rounded-2xl border p-4 print:hidden"
      style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)' }}
      aria-label="فلاتر التسليمات"
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="dawaa-tab"
            aria-label="الشهر اللي بعده"
            disabled={month >= thisMonth}
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
          >
            <ChevronRight size={16} />
          </button>
          <span
            className="min-w-32 text-center font-black"
            style={{ color: 'var(--dawaa-theme-heading)' }}
          >
            {monthLabel(month)}
          </span>
          <button
            type="button"
            className="dawaa-tab"
            aria-label="الشهر اللي قبله"
            disabled={month <= MIN_SOURCE_DATE.slice(0, 7)}
            onClick={() => setMonth((m) => shiftMonth(m, -1))}
          >
            <ChevronLeft size={16} />
          </button>
        </div>
        <Pills label="الفرع" options={BRANCHES} value={branchFilter} onChange={setBranchFilter} />
        <Pills
          label="الشيفت"
          options={SHIFT_FILTERS}
          value={shiftFilter}
          onChange={setShiftFilter}
        />
        <label className="text-xs font-bold">
          الدكتور اللي قفل
          <select
            className="dawaa-input mt-1 block"
            value={person}
            onChange={(e) => setPerson(e.target.value)}
          >
            <option>الكل</option>
            {people.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );

  const handoversTab = (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MiniBox
          label={`المبيعات · ${monthTotals.count.toLocaleString('ar-EG')} تسليم`}
          value={formatCurrency(monthTotals.sales)}
        />
        <MiniBox
          label="النقدي المطلوب للمحاسب"
          value={formatCurrency(monthTotals.toAccountant)}
          tone="green"
        />
        <MiniBox label="التحويلات" value={formatCurrency(monthTotals.transfers)} tone="blue" />
        <MiniBox label="المصروفات" value={formatCurrency(monthTotals.expenses)} tone="amber" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div
          className="flex gap-1 rounded-xl p-1"
          style={{ background: 'var(--dawaa-theme-surface)' }}
        >
          <button
            type="button"
            className={`dawaa-tab ${view === 'detail' ? 'is-active' : ''}`}
            onClick={() => setView('detail')}
          >
            تفصيلي
          </button>
          <button
            type="button"
            className={`dawaa-tab ${view === 'table' ? 'is-active' : ''}`}
            onClick={() => setView('table')}
          >
            جدول يومي
          </button>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="dawaa-tab inline-flex items-center gap-2"
            onClick={exportCsv}
            disabled={!monthRows.length}
          >
            <Download size={16} /> Excel
          </button>
          <button
            type="button"
            className="dawaa-tab inline-flex items-center gap-2"
            onClick={() => window.print()}
          >
            <Printer size={16} /> طباعة
          </button>
        </div>
      </div>
      {view === 'detail' ? (
        monthDays.map((day) => {
          const t = sumUp(monthRows.filter((r) => r.shift_date === day));
          return (
            <Panel key={day} className="p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
                  {dayLabel(day)}
                </p>
                <div className="flex flex-wrap gap-2 text-xs font-bold">
                  <span className="dawaa-badge dawaa-badge--neutral">
                    مبيعات {formatCurrency(t.sales)}
                  </span>
                  <span className="dawaa-badge dawaa-badge--success">
                    للمحاسب {formatCurrency(t.toAccountant)}
                  </span>
                  <span className="dawaa-badge dawaa-badge--info">
                    تحويلات {formatCurrency(t.transfers)}
                  </span>
                  {t.expenses ? (
                    <span className="dawaa-badge dawaa-badge--warning">
                      مصروفات {formatCurrency(t.expenses)}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className={`grid gap-3 ${visibleBranches.length > 1 ? 'md:grid-cols-2' : ''}`}>
                {visibleBranches.map((branch) => {
                  const own = rowsOf(day, branch);
                  return (
                    <div
                      key={branch}
                      className="rounded-2xl p-3"
                      style={{ background: 'var(--dawaa-theme-surface-raised)' }}
                    >
                      <p
                        className="mb-2 font-black"
                        style={{ color: 'var(--dawaa-theme-heading)' }}
                      >
                        {branch}
                      </p>
                      <div className="space-y-2">
                        {visibleShifts.map((shift) => {
                          const slotRows = own.filter((r) => r.shift_type === shift);
                          return slotRows.length ? (
                            <Fragment key={shift}>{slotRows.map(shiftCard)}</Fragment>
                          ) : (
                            missingCard(day, branch, shift)
                          );
                        })}
                      </div>
                      <p className="mt-2 flex flex-wrap justify-between gap-2 text-xs font-black">
                        <span style={{ color: 'var(--dawaa-status-success-text)' }}>
                          نقدي للمحاسب: {formatCurrency(sumUp(own).toAccountant)}
                        </span>
                        <span style={{ color: 'var(--dawaa-status-info-text)' }}>
                          تحويلات: {formatCurrency(sumUp(own).transfers)}
                        </span>
                      </p>
                    </div>
                  );
                })}
              </div>
            </Panel>
          );
        })
      ) : (
        <Panel className="p-4">
          <div className="overflow-x-auto">
            <table className="dawaa-table w-full min-w-[650px] text-right text-sm">
              <thead>
                <tr>
                  <th>اليوم</th>
                  {visibleBranches.map((b) => (
                    <th key={b} colSpan={3}>
                      {b}
                    </th>
                  ))}
                  <th>صافي اليوم</th>
                </tr>
                <tr>
                  <th />
                  {visibleBranches.map((b) => (
                    <Fragment key={b}>
                      <th>شيفتات</th>
                      <th>مبيعات</th>
                      <th>صافي</th>
                    </Fragment>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {monthDays.map((day) => (
                  <tr key={day}>
                    <td className="font-bold">{shortDay(day)}</td>
                    {visibleBranches.map((b) => {
                      const t = sumUp(rowsOf(day, b));
                      return (
                        <Fragment key={b}>
                          <td>
                            {t.count}/{visibleShifts.length}
                          </td>
                          <td>{money(t.sales)}</td>
                          <td>{money(t.net)}</td>
                        </Fragment>
                      );
                    })}
                    <td className="font-black">
                      {money(sumUp(monthRows.filter((r) => r.shift_date === day)).net)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );

  const statsTab = (
    <div className="space-y-4">
      <div
        className="flex flex-wrap gap-1 rounded-xl p-1 print:hidden"
        style={{ background: 'var(--dawaa-theme-surface)' }}
      >
        {PERIODS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`dawaa-tab ${period === id ? 'is-active' : ''}`}
            onClick={() => setPeriod(id)}
          >
            {id === 'picked' ? monthLabel(month) : label}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <MiniBox label="المبيعات" value={formatCurrency(periodTotals.sales)} />
        <MiniBox label="المصروفات" value={formatCurrency(periodTotals.expenses)} tone="amber" />
        <MiniBox
          label="التحصيلات الإلكترونية"
          value={formatCurrency(periodTotals.collected)}
          tone="blue"
        />
        <MiniBox label="الكاش" value={formatCurrency(periodTotals.cash)} />
        <MiniBox label="صافي التسليم" value={formatCurrency(periodTotals.net)} tone="green" />
        <MiniBox label="عدد الشيفتات" value={periodTotals.count.toLocaleString('ar-EG')} />
      </div>
      <div className={`grid gap-3 ${branchStats.length > 1 ? 'lg:grid-cols-2' : ''}`}>
        {branchStats.map((b) => (
          <Panel key={b.branch} className="p-4">
            <SectionTitle title={b.branch} icon={<Wallet size={18} />} />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Stat
                label="المبيعات"
                value={formatCurrency(b.sales)}
                sub={`${b.count} شيفت في ${b.days} يوم`}
              />
              <Stat label="متوسط المبيعات اليومي" value={formatCurrency(b.avg)} />
              {b.projection !== null ? (
                <Stat label="توقع الشهر (المتوسط × 30)" value={formatCurrency(b.projection)} />
              ) : null}
              <Stat
                label="المصروفات"
                value={formatCurrency(b.expenses)}
                sub={`متوسط يومي ${formatCurrency(b.expenseAvg)}`}
              />
              <Stat
                label="التحصيلات الإلكترونية"
                value={formatCurrency(b.collected)}
                sub={
                  b.sales ? `${Math.round((b.collected / b.sales) * 100)}% من المبيعات` : undefined
                }
              />
              <Stat label="صافي التسليم" value={formatCurrency(b.net)} />
            </div>
            <p className="mt-3 mb-1 text-xs font-black">طرق الدفع</p>
            <div className="space-y-1">
              {b.payments.map((p) => {
                const pct = b.sales ? (p.amount / b.sales) * 100 : 0;
                return (
                  <div key={p.label} className="flex items-center gap-2 text-xs font-bold">
                    <span className="w-16">{p.label}</span>
                    <div
                      className="h-2 flex-1 rounded-full"
                      style={{ background: 'var(--dawaa-theme-surface-raised)' }}
                    >
                      <div
                        className="h-2 rounded-full"
                        style={{
                          width: `${Math.min(100, pct)}%`,
                          background: 'var(--dawaa-status-success-text)',
                        }}
                      />
                    </div>
                    <span className="w-36 text-left">
                      {formatCurrency(p.amount)} · {Math.round(pct)}%
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 mb-1 text-xs font-black">متوسط المبيعات لكل شيفت</p>
            <div className="grid grid-cols-3 gap-2">
              {b.byShift.map((s) => (
                <Stat
                  key={s.shift}
                  label={s.shift}
                  value={formatCurrency(s.avg)}
                  sub={`${s.count} شيفت`}
                />
              ))}
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );

  const expensesTab = (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <MiniBox
          label={`مصروفات ${monthLabel(month)}`}
          value={formatCurrency(monthTotals.expenses)}
          tone="amber"
        />
        <MiniBox label="مصروفات مفصّلة بالبند" value={formatCurrency(expenseAnalysis.itemised)} />
        <MiniBox
          label="مصروفات من غير تفاصيل"
          value={formatCurrency(expenseAnalysis.unitemised)}
          tone="blue"
        />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel className="p-4">
          <SectionTitle title="حسب البند" icon={<PieChart size={18} />} />
          {expenseAnalysis.categories.length ? (
            <div className="space-y-2">
              {expenseAnalysis.categories.map((c) => {
                const pct = expenseAnalysis.itemised
                  ? (c.amount / expenseAnalysis.itemised) * 100
                  : 0;
                return (
                  <div key={c.name} className="text-xs font-bold">
                    <div className="flex justify-between">
                      <span>
                        {c.name} · {c.count} مرة
                      </span>
                      <span>
                        {formatCurrency(c.amount)} · {Math.round(pct)}%
                      </span>
                    </div>
                    <div
                      className="mt-1 h-2 rounded-full"
                      style={{ background: 'var(--dawaa-theme-surface-raised)' }}
                    >
                      <div
                        className="h-2 rounded-full"
                        style={{ width: `${pct}%`, background: 'var(--dawaa-status-warning-text)' }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState label="مفيش مصروفات مفصّلة في الشهر ده" />
          )}
        </Panel>
        <Panel className="p-4">
          <SectionTitle title="حسب الفرع" icon={<Wallet size={18} />} />
          <div className="grid gap-2 sm:grid-cols-2">
            {expenseAnalysis.byBranch.map((b) => (
              <Stat
                key={b.branch}
                label={b.branch}
                value={formatCurrency(b.amount)}
                sub={`متوسط يومي ${formatCurrency(b.avg)} · ${b.days} يوم`}
              />
            ))}
          </div>
        </Panel>
      </div>
      <Panel className="p-4">
        <SectionTitle title="كل بنود المصروفات" icon={<Receipt size={18} />} />
        {expenseAnalysis.items.length ? (
          <div className="overflow-x-auto">
            <table className="dawaa-table w-full min-w-[600px] text-right text-sm">
              <thead>
                <tr>
                  <th>اليوم</th>
                  <th>الفرع</th>
                  <th>الشيفت</th>
                  <th>البند</th>
                  <th>البيان</th>
                  <th>المبلغ</th>
                  <th>اللي قفل</th>
                </tr>
              </thead>
              <tbody>
                {expenseAnalysis.items.map((i, idx) => (
                  <tr key={idx}>
                    <td>{shortDay(i.day)}</td>
                    <td>{shortBranch(i.branch)}</td>
                    <td>{i.shift}</td>
                    <td>{i.category}</td>
                    <td>{i.description || '-'}</td>
                    <td className="font-black">{formatCurrency(i.amount)}</td>
                    <td>{i.by || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState label="مفيش بنود مصروفات" />
        )}
      </Panel>
    </div>
  );

  const collectionsTab = (
    <div className="space-y-4">
      <p className="dawaa-caption text-xs font-bold">
        فودافون كاش وإنستا باي والفيزا بتدخل حسابات مش الدرج، فبتتحوّل للمحاسب. هنا المحصّل في كل
        شيفت من دواء وائل؛ متابعة التحويل للمحاسب في «التقارير المجمعة».
      </p>
      <div className="grid gap-3 md:grid-cols-4">
        {COLLECTIONS.map(([key, label]) => (
          <MiniBox
            key={key}
            label={label}
            value={formatCurrency(monthRows.reduce((a, r) => a + n(r[key]), 0))}
            tone="blue"
          />
        ))}
        <MiniBox
          label={`إجمالي ${monthLabel(month)}`}
          value={formatCurrency(monthTotals.collected)}
          tone="green"
        />
      </div>
      <Panel className="p-4">
        <SectionTitle title="التحصيلات يوم بيوم" icon={<Smartphone size={18} />} />
        <div className="overflow-x-auto">
          <table className="dawaa-table w-full min-w-[650px] text-right text-sm">
            <thead>
              <tr>
                <th>اليوم</th>
                {visibleBranches.map((b) => (
                  <th key={b} colSpan={COLLECTIONS.length}>
                    {b}
                  </th>
                ))}
                <th>إجمالي اليوم</th>
              </tr>
              <tr>
                <th />
                {visibleBranches.map((b) => (
                  <Fragment key={b}>
                    {COLLECTIONS.map(([key, label]) => (
                      <th key={key}>{label}</th>
                    ))}
                  </Fragment>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {monthDays.map((day) => (
                <tr key={day}>
                  <td className="font-bold">{shortDay(day)}</td>
                  {visibleBranches.map((b) => {
                    const own = rowsOf(day, b);
                    return (
                      <Fragment key={b}>
                        {COLLECTIONS.map(([key]) => (
                          <td key={key}>{money(own.reduce((a, r) => a + n(r[key]), 0))}</td>
                        ))}
                      </Fragment>
                    );
                  })}
                  <td className="font-black">
                    {money(
                      monthRows
                        .filter((r) => r.shift_date === day)
                        .reduce((a, r) => a + collectedOf(r), 0)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );

  const coverageTab = (
    <Panel className="p-4">
      <SectionTitle
        title={`اكتمال الشيفتات (آخر ${COVERAGE_DAYS} يوم)`}
        icon={<CalendarCheck size={18} />}
      />
      <p className="dawaa-caption mb-3 text-xs font-bold">
        كل فرع بيقفل 3 شيفتات في اليوم. الشيفت بيبقى «ناقص» بعد ميعاده بساعتين: الليلي 10 الصبح،
        الصباحي 7 بالليل، المسائي 3 الفجر.
      </p>
      {late.length ? (
        <div className="dawaa-alert dawaa-alert--danger mb-3 text-sm font-bold">
          <p>{late.length} شيفت ما اتقفلش:</p>
          <ul className="mt-1 space-y-0.5">
            {late.map((slot) => {
              const who = onDutyLabel(doctorsAt(slot.branch, slot.day, slot.shift));
              return (
                <li key={`${slot.branch}${slot.day}${slot.shift}`}>
                  {shortBranch(slot.branch)} {shortDay(slot.day)} {slot.shift}
                  {who ? ` — الموجود وقت التقفيل: ${who}` : ''}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-center text-xs font-bold">
          <thead>
            <tr>
              <th className="p-1 text-right">اليوم</th>
              {visibleBranches.map((branch) =>
                SHIFT_TYPES.map((shift) => (
                  <th key={`${branch}${shift}`} className="p-1">
                    {shortBranch(branch)} · {shift}
                  </th>
                ))
              )}
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr
                key={day}
                className="border-t"
                style={{ borderColor: 'var(--dawaa-theme-border)' }}
              >
                <td className="p-1 text-right">{shortDay(day)}</td>
                {visibleBranches.map((branch) =>
                  SHIFT_TYPES.map((shift) => {
                    const slot = slotOf(day, branch, shift);
                    const status = STATUS[slot.status];
                    const onDutyNow = onDutyLabel(doctorsAt(branch, day, shift));
                    const who = [
                      ...slot.rows.map(
                        (r) => `${r.submitted_by || '-'} · ${formatCurrency(n(r.net_amount))}`
                      ),
                      ...(onDutyNow ? [`الموجود وقت التقفيل: ${onDutyNow}`] : []),
                    ].join('\n');
                    return (
                      <td key={`${branch}${shift}`} className="p-1">
                        <span
                          className={`dawaa-badge ${status.tone} rounded-md px-2 py-0.5`}
                          title={who || undefined}
                        >
                          {status.label}
                        </span>
                      </td>
                    );
                  })
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );

  return (
    <div className="space-y-5" dir="rtl">
      <section
        className="rounded-2xl border p-5 shadow-sm"
        style={{
          borderColor: 'var(--dawaa-theme-border)',
          background: 'var(--dawaa-theme-surface)',
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="dawaa-title text-2xl">تسليم الشيفتات</h1>
            <p className="dawaa-caption mt-1 font-bold">
              البيانات من دواء وائل (Base44) · من أكتوبر 2026
            </p>
            <p className="dawaa-caption mt-1 text-xs">
              آخر مزامنة: {timeLabel(lastSync)} · مراجعات الإدارة بتظهر كملاحظات ومش بتغيّر أرقام
              دواء وائل
            </p>
          </div>
          <div className="flex flex-wrap gap-2 print:hidden">
            {TREASURY_ROLES.includes(String(user?.role ?? '')) ? (
              <Link
                to="/consolidated-reports?tab=shifts"
                className="dawaa-tab inline-flex items-center gap-2"
              >
                <GitCompareArrows size={16} /> قارن بالتقارير المجمعة
              </Link>
            ) : null}
            <button
              type="button"
              className="dawaa-tab inline-flex items-center gap-2"
              onClick={() => void load()}
            >
              <RefreshCw size={16} /> تحديث
            </button>
          </div>
        </div>
        {late.length ? (
          <button
            type="button"
            onClick={() => setTab('coverage')}
            className="dawaa-alert dawaa-alert--danger mt-3 w-full text-right text-sm font-bold print:hidden"
          >
            {late.length} شيفت ناقص في آخر {COVERAGE_DAYS} يوم — اعرض التفاصيل
          </button>
        ) : null}
      </section>

      <div
        role="tablist"
        className="flex gap-1 overflow-x-auto rounded-2xl p-1 print:hidden"
        style={{ background: 'var(--dawaa-theme-surface)' }}
      >
        {TABS.map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`dawaa-tab inline-flex items-center gap-2 whitespace-nowrap ${tab === id ? 'is-active' : ''}`}
            onClick={() => setTab(id)}
          >
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>

      {tab !== 'coverage' ? filtersBar : null}

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="animate-spin" style={{ color: 'var(--dawaa-theme-muted)' }} />
        </div>
      ) : loadError ? (
        <EmptyState label="تعذّر التحميل" error onRetry={() => void load()} />
      ) : tab === 'handovers' ? (
        handoversTab
      ) : tab === 'stats' ? (
        statsTab
      ) : tab === 'expenses' ? (
        expensesTab
      ) : tab === 'collections' ? (
        collectionsTab
      ) : (
        coverageTab
      )}
    </div>
  );
}
