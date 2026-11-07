import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  createContext,
  useContext,
} from 'react';
import {
  Archive,
  Bike,
  CalendarDays,
  Check,
  ChevronDown,
  Clock,
  Gauge,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { EmptyState } from '@/components/dashboard/DashboardPrimitives';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import {
  CREDIT_BAND_LABELS,
  DAY_KIND_LABELS,
  WEEK_DAYS,
  creditAlerts,
  dayCreditNote,
  deliveryCreditView,
  fetchDrWaelCreditLedger,
  fetchDrWaelShiftPatterns,
  fetchDrWaelOpenPunches,
  quickPlan,
  QUICK_SMALL_MINUTES,
  type QuickAction,
  type QuickGroup,
  type QuickItem,
  punchReadings,
  datesInPeriod,
  limitFingerprintsToStaff,
  matchesEmployeeSearch,
  shiftProfiles,
  type DrWaelCreditLedger,
  type DrWaelCreditRow,
  type DrWaelShiftSample,
  type ShiftProfile,
  type PunchReading,
  type DrWaelOpenPunches,
  addDays,
  applyDrWaelBranchChange,
  ALL_BRANCHES,
  applyDrWaelShiftChange,
  branchLabel,
  fetchDrWaelManualPunches,
  isOutsideEngine,
  manualPunchErrorText,
  manualPunchFallsNextDay,
  recordDrWaelManualPunch,
  summarizeManualPunches,
  type DrWaelManualPunch,
  type DrWaelManualPunches,
  type ManualPunchType,
  cairoTime,
  cycleLabel,
  decideQuickDay,
  quickDayOptions,
  type QuickDayDecision,
  dayKind,
  endDrWaelEmployment,
  endDrWaelLeave,
  employeeWorkMode,
  idleEmployees,
  isOpenEnded,
  setDrWaelWorkMode,
  WORK_MODE_LABELS,
  type DrWaelSeparationKind,
  type DrWaelWorkMode,
  runningLeaves,
  setDrWaelLeave,
  type DrWaelLeaveKind,
  type DrWaelTimeOff,
  employeeMoney,
  fetchDrWaelDayPunches,
  fetchDrWaelFingerprints,
  fetchDrWaelPayrollExtra,
  payrollStaff,
  type DrWaelPayrollStaff,
  fetchDrWaelSmartInsights,
  mapWithConcurrency,
  minutesLabel,
  openShifts,
  presentNow,
  type PresentNow,
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
import { getWildcardSearchHint } from '@/lib/appSearch';
import { useAuth } from '@/hooks/useAuth';
import { hasPermission } from '@/lib/core/permissionSystem';
import { cairoDayOf } from '@/lib/time/cairoDateBoundary';
import {
  decideStaffLifecycleChangeV2,
  listPendingStaffLifecycleChangesV2,
  type PendingStaffLifecycleChangeV2,
} from '@/lib/hr/staffLifecycleService';

const AttendanceResolutionCenter = lazy(
  () => import('@/components/attendance/AttendanceResolutionCenter')
);

// The look follows the Base44 fingerprint app (fingdawaa): white rounded cards on a light page, an
// indigo → violet accent, branch cards, employee cards with a days drawer and a compact payroll sheet.
// Every number is this app's own (شكري / الشامي / المخزن).

const TABS = [
  ['quick', 'قرارات سريعة'],
  ['dashboard', 'لوحة المعلومات'],
  ['attendance', 'الحضور والانصراف'],
  ['workday', 'يوم عمل'],
  ['employees', 'الموظفين'],
  ['credit', 'الكريديت'],
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

// What the punches say about the open days, and opening the shift editor on one date. Shared with the decision
// cards so the tabs in between do not have to carry them.
const ReadingContext = createContext<{
  readings: Map<string, PunchReading>;
  openAt: (employee: DrWaelEmployee, date: string) => void;
  today: string;
  reload: () => void;
}>({ readings: new Map(), openAt: () => undefined, today: '', reload: () => undefined });

export default function DrWaelFingerprints() {
  const canDecide = useDayReviewAccess();
  const [tab, setTab] = useState<Tab>(canDecide ? 'quick' : 'dashboard');
  const [cycle, setCycle] = useState<string | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [branch, setBranch] = useState<string>('الكل');
  const [insights, setInsights] = useState<Map<string, DrWaelInsight>>(new Map());
  const [smart, setSmart] = useState<DrWaelEmployee | null>(null);
  const [search, setSearch] = useState('');
  const [ledger, setLedger] = useState<DrWaelCreditLedger | null>(null);
  const [samples, setSamples] = useState<DrWaelShiftSample[]>([]);
  const [smartDate, setSmartDate] = useState<string | null>(null);
  const [openPunches, setOpenPunches] = useState<DrWaelOpenPunches | null>(null);
  const [manualPunches, setManualPunches] = useState<DrWaelManualPunches | null>(null);
  const [manualFailed, setManualFailed] = useState(false);
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
      // Both are extras on top of the page: if one fails the page still works without it.
      fetchDrWaelManualPunches(target)
        .then((next) => {
          if (id === request.current) {
            setManualPunches(next);
            setManualFailed(false);
          }
        })
        .catch(() => {
          if (id === request.current) {
            setManualPunches(null);
            setManualFailed(true);
          }
        });
      fetchDrWaelCreditLedger(target)
        .then((next) => {
          if (id === request.current) setLedger(next);
        })
        .catch(() => {
          if (id === request.current) setLedger(null);
        });
      fetchDrWaelShiftPatterns()
        .then((next) => {
          if (id === request.current) setSamples(next);
        })
        .catch(() => {
          if (id === request.current) setSamples([]);
        });
      fetchDrWaelOpenPunches()
        .then((next) => {
          if (id === request.current) setOpenPunches(next);
        })
        .catch(() => {
          if (id === request.current) setOpenPunches(null);
        });
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
  // One search box for every tab: «scoped» is the page data of the employees it finds.
  const found = useMemo(() => {
    if (!data || !search.trim()) return null;
    return new Set(
      data.employees.filter((e) => matchesEmployeeSearch(e.name, search)).map((e) => e.staff_id)
    );
  }, [data, search]);
  const scoped = useMemo(
    () => (data && found ? limitFingerprintsToStaff(data, found) : data),
    [data, found]
  );
  const employees = useMemo(
    () => (scoped?.employees || []).filter((e) => matches(branch, e.branch)),
    [scoped, branch]
  );
  // Salaries are heavy to compute, so that tab keeps its list and only hides rows while searching.
  const branchEmployees = useMemo(
    () => (data?.employees || []).filter((e) => matches(branch, e.branch)),
    [data, branch]
  );
  const credit = useMemo(
    () => new Map((ledger?.rows || []).map((row) => [row.staff_id, row])),
    [ledger]
  );
  const profiles = useMemo(
    () => (data ? shiftProfiles(samples, data.today) : new Map<string, ShiftProfile>()),
    [samples, data]
  );
  const readings = useMemo(
    () => punchReadings(openPunches, profiles, insights),
    [openPunches, profiles, insights]
  );
  const openSmart = useCallback((employee: DrWaelEmployee, date?: string) => {
    setSmart(employee);
    setSmartDate(date || null);
  }, []);
  const reading = useMemo(
    () => ({
      readings,
      openAt: openSmart,
      today: data?.today || '',
      reload: () => void load(cycle),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [readings, openSmart, data?.today, cycle]
  );

  if (loading && !data) return <Spinner label="جارٍ تحميل البصمات" />;
  if (!data || !scoped)
    return (
      <EmptyState label={error || 'تعذر تحميل البصمات'} error onRetry={() => void load(cycle)} />
    );

  const current = data.month_cycle;
  const isCurrent = data.today >= data.cycle_start && data.today <= data.cycle_end;
  return (
    <ReadingContext.Provider value={reading}>
      <div className="space-y-4 text-sm" dir="rtl" aria-busy={loading}>
        <ManualPunchPanel
          employees={data.employees}
          days={data.days}
          today={data.today}
          punches={manualPunches}
          failed={manualFailed}
          insights={insights}
          profiles={profiles}
          onSaved={() => void load(cycle)}
        />
        {tab === 'quick' ? (
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-2 px-1">
            <h1 className={`text-base font-black ${PAGE_HEADING}`}>
              قرارات البصمات{isCurrent ? '' : ` · ${cycleLabel(current)}`}
            </h1>
            <div className="flex items-center gap-2">
              {!isCurrent ? (
                <button
                  type="button"
                  onClick={() => setCycle(null)}
                  className={`rounded-lg px-2 py-1 text-xs font-bold ${IDLE}`}
                >
                  الفترة الحالية
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void load(cycle)}
                disabled={loading}
                aria-label="تحديث"
                className={`rounded-lg p-1.5 ${IDLE}`}
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              </button>
              <button
                type="button"
                onClick={() => setTab('dashboard')}
                className={`rounded-lg px-3 py-1 text-xs font-bold ${IDLE}`}
              >
                كل الأقسام
              </button>
            </div>
          </div>
        ) : (
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
              options={[['الكل', 'كل الفروع'], ...data.branches.map((b) => [b, branchLabel(b)] as const)]}
            />
            <label className="flex items-center gap-2 rounded-xl bg-gray-50 px-3 py-2 dark:bg-slate-800">
              <Search size={15} className="shrink-0 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="دور على موظف في كل الصفحات… مثال: احمد*نور"
                title={getWildcardSearchHint()}
                aria-label="بحث باسم الموظف في كل الصفحات"
                className="w-full bg-transparent text-xs text-gray-900 outline-none placeholder:text-gray-400 dark:text-slate-100"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="مسح البحث"
                  className="shrink-0 text-gray-400 hover:text-gray-700 dark:hover:text-slate-200"
                >
                  <X size={15} />
                </button>
              ) : null}
            </label>
          </div>
        )}
        {tab === 'quick' ? (
          <QuickDecisions
            days={data.days}
            today={data.today}
            readings={readings}
            names={new Map(data.employees.map((e) => [e.staff_id, e]))}
            credit={credit}
            missingLimit={ledger?.missing_limit ?? 2}
            olderCount={
              isCurrent
                ? (openPunches?.days || []).filter((d) => d.date < data.cycle_start).length
                : 0
            }
            onOlder={isCurrent ? () => setCycle(shiftCycle(current, -1)) : null}
            onReload={() => void load(cycle)}
          />
        ) : null}
        {found && tab !== 'quick' ? (
          <SearchResults
            employees={employees}
            ledger={ledger}
            credit={credit}
            profiles={profiles}
            onSmart={openSmart}
          />
        ) : null}
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
            data={scoped}
            branch={branch}
            names={names}
            insights={insights}
            onlyStaff={found}
            ledger={ledger}
            credit={credit}
            profiles={profiles}
            onSmart={openSmart}
            onDecisionSaved={() => void load(cycle)}
          />
        ) : null}
        {tab === 'attendance' ? (
          <AttendanceTab
            data={scoped}
            employees={employees}
            insights={insights}
            onSmart={openSmart}
            onDecisionSaved={() => void load(cycle)}
          />
        ) : null}
        {tab === 'workday' ? (
          <WorkDayTab
            data={scoped}
            branch={branch}
            names={names}
            onlyStaff={found}
            onDecisionSaved={() => void load(cycle)}
          />
        ) : null}
        {tab === 'employees' ? (
          <EmployeesTab
            employees={employees.filter((employee) => employee.active)}
            insights={insights}
            onSmart={openSmart}
          />
        ) : null}
        {tab === 'credit' ? (
          <CreditTab
            ledger={ledger}
            employees={employees}
            credit={credit}
            profiles={profiles}
            onSmart={openSmart}
          />
        ) : null}
        {tab === 'adjustments' ? (
          <AdjustmentsTab data={scoped} employees={employees} names={names} />
        ) : null}
        {tab === 'leaves' ? <LeavesTab data={scoped} employees={employees} /> : null}
        {tab === 'salaries' ? (
          <SalariesTab cycle={current} employees={branchEmployees} search={search} />
        ) : null}
        {tab === 'reports' ? <ReportsTab data={scoped} employees={employees} /> : null}
        <Sheet open={Boolean(smart)} onOpenChange={(next) => !next && setSmart(null)}>
          <SheetContent
            side="left"
            className="w-full overflow-y-auto bg-white text-gray-800 dark:bg-slate-950 dark:text-slate-200 sm:max-w-lg"
            dir="rtl"
          >
            {smart ? (
              <SmartEditor
                key={`${smart.staff_id}-${smartDate || ''}`}
                employee={smart}
                focusDate={smartDate}
                insight={insights.get(smart.staff_id)}
                today={data.today}
                branches={data.branches.filter((b) => b !== ALL_BRANCHES)}
                timeOff={data.time_off}
                ledger={ledger}
                credit={credit.get(smart.staff_id)}
                profile={profiles.get(smart.staff_id)}
                onSaved={() => void load(cycle)}
              />
            ) : null}
          </SheetContent>
        </Sheet>
      </div>
    </ReadingContext.Provider>
  );
}

// «البصمات اليدوية»: from a name to a saved punch in seconds, with what that employee already has this cycle.
function ManualPunchPanel({
  employees,
  days,
  today,
  punches,
  failed,
  insights,
  profiles,
  onSaved,
}: {
  employees: DrWaelEmployee[];
  days: DrWaelDay[];
  today: string;
  punches: DrWaelManualPunches | null;
  failed: boolean;
  insights: Map<string, DrWaelInsight>;
  profiles: Map<string, ShiftProfile>;
  onSaved: () => void;
}) {
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<DrWaelEmployee | null>(null);
  const rows = punches?.rows || [];
  const matching = search.trim()
    ? employees.filter((e) => e.active && matchesEmployeeSearch(e.name, search)).slice(0, 6)
    : [];
  return (
    <div className={`${CARD} space-y-2 p-3`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-black text-gray-900 dark:text-slate-100">البصمات اليدوية</h2>
        {punches ? <Pill>{rows.length} في الفترة دي</Pill> : null}
      </div>
      {failed ? (
        <p role="alert" className="text-[11px] font-bold text-rose-700 dark:text-rose-300">
          تعذر تحميل البصمات اليدوية.
        </p>
      ) : null}
      {picked ? null : (
        <label className="flex items-center gap-2 rounded-xl bg-gray-50 px-3 py-2 dark:bg-slate-800">
          <Search size={15} className="shrink-0 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="اكتب اسم الموظف…"
            aria-label="بحث باسم الموظف لتسجيل بصمة يدوية"
            className="w-full bg-transparent text-xs text-gray-900 outline-none placeholder:text-gray-400 dark:text-slate-100"
          />
        </label>
      )}
      {!picked && search.trim() && !matching.length ? (
        <p className={`text-[11px] ${MUTED}`}>مفيش موظف بالاسم ده.</p>
      ) : null}
      {picked ? null : (
        <div className="flex flex-wrap gap-1.5">
          {matching.map((employee) => (
            <button
              key={employee.staff_id}
              type="button"
              onClick={() => {
                setPicked(employee);
                setSearch('');
              }}
              className={`rounded-lg px-3 py-1 text-xs font-bold ${IDLE}`}
            >
              {employee.name} · {branchLabel(employee.branch)}
            </button>
          ))}
        </div>
      )}
      {picked ? (
        <ManualPunchEmployee
          key={picked.staff_id}
          employee={picked}
          days={days.filter((d) => d.staff_id === picked.staff_id)}
          today={today}
          rows={rows.filter((row) => row.staff_id === picked.staff_id)}
          loaded={Boolean(punches)}
          insight={insights.get(picked.staff_id)}
          profile={profiles.get(picked.staff_id)}
          onClose={() => setPicked(null)}
          onSaved={onSaved}
        />
      ) : null}
    </div>
  );
}

function ManualPunchEmployee({
  employee,
  days,
  today,
  rows,
  loaded,
  insight,
  profile,
  onClose,
  onSaved,
}: {
  employee: DrWaelEmployee;
  days: DrWaelDay[];
  today: string;
  rows: DrWaelManualPunch[];
  loaded: boolean;
  insight: DrWaelInsight | undefined;
  profile: ShiftProfile | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [type, setType] = useState<ManualPunchType>('check_in');
  const [date, setDate] = useState(today);
  const [time, setTime] = useState('');
  const [flipNextDay, setFlipNextDay] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const shift = employee.week.find((d) => d.date === date && d.scheduled && !d.off);
  const flexible = Boolean(employee.work_mode) || isOutsideEngine(employee);
  const day = days.find((d) => d.date === date);
  const autoNextDay = manualPunchFallsNextDay({
    type,
    time,
    firstIn: day?.first_in || null,
    shiftStart: flexible ? null : shift?.start || null,
    shiftEnd: flexible ? null : shift?.end || null,
  });
  const nextDay = flipNextDay ? !autoNextDay : autoNextDay;
  const shiftTime = hhmm((type === 'check_in' ? shift?.start : shift?.end) || null);
  const summary = summarizeManualPunches(rows);
  const input = `rounded-lg px-2 py-1 text-xs ${IDLE}`;

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const result = await recordDrWaelManualPunch({
        staffId: employee.staff_id,
        date,
        type,
        time,
        nextDay,
        note,
      });
      setSaved(
        `اتسجلت ${type === 'check_in' ? 'حضور' : 'انصراف'} ${time} · ${
          result.over_allowance
            ? `فوق السماح (رقم ${result.occurrence_no})`
            : `في السماح (${result.occurrence_no}/${result.allowance_limit})`
        }${result.day_status && result.day_status !== 'approved' ? ' · اليوم لسه محتاج قرار' : ''}`
      );
      setTime('');
      setNote('');
      setFlipNextDay(false);
      onSaved();
    } catch (e) {
      setError(manualPunchErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-gray-900 dark:text-slate-100">
          {employee.name} · <span className={`text-[11px] ${MUTED}`}>{branchLabel(employee.branch)}</span>
        </span>
        <button type="button" onClick={onClose} className={`text-[11px] underline ${MUTED}`}>
          موظف تاني
        </button>
      </div>
      {loaded ? (
        <div className="flex flex-wrap gap-1">
          <Pill>يدوية {summary.total}</Pill>
          <Pill tone="green">محتسب {summary.counted}</Pill>
          <Pill tone={summary.notCounted ? 'amber' : 'gray'}>لسه مش محتسب {summary.notCounted}</Pill>
          <Pill>في السماح {summary.insideAllowance}</Pill>
          <Pill tone={summary.overAllowance ? 'red' : 'gray'}>فوق السماح {summary.overAllowance}</Pill>
          {summary.outsideCount ? <Pill>من غير عداد سماح {summary.outsideCount}</Pill> : null}
          {summary.penalized ? <Pill tone="red">اتخصم {summary.penalized}</Pill> : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Chips<ManualPunchType>
          label="نوع البصمة"
          value={type}
          onChange={setType}
          options={[
            ['check_in', 'حضور'],
            ['check_out', 'انصراف'],
          ]}
        />
        <label className="flex items-center gap-1 text-xs">
          يوم
          <input
            type="date"
            value={date}
            max={today}
            min={addDays(today, -40)}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className={input}
          />
        </label>
        <label className="flex items-center gap-1 text-xs">
          الساعة
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            aria-label="ساعة البصمة"
            className={input}
          />
        </label>
        {shiftTime !== '—' && !flexible ? (
          <button
            type="button"
            onClick={() => setTime(shiftTime)}
            className={`rounded-lg px-2 py-1 text-[11px] font-bold ${IDLE}`}
          >
            ميعاد الشيفت {shiftTime}
          </button>
        ) : null}
      </div>
      {time ? (
        <label className="flex items-center gap-2 text-[11px]">
          <input
            type="checkbox"
            checked={nextDay}
            onChange={() => setFlipNextDay((value) => !value)}
          />
          الساعة دي صبح اليوم اللي بعده ({addDays(date, 1).slice(5)})
        </label>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="السبب (اختياري)"
          aria-label="سبب البصمة اليدوية"
          className={`min-w-0 flex-1 ${input}`}
        />
        <button
          type="button"
          disabled={busy || !time}
          onClick={() => void save()}
          className={`rounded-lg px-4 py-1.5 text-xs font-bold disabled:opacity-50 ${ACTIVE}`}
        >
          {busy ? 'جارٍ الحفظ…' : 'سجّل البصمة'}
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-[11px] font-bold text-rose-700 dark:text-rose-300">
          {error}
        </p>
      ) : null}
      {saved ? <p className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300">{saved}</p> : null}
      {rows.length ? (
        <ul className="space-y-1">
          {rows.slice(0, 5).map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-1 text-[11px]">
              <span className="font-bold">
                {row.date.slice(5)} · {row.type === 'check_in' ? 'حضور' : 'انصراف'} {cairoTime(row.at)}
              </span>
              <Pill tone={row.counted ? 'green' : 'amber'}>{row.counted ? 'محتسب' : 'لسه مش محتسب'}</Pill>
              {row.occurrence_no == null ? null : row.occurrence_no <= (row.allowance_limit ?? 2) ? (
                <Pill>في السماح</Pill>
              ) : (
                <Pill tone="red">{row.penalized ? 'فوق السماح · اتخصم' : 'فوق السماح'}</Pill>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <QuickShift employee={employee} today={today} insight={insight} profile={profile} onSaved={onSaved} />
    </div>
  );
}

// The shift as one decision: pick the hours and how long they last. Staff on the flexible schedule have no shift.
function QuickShift({
  employee,
  today,
  insight,
  profile,
  onSaved,
}: {
  employee: DrWaelEmployee;
  today: string;
  insight: DrWaelInsight | undefined;
  profile: ShiftProfile | undefined;
  onSaved: () => void;
}) {
  const current = employee.week.find((d) => d.date === today && d.scheduled && !d.off);
  const suggestion = insight?.shift || null;
  const [start, setStart] = useState(suggestion?.start || '');
  const [end, setEnd] = useState(suggestion?.end || '');
  const [from, setFrom] = useState(suggestion?.since || today);
  const [done, setDone] = useState<string | null>(null);
  const input = `rounded-lg px-2 py-1 text-xs ${IDLE}`;
  if (employee.work_mode || isOutsideEngine(employee))
    return (
      <p className={`border-t pt-2 text-[11px] dark:border-slate-700 ${MUTED}`}>
        على الجدول المرن: بيتحسب من أول لآخر بصمة، من غير شيفت محدد.
      </p>
    );
  const presets = (profile?.known || [])
    .filter((shift, i, all) => all.findIndex((x) => x.start === shift.start && x.end === shift.end) === i)
    .slice(0, 3);
  return (
    <div className="space-y-2 border-t pt-2 dark:border-slate-700">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-bold">
          الشيفت{current ? ` دلوقتي ${hhmm(current.start)}–${hhmm(current.end)}` : ''}
        </span>
        {presets.map((shift) => (
          <button
            key={`${shift.start}-${shift.end}`}
            type="button"
            dir="ltr"
            onClick={() => {
              setStart(shift.start);
              setEnd(shift.end);
            }}
            className={`rounded-lg px-2 py-1 text-[11px] font-bold ${IDLE}`}
          >
            {shift.start}–{shift.end}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1">
          من الساعة
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={input} />
        </label>
        <label className="flex items-center gap-1">
          لحد
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={input} />
        </label>
        <label className="flex items-center gap-1">
          ابتداءً من يوم
          <input
            type="date"
            value={from}
            min={addDays(today, -40)}
            max={addDays(today, 60)}
            onChange={(e) => e.target.value && setFrom(e.target.value)}
            className={input}
          />
        </label>
      </div>
      {start && end && start !== end ? (
        <ShiftScopePicker
          key={`${start}-${end}-${from}`}
          staffId={employee.staff_id}
          start={start}
          end={end}
          date={from}
          firstDate={from}
          label={`غيّر الشيفت لـ ${start}–${end}`}
          note="قرار سريع من البصمات اليدوية"
          onApplied={(text) => {
            setDone(text);
            onSaved();
          }}
        />
      ) : null}
      {done ? <p className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300">{done}</p> : null}
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
  timeOff,
  ledger,
  credit,
  profile,
  focusDate,
  onSaved,
}: {
  employee: DrWaelEmployee;
  focusDate: string | null;
  insight: DrWaelInsight | undefined;
  today: string;
  branches: string[];
  timeOff: DrWaelTimeOff[];
  ledger: DrWaelCreditLedger | null;
  credit: DrWaelCreditRow | undefined;
  profile: ShiftProfile | undefined;
  onSaved: () => void;
}) {
  const suggestion = insight?.shift || null;
  const current = employee.week.find((d) => d.date === today && d.scheduled && !d.off);
  const [start, setStart] = useState(
    suggestion?.start || hhmm(current?.start || null).replace('—', '')
  );
  const [end, setEnd] = useState(suggestion?.end || hhmm(current?.end || null).replace('—', ''));
  const firstDay = focusDate || today;
  const [mode, setMode] = useState<DrWaelShiftMode>('day');
  const [from, setFrom] = useState(firstDay);
  const [to, setTo] = useState(addDays(firstDay, 6));
  // Permanent starts where the punches changed; a day or a period starts from the day he is looking at.
  const chooseMode = (next: DrWaelShiftMode) => {
    setMode(next);
    setFrom(next === 'permanent' ? suggestion?.since || firstDay : firstDay);
    if (next === 'period') setTo(addDays(firstDay, 6));
  };
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
        days: mode === 'day' ? null : days,
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

      {ledger && credit ? <CreditCard row={credit} ledger={ledger} /> : null}
      {profile && !employee.work_mode ? (
        <ShiftUnderstanding employee={employee} profile={profile} onSaved={onSaved} />
      ) : null}

      <section className={`${CARD} space-y-3 p-3`}>
        <h3 className="flex items-center gap-1 font-bold text-gray-900 dark:text-slate-100">
          <Clock size={15} /> تعديل الشيفت
        </h3>
        {profile?.known.length ? (
          <div className="space-y-1">
            <div className={`text-[11px] ${MUTED}`}>شيفتاته المعروفة (اضغط تتملى تحت)</div>
            <div className="flex flex-wrap gap-1">
              {profile.known.map((shift) => (
                <button
                  key={`${shift.start}-${shift.end}`}
                  type="button"
                  aria-pressed={start === shift.start && end === shift.end}
                  onClick={() => {
                    setStart(shift.start);
                    setEnd(shift.end);
                  }}
                  className={`rounded-lg px-2 py-1 text-[11px] font-bold ${start === shift.start && end === shift.end ? ACTIVE : IDLE}`}
                >
                  {shift.start}–{shift.end} · {shift.days} يوم
                </button>
              ))}
            </div>
          </div>
        ) : null}
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
          onChange={chooseMode}
          options={[
            ['day', 'يوم واحد بس'],
            ['period', 'فترة من… لحد…'],
            ['permanent', 'باستمرار'],
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
                max={addDays(from, 62)}
                onChange={(e) => e.target.value && setTo(e.target.value)}
                className={input}
              />
            </label>
          ) : null}
        </div>
        {mode !== 'day' ? (
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
          {mode === 'period' ? ` هيتعدل ${datesInPeriod(from, to, days)} يوم في الفترة.` : ''}
          {mode === 'permanent'
            ? ' الميعاد ده هيفضل ماشي لحد ما تغيره، وممكن يغيّر التصنيف والمرتب.'
            : ''}
        </p>
        <button
          type="button"
          disabled={
            Boolean(busy) ||
            !start ||
            !end ||
            start === end ||
            (mode !== 'day' && !days.length) ||
            (mode === 'period' && (to < from || datesInPeriod(from, to, null) > 63))
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

      <WorkModePanel employee={employee} onSaved={onSaved} />
      <LeaveArchivePanel employee={employee} today={today} timeOff={timeOff} onSaved={onSaved} />
    </div>
  );
}

const WORK_MODE_HINTS: Record<DrWaelWorkMode, string> = {
  regular: 'شيفت ثابت؛ اليوم اللي مايبصمش فيه بيتحسب غياب.',
  part_time:
    'بيتحاسب على الأيام والساعات اللي حضرها فعلًا؛ اليوم اللي مايجيش فيه مش غياب ومش معلق.',
  joker: 'زي البارت تايم بالساعات الفعلية، وبصمته بتتحسب في أي فرع.',
};

// «نظام الشغل»: regular schedule, part-time or joker (both paid by actual hours).
function WorkModePanel({ employee, onSaved }: { employee: DrWaelEmployee; onSaved: () => void }) {
  const [mode, setMode] = useState<DrWaelWorkMode | null>(employeeWorkMode(employee));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: Tone; text: string } | null>(null);
  const choose = async (next: DrWaelWorkMode) => {
    if (next === mode || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await setDrWaelWorkMode(employee.staff_id, next);
      setMode(next);
      setMessage({
        tone: 'green',
        text: `بقى ${WORK_MODE_LABELS[next]} · اتعاد حساب ${result.days_rebuilt} يوم من أول الشهر`,
      });
      onSaved();
    } catch (e) {
      const text = e instanceof Error ? e.message : '';
      setMessage({
        tone: 'red',
        text: text.includes('not_authorized') ? 'مفيش صلاحية' : 'ماتسجلش، حاول تاني',
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={`${CARD} space-y-2 p-3`}>
      <h3 className="flex items-center gap-1 font-bold text-gray-900 dark:text-slate-100">
        <Clock size={15} /> نظام الشغل
      </h3>
      {message ? (
        <div
          role="status"
          className={`rounded-xl px-3 py-2 text-xs font-bold ${TONES[message.tone]}`}
        >
          {message.text}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(WORK_MODE_LABELS) as DrWaelWorkMode[]).map((value) => (
          <button
            key={value}
            type="button"
            disabled={busy}
            aria-pressed={mode === value}
            onClick={() => void choose(value)}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-50 ${mode === value ? ACTIVE : IDLE}`}
          >
            {WORK_MODE_LABELS[value]}
          </button>
        ))}
      </div>
      <p className={`text-[11px] ${MUTED}`}>
        {mode ? WORK_MODE_HINTS[mode] : 'مسجل بساعات مرنة (بالساعات الفعلية) من مكان تاني.'}
      </p>
    </section>
  );
}

const LEAVE_KINDS: Array<[DrWaelLeaveKind, string]> = [
  ['approved_absence', 'إجازة بإذن الإدارة'],
  ['annual_leave', 'اعتيادية'],
  ['sick_leave', 'مرضي'],
  ['exceptional_leave', 'استثنائية'],
];
const SEPARATION_KINDS: Array<[DrWaelSeparationKind, string]> = [
  ['resignation', 'استقالة'],
  ['termination', 'إنهاء خدمة'],
  ['contract_end', 'انتهاء عقد'],
  ['other', 'سبب آخر'],
];

function leaveError(text: string): string {
  if (text.includes('cannot_end_viewer')) return 'ماينفعش تعمل ترك عمل لحد من مديري الصفحة';
  if (text.includes('later_lifecycle_change_exists'))
    return 'فيه قرار متسجل للموظف ده بعد اليوم ده؛ راجعه من الموارد البشرية';
  if (text.includes('invalid_last_day')) return 'آخر يوم لازم يكون من آخر 4 شهور لحد شهرين قدام';
  if (text.includes('requester_cannot_approve_own'))
    return 'لازم المدير التاني هو اللي يعتمد الأرشفة';
  if (text.includes('not_authorized')) return 'مفيش صلاحية';
  if (text.includes('pending_staff_lifecycle_change_already_exists'))
    return 'فيه طلب أرشفة مفتوح للموظف ده بالفعل';
  if (text.includes('annual_leave_cancel_and_reenter'))
    return 'الإجازة الاعتيادية ماتتقصرش من هنا؛ الغيها من الإجازات واعمل واحدة بالمدة الصح';
  if (text.includes('preflight_blocked'))
    return 'سياسة الإجازات رفضت الطلب (غالبًا الرصيد مايكفيش)';
  if (text.includes('out_of_range')) return 'التاريخ بعيد قوي؛ الفترة لحد 3 شهور ومن آخر 40 يوم';
  return 'ماتسجلش، راجع البيانات وحاول تاني';
}

const endEmploymentText = (
  name: string,
  result: { last_day: string; archived: boolean; days_closed: number }
) =>
  `${name}: ترك عمل بعد ${result.last_day}` +
  (result.archived ? ' · اتشال من الحضور' : ' · هيتشال من الحضور بعد آخر يوم') +
  (result.days_closed ? ` · اتقفل ${result.days_closed} يوم معلق` : '');

// Leave for a period, «رجع للشغل» on a running leave, and «ترك عمل» in one tap (an old two-step archive request
// still shows here to approve or cancel).
function LeaveArchivePanel({
  employee,
  today,
  timeOff,
  onSaved,
}: {
  employee: DrWaelEmployee;
  today: string;
  timeOff: DrWaelTimeOff[];
  onSaved: () => void;
}) {
  const running = runningLeaves(timeOff, employee.staff_id, today);
  const [returnDate, setReturnDate] = useState(today);
  const [kind, setKind] = useState<DrWaelLeaveKind>('approved_absence');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDays(today, 6));
  const [reason, setReason] = useState('');
  const [lastDay, setLastDay] = useState(() => {
    const last = employee.last_punch ? cairoDayOf(employee.last_punch) : null;
    return last && last < today ? last : today;
  });
  const [separation, setSeparation] = useState<DrWaelSeparationKind>('resignation');
  const [archiveReason, setArchiveReason] = useState('');
  const [pending, setPending] = useState<PendingStaffLifecycleChangeV2[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: Tone; text: string } | null>(null);

  const loadPending = useCallback(async () => {
    try {
      const rows = await listPendingStaffLifecycleChangesV2();
      setPending(rows.filter((row) => row.staff_id === employee.staff_id));
    } catch {
      setPending([]);
    }
  }, [employee.staff_id]);
  useEffect(() => {
    void loadPending();
  }, [loadPending]);

  const run = async (key: string, action: () => Promise<string>) => {
    setBusy(key);
    setMessage(null);
    try {
      setMessage({ tone: 'green', text: await action() });
      onSaved();
      void loadPending();
    } catch (e) {
      setMessage({ tone: 'red', text: leaveError(e instanceof Error ? e.message : '') });
    } finally {
      setBusy(null);
    }
  };

  const input = `rounded-lg px-2 py-1 text-xs ${IDLE}`;
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;
  return (
    <section className={`${CARD} space-y-3 p-3`}>
      <h3 className="flex items-center gap-1 font-bold text-gray-900 dark:text-slate-100">
        <CalendarDays size={15} /> إجازة أو ترك عمل
      </h3>
      {message ? (
        <div
          role="status"
          className={`rounded-xl px-3 py-2 text-xs font-bold ${TONES[message.tone]}`}
        >
          {message.text}
        </div>
      ) : null}

      {running.map((leave) => (
        <div key={leave.id} className={`space-y-2 rounded-xl px-3 py-2 text-xs ${TONES.blue}`}>
          <div>
            <b>{leave.label || TIME_OFF_KINDS[leave.kind] || leave.kind}</b> من {leave.start_date}{' '}
            {isOpenEnded(leave.end_date) ? 'ولسه مفتوحة (لحد ما يرجع)' : `لحد ${leave.end_date}`}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1">
              رجع للشغل يوم
              <input
                type="date"
                value={returnDate}
                min={addDays(today, -40)}
                onChange={(e) => e.target.value && setReturnDate(e.target.value)}
                className={input}
              />
            </label>
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() =>
                void run(`end:${leave.id}`, async () => {
                  const result = await endDrWaelLeave(leave.id, returnDate);
                  return result.cancelled
                    ? 'الإجازة اتلغت (رجع قبل ما تبدأ)'
                    : `الإجازة خلصت يوم ${addDays(returnDate, -1)} · اتعاد حساب ${result.days_rebuilt} يوم من البصمات`;
                })
              }
              className={`rounded-lg px-3 py-1.5 font-bold disabled:opacity-50 ${ACTIVE}`}
            >
              {busy === `end:${leave.id}` ? 'جارٍ الحفظ…' : 'إنهاء الإجازة'}
            </button>
          </div>
        </div>
      ))}

      <div className="space-y-2">
        <div className="text-xs font-bold">إجازة لفترة</div>
        <Chips<DrWaelLeaveKind>
          label="النوع"
          value={kind}
          onChange={setKind}
          options={LEAVE_KINDS}
        />
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1">
            من
            <input
              type="date"
              value={from}
              min={addDays(today, -40)}
              onChange={(e) => {
                const next = e.target.value;
                if (!next) return;
                setFrom(next);
                if (to < next) setTo(next);
              }}
              className={input}
            />
          </label>
          <label className="flex items-center gap-1">
            لحد
            <input
              type="date"
              value={to}
              min={from}
              onChange={(e) => e.target.value && setTo(e.target.value)}
              className={input}
            />
          </label>
          <span className={MUTED}>{days > 0 ? `${days} يوم` : ''}</span>
        </div>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="السبب (اختياري)"
          className={`w-full ${input}`}
        />
        <button
          type="button"
          disabled={Boolean(busy) || !from || !to || to < from || days > 93}
          onClick={() =>
            void run('leave', async () => {
              await setDrWaelLeave({ staffId: employee.staff_id, kind, from, to, reason });
              return `اتسجلت ${LEAVE_KINDS.find(([k]) => k === kind)?.[1] || 'الإجازة'} من ${from} لحد ${to}`;
            })
          }
          className={`w-full rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-50 ${ACTIVE}`}
        >
          {busy === 'leave' ? 'جارٍ الحفظ…' : 'سجّل الإجازة'}
        </button>
      </div>

      <div className="space-y-2 border-t border-gray-100 pt-3 dark:border-slate-800">
        <div className="flex items-center gap-1 text-xs font-bold">
          <Archive size={14} /> ترك عمل
        </div>
        {pending.length ? (
          pending.map((row) => (
            <div key={row.id} className={`space-y-2 rounded-xl px-3 py-2 text-xs ${TONES.amber}`}>
              <div>
                طلب أرشفة — آخر يوم شغل {row.last_working_date || row.effective_from}
                {row.requested_by_name ? ` · طلبه ${row.requested_by_name}` : ''}
                <span className="block opacity-80">{row.reason}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void run('approve', async () => {
                      await decideStaffLifecycleChangeV2(row.id, 'approve');
                      return 'اتعتمدت الأرشفة';
                    })
                  }
                  className={`rounded-lg px-3 py-1.5 font-bold disabled:opacity-50 ${ACTIVE}`}
                >
                  اعتمد الأرشفة
                </button>
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void run('cancel', async () => {
                      await decideStaffLifecycleChangeV2(row.id, 'cancel', 'اتلغى من بصمات د وائل');
                      return 'اتلغى طلب الأرشفة';
                    })
                  }
                  className={`rounded-lg px-3 py-1.5 font-bold disabled:opacity-50 ${IDLE}`}
                >
                  الغِ الطلب
                </button>
              </div>
            </div>
          ))
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <label className="flex items-center gap-1">
                آخر يوم شغل
                <input
                  type="date"
                  value={lastDay}
                  min={addDays(today, -120)}
                  max={addDays(today, 60)}
                  onChange={(e) => e.target.value && setLastDay(e.target.value)}
                  className={input}
                />
              </label>
              <select
                value={separation}
                onChange={(e) => setSeparation(e.target.value as DrWaelSeparationKind)}
                className={input}
                aria-label="سبب الخروج"
              >
                {SEPARATION_KINDS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <input
              value={archiveReason}
              onChange={(e) => setArchiveReason(e.target.value)}
              placeholder="ملاحظة (اختياري)"
              className={`w-full ${input}`}
            />
            <p className={`text-[11px] ${MUTED}`}>
              بيتنفذ على طول: الحضور والمرتب لحد آخر يوم بيفضلوا ويظهروا في مرتبات الشهر، والأيام
              الفاضية بعده بتتقفل «خارج الخدمة» من غير خصم ومش هتظهر معلقة تاني.
              {employee.last_punch ? ` آخر بصمة: ${cairoDayOf(employee.last_punch)}.` : ''}
            </p>
            <button
              type="button"
              disabled={Boolean(busy) || !lastDay}
              onClick={() => {
                if (!window.confirm(`${employee.name} ساب الشغل — آخر يوم ${lastDay}؟`)) return;
                void run('archive', async () => {
                  const result = await endDrWaelEmployment({
                    staffId: employee.staff_id,
                    lastDay,
                    kind: separation,
                    note: archiveReason.trim() || null,
                  });
                  return endEmploymentText(employee.name, result);
                });
              }}
              className="w-full rounded-xl bg-rose-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              {busy === 'archive' ? 'جارٍ الحفظ…' : 'ترك عمل'}
            </button>
          </>
        )}
      </div>
    </section>
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

// «موظفين مش بيحضروا»: «موقوف» or no punch for 5 days and more — close with «ترك عمل» (last day = last punch)
// or open the card to set a leave, part-time or joker.
function IdleStaffPanel({
  data,
  employees,
  onSmart,
  onSaved,
}: {
  data: Data;
  employees: DrWaelEmployee[];
  onSmart: (employee: DrWaelEmployee) => void;
  onSaved: () => void;
}) {
  const rows = idleEmployees(employees, data.time_off, data.today);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: Tone; text: string } | null>(null);
  if (!rows.length && !message) return null;
  const end = async (employee: DrWaelEmployee, lastDay: string) => {
    if (!window.confirm(`${employee.name} ساب الشغل — آخر يوم ${lastDay}؟`)) return;
    setBusy(employee.staff_id);
    setMessage(null);
    try {
      const result = await endDrWaelEmployment({
        staffId: employee.staff_id,
        lastDay,
        kind: 'resignation',
      });
      setMessage({ tone: 'green', text: endEmploymentText(employee.name, result) });
      onSaved();
    } catch (e) {
      setMessage({ tone: 'red', text: leaveError(e instanceof Error ? e.message : '') });
    } finally {
      setBusy(null);
    }
  };
  return (
    <Section
      title="موظفين مش بيحضروا"
      subtitle="موقوف أو مابصمش من 5 أيام وأكتر · ترك العمل بيشيله من الحضور ويفضل في مرتبات الشهر"
    >
      {message ? (
        <div
          role="status"
          className={`mb-2 rounded-xl px-3 py-2 text-xs font-bold ${TONES[message.tone]}`}
        >
          {message.text}
        </div>
      ) : null}
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {rows.map(({ employee, lastPunchDay, daysAway, stopped }) => {
          const lastDay = lastPunchDay && lastPunchDay < data.today ? lastPunchDay : data.today;
          return (
            <div key={employee.staff_id} className={`${CARD} space-y-2 p-3`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-gray-900 dark:text-slate-100">{employee.name}</span>
                <span className={`text-[11px] ${MUTED}`}>{employee.branch}</span>
              </div>
              <div className="flex flex-wrap gap-1 text-[11px]">
                {stopped ? <Pill tone="red">موقوف</Pill> : null}
                <Pill tone="amber">
                  {lastPunchDay ? `آخر بصمة ${lastPunchDay} · من ${daysAway} يوم` : 'مابصمش خالص'}
                </Pill>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void end(employee, lastDay)}
                  className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                >
                  {busy === employee.staff_id ? 'جارٍ الحفظ…' : `ترك عمل (آخر يوم ${lastDay})`}
                </button>
                <button
                  type="button"
                  onClick={() => onSmart(employee)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold ${IDLE}`}
                >
                  إجازة / بارت تايم / جوكر
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

const BAND_TONE = { committed: 'green', regular: 'amber', low: 'red' } as const;

const shiftFixError = (e: unknown) => {
  const text = e instanceof Error ? e.message : '';
  if (text.includes('not_authorized')) return 'مفيش صلاحية';
  if (text.includes('date_out_of_range')) return 'اليوم أقدم من 40 يوم';
  return 'ماتسجلش، حاول تاني';
};

// One employee's credit: delivery discipline minutes (the numbers payroll uses) and the missing-punch allowance.
function CreditCard({ row, ledger }: { row: DrWaelCreditRow; ledger: DrWaelCreditLedger }) {
  const taken = row.missing_used + row.missing_open;
  const delivery = row.delivery;
  const view = delivery ? deliveryCreditView(delivery, ledger.today, ledger.cycle_end) : null;
  return (
    <section className={`${CARD} space-y-3 p-3`}>
      <h3 className="flex items-center gap-1 font-bold text-gray-900 dark:text-slate-100">
        <Gauge size={15} /> الكريديت في الفترة دي
      </h3>
      <div className={`${SOFT} space-y-1 px-3 py-2 text-xs`}>
        <div className="flex items-center justify-between gap-2">
          <b>سماح نسيان البصمة</b>
          <Pill
            tone={
              taken > ledger.missing_limit
                ? 'red'
                : taken === ledger.missing_limit
                  ? 'amber'
                  : 'green'
            }
          >
            {row.missing_used} من {ledger.missing_limit}
          </Pill>
        </div>
        {row.missing_open ? (
          <div className={MUTED}>و{row.missing_open} يوم بصمة ناقصة لسه مستني قرار</div>
        ) : null}
        {row.missing_penalized ? (
          <div className="font-bold text-rose-600 dark:text-rose-400">
            {row.missing_penalized} مرة اتخصم عليها {ledger.missing_penalty} ج
          </div>
        ) : null}
      </div>
      {delivery && view ? (
        <div className={`${SOFT} space-y-2 px-3 py-2 text-xs`}>
          <div className="flex items-center justify-between gap-2">
            <b className="flex items-center gap-1">
              <Bike size={13} /> دقايق الدليفري
            </b>
            <Pill tone={BAND_TONE[view.band]}>
              {view.final ? delivery.band_ar : `لحد دلوقتي: ${CREDIT_BAND_LABELS[view.band]}`}
            </Pill>
          </div>
          <div className="grid grid-cols-3 gap-1.5 text-center text-[11px]">
            <div>
              <div className={MUTED}>المستخدم</div>
              <b className="text-sm">{delivery.minutes} د</b>
            </div>
            <div>
              <div className={MUTED}>كريديت ملتزم</div>
              <b className="text-sm">{delivery.committed_credit} د</b>
            </div>
            <div>
              <div className={MUTED}>كريديت عادي</div>
              <b className="text-sm">{delivery.regular_credit} د</b>
            </div>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-slate-700">
            <div
              className={`h-full rounded-full ${view.band === 'committed' ? 'bg-emerald-500' : view.band === 'regular' ? 'bg-amber-500' : 'bg-rose-500'}`}
              style={{
                width: `${Math.min(100, delivery.regular_credit ? (delivery.minutes / delivery.regular_credit) * 100 : 100)}%`,
              }}
            />
          </div>
          <div className={MUTED}>
            حضور {delivery.attended_days} يوم معتمد
            {delivery.pending_days ? ` + ${delivery.pending_days} مستني قرار` : ''} من{' '}
            {delivery.minimum_days} · الكريديت {delivery.committed_per_day} د ملتزم و
            {delivery.regular_per_day} د عادي لكل يوم حضور
          </div>
          {delivery.excused_minutes ? (
            <div className={MUTED}>{delivery.excused_minutes} د اتشالوا بإذن معتمد</div>
          ) : null}
          {!view.canReachMinimum ? (
            <div className="font-bold text-rose-600 dark:text-rose-400">
              أقصى حضور ممكن {view.reachableDays} يوم، أقل من {delivery.minimum_days}
            </div>
          ) : null}
          {view.bestBand !== 'committed' ? (
            <div className="font-bold text-amber-700 dark:text-amber-300">
              أحسن تصنيف ممكن دلوقتي: {CREDIT_BAND_LABELS[view.bestBand]} حتى لو حضر كل الباقي
            </div>
          ) : null}
          {delivery.days.length ? (
            <details>
              <summary className="cursor-pointer font-bold text-indigo-600 dark:text-indigo-400">
                الأيام اللي سحبت من الكريديت ({delivery.days.length})
              </summary>
              <ul className="mt-1 space-y-0.5">
                {delivery.days.map((day) => (
                  <li key={day.date} className="flex justify-between gap-2">
                    <span>
                      {weekday(day.date)} {day.date.slice(5)}
                    </span>
                    <span className={day.exempt ? MUTED : 'font-bold'}>
                      {day.late ? `تأخير ${day.late}` : ''}
                      {day.late && day.early ? ' · ' : ''}
                      {day.early ? `بدري ${day.early}` : ''}
                      {day.exempt ? ' (بإذن)' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

// A correction asks how far it goes: one day, a period, or from now on. For a weekday, each of those is that weekday.
function ShiftScopePicker({
  staffId,
  start,
  end,
  date,
  weekDay,
  firstDate,
  label,
  note,
  onApplied,
}: {
  staffId: string;
  start: string;
  end: string;
  /** The day a «one day» correction lands on. */
  date: string;
  weekDay?: string;
  /** Where «from now on» starts, the first day the punches show it. */
  firstDate?: string;
  label: string;
  note: string;
  onApplied: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<DrWaelShiftMode>('day');
  // For a weekday the period starts on the days the punches already show.
  const [from, setFrom] = useState(weekDay ? firstDate || date : date);
  const [to, setTo] = useState(weekDay ? date : addDays(date, 6));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const weekDays = weekDay ? [weekDay] : null;
  const name = weekDay ? weekDay.replace(/^ال/, '') : '';
  const input = `rounded-lg px-2 py-1 text-xs ${IDLE}`;
  const count = datesInPeriod(from, to, weekDays);
  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const startFrom = mode === 'day' ? date : mode === 'period' ? from : firstDate || date;
      const result = await applyDrWaelShiftChange({
        staffId,
        start,
        end,
        mode,
        from: startFrom,
        to: mode === 'period' ? to : null,
        days: mode === 'day' ? null : weekDays,
        note,
      });
      onApplied(
        `بقى ${start}–${end} · اتعاد حساب ${result.days_rebuilt} يوم${result.days_kept_manager_approved ? ` · ${result.days_kept_manager_approved} يوم معتمد من مدير ماتغيرش` : ''}`
      );
      setOpen(false);
    } catch (e) {
      const text = e instanceof Error ? e.message : '';
      setError(text.includes('period') ? 'الفترة لازم تكون من يوم لحد 62 يوم' : shiftFixError(e));
    } finally {
      setBusy(false);
    }
  };
  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`rounded-lg px-3 py-1 text-[11px] font-bold ${ACTIVE}`}
      >
        {label}
      </button>
    );
  return (
    <div className="w-full space-y-2 rounded-xl border border-violet-200 p-2 dark:border-violet-500/30">
      <Chips<DrWaelShiftMode>
        label="التعديل لمدة إيه؟"
        value={mode}
        onChange={setMode}
        options={[
          ['day', `يوم ${date.slice(5)} بس`],
          ['period', weekDay ? `كل ${name} في فترة` : 'فترة من… لحد…'],
          ['permanent', weekDay ? `كل ${name} باستمرار` : 'باستمرار'],
        ]}
      />
      {mode === 'period' ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1">
            من
            <input
              type="date"
              value={from}
              onChange={(e) => e.target.value && setFrom(e.target.value)}
              className={input}
            />
          </label>
          <label className="flex items-center gap-1">
            لحد
            <input
              type="date"
              value={to}
              min={from}
              max={addDays(from, 62)}
              onChange={(e) => e.target.value && setTo(e.target.value)}
              className={input}
            />
          </label>
          <span className={MUTED}>{count} يوم</span>
        </div>
      ) : null}
      {mode === 'permanent' ? (
        <p className="text-[11px] font-bold text-amber-700 dark:text-amber-300">
          الجدول هيتغير من {firstDate || date} ولحد ما تغيره، والأيام اللي فاتت هيتعاد حسابها وممكن
          التصنيف والمرتب يتغيروا.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-[11px] font-bold text-rose-700 dark:text-rose-300">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy || (mode === 'period' && !count)}
          onClick={() => void apply()}
          className={`rounded-lg px-3 py-1 text-[11px] font-bold disabled:opacity-50 ${ACTIVE}`}
        >
          {busy ? 'جارٍ الحفظ…' : `طبّق ${start}–${end}`}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setOpen(false)}
          className={`text-[11px] underline ${MUTED}`}
        >
          إلغاء
        </button>
      </div>
    </div>
  );
}

// The decision card's reading: which of his shifts these punches are, and what the day would be on it.
function PunchReadingNote({ day }: { day: DrWaelDay }) {
  const { readings, reload } = useContext(ReadingContext);
  const [applied, setApplied] = useState<string | null>(null);
  const reading = readings.get(`${day.staff_id}-${day.date}`);
  if (!reading) return null;
  if (applied)
    return (
      <div className={`rounded-lg px-2 py-1 text-[11px] font-bold ${TONES.green}`}>{applied}</div>
    );
  const clock = (at: string | null) => (at ? at.slice(11) : 'ناقصة');
  const minutes = reading.late + reading.early;
  return (
    <div className="space-y-1 rounded-lg bg-violet-50 px-2 py-1.5 text-[11px] text-violet-900 dark:bg-violet-500/10 dark:text-violet-200">
      <div className="flex items-center gap-1 font-bold">
        <Sparkles size={12} /> البصمة بتقول شيفت {reading.start}–{reading.end}
        <span className="font-normal">
          ·{' '}
          {reading.source === 'suggested'
            ? 'الشيفت المقترح ليه'
            : reading.source === 'known'
              ? 'من شيفتاته المعروفة'
              : 'من البصمة بس، مش من شيفتاته'}
        </span>
      </div>
      <div>
        حضور {clock(reading.inAt)} · انصراف {clock(reading.outAt)}
        {reading.source !== 'punches'
          ? ` · على الشيفت ده ${minutes ? `${minutesLabel(minutes)} تأخير/انصراف` : 'مظبوط'}`
          : ''}
        {reading.nowMinutes ? ` (دلوقتي ${minutesLabel(reading.nowMinutes)})` : ''}
      </div>
      {reading.source === 'punches' ? (
        <div className="font-bold text-amber-700 dark:text-amber-300">
          اتأكد إنه مش تأخير أو خروج بدري قبل ما تعتبره شيفت.
        </div>
      ) : null}
      <ShiftScopePicker
        staffId={day.staff_id}
        start={reading.start}
        end={reading.end}
        date={reading.date}
        label="اقراها على الشيفت ده"
        note="قراءة البصمة على شيفت الموظف"
        onApplied={(text) => {
          setApplied(text);
          reload();
        }}
      />
    </div>
  );
}

// What the punches say about how this employee really works, with one-click corrections.
function ShiftUnderstanding({
  employee,
  profile,
  onSaved,
}: {
  employee: DrWaelEmployee;
  profile: ShiftProfile;
  onSaved: () => void;
}) {
  const [message, setMessage] = useState<{ tone: Tone; text: string } | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const applied = (key: string, text: string) => {
    setDone((list) => [...list, key]);
    setMessage({ tone: 'green', text });
    onSaved();
  };
  const days = profile.mismatches.filter((m) => !done.includes(m.sample.date));
  const weekly = profile.weekly.filter((p) => !done.includes(p.day));
  if (!profile.rotating && !days.length && !weekly.length && !message) return null;
  return (
    <section className={`${CARD} space-y-2 p-3`}>
      <h3 className="flex items-center gap-1 font-bold text-gray-900 dark:text-slate-100">
        <Sparkles size={15} /> فهم الشيفتات المتغيرة
      </h3>
      <p className={`text-[11px] ${MUTED}`}>
        {profile.rotating ? `بيتناوب على ${profile.known.length} شيفتات حسب بصمة آخر 45 يوم. ` : ''}
        التصحيح قرارك: ولا يوم بيتغير لوحده، واليوم اللي اعتمده مدير مش بيتعرض هنا.
      </p>
      {message ? (
        <div
          role="status"
          className={`rounded-xl px-3 py-2 text-xs font-bold ${TONES[message.tone]}`}
        >
          {message.text}
        </div>
      ) : null}
      {weekly.map((pattern) => (
        <div key={pattern.day} className={`${SOFT} space-y-1 px-3 py-2 text-xs`}>
          <div>
            كل <b>{pattern.day.replace(/^ال/, '')}</b> بيشتغل تقريبًا{' '}
            <b>
              {pattern.start}–{pattern.end}
            </b>{' '}
            والجدول {pattern.scheduledStart}–{pattern.scheduledEnd} ({pattern.days} مرات)
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={MUTED}>
              الجدول محمّل الأيام دي {minutesLabel(pattern.minutes)} تأخير/انصراف
            </span>
            <ShiftScopePicker
              staffId={employee.staff_id}
              start={pattern.start}
              end={pattern.end}
              date={pattern.dates[pattern.dates.length - 1]}
              weekDay={pattern.day}
              firstDate={pattern.from}
              label={`عدّل ${pattern.day}`}
              note="تصحيح يوم الأسبوع من نمط البصمة"
              onApplied={(text) => applied(pattern.day, `${pattern.day}: ${text}`)}
            />
          </div>
        </div>
      ))}
      {days.slice(0, 8).map((mismatch) => (
        <div
          key={mismatch.sample.date}
          className={`${SOFT} flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs`}
        >
          <span>
            {weekday(mismatch.sample.date)} {mismatch.sample.date.slice(5)}: اشتغل{' '}
            <b>
              {mismatch.shift.start}–{mismatch.shift.end}
            </b>
            {mismatch.minutes ? (
              <span className={MUTED}> · عليه {minutesLabel(mismatch.minutes)} بسبب الجدول</span>
            ) : null}
            {!mismatch.shift.scheduled ? (
              <span className="block text-[11px] text-amber-700 dark:text-amber-300">
                الشيفت ده من البصمة بس ومش موجود في جدوله: اتأكد إنه مش تأخير
              </span>
            ) : null}
          </span>
          <ShiftScopePicker
            staffId={employee.staff_id}
            start={mismatch.shift.start}
            end={mismatch.shift.end}
            date={mismatch.sample.date}
            label="اعتبره الشيفت ده"
            note="تصحيح من نمط البصمة"
            onApplied={(text) =>
              applied(mismatch.sample.date, `يوم ${mismatch.sample.date}: ${text}`)
            }
          />
        </div>
      ))}
      {days.length > 8 ? (
        <p className={`text-[11px] ${MUTED}`}>و{days.length - 8} يوم أقدم.</p>
      ) : null}
    </section>
  );
}

// Employees whose punches follow another shift than the schedule, with the minutes that is costing them.
function ShiftFixesPanel({
  employees,
  profiles,
  credit,
  onSmart,
}: {
  employees: DrWaelEmployee[];
  profiles: Map<string, ShiftProfile>;
  credit: Map<string, DrWaelCreditRow>;
  onSmart: (employee: DrWaelEmployee) => void;
}) {
  const rows = employees
    .filter((e) => !e.work_mode)
    .map((employee) => {
      const profile = profiles.get(employee.staff_id);
      const days = profile?.mismatches.length || 0;
      const weekly = profile?.weekly || [];
      const minutes =
        (profile?.mismatches.reduce((sum, m) => sum + m.minutes, 0) || 0) +
        weekly.reduce((sum, p) => sum + p.minutes, 0);
      return { employee, days, weekly, minutes };
    })
    .filter((row) => row.days || row.weekly.length)
    .sort((a, b) => b.minutes - a.minutes);
  if (!rows.length) return null;
  return (
    <Section
      title="البصمة ماشية على شيفت غير الجدول"
      subtitle="آخر 40 يوم · الدقايق دي ممكن تكون محسوبة عليه بسبب جدول مش مظبوط، راجعها قبل ما تأثر على التصنيف"
    >
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {rows.map(({ employee, days, weekly, minutes }) => (
          <button
            key={employee.staff_id}
            type="button"
            onClick={() => onSmart(employee)}
            className={`${CARD} border-r-4 border-r-violet-400 p-3 text-right transition hover:shadow-md`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1 font-bold text-gray-900 dark:text-slate-100">
                {employee.name}
                {credit.get(employee.staff_id)?.delivery ? (
                  <Bike size={12} className="text-emerald-500" />
                ) : null}
              </span>
              <span className={`text-[11px] ${MUTED}`}>{employee.branch}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {weekly.map((pattern) => (
                <Pill key={pattern.day} tone="violet">
                  كل {pattern.day.replace(/^ال/, '')} {pattern.start}–{pattern.end}
                </Pill>
              ))}
              {days ? <Pill tone="amber">{days} يوم على شيفت تاني</Pill> : null}
              {minutes ? <Pill tone="red">{minutesLabel(minutes)}</Pill> : null}
            </div>
            <div className="mt-2 text-[11px] font-bold text-indigo-600 dark:text-indigo-400">
              راجع وصحّح ←
            </div>
          </button>
        ))}
      </div>
    </Section>
  );
}

function CreditAlertsPanel({
  ledger,
  employees,
  onSmart,
}: {
  ledger: DrWaelCreditLedger | null;
  employees: DrWaelEmployee[];
  onSmart: (employee: DrWaelEmployee) => void;
}) {
  if (!ledger) return null;
  const byId = new Map(employees.map((e) => [e.staff_id, e]));
  const alerts = creditAlerts(ledger).filter((alert) => byId.has(alert.staffId));
  if (!alerts.length) return null;
  return (
    <Section title="تنبيهات الكريديت" subtitle="اللي محتاج متابعة قبل ما الفترة تتقفل">
      <ul className={`${CARD} divide-y divide-gray-50 dark:divide-slate-800`}>
        {alerts.slice(0, 12).map((alert) => {
          const employee = byId.get(alert.staffId) as DrWaelEmployee;
          return (
            <li key={`${alert.staffId}-${alert.text}`}>
              <button
                type="button"
                onClick={() => onSmart(employee)}
                className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-right text-xs hover:bg-gray-50 dark:hover:bg-slate-800/60"
              >
                <span className="font-bold text-gray-900 dark:text-slate-100">{employee.name}</span>
                <Pill tone={alert.severity === 'danger' ? 'red' : 'amber'}>{alert.text}</Pill>
              </button>
            </li>
          );
        })}
      </ul>
      {alerts.length > 12 ? (
        <p className={`text-[11px] ${PAGE_MUTED}`}>وكمان {alerts.length - 12} في تبويب الكريديت.</p>
      ) : null}
    </Section>
  );
}

// Quick answers under the search box: who, their credit, and the way to edit.
function SearchResults({
  employees,
  ledger,
  credit,
  profiles,
  onSmart,
}: {
  employees: DrWaelEmployee[];
  ledger: DrWaelCreditLedger | null;
  credit: Map<string, DrWaelCreditRow>;
  profiles: Map<string, ShiftProfile>;
  onSmart: (employee: DrWaelEmployee) => void;
}) {
  if (!employees.length)
    return <Empty label="مفيش موظف بالاسم ده. جرّب جزء من الاسم أو استخدم * مثل احمد*نور" />;
  return (
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      {employees.slice(0, 6).map((employee) => {
        const row = credit.get(employee.staff_id);
        const view =
          ledger && row?.delivery
            ? deliveryCreditView(row.delivery, ledger.today, ledger.cycle_end)
            : null;
        const profile = profiles.get(employee.staff_id);
        return (
          <div key={employee.staff_id} className={`${CARD} space-y-2 p-3`}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-gray-900 dark:text-slate-100">{employee.name}</span>
              <span className={`text-[11px] ${MUTED}`}>{employee.branch}</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {ledger && row ? (
                <Pill
                  tone={row.missing_used + row.missing_open > ledger.missing_limit ? 'red' : 'gray'}
                >
                  سماح البصمة {row.missing_used}/{ledger.missing_limit}
                </Pill>
              ) : null}
              {view && row?.delivery ? (
                <Pill tone={BAND_TONE[view.band]}>
                  دليفري {row.delivery.minutes}/{row.delivery.committed_credit} د
                </Pill>
              ) : null}
              {profile?.rotating ? (
                <Pill tone="violet">بيتناوب {profile.known.length} شيفتات</Pill>
              ) : null}
              {profile?.mismatches.length || profile?.weekly.length ? (
                <Pill tone="amber">فيه تصحيح مقترح</Pill>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => onSmart(employee)}
              className={`w-full rounded-lg px-3 py-1.5 text-xs font-bold ${ACTIVE}`}
            >
              الشيفت والكريديت
            </button>
          </div>
        );
      })}
      {employees.length > 6 ? (
        <p className={`text-[11px] ${PAGE_MUTED}`}>و{employees.length - 6} كمان تحت في الصفحة.</p>
      ) : null}
    </div>
  );
}

// All the credit of the cycle in one table.
function CreditTab({
  ledger,
  employees,
  credit,
  profiles,
  onSmart,
}: {
  ledger: DrWaelCreditLedger | null;
  employees: DrWaelEmployee[];
  credit: Map<string, DrWaelCreditRow>;
  profiles: Map<string, ShiftProfile>;
  onSmart: (employee: DrWaelEmployee) => void;
}) {
  if (!ledger) return <Empty label="الكريديت مش متاح دلوقتي؛ حدّث الصفحة وحاول تاني." />;
  const rows = employees
    .map((employee) => ({ employee, row: credit.get(employee.staff_id) }))
    .filter((item): item is { employee: DrWaelEmployee; row: DrWaelCreditRow } =>
      Boolean(item.row)
    );
  const delivery = rows
    .filter((item) => item.row.delivery)
    .sort(
      (a, b) =>
        (b.row.delivery as NonNullable<DrWaelCreditRow['delivery']>).minutes -
        (a.row.delivery as NonNullable<DrWaelCreditRow['delivery']>).minutes
    );
  const missing = rows
    .filter((item) => item.row.missing_used + item.row.missing_open > 0)
    .sort(
      (a, b) => b.row.missing_used + b.row.missing_open - (a.row.missing_used + a.row.missing_open)
    );
  return (
    <div className="space-y-5">
      <CreditAlertsPanel ledger={ledger} employees={employees} onSmart={onSmart} />
      <ShiftFixesPanel
        employees={employees.filter((e) => e.active)}
        profiles={profiles}
        credit={credit}
        onSmart={onSmart}
      />
      <Section
        title="كريديت دقايق الدليفري"
        subtitle="نفس أرقام محرك المرتبات · التصنيف بيتحسم لما يوصل الحد الأدنى للحضور"
      >
        {delivery.length ? (
          <DataTable head={['الموظف', 'الحضور', 'المستخدم', 'ملتزم', 'عادي', 'التصنيف']}>
            {delivery.map(({ employee, row }) => {
              const d = row.delivery as NonNullable<DrWaelCreditRow['delivery']>;
              const view = deliveryCreditView(d, ledger.today, ledger.cycle_end);
              return (
                <tr key={employee.staff_id}>
                  <Td>
                    <button
                      type="button"
                      onClick={() => onSmart(employee)}
                      className="font-bold text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      {employee.name}
                    </button>
                  </Td>
                  <Td>
                    {d.attended_days}
                    {d.pending_days ? ` + ${d.pending_days}` : ''} / {d.minimum_days}
                  </Td>
                  <Td className="font-bold">{d.minutes} د</Td>
                  <Td>{d.committed_credit} د</Td>
                  <Td>{d.regular_credit} د</Td>
                  <Td>
                    <Pill tone={BAND_TONE[view.band]}>
                      {view.final ? d.band_ar : `لحد دلوقتي: ${CREDIT_BAND_LABELS[view.band]}`}
                    </Pill>
                  </Td>
                </tr>
              );
            })}
          </DataTable>
        ) : (
          <Empty label="مفيش موظفين دليفري بالفلتر ده" />
        )}
      </Section>
      <Section
        title="سماح نسيان البصمة"
        subtitle={`أول ${ledger.missing_limit} مرات في الفترة سماح، وبعدها ممكن خصم ${ledger.missing_penalty} ج للمرة`}
      >
        {missing.length ? (
          <DataTable head={['الموظف', 'الفرع', 'اتسجل', 'مستني قرار', 'اتخصم']}>
            {missing.map(({ employee, row }) => (
              <tr key={employee.staff_id}>
                <Td>
                  <button
                    type="button"
                    onClick={() => onSmart(employee)}
                    className="font-bold text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    {employee.name}
                  </button>
                </Td>
                <Td className={MUTED}>{employee.branch}</Td>
                <Td className="font-bold">
                  {row.missing_used} / {ledger.missing_limit}
                </Td>
                <Td>{row.missing_open || '—'}</Td>
                <Td>{row.missing_penalized || '—'}</Td>
              </tr>
            ))}
          </DataTable>
        ) : (
          <Empty label="مفيش بصمات ناقصة في الفترة دي" />
        )}
      </Section>
    </div>
  );
}

function DashboardTab({
  data,
  branch,
  names,
  insights,
  onlyStaff,
  ledger,
  credit,
  profiles,
  onSmart,
  onDecisionSaved,
}: {
  data: Data;
  branch: string;
  names: Map<string, DrWaelEmployee>;
  insights: Map<string, DrWaelInsight>;
  onlyStaff: ReadonlySet<string> | null;
  ledger: DrWaelCreditLedger | null;
  credit: Map<string, DrWaelCreditRow>;
  profiles: Map<string, ShiftProfile>;
  onSmart: (employee: DrWaelEmployee) => void;
  onDecisionSaved: () => void;
}) {
  const [review, setReview] = useState<DayReview | null>(null);
  const canReview = useDayReviewAccess();
  const branches = data.branches.filter((b) => matches(branch, b));
  // «Who is in now» and «present today» come from the punches themselves: a day is resolved only after its
  // shift ends, so the resolved days miss everyone still on shift.
  const [punches, setPunches] = useState<{ today: DrWaelPunch[]; all: DrWaelPunch[] } | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all([fetchDrWaelDayPunches(data.today), fetchDrWaelDayPunches(addDays(data.today, -1))])
      .then(([todays, yesterdays]) => {
        if (alive) setPunches({ today: todays, all: [...yesterdays, ...todays] });
      })
      .catch(() => {
        if (alive) setPunches(null);
      });
    return () => {
      alive = false;
    };
  }, [data]);
  const homeBranch = (staffId: string, fallback: string | null) =>
    names.get(staffId)?.branch || fallback || '';
  const open: PresentNow[] = (
    punches
      ? presentNow(punches.all)
      : openShifts(data.days, data.today).map((day) => ({
          staffId: day.staff_id,
          name: names.get(day.staff_id)?.name || '—',
          punchBranch: day.branch,
          since: day.first_in || '',
        }))
  ).filter((row) => !onlyStaff || onlyStaff.has(row.staffId));
  const today = todayByBranch(data, data.today).filter((row) => matches(branch, row.branch));
  const presentToday = punches
    ? new Set(
        punches.today
          .filter(
            (p) =>
              p.staff_id &&
              (!onlyStaff || onlyStaff.has(p.staff_id)) &&
              matches(branch, homeBranch(p.staff_id, p.branch))
          )
          .map((p) => p.staff_id)
      ).size
    : null;
  const sum = (key: 'present' | 'late' | 'review' | 'absent') =>
    key === 'present' && presentToday != null
      ? String(presentToday)
      : String(today.reduce((total, row) => total + row[key], 0));
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
      <ShiftFixesPanel
        employees={data.employees.filter((e) => e.active && matches(branch, e.branch))}
        profiles={profiles}
        credit={credit}
        onSmart={onSmart}
      />
      <CreditAlertsPanel
        ledger={ledger}
        employees={data.employees.filter((e) => matches(branch, e.branch))}
        onSmart={onSmart}
      />
      <IdleStaffPanel
        data={data}
        employees={data.employees.filter((e) => matches(branch, e.branch))}
        onSmart={onSmart}
        onSaved={onDecisionSaved}
      />
      <Section title="الحاضرون الآن" subtitle="بصمة حضور النهارده أو امبارح بالليل من غير انصراف">
        <div className="grid gap-3 md:grid-cols-3">
          {branches.map((b) => {
            const list = open.filter((row) => homeBranch(row.staffId, row.punchBranch) === b);
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
                    {list.map((row) => {
                      const employee = names.get(row.staffId);
                      const away =
                        row.punchBranch && row.punchBranch !== b ? row.punchBranch : null;
                      return (
                        <li
                          key={row.staffId}
                          className="flex items-center justify-between py-1.5 text-xs"
                        >
                          <span className="flex items-center gap-1 font-bold text-gray-800 dark:text-slate-200">
                            {employee?.name || row.name}
                            {employee?.delivery ? (
                              <Bike size={12} className="text-emerald-500" />
                            ) : null}
                            {away ? <Pill tone="blue">بصم في {away}</Pill> : null}
                          </span>
                          <span className={MUTED}>{cairoTime(row.since)}</span>
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
      <ReviewQueue
        groups={groups}
        names={names}
        canReview={canReview}
        ledger={ledger}
        credit={credit}
        onOpen={(day) =>
          setReview({
            staffId: day.staff_id,
            name: names.get(day.staff_id)?.name || 'موظف',
            date: day.date,
          })
        }
        onDecisionSaved={onDecisionSaved}
      />
      <DayReviewSheet
        review={canReview ? review : null}
        onClose={() => setReview(null)}
        onDecisionSaved={onDecisionSaved}
      />
    </div>
  );
}

function AttendanceTab({
  data,
  employees,
  insights,
  onSmart,
  onDecisionSaved,
}: {
  data: Data;
  employees: DrWaelEmployee[];
  insights: Map<string, DrWaelInsight>;
  onSmart: (employee: DrWaelEmployee) => void;
  onDecisionSaved: () => void;
}) {
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
        filter === 'all' ||
        (filter === 'review' && summary.reviewDays > 0) ||
        (filter === 'smart' && flagged(employee.staff_id))
    );
  const branches = data.branches.filter((b) => rows.some((row) => row.employee.branch === b));
  return (
    <div className="space-y-3">
      <div className={`${CARD} flex flex-wrap items-center gap-2 p-2`}>
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
                            عدّل الشيفت/الفرع
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
          {open ? (
            <EmployeeDays employee={open} data={data} onDecisionSaved={onDecisionSaved} />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function EmployeeDays({
  employee,
  data,
  onDecisionSaved,
}: {
  employee: DrWaelEmployee;
  data: Data;
  onDecisionSaved: () => void;
}) {
  const canReview = useDayReviewAccess();
  const [review, setReview] = useState<DayReview | null>(null);
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
                  {canReview && day.review ? (
                    <button
                      type="button"
                      className="btn-secondary mt-1 text-xs"
                      onClick={() =>
                        setReview({
                          staffId: employee.staff_id,
                          name: employee.name,
                          date: day.date,
                        })
                      }
                    >
                      مراجعة البصمة
                    </button>
                  ) : null}
                  {day.missing_punch && day.punches === 1 ? (
                    <span className="mr-1">
                      <Pill tone="amber">بصمة واحدة</Pill>
                    </span>
                  ) : null}
                  {day.other_branch ? (
                    <span className="mr-1">
                      <Pill tone="blue">بصم في {day.other_branch}</Pill>
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
      <DayReviewSheet
        review={canReview ? review : null}
        onClose={() => setReview(null)}
        onDecisionSaved={onDecisionSaved}
      />
    </div>
  );
}

type DayReview = { staffId: string; name: string; date: string };

function useDayReviewAccess() {
  const { user } = useAuth();
  return (
    user?.role === 'general_manager' ||
    user?.role === 'executive_manager' ||
    hasPermission(user, 'manage_payroll')
  );
}

// What happened on a day under review, in one plain sentence.
function dayStory(day: DrWaelDay): string {
  switch (day.resolution) {
    case 'missing_checkout':
      return `بصم حضور ${cairoTime(day.first_in)} ونسي يبصم انصراف`;
    case 'missing_checkin':
      return `بصم انصراف ${cairoTime(day.last_out)} ونسي يبصم حضور`;
    case 'absence_review':
      return 'كان في الجدول وما بصمش خالص';
    case 'early_leave_review':
      return `مشي قبل الميعاد بـ ${day.early_leave_minutes} دقيقة (اشتغل ${minutesLabel(Number(day.hours || 0) * 60)})`;
    case 'late':
      return `اتأخر ${day.late_minutes} دقيقة`;
    case 'no_schedule':
      return 'مش في الجدول ومفيش بصمة';
    case 'off_day':
    case 'approved_time_off':
      return 'يوم أوف / إجازة ومستني اعتماد';
    case 'worked_on_off':
      return 'بصم في يوم أوف — محتاج تقرر يتحسب ولا لأ';
    case 'needs_event_review':
      return 'بصمات متلخبطة — محتاج تراجعها';
    default:
      return day.first_in
        ? `حضر ${cairoTime(day.first_in)} · انصرف ${cairoTime(day.last_out)}`
        : 'مفيش بصمة';
  }
}

// The kind of decision a day needs, for the filter chips and the colour of its card.
type QueueKind = 'forgot' | 'absent' | 'early' | 'off' | 'other';
const QUEUE_KINDS: Record<QueueKind, { label: string; tone: Tone; edge: string }> = {
  forgot: { label: 'نسي بصمة', tone: 'amber', edge: 'border-r-amber-400' },
  absent: { label: 'ما بصمش', tone: 'red', edge: 'border-r-rose-400' },
  early: { label: 'مشي بدري / اتأخر', tone: 'violet', edge: 'border-r-violet-400' },
  off: { label: 'أوف من غير جدول', tone: 'gray', edge: 'border-r-slate-400' },
  other: { label: 'محتاج مراجعة', tone: 'blue', edge: 'border-r-sky-400' },
};
function queueKind(day: DrWaelDay): QueueKind {
  switch (day.resolution) {
    case 'missing_checkout':
    case 'missing_checkin':
      return 'forgot';
    case 'absence_review':
      return 'absent';
    case 'early_leave_review':
    case 'late':
      return 'early';
    case 'no_schedule':
    case 'off_day':
    case 'approved_time_off':
      return 'off';
    default:
      return 'other';
  }
}

const BUTTON_TONE = {
  primary:
    'bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400',
  danger:
    'border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/20',
  neutral:
    'border border-gray-200 bg-white text-gray-800 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700',
} as const;

// Days waiting for a decision, newest first. One click decides a plain day and the card leaves the
// list at once (it comes back with the reason if the save fails); late-only days are folded.
function ReviewQueue({
  groups,
  names,
  canReview,
  ledger,
  credit,
  onOpen,
  onDecisionSaved,
}: {
  groups: Array<{ date: string; days: DrWaelDay[] }>;
  names: Map<string, DrWaelEmployee>;
  canReview: boolean;
  ledger: DrWaelCreditLedger | null;
  credit: Map<string, DrWaelCreditRow>;
  onOpen: (day: DrWaelDay) => void;
  onDecisionSaved: () => void;
}) {
  const { openAt } = useContext(ReadingContext);
  const [gone, setGone] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [kindFilter, setKindFilter] = useState<QueueKind | 'all'>('all');
  const [showInfo, setShowInfo] = useState(false);
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const refreshTimer = useRef<number | null>(null);
  const key = (day: DrWaelDay) => `${day.staff_id}-${day.date}`;

  // Reload the page data once the decisions stop, not after every click.
  const scheduleRefresh = () => {
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => onDecisionSaved(), 2500);
  };
  useEffect(
    () => () => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    },
    []
  );

  const open = groups.flatMap((g) => g.days.filter((d) => d.review && !gone[key(d)]));
  const infoOnly = groups.flatMap((g) => g.days.filter((d) => !d.review));
  const counts = open.reduce<Record<string, number>>((acc, day) => {
    const kind = queueKind(day);
    acc[kind] = (acc[kind] || 0) + 1;
    return acc;
  }, {});
  const doneCount = Object.keys(gone).length;
  const total = open.length + doneCount;

  const decide = async (day: DrWaelDay, decision: QuickDayDecision, label: string) => {
    const k = key(day);
    const who = names.get(day.staff_id)?.name || 'موظف';
    setGone((g) => ({ ...g, [k]: `${who}: ${label}` }));
    setFailed((f) => ({ ...f, [k]: '' }));
    try {
      const result = await decideQuickDay(day.staff_id, day.date, decision);
      if (result.approved === false) {
        setGone((g) => ({ ...g, [k]: `${who}: ${label} (البصمة اتسجلت، واليوم فاضل للمراجعة)` }));
      }
      scheduleRefresh();
      return true;
    } catch (error) {
      setGone((g) => {
        const next = { ...g };
        delete next[k];
        return next;
      });
      setFailed((f) => ({
        ...f,
        [k]: error instanceof Error ? error.message : 'تعذّر حفظ القرار',
      }));
      return false;
    }
  };

  // The clear cases of a day: one obvious decision (forgot a punch → shift time; worked → approve).
  const obvious = (days: DrWaelDay[]) =>
    days
      .map((day) => ({ day, options: quickDayOptions(day) }))
      .filter(({ options }) => options.length === 1 && options[0].tone === 'primary');
  const decideAll = async (date: string, items: ReturnType<typeof obvious>) => {
    if (!window.confirm(`هيتنفّذ ${items.length} قرار واضح ليوم ${date}. تكمل؟`)) return;
    setBulkBusy(date);
    for (const { day, options } of items) await decide(day, options[0].decision, options[0].label);
    setBulkBusy(null);
  };

  const recent = Object.values(gone).slice(-3).reverse();

  return (
    <Section
      title="قرارات الحضور المستنية"
      subtitle="آخر 5 أيام · كل يوم جنبه القرار المناسب بضغطة، و«تفاصيل» للحالات المعقدة"
    >
      <div className={`${CARD} space-y-3 p-4`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-gray-900 dark:text-slate-100">
              {open.length}
            </span>
            <span className={`text-sm font-bold ${MUTED}`}>يوم مستني قرار</span>
          </div>
          {doneCount ? (
            <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
              <Check size={14} /> خلّصت {doneCount} من {total}
            </span>
          ) : null}
        </div>
        {total ? (
          <div className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-800">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-500"
              style={{ width: `${Math.round((doneCount / total) * 100)}%` }}
            />
          </div>
        ) : null}
        <div className="flex flex-wrap gap-1.5">
          {(['all', ...(Object.keys(QUEUE_KINDS) as QueueKind[])] as const).map((kind) => {
            const count = kind === 'all' ? open.length : counts[kind] || 0;
            if (kind !== 'all' && !count) return null;
            const active = kindFilter === kind;
            return (
              <button
                key={kind}
                type="button"
                onClick={() => setKindFilter(kind)}
                className={`rounded-full px-3 py-1 text-xs font-bold transition ${active ? ACTIVE : IDLE}`}
              >
                {kind === 'all' ? 'الكل' : QUEUE_KINDS[kind].label} · {count}
              </button>
            );
          })}
        </div>
        {!canReview ? (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
            القرارات للمدير العام أو اللي معاه صلاحية المرتبات — تقدر تشوف الحالات بس.
          </p>
        ) : null}
        {recent.length ? (
          <ul className="space-y-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
            {recent.map((line) => (
              <li key={line} className="flex items-center gap-1">
                <Check size={12} /> {line}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {open.length === 0 ? (
        <div className={`${CARD} flex flex-col items-center gap-1 p-6 text-center`}>
          <Check className="text-emerald-500" size={28} />
          <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
            مفيش قرارات مستنية
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => {
            const days = group.days.filter(
              (d) =>
                d.review && !gone[key(d)] && (kindFilter === 'all' || queueKind(d) === kindFilter)
            );
            if (!days.length) return null;
            const clear = canReview ? obvious(days) : [];
            return (
              <div key={group.date} className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                  <span className={`text-sm font-black ${PAGE_HEADING}`}>
                    {weekday(group.date)} · {group.date.slice(8, 10)}/{group.date.slice(5, 7)}
                    <span className={`ms-2 text-xs font-bold ${PAGE_MUTED}`}>
                      {days.length} قرار
                    </span>
                  </span>
                  {clear.length > 1 ? (
                    <button
                      type="button"
                      disabled={bulkBusy !== null}
                      onClick={() => void decideAll(group.date, clear)}
                      className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60 dark:bg-emerald-500/10 dark:text-emerald-300"
                    >
                      {bulkBusy === group.date ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Check size={13} />
                      )}
                      نفّذ الواضح ({clear.length})
                    </button>
                  ) : null}
                </div>
                <ul className="space-y-2">
                  {days.map((day) => {
                    const k = key(day);
                    const employee = names.get(day.staff_id);
                    const kind = QUEUE_KINDS[queueKind(day)];
                    const options = canReview ? quickDayOptions(day) : [];
                    const name = employee?.name || '—';
                    const note = ledger
                      ? dayCreditNote(
                          day,
                          credit.get(day.staff_id),
                          ledger.missing_limit,
                          ledger.missing_penalty
                        )
                      : null;
                    return (
                      <li
                        key={k}
                        className={`${CARD} border-r-4 ${kind.edge} flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between`}
                      >
                        <div className="flex min-w-0 items-start gap-3">
                          <span
                            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-black ${TONES[kind.tone]}`}
                          >
                            {name
                              .replace(/^د\s*\/?\s*/, '')
                              .trim()
                              .charAt(0) || '؟'}
                          </span>
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-sm font-black text-gray-900 dark:text-slate-100">
                                {name}
                              </span>
                              <Pill tone={kind.tone}>{kind.label}</Pill>
                              {employee && !employee.active ? (
                                <Pill tone="gray">ساب الشغل</Pill>
                              ) : null}
                              {day.other_branch ? (
                                <Pill tone="blue">
                                  بصم في {day.other_branch.replace('فرع ', '')}
                                </Pill>
                              ) : null}
                            </div>
                            <div className="text-[13px] text-gray-700 dark:text-slate-300">
                              {dayStory(day)}
                            </div>
                            <div
                              className={`flex flex-wrap items-center gap-x-2 text-[11px] ${MUTED}`}
                            >
                              <span>{day.branch.replace('فرع ', '')}</span>
                              {day.scheduled_start ? (
                                <span className="inline-flex items-center gap-0.5">
                                  <Clock size={11} /> {cairoTime(day.scheduled_start)}–
                                  {cairoTime(day.scheduled_end)}
                                </span>
                              ) : null}
                              {employee ? (
                                <button
                                  type="button"
                                  onClick={() => openAt(employee, day.date)}
                                  className="font-bold text-indigo-600 hover:underline dark:text-indigo-400"
                                >
                                  عدّل الشيفت
                                </button>
                              ) : null}
                            </div>
                            {canReview ? <PunchReadingNote day={day} /> : null}
                            {note ? (
                              <div className="inline-flex items-center gap-1 text-[11px] font-bold text-violet-700 dark:text-violet-300">
                                <Gauge size={12} /> {note}
                              </div>
                            ) : null}
                            {failed[k] ? (
                              <div className="rounded-lg bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
                                ما اتحفظش: {failed[k]}
                              </div>
                            ) : null}
                          </div>
                        </div>
                        {canReview ? (
                          <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex sm:items-center">
                            {options.map((option) => (
                              <button
                                key={option.decision}
                                type="button"
                                disabled={bulkBusy !== null}
                                onClick={() => void decide(day, option.decision, option.label)}
                                className={`min-h-[40px] rounded-xl px-4 text-sm font-bold transition disabled:opacity-60 ${BUTTON_TONE[option.tone]} ${options.length === 1 ? 'col-span-2' : ''}`}
                              >
                                {option.label}
                              </button>
                            ))}
                            <button
                              type="button"
                              onClick={() => onOpen(day)}
                              className={`min-h-[40px] rounded-xl px-3 text-sm font-bold ${options.length ? `text-xs underline ${MUTED}` : `col-span-2 ${BUTTON_TONE.neutral}`}`}
                            >
                              {options.length ? 'تفاصيل' : 'راجع التفاصيل'}
                            </button>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {infoOnly.length ? (
        <div className="mt-3">
          <button
            type="button"
            className={`text-xs font-bold underline ${PAGE_MUTED}`}
            onClick={() => setShowInfo((v) => !v)}
          >
            {showInfo ? 'إخفاء' : 'اعرض'} {infoOnly.length} يوم فيه تأخير بس (اتحسب تلقائي، مش محتاج
            قرار)
          </button>
          {showInfo ? (
            <ul className="mt-1 grid gap-1 text-[11px] md:grid-cols-2">
              {infoOnly.map((day) => (
                <li key={key(day)} className={PAGE_MUTED}>
                  {day.date.slice(5)} · {names.get(day.staff_id)?.name || '—'} ·{' '}
                  {day.late_minutes > 0 ? `متأخر ${day.late_minutes} د` : ''}
                  {day.early_leave_minutes > 0 ? ` · مشي بدري ${day.early_leave_minutes} د` : ''}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Section>
  );
}

function DayReviewSheet({
  review,
  onClose,
  onDecisionSaved,
}: {
  review: DayReview | null;
  onClose: () => void;
  onDecisionSaved: () => void;
}) {
  return (
    <Sheet open={Boolean(review)} onOpenChange={(open) => !open && onClose()}>
      {review ? (
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-4xl" dir="rtl">
          <SheetTitle className="mb-4 pe-8">
            {review.name} · {review.date}
          </SheetTitle>
          <Suspense fallback={<Spinner label="جارٍ تجهيز مراجعة اليوم" />}>
            <AttendanceResolutionCenter
              key={`${review.staffId}:${review.date}`}
              initialDate={review.date}
              initialStaffId={review.staffId}
              initialTriage="all"
              embedded
              onDecisionSaved={onDecisionSaved}
            />
          </Suspense>
        </SheetContent>
      ) : null}
    </Sheet>
  );
}

// The daily screen: the clear decisions in one click, then the rest one at a time with one recommended action.
const QUICK_GROUPS: Record<QuickGroup, string> = {
  forgot: 'نسيان بصمة في حدود السماح',
  shift: 'اشتغل على شيفت تاني من شيفتاته',
  small: `دقايق بسيطة (${QUICK_SMALL_MINUTES} د أو أقل)`,
  absence: 'غياب',
  minutes: 'تأخير أو انصراف بدري',
  other: 'أوف من غير جدول ومن غير بصمة',
};
// The same groups on the one-at-a-time card, where a rule did not cover the day.
const QUICK_ASK_GROUPS: Record<QuickGroup, string> = {
  forgot: 'نسيان بصمة',
  shift: 'شيفت غير الجدول',
  small: 'دقايق بسيطة',
  absence: 'غياب',
  minutes: 'تأخير أو انصراف بدري',
  other: 'محتاج مراجعة',
};

function QuickDecisions({
  days,
  today,
  readings,
  names,
  credit,
  missingLimit,
  olderCount,
  onOlder,
  onReload,
}: {
  days: DrWaelDay[];
  today: string;
  readings: Map<string, PunchReading>;
  names: Map<string, DrWaelEmployee>;
  credit: Map<string, DrWaelCreditRow>;
  missingLimit: number;
  olderCount: number;
  onOlder: (() => void) | null;
  onReload: () => void;
}) {
  const [done, setDone] = useState<Record<string, true>>({});
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [skipped, setSkipped] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [bulk, setBulk] = useState<{ at: number; total: number } | null>(null);
  const [handled, setHandled] = useState(0);
  const [review, setReview] = useState<DayReview | null>(null);
  const inFlight = useRef(new Set<string>());
  const refreshTimer = useRef<number | null>(null);
  const key = (day: DrWaelDay) => `${day.staff_id}-${day.date}`;

  // Fresh data has the final word, except for what is still saving.
  useEffect(() => {
    setDone((current) =>
      Object.fromEntries(
        Object.keys(current)
          .filter((k) => inFlight.current.has(k))
          .map((k) => [k, true as const])
      )
    );
  }, [days]);
  useEffect(
    () => () => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    },
    []
  );

  const flexible = useMemo(
    () => new Set([...names.values()].filter((e) => e.work_mode).map((e) => e.staff_id)),
    [names]
  );
  const plan = useMemo(
    () =>
      quickPlan(days, today, readings, flexible, (staffId) => {
        const row = credit.get(staffId);
        return row ? missingLimit - row.missing_used : 0;
      }),
    [days, today, readings, flexible, credit, missingLimit]
  );
  const clear = plan.clear.filter((item) => !done[key(item.day)]);
  const askAll = plan.ask.filter((item) => !done[key(item.day)]);
  const ask = [
    ...askAll.filter((item) => !skipped.includes(key(item.day))),
    ...skipped.flatMap((k) => askAll.filter((item) => key(item.day) === k)),
  ];
  const current = ask[0];
  const left = clear.length + ask.length;
  const total = left + handled;

  const run = async (item: QuickItem, action: QuickAction) => {
    const k = key(item.day);
    if (action.type === 'details') {
      setReview({
        staffId: item.day.staff_id,
        name: names.get(item.day.staff_id)?.name || 'موظف',
        date: item.day.date,
      });
      return false;
    }
    inFlight.current.add(k);
    setDone((d) => ({ ...d, [k]: true }));
    setFailed((f) => {
      const next = { ...f };
      delete next[k];
      return next;
    });
    try {
      if (action.type === 'shift') {
        await applyDrWaelShiftChange({
          staffId: item.day.staff_id,
          start: action.start,
          end: action.end,
          mode: 'day',
          from: item.day.date,
          note: 'قرار سريع: اليوم على شيفت الموظف حسب البصمة',
        });
      } else {
        await decideQuickDay(item.day.staff_id, item.day.date, action.decision);
      }
      setHandled((n) => n + 1);
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(onReload, 2500);
      return true;
    } catch (e) {
      setDone((d) => {
        const next = { ...d };
        delete next[k];
        return next;
      });
      setFailed((f) => ({ ...f, [k]: e instanceof Error ? e.message : 'تعذّر حفظ القرار' }));
      return false;
    } finally {
      inFlight.current.delete(k);
    }
  };

  const runClear = async () => {
    setConfirming(false);
    const items = clear;
    setBulk({ at: 0, total: items.length });
    let at = 0;
    for (const item of items) {
      await run(item, item.primary);
      at += 1;
      setBulk({ at, total: items.length });
    }
    setBulk(null);
  };

  const groups = (Object.keys(QUICK_GROUPS) as QuickGroup[])
    .map((group) => ({ group, count: clear.filter((item) => item.group === group).length }))
    .filter((row) => row.count);
  const failures = plan.clear.filter((item) => failed[key(item.day)]);
  const actionText = (action: QuickAction) => action.label;
  const when = (date: string) => `${weekday(date)} ${date.slice(8, 10)}/${date.slice(5, 7)}`;

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <div className={`${CARD} space-y-2 p-4`}>
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-gray-900 dark:text-slate-100">{left}</span>
            <span className={`text-sm font-bold ${MUTED}`}>قرار مستني منك</span>
          </div>
          {handled ? (
            <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
              <Check size={14} /> خلّصت {handled}
            </span>
          ) : null}
        </div>
        {total ? (
          <div className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-800">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-500"
              style={{ width: `${Math.round((handled / total) * 100)}%` }}
            />
          </div>
        ) : null}
      </div>

      {clear.length || bulk ? (
        <section className={`${CARD} space-y-3 border-r-4 border-r-emerald-400 p-4`}>
          <div>
            <h2 className="text-base font-black text-gray-900 dark:text-slate-100">
              {bulk ? `بينفّذ ${bulk.at} من ${bulk.total}…` : `${clear.length} قرار واضح`}
            </h2>
            {!bulk ? (
              <ul className={`mt-1 space-y-0.5 text-xs ${MUTED}`}>
                {groups.map((row) => (
                  <li key={row.group}>
                    {row.count} · {QUICK_GROUPS[row.group]}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          {confirming ? (
            <ul className="max-h-64 space-y-1 overflow-y-auto text-xs">
              {clear.map((item) => (
                <li key={key(item.day)} className={`${SOFT} px-2 py-1.5`}>
                  <b>{names.get(item.day.staff_id)?.name || '—'}</b> · {when(item.day.date)}:{' '}
                  {actionText(item.primary)}
                </li>
              ))}
            </ul>
          ) : null}
          {!bulk ? (
            <div className="flex flex-wrap items-center gap-2">
              {confirming ? (
                <>
                  <button
                    type="button"
                    onClick={() => void runClear()}
                    className={`min-h-[44px] flex-1 rounded-xl px-4 text-sm font-bold ${BUTTON_TONE.primary}`}
                  >
                    تمام، نفّذ الـ {clear.length}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    className={`min-h-[44px] rounded-xl px-4 text-sm font-bold ${BUTTON_TONE.neutral}`}
                  >
                    رجوع
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  className={`min-h-[44px] flex-1 rounded-xl px-4 text-sm font-bold ${BUTTON_TONE.primary}`}
                >
                  شوف ونفّذ
                </button>
              )}
            </div>
          ) : null}
          {failures.length ? (
            <ul className="space-y-1 text-[11px] font-bold text-rose-700 dark:text-rose-300">
              {failures.map((item) => (
                <li key={key(item.day)}>
                  {names.get(item.day.staff_id)?.name || '—'} · {when(item.day.date)}: ما اتحفظش (
                  {failed[key(item.day)]})
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {current ? (
        <section className={`${CARD} space-y-3 border-r-4 border-r-violet-400 p-4`}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-bold text-violet-700 dark:text-violet-300">
              محتاج رأيك · {ask.length}
            </h2>
            <span className={`text-xs ${MUTED}`}>{QUICK_ASK_GROUPS[current.group]}</span>
          </div>
          <div>
            <div className="text-lg font-black text-gray-900 dark:text-slate-100">
              {names.get(current.day.staff_id)?.name || '—'}
            </div>
            <div className={`text-xs ${MUTED}`}>
              {when(current.day.date)} · {current.day.branch.replace('فرع ', '')}
              {current.day.scheduled_start
                ? ` · جدوله ${cairoTime(current.day.scheduled_start)}–${cairoTime(current.day.scheduled_end)}`
                : ''}
            </div>
          </div>
          <p className="text-sm text-gray-800 dark:text-slate-200">{dayStory(current.day)}</p>
          {current.why ? (
            <p className="flex items-start gap-1 rounded-lg bg-violet-50 px-2 py-1.5 text-xs font-bold text-violet-900 dark:bg-violet-500/10 dark:text-violet-200">
              <Sparkles size={13} className="mt-0.5 shrink-0" /> {current.why}
            </p>
          ) : null}
          {failed[key(current.day)] ? (
            <p
              role="alert"
              className="rounded-lg bg-rose-50 px-2 py-1 text-xs font-bold text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
            >
              ما اتحفظش: {failed[key(current.day)]}
            </p>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => void run(current, current.primary)}
              className={`min-h-[48px] rounded-xl px-4 text-sm font-bold ${current.secondary ? '' : 'sm:col-span-2'} ${BUTTON_TONE[current.primary.type === 'decide' ? current.primary.tone : 'primary']}`}
            >
              {actionText(current.primary)}
            </button>
            {current.secondary ? (
              <button
                type="button"
                onClick={() => void run(current, current.secondary as QuickAction)}
                className={`min-h-[48px] rounded-xl px-4 text-sm font-bold ${BUTTON_TONE.neutral}`}
              >
                {actionText(current.secondary)}
              </button>
            ) : null}
          </div>
          <button
            type="button"
            disabled={ask.length < 2}
            onClick={() =>
              setSkipped((list) => [
                ...list.filter((k) => k !== key(current.day)),
                key(current.day),
              ])
            }
            className={`w-full text-center text-xs font-bold underline disabled:opacity-40 ${MUTED}`}
          >
            بعدين، هات اللي بعده
          </button>
        </section>
      ) : null}

      {!left && !bulk ? (
        <div className={`${CARD} flex flex-col items-center gap-1 p-8 text-center`}>
          <Check className="text-emerald-500" size={32} />
          <p className="text-base font-black text-emerald-600 dark:text-emerald-400">
            خلصت كل القرارات
          </p>
        </div>
      ) : null}

      {olderCount && onOlder ? (
        <button
          type="button"
          onClick={onOlder}
          className={`w-full rounded-xl px-3 py-2 text-xs font-bold ${IDLE}`}
        >
          فيه {olderCount} قرار من الفترة اللي فاتت، افتحهم
        </button>
      ) : null}

      <DayReviewSheet review={review} onClose={() => setReview(null)} onDecisionSaved={onReload} />
    </div>
  );
}

function WorkDayTab({
  data,
  branch,
  names,
  onlyStaff,
  onDecisionSaved,
}: {
  data: Data;
  branch: string;
  names: Map<string, DrWaelEmployee>;
  onlyStaff: ReadonlySet<string> | null;
  onDecisionSaved: () => void;
}) {
  const canReview = useDayReviewAccess();
  const [date, setDate] = useState(data.today);
  const [review, setReview] = useState<DayReview | null>(null);
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
  const days = new Map(
    data.days.filter((day) => day.date === date).map((day) => [day.staff_id, day])
  );
  const rawRows = workDayRows(punches || []);
  const rawStaffIds = new Set(rawRows.map((row) => row.staffId));
  const resolvedOnly = [...days.values()]
    .filter((day) => !rawStaffIds.has(day.staff_id) && (day.first_in || day.last_out || day.review))
    .map((day) => ({
      key: day.staff_id,
      staffId: day.staff_id,
      name: names.get(day.staff_id)?.name || 'موظف',
      branch: day.branch,
      punches: [],
      events: [],
    }));
  const rows = [...rawRows, ...resolvedOnly]
    .filter(
      (row) =>
        matches(branch, row.branch) &&
        (!onlyStaff || (row.staffId ? onlyStaff.has(row.staffId) : false))
    )
    .sort(
      (a, b) => (Date.parse(a.punches[0]) || Infinity) - (Date.parse(b.punches[0]) || Infinity)
    );
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
        <span className={PAGE_MUTED}>البصمات حسب يوم الشيفت · البصمات غير المصنفة حسب تاريخها</span>
      </div>
      {error ? (
        <EmptyState label={error} error onRetry={() => setAttempt((n) => n + 1)} />
      ) : !punches ? (
        <Spinner label="جارٍ تحميل البصمات" />
      ) : !rows.length ? (
        <Empty label="مفيش سجلات حضور أو بصمات في اليوم ده" />
      ) : (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => {
            const employee = row.staffId ? names.get(row.staffId) : undefined;
            const tag = roleTag(employee);
            const day = row.staffId ? days.get(row.staffId) : undefined;
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
                    <b>{cairoTime(day?.first_in)}</b>
                  </span>
                  <span>
                    <span className={MUTED}>الانصراف: </span>
                    <b>{cairoTime(day?.last_out)}</b>
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <div className={MUTED}>ساعات الحضور المسجلة</div>
                    <b className="text-sm">
                      {day?.hours == null ? '—' : minutesLabel(Math.round(day.hours * 60))}
                    </b>
                  </div>
                  <div>
                    <div className={MUTED}>التأخير عن الموعد</div>
                    <b className="text-sm">{day ? `${day.late_minutes} دقيقة` : '—'}</b>
                  </div>
                </div>
                <div className={`mt-2 flex flex-wrap items-center gap-2 text-xs ${MUTED}`}>
                  <span>
                    الجدول: {cairoTime(day?.scheduled_start)} — {cairoTime(day?.scheduled_end)}
                  </span>
                  {day?.status === 'approved' ? (
                    <Pill tone="green">معتمد</Pill>
                  ) : day ? (
                    <Pill tone={day.review ? 'amber' : 'blue'}>
                      {DAY_KIND_LABELS[dayKind(day)]}
                    </Pill>
                  ) : (
                    <Pill tone="amber">لا يوجد سجل حضور في عرض الدورة</Pill>
                  )}
                </div>
                {row.punches.length > 0 ? (
                  <details className={`mt-2 text-[11px] ${MUTED}`}>
                    <summary className="cursor-pointer">
                      بصمات الجهاز ({row.punches.length})
                    </summary>
                    <ul className="mt-1 space-y-1">
                      {row.events.map((event, index) => (
                        <li key={event.event_id ?? index}>
                          <bdi>
                            {cairoDayOf(event.punch_time)} {cairoTime(event.punch_time)}
                          </bdi>
                          {' · '}
                          {event.interpretation_status === 'rejected'
                            ? 'مستبعدة من الاحتساب'
                            : event.interpreted_type === 'check_in'
                              ? 'دخول'
                              : event.interpreted_type === 'check_out'
                                ? 'خروج'
                                : 'تحتاج تفسير'}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                {canReview && row.staffId && day?.review ? (
                  <button
                    type="button"
                    className="btn-secondary mt-2 text-xs"
                    onClick={() =>
                      row.staffId && setReview({ staffId: row.staffId, name: row.name, date })
                    }
                  >
                    تعديل أو اعتماد اليوم
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      <DayReviewSheet
        review={canReview ? review : null}
        onClose={() => setReview(null)}
        onDecisionSaved={() => {
          onDecisionSaved();
          setAttempt((current) => current + 1);
        }}
      />
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
                    <button
                      type="button"
                      onClick={() => onSmart(employee)}
                      className="text-[11px] font-bold text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      عدّل الشيفت والبيانات
                    </button>
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
                      .reduce(
                        (sum, row) =>
                          sum +
                          days(
                            row.start_date < data.cycle_start ? data.cycle_start : row.start_date,
                            row.end_date > data.cycle_end ? data.cycle_end : row.end_date
                          ),
                        0
                      )}
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
                        : isOpenEnded(row.end_date)
                          ? `من ${row.start_date} (مفتوحة لحد ما يرجع)`
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

function SalariesTab({
  cycle,
  employees,
  search,
}: {
  cycle: string;
  employees: DrWaelEmployee[];
  search: string;
}) {
  const [allRows, setRows] = useState<PayrollRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [staff, setStaff] = useState<DrWaelPayrollStaff[]>([]);
  const request = useRef(0);

  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    setRows(null);
    // Managers outside the three branches (د/ علا، د وائل…) join the list; a failed read keeps the rest.
    const extra = await fetchDrWaelPayrollExtra().catch(() => []);
    const active = payrollStaff(employees, extra);
    if (id === request.current) setStaff(active);
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
  }, [employees, cycle]);

  useEffect(() => {
    void load();
  }, [load]);

  const byId = new Map(staff.map((e) => [e.staff_id, e]));
  const rows = allRows
    ? allRows.filter((r) => matchesEmployeeSearch(byId.get(r.staffId)?.name, search))
    : null;
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
