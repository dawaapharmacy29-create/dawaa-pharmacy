import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CalendarDays, Clock, Fingerprint, Loader2, RefreshCw, Users, Wallet } from 'lucide-react';
import {
  EmptyState,
  MiniBox,
  Panel,
  SectionTitle,
} from '@/components/dashboard/DashboardPrimitives';
import {
  DAY_KIND_LABELS,
  cairoTime,
  cycleLabel,
  dayKind,
  employeeMoney,
  fetchDrWaelDayPunches,
  fetchDrWaelFingerprints,
  mapWithConcurrency,
  minutesLabel,
  shiftCycle,
  summarizeEmployee,
  todayByBranch,
  workDayRows,
  type DayKind,
  type DrWaelEmployee,
  type DrWaelFingerprints as Data,
  type DrWaelPunch,
} from '@/lib/drWaelFingerprints';
import {
  getEmployeePayrollFinancialComposition,
  type EmployeePayrollFinancialCompositionV2,
} from '@/lib/payroll/payrollFinancialCompositionService';

// The layout follows the Base44 fingerprint app (fingdawaa): dashboard, attendance, work day, employees,
// employee reports, leaves, incentives/advances/deductions and salaries. Every number is this app's own.

const TABS = [
  ['dashboard', 'لوحة التحكم'],
  ['attendance', 'الحضور'],
  ['workday', 'يوم العمل'],
  ['employees', 'الموظفين'],
  ['reports', 'تقارير الموظفين'],
  ['leaves', 'الإجازات'],
  ['adjustments', 'الحوافز والسلف والخصومات'],
  ['salaries', 'المرتبات'],
] as const;
type Tab = (typeof TABS)[number][0];

const KIND_TONE: Record<DayKind, string> = {
  present: 'dawaa-badge--success',
  late: 'dawaa-badge--warning',
  review: 'dawaa-badge--danger',
  absent: 'dawaa-badge--danger',
  off: 'dawaa-badge--neutral',
  time_off: 'dawaa-badge--info',
  other: 'dawaa-badge--neutral',
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
  `${Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ج`;
const hoursText = (value: number | null | undefined) =>
  Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 });
const weekday = (date: string) => WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
const hhmm = (value: string | null) => (value ? value.slice(0, 5) : '—');

function Table({
  head,
  children,
  empty,
}: {
  head: string[];
  children: ReactNode;
  empty?: boolean;
}) {
  if (empty) return <EmptyState label="لا توجد بيانات في الفترة دي" />;
  return (
    <div className="overflow-x-auto rounded-2xl border border-[var(--dawaa-theme-accent-border)]">
      <table className="w-full min-w-[640px] text-right text-sm">
        <thead className="bg-[var(--dawaa-theme-surface)] text-xs font-black text-[var(--dawaa-theme-muted)]">
          <tr>
            {head.map((label) => (
              <th key={label} className="px-3 py-2 whitespace-nowrap">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--dawaa-theme-accent-border)]">{children}</tbody>
      </table>
    </div>
  );
}

const Cell = ({ children, strong }: { children: ReactNode; strong?: boolean }) => (
  <td className={`px-3 py-2 whitespace-nowrap ${strong ? 'font-black' : ''}`}>{children}</td>
);

export default function DrWaelFingerprints() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [cycle, setCycle] = useState<string | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [branch, setBranch] = useState<string>('الكل');
  const request = useRef(0);

  const load = useCallback(async (target: string | null) => {
    const id = ++request.current;
    setLoading(true);
    setError(null);
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
  }, []);

  useEffect(() => {
    void load(cycle);
  }, [cycle, load]);

  const names = useMemo(() => new Map((data?.employees || []).map((e) => [e.staff_id, e])), [data]);
  const employees = useMemo(
    () => (data?.employees || []).filter((e) => branch === 'الكل' || e.branch === branch),
    [data, branch]
  );

  if (loading && !data) {
    return (
      <div className="flex justify-center p-12" role="status">
        <Loader2 className="animate-spin" />
        <span className="sr-only">جارٍ تحميل البصمات</span>
      </div>
    );
  }
  if (!data)
    return (
      <EmptyState label={error || 'تعذر تحميل البصمات'} error onRetry={() => void load(cycle)} />
    );

  const current = data.month_cycle;
  return (
    <div className="space-y-5" dir="rtl" aria-busy={loading}>
      <Panel className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="dawaa-icon-tile p-3">
              <Fingerprint size={26} />
            </span>
            <div>
              <h1 className="dawaa-title text-2xl md:text-3xl">بصمات د وائل</h1>
              <p className="dawaa-caption mt-1 text-xs font-bold">
                الحضور والبصمات والجداول والمرتبات لفرع شكري وفرع الشامي والمخزن — من بيانات التطبيق
                نفسه.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="dawaa-button dawaa-button--ghost"
              onClick={() => setCycle(shiftCycle(current, -1))}
              disabled={loading}
            >
              الفترة السابقة
            </button>
            <span className="dawaa-badge dawaa-badge--info px-3 py-1 text-xs font-black">
              {cycleLabel(current)}
            </span>
            <button
              className="dawaa-button dawaa-button--ghost"
              onClick={() => setCycle(shiftCycle(current, 1))}
              disabled={loading || data.today <= data.cycle_end}
            >
              الفترة التالية
            </button>
            <button
              className="dawaa-button dawaa-button--secondary"
              onClick={() => void load(cycle)}
              disabled={loading}
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث
            </button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {['الكل', ...data.branches].map((b) => (
            <button
              key={b}
              onClick={() => setBranch(b)}
              className={`dawaa-badge px-3 py-1 text-xs font-black ${branch === b ? 'dawaa-badge--success' : 'dawaa-badge--neutral'}`}
            >
              {b}
            </button>
          ))}
        </div>
        <nav className="mt-4 flex gap-2 overflow-x-auto pb-1" aria-label="أقسام البصمات">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              aria-pressed={tab === key}
              className={`dawaa-button whitespace-nowrap ${tab === key ? '' : 'dawaa-button--ghost'}`}
            >
              {label}
            </button>
          ))}
        </nav>
      </Panel>
      {error ? (
        <div role="alert" className="dawaa-alert dawaa-alert--danger flex justify-between gap-3">
          {error}
          <button onClick={() => void load(cycle)} className="underline">
            إعادة المحاولة
          </button>
        </div>
      ) : null}

      {tab === 'dashboard' ? <DashboardTab data={data} branch={branch} /> : null}
      {tab === 'attendance' ? <AttendanceTab data={data} branch={branch} names={names} /> : null}
      {tab === 'workday' ? <WorkDayTab data={data} branch={branch} /> : null}
      {tab === 'employees' ? <EmployeesTab employees={employees} /> : null}
      {tab === 'reports' ? <ReportsTab data={data} employees={employees} /> : null}
      {tab === 'leaves' ? <LeavesTab data={data} employees={employees} names={names} /> : null}
      {tab === 'adjustments' ? (
        <AdjustmentsTab data={data} employees={employees} names={names} />
      ) : null}
      {tab === 'salaries' ? <SalariesTab cycle={current} employees={employees} /> : null}
    </div>
  );
}

function DashboardTab({ data, branch }: { data: Data; branch: string }) {
  const rows = todayByBranch(data, data.today).filter(
    (row) => branch === 'الكل' || row.branch === branch
  );
  const total = rows.reduce(
    (sum, row) => ({
      employees: sum.employees + row.employees,
      present: sum.present + row.present,
      late: sum.late + row.late,
      review: sum.review + row.review,
      absent: sum.absent + row.absent,
    }),
    { employees: 0, present: 0, late: 0, review: 0, absent: 0 }
  );
  const cycleDays = data.days.filter((day) => branch === 'الكل' || day.branch === branch);
  const pending = cycleDays.filter((day) => day.review).length;
  const singles = cycleDays.filter((day) => day.missing_punch && day.punches === 1).length;
  const hours = cycleDays.reduce((sum, day) => sum + Number(day.hours || 0), 0);
  return (
    <div className="space-y-5">
      <Panel className="p-5">
        <SectionTitle
          title={`النهارده · ${weekday(data.today)} ${data.today}`}
          subtitle="مين بصم ومين اتأخر ومين محتاج مراجعة"
          icon={<Clock size={20} />}
        />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <MiniBox label="الموظفين" value={String(total.employees)} />
          <MiniBox label="بصموا حضور" value={String(total.present)} tone="green" />
          <MiniBox label="متأخرين" value={String(total.late)} tone="amber" />
          <MiniBox label="محتاج مراجعة" value={String(total.review)} tone="red" />
          <MiniBox label="غياب" value={String(total.absent)} tone="red" />
        </div>
        <div className="mt-4">
          <Table head={['الفرع', 'الموظفين', 'حضور', 'تأخير', 'مراجعة', 'غياب', 'راحة / إجازة']}>
            {rows.map((row) => (
              <tr key={row.branch}>
                <Cell strong>{row.branch}</Cell>
                <Cell>{row.employees}</Cell>
                <Cell>{row.present}</Cell>
                <Cell>{row.late}</Cell>
                <Cell>{row.review}</Cell>
                <Cell>{row.absent}</Cell>
                <Cell>{row.off}</Cell>
              </tr>
            ))}
          </Table>
        </div>
      </Panel>
      <Panel className="p-5">
        <SectionTitle
          title="الفترة كلها"
          subtitle={cycleLabel(data.month_cycle)}
          icon={<CalendarDays size={20} />}
        />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MiniBox label="أيام مسجلة" value={String(cycleDays.length)} tone="blue" />
          <MiniBox label="إجمالي الساعات" value={hoursText(hours)} tone="green" />
          <MiniBox label="أيام محتاجة مراجعة" value={String(pending)} tone="red" />
          <MiniBox label="بصمة واحدة فقط" value={String(singles)} tone="amber" />
        </div>
      </Panel>
    </div>
  );
}

function AttendanceTab({
  data,
  branch,
  names,
}: {
  data: Data;
  branch: string;
  names: Map<string, DrWaelEmployee>;
}) {
  const [kind, setKind] = useState<DayKind | 'all'>('all');
  const [staff, setStaff] = useState('all');
  const days = data.days.filter(
    (day) =>
      (branch === 'الكل' || day.branch === branch) &&
      (staff === 'all' || day.staff_id === staff) &&
      (kind === 'all' || dayKind(day) === kind)
  );
  return (
    <Panel className="p-5">
      <SectionTitle
        title="سجل الحضور"
        subtitle="كل يوم بعد ما محرك الحضور فسّر البصمات على الجدول"
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <select
          className="dawaa-input"
          value={staff}
          onChange={(e) => setStaff(e.target.value)}
          aria-label="الموظف"
        >
          <option value="all">كل الموظفين</option>
          {data.employees
            .filter((e) => branch === 'الكل' || e.branch === branch)
            .map((e) => (
              <option key={e.staff_id} value={e.staff_id}>
                {e.name}
              </option>
            ))}
        </select>
        <select
          className="dawaa-input"
          value={kind}
          onChange={(e) => setKind(e.target.value as DayKind | 'all')}
          aria-label="الحالة"
        >
          <option value="all">كل الحالات</option>
          {(Object.keys(DAY_KIND_LABELS) as DayKind[]).map((k) => (
            <option key={k} value={k}>
              {DAY_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </div>
      <Table
        head={[
          'التاريخ',
          'الموظف',
          'الفرع',
          'الجدول',
          'الحضور',
          'الانصراف',
          'بصمات',
          'الساعات',
          'تأخير',
          'انصراف مبكر',
          'الحالة',
        ]}
        empty={!days.length}
      >
        {days.map((day) => {
          const k = dayKind(day);
          return (
            <tr key={`${day.staff_id}-${day.date}-${day.branch}`}>
              <Cell>
                {weekday(day.date)} {day.date}
              </Cell>
              <Cell strong>{names.get(day.staff_id)?.name || '—'}</Cell>
              <Cell>{day.branch}</Cell>
              <Cell>
                {day.scheduled_start
                  ? `${cairoTime(day.scheduled_start)} – ${cairoTime(day.scheduled_end)}`
                  : '—'}
              </Cell>
              <Cell>{cairoTime(day.first_in)}</Cell>
              <Cell>{cairoTime(day.last_out)}</Cell>
              <Cell>{day.punches}</Cell>
              <Cell>{hoursText(day.hours)}</Cell>
              <Cell>{day.late_minutes ? minutesLabel(day.late_minutes) : '—'}</Cell>
              <Cell>{day.early_leave_minutes ? minutesLabel(day.early_leave_minutes) : '—'}</Cell>
              <Cell>
                <span className={`dawaa-badge ${KIND_TONE[k]}`}>{DAY_KIND_LABELS[k]}</span>
                {day.missing_punch && day.punches === 1 ? (
                  <span className="dawaa-badge dawaa-badge--warning mr-1">بصمة واحدة فقط</span>
                ) : null}
              </Cell>
            </tr>
          );
        })}
      </Table>
    </Panel>
  );
}

function WorkDayTab({ data, branch }: { data: Data; branch: string }) {
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
  const rows = workDayRows(punches || []).filter(
    (row) => branch === 'الكل' || row.branch === branch
  );
  return (
    <Panel className="p-5">
      <SectionTitle
        title="يوم العمل"
        subtitle="بصمات اليوم بالترتيب ومقسّمة لفترات شغل (حضور ← انصراف)، ومعاها ليلة اليوم لحد 8 الصبح"
      />
      <input
        type="date"
        className="dawaa-input mb-3"
        value={date}
        max={data.today}
        onChange={(e) => e.target.value && setDate(e.target.value)}
        aria-label="اليوم"
      />
      {error ? (
        <EmptyState label={error} error onRetry={() => setAttempt((n) => n + 1)} />
      ) : !punches ? (
        <div className="flex justify-center p-8" role="status">
          <Loader2 className="animate-spin" />
        </div>
      ) : (
        <Table
          head={[
            'الموظف',
            'الفرع',
            'البصمات',
            'فترات الشغل',
            'الوقت الكلي',
            'استراحة',
            'صافي الشغل',
            'ملاحظة',
          ]}
          empty={!rows.length}
        >
          {rows.map((row) => (
            <tr key={row.key}>
              <Cell strong>{row.name}</Cell>
              <Cell>{row.branch || '—'}</Cell>
              <Cell>{row.punches.map((p) => cairoTime(p)).join(' · ')}</Cell>
              <Cell>
                {row.sessions
                  .map((s) => `${cairoTime(s.start)}–${s.end ? cairoTime(s.end) : '؟'}`)
                  .join('، ')}
              </Cell>
              <Cell>{row.grossMinutes ? minutesLabel(row.grossMinutes) : '—'}</Cell>
              <Cell>{row.breakMinutes ? minutesLabel(row.breakMinutes) : '—'}</Cell>
              <Cell>{row.workMinutes ? minutesLabel(row.workMinutes) : '—'}</Cell>
              <Cell>
                {row.singlePunch ? (
                  <span className="dawaa-badge dawaa-badge--danger">
                    بصمة واحدة فقط (نسي الحضور أو الانصراف)
                  </span>
                ) : row.unpaired ? (
                  <span className="dawaa-badge dawaa-badge--warning">آخر بصمة من غير انصراف</span>
                ) : !row.staffId ? (
                  <span className="dawaa-badge dawaa-badge--warning">كود مش متربط بموظف</span>
                ) : null}
              </Cell>
            </tr>
          ))}
        </Table>
      )}
    </Panel>
  );
}

function EmployeesTab({ employees }: { employees: DrWaelEmployee[] }) {
  const days = employees[0]?.week || [];
  return (
    <Panel className="p-5">
      <SectionTitle
        title="الموظفين وجداولهم"
        subtitle="جدول آخر 7 أيام لحد النهارده من الجداول المعتمدة"
        icon={<Users size={20} />}
      />
      <Table
        head={['الموظف', 'الفرع', 'الوظيفة', 'الحالة', ...days.map((d) => weekday(d.date))]}
        empty={!employees.length}
      >
        {employees.map((e) => (
          <tr key={e.staff_id}>
            <Cell strong>{e.name}</Cell>
            <Cell>{e.branch}</Cell>
            <Cell>{e.delivery ? 'توصيل' : e.type || e.role || '—'}</Cell>
            <Cell>
              <span
                className={`dawaa-badge ${e.active ? 'dawaa-badge--success' : 'dawaa-badge--neutral'}`}
              >
                {e.active ? 'نشط' : 'غير نشط'}
              </span>
            </Cell>
            {e.week.map((d) => (
              <Cell key={d.date}>
                {!d.scheduled ? '—' : d.off ? 'راحة' : `${hhmm(d.start)}–${hhmm(d.end)}`}
              </Cell>
            ))}
          </tr>
        ))}
      </Table>
    </Panel>
  );
}

function ReportsTab({ data, employees }: { data: Data; employees: DrWaelEmployee[] }) {
  const rows = employees.map((e) => ({
    employee: e,
    summary: summarizeEmployee(e.staff_id, data.days),
  }));
  return (
    <Panel className="p-5">
      <SectionTitle
        title="تقارير الموظفين"
        subtitle={`ملخص كل موظف في ${cycleLabel(data.month_cycle)}`}
      />
      <Table
        head={[
          'الموظف',
          'الفرع',
          'أيام شغل',
          'الساعات',
          'ساعات محسوبة للمرتب',
          'أيام تأخير',
          'دقائق تأخير',
          'انصراف مبكر',
          'غياب',
          'راحة',
          'إجازة / إذن',
          'مراجعة',
          'بصمة واحدة',
        ]}
        empty={!rows.length}
      >
        {rows.map(({ employee, summary }) => (
          <tr key={employee.staff_id}>
            <Cell strong>{employee.name}</Cell>
            <Cell>{employee.branch}</Cell>
            <Cell>{summary.workedDays}</Cell>
            <Cell>{hoursText(summary.hours)}</Cell>
            <Cell>{hoursText(summary.payableHours)}</Cell>
            <Cell>{summary.lateDays}</Cell>
            <Cell>{minutesLabel(summary.lateMinutes)}</Cell>
            <Cell>{minutesLabel(summary.earlyLeaveMinutes)}</Cell>
            <Cell>{summary.absentDays}</Cell>
            <Cell>{summary.offDays}</Cell>
            <Cell>{summary.timeOffDays}</Cell>
            <Cell>{summary.reviewDays}</Cell>
            <Cell>{summary.singlePunchDays}</Cell>
          </tr>
        ))}
      </Table>
    </Panel>
  );
}

function LeavesTab({
  data,
  employees,
  names,
}: {
  data: Data;
  employees: DrWaelEmployee[];
  names: Map<string, DrWaelEmployee>;
}) {
  const ids = new Set(employees.map((e) => e.staff_id));
  const rows = data.time_off.filter((row) => ids.has(row.staff_id));
  return (
    <Panel className="p-5">
      <SectionTitle
        title="الإجازات والأذونات"
        subtitle="الطلبات اللي بتلمس الفترة (من غير الملغية)"
        icon={<CalendarDays size={20} />}
      />
      <Table
        head={['الموظف', 'النوع', 'من', 'إلى', 'المدة', 'الحالة', 'السبب', 'اعتمدها']}
        empty={!rows.length}
      >
        {rows.map((row) => (
          <tr key={row.id}>
            <Cell strong>{names.get(row.staff_id)?.name || '—'}</Cell>
            <Cell>{row.label || TIME_OFF_KINDS[row.kind] || row.kind}</Cell>
            <Cell>
              {row.start_date}
              {row.start_time ? ` ${hhmm(row.start_time)}` : ''}
            </Cell>
            <Cell>
              {row.end_date}
              {row.end_time ? ` ${hhmm(row.end_time)}` : ''}
            </Cell>
            <Cell>
              {row.minutes
                ? minutesLabel(row.minutes)
                : `${Math.round((Date.parse(row.end_date) - Date.parse(row.start_date)) / 864e5) + 1} يوم`}
            </Cell>
            <Cell>
              <span
                className={`dawaa-badge ${row.status === 'approved' ? 'dawaa-badge--success' : 'dawaa-badge--warning'}`}
              >
                {row.status === 'approved' ? 'معتمدة' : 'في الانتظار'}
              </span>
            </Cell>
            <Cell>{row.reason || '—'}</Cell>
            <Cell>{row.decided_by || '—'}</Cell>
          </tr>
        ))}
      </Table>
    </Panel>
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
  const ids = new Set(employees.map((e) => e.staff_id));
  const totals = employees.map((e) => ({ employee: e, money: employeeMoney(e.staff_id, data) }));
  const manual = data.manual_entries.filter((row) => ids.has(row.staff_id));
  const movements = data.movements.filter((row) => ids.has(row.staff_id));
  return (
    <div className="space-y-5">
      <Panel className="p-5">
        <SectionTitle
          title="الحوافز والخصومات لكل موظف"
          subtitle="الحوافز الآلية المعتمدة + حركات الحوافز والجزاءات + السلف والخصومات اليدوية في المرتب"
          icon={<Wallet size={20} />}
        />
        <Table
          head={[
            'الموظف',
            'حافز الأداء',
            'حافز التارجت',
            'إجمالي الحوافز الآلية',
            'مكافآت بمبلغ',
            'جزاءات بمبلغ',
            'إضافات يدوية',
            'سلف وخصومات يدوية',
          ]}
          empty={!totals.length}
        >
          {totals.map(({ employee, money: m }) => (
            <tr key={employee.staff_id}>
              <Cell strong>{employee.name}</Cell>
              <Cell>{money(m.performanceIncentive)}</Cell>
              <Cell>{money(m.targetBonus)}</Cell>
              <Cell>{money(m.automatedIncentives)}</Cell>
              <Cell>{money(m.rewards)}</Cell>
              <Cell>{money(m.penalties)}</Cell>
              <Cell>{money(m.manualEarnings)}</Cell>
              <Cell>{money(m.manualDeductions)}</Cell>
            </tr>
          ))}
        </Table>
      </Panel>
      <Panel className="p-5">
        <SectionTitle
          title="السلف والخصومات والإضافات اليدوية"
          subtitle="القيود اليدوية على مرتب الفترة كما اتسجلت في المرتبات"
        />
        <Table
          head={['الموظف', 'النوع', 'البند', 'المبلغ', 'السبب', 'سجّلها', 'التاريخ']}
          empty={!manual.length}
        >
          {manual.map((row) => (
            <tr key={row.id}>
              <Cell strong>{names.get(row.staff_id)?.name || '—'}</Cell>
              <Cell>
                {row.kind === 'earning'
                  ? 'إضافة'
                  : row.kind === 'deduction'
                    ? 'خصم / سلفة'
                    : 'تسوية'}
                {row.reversal_of ? ' (عكس قيد)' : ''}
              </Cell>
              <Cell>{row.category}</Cell>
              <Cell>{money(row.signed_amount)}</Cell>
              <Cell>{row.reason || '—'}</Cell>
              <Cell>{row.created_by || '—'}</Cell>
              <Cell>{row.created_at.slice(0, 10)}</Cell>
            </tr>
          ))}
        </Table>
      </Panel>
      <Panel className="p-5">
        <SectionTitle
          title="حركات الحوافز والجزاءات"
          subtitle="الحركات اللي ليها مبلغ في سجل الموظف للفترة"
        />
        <Table
          head={['التاريخ', 'الموظف', 'النوع', 'البند', 'السبب', 'المبلغ']}
          empty={!movements.length}
        >
          {movements.map((row) => (
            <tr key={row.id}>
              <Cell>{row.date}</Cell>
              <Cell strong>{names.get(row.staff_id)?.name || '—'}</Cell>
              <Cell>
                <span
                  className={`dawaa-badge ${row.type === 'reward' ? 'dawaa-badge--success' : 'dawaa-badge--danger'}`}
                >
                  {row.type === 'reward' ? 'حافز' : 'جزاء'}
                </span>
              </Cell>
              <Cell>{row.category || '—'}</Cell>
              <Cell>{row.reason || '—'}</Cell>
              <Cell>{money(row.amount)}</Cell>
            </tr>
          ))}
        </Table>
      </Panel>
    </div>
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
  const picked = rows?.find((r) => r.staffId === selected)?.row || null;
  return (
    <div className="space-y-5">
      <Panel className="p-5">
        <SectionTitle
          title="المرتبات"
          subtitle="من محرك المرتبات المعتمد في التطبيق (معاينة لحد ما الفترة تتقفل). اضغط على موظف لقسيمة المرتب."
          icon={<Wallet size={20} />}
        />
        {loading || !rows ? (
          <div className="flex items-center justify-center gap-2 p-8" role="status">
            <Loader2 className="animate-spin" /> جارٍ حساب المرتبات من المحرك…
          </div>
        ) : (
          <Table
            head={[
              'الموظف',
              'الفرع',
              'الأساسي',
              'الحوافز الآلية',
              'حافز اللستة',
              'الأوفر تايم',
              'إضافات',
              'خصومات',
              'الصافي',
              'الحالة',
            ]}
            empty={!rows.length}
          >
            {rows.map(({ staffId, row, error }) => (
              <tr
                key={staffId}
                className="cursor-pointer hover:bg-[var(--dawaa-theme-surface)]"
                onClick={() => setSelected(staffId)}
              >
                <Cell strong>{byId.get(staffId)?.name}</Cell>
                <Cell>{byId.get(staffId)?.branch}</Cell>
                {row ? (
                  <>
                    <Cell>{money(row.earnings.base_salary)}</Cell>
                    <Cell>{money(row.earnings.automated_incentives_total)}</Cell>
                    <Cell>{money(row.earnings.list_incentive)}</Cell>
                    <Cell>{money(row.earnings.approved_overtime)}</Cell>
                    <Cell>
                      {money(
                        row.earnings.manual_other_incentives + row.adjustments.manual_adjustment
                      )}
                    </Cell>
                    <Cell>{money(row.adjustments.deductions_total)}</Cell>
                    <Cell strong>{money(row.display_net_salary)}</Cell>
                    <Cell>
                      <span
                        className={`dawaa-badge ${row.frozen ? 'dawaa-badge--success' : 'dawaa-badge--warning'}`}
                      >
                        {row.frozen ? 'مقفول' : 'معاينة'}
                      </span>
                    </Cell>
                  </>
                ) : (
                  <td
                    colSpan={8}
                    className="px-3 py-2 text-xs font-bold text-[var(--dawaa-status-danger-text)]"
                  >
                    {error?.includes('not_authorized')
                      ? 'مفيش صلاحية مرتبات على الموظف ده'
                      : 'تعذر حساب المرتب'}
                  </td>
                )}
              </tr>
            ))}
          </Table>
        )}
        <button
          className="dawaa-button dawaa-button--ghost mt-3"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> إعادة حساب
        </button>
      </Panel>
      {picked && selected ? (
        <Payslip name={byId.get(selected)?.name || ''} cycle={cycle} row={picked} />
      ) : null}
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
    <Panel className="p-5">
      <SectionTitle title={`قسيمة مرتب · ${name}`} subtitle={cycleLabel(cycle)} />
      <dl className="grid gap-2 sm:grid-cols-2">
        {lines
          .filter(([, value]) => Number(value || 0) !== 0)
          .map(([label, value]) => (
            <div
              key={label}
              className="flex justify-between rounded-xl border border-[var(--dawaa-theme-accent-border)] px-3 py-2 text-sm"
            >
              <dt className="font-bold">{label}</dt>
              <dd className="font-black">{money(value)}</dd>
            </div>
          ))}
      </dl>
      <div className="mt-3 flex justify-between rounded-xl border border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] px-3 py-3 text-base font-black">
        <span>الصافي {row.frozen ? '(مقفول)' : '(معاينة)'}</span>
        <span>{money(row.display_net_salary)}</span>
      </div>
      {row.blockers?.length ? (
        <p className="dawaa-caption mt-2 text-xs font-bold">
          فيه {row.blockers.length} حاجة لسه بتمنع قفل المرتب (راجعها في صفحة المرتبات).
        </p>
      ) : null}
    </Panel>
  );
}
