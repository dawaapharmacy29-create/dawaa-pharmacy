import { useEffect, useState } from 'react';
import { Stethoscope, Truck } from 'lucide-react';
import ScheduleWeekBoard from '@/components/attendance/ScheduleWeekBoard';
import type { ScheduleActualDay } from '@/lib/hr/scheduleActualCell';
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery';
import { BRANCHES } from '@/lib/constants';
import { useAuth } from '@/hooks/useAuth';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import {
  isActiveStaffFilter,
  staffRowIsActive,
  staffRowVisibleInSchedule,
} from '@/lib/staffActiveFilter';
import { parseScheduleImport, type ParsedScheduleImport } from '@/lib/shiftParser';
import { saveScheduleImport, type StaffingSaveReport } from '@/lib/api/staffing';
import { toast } from 'sonner';
import { listStaffTimeOffRequests, type StaffTimeOffRequest } from '@/lib/timeOffService';
import ScheduleIdentityGovernance from '@/components/attendance/ScheduleIdentityGovernance';
import ScheduleGovernancePanel from '@/components/attendance/ScheduleGovernancePanel';
import WorkforceScheduleCoverage from '@/components/attendance/WorkforceScheduleCoverage';
import SchedulePublishingCenter from '@/components/attendance/SchedulePublishingCenter';
import { getCanonicalScheduleWeekV2, getScheduleWeekActualsV1, type CanonicalScheduleWeekV2 } from '@/lib/hr/canonicalScheduleService';

interface Employee {
  id: string;
  name: string;
  role: string;
  branch: string;
  status: string;
  shift_start?: string | null;
  shift_end?: string | null;
  visible_in_schedule?: boolean | null;
}

function normalizeBranch(branch?: string | null) {
  const value = String(branch || '');
  if (
    value.includes('أبو العزم') ||
    value.includes('ابو العزم') ||
    value.includes('العزم') ||
    value.includes('شكري')
  )
    return 'فرع شكري';
  if (value.includes('شامي') || value.includes('الشامى')) return 'فرع الشامي';
  return value || 'غير محدد';
}

function cairoDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function addDays(date: string, days: number) {
  const base = new Date(`${date}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function sundayOf(date: string) {
  return addDays(date, -new Date(`${date}T12:00:00Z`).getUTCDay());
}

export default function Schedule() {
  const { user } = useAuth();
  const managerView = canViewAllBranches(user);
  const [branchFilter, setBranchFilter] = useState(managerView ? 'الكل' : normalizeBranch(user?.branch || ''));
  const [roleFilter, setRoleFilter] = useState('الكل');
  const [preview, setPreview] = useState<ParsedScheduleImport | null>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveReport, setSaveReport] = useState<StaffingSaveReport | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const todayDate = cairoDate();

  const { data: employees, loading } = useSupabaseQuery<Employee>({
    table: 'staff',
    filters: isActiveStaffFilter(),
    orderBy: { column: 'name', ascending: true },
    realtimeEnabled: true,
  });
  const weekStart = addDays(sundayOf(todayDate), weekOffset * 7);
  const weekDates = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const [canonicalWeek, setCanonicalWeek] = useState<CanonicalScheduleWeekV2 | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setScheduleLoading(true);
    setScheduleError(null);
    void getCanonicalScheduleWeekV2({
      weekStart,
      branch: branchFilter === 'الكل' ? null : branchFilter,
    })
      .then((data) => {
        if (!alive) return;
        setCanonicalWeek(data);
      })
      .catch((error) => {
        if (!alive) return;
        setCanonicalWeek(null);
        setScheduleError((error as Error).message);
      })
      .finally(() => {
        if (alive) setScheduleLoading(false);
      });
    return () => { alive = false; };
  }, [branchFilter, weekStart]);

  const [actuals, setActuals] = useState<Map<string, ScheduleActualDay>>(new Map());
  const [actualsError, setActualsError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setActualsError(null);
    void getScheduleWeekActualsV1({
      weekStart,
      branch: branchFilter === 'الكل' ? null : branchFilter,
    })
      .then((rows) => {
        if (alive) setActuals(new Map(rows.map((row) => [`${row.staff_id}::${row.date}`, row])));
      })
      .catch((error) => {
        if (!alive) return;
        setActuals(new Map());
        setActualsError((error as Error).message);
      });
    return () => { alive = false; };
  }, [branchFilter, weekStart]);

  const [exceptions, setExceptions] = useState<StaffTimeOffRequest[]>([]);
  useEffect(() => {
    let alive = true;
    void listStaffTimeOffRequests({ status: 'approved', limit: 300 })
      .then((rows) => { if (alive) setExceptions(rows); })
      .catch((error) => console.warn('[Schedule] canonical time-off unavailable', error));
    return () => { alive = false; };
  }, []);

  const filtered = employees.filter(
    (e) =>
      staffRowIsActive(e) &&
      staffRowVisibleInSchedule(e) &&
      (branchFilter === 'الكل' || normalizeBranch(e.branch) === branchFilter) &&
      (roleFilter === 'الكل' || e.role === roleFilter)
  );

  const scheduleFor = (emp: Employee, day: string) => {
    const staffWeek = canonicalWeek?.staff.find((item) => item.staff_id === emp.id);
    const canonical = staffWeek?.days.find((item) => item.day_name === day) || null;
    const targetDateStr = canonical?.date || '';

    const exception = targetDateStr
      ? exceptions.find(
          (item) =>
            item.staff_id === emp.id &&
            item.status === 'approved' &&
            ['annual_leave', 'sick_leave', 'exceptional_leave', 'approved_absence'].includes(item.request_kind) &&
            item.start_date <= targetDateStr &&
            item.end_date >= targetDateStr
        )
      : null;

    if (exception) {
      return {
        ...canonical,
        staff_name: emp.name,
        branch: emp.branch,
        day_name: day,
        shift_start: null,
        shift_end: null,
        is_off: true,
        is_day_off: false,
        source_kind: 'approved_time_off',
        has_schedule: true,
      };
    }

    return canonical?.has_schedule ? canonical : null;
  };

  if (loading || scheduleLoading)
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="stat-card h-16 animate-pulse bg-white/5" />
        ))}
      </div>
    );

  const handleShiftFile = async (file?: File) => {
    if (!file) return;
    setParsing(true);
    setSaveReport(null);
    try {
      const result = await parseScheduleImport(file);
      setPreview(result);
      toast.success(`تمت قراءة ${result.staffCount} عضو فريق من ملف الشيفتات`);
    } catch (error) {
      toast.error(`تعذر قراءة ملف الشيفتات: ${(error as Error).message}`);
    } finally {
      setParsing(false);
    }
  };

  const handleSavePreview = async () => {
    if (!preview) return;
    if (!preview.validation.valid) {
      toast.error('يوجد أخطاء في ملف الشيفتات. راجع تقرير التحقق قبل الحفظ.');
      return;
    }
    if (!window.confirm('سيتم إنشاء مسودات جدول والتحقق منها ثم نشرها عبر Schedule Core V2. لن يتم تعديل بيانات الموظف أو أرشفته تلقائيًا. هل تريد المتابعة؟'))
      return;
    setSaving(true);
    try {
      const report = await saveScheduleImport(preview);
      setSaveReport(report);
      toast.success(`تم نشر جداول ${report.staffSaved} موظف عبر المسار المعتمد`);
    } catch (error) {
      toast.error(`تعذر حفظ بيانات الجدول: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const exportValidationReport = () => {
    if (!preview) return;
    const issues = [...preview.validation.errors, ...preview.validation.warnings];
    const csv = [
      ['level', 'staffName', 'branch', 'day', 'message', 'raw', 'start', 'end', 'hours', 'role'],
      ...issues.map((issue) => [
        issue.level,
        issue.staffName,
        issue.branch,
        issue.day,
        issue.message,
        issue.raw || '',
        issue.start || '',
        issue.end || '',
        issue.hours ?? '',
        issue.role || '',
      ]),
    ]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `schedule-validation-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5" dir="rtl">
      <section className="rounded-3xl border border-[var(--dawaa-theme-border)] dawaa-surface p-5 shadow-sm">
        <div className="text-xs font-black text-[var(--dawaa-theme-primary-strong)]">Schedule Core V2 · Canonical Workforce Scheduling</div>
        <h1 className="mt-1 text-2xl font-black text-[var(--dawaa-theme-heading)]">الجداول والمناوبات</h1>
        <p className="mt-1 text-sm font-bold text-[var(--dawaa-theme-muted)]">الجدول المنشور هو مصدر المواعيد الوحيد. أي تغيير يمر عبر مسودة → تحقق → نشر، والتغييرات بتاريخ محدد تتغلب على الجدول الأسبوعي بدون مسح التاريخ السابق.</p>
      </section>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MiniStat label="الموظفون في المصدر المعتمد" value={canonicalWeek?.summary.staff_count || 0} />
        <MiniStat label="أيام بدون جدول" value={canonicalWeek?.summary.missing_schedule_days || 0} />
        <MiniStat label="تغييرات بتاريخ محدد" value={canonicalWeek?.summary.date_override_days || 0} />
        <MiniStat label="شيفتات تتخطى منتصف الليل" value={canonicalWeek?.summary.overnight_days || 0} />
      </section>
      {scheduleError && (
        <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-sm font-bold text-red-100">
          تعذر تحميل الجدول المعتمد: {scheduleError}. لن يتم الرجوع تلقائيًا إلى قراءة raw shift_schedules حتى لا تظهر بيانات متعارضة.
        </div>
      )}
      {/* Filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="section-title">الجدول الأسبوعي</div>
        <div className="mr-auto flex gap-2 flex-wrap">
          {(managerView ? ['الكل', ...BRANCHES] : [branchFilter]).map((b) => (
            <button
              key={b}
              onClick={() => managerView && setBranchFilter(b)}
              disabled={!managerView}
              className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all ${branchFilter === b ? 'bg-teal-500/15 border-teal-500/30 text-teal-400' : 'border-[#2d4063] text-slate-400 hover:border-teal-500/20'}`}
            >
              {b}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {['الكل', 'صيدلاني', 'توصيل'].map((role) => (
          <button
            key={role}
            onClick={() => setRoleFilter(role)}
            className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all flex items-center gap-2 ${roleFilter === role ? 'bg-teal-500/15 border-teal-500/30 text-teal-400' : 'border-[#2d4063] text-slate-400 hover:border-teal-500/20'}`}
          >
            {role === 'صيدلاني' && <Stethoscope size={15} />}
            {role === 'توصيل' && <Truck size={15} />}
            {role === 'الكل' ? 'كل الفريق' : role === 'صيدلاني' ? 'الدكاترة فقط' : 'الدليفري فقط'}
          </button>
        ))}
      </div>

      {actualsError && (
        <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm font-bold text-amber-100">
          تعذر تحميل البصمات: {actualsError}. الجدول يعرض المخطط فقط ولا يعني ذلك غياب أحد.
        </div>
      )}
      <ScheduleWeekBoard
        employees={filtered.map((employee) => ({ ...employee, branch: normalizeBranch(employee.branch) }))}
        weekDates={weekDates}
        today={todayDate}
        planFor={(employee, day) => scheduleFor(employee as Employee, day)}
        actuals={actuals}
        actualsAvailable={!actualsError}
        onPreviousWeek={() => setWeekOffset((value) => value - 1)}
        onNextWeek={() => setWeekOffset((value) => value + 1)}
        canGoNext={weekOffset < 1}
      />
      <WorkforceScheduleCoverage branch={branchFilter} />
      <SchedulePublishingCenter
        branch={branchFilter}
        staff={employees
          .filter((employee) => staffRowIsActive(employee) && staffRowVisibleInSchedule(employee))
          .map((employee) => ({
            id: employee.id,
            name: employee.name,
            role: employee.role,
            branch: normalizeBranch(employee.branch),
          }))}
      />
      <ScheduleGovernancePanel branch={branchFilter} />
      <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl p-4">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="flex-1">
            <div className="text-white font-bold text-sm">استيراد شيفتات Excel</div>
            <div className="text-slate-400 text-xs mt-1">
              يدعم الشيفتات التي تتعدى منتصف الليل مثل 7 PM → 3 AM. بعد المعاينة يتم الحفظ عبر Draft → Validate → Publish فقط.
            </div>
          </div>
          <label className="btn-secondary cursor-pointer">
            {parsing ? 'جاري القراءة...' : 'اختيار ملف'}
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(event) => handleShiftFile(event.target.files?.[0])}
            />
          </label>
        </div>
        {preview && (
          <div className="mt-4 overflow-x-auto max-h-72 overflow-y-auto">
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 mb-4">
              <MiniStat label="الفروع" value={preview.branchCount} />
              <MiniStat label="الفريق" value={preview.staffCount} />
              <MiniStat label="دكاترة" value={preview.doctorCount} />
              <MiniStat label="دليفري" value={preview.deliveryCount} />
              <MiniStat label="شيفتات" value={preview.shiftCount} />
              <MiniStat label="إجازات" value={preview.offCount} />
              <MiniStat label="أخطاء" value={preview.validation.errors.length} />
              <MiniStat label="تحذيرات" value={preview.validation.warnings.length} />
            </div>
            {(preview.validation.errors.length > 0 || preview.validation.warnings.length > 0) && (
              <div className="mb-4 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4">
                <div className="mb-2 text-sm font-black text-amber-100">
                  تقرير التحقق قبل الحفظ: {preview.validation.errors.length} أخطاء ·{' '}
                  {preview.validation.warnings.length} تحذيرات
                </div>
                <div className="max-h-48 space-y-2 overflow-y-auto text-xs leading-6">
                  {[...preview.validation.errors, ...preview.validation.warnings]
                    .slice(0, 30)
                    .map((issue, index) => (
                      <div
                        key={`${issue.level}-${issue.staffName}-${issue.day}-${index}`}
                        className={
                          issue.level === 'error'
                            ? 'rounded-xl border border-red-400/25 bg-red-500/10 p-2 text-red-100'
                            : 'rounded-xl border border-amber-400/25 bg-amber-500/10 p-2 text-amber-100'
                        }
                      >
                        <b>{issue.level === 'error' ? 'خطأ' : 'تحذير'}:</b> {issue.staffName} ·{' '}
                        {issue.branch} · {issue.day} — {issue.message}
                        {issue.raw ? (
                          <span className="block text-slate-300">القيمة: {issue.raw}</span>
                        ) : null}
                      </div>
                    ))}
                </div>
                {preview.validation.errors.length > 0 && (
                  <div className="mt-3 text-xs font-bold text-red-100">
                    لن يتم الحفظ قبل إصلاح الأخطاء حتى لا تتلف الجداول الحالية.
                  </div>
                )}
                {preview.validation.errors.length === 0 &&
                  preview.validation.warnings.length > 0 && (
                    <div className="mt-3 text-xs font-bold text-amber-100">
                      يمكن الحفظ مع وجود تحذيرات بعد المراجعة
                    </div>
                  )}
                <button
                  type="button"
                  onClick={exportValidationReport}
                  className="btn-secondary mt-3 px-3 py-2 text-xs"
                >
                  تصدير تقرير التحقق CSV
                </button>
              </div>
            )}
            <table className="data-table">
              <thead>
                <tr>
                  <th>الاسم</th>
                  <th>الفرع</th>
                  <th>النوع</th>
                  <th>عدد الأيام المقروءة</th>
                  <th>مثال شيفت</th>
                </tr>
              </thead>
              <tbody>
                {preview.staff.slice(0, 40).map((item) => {
                  const firstShift = Object.entries(item.shifts)[0];
                  return (
                    <tr key={`${item.branch}-${item.name}`}>
                      <td>{item.name}</td>
                      <td>{normalizeBranch(item.branch)}</td>
                      <td>{item.role}</td>
                      <td className="num">{Object.keys(item.shifts).length}</td>
                      <td>
                        {firstShift
                          ? `${firstShift[0]}: ${firstShift[1].isOff ? 'إجازة' : `${firstShift[1].start} - ${firstShift[1].end}`}`
                          : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="flex flex-col md:flex-row gap-3 md:items-center mt-4">
              <button
                onClick={handleSavePreview}
                disabled={saving || preview.validation.errors.length > 0}
                className="btn-primary"
              >
                {saving ? 'جاري الحفظ...' : 'حفظ البيانات المقروءة'}
              </button>
              <div className="text-amber-300 text-xs">
                الاستيراد لا يعدّل staff.shift_* ولا يؤرشف موظفين ولا يكتب إجازات مكررة. الجدول المنشور فقط هو المصدر التشغيلي.
              </div>
            </div>
            {saveReport && (
              <div className="mt-4 bg-white/5 border border-[#2d4063] rounded-xl p-4 text-sm">
                <div className="text-white font-bold mb-2">تقرير الحفظ</div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-slate-300">
                  <div>
                    جدول الفريق:{' '}
                    <span className="text-teal-300">{saveReport.staffTable || 'غير موجود'}</span>
                  </div>
                  <div>
                    الموظفون المطابقون:{' '}
                    <span className="num text-teal-300">{saveReport.staffSaved}</span>
                  </div>
                  <div>
                    الشيفتات: <span className="num text-teal-300">{saveReport.shiftsSaved}</span>
                  </div>
                  <div>
                    legacy exceptions: <span className="num text-teal-300">{saveReport.leavesSaved}</span>
                  </div>
                </div>
                {saveReport.skipped.length > 0 && (
                  <div className="mt-3 space-y-1 text-amber-200 text-xs">
                    {saveReport.skipped.map((item) => (
                      <div key={item}>• {item}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {managerView && <ScheduleIdentityGovernance />}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white/5 border border-[#2d4063] rounded-xl p-3">
      <div className="text-slate-400 text-xs">{label}</div>
      <div className="text-white font-bold num mt-1">{value}</div>
    </div>
  );
}
