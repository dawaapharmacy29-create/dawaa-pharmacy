import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Bike,
  CalendarDays,
  ChevronDown,
  Clock,
  Loader2,
  RefreshCw,
  Search,
  Users,
  Wallet,
} from 'lucide-react';
import { EmptyState } from '@/components/dashboard/DashboardPrimitives';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import {
  DAY_KIND_LABELS,
  WEEK_DAYS,
  addDays,
  applyDrWaelBranchChange,
  applyDrWaelShiftChange,
  cairoTime,
  cycleLabel,
  dayKind,
  employeeMoney,
  fetchDrWaelDayPunches,
  fetchDrWaelFingerprints,
  fetchDrWaelSmartInsights,
  mapWithConcurrency,
  minutesLabel,
  openShifts,
  recentExceptions,
  setDrWaelRoaming,
  shiftCycle,
  summarizeEmployee,
  todayByBranch,
  workDayRows,
  workingWeekDays,
  type DayKind,
  type DrWaelDay,
  type DrWaelEmployee,
  type DrWaelFingerprints as Data,
  type DrWaelInsight,
  type DrWaelPunch,
  type DrWaelShiftMode,
} from '@/lib/drWaelFingerprints';
import {
  getEmployeePayrollFinancialComposition,
  type EmployeePayrollFinancialCompositionV2,
} from '@/lib/payroll/payrollFinancialCompositionService';
import PayrollTransparencyPanel from '@/components/payroll/PayrollTransparencyPanel';

// The look follows the Base44 fingerprint app (fingdawaa): white rounded cards on a light page, an
// indigo → violet accent, branch cards, employee cards with a days drawer and a compact payroll sheet.
// Every number is this app's own (شكري / الشامي / المخزن).

const TABS = [
  ['dashboard', 'لوحة المعلومات'],
  ['attendance', 'الحضور والانصراف'],
  ['workday', 'يوم عمل'],
  ['employees', 'الموظفين'],
  ['adjustments', 'الحوافز والسلف والخصومات'],
  ['leaves', 'الإجازات'],
  ['salaries', 'الرواتب'],
  ['reports', 'تقارير الموظفين'],
] as const;
type Tab = (typeof TABS)[number][0];

const CARD =
  'rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900';
const MUTED = 'text-gray-500 dark:text-slate-400';
// Text that sits on the app page itself (not inside a card) follows the app theme.
const PAGE_HEADING = 'text-[color:var(--dawaa-theme-heading)]';
const PAGE_MUTED = 'text-[color:var(--dawaa-theme-muted)]';
const SOFT = 'rounded-xl bg-gray-50 dark:bg-slate-800/60';
const ACTIVE =
  'bg-gradient-to-l from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/20';
const IDLE =
  'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800';

const TONES = {
  green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  red: 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300',
  blue: 'bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  violet: 'bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  gray: 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300',
};
type Tone = keyof typeof TONES;
const VALUE_TONES: Record<Tone, string> = {
  green: 'text-emerald-600 dark:text-emerald-400',
  amber: 'text-amber-600 dark:text-amber-400',
  red: 'text-rose-600 dark:text-rose-400',
  blue: 'text-sky-600 dark:text-sky-400',
  violet: 'text-violet-600 dark:text-violet-400',
  gray: 'text-gray-900 dark:text-slate-100',
};
const KIND_TONE: Record<DayKind, Tone> = {
  present: 'green',
  late: 'amber',
  review: 'amber',
  absent: 'red',
  off: 'gray',
  time_off: 'blue',
  other: 'gray',
};
const TIME_OFF_KINDS: Record<string, string> = {
  annual_leave: 'إجازة اعتيادية',
  sick_leave: 'إجازة مرضي',
  approved_absence: 'غياب بإذن',
  permission: 'إذن',
  shift_swap: 'تبديل شيفت',
};
const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const money = (value: number) =>
  `${Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })} ج`;
const hoursText = (value: number | null | undefined) =>
  Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const weekday = (date: string) => WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
const hhmm = (value: string | null) => (value ? value.slice(0, 5) : '—');
const matches = (branch: string, value: string | null | undefined) =>
  branch === 'الكل' || value === branch;

function Pill({ tone = 'gray', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

function Section({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className={`text-base font-bold ${PAGE_HEADING}`}>{title}</h2>
          {subtitle ? <p className={`text-xs ${PAGE_MUTED}`}>{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, value, tone = 'gray' }: { label: string; value: string; tone?: Tone }) {
  return (
    <div className={`${CARD} px-3 py-2`}>
      <div className={`text-[11px] ${MUTED}`}>{label}</div>
      <div className={`text-lg font-bold leading-7 ${VALUE_TONES[tone]}`}>{value}</div>
    </div>
  );
}

function Chips<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: ReadonlyArray<readonly [T, string]>;
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          aria-pressed={value === key}
          className={`rounded-lg px-3 py-1 text-xs font-bold transition ${value === key ? ACTIVE : IDLE}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function DataTable({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className={`${CARD} overflow-x-auto`}>
      <table className="w-full text-right text-xs">
        <thead className={`border-b border-gray-100 dark:border-slate-800 ${MUTED}`}>
          <tr>
            {head.map((label) => (
              <th key={label} className="whitespace-nowrap px-3 py-2 font-bold">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50 dark:divide-slate-800">{children}</tbody>
      </table>
    </div>
  );
}

const Td = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <td className={`whitespace-nowrap px-3 py-2 ${className}`}>{children}</td>
);

const Empty = ({ label }: { label: string }) => (
  <div className={`${CARD} p-6 text-center text-xs font-bold ${MUTED}`}>{label}</div>
);

const Spinner = ({ label }: { label: string }) => (
  <div className={`flex items-center justify-center gap-2 p-8 text-xs ${MUTED}`} role="status">
    <Loader2 size={16} className="animate-spin" /> {label}
  </div>
);

function roleTag(employee: DrWaelEmployee | undefined): { tone: Tone; label: string } {
  const text = `${employee?.role || ''} ${employee?.type || ''}`.toLowerCase();
  if (employee?.delivery || text.includes('deliver') || text.includes('توصيل'))
    return { tone: 'green', label: 'مندوب توصيل' };
  if (text.includes('assist') || text.includes('مساعد')) return { tone: 'violet', label: 'مساعد' };
  if (text.includes('pharmac') || text.includes('صيدلي')) return { tone: 'blue', label: 'صيدلي' };
  if (text.includes('warehouse') || text.includes('مخزن')) return { tone: 'amber', label: 'مخزن' };
  return { tone: 'gray', label: employee?.type || employee?.role || 'موظف' };
}

function dayFlags(day: DrWaelDay) {
  const kind = dayKind(day);
  return (
    <div className="flex flex-wrap gap-1">
      {day.late_minutes > 0 ? <Pill tone="red">متأخر {day.late_minutes} دقيقة</Pill> : null}
      {day.early_leave_minutes > 0 ? (
        <Pill tone="red">انصرف قبل الموعد بـ {day.early_leave_minutes} دقيقة</Pill>
      ) : null}
      {day.missing_punch && day.punches === 1 ? <Pill tone="amber">بصمة واحدة فقط</Pill> : null}
      {kind === 'absent' ? <Pill tone="red">غائب</Pill> : null}
      {kind === 'review' ? <Pill tone="amber">يحتاج مراجعة</Pill> : null}
    </div>
  );
}

// What the punches say about one employee, as a card highlight.
function insightFlags(insight: DrWaelInsight | undefined) {
  if (!insight) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {insight.shift ? (
        <Pill tone="amber">
          بيبصم {insight.shift.start}–{insight.shift.end} من {insight.shift.since.slice(5)}
        </Pill>
      ) : null}
      {insight.branch_suggestion ? (
        <Pill tone="blue">بيبصم في {insight.branch_suggestion}</Pill>
      ) : null}
      {insight.roaming ? (
        <Pill tone="violet">
          جرد{insight.today_branch ? ` · النهارده في ${insight.today_branch}` : ''}
        </Pill>
      ) : null}
    </div>
  );
}

const insightRing = (insight: DrWaelInsight | undefined) =>
  insight?.shift
    ? 'border-amber-300 ring-2 ring-amber-300/60 dark:border-amber-500/60 dark:ring-amber-500/30'
    : insight?.branch_suggestion
      ? 'border-sky-300 ring-2 ring-sky-300/60 dark:border-sky-500/60 dark:ring-sky-500/30'
      : 'border-gray-100 dark:border-slate-800';

export default function DrWaelFingerprints() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [cycle, setCycle] = useState<string | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [branch, setBranch] = useState<string>('الكل');
  const [insights, setInsights] = useState<Map<string, DrWaelInsight>>(new Map());
  const [smart, setSmart] = useState<DrWaelEmployee | null>(null);
  const request = useRef(0);

  const loadInsights = useCallback(async () => {
    try {
      const rows = await fetchDrWaelSmartInsights();
      setInsights(new Map(rows.map((row) => [row.staff_id, row])));
    } catch {
      setInsights(new Map());
    }
  }, []);

  const load = useCallback(
    async (target: string | null) => {
      const id = ++request.current;
      setLoading(true);
      setError(null);
      void loadInsights();
      try {
        const next = await fetchDrWaelFingerprints(target);
        if (id === request.current) setData(next);
      } catch (e) {
        if (id === request.current)
          setError(
            e instanceof Error && e.message.includes('not_authorized')
              ? 'الصفحة دي للمدير العام ود. وائل بس.'
              : 'تعذر تحميل البصمات؛ حاول تاني.'
          );
      } finally {
        if (id === request.current) setLoading(false);
      }
    },
    [loadInsights]
  );

  useEffect(() => {
    void load(cycle);
  }, [cycle, load]);

  const names = useMemo(() => new Map((data?.employees || []).map((e) => [e.staff_id, e])), [data]);
  const employees = useMemo(
    () => (data?.employees || []).filter((e) => matches(branch, e.branch)),
    [data, branch]
  );

  if (loading && !data) return <Spinner label="جارٍ تحميل البصمات" />;
  if (!data)
    return (
      <EmptyState label={error || 'تعذر تحميل البصمات'} error onRetry={() => void load(cycle)} />
    );

  const current = data.month_cycle;
  const isCurrent = data.today >= data.cycle_start && data.today <= data.cycle_end;
  return (
    <div className="space-y-4 text-sm" dir="rtl" aria-busy={loading}>
      <div className={`${CARD} space-y-2 p-2`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1 rounded-xl bg-gray-100 p-1 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setCycle(shiftCycle(current, -1))}
              disabled={loading}
              className="rounded-lg px-3 py-1 text-xs font-bold text-gray-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-900"
            >
              الفترة السابقة
            </button>
            <span className={`rounded-lg px-3 py-1 text-xs font-bold ${ACTIVE}`}>
              {isCurrent ? 'الفترة الحالية' : cycleLabel(current)}
            </span>
            <button
              type="button"
              onClick={() => setCycle(shiftCycle(current, 1))}
              disabled={loading || isCurrent || data.today <= data.cycle_end}
              className="rounded-lg px-3 py-1 text-xs font-bold text-gray-600 hover:bg-white disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-900"
            >
              التالية
            </button>
          </div>
          <div className={`flex items-center gap-2 text-xs ${MUTED}`}>
            <span>
              {data.cycle_start} ← {data.cycle_end}
            </span>
            <button
              type="button"
              onClick={() => void load(cycle)}
              disabled={loading}
              aria-label="تحديث"
              className={`rounded-lg p-1.5 ${IDLE}`}
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto" aria-label="أقسام البصمات">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              aria-pressed={tab === key}
              className={`shrink-0 whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-bold transition ${tab === key ? ACTIVE : 'text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}
            >
              {label}
            </button>
          ))}
        </nav>
        <Chips
          label="الفرع"
          value={branch}
          onChange={setBranch}
          options={[['الكل', 'كل الفروع'], ...data.branches.map((b) => [b, b] as const)]}
        />
      </div>
      {error ? (
        <div
          role="alert"
          className={`flex justify-between gap-3 rounded-xl px-3 py-2 text-xs font-bold ${TONES.red}`}
        >
          {error}
          <button type="button" onClick={() => void load(cycle)} className="underline">
            إعادة المحاولة
          </button>
        </div>
      ) : null}

      {tab === 'dashboard' ? (
        <DashboardTab
          data={data}
          branch={branch}
          names={names}
          insights={insights}
          onSmart={setSmart}
        />
      ) : null}
      {tab === 'attendance' ? (
        <AttendanceTab data={data} employees={employees} insights={insights} onSmart={setSmart} />
      ) : null}
      {tab === 'workday' ? <WorkDayTab data={data} branch={branch} names={names} /> : null}
      {tab === 'employees' ? (
        <EmployeesTab employees={employees} insights={insights} onSmart={setSmart} />
      ) : null}
      {tab === 'adjustments' ? (
        <AdjustmentsTab data={data} employees={employees} names={names} />
      ) : null}
      {tab === 'leaves' ? <LeavesTab data={data} employees={employees} /> : null}
      {tab === 'salaries' ? <SalariesTab cycle={current} employees={employees} /> : null}
      {tab === 'reports' ? <ReportsTab data={data} employees={employees} /> : null}
      <Sheet open={Boolean(smart)} onOpenChange={(next) => !next && setSmart(null)}>
        <SheetContent
          side="left"
          className="w-full overflow-y-auto bg-white text-gray-800 dark:bg-slate-950 dark:text-slate-200 sm:max-w-lg"
          dir="rtl"
        >
          {smart ? (
            <SmartEditor
              key={smart.staff_id}
              employee={smart}
              insight={insights.get(smart.staff_id)}
              today={data.today}
              branches={data.branches}
              onSaved={() => void load(cycle)}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// Quick edit from what the fingerprints say: the shift (permanent from a date, one day, or a period) and
// the branch (move with the device, or mark as inventory staff who punch wherever they count).
function SmartEditor({
  employee,
  insight,
  today,
  branches,
  onSaved,
}: {
  employee: DrWaelEmployee;
  insight: DrWaelInsight | undefined;
  today: string;
  branches: string[];
  onSaved: () => void;
}) {
  const suggestion = insight?.shift || null;
  const current = employee.week.find((d) => d.date === today && d.scheduled && !d.off);
  const [start, setStart] = useState(
    suggestion?.start || hhmm(current?.start || null).replace('—', '')
  );
  const [end, setEnd] = useState(suggestion?.end || hhmm(current?.end || null).replace('—', ''));
  const [mode, setMode] = useState<DrWaelShiftMode>('permanent');
  const [from, setFrom] = useState(suggestion?.since || today);
  const [to, setTo] = useState(addDays(today, 6));
  const [days, setDays] = useState<string[]>(() => {
    const working = workingWeekDays(employee.week);
    return working.length ? working : WEEK_DAYS;
  });
  const [moveTo, setMoveTo] = useState(insight?.branch_suggestion || employee.branch);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: Tone; text: string } | null>(null);

  const run = async (key: string, action: () => Promise<string>) => {
    setBusy(key);
    setMessage(null);
    try {
      setMessage({ tone: 'green', text: await action() });
      onSaved();
    } catch (e) {
      const text = e instanceof Error ? e.message : '';
      setMessage({
        tone: 'red',
        text: text.includes('not_authorized')
          ? 'مفيش صلاحية'
          : text.includes('period')
            ? 'الفترة لازم تكون من يوم لحد 62 يوم'
            : text.includes('18_hours')
              ? 'الشيفت أطول من 18 ساعة'
              : 'ماتسجلش، راجع البيانات وحاول تاني',
      });
    } finally {
      setBusy(null);
    }
  };

  const saveShift = () =>
    run('shift', async () => {
      const result = await applyDrWaelShiftChange({
        staffId: employee.staff_id,
        start,
        end,
        mode,
        from,
        to: mode === 'period' ? to : null,
        days: mode === 'permanent' ? days : null,
      });
      return `اتسجل الميعاد · اتعاد حساب ${result.days_rebuilt} يوم${result.days_kept_manager_approved ? ` · ${result.days_kept_manager_approved} يوم معتمد من مدير ماتغيرش` : ''}`;
    });

  const device = Object.entries(insight?.device_branches || {}).sort((a, b) => b[1] - a[1]);
  const input = `rounded-lg px-2 py-1 text-xs ${IDLE}`;
  return (
    <div className="space-y-4 text-sm text-gray-800 dark:text-slate-200">
      <div>
        <SheetTitle className="text-lg font-bold text-gray-900 dark:text-slate-100">
          {employee.name}
        </SheetTitle>
        <p className={`text-xs ${MUTED}`}>
          {employee.branch} · {roleTag(employee).label}
        </p>
      </div>
      {message ? (
        <div
          role="status"
          className={`rounded-xl px-3 py-2 text-xs font-bold ${TONES[message.tone]}`}
        >
          {message.text}
        </div>
      ) : null}

      <section className={`${CARD} space-y-3 p-3`}>
        <h3 className="flex items-center gap-1 font-bold text-gray-900 dark:text-slate-100">
          <Clock size={15} /> ميعاد الشيفت
        </h3>
        {suggestion ? (
          <div className={`rounded-xl px-3 py-2 text-xs ${TONES.amber}`}>
            البصمة بتقول إنه بيشتغل{' '}
            <b>
              {suggestion.start}–{suggestion.end}
            </b>{' '}
            من {suggestion.since} ({suggestion.days} يوم) بدل الجدول المسجل.
            <ul className="mt-1 space-y-0.5 opacity-90">
              {suggestion.sample.slice(0, 4).map((day) => (
                <li key={day.date}>
                  {day.date}: {cairoTime(day.first_in)} ← {cairoTime(day.last_out)}
                  {day.scheduled_start
                    ? ` (الجدول ${hhmm(day.scheduled_start)}–${hhmm(day.scheduled_end)})`
                    : ' (مالوش جدول)'}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className={`text-xs ${MUTED}`}>مفيش اختلاف واضح بين البصمة والجدول؛ تقدر تعدل يدوي.</p>
        )}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1">
            من
            <input
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className={input}
            />
          </label>
          <label className="flex items-center gap-1">
            لحد
            <input
              type="time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className={input}
            />
          </label>
        </div>
        <Chips<DrWaelShiftMode>
          label="مدة التعديل"
          value={mode}
          onChange={setMode}
          options={[
            ['permanent', 'ميعاد جديد باستمرار'],
            ['day', 'يوم واحد'],
            ['period', 'فترة'],
          ]}
        />
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1">
            {mode === 'day' ? 'اليوم' : 'من يوم'}
            <input
              type="date"
              value={from}
              min={addDays(today, -40)}
              onChange={(e) => e.target.value && setFrom(e.target.value)}
              className={input}
            />
          </label>
          {mode === 'period' ? (
            <label className="flex items-center gap-1">
              لحد يوم
              <input
                type="date"
                value={to}
                min={from}
                onChange={(e) => e.target.value && setTo(e.target.value)}
                className={input}
              />
            </label>
          ) : null}
        </div>
        {mode === 'permanent' ? (
          <div className="space-y-1">
            <div className={`text-[11px] ${MUTED}`}>
              الأيام اللي هتاخد الميعاد الجديد (الباقي يفضل زي ما هو)
            </div>
            <div className="flex flex-wrap gap-1">
              {WEEK_DAYS.map((day) => {
                const on = days.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setDays((list) => (on ? list.filter((d) => d !== day) : [...list, day]))
                    }
                    className={`rounded-lg px-2 py-1 text-[11px] font-bold ${on ? ACTIVE : IDLE}`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        <p className={`text-[11px] ${MUTED}`}>
          الأيام اللي فاتت في المدة دي بيتعاد حسابها تلقائي؛ اليوم اللي اعتمده مدير بيفضل زي ما هو.
          {mode === 'period' ? ' أيام الراحة في الفترة بتفضل راحة.' : ''}
        </p>
        <button
          type="button"
          disabled={
            Boolean(busy) ||
            !start ||
            !end ||
            start === end ||
            (mode === 'permanent' && !days.length)
          }
          onClick={() => void saveShift()}
          className={`w-full rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-50 ${ACTIVE}`}
        >
          {busy === 'shift' ? 'جارٍ الحفظ…' : 'اعتمد الميعاد'}
        </button>
      </section>

      <section className={`${CARD} space-y-3 p-3`}>
        <h3 className="flex items-center gap-1 font-bold text-gray-900 dark:text-slate-100">
          <Users size={15} /> الفرع حسب جهاز البصمة
        </h3>
        <div className="flex flex-wrap gap-1 text-[11px]">
          {device.length ? (
            device.map(([name, count]) => (
              <Pill key={name} tone={name === employee.branch ? 'green' : 'blue'}>
                {name}: {count} يوم
              </Pill>
            ))
          ) : (
            <span className={MUTED}>مفيش بصمات على الأجهزة آخر أسبوعين</span>
          )}
          {insight?.today_branch ? (
            <Pill tone="violet">النهارده: {insight.today_branch}</Pill>
          ) : null}
        </div>
        <label className="flex items-center justify-between gap-2 text-xs">
          <span>
            <b>بيجرد الفروع</b>
            <span className={`block text-[11px] ${MUTED}`}>
              يبصم في أي فرع من غير ما يتقترح نقله (زي فريق المخزن)
            </span>
          </span>
          <input
            type="checkbox"
            checked={Boolean(insight?.roaming ?? employee.roaming)}
            disabled={Boolean(busy)}
            onChange={(e) => {
              const next = e.target.checked;
              void run('roaming', async () => {
                await setDrWaelRoaming(employee.staff_id, next);
                return next ? 'اتسجل إنه بيجرد الفروع' : 'اتشال من فريق الجرد';
              });
            }}
            className="h-4 w-4 accent-violet-600"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            value={moveTo}
            onChange={(e) => setMoveTo(e.target.value)}
            className={input}
            aria-label="الفرع"
          >
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={Boolean(busy) || moveTo === employee.branch}
            onClick={() =>
              void run('branch', async () => {
                await applyDrWaelBranchChange(employee.staff_id, moveTo);
                return `اتنقل لـ ${moveTo} (والحساب بتاعه كمان)`;
              })
            }
            className={`rounded-lg px-3 py-1.5 font-bold disabled:opacity-50 ${ACTIVE}`}
          >
            {busy === 'branch' ? 'جارٍ النقل…' : 'انقل للفرع'}
          </button>
        </div>
      </section>
    </div>
  );
}

function SmartAlerts({
  employees,
  insights,
  onSmart,
}: {
  employees: DrWaelEmployee[];
  insights: Map<string, DrWaelInsight>;
  onSmart: (employee: DrWaelEmployee) => void;
}) {
  const list = employees.filter((e) => {
    const insight = insights.get(e.staff_id);
    return insight?.shift || insight?.branch_suggestion;
  });
  if (!list.length) return null;
  return (
    <Section
      title="تنبيهات البصمة الذكية"
      subtitle="موظفين بيبصموا في ميعاد أو فرع غير المسجل · آخر أسبوعين"
    >
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {list.map((employee) => {
          const insight = insights.get(employee.staff_id);
          return (
            <button
              key={employee.staff_id}
              type="button"
              onClick={() => onSmart(employee)}
              className={`${CARD} border p-3 text-right transition hover:shadow-md ${insightRing(insight)}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-gray-900 dark:text-slate-100">{employee.name}</span>
                <span className={`text-[11px] ${MUTED}`}>{employee.branch}</span>
              </div>
              {insightFlags(insight)}
              <div className="mt-2 text-[11px] font-bold text-indigo-600 dark:text-indigo-400">
                {insight?.shift ? 'اعتمد الميعاد الجديد ←' : 'انقله للفرع ←'}
              </div>
            </button>
          );
        })}
      </div>
    </Section>
  );
}

function DashboardTab({
  data,
  branch,
  names,
  insights,
  onSmart,
}: {
  data: Data;
  branch: string;
  names: Map<string, DrWaelEmployee>;
  insights: Map<string, DrWaelInsight>;
  onSmart: (employee: DrWaelEmployee) => void;
}) {
  const branches = data.branches.filter((b) => matches(branch, b));
  const open = openShifts(data.days, data.today);
  const today = todayByBranch(data, data.today).filter((row) => matches(branch, row.branch));
  const sum = (key: 'present' | 'late' | 'review' | 'absent') =>
    String(today.reduce((total, row) => total + row[key], 0));
  const groups = recentExceptions(
    data.days.filter((day) => matches(branch, day.branch)),
    data.today
  );
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Kpi label={`حضور النهارده · ${weekday(data.today)}`} value={sum('present')} tone="green" />
        <Kpi label="متأخرين" value={sum('late')} tone="amber" />
        <Kpi label="يحتاج مراجعة" value={sum('review')} tone="violet" />
        <Kpi label="غياب" value={sum('absent')} tone="red" />
      </div>
      <SmartAlerts
        employees={data.employees.filter((e) => e.active && matches(branch, e.branch))}
        insights={insights}
        onSmart={onSmart}
      />
      <Section title="الحاضرون الآن" subtitle="بصمة حضور النهارده أو امبارح بالليل من غير انصراف">
        <div className="grid gap-3 md:grid-cols-3">
          {branches.map((b) => {
            const list = open.filter((day) => day.branch === b);
            return (
              <div key={b} className={`${CARD} p-3`}>
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-gray-900 dark:text-slate-100">{b}</h3>
                  <span className={`rounded-lg p-1.5 ${TONES.violet}`}>
                    <Users size={16} />
                  </span>
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-gray-900 dark:text-slate-100">
                    {list.length}
                  </span>
                  <span className={`text-xs ${MUTED}`}>موظف لم يسجل انصرافه</span>
                </div>
                {list.length ? (
                  <ul className="mt-2 divide-y divide-gray-50 border-t border-gray-100 dark:divide-slate-800 dark:border-slate-800">
                    {list.map((day) => {
                      const employee = names.get(day.staff_id);
                      return (
                        <li
                          key={`${day.staff_id}-${day.date}`}
                          className="flex items-center justify-between py-1.5 text-xs"
                        >
                          <span className="flex items-center gap-1 font-bold text-gray-800 dark:text-slate-200">
                            {employee?.name || '—'}
                            {employee?.delivery ? (
                              <Bike size={12} className="text-emerald-500" />
                            ) : null}
                          </span>
                          <span className={MUTED}>{cairoTime(day.first_in)}</span>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </div>
      </Section>
      <Section
        title="حضور وانصراف يحتاج مراجعة — آخر 5 أيام"
        subtitle={`${groups[groups.length - 1]?.date} ← ${groups[0]?.date}`}
      >
        <div className="space-y-3">
          {groups.map((group) => (
            <div key={group.date} className={`${CARD} p-3`}>
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="font-bold text-gray-900 dark:text-slate-100">
                  {group.date} · {weekday(group.date)}
                </span>
                <span className={MUTED}>{group.days.length} حالة</span>
              </div>
              {group.days.length ? (
                <div className="grid gap-2 md:grid-cols-2">
                  {group.days.map((day) => (
                    <div
                      key={`${day.staff_id}-${day.date}`}
                      className="rounded-xl border border-gray-100 p-2.5 dark:border-slate-800"
                    >
                      <div className="font-bold text-gray-900 dark:text-slate-100">
                        {names.get(day.staff_id)?.name || '—'}
                      </div>
                      <div className={`text-[11px] ${MUTED}`}>
                        {day.branch}
                        {day.scheduled_start
                          ? ` · الشيفت ${cairoTime(day.scheduled_start)} — ${cairoTime(day.scheduled_end)}`
                          : ''}
                      </div>
                      <div className="mt-1 text-[11px] text-gray-700 dark:text-slate-300">
                        {day.first_in ? (
                          <>
                            الحضور: <b className="text-emerald-600">{cairoTime(day.first_in)}</b> ·
                            الانصراف: <b className="text-rose-600">{cairoTime(day.last_out)}</b> ·
                            مدة العمل: <b>{minutesLabel(Number(day.hours || 0) * 60)}</b>
                          </>
                        ) : (
                          'لا يوجد سجل حضور'
                        )}
                      </div>
                      <div className="mt-1.5">{dayFlags(day)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-xs font-bold text-emerald-600">
                  لا توجد حالات متبقية للمراجعة ✓
                </p>
              )}
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function AttendanceTab({
  data,
  employees,
  insights,
  onSmart,
}: {
  data: Data;
  employees: DrWaelEmployee[];
  insights: Map<string, DrWaelInsight>;
  onSmart: (employee: DrWaelEmployee) => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'review' | 'smart'>('all');
  const [open, setOpen] = useState<DrWaelEmployee | null>(null);
  const flagged = (staffId: string) => {
    const insight = insights.get(staffId);
    return Boolean(insight?.shift || insight?.branch_suggestion);
  };
  const rows = employees
    .map((employee) => ({ employee, summary: summarizeEmployee(employee.staff_id, data.days) }))
    .filter(
      ({ employee, summary }) =>
        employee.name.includes(query.trim()) &&
        (filter === 'all' ||
          (filter === 'review' && summary.reviewDays > 0) ||
          (filter === 'smart' && flagged(employee.staff_id)))
    );
  const branches = data.branches.filter((b) => rows.some((row) => row.employee.branch === b));
  return (
    <div className="space-y-3">
      <div className={`${CARD} flex flex-wrap items-center gap-2 p-2`}>
        <label className="flex flex-1 items-center gap-2 rounded-xl bg-gray-50 px-3 py-1.5 dark:bg-slate-800">
          <Search size={14} className="text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="اسم الموظف…"
            aria-label="بحث باسم الموظف"
            className="w-full bg-transparent text-xs outline-none"
          />
        </label>
        <Chips<'all' | 'review' | 'smart'>
          label="الحالة"
          value={filter}
          onChange={setFilter}
          options={[
            ['all', 'الكل'],
            ['review', 'يحتاج مراجعة'],
            ['smart', 'ميعاد أو فرع مختلف'],
          ]}
        />
      </div>
      <Section title="متابعة الموظفين حسب الفرع">
        {branches.length ? null : <Empty label="مفيش موظفين بالفلتر ده" />}
        {branches.map((b) => {
          const list = rows.filter((row) => row.employee.branch === b);
          return (
            <details key={b} open className={`${CARD} group p-3`}>
              <summary className="flex cursor-pointer list-none items-center justify-between">
                <span className="font-bold text-gray-900 dark:text-slate-100">{b}</span>
                <span className={`flex items-center gap-1 text-xs ${MUTED}`}>
                  {list.length} موظف
                  <ChevronDown size={14} className="transition group-open:rotate-180" />
                </span>
              </summary>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {list.map(({ employee, summary }) => {
                  const insight = insights.get(employee.staff_id);
                  return (
                    <div
                      key={employee.staff_id}
                      className={`rounded-xl border p-2.5 ${insightRing(insight)}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-bold text-gray-900 dark:text-slate-100">
                            {employee.name}
                          </div>
                          <div className={`text-[11px] ${MUTED}`}>{roleTag(employee).label}</div>
                        </div>
                        {summary.reviewDays ? (
                          <Pill tone="amber">{summary.reviewDays} يوم يحتاج مراجعة</Pill>
                        ) : (
                          <Pill tone="green">مكتمل</Pill>
                        )}
                      </div>
                      {insightFlags(insight)}
                      <div className="mt-2 flex items-center justify-between text-[11px]">
                        <span className={MUTED}>
                          {summary.workedDays} يوم حضور · {hoursText(summary.hours)} ساعة
                        </span>
                        <span className="flex gap-3">
                          <button
                            type="button"
                            onClick={() => onSmart(employee)}
                            className="font-bold text-amber-600 hover:underline dark:text-amber-400"
                          >
                            تعديل الميعاد/الفرع
                          </button>
                          <button
                            type="button"
                            onClick={() => setOpen(employee)}
                            className="font-bold text-indigo-600 hover:underline dark:text-indigo-400"
                          >
                            عرض الأيام ←
                          </button>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </details>
          );
        })}
      </Section>
      <Sheet open={Boolean(open)} onOpenChange={(next) => !next && setOpen(null)}>
        <SheetContent
          side="left"
          className="w-full overflow-y-auto bg-white text-gray-800 dark:bg-slate-950 dark:text-slate-200 sm:max-w-xl"
          dir="rtl"
        >
          {open ? <EmployeeDays employee={open} data={data} /> : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function EmployeeDays({ employee, data }: { employee: DrWaelEmployee; data: Data }) {
  const days = data.days
    .filter((day) => day.staff_id === employee.staff_id)
    .sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div className="space-y-3 text-sm">
      <SheetTitle className="text-lg font-bold text-gray-900 dark:text-slate-100">
        {employee.name}
      </SheetTitle>
      <p className={`text-xs ${MUTED}`}>
        {employee.branch} · {cycleLabel(data.month_cycle)}
      </p>
      {days.length ? (
        <DataTable head={['التاريخ', 'اليوم', 'الحضور', 'الانصراف', 'الساعات', 'الحالة']}>
          {days.map((day) => {
            const kind = dayKind(day);
            return (
              <tr key={`${day.date}-${day.branch}`}>
                <Td>{day.date}</Td>
                <Td>{weekday(day.date)}</Td>
                <Td className="font-bold text-emerald-600">{cairoTime(day.first_in)}</Td>
                <Td className="font-bold text-rose-600">{cairoTime(day.last_out)}</Td>
                <Td>{day.hours ? hoursText(day.hours) : '—'}</Td>
                <Td>
                  <Pill tone={KIND_TONE[kind]}>{DAY_KIND_LABELS[kind]}</Pill>
                  {day.missing_punch && day.punches === 1 ? (
                    <span className="mr-1">
                      <Pill tone="amber">بصمة واحدة</Pill>
                    </span>
                  ) : null}
                </Td>
              </tr>
            );
          })}
        </DataTable>
      ) : (
        <Empty label="مفيش أيام في الفترة دي" />
      )}
    </div>
  );
}

function WorkDayTab({
  data,
  branch,
  names,
}: {
  data: Data;
  branch: string;
  names: Map<string, DrWaelEmployee>;
}) {
  const [date, setDate] = useState(data.today);
  const [punches, setPunches] = useState<DrWaelPunch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const request = useRef(0);
  useEffect(() => {
    const id = ++request.current;
    setPunches(null);
    setError(null);
    fetchDrWaelDayPunches(date)
      .then((rows) => {
        if (id === request.current) setPunches(rows);
      })
      .catch(() => {
        if (id === request.current) setError('تعذر تحميل بصمات اليوم');
      });
  }, [date, attempt]);
  const rows = workDayRows(punches || [])
    .filter((row) => matches(branch, row.branch))
    .sort((a, b) => Date.parse(a.punches[0]) - Date.parse(b.punches[0]));
  const quick = [
    [data.today, 'النهارده'],
    [addDays(data.today, -1), 'أمس'],
    [addDays(data.today, -2), 'أول أمس'],
  ] as const;
  return (
    <div className="space-y-3">
      <div className={`${CARD} flex flex-wrap items-center justify-between gap-2 p-2`}>
        <Chips
          label="اليوم"
          value={quick.some(([d]) => d === date) ? date : ''}
          onChange={setDate}
          options={quick}
        />
        <input
          type="date"
          className={`rounded-lg px-2 py-1 text-xs ${IDLE}`}
          value={date}
          max={data.today}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          aria-label="يوم محدد"
        />
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className={`font-bold ${PAGE_HEADING}`}>
          {weekday(date)}، {date}
        </span>
        <span className={PAGE_MUTED}>بالترتيب من أول بصمة · البصمات لحد 8 الصبح اليوم التالي</span>
      </div>
      {error ? (
        <EmptyState label={error} error onRetry={() => setAttempt((n) => n + 1)} />
      ) : !punches ? (
        <Spinner label="جارٍ تحميل البصمات" />
      ) : !rows.length ? (
        <Empty label="مفيش بصمات في اليوم ده" />
      ) : (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => {
            const employee = row.staffId ? names.get(row.staffId) : undefined;
            const tag = roleTag(employee);
            const day = data.days.find((d) => d.staff_id === row.staffId && d.date === date);
            return (
              <div key={row.key} className={`${CARD} p-3`}>
                <div className="flex items-center justify-between">
                  <Pill tone={tag.tone}>
                    {tag.tone === 'green' ? <Bike size={11} /> : null}
                    {row.staffId ? tag.label : 'كود مش متربط'}
                  </Pill>
                  <span className={`text-[11px] ${MUTED}`}>{row.branch || '—'}</span>
                </div>
                <div className="mt-1.5 font-bold text-gray-900 dark:text-slate-100">{row.name}</div>
                <div className={`${SOFT} mt-2 flex justify-between px-3 py-1.5 text-xs`}>
                  <span>
                    <span className={MUTED}>الحضور: </span>
                    <b>{cairoTime(row.punches[0])}</b>
                  </span>
                  <span>
                    <span className={MUTED}>الانصراف: </span>
                    <b>
                      {row.punches.length > 1
                        ? cairoTime(row.punches[row.punches.length - 1])
                        : '—'}
                    </b>
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <div className={MUTED}>المدة بين الحضور والانصراف</div>
                    <b className="text-sm">
                      {row.grossMinutes ? minutesLabel(row.grossMinutes) : 'غير مكتمل'}
                    </b>
                  </div>
                  <div>
                    <div className={MUTED}>التأخير عن الموعد</div>
                    <b className="text-sm">{day ? `${day.late_minutes} دقيقة` : '—'}</b>
                  </div>
                </div>
                {row.punches.length > 2 ? (
                  <div className={`mt-1.5 text-[11px] ${MUTED}`}>
                    البصمات: {row.punches.map((p) => cairoTime(p)).join(' · ')} · صافي الشغل{' '}
                    {minutesLabel(row.workMinutes)}
                  </div>
                ) : null}
                {row.singlePunch ? (
                  <div className="mt-1.5">
                    <Pill tone="red">بصمة واحدة فقط (نسي الحضور أو الانصراف)</Pill>
                  </div>
                ) : row.unpaired ? (
                  <div className="mt-1.5">
                    <Pill tone="amber">آخر بصمة من غير انصراف</Pill>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmployeesTab({
  employees,
  insights,
  onSmart,
}: {
  employees: DrWaelEmployee[];
  insights: Map<string, DrWaelInsight>;
  onSmart: (employee: DrWaelEmployee) => void;
}) {
  if (!employees.length) return <Empty label="مفيش موظفين" />;
  return (
    <Section title="الموظفين" subtitle={`${employees.length} موظف · جدول آخر 7 أيام لحد النهارده`}>
      <DataTable head={['الموظف', 'الفرع', 'النوع', 'آخر 7 أيام', 'الحالة']}>
        {employees.map((employee) => {
          const tag = roleTag(employee);
          return (
            <tr key={employee.staff_id}>
              <Td>
                <div className="flex items-center gap-2">
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${TONES.violet}`}
                  >
                    {employee.name.trim().charAt(0)}
                  </span>
                  <div>
                    <button
                      type="button"
                      onClick={() => onSmart(employee)}
                      className="font-bold text-gray-900 hover:text-indigo-600 dark:text-slate-100"
                    >
                      {employee.name}
                    </button>
                    <div className={`text-[11px] ${MUTED}`}>{tag.label}</div>
                    {insightFlags(insights.get(employee.staff_id))}
                  </div>
                </div>
              </Td>
              <Td>{employee.branch}</Td>
              <Td>
                <Pill tone={employee.delivery ? 'green' : 'gray'}>
                  {employee.delivery ? 'توصيل' : 'عادي'}
                </Pill>
              </Td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  {employee.week.map((d) => (
                    <span
                      key={d.date}
                      title={`${weekday(d.date)} ${d.date}`}
                      className={`rounded-md px-1.5 py-0.5 text-[10px] leading-4 ${d.off || !d.scheduled ? TONES.gray : TONES.blue}`}
                    >
                      <b>{weekday(d.date).replace('ال', '').slice(0, 3)}</b>{' '}
                      {!d.scheduled ? '—' : d.off ? 'راحة' : `${hhmm(d.start)}–${hhmm(d.end)}`}
                    </span>
                  ))}
                </div>
              </td>
              <Td>
                <Pill tone={employee.active ? 'green' : 'gray'}>
                  {employee.active ? 'نشط' : 'غير نشط'}
                </Pill>
              </Td>
            </tr>
          );
        })}
      </DataTable>
    </Section>
  );
}

function AdjustmentsTab({
  data,
  employees,
  names,
}: {
  data: Data;
  employees: DrWaelEmployee[];
  names: Map<string, DrWaelEmployee>;
}) {
  const [view, setView] = useState<'incentives' | 'deductions' | 'movements'>('incentives');
  const ids = new Set(employees.map((e) => e.staff_id));
  const totals = employees.map((e) => ({ employee: e, money: employeeMoney(e.staff_id, data) }));
  const manual = data.manual_entries.filter((row) => ids.has(row.staff_id));
  const movements = data.movements.filter((row) => ids.has(row.staff_id));
  const total = (pick: (m: ReturnType<typeof employeeMoney>) => number) =>
    money(totals.reduce((sum, row) => sum + pick(row.money), 0));
  return (
    <div className="space-y-3">
      <Chips<'incentives' | 'deductions' | 'movements'>
        label="القسم"
        value={view}
        onChange={setView}
        options={[
          ['incentives', 'الحوافز'],
          ['deductions', 'السلف والخصومات'],
          ['movements', 'حركات الحوافز والجزاءات'],
        ]}
      />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Kpi label="الحوافز الآلية" value={total((m) => m.automatedIncentives)} tone="green" />
        <Kpi label="مكافآت بمبلغ" value={total((m) => m.rewards)} tone="green" />
        <Kpi label="جزاءات بمبلغ" value={total((m) => m.penalties)} tone="red" />
        <Kpi label="سلف وخصومات يدوية" value={total((m) => m.manualDeductions)} tone="red" />
      </div>
      {view === 'incentives' ? (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {totals.map(({ employee, money: m }) => (
            <div key={employee.staff_id} className={`${CARD} p-3`}>
              <div className="flex items-center justify-between">
                <span className="font-bold text-gray-900 dark:text-slate-100">{employee.name}</span>
                <Pill tone={m.automatedIncentives ? 'violet' : 'gray'}>
                  {m.automatedIncentives ? money(m.automatedIncentives) : 'بدون حافز'}
                </Pill>
              </div>
              <div className={`text-[11px] ${MUTED}`}>{employee.branch}</div>
              <div className="mt-2 grid grid-cols-3 gap-1.5 text-[11px]">
                {(
                  [
                    ['الأداء', m.performanceIncentive],
                    ['التارجت', m.targetBonus],
                    ['مكافآت', m.rewards],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className={`${SOFT} px-2 py-1`}>
                    <div className={MUTED}>{label}</div>
                    <b>{money(value)}</b>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : view === 'deductions' ? (
        manual.length ? (
          <DataTable head={['الموظف', 'النوع', 'البند', 'المبلغ', 'السبب', 'التاريخ']}>
            {manual.map((row) => (
              <tr key={row.id}>
                <Td className="font-bold">{names.get(row.staff_id)?.name || '—'}</Td>
                <Td>
                  <Pill tone={row.kind === 'earning' ? 'green' : 'red'}>
                    {row.kind === 'earning'
                      ? 'إضافة'
                      : row.kind === 'deduction'
                        ? 'خصم / سلفة'
                        : 'تسوية'}
                    {row.reversal_of ? ' (عكس قيد)' : ''}
                  </Pill>
                </Td>
                <Td>{row.category}</Td>
                <Td
                  className={`font-bold ${row.signed_amount < 0 ? 'text-rose-600' : 'text-emerald-600'}`}
                >
                  {money(row.signed_amount)}
                </Td>
                <Td>{row.reason || '—'}</Td>
                <Td>{row.created_at.slice(0, 10)}</Td>
              </tr>
            ))}
          </DataTable>
        ) : (
          <Empty label="مفيش سلف أو خصومات يدوية على مرتب الفترة دي" />
        )
      ) : movements.length ? (
        <DataTable head={['التاريخ', 'الموظف', 'النوع', 'السبب', 'المبلغ']}>
          {movements.map((row) => (
            <tr key={row.id}>
              <Td>{row.date}</Td>
              <Td className="font-bold">{names.get(row.staff_id)?.name || '—'}</Td>
              <Td>
                <Pill tone={row.type === 'reward' ? 'green' : 'red'}>
                  {row.type === 'reward' ? 'حافز' : 'جزاء'}
                </Pill>
              </Td>
              <td className="max-w-[260px] truncate px-3 py-2" title={row.reason || ''}>
                {row.reason || row.category || '—'}
              </td>
              <Td className="font-bold">{money(row.amount)}</Td>
            </tr>
          ))}
        </DataTable>
      ) : (
        <Empty label="مفيش حركات بمبلغ في الفترة دي" />
      )}
    </div>
  );
}

function LeavesTab({ data, employees }: { data: Data; employees: DrWaelEmployee[] }) {
  const cards = employees
    .map((employee) => ({
      employee,
      rows: data.time_off.filter((row) => row.staff_id === employee.staff_id),
    }))
    .filter((card) => card.rows.length);
  if (!cards.length) return <Empty label="مفيش إجازات أو أذونات في الفترة دي" />;
  const days = (start: string, end: string) =>
    Math.round((Date.parse(end) - Date.parse(start)) / 864e5) + 1;
  return (
    <Section title="الإجازات والأذونات" subtitle="الطلبات اللي بتلمس الفترة (من غير الملغية)">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map(({ employee, rows }) => {
          const approved = rows.filter((row) => row.status === 'approved');
          return (
            <div key={employee.staff_id} className={`${CARD} p-3`}>
              <div className="font-bold text-gray-900 dark:text-slate-100">{employee.name}</div>
              <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px]">
                <div className={`${SOFT} px-2 py-1`}>
                  <div className={MUTED}>أيام معتمدة</div>
                  <b className="text-sm">
                    {approved
                      .filter((row) => !row.minutes)
                      .reduce((sum, row) => sum + days(row.start_date, row.end_date), 0)}
                  </b>
                </div>
                <div className={`${SOFT} px-2 py-1`}>
                  <div className={MUTED}>في الانتظار</div>
                  <b className="text-sm">{rows.length - approved.length}</b>
                </div>
              </div>
              <ul className="mt-2 space-y-1 text-[11px]">
                {rows.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center gap-1">
                    <Pill tone={row.status === 'approved' ? 'green' : 'amber'}>
                      {row.label || TIME_OFF_KINDS[row.kind] || row.kind}
                    </Pill>
                    <span>
                      {row.start_date === row.end_date
                        ? row.start_date
                        : `${row.start_date} ← ${row.end_date}`}
                      {row.minutes ? ` · ${minutesLabel(row.minutes)}` : ''}
                    </span>
                    {row.status === 'approved' ? null : (
                      <span className={MUTED}>· في الانتظار</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function ReportsTab({ data, employees }: { data: Data; employees: DrWaelEmployee[] }) {
  if (!employees.length) return <Empty label="مفيش موظفين" />;
  return (
    <Section title="تقارير الموظفين" subtitle={`ملخص كل موظف في ${cycleLabel(data.month_cycle)}`}>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {employees.map((employee) => {
          const s = summarizeEmployee(employee.staff_id, data.days);
          const stats: Array<[string, string, Tone]> = [
            ['أيام شغل', String(s.workedDays), 'gray'],
            ['الساعات', hoursText(s.hours), 'gray'],
            ['ساعات المرتب', hoursText(s.payableHours), 'green'],
            ['تأخير', `${s.lateDays} يوم · ${minutesLabel(s.lateMinutes)}`, 'amber'],
            ['غياب', String(s.absentDays), 'red'],
            ['مراجعة', `${s.reviewDays} · بصمة واحدة ${s.singlePunchDays}`, 'violet'],
          ];
          return (
            <div key={employee.staff_id} className={`${CARD} p-3`}>
              <div className="flex items-center justify-between">
                <span className="font-bold text-gray-900 dark:text-slate-100">{employee.name}</span>
                <span className={`text-[11px] ${MUTED}`}>{employee.branch}</span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1.5 text-[11px]">
                {stats.map(([label, value, tone]) => (
                  <div key={label} className={`${SOFT} px-2 py-1`}>
                    <div className={MUTED}>{label}</div>
                    <b className={VALUE_TONES[tone]}>{value}</b>
                  </div>
                ))}
              </div>
              <div className={`mt-1.5 text-[11px] ${MUTED}`}>
                راحة {s.offDays} · إجازة / إذن {s.timeOffDays} · انصراف مبكر{' '}
                {minutesLabel(s.earlyLeaveMinutes)}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

type PayrollRow = {
  staffId: string;
  row: EmployeePayrollFinancialCompositionV2 | null;
  error: string | null;
};

function SalariesTab({ cycle, employees }: { cycle: string; employees: DrWaelEmployee[] }) {
  const [rows, setRows] = useState<PayrollRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const request = useRef(0);
  const active = useMemo(() => employees.filter((e) => e.active), [employees]);

  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    setRows(null);
    const result = await mapWithConcurrency(active, 3, async (e): Promise<PayrollRow> => {
      try {
        return {
          staffId: e.staff_id,
          row: await getEmployeePayrollFinancialComposition(e.staff_id, cycle),
          error: null,
        };
      } catch (err) {
        return {
          staffId: e.staff_id,
          row: null,
          error: err instanceof Error ? err.message : 'تعذر التحميل',
        };
      }
    });
    if (id === request.current) {
      setRows(result);
      setLoading(false);
    }
  }, [active, cycle]);

  useEffect(() => {
    void load();
  }, [load]);

  const byId = new Map(active.map((e) => [e.staff_id, e]));
  const ok = (rows || []).flatMap((r) => (r.row ? [r.row] : []));
  const sum = (pick: (row: EmployeePayrollFinancialCompositionV2) => number) =>
    money(ok.reduce((total, row) => total + Number(pick(row) || 0), 0));
  const incentives = (row: EmployeePayrollFinancialCompositionV2) =>
    row.earnings.automated_incentives_total + row.earnings.list_incentive;
  const additions = (row: EmployeePayrollFinancialCompositionV2) =>
    row.earnings.manual_other_incentives + row.adjustments.manual_adjustment;
  const failed = (rows || []).filter((r) => !r.row).length;
  const blocked = ok.filter((row) => row.blockers?.length).length;
  const picked = rows?.find((r) => r.staffId === selected)?.row || null;
  return (
    <div className="space-y-3">
      <div className={`${CARD} flex flex-wrap items-center justify-between gap-2 p-3`}>
        <div className="flex items-center gap-2">
          <span className={`rounded-xl p-2 ${TONES.violet}`}>
            <Wallet size={18} />
          </span>
          <div>
            <h2 className="font-bold text-gray-900 dark:text-slate-100">كشف الرواتب</h2>
            <p className={`text-[11px] ${MUTED}`}>
              {cycleLabel(cycle)} · من محرك المرتبات المعتمد (معاينة لحد ما الفترة تتقفل)
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold ${IDLE}`}
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> إعادة حساب
        </button>
      </div>
      {loading || !rows ? (
        <Spinner label="جارٍ حساب المرتبات من المحرك…" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
            <Kpi label="إجمالي الأساسي" value={sum((r) => r.earnings.base_salary)} />
            <Kpi label="الحوافز" value={sum(incentives)} tone="green" />
            <Kpi label="الأوفر تايم" value={sum((r) => r.earnings.approved_overtime)} tone="blue" />
            <Kpi label="إضافات وتسويات" value={sum(additions)} tone="blue" />
            <Kpi label="الخصومات" value={sum((r) => r.adjustments.deductions_total)} tone="red" />
            <Kpi label="صافي الإجمالي" value={sum((r) => r.display_net_salary)} tone="violet" />
          </div>
          {failed || blocked ? (
            <div className={`rounded-xl px-3 py-2 text-xs font-bold ${TONES.amber}`}>
              {blocked ? `${blocked} موظف لسه عنده حاجات بتمنع قفل المرتب. ` : ''}
              {failed ? `${failed} موظف ماتحسبش مرتبه.` : ''}
            </div>
          ) : null}
          {rows.length ? (
            <DataTable
              head={[
                'الموظف',
                'الفرع',
                'الأساسي',
                'الحوافز',
                'أوفر تايم',
                'إضافات',
                'الخصومات',
                'الصافي',
                'ملاحظات',
              ]}
            >
              {rows.map(({ staffId, row, error }) => (
                <tr
                  key={staffId}
                  className="cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800/60"
                  onClick={() => row && setSelected(staffId)}
                >
                  <Td className="font-bold text-indigo-600 dark:text-indigo-400">
                    {byId.get(staffId)?.name}
                  </Td>
                  <Td className={MUTED}>{byId.get(staffId)?.branch}</Td>
                  {row ? (
                    <>
                      <Td className="font-bold">{money(row.earnings.base_salary)}</Td>
                      <Td className="text-emerald-600">{money(incentives(row))}</Td>
                      <Td>{money(row.earnings.approved_overtime)}</Td>
                      <Td>{money(additions(row))}</Td>
                      <Td className="text-rose-600">-{money(row.adjustments.deductions_total)}</Td>
                      <Td className="font-bold text-violet-600 dark:text-violet-400">
                        {money(row.display_net_salary)}
                      </Td>
                      <Td>
                        <Pill tone={row.frozen ? 'green' : row.blockers?.length ? 'red' : 'gray'}>
                          {row.frozen
                            ? 'مقفول'
                            : row.blockers?.length
                              ? `${row.blockers.length} ناقص`
                              : 'معاينة'}
                        </Pill>
                      </Td>
                    </>
                  ) : (
                    <td colSpan={7} className="px-3 py-2 text-xs font-bold text-rose-600">
                      {error?.includes('not_authorized')
                        ? 'مفيش صلاحية مرتبات على الموظف ده'
                        : 'تعذر حساب المرتب'}
                    </td>
                  )}
                </tr>
              ))}
            </DataTable>
          ) : (
            <Empty label="مفيش موظفين نشطين" />
          )}
        </>
      )}
      <Sheet open={Boolean(picked)} onOpenChange={(next) => !next && setSelected(null)}>
        <SheetContent
          side="left"
          className="w-full overflow-y-auto bg-white text-gray-800 dark:bg-slate-950 dark:text-slate-200 sm:max-w-3xl"
          dir="rtl"
        >
          {picked && selected ? (
            <div className="space-y-4">
              <Payslip name={byId.get(selected)?.name || ''} cycle={cycle} row={picked} />
              <div>
                <h3 className="text-sm font-bold text-gray-900 dark:text-slate-100">
                  الكشف الكامل من تطبيق الإدارة
                </h3>
                <p className={`mb-2 text-[11px] ${MUTED}`}>
                  سعر الساعة والأوفر تايم، رصيد الإجازة السنوية، رصيد البصمة المنسية، الأذونات،
                  وللدليفري: دقايق الانضباط والأوردرات والمشاوير — نفس اللي في صفحة المرتبات.
                </p>
                <PayrollTransparencyPanel staffId={selected} monthCycle={cycle} />
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Payslip({
  name,
  cycle,
  row,
}: {
  name: string;
  cycle: string;
  row: EmployeePayrollFinancialCompositionV2;
}) {
  const lines: Array<[string, number]> = [
    ['الراتب الأساسي', row.earnings.base_salary],
    ['حافز الأداء', row.earnings.performance_incentive_included_in_automated_total],
    ['حافز التارجت', row.earnings.target_bonus_included_in_automated_total],
    [
      'حوافز آلية أخرى',
      row.earnings.automated_incentives_total -
        row.earnings.performance_incentive_included_in_automated_total -
        row.earnings.target_bonus_included_in_automated_total,
    ],
    ['حافز اللستة والرواكد', row.earnings.list_incentive],
    ['الأوفر تايم المعتمد', row.earnings.approved_overtime],
    ['حوافز يدوية', row.earnings.manual_other_incentives],
    ['تسويات', row.adjustments.manual_adjustment],
    ['خصم عجز / صلاحية', -row.adjustments.expiry_shortage_deduction],
    ['خصم عام على الفرع', -row.adjustments.branch_general_deduction],
    ['خصم فردي', -row.adjustments.individual_deduction],
    ['خصومات أخرى / سلف', -row.adjustments.other_deduction],
  ];
  return (
    <div className="space-y-3 text-sm">
      <SheetTitle className="text-lg font-bold text-gray-900 dark:text-slate-100">
        قسيمة مرتب · {name}
      </SheetTitle>
      <p className={`flex items-center gap-1 text-xs ${MUTED}`}>
        <CalendarDays size={13} /> {cycleLabel(cycle)}
      </p>
      <dl className="space-y-1.5">
        {lines
          .filter(([, value]) => Number(value || 0) !== 0)
          .map(([label, value]) => (
            <div key={label} className={`${SOFT} flex justify-between px-3 py-2 text-xs`}>
              <dt className="font-bold">{label}</dt>
              <dd className={`font-bold ${value < 0 ? 'text-rose-600' : ''}`}>{money(value)}</dd>
            </div>
          ))}
      </dl>
      <div
        className={`flex justify-between rounded-xl px-3 py-3 text-base font-bold ${TONES.violet}`}
      >
        <span>الصافي {row.frozen ? '(مقفول)' : '(معاينة)'}</span>
        <span>{money(row.display_net_salary)}</span>
      </div>
      {row.blockers?.length ? (
        <p className={`flex items-center gap-1 text-xs ${MUTED}`}>
          <Clock size={13} /> فيه {row.blockers.length} حاجة لسه بتمنع قفل المرتب (راجعها في صفحة
          المرتبات).
        </p>
      ) : null}
    </div>
  );
}
