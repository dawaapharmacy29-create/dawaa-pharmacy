import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  CalendarCheck,
  Download,
  GitCompareArrows,
  LayoutDashboard,
  Loader2,
  PieChart,
  Printer,
  Receipt,
  RefreshCw,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { cairoDayOf } from '@/lib/time/cairoDateBoundary';
import { EmptyState } from '@/components/dashboard/DashboardPrimitives';
import {
  SHIFT_HANDOVER_BRANCHES,
  SHIFT_TYPES,
  handoverMoment,
  readHandovers,
  shiftCoverage,
  shiftResponsible,
  type PunchInterval,
  type ShiftHandoverCorrection,
  type ShiftSlot,
} from '@/lib/shiftHandoverCoverage';
import {
  PERIOD_LABELS,
  addDays,
  closerKey,
  periodRange,
  previousRange,
  shiftMoney,
  type PeriodId,
} from '@/lib/shiftHandoverLedger';
import TodayBoard from '@/components/shift-handovers/TodayBoard';
import HandoverDays from '@/components/shift-handovers/HandoverDays';
import HandoverStats from '@/components/shift-handovers/HandoverStats';
import HandoverExpenses from '@/components/shift-handovers/HandoverExpenses';
import HandoverCoverage from '@/components/shift-handovers/HandoverCoverage';
import {
  Pills,
  shortDay,
  timeLabel,
  type LiveRow,
  type ResponsibleOf,
  type ShiftRow,
} from '@/components/shift-handovers/shared';

// «تسليم الشيفتات»: the DawaaWael handovers (Base44 ShiftDelivery), synced every 15 minutes.
// Every number on the page comes from one reading of a handover (shiftHandoverLedger):
//   المبيعات = كاش + تحويلات · للمحاسب = كاش − مصروفات الكاش · صافي التشغيل = مبيعات − مصروفات.

const BRANCHES = ['الكل', ...SHIFT_HANDOVER_BRANCHES] as const;
const SHIFT_FILTERS = ['الكل', ...SHIFT_TYPES] as const;
const COVERAGE_DAYS = 14;
// The range shift_presence_intervals_v1 takes; older shifts show no names rather than a false «مفيش بصمة».
const PRESENCE_DAYS = 62;
// Handovers before October 2026 had no payment split and many doubles; the page starts after them.
const MIN_SOURCE_DATE = '2026-10-01';
const PERIODS: PeriodId[] = ['today', 'yesterday', 'week', 'cycle', 'prevCycle', 'month', 'custom'];
// The same roles as «التقارير المجمعة» in the sidebar.
const TREASURY_ROLES = ['general_manager', 'admin', 'executive_manager'];

const TABS = [
  ['today', 'النهارده', LayoutDashboard],
  ['handovers', 'التسليمات', Receipt],
  ['stats', 'الإحصائيات', BarChart3],
  ['expenses', 'المصروفات', PieChart],
  ['coverage', 'اكتمال الشيفتات', CalendarCheck],
] as const;
type TabId = (typeof TABS)[number][0];

async function fetchAllShiftRows(): Promise<{ rows: ShiftRow[]; error: boolean }> {
  const all: ShiftRow[] = [];
  const PAGE_SIZE = 500;
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('shift_handovers')
      .select('*')
      .gte('shift_date', addDays(MIN_SOURCE_DATE, -1))
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

function Glossary() {
  const items: [string, string][] = [
    ['المبيعات', 'إجمالي مبيعات الشيفت زي ما الدكتور كتبه في دواء وائل.'],
    [
      'تحويلات',
      'فيزا + إنستا باي + فودافون كاش + تحويلات أخرى. الفلوس دي مش في الدرج، بتروح الحسابات.',
    ],
    ['كاش', 'المبيعات − التحويلات. ده اللي دخل الدرج.'],
    [
      'مصروفات',
      'المصروفات الحقيقية بس. المصروف اللي اتدفع كاش بيتخصم من الدرج، واللي اتدفع إنستا أو فودافون لأ.',
    ],
    ['كاش للمحاسب', 'الكاش − مصروفات الكاش. ده المبلغ اللي المفروض يتسلم للمحاسب من الشيفت.'],
    ['صافي التشغيل', 'المبيعات − كل المصروفات. ده رقم للتحليل ومش مبلغ بيتسلم.'],
  ];
  return (
    <details
      className="mt-3 rounded-xl border p-3 print:hidden"
      style={{ borderColor: 'var(--dawaa-theme-border)' }}
    >
      <summary className="inline-flex cursor-pointer items-center gap-2 text-sm font-black">
        <BookOpen size={16} /> الأرقام دي معناها إيه؟
      </summary>
      <dl className="mt-3 grid gap-2 text-xs font-bold sm:grid-cols-2">
        {items.map(([term, text]) => (
          <div
            key={term}
            className="rounded-lg p-2"
            style={{ background: 'var(--dawaa-theme-surface-raised)' }}
          >
            <dt className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
              {term}
            </dt>
            <dd className="dawaa-caption mt-0.5">{text}</dd>
          </div>
        ))}
      </dl>
      <p className="dawaa-caption mt-2 text-xs font-bold">
        المسائي اللي بيتقفل بعد نص الليل بيتحسب على يومه الأصلي حسب وقت التقفيل، فممكن تلاقي تسليم
        هنا في يوم أو شيفت غير اللي مكتوب في دواء وائل — الكارت بيقول ده صراحة، والمبالغ نفسها
        ماتتغيرش.
      </p>
    </details>
  );
}

export default function ShiftHandovers() {
  const { user } = useAuth();
  const today = cairoDayOf(new Date().toISOString()) as string;
  const yesterday = addDays(today, -1);
  const [rows, setRows] = useState<ShiftRow[]>([]);
  const [corrections, setCorrections] = useState<ShiftHandoverCorrection[]>([]);
  const [punches, setPunches] = useState<PunchInterval[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState<TabId>('today');
  const [period, setPeriod] = useState<PeriodId>('cycle');
  const [custom, setCustom] = useState({ from: addDays(today, -6), to: today });
  const [branchFilter, setBranchFilter] = useState<(typeof BRANCHES)[number]>('الكل');
  const [shiftFilter, setShiftFilter] = useState<(typeof SHIFT_FILTERS)[number]>('الكل');
  const [person, setPerson] = useState('الكل');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    const dutyTo = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
    const dutyFrom = addDays(dutyTo, -PRESENCE_DAYS);
    const [source, fixes, duty] = await Promise.all([
      fetchAllShiftRows(),
      supabase
        .from('shift_handover_corrections_v1')
        .select('*')
        .gte('created_at', MIN_SOURCE_DATE)
        .order('created_at')
        .limit(1000),
      // Top management only; everyone else sees the page without the names.
      supabase.rpc('shift_presence_intervals_v1', { p_from: dutyFrom, p_to: dutyTo }),
    ]);
    setCorrections(fixes.error ? [] : ((fixes.data || []) as ShiftHandoverCorrection[]));
    setPunches(duty.error ? null : ((duty.data || []) as PunchInterval[]));
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

  // The date and shift come from when it was closed (readHandovers); a slot holding two live handovers
  // is a double entry. Archived handovers never count.
  const live = useMemo<LiveRow[]>(() => {
    const read = readHandovers(rows.filter((r) => !r.is_archived)).filter(
      (r) => r.shift_date >= MIN_SOURCE_DATE
    );
    const slots = new Map<string, typeof read>();
    for (const r of read) {
      const key = `${r.branch}|${r.shift_date}|${r.shift_type}`;
      slots.set(key, [...(slots.get(key) ?? []), r]);
    }
    return read.map((r) => {
      const others = (slots.get(`${r.branch}|${r.shift_date}|${r.shift_type}`) ?? []).filter(
        (o) => o.id !== r.id
      );
      return {
        ...r,
        duplicate: others.length > 0,
        sameAmounts: others.some(
          (o) => Math.abs(Number(o.total_sales) - Number(r.total_sales)) < 1
        ),
      };
    });
  }, [rows]);

  const fixesOf = useCallback(
    (id: string) => corrections.filter((c) => c.handover_id === id),
    [corrections]
  );
  const presenceFrom = addDays(today, 1 - PRESENCE_DAYS);
  // The doctor on duty when the shift was handed over (or was due): a closed one at its closing time,
  // unless it was entered days later; a missing one at its usual handover time.
  const responsibleOf = useCallback<ResponsibleOf>(
    (branch, day, shift, row) => {
      if (!punches || day < presenceFrom) return null;
      const at =
        row?.recorded_at && !row.entered_late_days ? row.recorded_at : handoverMoment(day, shift);
      return shiftResponsible(punches, branch, at);
    },
    [punches, presenceFrom]
  );
  const people = useMemo(() => {
    const names = new Map<string, string>();
    for (const r of live) {
      const name = r.submitted_by?.trim();
      if (name && !names.has(closerKey(name))) names.set(closerKey(name), name);
    }
    return [...names.entries()].sort((a, b) => a[1].localeCompare(b[1], 'ar'));
  }, [live]);

  const scoped = useMemo(
    () =>
      live.filter(
        (r) =>
          (branchFilter === 'الكل' || r.branch === branchFilter) &&
          (shiftFilter === 'الكل' || r.shift_type === shiftFilter) &&
          (person === 'الكل' || closerKey(r.submitted_by) === person)
      ),
    [live, branchFilter, shiftFilter, person]
  );

  const range = useMemo(() => {
    const r = periodRange(period, today, custom);
    // Up to today only, so a running cycle is compared with the same number of days before it.
    const to = r.to > today ? today : r.to;
    const from = r.from < MIN_SOURCE_DATE ? MIN_SOURCE_DATE : r.from;
    return { from: from > to ? to : from, to };
  }, [period, today, custom]);
  const periodRows = useMemo(
    () => scoped.filter((r) => r.shift_date >= range.from && r.shift_date <= range.to),
    [scoped, range]
  );
  const prevRange = useMemo(() => previousRange(range), [range]);
  const prevRows = useMemo(
    () =>
      prevRange.from < MIN_SOURCE_DATE
        ? null
        : scoped.filter((r) => r.shift_date >= prevRange.from && r.shift_date <= prevRange.to),
    [scoped, prevRange]
  );
  const visibleBranches = useMemo(
    () => (branchFilter === 'الكل' ? [...SHIFT_HANDOVER_BRANCHES] : [branchFilter]) as string[],
    [branchFilter]
  );
  const visibleShifts = useMemo(
    () => (shiftFilter === 'الكل' ? [...SHIFT_TYPES] : [shiftFilter]),
    [shiftFilter]
  );
  const periodDays = useMemo(() => {
    const last = range.to < today ? range.to : today;
    const days: string[] = [];
    for (let day = last; day >= range.from; day = addDays(day, -1)) days.push(day);
    return days;
  }, [range, today]);

  const coverage = useMemo(() => shiftCoverage(live, COVERAGE_DAYS), [live]);
  // Back far enough for the previous cycle; nothing before the data starts counts as missing.
  const longCoverage = useMemo(
    () => shiftCoverage(live, PRESENCE_DAYS).filter((slot) => slot.day >= MIN_SOURCE_DATE),
    [live]
  );
  const slotOf = useCallback(
    (day: string, branch: string, shift: string) =>
      coverage.find(
        (slot) => slot.day === day && slot.branch === branch && slot.shift === shift
      ) as ShiftSlot<LiveRow> | undefined,
    [coverage]
  );
  const late = useMemo(
    () =>
      coverage.filter(
        (slot) =>
          slot.status === 'late' && (branchFilter === 'الكل' || slot.branch === branchFilter)
      ),
    [coverage, branchFilter]
  );
  const doubled = useMemo(() => coverage.filter((slot) => slot.status === 'duplicate'), [coverage]);
  const varianceCount = useMemo(
    () =>
      live.filter(
        (r) => r.shift_date >= addDays(today, -COVERAGE_DAYS) && shiftMoney(r).cashVariance
      ).length,
    [live, today]
  );
  const periodMissing = useMemo(
    () =>
      longCoverage.filter(
        (s) =>
          s.status === 'late' &&
          s.day >= range.from &&
          s.day <= range.to &&
          visibleBranches.includes(s.branch) &&
          (visibleShifts as string[]).includes(s.shift)
      ).length,
    [longCoverage, range, visibleBranches, visibleShifts]
  );
  const lastSync = useMemo(
    () =>
      rows.reduce<string | null>(
        (max, r) => (r.synced_at && (!max || r.synced_at > max) ? r.synced_at : max),
        null
      ),
    [rows]
  );
  const syncStale = lastSync ? Date.now() - Date.parse(lastSync) > 60 * 60 * 1000 : true;

  const exportExcel = async () => {
    const XLSX = await import('xlsx');
    const data = [...periodRows]
      .sort(
        (a, b) =>
          a.shift_date.localeCompare(b.shift_date) ||
          String(a.recorded_at).localeCompare(String(b.recorded_at))
      )
      .map((r) => {
        const m = shiftMoney(r);
        return {
          اليوم: r.shift_date,
          الفرع: r.branch,
          الشيفت: r.shift_type,
          'اللي قفل': r.submitted_by ?? '',
          'وقت التقفيل': timeLabel(r.recorded_at),
          المبيعات: m.sales,
          كاش: m.cash,
          فيزا: m.visa,
          'إنستا باي': m.insta,
          'فودافون كاش': m.vodafone,
          'تحويلات أخرى': m.other,
          'إجمالي التحويلات': m.transfers,
          المصروفات: m.expenses,
          'مصروفات من الكاش': m.cashExpenses,
          'كاش للمحاسب': m.toAccountant,
          'صافي التشغيل': m.operatingNet,
          'فرق كاش': m.cashVariance,
          'متسجل مرتين': r.duplicate ? 'نعم' : '',
          'في دواء وائل': r.reread ? `${r.source_type} ${r.source_date}` : '',
          ملاحظات: r.notes ?? '',
        };
      });
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!views'] = [{ RTL: true }] as never;
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    XLSX.utils.book_append_sheet(wb, ws, 'تسليم الشيفتات');
    XLSX.writeFile(wb, `تسليم-الشيفتات-${range.from}-${range.to}.xlsx`);
  };

  const filtersBar = (
    <section
      className="space-y-3 rounded-2xl border p-4 print:hidden"
      style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)' }}
      aria-label="فلاتر التسليمات"
    >
      <Pills
        label="الفترة"
        options={PERIODS}
        value={period}
        onChange={setPeriod}
        render={(p) => PERIOD_LABELS[p]}
      />
      {period === 'custom' ? (
        <div className="flex flex-wrap items-end gap-2 text-xs font-bold">
          <label>
            من
            <input
              type="date"
              className="dawaa-input mt-1 block"
              min={MIN_SOURCE_DATE}
              max={today}
              value={custom.from}
              onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
            />
          </label>
          <label>
            إلى
            <input
              type="date"
              className="dawaa-input mt-1 block"
              min={MIN_SOURCE_DATE}
              max={today}
              value={custom.to}
              onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
            />
          </label>
        </div>
      ) : null}
      <div className="flex flex-wrap items-end gap-3">
        <Pills label="الفرع" options={BRANCHES} value={branchFilter} onChange={setBranchFilter} />
        <Pills
          label="الشيفت"
          options={SHIFT_FILTERS}
          value={shiftFilter}
          onChange={setShiftFilter}
        />
        <label className="text-xs font-bold">
          اللي قفل
          <select
            className="dawaa-input mt-1 block"
            value={person}
            onChange={(e) => setPerson(e.target.value)}
          >
            <option value="الكل">الكل</option>
            {people.map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="dawaa-caption space-y-0.5 text-xs font-bold">
          <p>
            من {shortDay(range.from)} لحد {shortDay(range.to)} —{' '}
            {periodRows.length.toLocaleString('ar-EG')} تسليم
          </p>
          {prevRows ? (
            <p>
              بيتقارن بنفس عدد الأيام اللي قبلها: من {shortDay(prevRange.from)} لحد{' '}
              {shortDay(prevRange.to)}
            </p>
          ) : (
            <p>مفيش مقارنة: الفترة اللي قبلها قبل بداية البيانات (أكتوبر ٢٠٢٦)</p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="dawaa-tab inline-flex items-center gap-2"
            onClick={() => void exportExcel()}
            disabled={!periodRows.length}
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
    </section>
  );

  const days = useMemo(() => [...new Set(coverage.map((slot) => slot.day))], [coverage]);
  const coverageTab = (
    <HandoverCoverage
      slots={coverage}
      longSlots={longCoverage}
      days={days}
      branches={visibleBranches}
      today={today}
      coverageDays={COVERAGE_DAYS}
      responsibleOf={responsibleOf}
      namesKnown={Boolean(punches)}
    />
  );

  // Nothing is judged before the handovers arrive: an empty list would read as every shift missing.
  const ready = !loading && !loadError;
  const alerts: { text: string; to: TabId }[] = [];
  if (ready && late.length)
    alerts.push({
      text: `${late.length.toLocaleString('ar-EG')} شيفت ناقص في آخر ${COVERAGE_DAYS.toLocaleString('ar-EG')} يوم`,
      to: 'coverage',
    });
  if (ready && doubled.length)
    alerts.push({
      text: `${doubled.length.toLocaleString('ar-EG')} شيفت متسجل مرتين`,
      to: 'coverage',
    });
  if (ready && varianceCount)
    alerts.push({
      text: `${varianceCount.toLocaleString('ar-EG')} تسليم فيه فرق كاش`,
      to: 'handovers',
    });

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
            <p className="dawaa-caption mt-1 font-bold">من دواء وائل · بيتحدث كل ربع ساعة</p>
            <p
              className="mt-1 text-xs font-bold"
              style={{
                color:
                  ready && syncStale
                    ? 'var(--dawaa-status-danger-text)'
                    : 'var(--dawaa-theme-muted)',
              }}
            >
              {ready ? (
                <>
                  آخر مزامنة: {timeLabel(lastSync)}
                  {syncStale ? ' — المزامنة متأخرة، الأرقام ممكن تكون ناقصة' : ''}
                </>
              ) : (
                'جاري تحميل التسليمات…'
              )}
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
        {alerts.length ? (
          <div className="mt-3 flex flex-wrap gap-2 print:hidden">
            {alerts.map((a) => (
              <button
                key={a.text}
                type="button"
                onClick={() => setTab(a.to)}
                className="dawaa-alert dawaa-alert--danger text-right text-sm font-bold"
              >
                {a.text} — اعرض
              </button>
            ))}
          </div>
        ) : null}
        <Glossary />
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
            className={`dawaa-tab inline-flex shrink-0 items-center gap-2 whitespace-nowrap ${tab === id ? 'is-active' : ''}`}
            onClick={() => setTab(id)}
          >
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>

      {tab === 'handovers' || tab === 'stats' || tab === 'expenses' ? filtersBar : null}

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="animate-spin" style={{ color: 'var(--dawaa-theme-muted)' }} />
        </div>
      ) : loadError ? (
        <EmptyState label="تعذّر التحميل" error onRetry={() => void load()} />
      ) : tab === 'today' ? (
        <TodayBoard
          days={[today, yesterday]}
          slotOf={slotOf}
          responsibleOf={responsibleOf}
          onOpenDay={(day) => {
            setPeriod('custom');
            setCustom({ from: day, to: day });
            setTab('handovers');
          }}
        />
      ) : tab === 'handovers' ? (
        <HandoverDays
          rows={periodRows}
          days={periodDays}
          branches={visibleBranches}
          shifts={visibleShifts}
          showMissing={person === 'الكل'}
          fixesOf={fixesOf}
          punches={punches}
          presenceFrom={presenceFrom}
          responsibleOf={responsibleOf}
          onChanged={() => void load()}
        />
      ) : tab === 'stats' ? (
        <HandoverStats
          rows={periodRows}
          previous={prevRows}
          range={range}
          branches={visibleBranches}
          missingCount={periodMissing}
          today={today}
        />
      ) : tab === 'expenses' ? (
        <HandoverExpenses rows={periodRows} previous={prevRows} branches={visibleBranches} />
      ) : (
        coverageTab
      )}
    </div>
  );
}
