import { useEffect, useState, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useDebounce } from '@/hooks/useDebounce';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { Search, Plus, Phone, Edit2, Loader2, Eye, ClipboardList } from 'lucide-react';
import { logActivity } from '@/hooks/useSupabaseQuery';
import { isCurrentlyOnShift, matchesOrderedSegments, percent } from '@/lib/utils';
import { getCurrentCycle } from '@/lib/pharmacy-cycle';
import {
  getTransactionShortReason,
  isApprovedPointRecord,
  isRecordInCycle,
  pointRecordDelta,
  recordBelongsToStaff,
  type PointLedgerRecord,
} from '@/lib/pointsLedger';
import { calculateStaffCycleIncentiveFromRows } from '@/lib/staffIncentiveService';
import { normalizeStaffName } from '@/lib/staffIdentityService';
import { BRANCHES, DAYS_AR, ROLES, INITIAL_POINTS } from '@/lib/constants';
import { useAuth, getSafeCurrentUserId } from '@/hooks/useAuth';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { normalizeBranchName } from '@/lib/branch';
import { toast } from 'sonner';
import type { User } from '@/types';
import { useStaff } from '@/hooks/useStaff';
import { filterActiveStaffRows, staffRowVisibleInSchedule } from '@/lib/staffActiveFilter';
import { mergeStaffChoices } from '@/lib/staffFallback';
import { useShiftSchedules } from '@/hooks/useShiftSchedules';
import { useEmployeeTransactions } from '@/hooks/useEmployeeTransactions';
import { friendlySupabaseError } from '@/lib/supabaseError';
import {
  createStaff,
  updateStaff,
  createStaffAccount,
  updateStaffAccountByStaffId,
} from '@/services/staffService';
import { replaceStaffShiftSchedules } from '@/services/shiftScheduleService';
import {
  fetchCurrentShiftPresence,
  type ShiftPresencePerson,
} from '@/lib/attendance/currentShiftPresenceService';
import { staffProfilePath } from '@/lib/staff/staffIdentityResolver';

interface Employee {
  id: string;
  name: string;
  username?: string;
  phone?: string | null;
  role: string;
  role_label?: string | null;
  job_title?: string | null;
  branch: string;
  branch_id?: string;
  shift_start?: string | null;
  shift_end?: string | null;
  holiday_day?: string | null;
  points?: number | null;
  max_points: number;
  status?: string | null;
  join_date?: string | null;
  notes?: string | null;
  visible_in_schedule?: boolean | null;
}

function staffRoleLabel(role: string) {
  if (role === 'pharmacist' || role === 'صيدلاني') return 'صيدلانية';
  if (role === 'shift_supervisor_morning' || role === 'مسئولة شيفت صباحي' || role === 'مسئول شيفت صباحي') return 'مسئولة شيفت صباحي';
  if (role === 'shift_supervisor_evening' || role === 'مسئولة شيفت مسائي' || role === 'مسئول شيفت مسائي') return 'مسئول شيفت مسائي';
  return role;
}

function canonicalStaffRole(role: string) {
  if (role === 'صيدلاني' || role === 'صيدلي' || role === 'pharmacist') return 'pharmacist';
  if (role === 'مسئولة شيفت صباحي' || role === 'مسئول شيفت صباحي' || role === 'مشرف شيفت صباحي' || role === 'shift_supervisor_morning') return 'shift_supervisor_morning';
  if (role === 'مسئولة شيفت مسائي' || role === 'مسئول شيفت مسائي' || role === 'مشرف شيفت مسائي' || role === 'shift_supervisor_evening') return 'shift_supervisor_evening';
  if (role === 'توصيل') return 'delivery';
  if (role === 'خدمة عملاء') return 'customer_service';
  return role;
}

function staffTypeForRole(role: string) {
  const canonical = canonicalStaffRole(role);
  if (canonical === 'pharmacist') return 'Pharmacist';
  if (canonical === 'delivery') return 'Delivery';
  return role;
}

function onlyChanged<T extends Record<string, unknown>>(next: T, current: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(next).filter(([key, value]) => String(current[key] ?? '') !== String(value ?? ''))
  ) as Partial<T>;
}

interface ShiftSchedule {
  id: string;
  staff_id?: string;
  staff_name: string;
  branch: string;
  branch_id?: string;
  day_name: string;
  shift_start: string | null;
  shift_end: string | null;
  is_off: boolean | null;
  notes?: string | null;
}

interface EmployeeTransaction {
  id: string;
  staff_id?: string | null;
  employee_id?: string | null;
  employee_name?: string | null;
  type?: string | null;
  points?: number | null;
  amount?: number | null;
  points_delta?: number | null;
  reason: string;
  description?: string | null;
  source?: string | null;
  source_id?: string | null;
  created_at: string;
  month_cycle?: string | null;
  branch?: string | null;
  status?: string | null;
}

type LiveShiftRow = {
  id: string;
  name: string;
  role: string;
  branch: string;
  shift_start?: string | null;
  shift_end?: string | null;
  attendance_status?: string | null;
};

function fromPresence(person: ShiftPresencePerson): LiveShiftRow {
  return {
    id: person.id,
    name: person.name,
    role: person.role,
    branch: person.branch,
    shift_start: person.shift_start,
    shift_end: person.shift_end,
    attendance_status: person.attendance_status,
  };
}

function transactionPoints(row: Pick<EmployeeTransaction, 'points' | 'points_delta'>) {
  return Math.abs(pointRecordDelta(row));
}

function uniqueEmployeesByIdentity(rows: Employee[]) {
  const map = new Map<string, Employee>();
  for (const row of rows) {
    const key = row.id || `${normalizeStaffName(row.name)}__${row.branch || ''}__${row.role || ''}`;
    if (!map.has(key)) map.set(key, row);
  }
  return [...map.values()];
}

function staffDisplayName(employee: Pick<Employee, 'name' | 'branch' | 'role'>, allRows: Employee[]) {
  const key = normalizeStaffName(employee.name);
  const duplicates = allRows.filter((row) => normalizeStaffName(row.name) === key);
  if (duplicates.length <= 1) return employee.name;
  const suffix = [employee.branch, employee.role].filter(Boolean).join(' - ');
  return suffix ? `${employee.name} (${suffix})` : employee.name;
}

function pointsTone(pointsPct: number) {
  if (pointsPct >= 90) return 'dawaa-badge--success';
  if (pointsPct >= 70) return 'dawaa-badge--warning';
  return 'dawaa-badge--danger';
}

export default function Team() {
  const { user, canManage } = useAuth();
  const canCreateTeam = canManage || user?.permissions?.create_team_member === true;
  const canEditTeam = canManage || user?.permissions?.edit_team_member === true;
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get('search') || '');
  const debouncedSearch = useDebounce(search, 300);

  useEffect(() => {
    setSearch(searchParams.get('search') || '');
  }, [searchParams]);

  const [branchFilter, setBranchFilter] = useState(() => canViewAllBranches(user) ? 'الكل' : (normalizeBranchName(user?.branch || '') || 'الكل'));
  const [roleFilter, setRoleFilter] = useState('الكل');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [viewing, setViewing] = useState<Employee | null>(null);
  const [livePresence, setLivePresence] = useState<{
    doctors: LiveShiftRow[];
    assistants: LiveShiftRow[];
    delivery: LiveShiftRow[];
    total: number;
    debug?: string;
  } | null>(null);

  useEffect(() => {
    let mounted = true;
    fetchCurrentShiftPresence()
      .then((presence) => {
        if (!mounted) return;
        setLivePresence({
          doctors: presence.doctors.map(fromPresence),
          assistants: presence.assistants.map(fromPresence),
          delivery: presence.delivery.map(fromPresence),
          total: presence.total,
          debug: presence.debug
            ? `${presence.debug.todayArabic} — ${presence.debug.fetchedShiftCount} شيفت / ${presence.debug.attendanceCount} حضور — ${presence.debug.source}`
            : undefined,
        });
      })
      .catch(() => {
        if (mounted) setLivePresence(null);
      });
    return () => { mounted = false; };
  }, []);

  const { data: staffRows, loading, refetch } = useStaff<Employee>();
  const employees = useMemo(
    () => mergeStaffChoices(filterActiveStaffRows(staffRows).filter(staffRowVisibleInSchedule)),
    [staffRows]
  );
  const { data: schedules, loading: schedulesLoading } = useShiftSchedules<ShiftSchedule>();
  const { data: employeeTransactions } = useEmployeeTransactions<EmployeeTransaction>();
  const pointRecords = employeeTransactions as PointLedgerRecord[];
  const cycle = getCurrentCycle();
  const todayName = DAYS_AR[new Date().getDay()];

  const todayShift = (employee: Employee) => schedules.find(
    (item) =>
      (item.staff_id === employee.id || item.staff_name === employee.name) &&
      item.branch === employee.branch &&
      item.day_name === todayName
  );

  const holidayDay = (employee: Employee) =>
    schedules.find(
      (item) => (item.staff_id === employee.id || item.staff_name === employee.name) && item.branch === employee.branch && item.is_off
    )?.day_name || employee.holiday_day || 'غير محدد';

  const getEmployeeTransactions = (employee: Employee) =>
    (employeeTransactions || []).filter((transaction) => recordBelongsToStaff(transaction as PointLedgerRecord, employee));

  const filtered = useMemo(
    () => employees.filter((e) => {
      const raw = debouncedSearch.trim();
      const haystack = `${e.name} ${e.phone || ''} ${e.role || ''}`;
      const matchSearch = !raw || matchesOrderedSegments(haystack, raw);
      const matchBranch = branchFilter === 'الكل' || e.branch === branchFilter;
      const matchRole = roleFilter === 'الكل' || e.role === roleFilter;
      return matchSearch && matchBranch && matchRole;
    }),
    [employees, debouncedSearch, branchFilter, roleFilter]
  );
  const displayEmployees = useMemo(() => uniqueEmployeesByIdentity(filtered), [filtered]);

  const onShiftNow = employees.filter((e) => {
    const shift = todayShift(e);
    return Boolean(
      shift?.shift_start &&
      shift?.shift_end &&
      !shift.is_off &&
      isCurrentlyOnShift(shift.shift_start, shift.shift_end) &&
      e.status === 'نشط'
    );
  });
  const doctors = onShiftNow.filter((e) => e.role === 'صيدلاني');
  const assistants = onShiftNow.filter((e) => e.role === 'مساعد');
  const deliveryNow = onShiftNow.filter((e) => e.role === 'توصيل');

  const liveCards = (livePresence?.total
    ? [
        { title: 'صيادلة على الشيفت', list: livePresence.doctors },
        { title: 'مساعدون على الشيفت', list: livePresence.assistants },
        { title: 'توصيل على الشيفت', list: livePresence.delivery },
      ]
    : [
        { title: 'صيادلة على الشيفت', list: doctors as LiveShiftRow[] },
        { title: 'مساعدون على الشيفت', list: assistants as LiveShiftRow[] },
        { title: 'توصيل على الشيفت', list: deliveryNow as LiveShiftRow[] },
      ]
  ).map((card) => ({
    ...card,
    list: canViewAllBranches(user)
      ? card.list
      : card.list.filter((row) => normalizeBranchName(row.branch) === normalizeBranchName(user?.branch || '')),
  }));

  const roles = [...new Set(employees.map((e) => e.role))];
  const visibleBranches = useMemo(
    () => canViewAllBranches(user) ? BRANCHES : BRANCHES.filter((b) => normalizeBranchName(b) === normalizeBranchName(user?.branch || '')),
    [user]
  );
  const branchRankings = useMemo(() => {
    const uniqueEmployees = uniqueEmployeesByIdentity(employees);
    return visibleBranches.map((branch) => {
      const branchEmployees = uniqueEmployees
        .filter((employee) => employee.branch === branch)
        .map((employee) => ({
          ...employee,
          cyclePoints: calculateStaffCycleIncentiveFromRows({ staff: employee, records: pointRecords || [], cycle }).finalPoints,
        }))
        .sort((a, b) => b.cyclePoints - a.cyclePoints);
      return {
        branch,
        doctors: branchEmployees.filter((employee) => /صيد|دكتور|pharmacist|doctor/i.test(employee.role || '')),
        delivery: branchEmployees.filter((employee) => /توصيل|دليفري|delivery/i.test(employee.role || '')),
      };
    }).filter((group) => group.doctors.length || group.delivery.length);
  }, [cycle, employees, pointRecords, visibleBranches]);

  if (loading || schedulesLoading) return <LoadingState />;

  return (
    <div className="dawaa-page space-y-5" dir="rtl">
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {liveCards.map(({ title, list }) => (
          <article key={title} className="dawaa-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="dawaa-title text-sm">{title}</div>
              <span className="dawaa-badge dawaa-badge--info num text-sm">{list.length}</span>
            </div>
            <div className="space-y-2">
              {list.length === 0 ? (
                <div className="dawaa-caption py-2 text-xs">لا يوجد حالياً</div>
              ) : (
                list.map((e) => (
                  <div key={e.id} className="flex items-center gap-2.5">
                    <span className="h-2 w-2 rounded-full bg-[var(--dawaa-status-success-text)]" />
                    <span className="dawaa-body text-xs font-medium">{e.name}</span>
                    <span className="dawaa-caption mr-auto text-xs">{e.shift_start || '-'}–{e.shift_end || '-'}</span>
                    <span className="dawaa-badge text-[10px]">{e.attendance_status || 'مجدول'}</span>
                  </div>
                ))
              )}
            </div>
          </article>
        ))}
      </section>

      {livePresence?.debug && (
        <div className="dawaa-alert dawaa-alert--info px-4 py-3 text-xs font-bold">
          مصدر جدول الشيفت: {livePresence.debug}. يتم عرض المجدولين حتى لو لم يبصموا.
        </div>
      )}

      <section className="dawaa-card space-y-4 p-5">
        <div className="dawaa-title text-sm">ترتيب الفريق حسب الفروع</div>
        <div className="grid gap-4 lg:grid-cols-2">
          {branchRankings.map((group) => (
            <article key={group.branch} className="overflow-hidden rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)]">
              <div className="dawaa-title border-b border-[var(--dawaa-theme-divider)] px-4 py-3">{group.branch}</div>
              <RankingList title="الدكاترة والصيادلة" rows={group.doctors} />
              <RankingList title="الدليفري" rows={group.delivery} />
            </article>
          ))}
        </div>
      </section>

      <section className="dawaa-toolbar">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--dawaa-theme-muted)]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث في الفريق..." className="dawaa-input pr-10" />
        </div>
        {canViewAllBranches(user) ? (
          <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="dawaa-select md:w-40">
            <option value="الكل">كل الفروع</option>
            {BRANCHES.map((b) => <option key={b}>{b}</option>)}
          </select>
        ) : (
          <div className="dawaa-input flex items-center md:w-40">{branchFilter}</div>
        )}
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="dawaa-select md:w-40">
          <option value="الكل">كل الأدوار</option>
          {roles.map((r) => <option key={r}>{r}</option>)}
        </select>
        {canCreateTeam && (
          <button onClick={() => setShowAddModal(true)} className="dawaa-button dawaa-button--primary"><Plus size={16} /> موظف جديد</button>
        )}
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {displayEmployees.map((emp) => {
          const shift = todayShift(emp);
          const onShift = Boolean(
            shift?.shift_start && shift?.shift_end && !shift.is_off && isCurrentlyOnShift(shift.shift_start, shift.shift_end) && emp.status === 'نشط'
          );
          const incentive = calculateStaffCycleIncentiveFromRows({ staff: emp, records: pointRecords || [], cycle });
          const points = incentive.finalPoints;
          const maxPoints = incentive.startingPoints;
          const pointsPct = percent(points, maxPoints);
          const penalties = incentive.deductionTransactions.length;
          const bonuses = incentive.rewardTransactions.length;
          const penaltyPoints = incentive.approvedDeductionPoints;
          const bonusPoints = incentive.approvedRewardPoints;

          return (
            <article key={emp.id} className="dawaa-card dawaa-card--interactive p-5">
              <div className="flex items-start gap-3">
                <div className="relative">
                  <div className="dawaa-icon-tile h-12 w-12 rounded-full text-lg font-bold">{emp.name[0]}</div>
                  {onShift && <span className="absolute -bottom-0.5 -left-0.5 h-3.5 w-3.5 rounded-full border-2 border-[var(--dawaa-theme-surface)] bg-[var(--dawaa-status-success-text)]" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="dawaa-title text-sm">{emp.name}</div>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <span className="dawaa-badge dawaa-badge--info">{emp.role}</span>
                    <span className="dawaa-caption text-xs">{emp.branch}</span>
                  </div>
                </div>
                {canEditTeam && <button onClick={() => setEditing(emp)} className="dawaa-action-icon p-1.5" title="تعديل الموظف"><Edit2 size={14} /></button>}
                <Link to={staffProfilePath(emp)} className="dawaa-action-icon p-1.5" title="ملف الأداء الشامل"><ClipboardList size={14} /></Link>
                <button type="button" onClick={() => setViewing(emp)} className="dawaa-action-icon p-1.5" title="تفاصيل الموظف"><Eye size={14} /></button>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-[var(--dawaa-theme-surface-2)] p-2.5"><div className="dawaa-caption">الشيفت</div><div className="dawaa-body mt-0.5 font-medium">{shift?.is_off ? 'إجازة اليوم' : `${shift?.shift_start || '-'} — ${shift?.shift_end || '-'}`}</div></div>
                <div className="rounded-lg bg-[var(--dawaa-theme-surface-2)] p-2.5"><div className="dawaa-caption">إجازة</div><div className="dawaa-body mt-0.5 font-medium">{holidayDay(emp)}</div></div>
              </div>

              <div className="mt-3">
                <div className="mb-1.5 flex items-center justify-between text-xs"><span className="dawaa-caption">النقاط</span><span className={`dawaa-badge ${pointsTone(pointsPct)} num`}>{points} / {maxPoints}</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-[var(--dawaa-theme-soft)]"><div className="h-full rounded-full bg-[var(--dawaa-theme-primary)] transition-all duration-500" style={{ width: `${Math.max(0, Math.min(100, pointsPct))}%` }} /></div>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2"><Phone size={12} className="text-[var(--dawaa-theme-muted)]" /><span className="dawaa-caption text-xs">{emp.phone || 'بدون رقم'}</span></div>
                <div className="flex flex-wrap items-center gap-2">
                  {penalties > 0 && <Link to={`/points?staff_id=${emp.id}`} className="dawaa-badge dawaa-badge--danger hover:underline">جزاء: {penalties} / {penaltyPoints} نقطة</Link>}
                  {bonuses > 0 && <Link to={`/points?staff_id=${emp.id}`} className="dawaa-badge dawaa-badge--success hover:underline">مكافأة: {bonuses} / {bonusPoints} نقطة</Link>}
                  <span className={`dawaa-badge ${onShift ? 'dawaa-badge--success' : ''}`}>{onShift ? '● على الشيفت' : '○ خارج الشيفت'}</span>
                </div>
              </div>

              <div className="mt-3 flex gap-2">
                <Link to={`/invoices?seller_name=${encodeURIComponent(emp.name)}`} className="dawaa-button dawaa-button--secondary flex-1 py-2 text-center text-xs">الفواتير</Link>
                <Link to={`/points?staff_id=${emp.id}`} className="dawaa-button dawaa-button--secondary flex-1 py-2 text-center text-xs">النقاط</Link>
              </div>
            </article>
          );
        })}
      </section>

      {showAddModal && <EmployeeModal onClose={() => setShowAddModal(false)} onSaved={refetch} user={user} />}
      {editing && <EmployeeModal employee={editing} onClose={() => setEditing(null)} onSaved={refetch} user={user} />}
      {viewing && (
        <EmployeeDetailsModal
          employee={viewing}
          schedules={schedules.filter((item) => (item.staff_id === viewing.id || item.staff_name === viewing.name) && item.branch === viewing.branch)}
          transactions={getEmployeeTransactions(viewing)}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}

interface DaySchedule {
  day: string;
  shift_start: string;
  shift_end: string;
  is_day_off: boolean;
  use_custom_schedule: boolean;
}

function EmployeeModal({ employee, onClose, onSaved, user }: { employee?: Employee; onClose: () => void; onSaved: () => void; user: User | null }) {
  const [saving, setSaving] = useState(false);
  useEscapeKey(onClose, true);
  const [form, setForm] = useState({
    name: '', username: '', password: '', account_status: 'active', phone: '', role: 'صيدلاني', role_label: 'صيدلانية', job_title: 'صيدلانية', branch: 'فرع شكري', default_shift_start: '09:00', default_shift_end: '19:00', notes: '',
  });
  const [daySchedules, setDaySchedules] = useState<DaySchedule[]>(DAYS_AR.map((day) => ({
    day, shift_start: '09:00', shift_end: '19:00', is_day_off: day === 'الجمعة', use_custom_schedule: false,
  })));

  useEffect(() => {
    if (!employee) return;
    setForm({
      name: employee.name || '',
      username: employee.username || '',
      password: '',
      account_status: employee.status === 'inactive' ? 'inactive' : 'active',
      phone: employee.phone || '',
      role: employee.role || 'صيدلاني',
      role_label: employee.role_label || staffRoleLabel(employee.role || 'صيدلاني'),
      job_title: employee.job_title || staffRoleLabel(employee.role || 'صيدلاني'),
      branch: employee.branch || 'فرع شكري',
      default_shift_start: employee.shift_start || '09:00',
      default_shift_end: employee.shift_end || '19:00',
      notes: employee.notes || '',
    });
  }, [employee]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const isActive = form.account_status === 'active';
      const canonicalRole = canonicalStaffRole(form.role);
      const payload = {
        name: form.name,
        phone: form.phone,
        role: canonicalRole,
        role_label: form.role_label || staffRoleLabel(form.role),
        job_title: form.job_title || form.role_label || staffRoleLabel(form.role),
        branch: form.branch,
        shift_start: form.default_shift_start,
        shift_end: form.default_shift_end,
        notes: form.notes,
        status: isActive ? 'active' : 'inactive',
        active: isActive,
        is_active: isActive,
        max_points: INITIAL_POINTS,
        type: staffTypeForRole(canonicalRole),
      };

      let staffId = '';
      let error: string | null = null;
      if (employee) {
        const updatePayload = onlyChanged(payload, {
          ...employee,
          role_label: employee.role_label || '',
          job_title: employee.job_title || '',
          shift_start: employee.shift_start || '',
          shift_end: employee.shift_end || '',
          active: employee.status !== 'inactive',
          is_active: employee.status !== 'inactive',
          status: employee.status === 'inactive' ? 'inactive' : 'active',
        });
        const { error: updateError } = Object.keys(updatePayload).length ? await updateStaff(employee.id, updatePayload) : { error: null };
        error = updateError ? friendlySupabaseError(updateError) : null;
        if (!error) staffId = employee.id;
      } else {
        const result = await createStaff(payload);
        error = result.error ? friendlySupabaseError(result.error) : null;
        if (!error && result.data) staffId = (result.data as Employee).id;
      }

      if (error) {
        toast.error('خطأ في الحفظ: ' + error);
        setSaving(false);
        return;
      }

      if (!employee) {
        const accountResult = await createStaffAccount({
          staff_id: staffId!,
          username: form.username,
          password_hash: form.password || null,
          password_status: form.password ? 'temporary' : null,
          name: form.name,
          staff_name: form.name,
          role: canonicalRole,
          staff_role: canonicalRole,
          role_label: form.role_label || staffRoleLabel(form.role),
          job_title: form.job_title || form.role_label || staffRoleLabel(form.role),
          branch: form.branch,
          active: form.account_status === 'active',
          can_login: form.account_status === 'active',
          visible_in_admin: true,
          permissions: {},
        });
        if (accountResult.error) toast.warning('تم حفظ الموظف لكن حساب الدخول يحتاج مراجعة.');
      } else {
        await updateStaffAccountByStaffId(employee.id, {
          name: form.name,
          staff_name: form.name,
          role: canonicalRole,
          staff_role: canonicalRole,
          role_label: form.role_label || staffRoleLabel(form.role),
          job_title: form.job_title || form.role_label || staffRoleLabel(form.role),
          branch: form.branch,
          active: isActive,
          can_login: isActive,
        });
      }

      const scheduleRecords = daySchedules.map((schedule, index) => ({
        staff_id: staffId!,
        staff_name: form.name,
        branch: form.branch,
        day_name: schedule.day,
        day_of_week: index,
        shift_start: schedule.is_day_off ? null : schedule.use_custom_schedule ? schedule.shift_start : form.default_shift_start,
        shift_end: schedule.is_day_off ? null : schedule.use_custom_schedule ? schedule.shift_end : form.default_shift_end,
        is_off: schedule.is_day_off,
        is_day_off: schedule.is_day_off,
        is_different: !schedule.is_day_off && schedule.use_custom_schedule,
        has_custom_time: !schedule.is_day_off && schedule.use_custom_schedule,
        notes: schedule.is_day_off ? 'day_off' : schedule.use_custom_schedule ? 'custom_time' : null,
      }));

      const { error: scheduleError } = await replaceStaffShiftSchedules(staffId!, scheduleRecords);
      if (scheduleError) toast.error('تم حفظ الموظف لكن حدث خطأ في حفظ المواعيد: ' + scheduleError.message);

      toast.success(employee ? 'تم تعديل بيانات الموظف' : 'تم إضافة الموظف بنجاح');
      try {
        const actorId = getSafeCurrentUserId();
        if (user && actorId) {
          await logActivity(actorId, user.name || 'النظام', employee ? 'تعديل موظف' : 'إضافة موظف', 'الفريق', `${employee ? 'تعديل' : 'إضافة'} ${form.name}`, form.branch);
        }
      } catch {
        // Activity log is secondary to saving the employee.
      }
      onSaved();
      onClose();
    } catch {
      toast.error('حدث خطأ غير متوقع أثناء الحفظ');
    }
    setSaving(false);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel max-h-[90vh] max-w-2xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 border-b border-[var(--dawaa-theme-divider)] bg-[var(--dawaa-theme-surface-raised)] p-5">
          <div className="dawaa-title text-lg">{employee ? 'تعديل بيانات الموظف' : 'إضافة موظف جديد'}</div>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="الاسم الكامل *" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="dawaa-input col-span-2" required />
            <input placeholder={employee ? 'اسم المستخدم الحالي' : 'اسم المستخدم *'} value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} className="dawaa-input" readOnly={Boolean(employee)} required={!employee} />
            {!employee ? (
              <input placeholder="كلمة المرور *" type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} className="dawaa-input" required />
            ) : (
              <div className="dawaa-input flex items-center text-sm">كلمة المرور لا تتغير من شاشة تعديل البيانات</div>
            )}
            <input placeholder="رقم الهاتف" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className="dawaa-input" />
            <select value={form.role} onChange={(e) => { const role = e.target.value; const label = staffRoleLabel(role); setForm((f) => ({ ...f, role, role_label: label, job_title: label })); }} className="dawaa-select">
              {Array.from(new Set([form.role, ...ROLES])).filter(Boolean).map((r) => <option key={r}>{r}</option>)}
            </select>
            <input placeholder="وسم الدور" value={form.role_label} onChange={(e) => setForm((f) => ({ ...f, role_label: e.target.value }))} className="dawaa-input" />
            <input placeholder="المسمى الوظيفي" value={form.job_title} onChange={(e) => setForm((f) => ({ ...f, job_title: e.target.value }))} className="dawaa-input" />
            <select value={form.branch} onChange={(e) => setForm((f) => ({ ...f, branch: e.target.value }))} className="dawaa-select">{BRANCHES.map((b) => <option key={b}>{b}</option>)}</select>
            <select value={form.account_status} onChange={(e) => setForm((f) => ({ ...f, account_status: e.target.value }))} className="dawaa-select"><option value="active">نشط</option><option value="inactive">موقوف</option></select>
          </div>

          <section className="dawaa-card dawaa-card--soft p-4">
            <div className="dawaa-title mb-3 text-sm">الميعاد الأساسي</div>
            <div className="grid grid-cols-2 gap-3">
              <label className="dawaa-caption text-xs">من<input type="time" value={form.default_shift_start} onChange={(e) => setForm((f) => ({ ...f, default_shift_start: e.target.value }))} className="dawaa-input mt-1" /></label>
              <label className="dawaa-caption text-xs">إلى<input type="time" value={form.default_shift_end} onChange={(e) => setForm((f) => ({ ...f, default_shift_end: e.target.value }))} className="dawaa-input mt-1" /></label>
            </div>
          </section>

          <section className="dawaa-card dawaa-card--soft p-4">
            <div className="dawaa-title mb-3 text-sm">المواعيد الأسبوعية</div>
            <div className="space-y-2">
              {daySchedules.map((schedule, index) => (
                <div key={schedule.day} className="flex flex-wrap items-center gap-3 rounded-lg bg-[var(--dawaa-theme-surface)] p-2">
                  <div className="dawaa-body w-20 text-sm font-medium">{schedule.day}</div>
                  <label className="dawaa-caption flex items-center gap-2 text-xs"><input type="checkbox" checked={schedule.is_day_off} onChange={(e) => { const next = [...daySchedules]; next[index].is_day_off = e.target.checked; setDaySchedules(next); }} /> إجازة</label>
                  {!schedule.is_day_off && (
                    <>
                      <label className="dawaa-caption flex items-center gap-2 text-xs"><input type="checkbox" checked={schedule.use_custom_schedule} onChange={(e) => { const next = [...daySchedules]; next[index].use_custom_schedule = e.target.checked; setDaySchedules(next); }} /> ميعاد مختلف</label>
                      {schedule.use_custom_schedule && (
                        <><input type="time" value={schedule.shift_start} onChange={(e) => { const next = [...daySchedules]; next[index].shift_start = e.target.value; setDaySchedules(next); }} className="dawaa-input max-w-32 py-1 text-xs" /><span className="dawaa-caption">-</span><input type="time" value={schedule.shift_end} onChange={(e) => { const next = [...daySchedules]; next[index].shift_end = e.target.value; setDaySchedules(next); }} className="dawaa-input max-w-32 py-1 text-xs" /></>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>

          <textarea placeholder="ملاحظات" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} className="dawaa-textarea resize-none" />
          <div className="flex gap-3 pt-1">
            <button type="submit" disabled={saving} className="dawaa-button dawaa-button--primary flex-1">{saving && <Loader2 size={16} className="animate-spin" />} حفظ</button>
            <button type="button" onClick={onClose} className="dawaa-button dawaa-button--secondary flex-1">إلغاء</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RankingList({ title, rows }: { title: string; rows: Array<Employee & { cyclePoints: number }> }) {
  return (
    <div className="border-t border-[var(--dawaa-theme-divider)] p-3">
      <div className="dawaa-caption mb-2 text-xs font-bold">{title}</div>
      <div className="space-y-2">
        {rows.slice(0, 8).map((employee, index) => (
          <Link key={employee.id} to={staffProfilePath(employee)} className="dawaa-card dawaa-card--interactive flex items-center gap-3 rounded-lg px-3 py-2">
            <span className="dawaa-badge dawaa-badge--info flex h-6 w-6 items-center justify-center p-0 num">{index + 1}</span>
            <span className="dawaa-title flex-1 text-sm">{staffDisplayName(employee, rows)}</span>
            <span className="dawaa-caption text-xs">{employee.role}</span>
            <span className="dawaa-badge num">{employee.cyclePoints}</span>
          </Link>
        ))}
        {rows.length === 0 && <div className="dawaa-caption py-2 text-xs">لا توجد بيانات في هذا القسم.</div>}
      </div>
    </div>
  );
}

function EmployeeDetailsModal({ employee, schedules, transactions, onClose }: { employee: Employee; schedules: ShiftSchedule[]; transactions: EmployeeTransaction[]; onClose: () => void }) {
  useEscapeKey(onClose, true);
  const cycle = getCurrentCycle();
  const pointRecords = transactions as PointLedgerRecord[];
  const incentive = calculateStaffCycleIncentiveFromRows({ staff: employee, records: pointRecords, cycle });
  const points = incentive.finalPoints;
  const maxPoints = incentive.startingPoints;
  const activeTransactions = transactions.filter((t) => isApprovedPointRecord(t as PointLedgerRecord) && isRecordInCycle(t as PointLedgerRecord, cycle));
  const penaltyRows = activeTransactions.filter((t) => pointRecordDelta(t as PointLedgerRecord) < 0);
  const bonusRows = activeTransactions.filter((t) => pointRecordDelta(t as PointLedgerRecord) > 0);
  const permissions = schedules.filter((item) => item.is_off).length;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel max-w-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-[var(--dawaa-theme-divider)] p-5">
          <div className="dawaa-title text-lg">{staffDisplayName(employee, [employee])}</div>
          <div className="dawaa-caption text-sm">{employee.role} - {employee.branch}</div>
        </div>
        <div className="grid grid-cols-1 gap-3 p-5 md:grid-cols-3">
          <InfoBox label="التقييم الحالي" value={`${points} / ${maxPoints}`} />
          <InfoBox label="جزاءات" value={`${penaltyRows.length}`} />
          <InfoBox label="مكافآت" value={`${bonusRows.length}`} />
          <InfoBox label="إجازات/أذونات" value={`${permissions}`} />
          <InfoBox label="أداء 3 شهور" value="جاهز للربط مع النقاط" />
          <InfoBox label="أداء سنوي" value="جاهز للربط مع التقييمات" />
        </div>
        <div className="px-5 pb-5">
          <section className="dawaa-card dawaa-card--soft p-4">
            <div className="dawaa-title mb-3 text-sm">جدول الموظف</div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {schedules.map((item) => (
                <div key={item.id} className={`rounded-xl border p-3 text-center ${item.is_off ? 'dawaa-badge--danger' : 'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)]'}`}>
                  <div className="dawaa-caption text-xs">{item.day_name}</div>
                  <div className="dawaa-body mt-1 text-sm font-bold">{item.is_off ? 'إجازة' : `${item.shift_start || '-'} - ${item.shift_end || '-'}`}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
        <div className="px-5 pb-5">
          <section className="dawaa-card dawaa-card--soft p-4">
            <div className="dawaa-title mb-3 text-sm">الجزاءات والمكافآت</div>
            {activeTransactions.length === 0 ? (
              <div className="dawaa-empty-state p-4 text-sm">لا توجد جزاءات أو مكافآت مسجلة لهذا الموظف.</div>
            ) : (
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {activeTransactions.map((t) => {
                  const isPenalty = pointRecordDelta(t as PointLedgerRecord) < 0;
                  return (
                    <article key={t.id} className={`rounded-lg border p-3 ${isPenalty ? 'dawaa-badge--danger' : 'dawaa-badge--success'}`}>
                      <div className="mb-1 flex items-center justify-between"><span className="text-xs font-bold">{isPenalty ? 'جزاء' : 'مكافأة'}</span><span className="dawaa-caption text-xs">{new Date(t.created_at).toLocaleDateString('ar-EG')}</span></div>
                      <div className="dawaa-title text-sm">{getTransactionShortReason(t)}</div>
                      {t.description && <div className="dawaa-caption mt-1 text-xs">{t.description}</div>}
                      <div className="mt-2 flex flex-wrap gap-4 text-xs">
                        {(t.points !== null && t.points !== undefined) || (t.points_delta !== null && t.points_delta !== undefined) ? <span className="font-bold">النقاط: {transactionPoints(t)}</span> : null}
                        {t.amount !== null && t.amount !== undefined && <span className="font-bold">المبلغ: {t.amount} ج.م</span>}
                        {t.source && <span className="dawaa-caption">المصدر: {t.source}</span>}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
        <div className="px-5 pb-5"><button onClick={onClose} className="dawaa-button dawaa-button--secondary w-full">إغلاق</button></div>
      </div>
    </div>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return <div className="dawaa-card dawaa-card--soft p-3"><div className="dawaa-caption text-xs">{label}</div><div className="dawaa-title mt-1">{value}</div></div>;
}

function LoadingState() {
  return (
    <div className="dawaa-page space-y-4">
      <div className="grid grid-cols-3 gap-4">{[1, 2, 3].map((i) => <div key={i} className="dawaa-card h-32 animate-pulse bg-[var(--dawaa-theme-soft)]" />)}</div>
      <div className="grid grid-cols-3 gap-4">{[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="dawaa-card h-48 animate-pulse bg-[var(--dawaa-theme-soft)]" />)}</div>
    </div>
  );
}
